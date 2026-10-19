import { MS_PER_MINUTE } from '../constants'

import { formatClockTime } from './formatClockTime'

/**
 * Writes the moment a wait or a refusal ends as the clock time a sentence names: the first whole minute at or after that moment, with its zone.
 *
 * Why: a clock time names its minute only, so an end within a minute written as that minute would name a time at which a press is still refused, for up to 59 seconds, with the same time named again. The first whole minute at or after the end is a time at which the wait is over.
 * Trigger: {@link findUnacknowledgedWikiLeftover} names with it the end of a start's wait for an earlier chat ("waits for it until"), and {@link describeOtherWikiWindow} the end of the refusal beside a marker file that stays unreadable ("this refusal ends at").
 *
 * @param endsAtMs - The first moment (epoch milliseconds) at which the wait is over: a watch's end or a candidate's writing plus the bound, or the moment after the last one at which a marker file counts.
 * @returns The hour and minute, with the zone ({@link formatClockTime}), of the first whole minute at or after that moment; an end on a whole minute is named as itself.
 *
 * @example
 * ```ts
 * formatWaitEnd(Date.UTC(2026, 9, 3, 12, 23, 30)) // => '12:24 UTC' on a host in UTC
 * formatWaitEnd(Date.UTC(2026, 9, 3, 12, 23, 0)) // => '12:23 UTC' on a host in UTC
 * ```
 */
export function formatWaitEnd(endsAtMs: number): string {
  return formatClockTime(
    Math.ceil(endsAtMs / MS_PER_MINUTE) * MS_PER_MINUTE,
    {},
  )
}
