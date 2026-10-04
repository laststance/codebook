import { setTimeout as delay } from 'node:timers/promises'

import { POLL_INTERVAL_MS } from '../runtimeSupport/constants'

/**
 * Waits in one promise until a run shows its next state after a continuation was acknowledged, for {@link StudyService.continueToNextState}; the runtime offers no event to wait on, so the run's state is read again every {@link POLL_INTERVAL_MS}.
 * The wait has one end besides the state change: the caller's bound, read from the caller's clock before every sleep. It adds no timer to the run's own waits and deadlines.
 * @param readNextState - Reads what ended the run's current step: a value once the run committed its next pause, observed its result or ended; `undefined` while it still runs.
 * @param isPastBound - Tells whether the caller's absolute bound has passed.
 * @param signal - The request's cancellation; an abandoned request releases the wait at once.
 * @returns
 * - What `readNextState` answered, as soon as it answers a value
 * - `undefined` at the bound, and when the request was abandoned
 * @example
 * await waitForNextRunState(() => (runtime.view().status === 'completed' ? 'result' : undefined), () => Date.now() >= waitEndsAtMs, signal)
 */
export async function waitForNextRunState<NextState>(
  readNextState: () => NextState | undefined,
  isPastBound: () => boolean,
  signal?: AbortSignal,
): Promise<NextState | undefined> {
  // One loop is the whole wait: a state change, the bound or the abandoned request ends it.
  while (true) {
    const nextState = readNextState()
    if (nextState !== undefined || isPastBound() || signal?.aborted)
      return nextState
    try {
      await delay(POLL_INTERVAL_MS, undefined, { signal })
    } catch {
      // The sleep rejects only when the request was abandoned.
      return undefined
    }
  }
}
