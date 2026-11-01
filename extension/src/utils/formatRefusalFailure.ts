import type { SignInRequiredReason } from '../constants'
import type { NextSetupDeadlineVariant } from '../nextRefusals'

import type { RefusalFailureCode } from './refusalFailureOf'

/**
 * Writes a run's coded failure text, the form {@link refusalFailureOf} restores: `<CODE>: <message>`, or `<CODE>(<variant>): <message>` for the two codes that carry a variant.
 *
 * - `NEXT_SETUP_DEADLINE(<variant>)`: the deadline's variant chooses its static recovery (`recoveryOverride`).
 * - `SIGN_IN_REQUIRED(<reason>)`: the sign-in reason, which {@link refusalFailureOf} restores as `details.reason`.
 *
 * Why it exists: a failure raised by a timer or an event has no thrown error to carry its code, so the run records this text and the service restores the code, the message and the variant from it. Called by {@link ConfiguredBrowserRun} for a Pages setup deadline, a sealed module replaced during a run, a Pages path left before the click and a sign-in page met before the first operation, and by {@link operationRefusalText} for an operation's refusal (a sign-in page met after an operation included).
 * @param code - The refusal code the text leads with.
 * @param message - The failure's sentence, which carries the dynamic values (paths, the step, the budget); the service sanitizes it.
 * @param variant - The deadline's variant, from {@link nextSetupDeadlineVariantOf}, or the sign-in reason, one of {@link SIGN_IN_REQUIRED_REASONS}; absent for every other code.
 * @returns The failure text.
 * @example
 * formatRefusalFailure('NEXT_SETUP_DEADLINE', 'Repository setup deadline (90 s) exceeded while loading the entry page. …', 'browser-opened')
 * // => 'NEXT_SETUP_DEADLINE(browser-opened): Repository setup deadline (90 s) exceeded while loading the entry page. …'
 * formatRefusalFailure('SIGN_IN_REQUIRED', 'The app asked for sign-in at /login. …', 'redirected-to-sign-in')
 * // => 'SIGN_IN_REQUIRED(redirected-to-sign-in): The app asked for sign-in at /login. …'
 * formatRefusalFailure('SOURCE_CHANGED', 'src/pages/index.tsx changed during the run, so Codebook stopped it.')
 * // => 'SOURCE_CHANGED: src/pages/index.tsx changed during the run, so Codebook stopped it.'
 */
export function formatRefusalFailure(
  code: 'NEXT_SETUP_DEADLINE',
  message: string,
  variant: NextSetupDeadlineVariant,
): string
export function formatRefusalFailure(
  code: 'SIGN_IN_REQUIRED',
  message: string,
  variant: SignInRequiredReason,
): string
export function formatRefusalFailure(
  code: RefusalFailureCode,
  message: string,
): string
export function formatRefusalFailure(
  code: RefusalFailureCode,
  message: string,
  variant?: NextSetupDeadlineVariant | SignInRequiredReason,
): string {
  return variant === undefined
    ? `${code}: ${message}`
    : `${code}(${variant}): ${message}`
}
