import type { LibraryBuildUnmappedCause } from '../nextRefusals'

import { absoluteSourceOf, readInlineServedMap } from './readViteServedModule'
import { sourceMapMappedPositions } from './sourceMapMappedPositions'
import type { ViteLibraryModules } from './viteLibraryModules'

/** Where Codebook gets the modules of one library for one page generation: the launcher's list of served module addresses and the served text of each. */
export type ViteLibraryModuleSource = Readonly<{
  /** The walk's answer (memoized per page generation by the caller). */
  list: () => Promise<ViteLibraryModules>
  /** The served text of one listed address; the caller fetches it from the owned origin only. */
  read: (modulePath: string) => Promise<string>
}>

/** The stop a library module must carry: its real file, the checked-out text and the lines that may bind. */
export type ViteLibraryStopFile = Readonly<{
  /** The stop file's real (symlink-free) absolute path. */
  realPath: string
  /** The checked-out file's text. */
  text: string
  /** The one-based declared stop line. */
  line: number
  /** The one-based last line of the stop's citation. */
  citationEndLine: number
}>

/** Why the library's modules cannot give exactly one sealed module for a stop: the `details` the refusal carries. */
export type ViteLibraryRefusalFacts =
  | {
      reason: 'library-build-unmapped'
      cause: Exclude<LibraryBuildUnmappedCause, 'lazy-import'>
    }
  | { reason: 'library-build-stale' }
  | { reason: 'library-not-in-build'; candidates: string[] }

/** The outcome of {@link selectViteLibraryCandidate}. */
export type ViteLibrarySelection =
  | { kind: 'selected'; modulePath: string; javascript: string }
  | { kind: 'refused'; facts: ViteLibraryRefusalFacts }

/** What one listed module says about the stop file. */
type ModuleReading = {
  modulePath: string
  javascript: string
  /** `none`: no inline map; `malformed`: a map that cannot be read; `read`: a map with its named entries. */
  state: 'none' | 'malformed' | 'read'
  /** How many entries of the map's `sources` resolve to the stop file. */
  namedCount: number
  /** Whether a named entry carries no `sourcesContent`. */
  lacksContent: boolean
  /** Whether a named entry's `sourcesContent` differs from the checked-out file. */
  differsFromDisk: boolean
  /** Whether the map has a segment for the declared line or a later line of the citation (also true when the scan could not read the whole map). */
  mapsLine: boolean
}

/** Thrown by the source resolver when a map entry is not a URL path; the module's map then counts as malformed. */
class MalformedMapEntry extends Error {}

/**
 * Reads one served library module's inline map and what it says about the stop file.
 *
 * Why it exists: the choice among a library's served modules needs, per module, whether its map names the stop file, with which text, and whether it maps the stop's lines. Called by {@link selectViteLibraryCandidate} for every listed module.
 * @param modulePath - The module's served path, as the walk listed it.
 * @param moduleUrl - The module's absolute address on the owned origin; map entries resolve against it.
 * @param javascript - The served text.
 * @param stop - The stop file.
 * @param appRoot - The Vite app's root, which a root-relative map entry resolves below.
 * @returns The reading.
 * @example
 * await readLibraryModule('/@fs/r/packages/core/build/modern/a.js', 'http://127.0.0.1:4321/@fs/r/packages/core/build/modern/a.js', text, stop, '/r/examples/app')
 */
async function readLibraryModule(
  modulePath: string,
  moduleUrl: string,
  javascript: string,
  stop: ViteLibraryStopFile,
  appRoot: string,
): Promise<ModuleReading> {
  const base = {
    modulePath,
    javascript,
    namedCount: 0,
    lacksContent: false,
    differsFromDisk: false,
    mapsLine: false,
  }
  const inline = readInlineServedMap(javascript)
  if (inline.status === 'none') return { ...base, state: 'none' }
  if (inline.status === 'invalid') return { ...base, state: 'malformed' }
  const { map } = inline
  try {
    const sources = await Promise.all(
      map.sources.map((entry) =>
        absoluteSourceOf(entry, moduleUrl, appRoot, () => {
          throw new MalformedMapEntry()
        }),
      ),
    )
    const named = sources.flatMap((entry, index) =>
      entry === stop.realPath ? [index] : [],
    )
    return {
      ...base,
      state: 'read',
      namedCount: named.length,
      lacksContent: named.some(
        (index) =>
          map.sourcesContent?.[index] === null ||
          map.sourcesContent?.[index] === undefined,
      ),
      differsFromDisk: named.some(
        (index) => map.sourcesContent?.[index] !== stop.text,
      ),
      mapsLine: named.some((index) =>
        mapsDeclaredLine(map.mappings, index, stop),
      ),
    }
  } catch (error) {
    if (error instanceof MalformedMapEntry)
      return { ...base, state: 'malformed' }
    throw error
  }
}

/** Tells whether a map has a segment for the declared line or a later line of the citation; a scan that could not read the whole map cannot prove the absence, so it counts as mapped. */
function mapsDeclaredLine(
  mappings: string,
  sourceIndex: number,
  stop: ViteLibraryStopFile,
): boolean {
  try {
    const scan = sourceMapMappedPositions(
      mappings,
      sourceIndex,
      stop.line,
      stop.citationEndLine,
    )
    return scan.positions.length > 0 || !scan.complete
  } catch {
    // A mapping that cannot be decoded is not a usable segment.
    return false
  }
}

/**
 * Applies rows 4 to 10 of the decision table to the readings of the library's served modules, in order; the first row that holds is the refusal.
 * @param readings - One reading per listed module.
 * @returns The refusal facts, or the single candidate reading.
 * @example
 * judgeReadings([]) // => { kind: 'refused', facts: { reason: 'library-build-unmapped', cause: 'no-map' } }
 */
function judgeReadings(
  readings: readonly ModuleReading[],
): ViteLibrarySelection | { kind: 'candidate'; reading: ModuleReading } {
  const unmapped = (
    cause: Exclude<LibraryBuildUnmappedCause, 'lazy-import'>,
  ): ViteLibrarySelection => ({
    kind: 'refused',
    facts: { reason: 'library-build-unmapped', cause },
  })
  // Row 4: no listed module has an inline map.
  if (readings.every((reading) => reading.state === 'none'))
    return unmapped('no-map')
  // Row 5: some map cannot be read.
  if (readings.some((reading) => reading.state === 'malformed'))
    return unmapped('malformed')
  const named = readings.filter((reading) => reading.namedCount > 0)
  // Row 6: no map names the stop file.
  if (named.length === 0) return unmapped('no-map')
  // Row 7: a map names the file without its text.
  if (named.some((reading) => reading.lacksContent))
    return unmapped('no-content')
  // Row 8: a map carries other text than the file on disk.
  if (named.some((reading) => reading.differsFromDisk))
    return { kind: 'refused', facts: { reason: 'library-build-stale' } }
  const candidates = named.filter((reading) => reading.mapsLine)
  // Row 9: one map names the file twice, or several modules map the line.
  if (named.some((reading) => reading.namedCount > 1) || candidates.length > 1)
    return notInBuild(
      (candidates.length > 1 ? candidates : named).map(
        (reading) => reading.modulePath,
      ),
    )
  // Row 10: the maps name the file but none maps the line.
  if (candidates.length === 0) return unmapped('no-line')
  return { kind: 'candidate', reading: candidates[0]! }
}

/** Builds the row 9 refusal for the given module addresses. */
function notInBuild(candidates: string[]): ViteLibrarySelection {
  return {
    kind: 'refused',
    facts: { reason: 'library-not-in-build', candidates },
  }
}

/**
 * Chooses the one served module of a workspace library that a nested Vite app's page loads and whose inline map names the stop file, or says why there is none.
 *
 * Why it exists: Vite serves a library's built module with the build's own map folded in, so the module the browser runs for a library line is found by its map, not by its address. Called by {@link sealViteLibraryStop} once per library stop, after the launcher's walk listed the library's modules (decisions D6, D10, D15 and the decision table of Cycle 0078, rows 2 to 10).
 * @param request - `source` (the walk and the served texts), `stop` (the file), `ownedOrigin` (the addresses' origin) and `appRoot` (the Vite app's root).
 * @returns `selected` with the module's served path and text when exactly one module's map names the stop file and maps its line; `refused` with the facts of the first table row that holds.
 * @throws When the walk or a module read fails (the caller words it).
 * @example
 * const result = await selectViteLibraryCandidate({ source, stop, ownedOrigin: 'http://127.0.0.1:4321', appRoot })
 * result.kind // => 'selected'
 */
export async function selectViteLibraryCandidate(request: {
  source: ViteLibraryModuleSource
  stop: ViteLibraryStopFile
  ownedOrigin: string
  appRoot: string
}): Promise<ViteLibrarySelection> {
  const walk = await request.source.list()
  // Row 2: the walk ended at a bound, so the list may be incomplete.
  if (walk.bound !== undefined)
    return {
      kind: 'refused',
      facts: {
        reason: 'library-build-unmapped',
        cause: walk.bound === 'deadline' ? 'deadline' : 'bound',
      },
    }
  if (walk.modules.length === 0)
    // Row 3 (an optimized dependency holds the library) or decision D15 (the page reaches no module of the library).
    return walk.optimizedLibrary
      ? {
          kind: 'refused',
          facts: { reason: 'library-build-unmapped', cause: 'prebundled' },
        }
      : notInBuild([])
  const readings: ModuleReading[] = []
  for (const modulePath of walk.modules)
    readings.push(
      await readLibraryModule(
        modulePath,
        `${request.ownedOrigin}${modulePath}`,
        await request.source.read(modulePath),
        request.stop,
        request.appRoot,
      ),
    )
  const judged = judgeReadings(readings)
  return judged.kind === 'candidate'
    ? {
        kind: 'selected',
        modulePath: judged.reading.modulePath,
        javascript: judged.reading.javascript,
      }
    : judged
}
