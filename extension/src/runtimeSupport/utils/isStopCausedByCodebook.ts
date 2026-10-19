/**
 * Says whether a debugger stop was caused by a live run of Codebook, decided by the run when it reads the adapter's `stopped` event.
 * A stop is Codebook's while the run's causal window is open for its session (an input, a continuation or the run's own resume is in flight), except an adapter refresh of a pause the run already holds, which no run request caused. A page pause at a server stop's breakpoint that the run resumes itself is Codebook's whatever the window says.
 * Called by the configured run's `stopped` handler before it records the stop in {@link CodebookStopLedger}.
 *
 * @param causes - What the run knows about the stop when it reads it.
 * @param causes.windowOpen - Whether the causal window of the stop's session is open.
 * @param causes.isAdapterRefresh - Whether the adapter re-announced a pause the run already holds (`continued` then `stopped` with no request of the run's).
 * @param causes.isRunResumedPageStop - Whether the stop is a page pause at a server stop's breakpoint that the run resumes itself.
 * @returns
 * - `true` for a run-resumed page stop
 * - `true` for a stop inside an open window that is not an adapter refresh
 * - `false` for an adapter refresh, and for a stop outside any open window
 * @example
 * isStopCausedByCodebook({ windowOpen: true, isAdapterRefresh: false, isRunResumedPageStop: false }) // => true
 * isStopCausedByCodebook({ windowOpen: true, isAdapterRefresh: true, isRunResumedPageStop: false }) // => false
 */
export function isStopCausedByCodebook(causes: {
  windowOpen: boolean
  isAdapterRefresh: boolean
  isRunResumedPageStop: boolean
}): boolean {
  if (causes.isRunResumedPageStop) return true
  return causes.windowOpen && !causes.isAdapterRefresh
}
