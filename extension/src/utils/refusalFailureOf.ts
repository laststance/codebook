import {
  SIGN_IN_REQUIRED_REASONS,
  type SignInRequiredReason,
} from '../constants'
import { PACKAGE_ROOT_FRESH_SESSION_RECOVERY, type ErrorCode } from '../errors'
import {
  NEXT_PAGES_FAILURE_VARIANT,
  NEXT_REFUSAL_CODES,
  nextSetupDeadlineRecovery,
  PAGES_STOP_REFUSAL_DETAILS,
} from '../nextRefusals'
import { viteFailureOf, type ViteRefusalCode } from '../viteRefusals'

/** The codes a run's failure text can lead with besides the Vite ones: every Next Pages refusal, a source change found during a run (a Fast Refresh of a sealed module) and a secret control that stopped being a safe password control. */
const CODED_FAILURE_CODES = [
  ...NEXT_REFUSAL_CODES,
  'SOURCE_CHANGED',
  // The failures of one operation of a version 3 run, raised by timers and events after the action's receipt.
  'OPTION_NOT_AVAILABLE',
  'INPUT_NOT_ACCEPTED',
  'CONTROL_KIND_NOT_SUPPORTED',
  'SECRET_INPUT_FROM_CHAT',
  'SECRET_INPUT_VISIBLE',
  'NAVIGATION_BEFORE_LAST_OPERATION',
  'NAVIGATION_NOT_SETTLED',
  'OPERATION_AFTER_NOT_MET',
  'RUN_FAILED_UNEXPECTEDLY',
  'SECRET_BECAME_VISIBLE',
  // The page asked for sign-in; the variant names why (SIGN_IN_REQUIRED_REASONS).
  'SIGN_IN_REQUIRED',
  // A server-render stop the page never reached, and an entry page that did not load after the last pause (Cycle 0071).
  'SERVER_STOP_NOT_REACHED',
  'ENTRY_LOAD_TIMEOUT',
] as const satisfies readonly ErrorCode[]

/** A code a run's failure text can lead with, so the service restores it as a coded error. */
export type RefusalFailureCode =
  ViteRefusalCode | (typeof CODED_FAILURE_CODES)[number]

/** A refusal restored from a run's failure text: its code, the text after the lead, and the static recovery its variant selects. */
export type RefusalFailure = {
  code: RefusalFailureCode
  message: string
  /** Present only for a known variant of a code that has variants (`NEXT_SETUP_DEADLINE`, and `SIGN_IN_REQUIRED` led by `package-root-fresh-session`). */
  recoveryOverride?: string
  /** Present only for `SIGN_IN_REQUIRED` led by a known reason: the fields the agent reads as `details.reason`. */
  details?: { reason: SignInRequiredReason }
  /** Present only for `NEXT_ENTRY_REDIRECTED` led by the `pages` variant ({@link NEXT_PAGES_FAILURE_VARIANT}): the fields of a Pages entry refusal after the readiness request, which the agent reads as `details`. */
  pagesDetails?: typeof PAGES_STOP_REFUSAL_DETAILS
}

/** The lead of a coded failure text: `<CODE>: ` or `<CODE>(<variant>): `; a variant holds no parenthesis and no line break. */
const CODED_FAILURE_LEAD = /^([A-Z][A-Z_]*)(?:\(([^()\n]*)\))?: /

/**
 * Restores the refusal a run's failure text leads with, for the service that turns a failed run's reason into the error an agent reads.
 *
 * Why it exists: a failure raised by a timer or an event (a setup deadline, a reload after the click, a Fast Refresh of a sealed module) has no thrown error, so the run records `<CODE>: <message>` or `<CODE>(<variant>): <message>` ({@link formatRefusalFailure}), and the code, its recovery and its help anchor must survive that text. Called by {@link StudyService.runtimeFailureError} and {@link StudyService.preparationError}.
 * Vite codes are read by {@link viteFailureOf}, exactly as before; every `NEXT_*` code and `SOURCE_CHANGED` are read here. Only a known `NEXT_SETUP_DEADLINE` variant selects a static recovery override; an unknown variant restores the code with its general recovery. A `NEXT_ENTRY_REDIRECTED` led by the `pages` variant restores {@link PAGES_STOP_REFUSAL_DETAILS}, which a Pages redirect found by a timer or an event would otherwise lose.
 * @param text - A run's failure reason.
 * @returns
 * - `{ code, message }` for a text led by a Vite code, a Next code or `SOURCE_CHANGED`
 * - `{ code, message, recoveryOverride }` for a `NEXT_SETUP_DEADLINE` led by a known variant
 * - `{ code, message, pagesDetails }` for a `NEXT_ENTRY_REDIRECTED` led by the `pages` variant
 * - `undefined` for any other text
 * @example
 * refusalFailureOf('VITE_PAGE_RELOADED: The page reloaded') // => { code: 'VITE_PAGE_RELOADED', message: 'The page reloaded' }
 * refusalFailureOf('NEXT_SETUP_DEADLINE(router-late): Repository setup deadline (90 s) exceeded …') // => { code: 'NEXT_SETUP_DEADLINE', message: 'Repository setup deadline (90 s) exceeded …', recoveryOverride: 'Start once more with a new key … See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.' }
 * refusalFailureOf('NEXT_ENTRY_REDIRECTED(pages): The page left the entry path / for /login …') // => { code: 'NEXT_ENTRY_REDIRECTED', message: 'The page left the entry path / for /login …', pagesDetails: { router: 'pages', sideEffects: 'unknown' } }
 * refusalFailureOf('Repository setup deadline exceeded') // => undefined
 */
export function refusalFailureOf(text: string): RefusalFailure | undefined {
  const viteFailure = viteFailureOf(text)
  if (viteFailure) return viteFailure
  const lead = CODED_FAILURE_LEAD.exec(text)
  const code = CODED_FAILURE_CODES.find((known) => known === lead?.[1])
  if (!lead || !code) return undefined
  const message = text.slice(lead[0].length),
    variant = lead[2]
  // A sign-in refusal carries its reason as the variant; an unknown reason restores the code alone.
  if (code === 'SIGN_IN_REQUIRED') {
    const reason = SIGN_IN_REQUIRED_REASONS.find((known) => known === variant)
    if (reason === undefined) return { code, message }
    // A run of a package below the root has no saved session to set up: its own recovery replaces the setup one.
    return reason === 'package-root-fresh-session'
      ? {
          code,
          message,
          recoveryOverride: PACKAGE_ROOT_FRESH_SESSION_RECOVERY,
          details: { reason },
        }
      : { code, message, details: { reason } }
  }
  // A Pages entry redirect carries the Pages fields as its variant; any other variant restores the code alone.
  if (code === 'NEXT_ENTRY_REDIRECTED')
    return variant === NEXT_PAGES_FAILURE_VARIANT
      ? { code, message, pagesDetails: { ...PAGES_STOP_REFUSAL_DETAILS } }
      : { code, message }
  // Of the other codes only a deadline has variants, and only a known name selects its static recovery.
  const recoveryOverride =
    code === 'NEXT_SETUP_DEADLINE' && variant !== undefined
      ? nextSetupDeadlineRecovery(variant)
      : undefined
  return recoveryOverride === undefined
    ? { code, message }
    : { code, message, recoveryOverride }
}
