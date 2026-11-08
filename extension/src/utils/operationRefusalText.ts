import type { OperationRefusal } from '../configuredOperations'
import { SIGN_IN_REQUIRED_REASONS } from '../constants'
import type { SignInRequiredReason } from '../constants'

import { formatRefusalFailure } from './formatRefusalFailure'

/**
 * Tells whether a refusal's reason is one of the sign-in reasons, so a press reason is never written as one.
 *
 * Why it exists: {@link OperationRefusal} types its reason as a sign-in or a press reason; only the sign-in ones may become the variant of a `SIGN_IN_REQUIRED` text. Called by {@link operationRefusalText}.
 * @param reason - The refusal's reason.
 * @returns `true` when the reason is listed in {@link SIGN_IN_REQUIRED_REASONS}.
 * @example isSignInRequiredReason('no-saved-session') // => true
 */
function isSignInRequiredReason(
  reason: OperationRefusal['reason'],
): reason is SignInRequiredReason {
  // Compare element-wise: `includes` on the literal tuple would reject the wider reason type
  return SIGN_IN_REQUIRED_REASONS.some(
    (signInReason) => signInReason === reason,
  )
}

/**
 * Writes the coded failure text of an operation's refusal, the form the service restores into a coded error.
 *
 * Why it exists: `SIGN_IN_REQUIRED` carries its reason as the text's variant, so the reason survives the text; every other refusal leads with its code alone. Called by {@link ConfiguredBrowserRun} wherever a refusal fails the run.
 * @param refusal - The refusal.
 * @returns `<CODE>: <message>`, or `SIGN_IN_REQUIRED(<reason>): <message>` for a sign-in refusal that has a reason.
 * @example
 * operationRefusalText(new OperationRefusal('OPTION_NOT_AVAILABLE', 'No option', { operationIndex: 1 })) // => 'OPTION_NOT_AVAILABLE: No option'
 */
export function operationRefusalText(refusal: OperationRefusal): string {
  // Only a listed sign-in reason becomes the variant; a press reason on a sign-in refusal leaves the code alone
  return refusal.code === 'SIGN_IN_REQUIRED' &&
    isSignInRequiredReason(refusal.reason)
    ? formatRefusalFailure('SIGN_IN_REQUIRED', refusal.message, refusal.reason)
    : formatRefusalFailure(refusal.code, refusal.message)
}
