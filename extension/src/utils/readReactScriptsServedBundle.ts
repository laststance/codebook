import type { z } from 'zod'

import {
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
  REPOSITORY_MAP_LIMIT_BYTES,
  VITE_MODULE_FETCH_TIMEOUT_MS,
} from '../constants'
import {
  reactScriptsMapLimitRefusal,
  reactScriptsMapUnreadableRefusal,
} from '../reactScriptsRefusals'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { findReactScriptsBundleUrl } from './findReactScriptsBundleUrl'
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
  /** The bundle's address the entry page named, kept once found. */
  bundleUrl: string | undefined
  /** How many source maps were fetched; a cache hit adds none. */
  mapReads = 0

  /** @param publicPath - The path the app is served at (`/` unless a `homepage` or `PUBLIC_URL` moves it). */
  constructor(readonly publicPath: string = '/') {}
}

/** Thrown while the server answers no usable bundle yet (still compiling, connection refused): a caller polling for readiness tries again. */
export class ReactScriptsBundleNotReadyError extends Error {}

/** Tells a fatal TextDecoder failure from a transport failure. @example isInvalidUtf8Error(new TypeError('x')) // => false */
function isInvalidUtf8Error(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    'code' in error &&
    error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA'
  )
}

/**
 * Bounds one request by both the fetch limit and what is left of the caller's budget.
 * @param deadlineAtMs - The `performance.now()` the budget ends at, if the caller has one.
 * @returns The request's timeout in milliseconds, at least 1.
 * @example requestTimeoutMs(performance.now() + 200) // => about 200
 */
function requestTimeoutMs(deadlineAtMs: number | undefined): number {
  if (deadlineAtMs === undefined) return VITE_MODULE_FETCH_TIMEOUT_MS
  // AbortSignal.timeout takes whole milliseconds.
  return Math.max(
    1,
    Math.ceil(
      Math.min(VITE_MODULE_FETCH_TIMEOUT_MS, deadlineAtMs - performance.now()),
    ),
  )
}

/**
 * Reads one served text of the owned server, capped; a connection failure or a non-success status is "not ready", a text over the cap is `undefined`.
 * Called by {@link readReactScriptsServedBundle} for the bundle and for its map.
 * @param url - The address on the owned origin.
 * @param limitBytes - The most bytes the body may have.
 * @param signal - Ends the read when the run is cancelled.
 * @param timeoutMs - The most the request and its body may take.
 * @returns The text, or `undefined` when it exceeds the cap.
 * @throws {@link ReactScriptsBundleNotReadyError} for a failed request, a redirect or a non-success status; an unreadable (non-UTF-8) body is a coded refusal.
 * @example await readServedText('http://127.0.0.1:3000/static/js/bundle.js', 8_388_608, signal) // => '(()=>{…})()'
 */
async function readServedText(
  url: string,
  limitBytes: number,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string | undefined> {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
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
  return readCappedBody(response, limitBytes).catch((error: unknown) => {
    signal.throwIfAborted()
    // Only a fatal TextDecoder failure is a body that is not UTF-8; a timeout or reset mid-body means the server is not serving yet.
    if (isInvalidUtf8Error(error))
      throw reactScriptsMapUnreadableRefusal(`${url} is not valid UTF-8`)
    throw new ReactScriptsBundleNotReadyError(
      `the body of ${url} could not be read (${error instanceof Error ? error.name : 'error'})`,
    )
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
 * @param cache - The run's cache; a hit for the served bundle's hash returns its entry and fetches no map. Its `publicPath` says where the entry page is served.
 * @param deadlineAtMs - The `performance.now()` the caller's budget ends at; each request is bounded by what is left of it.
 * @returns The served bundle and its parsed map.
 * @throws {@link ReactScriptsBundleNotReadyError} while the server does not serve the bundle or map; `REACT_SCRIPTS_SEAL_FAILED` (`map-limit` over the map byte limit, `map-unreadable` for an oversized bundle, a missing or foreign `sourceMappingURL` or a map that is not a flat version 3 map).
 * @example const served = await readReactScriptsServedBundle('http://127.0.0.1:3000', signal, cache)
 */
export async function readReactScriptsServedBundle(
  origin: string,
  signal: AbortSignal,
  cache: ReactScriptsBundleCache,
  deadlineAtMs?: number,
): Promise<ReactScriptsServedBundle> {
  // The bundle's address is the one the entry page names, which a homepage or PUBLIC_URL moves.
  const bundleUrl =
    cache.bundleUrl ??
    (await findReactScriptsBundleUrl(
      origin,
      cache.publicPath,
      signal,
      requestTimeoutMs(deadlineAtMs),
    ))
  if (bundleUrl === undefined)
    throw new ReactScriptsBundleNotReadyError(
      `the entry page at ${cache.publicPath} names no development bundle yet`,
    )
  cache.bundleUrl = bundleUrl
  const javascript = await readServedText(
    bundleUrl,
    REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
    signal,
    requestTimeoutMs(deadlineAtMs),
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
    requestTimeoutMs(deadlineAtMs),
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
