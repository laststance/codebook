import { realpath } from 'node:fs/promises'

import { REACT_SCRIPTS_SERVED_SCRIPTS_MAX } from '../constants'
import { reactScriptsServedScriptRefusal } from '../reactScriptsRefusals'
import { REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE } from '../reactScriptsSingleBundleProfile'

import { findSingleBundleUrl } from './findSingleBundleUrl'
import {
  readServedBundleAt,
  requestTimeoutMs,
  SingleBundleCache,
  SingleBundleNotReadyError,
  type SingleServedBundle,
} from './readSingleServedBundle'

/** Thrown while the server answers no usable script yet (still compiling, connection refused, HTML in place of JavaScript): a caller polling for readiness tries again. It is {@link SingleBundleNotReadyError}, the one class the shared read throws. */
export { SingleBundleNotReadyError as ReactScriptsBundleNotReadyError }

/**
 * The run's cache of a react-scripts server: one cache per served script, so a map is read once per compile of that script.
 *
 * Why it exists: react-scripts 4 serves a runtime and chunks, so one {@link SingleBundleCache} entry is not enough. `entry` keeps the first script that has a map, `mapReads` counts the map reads of all scripts, and {@link forgetEntries} drops them all. Created by the react-scripts adapter per started server.
 */
export class ReactScriptsBundleCache extends SingleBundleCache {
  /** The entry page's eligible script addresses, kept once every one of them was read. */
  scriptUrls: string[] | undefined
  /** The cache of each script, by address. */
  readonly scriptCaches = new Map<string, SingleBundleCache>()
  /** The real path of {@link appRoot}, resolved once. */
  realAppRoot: string | undefined

  /**
   * @param entryPath - The path the entry page is served at.
   * @param appRoot - The app's folder; when set, readiness also needs a map that names a file below it.
   */
  constructor(
    entryPath: string = '/',
    readonly appRoot?: string,
  ) {
    super(entryPath)
  }

  /** Gives the cache of one script, made on first use. @example cache.scriptCacheOf('http://127.0.0.1:3000/static/js/main.chunk.js').mapReads // => 0 */
  scriptCacheOf(url: string): SingleBundleCache {
    const existing = this.scriptCaches.get(url)
    if (existing) return existing
    const created = new SingleBundleCache(this.entryPath)
    this.scriptCaches.set(url, created)
    return created
  }

  /** Counts the map reads of all scripts into {@link mapReads}. */
  recountMapReads(): void {
    this.mapReads = [...this.scriptCaches.values()].reduce(
      (total, scriptCache) => total + scriptCache.mapReads,
      0,
    )
  }

  override forgetEntries(): void {
    super.forgetEntries()
    for (const scriptCache of this.scriptCaches.values())
      scriptCache.forgetEntries()
  }
}

/**
 * Reads the `<script src>` addresses of the entry page that lie on the owned origin, in document order.
 * @param origin - The owned origin.
 * @param signal - Ends the read when the run is cancelled.
 * @param cache - The run's cache; its `entryPath` says where the entry page is served.
 * @param deadlineAtMs - The `performance.now()` the caller's budget ends at.
 * @returns The distinct script addresses, at least one and at most {@link REACT_SCRIPTS_SERVED_SCRIPTS_MAX}.
 * @throws {@link SingleBundleNotReadyError} while the page is not served or names no eligible script; `REACT_SCRIPTS_SEAL_FAILED` (`too-many-scripts`) for more than the allowed number.
 * @example await eligibleScriptUrls('http://127.0.0.1:3000', signal, cache, undefined) // => ['http://127.0.0.1:3000/static/js/bundle.js']
 */
async function eligibleScriptUrls(
  origin: string,
  signal: AbortSignal,
  cache: ReactScriptsBundleCache,
  deadlineAtMs: number | undefined,
): Promise<string[]> {
  if (cache.scriptUrls) return cache.scriptUrls
  const named: string[] = []
  // The shared page read hands its lazy list of script addresses to the selector; this one keeps every address.
  await findSingleBundleUrl(
    origin,
    cache.entryPath,
    {
      ...REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE,
      selectBundleScript(scripts) {
        for (const script of scripts) named.push(script.href)
        return undefined
      },
    },
    signal,
    requestTimeoutMs(deadlineAtMs),
  )
  const urls = [...new Set(named)]
  if (urls.length === 0)
    throw new SingleBundleNotReadyError(
      `the entry page at ${cache.entryPath} names no script yet`,
    )
  if (urls.length > REACT_SCRIPTS_SERVED_SCRIPTS_MAX)
    throw reactScriptsServedScriptRefusal(
      'too-many-scripts',
      `${urls.length} scripts`,
    )
  return urls
}

/**
 * Tells whether any source of the served maps lies below the app's folder.
 * @param maps - The served scripts that have a map.
 * @param realAppRoot - The real path of the app's folder.
 * @returns `true` when a `sources` entry is a path below the folder.
 * @example mapsNameAppFile([served], '/repo/app') // => true when a source is '/repo/app/src/App.js'
 */
function mapsNameAppFile(
  maps: readonly SingleServedBundle[],
  realAppRoot: string,
): boolean {
  // Windows paths compare without case.
  const fold = (path: string): string =>
    process.platform === 'win32' ? path.toLowerCase() : path
  const prefix = fold(
    `${realAppRoot.replaceAll('\\', '/').replace(/\/$/, '')}/`,
  )
  return maps.some((served) =>
    served.map.sources.some((source) =>
      fold(source.replaceAll('\\', '/')).startsWith(prefix),
    ),
  )
}

/**
 * Reads the scripts react-scripts serves and, unless the cache holds the exact compile, their source maps.
 *
 * Why it exists: the first-compile readiness and every stop's seal need the served scripts and maps, and a recompile (new script bytes) must replace what was read. react-scripts 5 serves one `bundle.js` (the one-script case); react-scripts 4 serves a runtime and chunks. Called by {@link awaitReactScriptsFirstCompile}; the seal ({@link sealReactScriptsStop}) reads through it as well.
 * Ready means: the entry page names an eligible script, every eligible script answers JavaScript, and (when the cache knows the app's folder) a map names a file below it. A script without `sourceMappingURL` is skipped when the page names several scripts.
 * @param origin - The owned origin, `http://127.0.0.1:<port>`.
 * @param signal - Ends the read when the run is cancelled.
 * @param cache - The run's cache.
 * @param deadlineAtMs - The `performance.now()` the caller's budget ends at; each request is bounded by what is left of it.
 * @returns The served scripts that have a map, in page order.
 * @throws {@link SingleBundleNotReadyError} while the server does not serve every script and map; `REACT_SCRIPTS_SEAL_FAILED` (`script-off-origin`, `too-many-scripts`, `script-too-large`, `map-limit`, `map-unreadable`).
 * @example const served = await readReactScriptsServedBundle('http://127.0.0.1:3000', signal, cache)
 */
export async function readReactScriptsServedBundle(
  origin: string,
  signal: AbortSignal,
  cache: ReactScriptsBundleCache,
  deadlineAtMs?: number,
): Promise<SingleServedBundle[]> {
  const urls = await eligibleScriptUrls(origin, signal, cache, deadlineAtMs)
  const mapped: SingleServedBundle[] = []
  for (const url of urls) {
    // A runtime script has no map; with a single script that stays the refusal it always was.
    const served = await readServedBundleAt(
      url,
      origin,
      signal,
      cache.scriptCacheOf(url),
      REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE,
      deadlineAtMs,
      undefined,
      urls.length > 1,
    )
    if (served) mapped.push(served)
  }
  cache.recountMapReads()
  const [first] = mapped
  if (first === undefined)
    throw REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE.refusals.mapUnreadable(
      'no served script names a source map',
    )
  if (cache.appRoot !== undefined) {
    cache.realAppRoot ??= await realpath(cache.appRoot)
    if (!mapsNameAppFile(mapped, cache.realAppRoot))
      throw new SingleBundleNotReadyError(
        'no served map names a file below the app folder yet',
      )
  }
  cache.entry = first
  cache.scriptUrls = urls
  return mapped
}
