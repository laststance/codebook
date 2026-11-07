import { realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { REPOSITORY_SOURCE_LIMIT_BYTES } from '../constants'
import type { BundleSource } from '../repositoryBundle'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import type {
  SingleBundleLibraryRoute,
  SingleBundleProfile,
} from '../singleBundleProfile'
import {
  DEFAULT_SOURCE_MAP_LIMITS,
  SOURCE_MAP_LIMIT_FIELD,
  type SourceMapLimitName,
  type SourceMapLimits,
} from '../sourceMapLimits'

import { readRepositoryBuildText } from './readRepositoryBuildText'
import {
  readSingleServedBundle,
  type SingleBundleCache,
} from './readSingleServedBundle'
import { sourceMapMappedPositions } from './sourceMapMappedPositions'

/** What {@link sealSingleBundleStop} needs. */
export type SingleBundleSealRequest = Readonly<{
  /** The app's folder (absolute); its real path is what the served map names sources below. */
  appRoot: string
  /** The app's canonical repository-relative folder, named in a refusal. */
  packageRootRelative: string
  /** The stop file's path below `appRoot`, forward slashes. */
  packageRelativePath: string
  /** The declared stop (repository-relative path, line and the accepted hash). */
  source: RepositoryConfiguration['source']
  /** The last line of the stop's citation. */
  citationEndLine: number
  /** The origin the ready server reported. */
  ownedOrigin: string
  signal: AbortSignal
  /** The run's bundle cache: one map read per compile. */
  cache: SingleBundleCache
}>

/**
 * Tells whether a read failed because the file or a folder above it does not exist.
 * @example isMissingFileError(Object.assign(new Error('x'), { code: 'ENOENT' })) // => true
 */
function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

/** An absolute local path: POSIX root or a Windows drive. */
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/])/

/**
 * Writes a path the way react-scripts names app sources in its map: resolved, forward slashes.
 * @example canonicalForwardSlashPath('/repo/app/../app/src/App.js') // => '/repo/app/src/App.js'
 */
function canonicalForwardSlashPath(path: string): string {
  return resolve(path).replaceAll('\\', '/')
}

/**
 * Tells whether one local `sources` entry of the served map names the stop file.
 *
 * Why it exists: Windows paths differ in drive-letter and folder case between the real path of the app and the path webpack wrote (`c:/` against `C:/`), so a win32 comparison ignores case; elsewhere paths are case-sensitive. Called by {@link sealSingleBundleStop} over every absolute entry.
 * @param entry - A local absolute `sources` entry.
 * @param stopPath - The stop file's canonical forward-slash path.
 * @param platform - The platform whose path rules apply; defaults to this process's.
 * @returns Whether both name the same file.
 * @example mapSourceNamesStop('c:/repo/App.js', 'C:/repo/App.js', 'win32') // => true
 */
export function mapSourceNamesStop(
  entry: string,
  stopPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const canonical = canonicalForwardSlashPath(entry)
  // Windows file names compare without case.
  return platform === 'win32'
    ? canonical.toLowerCase() === stopPath.toLowerCase()
    : canonical === stopPath
}

/**
 * Turns one entry of the served map's `sources` into a form the bundle verifier accepts: a local absolute path stays (forward slashes), anything else becomes a distinct `webpack-source:` address.
 * @param entry - A `sources` entry.
 * @returns The entry the sealed map holds.
 * @example normalizeMapSource('webpack/runtime/hot') // => 'webpack-source:///webpack/runtime/hot'
 */
function normalizeMapSource(entry: string): string {
  if (ABSOLUTE_PATH.test(entry)) return entry.replaceAll('\\', '/')
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(entry)) {
    try {
      return new URL(entry).href
    } catch {
      // Falls through to the opaque address below.
    }
  }
  return `webpack-source:///${encodeURI(entry.replace(/^\.?\/+/, ''))}`
}

/**
 * Names the scan limit a map walk that found nothing stopped at, by replaying the walk's three counters in its own order.
 *
 * Why it exists: {@link sourceMapMappedPositions} only says the scan was incomplete, and the `map-limit` refusal names the limit. Called by {@link sealSingleBundleStop}.
 * @param mappings - The map's `mappings` string.
 * @param limits - The limits the walk ran under.
 * @returns The first limit the walk of {@link walkSourceMapSegments} reaches.
 * @example scanLimitOf(';'.repeat(100_001), DEFAULT_SOURCE_MAP_LIMITS) // => 'mapped-generated-lines'
 */
function scanLimitOf(
  mappings: string,
  limits: SourceMapLimits,
): SourceMapLimitName {
  let segmentsRead = 0
  let generatedLinesRead = 1
  for (let cursor = 0; cursor <= mappings.length; cursor++) {
    if (cursor === limits.mappedScannedChars && cursor < mappings.length)
      return 'mapped-scanned-chars'
    const delimiter = mappings[cursor]
    // A segment ends at a comma, a semicolon or the end of the map.
    if (cursor !== mappings.length && delimiter !== ',' && delimiter !== ';')
      continue
    if (++segmentsRead > limits.mappedSegments)
      return 'mapped-position-segments'
    if (delimiter === ';' && ++generatedLinesRead > limits.mappedGeneratedLines)
      return 'mapped-generated-lines'
  }
  return 'mapped-position-segments'
}

/**
 * Finds the one `sources` entry of the served map that names the stop file.
 * @param served - The bundle and map read.
 * @param stopPath - The stop file's canonical path.
 * @param request - The seal request, for the refusal.
 * @param profile - The adapter's profile, which words the refusals.
 * @param library - Set for a library stop: also finds the packed copy's entry and words a missing one as `library-not-in-build`.
 * @returns The map, its normalized sources, the stop's index and the retained text.
 * @throws The profile's `notInEntryBundle` refusal unless the map names the file, and its `ambiguousSource` refusal when it names it more than once.
 * @example locateStop(served, '/app/src/App.js', request, profile).stopIndex // => 0
 */
function locateStop(
  served: Awaited<ReturnType<typeof readSingleServedBundle>>,
  stopPath: string,
  request: SingleBundleSealRequest,
  profile: SingleBundleProfile,
  library?: SingleBundleLibraryRoute,
) {
  const sources = served.map.sources.map(normalizeMapSource)
  // A library stop is named by the checked-out file or, when its packed copy was not byte-equal at compile time, by the packed copy.
  const packedPath =
    library &&
    canonicalForwardSlashPath(
      join(library.packedRoot, ...request.packageRelativePath.split('/')),
    )
  const matches = sources.flatMap((entry, index) =>
    ABSOLUTE_PATH.test(entry) &&
    (mapSourceNamesStop(entry, stopPath) ||
      (packedPath !== undefined && mapSourceNamesStop(entry, packedPath)))
      ? [index]
      : [],
  )
  // A map that does not name the file names another folder; one that names it twice leaves the executed copy unknown.
  if (matches.length === 0)
    throw library
      ? library.notInBuild()
      : profile.refusals.notInEntryBundle(request.packageRootRelative, [
          request.source.path,
        ])
  if (matches.length > 1)
    throw profile.refusals.ambiguousSource(request.source.path)
  const stopIndex = matches[0]!
  return {
    served,
    sources,
    stopIndex,
    retained: served.map.sourcesContent?.[stopIndex],
  }
}

/**
 * Reads the packed copy of a library stop file, or `undefined` when the packed copy has no such file.
 * @param packedRoot - The real path of the packed copy.
 * @param segments - The file's path below the package, split at slashes.
 * @param request - The seal request, for the signal.
 * @returns The packed text; `undefined` when the file does not exist.
 * @example await readPackedText('/private/node_modules/redux', ['src', 'a.ts'], request) // => 'export const a = 1\n'
 */
async function readPackedText(
  packedRoot: string,
  segments: readonly string[],
  request: SingleBundleSealRequest,
): Promise<string | undefined> {
  try {
    return await readRepositoryBuildText(
      packedRoot,
      join(packedRoot, ...segments),
      REPOSITORY_SOURCE_LIMIT_BYTES,
      request.signal,
    )
  } catch (error) {
    // An absent file (or absent folder) is the only "no packed copy"; any other failure is real.
    if (isMissingFileError(error)) return undefined
    throw error
  }
}

/**
 * Refuses a library file that differs from its packed copy, the text the build compiled.
 * @param library - The library route.
 * @param segments - The file's path below the package.
 * @param sourceText - The checked-out text.
 * @param request - The seal request, for the signal.
 * @throws The route's `buildStale` refusal; nothing when the packed copy equals the file or has no such file (that ends in not-in-build).
 * @example await assertNotStale(library, ['src', 'a.ts'], text, request)
 */
async function assertNotStale(
  library: SingleBundleLibraryRoute,
  segments: readonly string[],
  sourceText: string,
  request: SingleBundleSealRequest,
): Promise<void> {
  const packedText = await readPackedText(library.packedRoot, segments, request)
  if (packedText !== undefined && packedText !== sourceText)
    throw library.buildStale()
}

/**
 * Words the refusal for a stop whose map text is not the checked-out file: `SOURCE_CHANGED` for an app stop, the library's `no-sources-content` or `content-differs` for a library stop.
 * @param retained - The map's retained text for the stop, when it has one.
 * @param request - The seal request, for the stop's path.
 * @param profile - The adapter's profile.
 * @param library - The library route, when the stop lies in a library.
 * @returns The error to throw.
 * @example throw unvouchedTextRefusal(null, request, profile, library) // details.cause: 'no-sources-content'
 */
function unvouchedTextRefusal(
  retained: string | null | undefined,
  request: SingleBundleSealRequest,
  profile: SingleBundleProfile,
  library?: SingleBundleLibraryRoute,
) {
  if (!library) return profile.refusals.sourceChanged(request.source.path)
  return library.buildUnmapped(
    typeof retained === 'string' ? 'content-differs' : 'no-sources-content',
  )
}

/**
 * Seals one declared browser stop from the single bundle a dev server serves, before the browser opens.
 *
 * Why it exists: the executed bytes are checked against these served bytes before the click. The stop file must be named in the served map by the canonical path of the app (real root joined with the package-relative path), with retained text equal to the checked-out file. Called by each single-bundle adapter's `readBundle` once per stop ({@link sealReactScriptsStop}; the Expo adapter).
 * Only this stop's retained text is kept in the sealed map; the other sources keep their names so the map still locates the stop.
 * @param request - The app, the stop, the owned origin and the run's cache.
 * @param profile - The adapter's profile: refusal wording, limits, bundle selection and map address.
 * @param library - Set for a stop in the checked-out library: the checks run in order stale, not-in-build, unmapped and refuse with the library's own refusals instead of `SOURCE_CHANGED`; absent, the seal is byte-identical to an app stop's.
 * @returns The sealed bundle (served bytes unchanged) with the discovery measurements, and `limits` when the profile's limits are not today's defaults, so the run applies them to its verifier and source resources.
 * @throws The profile's refusals (`nodeModules`, `outsidePackage`, `notInEntryBundle`, `ambiguousSource`, `unmappedLine`, `mapLimit`, `mapUnreadable`); the profile's `sourceChanged` (`SOURCE_CHANGED`) when the file differs from the accepted article or from the compiled text.
 * @example
 * const { bundle } = await sealSingleBundleStop({ appRoot, packageRootRelative: '.', packageRelativePath: 'src/App.js', source, citationEndLine: 12, ownedOrigin, signal, cache }, REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE)
 */
export async function sealSingleBundleStop(
  request: SingleBundleSealRequest,
  profile: SingleBundleProfile,
  library?: SingleBundleLibraryRoute,
) {
  const { refusals, limits } = profile
  const started = performance.now()
  const { source, packageRelativePath } = request
  const segments = packageRelativePath.split('/')
  // A published package is not the checked-out library, wherever the app keeps it.
  if (segments.includes('node_modules'))
    throw refusals.nodeModules([source.path])
  // The seal runs after the owned server started, so its refusals say the server was stopped.
  if (segments.includes('..'))
    throw refusals.outsidePackage(request.packageRootRelative, [source.path])
  const realRoot = await realpath(request.appRoot)
  const sourceText = await readRepositoryBuildText(
    realRoot,
    join(realRoot, ...segments),
    REPOSITORY_SOURCE_LIMIT_BYTES,
    request.signal,
  )
  // A library file that differs from its packed copy was edited after the build; a missing packed copy cannot be stale and ends in not-in-build below.
  if (library) await assertNotStale(library, segments, sourceText, request)
  if (sha256(sourceText) !== source.hash)
    throw refusals.sourceChanged(source.path)
  const stopPath = canonicalForwardSlashPath(join(realRoot, ...segments))
  const mapReadsBefore = request.cache.mapReads
  let located = locateStop(
    await readSingleServedBundle(
      request.ownedOrigin,
      request.signal,
      request.cache,
      profile,
    ),
    stopPath,
    request,
    profile,
    library,
  )
  // The cache is keyed by the bundle bytes, which an edit can leave unchanged while the map differs: a cached map that disagrees with the checked-out file is read once more before the stop is refused.
  if (
    located.retained !== sourceText &&
    request.cache.mapReads === mapReadsBefore
  ) {
    request.cache.entry = undefined
    located = locateStop(
      await readSingleServedBundle(
        request.ownedOrigin,
        request.signal,
        request.cache,
        profile,
      ),
      stopPath,
      request,
      profile,
      library,
    )
  }
  if (located.retained !== sourceText)
    throw unvouchedTextRefusal(located.retained, request, profile, library)
  const { served, sources, stopIndex } = located
  const scan = sourceMapMappedPositions(
    served.map.mappings,
    stopIndex,
    source.line,
    request.citationEndLine,
    undefined,
    limits,
  )
  if (!scan.positions.length) {
    if (scan.complete)
      throw refusals.unmappedLine(
        source.path,
        source.line,
        request.citationEndLine,
      )
    // The scan stopped at a limit: name which one, with the profile's value of it.
    const reached = scanLimitOf(served.map.mappings, limits)
    throw refusals.mapLimit(reached, limits[SOURCE_MAP_LIMIT_FIELD[reached]])
  }
  const sourceMap = JSON.stringify({
    ...served.map,
    file: served.map.file ?? '',
    sourceRoot: '',
    sources,
    sourcesContent: sources.map((_, index) =>
      index === stopIndex ? sourceText : '',
    ),
  })
  if (Buffer.byteLength(sourceMap) > limits.mapBytes)
    throw refusals.mapLimit('map-bytes', limits.mapBytes)
  const bundle: BundleSource = {
    sourcePath: sources[stopIndex]!,
    mapSource: sources[stopIndex]!,
    scriptUrl: served.bundleUrl,
    source: sourceText,
    javascript: served.javascript,
    sourceMap,
    chunkPath: '',
    chunkHash: served.bundleHash,
  }
  return {
    bundle,
    discovery: {
      readBytes: Buffer.byteLength(served.javascript),
      durationMs: performance.now() - started,
      candidates: [served.bundleUrl],
      manifestHash: served.bundleHash,
    },
    // Only an adapter with its own limits names them; the others return what they always did.
    ...(limits === DEFAULT_SOURCE_MAP_LIMITS ? {} : { limits }),
  }
}
