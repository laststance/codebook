/**
 * Writes a moment as hours, minutes and seconds of the host's clock, for the ended extension view's `last captured view` header (ER22).
 * Called by {@link ChromeExtensionViewportView.end}.
 * @param moment - Epoch milliseconds.
 * @returns `hh:mm:ss` on a 24-hour clock, whatever the editor's display language.
 * @example formatCapturedTime(new Date(2026, 9, 29, 14, 3, 9).getTime()) // => '14:03:09'
 */
export function formatCapturedTime(moment: number): string {
  return new Date(moment).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}
