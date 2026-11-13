import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type * as vscode from 'vscode'

import {
  WIKI_CURSOR_PROCESS_OUTPUT_LIMIT_BYTES,
  WIKI_CURSOR_PROMPT_LIMIT_BYTES,
  WIKI_CURSOR_QUESTION_PERMISSIONS,
  WIKI_CURSOR_REQUEST_TIMEOUT_MS,
  WIKI_CURSOR_TERMINATION_GRACE_MS,
  WIKI_ANSWER_LIMIT_CHARS,
} from '../constants'

import { resolveCursorAgentExecutable } from './resolveCursorAgentExecutable'

type CursorCliResult = {
  type?: unknown
  subtype?: unknown
  is_error?: unknown
  result?: unknown
}

/** Extracts only a successful bounded model response when the isolated Cursor CLI exits. @param output - Captured CLI JSON envelope. @returns The model text for independent source-citation validation. @example parseCursorWikiCliResult('{"type":"result","subtype":"success","is_error":false,"result":"ok"}') // => 'ok' */
export function parseCursorWikiCliResult(output: string): string {
  let envelope: CursorCliResult | null
  try {
    envelope = JSON.parse(output.trim())
  } catch {
    throw new Error(
      'Cursor Agent returned an unreadable Wiki response. Ask again or use editor chat.',
    )
  }
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    envelope.type !== 'result' ||
    envelope.subtype !== 'success' ||
    envelope.is_error !== false ||
    typeof envelope.result !== 'string'
  )
    throw new Error(
      'Cursor Agent could not answer this Wiki question. Check its sign-in and retry.',
    )
  if (
    !envelope.result.trim() ||
    envelope.result.length > WIKI_ANSWER_LIMIT_CHARS
  )
    throw new Error(
      'Cursor Agent returned an empty or oversized Wiki answer. Ask again with a narrower question.',
    )
  return envelope.result
}

/** Stops an owned Cursor Agent CLI process group when a Wiki request fails or is cancelled. @param child - Owned CLI process group. @example terminateCursorAgentProcess(child) // => sends SIGTERM to the owned group */
export function terminateCursorAgentProcess(
  child: ChildProcessWithoutNullStreams,
): void {
  if (child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM')
      return
    } catch {
      /* The process may have exited already. */
    }
  }
  child.kill('SIGTERM')
}

/**
 * Writes the project-level Cursor CLI permissions that deny every tool into a Wiki question's temporary workspace.
 *
 * Runs in {@link requestCursorWikiText} before the agent spawns, so the agent never starts with access to files outside the excerpt Codebook sends (Cycle 0125 C1).
 *
 * @param workspace - The question's fresh temporary workspace, also the agent's working directory.
 * @returns Resolves once `.cursor/cli.json` holds {@link WIKI_CURSOR_QUESTION_PERMISSIONS}.
 * @throws A learner-facing Error (the write failure kept as its `cause`) when the permissions file cannot be written; no agent has started then.
 * @example
 * await denyEveryCursorTool('/tmp/codebook-wiki-question-abc') // => writes /tmp/codebook-wiki-question-abc/.cursor/cli.json
 */
async function denyEveryCursorTool(workspace: string): Promise<void> {
  try {
    await mkdir(join(workspace, '.cursor'), { recursive: true })
    await writeFile(
      join(workspace, '.cursor', 'cli.json'),
      JSON.stringify(WIKI_CURSOR_QUESTION_PERMISSIONS),
    )
  } catch (cause) {
    // Without the deny rules the agent could read other checkouts, so never start it.
    throw new Error(
      'Codebook could not restrict the Cursor Agent for this Wiki question, so it did not start. Ask again or use editor chat.',
      { cause },
    )
  }
}

/** Requests a source-excerpt answer from Cursor Agent when its editor model API is unavailable. Called by the Wiki question flow; a cancellation seen at any point before the process spawns (including during the permissions write and the executable lookup) starts no agent. @param prompt - Verified bounded excerpt prompt; never placed in process arguments. @param cancellationToken - Browser request cancellation. @returns Raw model text for {@link answerDeepWikiQuestionWithPrompt} to validate. @example await requestCursorWikiText('Question: ...', token) // => '{"answer":"...","citations":[...]}' */
export async function requestCursorWikiText(
  prompt: string,
  cancellationToken?: Pick<
    vscode.CancellationToken,
    'isCancellationRequested' | 'onCancellationRequested'
  >,
): Promise<string> {
  if (Buffer.byteLength(prompt, 'utf8') > WIKI_CURSOR_PROMPT_LIMIT_BYTES)
    throw new Error(
      'The Wiki source excerpt is too large for a Cursor question. Ask a narrower question.',
    )
  if (cancellationToken?.isCancellationRequested)
    throw new Error('The Wiki question was cancelled.')
  const temporaryWorkspace = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-question-'),
  )
  try {
    await denyEveryCursorTool(temporaryWorkspace)
    const executable = await resolveCursorAgentExecutable()
    // A cancellation that landed during the config write or executable lookup has no listener yet, so stop before any agent starts
    if (cancellationToken?.isCancellationRequested)
      throw new Error('The Wiki question was cancelled.')
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        executable,
        [
          '--print',
          '--mode',
          'ask',
          '--trust',
          '--sandbox',
          'enabled',
          '--output-format',
          'json',
          '--workspace',
          temporaryWorkspace,
        ],
        {
          cwd: temporaryWorkspace,
          detached: process.platform !== 'win32',
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
      const chunks: Buffer[] = []
      let outputBytes = 0
      let failure: Error | undefined
      let killTimer: NodeJS.Timeout | undefined
      const stop = (error: Error): void => {
        if (failure) return
        failure = error
        terminateCursorAgentProcess(child)
        killTimer = setTimeout(() => {
          if (child.pid && process.platform !== 'win32') {
            try {
              process.kill(-child.pid, 'SIGKILL')
              return
            } catch {
              /* The group may have exited already. */
            }
          }
          child.kill('SIGKILL')
        }, WIKI_CURSOR_TERMINATION_GRACE_MS)
      }
      const timeout = setTimeout(
        () =>
          stop(
            new Error(
              'Cursor Agent timed out answering the Wiki question. Retry or use editor chat.',
            ),
          ),
        WIKI_CURSOR_REQUEST_TIMEOUT_MS,
      )
      const cancellation = cancellationToken?.onCancellationRequested(() =>
        stop(new Error('The Wiki question was cancelled.')),
      )
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length
        if (outputBytes > WIKI_CURSOR_PROCESS_OUTPUT_LIMIT_BYTES) {
          stop(
            new Error(
              'Cursor Agent exceeded the Wiki response limit. Ask a narrower question.',
            ),
          )
          return
        }
        chunks.push(chunk)
      })
      child.stderr.on('data', () => {
        /* Do not retain CLI diagnostics that may contain private source text. */
      })
      child.stdin.on('error', () => {
        /* A closed child is reported through its exit status. */
      })
      child.on('error', (error) => {
        failure =
          'code' in error && error.code === 'ENOENT'
            ? new Error(
                'Cursor Agent CLI is not installed. Install and sign in, or ask in editor chat.',
              )
            : new Error(
                'Cursor Agent could not start the Wiki question. Check its installation and retry.',
              )
      })
      child.on('close', (code) => {
        clearTimeout(timeout)
        if (killTimer) clearTimeout(killTimer)
        cancellation?.dispose()
        if (failure) {
          reject(failure)
          return
        }
        if (code !== 0) {
          reject(
            new Error(
              'Cursor Agent could not answer this Wiki question. Check its sign-in and retry.',
            ),
          )
          return
        }
        resolve(Buffer.concat(chunks).toString('utf8'))
      })
      child.stdin.end(prompt)
    })
    return parseCursorWikiCliResult(output)
  } finally {
    await rm(temporaryWorkspace, { recursive: true, force: true })
  }
}
