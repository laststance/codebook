import { REACT_SCRIPTS_READINESS_POLL_MS } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  ReactScriptsBundleNotReadyError,
  readReactScriptsServedBundle,
  type ReactScriptsBundleCache,
} from './readReactScriptsServedBundle'

/**
 * Waits until react-scripts has finished its first compile: the entry page (at the app's public path) names the bundle, and the bundle and its map are read once.
 *
 * Why it exists: the origin line appears when the compile finishes, but a stop is sealed from the bundle and its map, so readiness is proven by reading them (DX-7). Called as the adapter's `waitForServerSettled` before the stops are sealed, inside the run's preparation deadline.
 * @param origin - The owned origin, `http://127.0.0.1:<port>`.
 * @param cache - The run's bundle cache, filled by the read here.
 * @param timeoutMs - What is left of the preparation budget.
 * @param signal - Ends the wait when the run is cancelled.
 * @throws {@link WaitTimeoutError} when the budget passes first (the run words it as `REACT_SCRIPTS_SETUP_DEADLINE`); `REACT_SCRIPTS_SEAL_FAILED` for a bundle or map this version cannot read.
 * @example await awaitReactScriptsFirstCompile('http://127.0.0.1:3000', cache, 60_000, signal)
 */
export async function awaitReactScriptsFirstCompile(
  origin: string,
  cache: ReactScriptsBundleCache,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  // Every request of a poll ends with the budget, so the wait cannot overshoot it by a request's own timeout.
  const deadlineAtMs = performance.now() + timeoutMs
  await waitUntil(
    async () => {
      try {
        await readReactScriptsServedBundle(origin, signal, cache, deadlineAtMs)
        return true
      } catch (error) {
        // A server that does not serve the bundle yet is polled again; any coded refusal is final.
        if (error instanceof ReactScriptsBundleNotReadyError) return false
        throw error
      }
    },
    'the first compile',
    timeoutMs,
    signal,
    REACT_SCRIPTS_READINESS_POLL_MS,
  )
}
