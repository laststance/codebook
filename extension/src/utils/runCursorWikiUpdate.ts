import { spawn } from 'node:child_process'

import {
  WIKI_CURSOR_PROMPT_LIMIT_BYTES,
  WIKI_CURSOR_SHUTDOWN_GRACE_MS,
  WIKI_CURSOR_TERMINATION_GRACE_MS,
  WIKI_CURSOR_UPDATE_OUTPUT_LIMIT_BYTES,
  WIKI_GENERATE_CHAT_REQUEST,
  WIKI_UPDATE_CHAT_REQUEST,
  WIKI_UPDATE_WINDOW_CLOSING_ABORT_REASON,
} from '../constants'

import { terminateCursorAgentProcess } from './requestCursorWikiText'
import { resolveCursorAgentExecutable } from './resolveCursorAgentExecutable'
import type { WikiRunKind } from './wikiUpdateRun'
import { WikiUpdateTimeoutError } from './wikiUpdateTimeoutError'

/** The words a Cursor agent run's sentences use for its kind, so a generation's sentences never call it an update (Cycle 0055, D5). */
type CursorRunWords = {
  /** The run as a noun: `update` or `generation`. */
  noun: string
  /** The run as the verb of "Cursor Agent timed out … the Wiki": `updating` or `generating`. */
  verb: string
  /** The button the learner presses to run it again. */
  button: string
  /** The chat request a learner can paste in Cursor chat to see the agent's own message. */
  chatRequest: string
}

/** {@link CursorRunWords} of each run kind. */
const CURSOR_RUN_WORDS: Record<WikiRunKind, CursorRunWords> = {
  update: {
    noun: 'update',
    verb: 'updating',
    button: 'Update',
    chatRequest: WIKI_UPDATE_CHAT_REQUEST,
  },
  generate: {
    noun: 'generation',
    verb: 'generating',
    button: 'Generate',
    chatRequest: WIKI_GENERATE_CHAT_REQUEST,
  },
}

/** The failure of a Cursor agent process that closed without a clean exit and that Codebook did not stop, with its exit code or signal as data, so the run's Output record names them without the sentence ({@link unfinishedExitError}). */
export class CursorAgentExitError extends Error {
  /**
   * @param message - The sentence the learner reads.
   * @param exitCode - The exit code, or `null` when a signal ended the process.
   * @param exitSignal - The signal that ended the process, or `null`.
   */
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly exitSignal: NodeJS.Signals | null,
  ) {
    super(message)
  }
}

type CursorCliResult = {
  type?: unknown
  subtype?: unknown
  is_error?: unknown
  result?: unknown
}

/** Accepts only a completed Cursor Agent update or generation response before the caller validates the published Wiki. @param output - CLI JSON envelope. @param runKind - The run's kind, which the refusal's words follow. @example parseCursorWikiUpdateResult('{"type":"result","subtype":"success","is_error":false,"result":"Updated"}') // => 'Updated' */
export function parseCursorWikiUpdateResult(
  output: string,
  runKind: WikiRunKind = 'update',
): string {
  const words = CURSOR_RUN_WORDS[runKind]
  let envelope: CursorCliResult
  try {
    envelope = JSON.parse(output.trim())
  } catch {
    throw new Error(
      `Cursor Agent returned a result Codebook could not read. ${words.button} again; if it repeats, run the ${words.noun} in Cursor chat.`,
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
      `Cursor Agent ended without completing the ${words.noun}. Run "${words.chatRequest}" in Cursor chat to see its own message.`,
    )
  return envelope.result
}

/**
 * Refuses to go on with a Cursor update that was already cancelled; called by {@link runCursorWikiUpdate} before it looks up the executable and again before it starts the agent, because an abort that arrives in between has no listener to fire.
 * @param signal - The run's abort, if the caller has one.
 * @param words - The words of the run's kind.
 * @throws A plain error saying that the Wiki update or generation was cancelled, when the signal is aborted.
 * @example
 * throwIfWikiUpdateCancelled(controller.signal, CURSOR_RUN_WORDS.update) // returns while the learner has not cancelled
 */
function throwIfWikiUpdateCancelled(
  signal: AbortSignal | undefined,
  words: CursorRunWords,
): void {
  if (signal?.aborted) throw new Error(`The Wiki ${words.noun} was cancelled.`)
}

/**
 * Words the failure of an agent process that closed without a clean exit and that Codebook did not stop; called by the `close` handler of {@link runCursorWikiUpdate}.
 * @param code - The exit code, or `null` when a signal ended the process.
 * @param exitSignal - The signal that ended the process, or `null`.
 * @param words - The words of the run's kind, whose chat request the sentence names.
 * @returns The error whose sentence says how the agent stopped and where its own message can be read, with the code and the signal as data; the page alone says what was kept.
 * @example
 * unfinishedExitError(1, null, CURSOR_RUN_WORDS.update).message
 * // => 'Cursor Agent stopped with exit code 1 before finishing. Run "/codebook Update LLM Wiki" in Cursor chat to see its own message.'
 * unfinishedExitError(null, 'SIGTERM', CURSOR_RUN_WORDS.generate).message
 * // => 'Cursor Agent stopped on signal SIGTERM before finishing. Run "/codebook Generate the LLM Wiki for this project" in Cursor chat to see its own message.'
 */
function unfinishedExitError(
  code: number | null,
  exitSignal: NodeJS.Signals | null,
  words: CursorRunWords,
): CursorAgentExitError {
  return new CursorAgentExitError(
    `Cursor Agent stopped ${code === null ? `on signal ${exitSignal ?? 'unknown'}` : `with exit code ${code}`} before finishing. Run "${words.chatRequest}" in Cursor chat to see its own message.`,
    code,
    exitSignal,
  )
}

/** Starts the shared Codebook skill in the opened Cursor project for an update (the browser update button, the command) or a generation (Codebook: Generate LLM Wiki). @param projectRoot - Canonical opened repository. @param prompt - Project-bound update or generate request sent over stdin. @param signal - The run's abort: the learner's Cancel in the progress UI, or the closing editor window, which aborts with {@link WIKI_UPDATE_WINDOW_CLOSING_ABORT_REASON} and so gets the shorter grace before the hard stop. @param timeoutMs - Bound after which the agent is stopped; the caller passes the bound it announced. @param runKind - The run's kind, which every sentence of a failure follows. @returns The agent's reply, once the agent process has closed. @throws A {@link WikiUpdateTimeoutError} at the bound; a plain error for a cancel (also one that arrives while the executable is looked up, which starts no process), a failed start, a non-zero exit or an unusable reply. In every case the promise settles only after the process closed, and after a stop nothing of the agent's process group is left running. @example await runCursorWikiUpdate('/repo', '/codebook Update LLM Wiki...', controller.signal, 900_000) */
export async function runCursorWikiUpdate(
  projectRoot: string,
  prompt: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  runKind: WikiRunKind = 'update',
): Promise<string> {
  const words = CURSOR_RUN_WORDS[runKind]
  if (Buffer.byteLength(prompt, 'utf8') > WIKI_CURSOR_PROMPT_LIMIT_BYTES)
    throw new Error(`The Wiki ${words.noun} request is too large.`)
  throwIfWikiUpdateCancelled(signal, words)
  const executable = await resolveCursorAgentExecutable()
  // An abort that arrived while the executable was being resolved has no listener to fire; no agent may start after it.
  throwIfWikiUpdateCancelled(signal, words)
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
      // The caller tells the bound apart from a failure by this type and records `timed-out`.
      stop(
        new WikiUpdateTimeoutError(
          `Cursor Agent timed out ${words.verb} the Wiki.`,
        ),
      )
    }, timeoutMs)
    const cancel = (): void =>
      stop(new Error(`The Wiki ${words.noun} was cancelled.`))
    signal?.addEventListener('abort', cancel, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > WIKI_CURSOR_UPDATE_OUTPUT_LIMIT_BYTES) {
        stop(
          new Error(
            `Cursor Agent exceeded the Wiki ${words.noun} response limit and was stopped. Run "${words.chatRequest}" in Cursor chat instead.`,
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
              `Cursor Agent CLI is not installed: Codebook looks for ~/.local/bin/cursor-agent, then cursor-agent on the editor's PATH. Install it and sign in, then retry the Wiki ${words.noun}, or run "${words.chatRequest}" in Cursor chat.`,
            )
          : new Error(
              `Cursor Agent could not start the Wiki ${words.noun}. Check its installation and retry.`,
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
        reject(unfinishedExitError(code, exitSignal, words))
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    child.stdin.end(prompt)
  })
  return parseCursorWikiUpdateResult(output, runKind)
}
