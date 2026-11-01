import type { OperationRefusal } from '../configuredOperations'

import { formatRefusalFailure } from './formatRefusalFailure'

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
  return refusal.code === 'SIGN_IN_REQUIRED' && refusal.reason !== undefined
    ? formatRefusalFailure('SIGN_IN_REQUIRED', refusal.message, refusal.reason)
    : formatRefusalFailure(refusal.code, refusal.message)
}
