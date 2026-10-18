/**
 * Ends a text with exactly one period before a sentence follows it; {@link withUnannouncedPauses} and {@link ConfiguredBrowserRun} call it when they add a sentence to a deadline's failure text, which ends with or without a period, {@link deepWikiOpenFailureNotice} when it adds the next step to an Open DeepWiki failure's reason, and {@link folderChangeCleanupNotice} when it adds a sentence to the message of a cleanup that failed.
 * @param text - The text a sentence is added to.
 * @returns The text itself when it ends with a period, otherwise the text and a period.
 * @example
 * withFinalPeriod('timed out')  // => 'timed out.'
 * withFinalPeriod('timed out.') // => 'timed out.'
 */
export function withFinalPeriod(text: string): string {
  return text.endsWith('.') ? text : `${text}.`
}
