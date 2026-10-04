/**
 * The failure of a bounded wait whose condition did not hold within its budget, thrown by {@link waitUntil}.
 * A caller that adds to the timeout what it last observed tells it from any other failure of its read by this type, never by comparing the message, so the wait may word its timeout as it likes. The name stays `Error`, so `String(error)` reads as before.
 * @example
 * try {
 *   await waitUntil(() => ready, 'page ready', 100)
 * } catch (error) {
 *   if (error instanceof WaitTimeoutError) String(error) // => 'Error: Timed out waiting for page ready'
 * }
 */
export class WaitTimeoutError extends Error {}
