/**
 * Formats a moment as the hour and minute of the extension host's clock, for the sentences the editor writes.
 *
 * Why: the editor words an update's ending with the same sentence as the page, which prints local hour and minute. A time the host writes into a reason is also read on the page, where a remote host in another time zone would contradict the page's own times; such a time names its zone.
 * Trigger: {@link wikiUpdateNotice} formats an ending's time with it (no zone, like the page), and the extension formats the times it writes into a refusal's reason (with the zone).
 *
 * @param moment - ISO timestamp or epoch milliseconds.
 * @param zone - Given when the time must name its zone; `timeZone` is the IANA zone to print in, the host's own when omitted.
 * @returns
 * - Without `zone`: hour and minute, for example `21:10`
 * - With `zone`: hour, minute and the zone's short name, for example `21:10 GMT+9`
 *
 * @example
 * ```ts
 * formatClockTime('2026-10-03T12:10:00.000Z')                              // => '21:10' in Asia/Tokyo
 * formatClockTime('2026-10-03T12:10:00.000Z', { timeZone: 'Asia/Tokyo' }) // => '21:10 GMT+9'
 * formatClockTime(1_790_000_000_000, {})                                   // => '13:13 UTC' on a host in UTC
 * ```
 */
export function formatClockTime(
  moment: string | number,
  zone?: { timeZone?: string },
): string {
  return new Date(moment).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    ...(zone ? { timeZoneName: 'short', timeZone: zone.timeZone } : {}),
  })
}
