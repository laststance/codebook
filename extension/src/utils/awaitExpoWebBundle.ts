import { EXPO_WEB_READINESS_POLL_MS } from '../constants'
import {
  expoWebBundleFailedRefusal,
  expoWebExitedRefusal,
  type ExpoWebExit,
} from '../expoWebRefusals'
import { EXPO_WEB_SINGLE_BUNDLE_PROFILE } from '../expoWebSingleBundleProfile'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { expoWebBundlerLineOf } from './expoWebBundlerLineOf'
import {
  readSingleServedBundle,
  SingleBundleNotReadyError,
  type SingleBundleCache,
  type SingleBundleProgress,
} from './readSingleServedBundle'

/** What the readiness wait needs to know about the run besides the origin. */
export type ExpoWebBundleWatch = {
  /** Whether the Expo CLI process is still running. */
  isRunning: () => boolean
  /** How the process ended, for the exit refusal. */
  exitStatus: () => ExpoWebExit
  /** The run's mask for text the refusal quotes. */
  mask: (text: string) => string
  /** Told once per step of {@link SingleBundleProgress} the first time it is reached, with the milliseconds since the wait began. */
  onStep: (step: SingleBundleProgress, elapsedMs: number) => void
}

/**
 * Waits until Metro has served the web bundle and its source map: the entry page names exactly one web bundle, the bundle is read, then its map; the map parsed is ready (E-2).
 *
 * Why it exists: Metro prints its `Waiting on` line before it bundles, so readiness is proven by reading the bundle and map a stop is sealed from, not by the log. Metro answers a build it cannot finish with an error response, which is the bundle failure, and an Expo CLI that ends meanwhile is its exit. Called as the adapter's `waitForServerSettled`, inside the run's preparation deadline.
 * @param origin - The owned origin, `http://127.0.0.1:<port>`.
 * @param cache - The run's bundle cache, filled by the read here.
 * @param timeoutMs - What is left of the preparation budget.
 * @param signal - Ends the wait when the run is cancelled.
 * @param watch - The process state and the step reporting.
 * @throws {@link WaitTimeoutError} when the budget passes first (the run words it as `EXPO_WEB_SETUP_DEADLINE`); `EXPO_WEB_LAUNCHER_FAILED` (`bundle-failed` for a Metro error response, `exited` when the CLI ended); `EXPO_WEB_SEAL_FAILED` for a bundle or map this version cannot read.
 * @example await awaitExpoWebBundle('http://127.0.0.1:4101', cache, 90_000, signal, watch)
 */
export async function awaitExpoWebBundle(
  origin: string,
  cache: SingleBundleCache,
  timeoutMs: number,
  signal: AbortSignal,
  watch: ExpoWebBundleWatch,
): Promise<void> {
  const startedAtMs = performance.now()
  // Every request of a poll ends with the budget, so the wait cannot overshoot it by a request's own timeout.
  const deadlineAtMs = startedAtMs + timeoutMs
  const reported = new Set<SingleBundleProgress>()
  const report = (step: SingleBundleProgress): void => {
    // A retried poll reaches the same step again; only the first time is reported.
    if (reported.has(step)) return
    reported.add(step)
    watch.onStep(step, Math.round(performance.now() - startedAtMs))
  }
  await waitUntil(
    async () => {
      try {
        await readSingleServedBundle(
          origin,
          signal,
          cache,
          EXPO_WEB_SINGLE_BUNDLE_PROFILE,
          deadlineAtMs,
          report,
        )
        return true
      } catch (error) {
        // Any coded refusal is final; only a server that does not serve yet is polled again.
        if (!(error instanceof SingleBundleNotReadyError)) throw error
        // A non-success answer for the bundle or map is Metro's own error: the build failed.
        if (error.response !== undefined)
          throw expoWebBundleFailedRefusal(
            expoWebBundlerLineOf(error.response, watch.mask),
          )
        if (!watch.isRunning()) throw expoWebExitedRefusal(watch.exitStatus())
        return false
      }
    },
    'the first Metro bundle',
    timeoutMs,
    signal,
    EXPO_WEB_READINESS_POLL_MS,
  )
}
