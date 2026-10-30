import { MILLISECONDS_PER_SECOND } from './constants'
import { StudyError, type ErrorCode } from './errors'

/**
 * The stable codes the `vite-dev` adapter refuses with, in the order of the groups of the agent-ready contract:
 * unsupported project (a), launcher failure (b), setup deadline (c), seal failure (d), reload after the click (e), busy port (f) and the misrouted adapter.
 * The help writer lists one anchor per entry; an unexpected internal failure (g) keeps the existing `RUNTIME_FAILED` path.
 */
export const VITE_REFUSAL_CODES = [
  'ADAPTER_MISROUTE',
  'VITE_UNSUPPORTED',
  'VITE_LAUNCHER_FAILED',
  'VITE_SETUP_DEADLINE',
  'VITE_SEAL_FAILED',
  'VITE_PAGE_RELOADED',
  'VITE_PORT_UNAVAILABLE',
] as const satisfies readonly ErrorCode[]

/** One code of {@link VITE_REFUSAL_CODES}. */
export type ViteRefusalCode = (typeof VITE_REFUSAL_CODES)[number]

/**
 * The help anchor of a refusal code: `codebook://help/repository-browser#<CODE>`.
 * @param code - A refusal code.
 * @returns The resource address with the code as its anchor.
 * @example
 * viteHelpAnchor('VITE_SEAL_FAILED') // => 'codebook://help/repository-browser#VITE_SEAL_FAILED'
 */
export function viteHelpAnchor(code: ViteRefusalCode): string {
  return `codebook://help/repository-browser#${code}`
}

/**
 * Builds the refusal an agent reads: a {@link StudyError} with the code's recovery.
 * @param code - The refusal code.
 * @param message - What was refused, naming the setting, token, file or value, ending with the fix or the limit.
 * @param cause - The redacted cause, when the message does not carry it.
 * @returns The error to throw.
 * @example
 * throw viteRefusal('VITE_UNSUPPORTED', 'Vite 7.1.0 is installed; Codebook supports Vite 8.')
 */
export function viteRefusal(
  code: ViteRefusalCode,
  message: string,
  cause = message,
): StudyError {
  return new StudyError(code, message, cause)
}

/**
 * Tells which Vite refusal code a run-failure text starts with, for the service that turns a failed run's reason into an error.
 * A failure raised by a timer (setup deadline, reload after the click) has no thrown error, so its text starts with `<CODE>: `.
 * @param text - A run's failure reason.
 * @returns The code and the text after it, or `undefined` for any other reason.
 * @example
 * viteFailureOf('VITE_PAGE_RELOADED: The page reloaded') // => { code: 'VITE_PAGE_RELOADED', message: 'The page reloaded' }
 */
export function viteFailureOf(
  text: string,
): { code: ViteRefusalCode; message: string } | undefined {
  for (const code of VITE_REFUSAL_CODES)
    if (text.startsWith(`${code}: `))
      return { code, message: text.slice(code.length + 2) }
  return undefined
}

/**
 * Words the setup-deadline failure of a Vite run, naming the step it reached.
 * @param step - The setup step reached (`resolving the Vite config`, `waiting for the server to answer the entry page`, `sealing the declared stops`, `opening the browser`).
 * @param limitMs - The setup budget that expired.
 * @returns The failure text, led by its code so the service can turn it into a coded error.
 * @example
 * viteSetupDeadlineText('sealing the declared stops', 90_000) // => 'VITE_SETUP_DEADLINE: Repository setup deadline (90 s) exceeded while sealing the declared stops. …'
 */
export function viteSetupDeadlineText(step: string, limitMs: number): string {
  return `VITE_SETUP_DEADLINE: Repository setup deadline (${Math.round(limitMs / MILLISECONDS_PER_SECOND)} s) exceeded while ${step}. First-run dependency pre-bundling can take long; the owned server was stopped and the browser was not opened, so start again once (the dependency cache is warm then).`
}

/**
 * Words the failure of a Vite run whose page loaded again after the inputs were written, led by its code.
 * @param clickSent - Whether the declared click had already been sent.
 * @returns The failure text; it says whether the click's result is unknown.
 * @example
 * viteReloadText(true) // => 'VITE_PAGE_RELOADED: The page reloaded after the click was sent, so the click's result is unknown. …'
 */
export function viteReloadText(clickSent: boolean): string {
  return clickSent
    ? "VITE_PAGE_RELOADED: The page reloaded after the click was sent, so the click's result is unknown. Do not send it again; read the run's captured history."
    : 'VITE_PAGE_RELOADED: The page reloaded after the initial inputs were written and before the click, so nothing was clicked and the page the stops were armed in is gone. Start a new run only if the learner asks.'
}
