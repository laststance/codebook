/** The three independent acknowledgements of one owned continuation. */
export interface ContinuationReceipts {
  /** The adapter answered the `continue` request. */
  response: boolean
  /** The adapter announced `continued` for the continued thread. */
  dap: boolean
  /** The runtime reported `Debugger.resumed`. */
  cdp: boolean
}

/**
 * Copies which acknowledgements a continuation in flight already has, so the run journal can say how far it was when another pause arrived.
 * Called by {@link ConfiguredBrowserRun} when it journals an observed pause.
 * @param continuation - The continuation in flight, or none.
 * @returns
 * - With a continuation: its three receipts at this moment
 * - Without one: `null`
 * @example
 * continuationReceipts({ response: true, dap: true, cdp: false }) // => { response: true, dap: true, cdp: false }
 * continuationReceipts(undefined)                                  // => null
 */
export function continuationReceipts(
  continuation: ContinuationReceipts | undefined,
): ContinuationReceipts | null {
  return continuation
    ? {
        response: continuation.response,
        dap: continuation.dap,
        cdp: continuation.cdp,
      }
    : null
}
