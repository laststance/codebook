/**
 * The exit codes every delivery command shares (Cycle 0068, Implementation 0), so a calling agent can tell from the code alone whether a retry is safe.
 * `DONE` 0; `REFUSED` 1, refused before any side effect; `FAILED` 2, failed before any side effect; `FOLLOW_UP` 3, partly or fully done with a follow-up the last line names; `UNKNOWN` 4, outcome unknown or in need of an audit; `USAGE` 64, a usage error.
 * @example process.exitCode = EXIT.FOLLOW_UP // merged, but the local main is not synced
 */
export const EXIT = Object.freeze({
  DONE: 0,
  REFUSED: 1,
  FAILED: 2,
  FOLLOW_UP: 3,
  UNKNOWN: 4,
  USAGE: 64,
})

/** Environment variable names whose values never reach printed output (matched in upper case). */
const SECRET_NAME_PARTS = ['TOKEN', 'KEY', 'SECRET', 'PASSWORD']

/** Values shorter than this are left alone: replacing `1` or `true` everywhere would garble every line, and no real secret is that short. */
const MIN_REDACTED_VALUE_LENGTH = 6

/** The text that stands in for a secret value. */
export const REDACTED = '[redacted]'

/**
 * A refusal a delivery command stops with: a stable code, what failed, and one safe next step.
 *
 * Why: every command prints a refusal the same way (first line `<CODE>: <what failed>`, last line `Fix: <step>`), so a calling agent reads the code and the fix without parsing prose.
 * Thrown inside a command's `main` and turned into printed lines and an exit code by {@link runCommandLine}.
 *
 * @example
 * ```js
 * throw new CommandRefusal('E_DIRTY', 'the checkout has changes: extension/src/a.ts', {
 *   fix: 'commit or move the changes',
 * })
 * ```
 */
export class CommandRefusal extends Error {
  /**
   * @param {string} code - Stable `E_…` code, listed in the command's `--help`.
   * @param {string} message - What failed, naming the PR, SHA or file.
   * @param {{ fix: string, exitCode?: number, details?: string[] }} options - `fix`: one safe command or edit; `exitCode`: one of {@link EXIT} (default `REFUSED`); `details`: lines printed between the first and the last.
   */
  constructor(code, message, { fix, exitCode = EXIT.REFUSED, details = [] }) {
    super(`${code}: ${message}`)
    this.name = 'CommandRefusal'
    this.code = code
    this.reason = message
    this.fix = fix
    this.exitCode = exitCode
    this.details = details
  }
}

/**
 * Replaces the value of every environment variable whose name contains `TOKEN`, `KEY`, `SECRET` or `PASSWORD` with {@link REDACTED}.
 *
 * Why: a command relays a child's stderr (`gh`, `git`, `codex`) and its own stack traces; a token in that text must never reach the terminal, a log or a post.
 * Called by {@link formatRefusal} and {@link runCommandLine} for every printed line, and by commands before they relay child output.
 *
 * @param {string} text - Text that may hold a secret value.
 * @param {NodeJS.ProcessEnv} [environment] - The variables whose values are secret (default: this process's environment).
 * @returns {string} The text with each secret value of at least {@link MIN_REDACTED_VALUE_LENGTH} characters replaced, longest first so an overlapping shorter value cannot leave a tail.
 * @example redactSecrets('auth failed for ghp_abc123', { GH_TOKEN: 'ghp_abc123' }) // => 'auth failed for [redacted]'
 */
export function redactSecrets(text, environment = process.env) {
  const secretValues = Object.entries(environment)
    .filter(
      ([name, value]) =>
        typeof value === 'string' &&
        value.length >= MIN_REDACTED_VALUE_LENGTH &&
        SECRET_NAME_PARTS.some((part) => name.toUpperCase().includes(part)),
    )
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length)
  let redacted = text
  // Each value is replaced as literal text (split/join), so a value holding regular-expression characters stays literal.
  for (const value of secretValues) {
    redacted = redacted.split(value).join(REDACTED)
  }
  return redacted
}

/**
 * Turns a {@link CommandRefusal} into its printed lines: `<CODE>: <what failed>`, any detail lines, then `Fix: <step>`.
 *
 * Why: one formatter keeps the first-line code and last-line fix identical across the four delivery commands.
 * Called by {@link runCommandLine}; tests call it to compare a refusal's exact lines.
 *
 * @param {CommandRefusal} refusal - The refusal to print.
 * @param {NodeJS.ProcessEnv} [environment] - Secret values to redact (see {@link redactSecrets}).
 * @returns {string[]} The lines, secrets redacted.
 * @example formatRefusal(new CommandRefusal('E_GH', 'gh pr view failed', { fix: 'gh auth status' })) // => ['E_GH: gh pr view failed', 'Fix: gh auth status']
 */
export function formatRefusal(refusal, environment = process.env) {
  return [
    `${refusal.code}: ${refusal.reason}`,
    ...refusal.details,
    `Fix: ${refusal.fix}`,
  ].map((line) => redactSecrets(line, environment))
}

/**
 * Where a running command is, so an unexpected exception can say which stage it reached and whether a side effect had already happened.
 *
 * Why: `E_INTERNAL` must exit 2 when nothing changed yet and 4 once something may have changed (a written file, a merge call), because the caller's retry decision depends on it (Implementation 0, D30).
 * Created by {@link runCommandLine} and passed to the command's `main`, which calls {@link CommandProgress.enter} before each stage.
 *
 * @example
 * ```js
 * progress.enter('read the PR')
 * progress.enter('merge', { sideEffect: true }) // from here an exception exits 4
 * ```
 */
export class CommandProgress {
  constructor() {
    this.stage = 'start'
    this.sideEffectStarted = false
  }

  /**
   * Records the stage the command enters; a stage marked `sideEffect` makes every later exception an unknown outcome.
   * @param {string} stage - Short name of the stage, printed with `E_INTERNAL`.
   * @param {{ sideEffect?: boolean }} [options] - `sideEffect: true` when this stage may change a file, a ref or a remote.
   * @example progress.enter('write VERSION', { sideEffect: true })
   */
  enter(stage, { sideEffect = false } = {}) {
    this.stage = stage
    // Once a side effect may have happened it stays so: a later read-only stage does not make a retry safe again.
    if (sideEffect) this.sideEffectStarted = true
  }
}

/**
 * Runs a delivery command's `main` and maps its outcome to printed lines and an exit code under the common contract.
 *
 * Why: the four commands (`bump-version.mjs`, `qa-candidate.mjs`, `merge-pr.mjs`, `post-trial-evidence.mjs`) share one refusal format, one redaction rule and one `E_INTERNAL` rule, so each script's entry point is one call.
 * Called at the end of each command script (`if (isRunAsScript(import.meta.url)) process.exitCode = await runCommandLine(main)`), and by tests with injected `print` and `environment`.
 *
 * - `main` returns its exit code (a value of {@link EXIT}); a returned non-integer counts as an internal error.
 * - A thrown {@link CommandRefusal} prints {@link formatRefusal}'s lines to stderr and returns its `exitCode`.
 * - Any other exception prints `E_INTERNAL: <message>`, `Stage: <stage>`, the stack and a `Fix:` line, all redacted, and returns {@link EXIT.FAILED} before any side effect or {@link EXIT.UNKNOWN} after one.
 *
 * @param {(progress: CommandProgress) => Promise<number>} main - The command; it calls `progress.enter` before each stage.
 * @param {{ printError?: (line: string) => void, environment?: NodeJS.ProcessEnv }} [options] - `printError`: where diagnostics go (default stderr); `environment`: secret values to redact.
 * @returns {Promise<number>} The exit code.
 * @example
 * ```js
 * process.exitCode = await runCommandLine(async (progress) => {
 *   progress.enter('read VERSION')
 *   return EXIT.DONE
 * })
 * ```
 */
export async function runCommandLine(
  main,
  {
    printError = (line) => console.error(line),
    environment = process.env,
  } = {},
) {
  const progress = new CommandProgress()
  try {
    const exitCode = await main(progress)
    if (Number.isInteger(exitCode)) return exitCode
    throw new Error(
      `the command returned ${String(exitCode)} instead of an exit code`,
    )
  } catch (error) {
    // A refusal is an expected outcome with its own code and fix.
    if (error instanceof CommandRefusal) {
      for (const line of formatRefusal(error, environment)) printError(line)
      return error.exitCode
    }
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error && error.stack ? error.stack : ''
    const fix = progress.sideEffectStarted
      ? 'check what changed before retrying; the stage above may have run partly'
      : 'nothing changed; fix the cause above, then rerun'
    const lines = [
      `E_INTERNAL: ${message}`,
      `Stage: ${progress.stage}`,
      // Frame lines only: a multi-line message must not repeat its continuation lines as frames.
      ...stack.split('\n').filter((line) => /^\s+at /.test(line)),
      `Fix: ${fix}`,
    ]
    for (const line of lines) printError(redactSecrets(line, environment))
    return progress.sideEffectStarted ? EXIT.UNKNOWN : EXIT.FAILED
  }
}
