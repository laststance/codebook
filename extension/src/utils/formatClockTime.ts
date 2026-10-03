/**
 * Writes a moment as the learner's local hour and minute, the way the browser Wiki writes the times of an update.
 * Called by the extension for the update notifications and for the time a foreign candidate was written.
 * @param moment - ISO timestamp or epoch milliseconds.
 * @returns The local time as hour and minute, for example `21:10` (the separator and a day period follow the editor's locale).
 * @example
 * formatClockTime('2026-10-03T12:10:00.000Z') // => '21:10' in Asia/Tokyo
 * formatClockTime(1_790_000_000_000)          // => '13:13' in UTC
 */
export function formatClockTime(moment: string | number): string {
  return new Date(moment).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}
