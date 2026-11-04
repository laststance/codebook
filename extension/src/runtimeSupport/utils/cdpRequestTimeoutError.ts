/**
 * The failure of a CDP request that got no answer within its bound, thrown by {@link Cdp} for every request; its message is the one every timed-out request always had, and the name stays `Error`, so `String(error)` reads as before.
 * Why it exists: a caller that can go on without the answer tells a request that timed out from one the browser refused or that failed by this type, never by comparing the message. {@link ConfiguredBrowserRun} reads it for a stop image the paused page does not deliver.
 * @example
 * try {
 *   await cdp.request('Page.captureScreenshot', { format: 'png' }, 3_000)
 * } catch (error) {
 *   if (error instanceof CdpRequestTimeoutError) String(error) // => 'Error: CDP Page.captureScreenshot timed out'
 * }
 */
export class CdpRequestTimeoutError extends Error {
  /**
   * Builds the failure for one request.
   * @param method - The CDP method that got no answer.
   * @example throw new CdpRequestTimeoutError('Page.captureScreenshot')
   */
  constructor(readonly method: string) {
    super(`CDP ${method} timed out`)
  }
}
