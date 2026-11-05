import type { z } from 'zod'

import {
  REACT_SCRIPTS_BUNDLE_PATH,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
  REPOSITORY_MAP_LIMIT_BYTES,
  VITE_MODULE_FETCH_TIMEOUT_MS,
} from '../constants'
import {
  reactScriptsMapLimitRefusal,
  reactScriptsMapUnreadableRefusal,
} from '../reactScriptsRefusals'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { readCappedBody } from './readCappedBody'
import { servedMapSchema } from './readViteServedModule'

/** One parsed source map of the bundle. */
export type ReactScriptsServedMap = z.infer<typeof servedMapSchema>

/** The bundle react-scripts served for one compile, with its parsed map. */
export type ReactScriptsServedBundle = {
  /** The bundle text exactly as served. */
  javascript: string
  /** SHA-256 of the bundle text: a recompile changes it. */
  bundleHash: string
  /** The address the bundle was read at. */
  bundleUrl: string
  map: ReactScriptsServedMap
}

/**
 * Keeps the bundle and map of the latest compile of one run, keyed by the bundle bytes' hash.
 *
 * Why it exists: the bundle and its map are megabytes, and every stop of a run is sealed from the same compile, so the map is read once per compile (E5). Held by the adapter per owned origin and dropped when the server closes.
 */
export class ReactScriptsBundleCache {
  /** The latest compile read, or `undefined` before the first read. */
  entry: ReactScriptsServedBundle | undefined
  /** How many source maps were fetched; a cache hit adds none. */
  mapReads = 0
}

/** Thrown while the server answers no usable bundle yet (still compiling, connection refused): a caller polling for readiness tries again. */
export class ReactScriptsBundleNotReadyError extends Error {}

/**
 * Reads one served text of the owned server, capped; a connection failure or a non-success status is "not ready", a text over the cap is `undefined`.
 * Called by {@link readReactScriptsServedBundle} for the bundle and for its map.
 * @param url - The address on the owned origin.
 * @param limitBytes - The most bytes the body may have.
 * @param signal - Ends the read when the run is cancelled.
 * @returns The text, or `undefined` when it exceeds the cap.
 * @throws {@link ReactScriptsBundleNotReadyError} for a failed request, a redirect or a non-success status; an unreadable (non-UTF-8) body is a coded refusal.
 * @example await readServedText('http://127.0.0.1:3000/static/js/bundle.js', 8_388_608, signal) // => '(()=>{…})()'
 */
async function readServedText(
  url: string,
  limitBytes: number,
  signal: AbortSignal,
): Promise<string | undefined> {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(VITE_MODULE_FETCH_TIMEOUT_MS),
    ]),
  }).catch((error: unknown) => {
    // A cancelled run stays cancelled; any other failure means the server is not serving yet.
    signal.throwIfAborted()
    throw new ReactScriptsBundleNotReadyError(
      `the server did not answer ${url} (${error instanceof Error ? error.name : 'error'})`,
    )
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new ReactScriptsBundleNotReadyError(
      `${url} answered status ${response.status}`,
    )
  }
  return readCappedBody(response, limitBytes).catch(() => {
    signal.throwIfAborted()
    throw reactScriptsMapUnreadableRefusal(`${url} is not valid UTF-8`)
  })
}

/** Finds the `sourceMappingURL` comment the bundle ends with. @example sourceMappingUrlOf('a();\n//# sourceMappingURL=bundle.js.map\n') // => 'bundle.js.map' */
function sourceMappingUrlOf(javascript: string): string | undefined {
  const matches = [
    ...javascript.matchAll(/^\/\/# sourceMappingURL=(\S+)\s*$/gm),
  ]
  return matches.at(-1)?.[1]
}

/**
 * Reads the bundle react-scripts serves and, unless the cache holds this exact compile, its source map; the map is read once per compile.
 *
 * Why it exists: the first-compile readiness and every stop's seal need the same bundle and map, and a recompile (new bundle bytes) must replace what was read. Called by {@link awaitReactScriptsFirstCompile} and {@link sealReactScriptsStop}.
 * @param origin - The owned origin, `http://127.0.0.1:<port>`.
 * @param signal - Ends the read when the run is cancelled.
 * @param cache - The run's cache; a hit for the served bundle's hash returns its entry and fetches no map.
 * @returns The served bundle and its parsed map.
 * @throws {@link ReactScriptsBundleNotReadyError} while the server does not serve the bundle or map; `REACT_SCRIPTS_SEAL_FAILED` (`map-limit` over the map byte limit, `map-unreadable` for an oversized bundle, a missing or foreign `sourceMappingURL` or a map that is not a flat version 3 map).
 * @example const served = await readReactScriptsServedBundle('http://127.0.0.1:3000', signal, cache)
 */
export async function readReactScriptsServedBundle(
  origin: string,
  signal: AbortSignal,
  cache: ReactScriptsBundleCache,
): Promise<ReactScriptsServedBundle> {
  const bundleUrl = `${origin}${REACT_SCRIPTS_BUNDLE_PATH}`
  const javascript = await readServedText(
    bundleUrl,
    REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
    signal,
  )
  if (javascript === undefined)
    throw reactScriptsMapUnreadableRefusal(
      `the bundle exceeds ${REPOSITORY_JAVASCRIPT_LIMIT_BYTES} bytes`,
    )
  const bundleHash = sha256(javascript)
  // The same bytes are the same compile: its map is already read.
  if (cache.entry?.bundleHash === bundleHash) return cache.entry
  const reference = sourceMappingUrlOf(javascript)
  if (reference === undefined)
    throw reactScriptsMapUnreadableRefusal(
      'the bundle names no source map (no sourceMappingURL comment)',
    )
  const mapUrl = new URL(reference, bundleUrl)
  // Only the owned origin is ever fetched.
  if (mapUrl.origin !== new URL(origin).origin)
    throw reactScriptsMapUnreadableRefusal(
      'the bundle names a source map on another origin',
    )
  cache.mapReads += 1
  const mapText = await readServedText(
    mapUrl.href,
    REPOSITORY_MAP_LIMIT_BYTES,
    signal,
  )
  if (mapText === undefined) throw reactScriptsMapLimitRefusal('map-bytes')
  let parsed: unknown
  try {
    parsed = JSON.parse(mapText)
  } catch {
    throw reactScriptsMapUnreadableRefusal('the source map is not JSON')
  }
  const map = servedMapSchema.safeParse(parsed)
  if (!map.success)
    throw reactScriptsMapUnreadableRefusal(
      'the source map is not a flat version 3 map',
    )
  cache.entry = { javascript, bundleHash, bundleUrl, map: map.data }
  return cache.entry
}
