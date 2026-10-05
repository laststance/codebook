/**
 * Words the timeout of a bounded wait, so {@link waitUntil} and a caller that adds what it last observed to that sentence begin with the same words.
 * Called by {@link waitUntil} when its budget has passed, and by {@link ConfiguredBrowserRun} for the timeout of declared DOM conditions.
 * @param description - What the wait waited for.
 * @returns The timeout sentence, without a period.
 * @example
 * waitTimeoutText('configured before conditions') // => 'Timed out waiting for configured before conditions'
 */
export function waitTimeoutText(description: string): string {
  return `Timed out waiting for ${description}`
}
