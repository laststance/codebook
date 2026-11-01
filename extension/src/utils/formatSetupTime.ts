/** The optional zone and locale a setup time is written in; tests pin both. */
export type SetupTimeFormat = { timeZone?: string; locale?: string }

/**
 * Writes when a saved session was set up as a short date and time for the status item (X7).
 * Called only by {@link savedSessionStatusText}.
 * @param moment - An ISO time or epoch milliseconds.
 * @param format - The zone and locale; when left out, the extension host process's default time zone and ICU locale (from the system, not the editor's display language).
 * @returns For example `Nov 2, 12:10 PM`.
 * @example
 * formatSetupTime('2026-11-02T12:10:00.000Z', { timeZone: 'UTC', locale: 'en-US' }) // => 'Nov 2, 12:10 PM'
 */
export function formatSetupTime(
  moment: string | number,
  format: SetupTimeFormat = {},
): string {
  return new Intl.DateTimeFormat(format.locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: format.timeZone,
  }).format(new Date(moment))
}
