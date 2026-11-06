import { REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE } from '../reactScriptsSingleBundleProfile'

import {
  readSingleServedBundle,
  SingleBundleCache,
  SingleBundleNotReadyError,
  type SingleServedBundle,
} from './readSingleServedBundle'

/** The bundle react-scripts served for one compile, with its parsed map. */
export type ReactScriptsServedBundle = SingleServedBundle

/** The run's bundle cache of a react-scripts server: one map read per compile ({@link SingleBundleCache}); its constructor takes the app's public path. */
export { SingleBundleCache as ReactScriptsBundleCache }

/** Thrown while the server answers no usable bundle yet (still compiling, connection refused): a caller polling for readiness tries again. It is {@link SingleBundleNotReadyError}, the one class the shared read throws. */
export { SingleBundleNotReadyError as ReactScriptsBundleNotReadyError }

/**
 * Reads the bundle react-scripts serves and, unless the cache holds this exact compile, its source map; the map is read once per compile.
 *
 * Why it exists: the first-compile readiness and every stop's seal need the same bundle and map, and a recompile (new bundle bytes) must replace what was read. Called by {@link awaitReactScriptsFirstCompile}; the seal ({@link sealReactScriptsStop}) reads through the shared {@link readSingleServedBundle} with the same profile.
 * @param origin - The owned origin, `http://127.0.0.1:<port>`.
 * @param signal - Ends the read when the run is cancelled.
 * @param cache - The run's cache; a hit for the served bundle's hash returns its entry and fetches no map.
 * @param deadlineAtMs - The `performance.now()` the caller's budget ends at; each request is bounded by what is left of it.
 * @returns The served bundle and its parsed map.
 * @throws {@link SingleBundleNotReadyError} while the server does not serve the bundle or map; `REACT_SCRIPTS_SEAL_FAILED` (`map-limit` over the map byte limit, `map-unreadable` for an oversized bundle, a missing or foreign `sourceMappingURL` or a map that is not a flat version 3 map).
 * @example const served = await readReactScriptsServedBundle('http://127.0.0.1:3000', signal, cache)
 */
export function readReactScriptsServedBundle(
  origin: string,
  signal: AbortSignal,
  cache: SingleBundleCache,
  deadlineAtMs?: number,
): Promise<ReactScriptsServedBundle> {
  return readSingleServedBundle(
    origin,
    signal,
    cache,
    REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE,
    deadlineAtMs,
  )
}
