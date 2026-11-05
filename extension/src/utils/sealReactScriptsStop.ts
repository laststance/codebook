import { realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  REPOSITORY_MAP_LIMIT_BYTES,
  REPOSITORY_MAPPED_POSITION_MAX_GENERATED_LINES,
  REPOSITORY_MAPPED_POSITION_MAX_SCANNED_CHARS,
  REPOSITORY_MAPPED_POSITION_SEGMENT_LIMIT,
  REPOSITORY_SOURCE_LIMIT_BYTES,
} from '../constants'
import { StudyError } from '../errors'
import {
  reactScriptsAmbiguousSourceRefusal,
  reactScriptsMapLimitRefusal,
  reactScriptsSealedNodeModulesRefusal,
  reactScriptsSealedOutsidePackageRefusal,
  reactScriptsUnmappedLineRefusal,
  type ReactScriptsMapLimit,
} from '../reactScriptsRefusals'
import type { BundleSource } from '../repositoryBundle'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

import {
  readReactScriptsServedBundle,
  type ReactScriptsBundleCache,
} from './readReactScriptsServedBundle'
import { readRepositoryBuildText } from './readRepositoryBuildText'
import { sourceMapMappedPositions } from './sourceMapMappedPositions'

/** What {@link sealReactScriptsStop} needs. */
export type ReactScriptsSealRequest = Readonly<{
  /** The react-scripts app's folder (absolute); its real path is what the served map names sources below. */
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
  cache: ReactScriptsBundleCache
}>

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
 * Why it exists: Windows paths differ in drive-letter and folder case between the real path of the app and the path webpack wrote (`c:/` against `C:/`), so a win32 comparison ignores case; elsewhere paths are case-sensitive. Called by {@link sealReactScriptsStop} over every absolute entry.
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
 * Why it exists: {@link sourceMapMappedPositions} only says the scan was incomplete, and the `map-limit` refusal names the limit. Called by {@link sealReactScriptsStop}.
 * @param mappings - The map's `mappings` string.
 * @returns The first limit the walk of {@link walkSourceMapSegments} reaches.
 * @example scanLimitOf(';'.repeat(100_001)) // => 'mapped-generated-lines'
 */
function scanLimitOf(mappings: string): ReactScriptsMapLimit {
  let segmentsRead = 0
  let generatedLinesRead = 1
  for (let cursor = 0; cursor <= mappings.length; cursor++) {
    if (
      cursor === REPOSITORY_MAPPED_POSITION_MAX_SCANNED_CHARS &&
      cursor < mappings.length
    )
      return 'mapped-scanned-chars'
    const delimiter = mappings[cursor]
    // A segment ends at a comma, a semicolon or the end of the map.
    if (cursor !== mappings.length && delimiter !== ',' && delimiter !== ';')
      continue
    if (++segmentsRead > REPOSITORY_MAPPED_POSITION_SEGMENT_LIMIT)
      return 'mapped-position-segments'
    if (
      delimiter === ';' &&
      ++generatedLinesRead > REPOSITORY_MAPPED_POSITION_MAX_GENERATED_LINES
    )
      return 'mapped-generated-lines'
  }
  return 'mapped-position-segments'
}

/**
 * Builds the `SOURCE_CHANGED` refusal of a stop file that is no longer the text the dev server compiled.
 * @param path - The stop's repository-relative path.
 * @returns The error to throw.
 * @example sourceChangedRefusal('app/src/App.js').code // => 'SOURCE_CHANGED'
 */
function sourceChangedRefusal(path: string): StudyError {
  return new StudyError(
    'SOURCE_CHANGED',
    `${path} differs from the text react-scripts compiled, so the bundle does not run the checked-out file. Save the file unchanged and start again.`,
  )
}

/**
 * Finds the one `sources` entry of the served map that names the stop file.
 * @param served - The bundle and map read.
 * @param stopPath - The stop file's canonical path.
 * @param request - The seal request, for the refusal.
 * @returns The map, its normalized sources, the stop's index and the retained text.
 * @throws `REACT_SCRIPTS_SEAL_FAILED` (`outside-package`) unless the map names the file exactly once.
 * @example locateStop(served, '/app/src/App.js', request).stopIndex // => 0
 */
function locateStop(
  served: Awaited<ReturnType<typeof readReactScriptsServedBundle>>,
  stopPath: string,
  request: ReactScriptsSealRequest,
) {
  const sources = served.map.sources.map(normalizeMapSource)
  const matches = sources.flatMap((entry, index) =>
    ABSOLUTE_PATH.test(entry) && mapSourceNamesStop(entry, stopPath)
      ? [index]
      : [],
  )
  // A map that does not name the file names another folder; one that names it twice leaves the executed copy unknown.
  if (matches.length === 0)
    throw reactScriptsSealedOutsidePackageRefusal(request.packageRootRelative, [
      request.source.path,
    ])
  if (matches.length > 1)
    throw reactScriptsAmbiguousSourceRefusal(request.source.path)
  const stopIndex = matches[0]!
  return {
    served,
    sources,
    stopIndex,
    retained: served.map.sourcesContent?.[stopIndex],
  }
}

/**
 * Seals one declared browser stop from the single bundle react-scripts serves, before the browser opens.
 *
 * Why it exists: the executed bytes are checked against these served bytes before the click. The stop file must be named in the served map by the canonical path of the app (real root joined with the package-relative path), with retained text equal to the checked-out file. Called by the react-scripts adapter's `readBundle` once per stop.
 * Only this stop's retained text is kept in the sealed map; the other sources keep their names so the map still locates the stop.
 * @param request - The app, the stop, the owned origin and the run's cache.
 * @returns The sealed bundle (served bytes unchanged) with the discovery measurements.
 * @throws `REACT_SCRIPTS_SEAL_FAILED` (`node-modules`, `outside-package` with `sideEffects: "partial"`, `ambiguous-source`, `unmapped-line`, `map-limit`, `map-unreadable`); `SOURCE_CHANGED` when the file differs from the accepted article or from the compiled text.
 * @example
 * const { bundle } = await sealReactScriptsStop({ appRoot, packageRootRelative: '.', packageRelativePath: 'src/App.js', source, citationEndLine: 12, ownedOrigin, signal, cache })
 */
export async function sealReactScriptsStop(request: ReactScriptsSealRequest) {
  const started = performance.now()
  const { source, packageRelativePath } = request
  const segments = packageRelativePath.split('/')
  // A published package is not the checked-out library, wherever the app keeps it.
  if (segments.includes('node_modules'))
    throw reactScriptsSealedNodeModulesRefusal([source.path])
  // The seal runs after the owned server started, so its refusals say the server was stopped.
  if (segments.includes('..'))
    throw reactScriptsSealedOutsidePackageRefusal(request.packageRootRelative, [
      source.path,
    ])
  const realRoot = await realpath(request.appRoot)
  const sourceText = await readRepositoryBuildText(
    realRoot,
    join(realRoot, ...segments),
    REPOSITORY_SOURCE_LIMIT_BYTES,
    request.signal,
  )
  if (sha256(sourceText) !== source.hash)
    throw sourceChangedRefusal(source.path)
  const stopPath = canonicalForwardSlashPath(join(realRoot, ...segments))
  const mapReadsBefore = request.cache.mapReads
  let located = locateStop(
    await readReactScriptsServedBundle(
      request.ownedOrigin,
      request.signal,
      request.cache,
    ),
    stopPath,
    request,
  )
  // The cache is keyed by the bundle bytes, which an edit can leave unchanged while the map differs: a cached map that disagrees with the checked-out file is read once more before the stop is refused.
  if (
    located.retained !== sourceText &&
    request.cache.mapReads === mapReadsBefore
  ) {
    request.cache.entry = undefined
    located = locateStop(
      await readReactScriptsServedBundle(
        request.ownedOrigin,
        request.signal,
        request.cache,
      ),
      stopPath,
      request,
    )
  }
  if (located.retained !== sourceText) throw sourceChangedRefusal(source.path)
  const { served, sources, stopIndex } = located
  const scan = sourceMapMappedPositions(
    served.map.mappings,
    stopIndex,
    source.line,
    request.citationEndLine,
  )
  if (!scan.positions.length)
    throw scan.complete
      ? reactScriptsUnmappedLineRefusal(
          source.path,
          source.line,
          request.citationEndLine,
        )
      : reactScriptsMapLimitRefusal(scanLimitOf(served.map.mappings))
  const sourceMap = JSON.stringify({
    ...served.map,
    file: served.map.file ?? '',
    sourceRoot: '',
    sources,
    sourcesContent: sources.map((_, index) =>
      index === stopIndex ? sourceText : '',
    ),
  })
  if (Buffer.byteLength(sourceMap) > REPOSITORY_MAP_LIMIT_BYTES)
    throw reactScriptsMapLimitRefusal('map-bytes')
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
  }
}
