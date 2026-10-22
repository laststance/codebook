import { UI_CAUSE_MAX_CHARS } from '../constants'

import { cutTextToFit } from './cutTextToFit'

/**
 * Bounds a sanitized cause to what a tooltip, a notification, the run resource or an MCP message of the test replay shows, so a long adapter or file-system message never fills the learner's screen; the Output › Codebook entry keeps the whole cause. Called by {@link describeNodeLearningSave} and {@link StudyService} wherever a cause from {@link sanitizeCause} is shown.
 * @param cause - A cause {@link sanitizeCause} returned, or `undefined` for a run that has none.
 * @returns
 * - The cause itself when it has at most {@link UI_CAUSE_MAX_CHARS} characters (code points)
 * - Otherwise its beginning that fits with the cut marker
 * - `undefined` when there is no cause
 * @example
 * cutCauseForDisplay('ENOSPC: no space left on device') // => 'ENOSPC: no space left on device'
 * cutCauseForDisplay('x'.repeat(400)).length            // => 300 (293 characters and '… [cut]')
 * cutCauseForDisplay(undefined)                         // => undefined
 */
export function cutCauseForDisplay(cause: string): string
export function cutCauseForDisplay(
  cause: string | undefined,
): string | undefined
export function cutCauseForDisplay(
  cause: string | undefined,
): string | undefined {
  if (cause === undefined) return undefined
  return cutTextToFit(
    cause,
    (candidate) => Array.from(candidate).length <= UI_CAUSE_MAX_CHARS,
  )
}
