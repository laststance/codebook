import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type * as vscode from 'vscode'

import {
  WIKI_CURSOR_PROCESS_OUTPUT_LIMIT_BYTES,
  WIKI_CURSOR_PROMPT_LIMIT_BYTES,
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

/** Requests a source-excerpt answer from Cursor Agent when its editor model API is unavailable. @param prompt - Verified bounded excerpt prompt; never placed in process arguments. @param cancellationToken - Browser request cancellation. @returns Raw model text for {@link answerDeepWikiQuestionWithPrompt} to validate. @example await requestCursorWikiText('Question: ...', token) // => '{"answer":"...","citations":[...]}' */
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
    const executable = await resolveCursorAgentExecutable()
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
