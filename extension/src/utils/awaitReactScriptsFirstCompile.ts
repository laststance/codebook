import {
  REACT_SCRIPTS_BUNDLE_PATH,
  REACT_SCRIPTS_READINESS_POLL_MS,
  VITE_MODULE_FETCH_TIMEOUT_MS,
} from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  ReactScriptsBundleNotReadyError,
  readReactScriptsServedBundle,
  type ReactScriptsBundleCache,
} from './readReactScriptsServedBundle'

/**
 * Reads the entry page once and says whether it loads the development bundle.
 * @param origin - The owned origin.
 * @param signal - Ends the read when the run is cancelled.
 * @returns `true` when the page's HTML names {@link REACT_SCRIPTS_BUNDLE_PATH}; `false` for a failed request or another page.
 * @example await entryNamesBundle('http://127.0.0.1:3000', signal) // => true
 */
async function entryNamesBundle(
  origin: string,
  signal: AbortSignal,
): Promise<boolean> {
  const response = await fetch(origin, {
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(VITE_MODULE_FETCH_TIMEOUT_MS),
    ]),
  }).catch(() => {
    signal.throwIfAborted()
    return undefined
  })
  if (!response?.ok) {
    await response?.body?.cancel()
    return false
  }
  return (await response.text()).includes(REACT_SCRIPTS_BUNDLE_PATH)
}

/**
 * Waits until react-scripts has finished its first compile: the entry page loads the bundle, and the bundle and its map are read once.
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
  await waitUntil(
    async () => {
      if (!(await entryNamesBundle(origin, signal))) return false
      try {
        await readReactScriptsServedBundle(origin, signal, cache)
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
