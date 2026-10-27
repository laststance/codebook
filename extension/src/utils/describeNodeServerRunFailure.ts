import { homedir } from 'node:os'

import {
  NODE_SERVER_FAILED_STOPS_NAMING_PID,
  NODE_SERVER_FAILURE_CAUSE_LIMIT_CHARS,
  NODE_SERVER_READY_TIMEOUT_MS,
  NODE_SERVER_STOP_DEADLINE_MS,
  PROCESS_OUTPUT_EVENT_LIMIT_CHARS,
} from '../constants'
import { StudyError } from '../errors'

import { redactSecretText } from './redactSecretText'
import { thrownMessage } from './thrownMessage'

/** An absolute POSIX path of two segments or more that is not already a placeholder's tail (`<workspace>/…`, `~/…`); a segment is any run of characters but whitespace, separators and quotes, so non-ASCII names count. */
const ABSOLUTE_PATH = /(?<![\w~>.])(?:\/[^\s/'"`]+){2,}\/?/g

/**
 * Hides the private paths of a text: the repository's root as `<workspace>`, the home directory as `~` (the repository-relative rest stays readable), and any other absolute path as `<path>`.
 * Called by {@link sanitizeRunCause} for causes and by {@link serverExitedError} for the server's output tail, whose stack traces carry the learner's paths.
 * @param text - Any text.
 * @param workspace - The opened repository's real root.
 * @param home - The user's home directory.
 * @returns The text with those paths replaced; newlines are kept.
 * @example hidePrivatePaths('at /work/repo/src/a.ts:3 and /Users/村上/x/y', '/work/repo', '/Users/ada') // => 'at <workspace>/src/a.ts:3 and <path>'
 */
function hidePrivatePaths(
  text: string,
  workspace: string,
  home: string,
): string {
  const withoutWorkspace = workspace
    ? text.split(workspace).join('<workspace>')
    : text
  // A bare "/" home would turn every path into "~…".
  const withoutHome =
    home.length > 1 ? withoutWorkspace.split(home).join('~') : withoutWorkspace
  return withoutHome.replace(ABSOLUTE_PATH, '<path>')
}

/**
 * Makes a thrown cause fit for the agent: secrets masked, private paths hidden ({@link hidePrivatePaths}), whitespace collapsed, cut to {@link NODE_SERVER_FAILURE_CAUSE_LIMIT_CHARS}.
 * Called by every run failure that names a cause.
 * @param cause - Whatever was thrown.
 * @param workspace - The opened repository's real root.
 * @param home - The user's home directory; the current user's unless a test names another.
 * @returns The sanitized one-line cause.
 * @example sanitizeRunCause(new Error('ENOENT /repo/src/a.ts'), '/repo') // => 'ENOENT <workspace>/src/a.ts'
 */
export function sanitizeRunCause(
  cause: unknown,
  workspace: string,
  home = homedir(),
): string {
  return hidePrivatePaths(
    redactSecretText(thrownMessage(cause)),
    workspace,
    home,
  )
    .replaceAll(/\s+/g, ' ')
    .slice(0, NODE_SERVER_FAILURE_CAUSE_LIMIT_CHARS)
}

/**
 * Builds the `RUNTIME_FAILED` of a failed preparation step, naming the step and the sanitized cause.
 * @param step - What the run was doing, as a gerund phrase ("attaching the debugger").
 * @param cause - What was thrown.
 * @param workspace - The opened repository's real root.
 * @returns The typed error.
 * @example stepFailedError('attaching the debugger', new Error('refused'), '/repo').message // => 'The node-server run failed while attaching the debugger: refused.'
 */
export function stepFailedError(
  step: string,
  cause: unknown,
  workspace: string,
): StudyError {
  const text = sanitizeRunCause(cause, workspace)
  return new StudyError(
    'RUNTIME_FAILED',
    `The node-server run failed while ${step}: ${text.replace(/\.$/, '')}.`,
    text,
  )
}

/**
 * Builds the `SERVER_EXITED` error of a server that ended by itself, with its exit and the masked last output.
 * @param exit - The exit code and signal.
 * @param output - The server's redacted last output.
 * @param workspace - The opened repository's real root; paths in the output are hidden ({@link hidePrivatePaths}).
 * @returns The typed error; the output is cut to its last 4,096 characters.
 * @example serverExitedError({ exitCode: 3, signal: null }, 'cannot start\n', '/repo').message // => 'The server exited with code 3. Its last output:\ncannot start\n'
 */
export function serverExitedError(
  exit: { exitCode: number | null; signal: NodeJS.Signals | null },
  output: string,
  workspace: string,
  home = homedir(),
): StudyError {
  const how = exit.signal ? `signal ${exit.signal}` : `code ${exit.exitCode}`
  const tail = hidePrivatePaths(
    output.slice(-PROCESS_OUTPUT_EVENT_LIMIT_CHARS),
    workspace,
    home,
  )
  return new StudyError(
    'SERVER_EXITED',
    `The server exited with ${how}.${tail ? ` Its last output:\n${tail}` : ' It printed nothing.'}`,
    `exit ${how}`,
  )
}

/**
 * Builds the `SERVER_NOT_LISTENING` error of a server that did not accept connections in time, naming the declared port and, when the process listens elsewhere, the corrected declaration.
 * @param declaredPort - The port the declaration names.
 * @param listeningPort - Another port the launched process listens on (not the inspector's), if any.
 * @returns The typed error.
 * @example serverNotListeningError(4100, 4101).message // => '... it listens on port 4101: declare port: 4101.'
 */
export function serverNotListeningError(
  declaredPort: number,
  listeningPort: number | undefined,
): StudyError {
  const elsewhere =
    listeningPort === undefined
      ? ''
      : ` The launched process listens on port ${listeningPort}: declare port: ${listeningPort}.`
  return new StudyError(
    'SERVER_NOT_LISTENING',
    `The server did not listen on the declared port ${declaredPort} within ${NODE_SERVER_READY_TIMEOUT_MS / 1_000} s of running time.${elsewhere}`,
  )
}

/**
 * Builds the retryable `RUNTIME_FAILED` of a stop that did not finish inside its deadline, naming what remains; from the second failure it names the pid for the learner to end.
 * @param remaining - The owned pid still running and the declared port.
 * @param failedStops - How many stops failed including this one.
 * @returns The typed error.
 * @example stopFailedError({ pid: 4242, port: 4100 }, 2).message // => '... Ask the learner to end process 4242 ...'
 */
export function stopFailedError(
  remaining: { pid?: number; port: number },
  failedStops: number,
): StudyError {
  const what =
    remaining.pid === undefined
      ? `the debug session of the server on port ${remaining.port}`
      : `process ${remaining.pid} (it holds port ${remaining.port})`
  const retry =
    failedStops >= NODE_SERVER_FAILED_STOPS_NAMING_PID &&
    remaining.pid !== undefined
      ? ` The stop failed again: ask the learner to end process ${remaining.pid} themselves, then stop again.`
      : ' Stop again with codebook_stop.'
  return new StudyError(
    'RUNTIME_FAILED',
    `Codebook could not finish stopping the server within ${NODE_SERVER_STOP_DEADLINE_MS / 1_000} s: ${what} is still there.${retry}`,
  )
}
