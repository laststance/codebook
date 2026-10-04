import { spawn } from 'node:child_process'

import {
  WIKI_CURSOR_PROMPT_LIMIT_BYTES,
  WIKI_CURSOR_SHUTDOWN_GRACE_MS,
  WIKI_CURSOR_TERMINATION_GRACE_MS,
  WIKI_CURSOR_UPDATE_OUTPUT_LIMIT_BYTES,
  WIKI_UPDATE_TIMED_OUT_ERROR_NAME,
  WIKI_UPDATE_WINDOW_CLOSING_ABORT_REASON,
} from '../constants'

import { terminateCursorAgentProcess } from './requestCursorWikiText'
import { resolveCursorAgentExecutable } from './resolveCursorAgentExecutable'

type CursorCliResult = {
  type?: unknown
  subtype?: unknown
  is_error?: unknown
  result?: unknown
}

/** Accepts only a completed Cursor Agent update response before the caller validates the published Wiki. @param output - CLI JSON envelope. @example parseCursorWikiUpdateResult('{"type":"result","subtype":"success","is_error":false,"result":"Updated"}') // => 'Updated' */
export function parseCursorWikiUpdateResult(output: string): string {
  let envelope: CursorCliResult
  try {
    envelope = JSON.parse(output.trim())
  } catch {
    throw new Error(
      'Cursor Agent returned a result Codebook could not read. Update again; if it repeats, run the update in Cursor chat.',
    )
  }
  if (
    !envelope ||
    envelope.type !== 'result' ||
    envelope.subtype !== 'success' ||
    envelope.is_error !== false ||
    typeof envelope.result !== 'string'
  )
    throw new Error(
      'Cursor Agent ended without completing the update. Run "/codebook Update LLM Wiki" in Cursor chat to see its own message.',
    )
  return envelope.result
}

/** Starts the shared Codebook skill in the opened Cursor project when its browser update button is used. @param projectRoot - Canonical opened repository. @param prompt - Project-bound update request sent over stdin. @param signal - The run's abort: the learner's Cancel in the progress UI, or the closing editor window, which aborts with {@link WIKI_UPDATE_WINDOW_CLOSING_ABORT_REASON} and so gets the shorter grace before the hard stop. @param timeoutMs - Bound after which the agent is stopped; the caller passes the bound it announced. @returns The agent's reply, once the agent process has closed. @throws An error named {@link WIKI_UPDATE_TIMED_OUT_ERROR_NAME} at the bound; a plain error for a cancel (also one that arrives while the executable is looked up, which starts no process), a failed start, a non-zero exit or an unusable reply. In every case the promise settles only after the process closed, and after a stop nothing of the agent's process group is left running. @example await runCursorWikiUpdate('/repo', '/codebook Update LLM Wiki...', controller.signal, 900_000) */
export async function runCursorWikiUpdate(
  projectRoot: string,
  prompt: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<string> {
  if (Buffer.byteLength(prompt, 'utf8') > WIKI_CURSOR_PROMPT_LIMIT_BYTES)
    throw new Error('The Wiki update request is too large.')
  if (signal?.aborted) throw new Error('The Wiki update was cancelled.')
  const executable = await resolveCursorAgentExecutable()
  // An abort that arrived while the executable was being resolved has no listener to fire; no agent may start after it.
  if (signal?.aborted) throw new Error('The Wiki update was cancelled.')
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      executable,
      [
        '--print',
        '--trust',
        '--sandbox',
        'enabled',
        '--auto-review',
        '--output-format',
        'json',
        '--workspace',
        projectRoot,
      ],
      {
        cwd: projectRoot,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    const chunks: Buffer[] = []
    let outputBytes = 0
    let failure: Error | undefined
    let killTimer: NodeJS.Timeout | undefined
    /** Hard-stops the agent's whole process group, also the children the CLI started. */
    const killProcessGroup = (): void => {
      if (child.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGKILL')
          return
        } catch {
          /* The process may have exited already. */
        }
      }
      child.kill('SIGKILL')
    }
    const stop = (error: Error): void => {
      if (failure) return
      failure = error
      terminateCursorAgentProcess(child)
      killTimer = setTimeout(
        killProcessGroup,
        // The extension host exits a few seconds after a window starts to close, so the hard stop must come well before that.
        signal?.reason === WIKI_UPDATE_WINDOW_CLOSING_ABORT_REASON
          ? WIKI_CURSOR_SHUTDOWN_GRACE_MS
          : WIKI_CURSOR_TERMINATION_GRACE_MS,
      )
    }
    const timeout = setTimeout(() => {
      const timedOut = new Error('Cursor Agent timed out updating the Wiki.')
      // The caller tells the bound apart from a failure by this name and records `timed-out`.
      timedOut.name = WIKI_UPDATE_TIMED_OUT_ERROR_NAME
      stop(timedOut)
    }, timeoutMs)
    const cancel = (): void => stop(new Error('The Wiki update was cancelled.'))
    signal?.addEventListener('abort', cancel, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > WIKI_CURSOR_UPDATE_OUTPUT_LIMIT_BYTES) {
        stop(
          new Error(
            'Cursor Agent exceeded the Wiki update response limit and was stopped. Run "/codebook Update LLM Wiki" in Cursor chat instead.',
          ),
        )
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on('data', () => {
      /* CLI diagnostics may contain private source paths or content. */
    })
    child.stdin.on('error', () => {
      /* The exit status reports a closed child. */
    })
    child.on('error', (error) => {
      failure =
        'code' in error && error.code === 'ENOENT'
          ? new Error(
              'Cursor Agent CLI is not installed. Install and sign in, then retry the Wiki update.',
            )
          : new Error(
              'Cursor Agent could not start the Wiki update. Check its installation and retry.',
            )
    })
    child.on('close', (code, exitSignal) => {
      clearTimeout(timeout)
      if (killTimer) {
        clearTimeout(killTimer)
        // The CLI's own exit does not stop a child of its group that ignored the stop request; nothing may keep writing after the update is reported stopped.
        killProcessGroup()
      }
      signal?.removeEventListener('abort', cancel)
      if (failure) {
        reject(failure)
        return
      }
      if (code !== 0) {
        // A reason says what happened and what to do; the page alone says what was kept.
        reject(
          new Error(
            `Cursor Agent stopped ${code === null ? `on signal ${exitSignal ?? 'unknown'}` : `with exit code ${code}`} before finishing. Run "/codebook Update LLM Wiki" in Cursor chat to see its own message.`,
          ),
        )
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    child.stdin.end(prompt)
  })
  return parseCursorWikiUpdateResult(output)
}
