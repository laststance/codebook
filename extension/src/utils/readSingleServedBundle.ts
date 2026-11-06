import type { z } from 'zod'

import {
  SINGLE_BUNDLE_ERROR_BODY_LIMIT_BYTES,
  VITE_MODULE_FETCH_TIMEOUT_MS,
} from '../constants'
import { sha256 } from '../runtimeSupport/utils/sha256'
import type { SingleBundleProfile } from '../singleBundleProfile'

import { findSingleBundleUrl } from './findSingleBundleUrl'
import { readCappedBody } from './readCappedBody'
import { readErrorBodyHead } from './readErrorBodyHead'
import { servedMapSchema } from './readViteServedModule'

/** One parsed source map of the bundle. */
export type SingleServedMap = z.infer<typeof servedMapSchema>

/** The bundle a dev server served for one compile, with its parsed map. */
export type SingleServedBundle = {
  /** The bundle text exactly as served. */
  javascript: string
  /** SHA-256 of the bundle text: a recompile changes it. */
  bundleHash: string
  /** The address the bundle was read at. */
  bundleUrl: string
  map: SingleServedMap
}

/**
 * Keeps the bundle and map of the latest compile of one run, keyed by the bundle bytes' hash.
 *
 * Why it exists: the bundle and its map are megabytes, and every stop of a run is sealed from the same compile, so the map is read once per compile (E5). Held by the adapter per owned origin and dropped when the server closes.
 */
export class SingleBundleCache {
  /** The latest compile read, or `undefined` before the first read. */
  entry: SingleServedBundle | undefined
  /** The bundle's address the entry page named, kept once found. */
  bundleUrl: string | undefined
  /** How many source maps were fetched; a cache hit adds none. */
  mapReads = 0

  /** @param entryPath - The path the entry page is served at (`/` unless a `homepage` or `PUBLIC_URL` moves it). */
  constructor(readonly entryPath: string = '/') {}
}

/** What a server answered instead of the bundle or map: its status and the start of its body, which an adapter may read as the server's own error (Metro answers a failed build with an error response). */
export type SingleBundleErrorResponse = {
  status: number
  /** The first bytes of the body as text; `undefined` when it could not be read. */
  body: string | undefined
}

/** Thrown while the server answers no usable bundle yet (still compiling, connection refused): a caller polling for readiness tries again. `response` is set when the server answered with a non-success status. */
export class SingleBundleNotReadyError extends Error {
  /** @param message - What was not ready. @param response - The server's non-success answer, when there was one. */
  constructor(
    message: string,
    readonly response?: SingleBundleErrorResponse,
  ) {
    super(message)
  }
}

/** The steps of reading one bundle that a caller may report: the entry page named the bundle, the bundle text was read, the map was read. */
export type SingleBundleProgress = 'html' | 'bundle' | 'map'

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
 * Called by {@link readSingleServedBundle} for the bundle and for its map.
 * @param url - The address on the owned origin.
 * @param limitBytes - The most bytes the body may have.
 * @param profile - The adapter's profile, which words an unreadable body.
 * @param signal - Ends the read when the run is cancelled.
 * @param timeoutMs - The most the request and its body may take.
 * @returns The text, or `undefined` when it exceeds the cap.
 * @throws {@link SingleBundleNotReadyError} for a failed request, a redirect or a non-success status; an unreadable (non-UTF-8) body is the profile's `mapUnreadable` refusal.
 * @example await readServedText('http://127.0.0.1:3000/static/js/bundle.js', 8_388_608, profile, signal, 15_000) // => '(()=>{…})()'
 */
async function readServedText(
  url: string,
  limitBytes: number,
  profile: SingleBundleProfile,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string | undefined> {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  }).catch((error: unknown) => {
    // A cancelled run stays cancelled; any other failure means the server is not serving yet.
    signal.throwIfAborted()
    throw new SingleBundleNotReadyError(
      `the server did not answer ${url} (${error instanceof Error ? error.name : 'error'})`,
    )
  })
  if (!response.ok) {
    // Only a profile that quotes the server's error reads its body (its head, cut at the cap); the others cancel it unread, so a stalled body never holds the poll.
    const body =
      profile.quoteErrorBody === true
        ? await readErrorBodyHead(
            response,
            SINGLE_BUNDLE_ERROR_BODY_LIMIT_BYTES,
          )
        : undefined
    await response.body?.cancel().catch(() => undefined)
    throw new SingleBundleNotReadyError(
      `${url} answered status ${response.status}`,
      { status: response.status, body },
    )
  }
  return readCappedBody(response, limitBytes).catch((error: unknown) => {
    signal.throwIfAborted()
    // Only a fatal TextDecoder failure is a body that is not UTF-8; a timeout or reset mid-body means the server is not serving yet.
    if (isInvalidUtf8Error(error))
      throw profile.refusals.mapUnreadable(`${url} is not valid UTF-8`)
    throw new SingleBundleNotReadyError(
      `the body of ${url} could not be read (${error instanceof Error ? error.name : 'error'})`,
    )
  })
}

/**
 * Tells whether a `sourceMappingURL` value is an http(s) address once resolved against the bundle.
 * @param reference - The comment's value.
 * @param bundleUrl - The address the bundle was read at.
 * @returns `false` for `data:` and other schemes, or a value that is no URL.
 * @example isHttpReference('data:application/json;base64,e30=', 'http://h:1/a.js') // => false
 */
function isHttpReference(reference: string, bundleUrl: string): boolean {
  try {
    const { protocol } = new URL(reference, bundleUrl)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Finds the bundle's address on the entry page, or says why there is none.
 * @param origin - The owned origin.
 * @param entryPath - Where the entry page is served.
 * @param profile - The adapter's profile.
 * @param signal - Ends the read when the run is cancelled.
 * @param timeoutMs - The most the request may take.
 * @returns The bundle's address.
 * @throws {@link SingleBundleNotReadyError} while the page names no bundle yet, or with `response` when a quoting profile's server answered an error; the profile's `unclearEntryPage` refusal for a page naming zero or several bundles.
 * @example await entryBundleUrl('http://127.0.0.1:3000', '/', profile, signal, 15_000) // => 'http://127.0.0.1:3000/static/js/bundle.js'
 */
async function entryBundleUrl(
  origin: string,
  entryPath: string,
  profile: SingleBundleProfile,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string> {
  // The bundle's address is the one the entry page names, which a homepage, PUBLIC_URL or Metro's query decides.
  const found = await findSingleBundleUrl(
    origin,
    entryPath,
    profile,
    signal,
    timeoutMs,
  )
  if (found.kind === 'found') return found.url
  if (found.kind === 'failed')
    throw new SingleBundleNotReadyError(
      `the entry page at ${entryPath} answered status ${found.status}`,
      { status: found.status, body: found.body },
    )
  if (found.kind === 'unclear' && profile.unclearEntryPage !== undefined)
    throw profile.unclearEntryPage.refusal(found.count)
  throw new SingleBundleNotReadyError(
    `the entry page at ${entryPath} names no development bundle yet`,
  )
}

/** Finds the `sourceMappingURL` comment the bundle ends with. @example sourceMappingUrlOf('a();\n//# sourceMappingURL=bundle.js.map\n') // => 'bundle.js.map' */
function sourceMappingUrlOf(javascript: string): string | undefined {
  const matches = [
    ...javascript.matchAll(/^\/\/# sourceMappingURL=(\S+)\s*$/gm),
  ]
  return matches.at(-1)?.[1]
}

/**
 * Parses a served map's text into the flat version 3 map the seal reads.
 * @param mapText - The map as served.
 * @param profile - The adapter's profile, which words a map it cannot read.
 * @returns The parsed map.
 * @throws The profile's `mapUnreadable` refusal for text that is not JSON or not a flat version 3 map.
 * @example parseServedMap('{"version":3,"sources":["a"],"mappings":"AAAA"}', profile).version // => 3
 */
function parseServedMap(
  mapText: string,
  profile: SingleBundleProfile,
): SingleServedMap {
  let parsed: unknown
  try {
    parsed = JSON.parse(mapText)
  } catch {
    throw profile.refusals.mapUnreadable('the source map is not JSON')
  }
  const map = servedMapSchema.safeParse(parsed)
  if (!map.success)
    throw profile.refusals.mapUnreadable(
      'the source map is not a flat version 3 map',
    )
  return map.data
}

/**
 * Reads the bundle a dev server serves and, unless the cache holds this exact compile, its source map; the map is read once per compile.
 *
 * Why it exists: the first-compile readiness and every stop's seal need the same bundle and map, and a recompile (new bundle bytes) must replace what was read. Called by {@link awaitReactScriptsFirstCompile} and {@link sealSingleBundleStop} through each adapter's wrapper.
 * @param origin - The owned origin, `http://127.0.0.1:<port>`.
 * @param signal - Ends the read when the run is cancelled.
 * @param cache - The run's cache; a hit for the served bundle's hash returns its entry and fetches no map. Its `entryPath` says where the entry page is served.
 * @param profile - The adapter's profile: bundle selection, map address, limits and refusal wording.
 * @param deadlineAtMs - The `performance.now()` the caller's budget ends at; each request is bounded by what is left of it.
 * @param onProgress - Told when the entry page named the bundle, when the bundle was read and when the map was read, so a caller can journal the steps and their times.
 * @returns The served bundle and its parsed map.
 * @throws {@link SingleBundleNotReadyError} while the server does not serve the bundle or map; the profile's `mapLimit` (map over the profile's byte limit) and `mapUnreadable` (an oversized bundle, a missing or foreign `sourceMappingURL`, a map that is not a flat version 3 map) refusals.
 * @example const served = await readSingleServedBundle('http://127.0.0.1:3000', signal, cache, REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE)
 */
export async function readSingleServedBundle(
  origin: string,
  signal: AbortSignal,
  cache: SingleBundleCache,
  profile: SingleBundleProfile,
  deadlineAtMs?: number,
  onProgress?: (step: SingleBundleProgress) => void,
): Promise<SingleServedBundle> {
  const { limits, refusals } = profile
  const bundleUrl =
    cache.bundleUrl ??
    (await entryBundleUrl(
      origin,
      cache.entryPath,
      profile,
      signal,
      requestTimeoutMs(deadlineAtMs),
    ))
  cache.bundleUrl = bundleUrl
  onProgress?.('html')
  const javascript = await readServedText(
    bundleUrl,
    limits.bundleBytes,
    profile,
    signal,
    requestTimeoutMs(deadlineAtMs),
  )
  if (javascript === undefined)
    throw refusals.mapUnreadable(
      `the bundle exceeds ${limits.bundleBytes} bytes`,
    )
  onProgress?.('bundle')
  const bundleHash = sha256(javascript)
  // The same bytes are the same compile: its map is already read.
  if (cache.entry?.bundleHash === bundleHash) return cache.entry
  const reference = sourceMappingUrlOf(javascript)
  if (reference === undefined)
    throw refusals.mapUnreadable(
      'the bundle names no source map (no sourceMappingURL comment)',
    )
  // A reference that is not an http(s) address (an inline `data:` map) is refused now, not waited for.
  if (!isHttpReference(reference, bundleUrl))
    throw refusals.mapUnreadable(
      'the bundle names a source map that is not an http(s) address',
    )
  const mapUrl = profile.resolveMapUrl(reference, bundleUrl, origin)
  // Only the owned origin is ever fetched, whatever the profile returned.
  if (mapUrl === undefined || mapUrl.origin !== new URL(origin).origin)
    throw refusals.mapUnreadable(
      'the bundle names a source map on another origin',
    )
  cache.mapReads += 1
  const mapText = await readServedText(
    mapUrl.href,
    limits.mapBytes,
    profile,
    signal,
    requestTimeoutMs(deadlineAtMs),
  )
  if (mapText === undefined)
    throw refusals.mapLimit('map-bytes', limits.mapBytes)
  const map = parseServedMap(mapText, profile)
  onProgress?.('map')
  cache.entry = { javascript, bundleHash, bundleUrl, map }
  return cache.entry
}
