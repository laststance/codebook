import { constants, type Dirent } from 'node:fs'
import { open, opendir, readFile, realpath, stat } from 'node:fs/promises'
import { SourceMap } from 'node:module'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  LIBRARY_BUILD_DISCOVERY_TIMEOUT_MS,
  LIBRARY_BUILD_ENTRY_LIMIT_COUNT,
  LIBRARY_BUILD_MAP_LIMIT_COUNT,
  LIBRARY_BUILD_TOTAL_LIMIT_BYTES,
  LIBRARY_PACKAGE_JSON_LIMIT_BYTES,
  REPOSITORY_DISCOVERY_LIMIT_BYTES,
  REPOSITORY_DISCOVERY_TIMEOUT_MS,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
  REPOSITORY_MAP_LIMIT_BYTES,
} from '../constants'
import {
  libraryBuildStaleRefusal,
  libraryBuildUnmappedRefusal,
  type LibraryBuildUnmappedCause,
} from '../nextRefusals'
import { sha256 } from '../runtimeSupport/utils/sha256'

import type { NextPagesDiscoveryCache } from './createNextPagesDiscoveryCache'
import { readRepositoryBuildText } from './readRepositoryBuildText'
import { resolveArmedPlace } from './resolveArmedPlace'
import type { ResolvedNextPackage } from './resolveNextPackage'
import { walkSourceMapSegments } from './walkSourceMapSegments'

/** A workspace library the Next app imports through a link inside the repository, as {@link detectLibraryPackage} found it. */
export type LibraryPackage = Readonly<{
  /** The `name` of the library's `package.json`. */
  name: string
  /** The library folder's repository-relative path, `/`-separated. */
  folder: string
  /** The library folder's real (absolute, symlink-free) path. */
  realFolder: string
}>

/** The part of {@link ResolvedNextPackage} library detection reads: the app folder and the two ways to tell a path is inside it. */
export type LibraryAppFolder = Pick<
  ResolvedNextPackage,
  'packageRoot' | 'toPackageRelative' | 'toPackageRelativeByRealPath'
>

/** What a library stop's build discovery spends: the run's byte and time counters ({@link NextPagesDiscoveryCache}), shared with {@link spendNextPagesDiscovery}. */
export type LibraryBuildBudget = Pick<
  NextPagesDiscoveryCache,
  'readBytes' | 'spentMs'
>

/** What {@link freezeLibraryBuild} is asked. */
export type FreezeLibraryBuildRequest = Readonly<{
  /** The opened repository's root. */
  repositoryRoot: string
  /** The Next app's package root, repository-relative (`.` for the root app); named in a refusal. */
  packageRootRelative: string
  library: LibraryPackage
  stop: Readonly<{
    /** The repository-relative path of the stop's file. */
    path: string
    /** The SHA-256 of the checked-out file the configuration accepted. */
    sha256: string
    /** The one-based declared stop line. */
    line: number
    /** The one-based last line of the stop's citation; a place after it is never the stop. */
    citationEndLine: number
  }>
  /** Ends the discovery with the run; an abort is rethrown, never turned into a refusal. */
  signal: AbortSignal
  /** The run's discovery budget; bytes read and time spent are added to it. */
  budget: LibraryBuildBudget
  /** Overrides {@link LIBRARY_BUILD_DISCOVERY_TIMEOUT_MS}; a test seam for the deadline. */
  timeoutMs?: number
  /** Overrides {@link readRepositoryBuildText}; a test seam for a read in flight. */
  readText?: typeof readRepositoryBuildText
}>

/** One build flavour of the stop's file that was frozen: the built file and the map that names the stop's file. */
export type LibraryBuildCandidate = Readonly<{
  /** The built file's repository-relative path, `/`-separated. */
  builtPath: string
  /** SHA-256 of the built file's text. */
  builtSha256: string
  /** SHA-256 of the build map's text. */
  mapSha256: string
}>

/** A place of a built file, one-based line and column. */
export type BuiltPlace = Readonly<{ builtPath: string; builtLine: number }>

/** A place of the library source, one-based line and column. */
export type SourcePlace = Readonly<{ line: number; column: number }>

/** The triple (source, build map, built file) of every candidate, frozen before any process starts, with the translations between source and build. */
export type FrozenLibraryBuild = Readonly<{
  library: LibraryPackage
  /** The repository-relative path of the stop's file. */
  stopPath: string
  /** The one-based source line the stop is armed at: the declared line, or the first later line of the citation that every candidate maps ({@link resolveArmedPlace} rule). */
  armedSourceLine: number
  /** SHA-256 of the checked-out source every candidate's `sourcesContent` equals. */
  sourceSha256: string
  candidates: readonly LibraryBuildCandidate[]
  /**
   * Gives the built place of a source line in every build flavour that maps it, so the caller can ask the server compile which flavour it holds.
   * @param sourceLine - One-based source line.
   * @returns One entry per generated line of a candidate that holds a mapping of that line, in generated order (one-based); so a source line built into several lines of a file has several entries for it, which the caller must not choose among.
   */
  toBuilt(sourceLine: number): BuiltPlace[]
  /**
   * Gives the source place of a bound built place, only when the answer is unique.
   * @param builtPath - A candidate's built path.
   * @param builtLine - One-based built line.
   * @param builtColumn - One-based built column, or `undefined` when the column is no column of the built file (Next's eval map is line-granular, so a place bound through it has none); then the whole line must map to one source line.
   * @returns The source place, or `undefined` when the line maps to several source lines, holds code of another source, or the column is not a mapped column.
   */
  toSource(
    builtPath: string,
    builtLine: number,
    builtColumn: number | undefined,
  ): SourcePlace | undefined
  /**
   * Gives the module path as Next writes it relative to the app folder.
   * @param builtPath - A candidate's built path (repository-relative).
   * @param packageRootRelative - The app's package root (repository-relative).
   * @returns For example `../../../packages/lib/build/modern/a.js`.
   */
  runtimePath(builtPath: string, packageRootRelative: string): string
  /**
   * Tells whether text is the frozen built file, so each instance of the module can be checked against the freeze.
   * @param builtPath - A candidate's built path.
   * @param text - The built text an instance executes.
   * @returns `true` only when the SHA-256 of the text equals the frozen one.
   */
  matchesBuiltText(builtPath: string, text: string): boolean
}>

/** Library folders below which build maps are looked for. */
const BUILD_FOLDERS = ['build', 'dist', 'lib'] as const

/** An npm package name; anything else is never joined into a path. */
const PACKAGE_NAME_PATTERN =
  /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/

/** Turns a platform path into a `/`-separated one. */
function toPosix(path: string): string {
  return path.split(sep).join('/')
}

/** Says whether a path lies inside a root (the root itself counts). */
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Reads the `name` of a folder's `package.json`.
 * @param folder - An absolute folder.
 * @returns The valid npm name, or `undefined` for a missing, unreadable, oversized or nameless `package.json`.
 */
async function readPackageName(folder: string): Promise<string | undefined> {
  const file = join(folder, 'package.json')
  try {
    if ((await stat(file)).size > LIBRARY_PACKAGE_JSON_LIMIT_BYTES)
      return undefined
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    const name =
      typeof parsed === 'object' && parsed !== null && 'name' in parsed
        ? parsed.name
        : undefined
    return typeof name === 'string' && PACKAGE_NAME_PATTERN.test(name)
      ? name
      : undefined
  } catch {
    return undefined
  }
}

/** Says whether `<base>/<name>` resolves by real path to the folder. */
async function linksTo(
  base: string,
  name: string,
  realFolder: string,
): Promise<boolean> {
  try {
    return (await realpath(join(base, 'node_modules', name))) === realFolder
  } catch {
    return false
  }
}

/**
 * Finds the workspace library a stop file belongs to, so a stop outside the Next app can be sealed through the library's build instead of refused as `outside-package`.
 *
 * Why it exists: Pages examples import their workspace libraries through links inside the repository; only such a library has a build the app really runs. Called by {@link ConfiguredBrowserRun} after the package resolved, for a stop file outside the package.
 * @param repositoryRoot - The opened repository's root.
 * @param nextPackage - The resolved Next app.
 * @param stopPath - The repository-relative stop file.
 * @returns The library when the file lies outside the app, inside the repository both lexically and by real path, inside a folder with a named `package.json` that the app folder's or the repository root's `node_modules/<name>` resolves to by real path; `undefined` otherwise (the caller keeps the `outside-package` refusal).
 * @example
 * const library = await detectLibraryPackage(root, nextPackage, 'packages/core/src/a.ts')
 * library?.name // => '@scope/core'
 */
export async function detectLibraryPackage(
  repositoryRoot: string,
  nextPackage: LibraryAppFolder,
  stopPath: string,
): Promise<LibraryPackage | undefined> {
  // A path that is absolute or climbs is no repository path.
  if (isAbsolute(stopPath) || normalize(stopPath).split(sep)[0] === '..')
    return undefined
  // Inside the app (lexically or through a link) is today's path, not a library's.
  if (
    nextPackage.toPackageRelative(stopPath) !== undefined ||
    (await nextPackage.toPackageRelativeByRealPath(stopPath)) !== undefined
  )
    return undefined
  try {
    const root = await realpath(repositoryRoot)
    const realFile = await realpath(resolve(root, stopPath))
    // A file whose real path leaves the repository, or is another path than declared, is not a library file.
    if (
      !isInside(root, realFile) ||
      toPosix(relative(root, realFile)) !== toPosix(normalize(stopPath))
    )
      return undefined
    return await libraryOfFile(root, nextPackage, realFile)
  } catch {
    return undefined
  }
}

/** Walks up from a real file to the nearest named `package.json` below the repository and checks the app links to it. */
async function libraryOfFile(
  root: string,
  nextPackage: LibraryAppFolder,
  realFile: string,
): Promise<LibraryPackage | undefined> {
  let folder = dirname(realFile)
  // The walk ends at the repository root, which is the last folder tried.
  while (isInside(root, folder)) {
    const name = await readPackageName(folder)
    if (name !== undefined) {
      const linked =
        (await linksTo(nextPackage.packageRoot, name, folder)) ||
        (await linksTo(root, name, folder))
      return linked
        ? {
            name,
            folder: toPosix(relative(root, folder)) || '.',
            realFolder: folder,
          }
        : undefined
    }
    if (folder === root) return undefined
    folder = dirname(folder)
  }
  return undefined
}

/** Thrown inside the freeze; carries the cause of a `library-build-unmapped` refusal. */
class UnmappedCause extends Error {
  constructor(readonly cause: LibraryBuildUnmappedCause) {
    super(cause)
  }
}

/** The mutable counters of one discovery. */
type Spend = { totalBytes: number; entries: number }

/** Lists the build maps below the library's `build/`, `dist/` and `lib/`, never following a linked folder and skipping a map link that leaves the repository. */
async function listLibraryMaps(
  root: string,
  library: LibraryPackage,
  signal: AbortSignal,
  spend: Spend,
): Promise<string[]> {
  const maps: string[] = []
  const pending = BUILD_FOLDERS.map((name) => join(library.realFolder, name))
  while (pending.length > 0) {
    signal.throwIfAborted()
    const folder = pending.pop()!
    const entries = await readFolderEntries(folder, signal, spend)
    pending.push(...subfoldersOf(folder, entries))
    for (const entry of entries) {
      const real = await realMapPath(root, join(folder, entry.name), entry)
      if (real !== undefined) maps.push(real)
    }
    if (maps.length > LIBRARY_BUILD_MAP_LIMIT_COUNT)
      throw new UnmappedCause('bound')
  }
  // The found maps (not every entry) are sorted, so the order of the freeze does not depend on the listing order.
  return maps.sort()
}

/** Gives the folders to descend into: real subfolders, never `node_modules` and never a link. */
function subfoldersOf(
  folder: string,
  entries: readonly { name: string; isDirectory(): boolean }[],
): string[] {
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => join(folder, entry.name))
}

/**
 * Lists a folder's entries one by one and counts each against the discovery's entry bound, so a huge folder is refused before it is loaded whole; a folder that does not exist is empty, because a library without that build folder is normal.
 * @throws `UnmappedCause('bound')` as soon as the counted entries pass {@link LIBRARY_BUILD_ENTRY_LIMIT_COUNT}.
 */
async function readFolderEntries(
  folder: string,
  signal: AbortSignal,
  spend: Spend,
) {
  const entries: Dirent[] = []
  try {
    for await (const entry of await opendir(folder)) {
      signal.throwIfAborted()
      spend.entries += 1
      // Stop at the bound; the rest of the folder is never read.
      if (spend.entries > LIBRARY_BUILD_ENTRY_LIMIT_COUNT)
        throw new UnmappedCause('bound')
      entries.push(entry)
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    )
      return []
    throw error
  }
  return entries
}

/** The map file endings of a JavaScript build; a `.d.ts.map`, `.d.cts.map` or `.d.mts.map` ends in `.ts.map` and is skipped. */
const LIBRARY_JAVASCRIPT_MAP_SUFFIXES = [
  '.js.map',
  '.cjs.map',
  '.mjs.map',
] as const

/** Gives a JavaScript build map entry's real path, or `undefined` for another file, a map that is no file or a link that leaves the repository. */
async function realMapPath(
  root: string,
  path: string,
  entry: { name: string; isFile(): boolean; isSymbolicLink(): boolean },
): Promise<string | undefined> {
  // Only a JavaScript build's map can hold the code Next bundles; type declaration maps (core.d.ts.map) name the same source without its content.
  if (
    !LIBRARY_JAVASCRIPT_MAP_SUFFIXES.some((suffix) =>
      entry.name.endsWith(suffix),
    )
  )
    return undefined
  if (entry.isFile()) return path
  if (!entry.isSymbolicLink()) return undefined
  try {
    const real = await realpath(path)
    return isInside(root, real) ? real : undefined
  } catch {
    return undefined
  }
}

/** The parts of a parsed build map the freeze reads. */
type ParsedMap = {
  payload: ConstructorParameters<typeof SourceMap>[0]
  sources: string[]
  sourcesContent: unknown[] | undefined
  sourceRoot: string
  mappings: string
}

/** Parses a map's text; a text that is no flat version 3 map is `malformed`. */
function parseMap(text: string): ParsedMap {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new UnmappedCause('malformed')
  }
  const map = value as Record<string, unknown> | null
  if (
    typeof map !== 'object' ||
    map === null ||
    map.version !== 3 ||
    !Array.isArray(map.sources) ||
    !map.sources.every((source) => typeof source === 'string') ||
    typeof map.mappings !== 'string' ||
    'sections' in map ||
    (map.sourcesContent !== undefined && !Array.isArray(map.sourcesContent)) ||
    (map.sourceRoot !== undefined && typeof map.sourceRoot !== 'string')
  )
    throw new UnmappedCause('malformed')
  const payload = map as unknown as ParsedMap['payload']
  try {
    // Node's own reader refuses what it cannot read, so a later lookup never meets it.
    new SourceMap(payload)
  } catch {
    throw new UnmappedCause('malformed')
  }
  return {
    payload,
    sources: map.sources,
    sourcesContent: map.sourcesContent as unknown[] | undefined,
    sourceRoot: map.sourceRoot ?? '',
    mappings: map.mappings,
  }
}

/** Resolves a map source to an absolute path, or `undefined` for a URL that names no file. */
function resolveMapSource(
  mapFolder: string,
  sourceRoot: string,
  source: string,
): string | undefined {
  if (source.startsWith('file://')) {
    try {
      return resolve(fileURLToPath(source))
    } catch {
      return undefined
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(source)) return undefined
  return resolve(mapFolder, sourceRoot, source)
}

/**
 * Decodes a percent-encoded `sources` entry, as a map may spell a URL.
 * @returns The decoded entry, or `undefined` when it does not differ or does not decode (no match, never a throw).
 * @example
 * ```ts
 * percentDecoded('../src/my%20core.ts') // => '../src/my core.ts'
 * percentDecoded('../src/core.ts') // => undefined
 * ```
 */
function percentDecoded(source: string): string | undefined {
  try {
    const decoded = decodeURIComponent(source)
    return decoded === source ? undefined : decoded
  } catch {
    return undefined
  }
}

/** Finds the indexes of the `sources` entries that name the stop's real file when each entry is read through `spell`. */
async function matchingSourceIndexes(
  parsed: ParsedMap,
  mapFolder: string,
  stopRealFile: string,
  spell: (source: string) => string | undefined,
): Promise<number[]> {
  const found: number[] = []
  for (const [index, source] of parsed.sources.entries()) {
    const spelled = spell(source)
    if (spelled === undefined) continue
    const absolute = resolveMapSource(mapFolder, parsed.sourceRoot, spelled)
    // The basename test spares a real-path lookup for every other file of the map.
    if (absolute === undefined || basename(absolute) !== basename(stopRealFile))
      continue
    try {
      if ((await realpath(absolute)) === stopRealFile) found.push(index)
    } catch {
      // A source that does not exist names no checked-out file.
    }
  }
  return found
}

/** Finds the index of the one `sources` entry that names the stop's real file; two names for it make the map malformed. Entries are read raw first; only when none matches are they read percent-decoded. */
async function indexOfStopSource(
  parsed: ParsedMap,
  mapFolder: string,
  stopRealFile: string,
): Promise<number | undefined> {
  let found = await matchingSourceIndexes(
    parsed,
    mapFolder,
    stopRealFile,
    (source) => source,
  )
  // No raw match: a URL-style entry such as `my%20core.ts` may name the file once decoded.
  if (found.length === 0)
    found = await matchingSourceIndexes(
      parsed,
      mapFolder,
      stopRealFile,
      percentDecoded,
    )
  if (found.length > 1) throw new UnmappedCause('malformed')
  return found[0]
}

/** The decoded mapping table of one candidate. */
type MappingTable = {
  /** The first generated position (zero-based) of each one-based source line. */
  firstByLine: Map<number, { line: number; column: number }>
  /** Every zero-based generated line that holds a segment of each one-based source line, ascending and without repeats; the first equals {@link firstByLine}'s line. */
  generatedLinesByLine: Map<number, number[]>
  /** The segments of each zero-based generated line, in generated order; `source` is `false` for a segment of another source. */
  byGeneratedLine: Map<
    number,
    { column: number; source: boolean; line: number; originalColumn: number }[]
  >
}

/** Decodes a candidate's mappings once; an incomplete or failing walk is `bound` or `malformed`. */
function tabulate(mappings: string, sourceIndex: number): MappingTable {
  const table: MappingTable = {
    firstByLine: new Map(),
    generatedLinesByLine: new Map(),
    byGeneratedLine: new Map(),
  }
  let complete: boolean
  try {
    complete = walkSourceMapSegments(mappings, (segment) => {
      // A segment without an original carries no place.
      if (!segment.original) return
      const isSource = segment.original.sourceIndex === sourceIndex
      const line = segment.original.line + 1
      const segments = table.byGeneratedLine.get(segment.generatedLine) ?? []
      segments.push({
        column: segment.generatedColumn,
        source: isSource,
        line,
        originalColumn: segment.original.column + 1,
      })
      table.byGeneratedLine.set(segment.generatedLine, segments)
      if (isSource) {
        const lines = table.generatedLinesByLine.get(line) ?? []
        // Segments arrive in generated order, so a repeat is the last entry.
        if (lines.at(-1) !== segment.generatedLine)
          lines.push(segment.generatedLine)
        table.generatedLinesByLine.set(line, lines)
      }
      if (isSource && !table.firstByLine.has(line))
        table.firstByLine.set(line, {
          line: segment.generatedLine,
          column: segment.generatedColumn,
        })
    })
  } catch {
    throw new UnmappedCause('malformed')
  }
  if (!complete) throw new UnmappedCause('bound')
  return table
}

/** One map that names the stop's file, before its built file was read. */
type FoundMap = {
  mapRelativePath: string
  mapText: string
  parsed: ParsedMap
  sourceIndex: number
}

/** Reads a map within every bound, mapping what the reader throws to the cause it means. */
async function readMapText(
  request: FreezeLibraryBuildRequest,
  root: string,
  relativePath: string,
  limit: number,
  signal: AbortSignal,
): Promise<string> {
  const read = request.readText ?? readRepositoryBuildText
  try {
    return await read(root, relativePath, limit, signal)
  } catch (error) {
    // An abort (the run's or the deadline) is decided by the caller, from the signals.
    signal.throwIfAborted()
    if (error instanceof Error && /exceeds byte limit/.test(error.message))
      throw new UnmappedCause('bound')
    throw new UnmappedCause('malformed')
  }
}

/** Takes the next read's byte allowance from the run's budget and the discovery's own, refusing `bound` when nothing is left. */
function takeBytes(
  request: FreezeLibraryBuildRequest,
  spend: Spend,
  fileLimit: number,
): number {
  const left = Math.min(
    fileLimit,
    LIBRARY_BUILD_TOTAL_LIMIT_BYTES - spend.totalBytes,
    REPOSITORY_DISCOVERY_LIMIT_BYTES - request.budget.readBytes,
  )
  if (left <= 0) throw new UnmappedCause('bound')
  return left
}

/** Charges text read to both the discovery and the run's budget. */
function charge(
  request: FreezeLibraryBuildRequest,
  spend: Spend,
  text: string,
): void {
  const bytes = Buffer.byteLength(text)
  spend.totalBytes += bytes
  request.budget.readBytes += bytes
}

/** Escapes a file name the way JSON text writes it inside a string. */
function jsonEscaped(name: string): string {
  return JSON.stringify(name).slice(1, -1)
}

/**
 * Lists the spellings a map's raw text may use for the stop file's name.
 *
 * Why it exists: the strict parse resolves a `sources` entry written percent-encoded (`my%20core.ts`) or with `\uXXXX` escapes for non-ASCII characters, so the cheap raw-text check before it must look for those spellings too, or the map is skipped as unrelated.
 * Called by {@link mentionsFile} and {@link oversizedMapMentions}.
 * @param name - The stop file's plain base name.
 * @returns Distinct needles: plain, JSON-escaped, `encodeURI`, `encodeURIComponent`, and the lowercase and uppercase `\uXXXX` forms.
 * @example
 * ```ts
 * nameSpellings('café.ts') // includes 'caf\\u00e9.ts' and 'caf%C3%A9.ts'
 * ```
 */
function nameSpellings(name: string): string[] {
  const escapeUnits = (upper: boolean): string => {
    let out = ''
    // Walk UTF-16 units (not code points): a JSON writer escapes each surrogate separately.
    for (let i = 0; i < name.length; i++) {
      const unit = name.charCodeAt(i)
      if (unit <= 0x7f) {
        out += name[i]
        continue
      }
      const hex = unit.toString(16).padStart(4, '0')
      out += `\\u${upper ? hex.toUpperCase() : hex}`
    }
    return out
  }
  const spellings = [
    name,
    jsonEscaped(name),
    encodeURI(name),
    encodeURIComponent(name),
    escapeUnits(false),
    escapeUnits(true),
  ]
  return [...new Set(spellings)]
}

/** Tells whether a map's raw text mentions the stop file's name in any spelling of {@link nameSpellings}, as a cheap check before the strict parse. */
function mentionsFile(text: string, name: string): boolean {
  return nameSpellings(name).some((needle) => text.includes(needle))
}

/**
 * Scans a map larger than the per-map limit for the stop file's name in chunks, without holding it in memory, so an unrelated oversized map can be skipped.
 * @returns `true` when the name occurs in the file; every scanned byte is charged to the discovery and the run's budget.
 */
async function oversizedMapMentions(
  request: FreezeLibraryBuildRequest,
  root: string,
  mapPath: string,
  name: string,
  signal: AbortSignal,
  spend: Spend,
): Promise<boolean> {
  // The chunk overlap below covers the longest spelling.
  const needles = nameSpellings(name).map((spelling) => Buffer.from(spelling))
  const overlap = Math.max(...needles.map((needle) => needle.length)) - 1
  const handle = await open(
    join(await realpath(root), relative(root, mapPath)),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const chunk = Buffer.alloc(1_048_576)
    let tail = Buffer.alloc(0)
    for (;;) {
      signal.throwIfAborted()
      const left = takeBytes(request, spend, chunk.length)
      const { bytesRead } = await handle.read(chunk, 0, left, null)
      if (bytesRead === 0) return false
      spend.totalBytes += bytesRead
      request.budget.readBytes += bytesRead
      const window = Buffer.concat([tail, chunk.subarray(0, bytesRead)])
      if (needles.some((needle) => window.includes(needle))) return true
      tail = window.subarray(Math.max(0, window.length - overlap))
    }
  } finally {
    await handle.close()
  }
}

/**
 * Reads one map for {@link findStopMaps} and returns its text only when the map can name the stop file.
 *
 * Why it exists: one unrelated index map, an unreadable one or an oversized one must not refuse every stop of the library. A map that does name the file keeps the strict refusals; the discovery's total-bytes, entry, count and deadline bounds still refuse.
 * @returns The text, or `undefined` for a map to skip.
 * @throws `UnmappedCause('bound')` for a map over the limit that names the file, or when the remaining byte allowance is smaller than the per-map limit and the map does not fit.
 */
async function readCandidateMapText(
  request: FreezeLibraryBuildRequest,
  root: string,
  mapPath: string,
  relativePath: string,
  stopRealFile: string,
  signal: AbortSignal,
  spend: Spend,
): Promise<string | undefined> {
  const allowance = takeBytes(request, spend, REPOSITORY_MAP_LIMIT_BYTES)
  const name = basename(stopRealFile)
  let text: string
  try {
    text = await readMapText(request, root, relativePath, allowance, signal)
  } catch (error) {
    if (!(error instanceof UnmappedCause)) throw error
    if (error.cause === 'malformed') return undefined
    // The remaining total allowance, not the per-map limit, was too small: the discovery's bound.
    if (allowance < REPOSITORY_MAP_LIMIT_BYTES) throw error
    // Over the per-map limit: refuse only a map that names the file.
    if (await oversizedMapMentions(request, root, mapPath, name, signal, spend))
      throw error
    return undefined
  }
  charge(request, spend, text)
  return mentionsFile(text, name) ? text : undefined
}

/** Reads every map below the library and keeps those that name the stop's file. */
async function findStopMaps(
  request: FreezeLibraryBuildRequest,
  root: string,
  stopRealFile: string,
  signal: AbortSignal,
  spend: Spend,
): Promise<FoundMap[]> {
  const found: FoundMap[] = []
  for (const mapPath of await listLibraryMaps(
    root,
    request.library,
    signal,
    spend,
  )) {
    signal.throwIfAborted()
    const relativePath = relative(root, mapPath)
    const text = await readCandidateMapText(
      request,
      root,
      mapPath,
      relativePath,
      stopRealFile,
      signal,
      spend,
    )
    // A map that cannot be shown to name the stop's file is not this stop's map.
    if (text === undefined) continue
    const parsed = parseMap(text)
    const sourceIndex = await indexOfStopSource(
      parsed,
      dirname(mapPath),
      stopRealFile,
    )
    if (sourceIndex !== undefined)
      found.push({
        mapRelativePath: toPosix(relativePath),
        mapText: text,
        parsed,
        sourceIndex,
      })
  }
  return found
}

/** Checks every candidate's `sourcesContent` against the accepted hash: absent is `no-content`, different is stale. */
function assertContentEquals(
  request: FreezeLibraryBuildRequest,
  found: readonly FoundMap[],
): void {
  for (const map of found) {
    const content = map.parsed.sourcesContent?.[map.sourceIndex]
    if (typeof content !== 'string') throw new UnmappedCause('no-content')
  }
  for (const map of found) {
    const content = map.parsed.sourcesContent![map.sourceIndex] as string
    if (sha256(content) !== request.stop.sha256) throw new StaleBuild()
  }
}

/** Thrown inside the freeze for a build whose `sourcesContent` differs from the checked-out file. */
class StaleBuild extends Error {}

/** Reads a candidate's built file and checks the map is the one it names. */
async function readBuiltFile(
  request: FreezeLibraryBuildRequest,
  root: string,
  map: FoundMap,
  signal: AbortSignal,
  spend: Spend,
): Promise<{ builtPath: string; text: string }> {
  if (!map.mapRelativePath.endsWith('.map'))
    throw new UnmappedCause('malformed')
  const builtPath = map.mapRelativePath.slice(0, -'.map'.length)
  const text = await readMapText(
    request,
    root,
    builtPath,
    takeBytes(request, spend, REPOSITORY_JAVASCRIPT_LIMIT_BYTES),
    signal,
  )
  charge(request, spend, text)
  const comment = /\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/.exec(text)
  // The built file must announce this very map, or the map says nothing about it.
  if (
    !comment ||
    basename(decodeURIComponent(comment[1]!)) !== basename(map.mapRelativePath)
  )
    throw new UnmappedCause('malformed')
  return { builtPath, text }
}

/** The pieces of one candidate: its record and its mapping table. */
type FrozenCandidate = {
  candidate: LibraryBuildCandidate
  table: MappingTable
}

/** Picks the line the stop is armed at: the declared one, or the first later line of the citation that every candidate maps. */
function armedLineOf(
  request: FreezeLibraryBuildRequest,
  candidates: readonly FrozenCandidate[],
): number {
  const { line, citationEndLine } = request.stop
  const positions: { line: number; column: number }[] = []
  for (let current = line; current <= citationEndLine; current++) {
    // A line counts only when every build flavour maps it.
    if (candidates.every(({ table }) => table.firstByLine.has(current)))
      positions.push({ line: current, column: 1 })
  }
  if (positions.length === 0) throw new UnmappedCause('no-line')
  return resolveArmedPlace({ line, column: 1 }, { positions, complete: true })
    .line
}

/** Builds the translations over the frozen candidates. */
function createFrozen(
  request: FreezeLibraryBuildRequest,
  candidates: readonly FrozenCandidate[],
  armedSourceLine: number,
): FrozenLibraryBuild {
  const byPath = new Map(
    candidates.map((entry) => [entry.candidate.builtPath, entry]),
  )
  return {
    library: request.library,
    stopPath: request.stop.path,
    armedSourceLine,
    sourceSha256: request.stop.sha256,
    candidates: candidates.map(({ candidate }) => candidate),
    toBuilt(sourceLine) {
      return candidates.flatMap(({ candidate, table }) => {
        return (table.generatedLinesByLine.get(sourceLine) ?? []).map(
          (generatedLine) => ({
            builtPath: candidate.builtPath,
            builtLine: generatedLine + 1,
          }),
        )
      })
    },
    toSource(builtPath, builtLine, builtColumn) {
      const segments = byPath
        .get(builtPath)
        ?.table.byGeneratedLine.get(builtLine - 1)
      if (!segments) return undefined
      const chosen =
        builtColumn === undefined
          ? segments
          : segments.filter((segment) => segment.column + 1 === builtColumn)
      const first = chosen[0]
      // One source line only: a line that several source lines compile into, or that holds code of another source, has no unique answer.
      if (
        !first ||
        chosen.some((segment) => !segment.source || segment.line !== first.line)
      )
        return undefined
      return { line: first.line, column: first.originalColumn }
    },
    runtimePath(builtPath, packageRootRelative) {
      const path = posix.relative(packageRootRelative, builtPath)
      // Only a real parent step is a relative path already; `.libs/x` is a folder name and still needs `./`.
      return path === '..' || path.startsWith('../') ? path : `./${path}`
    },
    matchesBuiltText(builtPath, text) {
      const entry = byPath.get(builtPath)
      return entry !== undefined && sha256(text) === entry.candidate.builtSha256
    },
  }
}

/** Runs the freeze's steps inside the discovery's signal. */
async function freezeWithin(
  request: FreezeLibraryBuildRequest,
  signal: AbortSignal,
): Promise<FrozenLibraryBuild> {
  const spend: Spend = { totalBytes: 0, entries: 0 }
  const root = await realpath(request.repositoryRoot)
  const stopRealFile = await realpath(resolve(root, request.stop.path))
  const found = await findStopMaps(request, root, stopRealFile, signal, spend)
  if (found.length === 0) throw new UnmappedCause('no-map')
  assertContentEquals(request, found)
  const candidates: FrozenCandidate[] = []
  for (const map of found) {
    const built = await readBuiltFile(request, root, map, signal, spend)
    candidates.push({
      candidate: {
        builtPath: built.builtPath,
        builtSha256: sha256(built.text),
        mapSha256: sha256(map.mapText),
      },
      table: tabulate(map.parsed.mappings, map.sourceIndex),
    })
  }
  return createFrozen(request, candidates, armedLineOf(request, candidates))
}

/**
 * Freezes the build of a workspace library's stop file before any process starts: finds every build map that names the file, requires each to carry `sourcesContent` equal to the checked-out file, requires a build mapping at the stop (or the first mapped line after it within the citation), and records the built file's and the map's hashes.
 *
 * Why it exists: a server stop in a library pauses in the library's built file; the pause may be trusted as the checked-out source only if the build is that source. Called by the configured Next run at preflight for a stop {@link detectLibraryPackage} found a library for, and again at the seal to verify each instance.
 * @param request - The repository, library, stop, signal and the run's budget.
 * @returns The frozen build with its translations.
 * @throws {@link StudyError} `NEXT_STOP_NOT_SEALED`, `details.sideEffects: "none"`: `library-build-stale` (`libraryBuildStaleRefusal`) or `library-build-unmapped` with the cause (`libraryBuildUnmappedRefusal`). Rethrows the signal's reason when the run's own signal aborts.
 * @example
 * const frozen = await freezeLibraryBuild({ repositoryRoot, packageRootRelative, library, stop, signal, budget })
 * frozen.toBuilt(frozen.armedSourceLine) // => [{ builtPath: 'packages/core/build/modern/a.js', builtLine: 12 }]
 */
export async function freezeLibraryBuild(
  request: FreezeLibraryBuildRequest,
): Promise<FrozenLibraryBuild> {
  const started = performance.now()
  const timeoutMs = Math.max(
    1,
    Math.min(
      request.timeoutMs ?? LIBRARY_BUILD_DISCOVERY_TIMEOUT_MS,
      REPOSITORY_DISCOVERY_TIMEOUT_MS - request.budget.spentMs,
    ),
  )
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(timeoutMs),
  ])
  /** Builds the refusal for a cause with the names the message needs. */
  const unmapped = (cause: LibraryBuildUnmappedCause) =>
    libraryBuildUnmappedRefusal(
      request.packageRootRelative,
      request.library.name,
      request.stop.path,
      cause,
    )
  try {
    return await freezeWithin(request, signal)
  } catch (error) {
    // The run's own abort is not a refusal.
    request.signal.throwIfAborted()
    if (error instanceof StaleBuild)
      throw libraryBuildStaleRefusal(
        request.packageRootRelative,
        request.library.name,
        request.stop.path,
      )
    if (error instanceof UnmappedCause) throw unmapped(error.cause)
    // The deadline ended a read or a listing in flight.
    if (signal.aborted) throw unmapped('deadline')
    throw unmapped('malformed')
  } finally {
    request.budget.spentMs += performance.now() - started
  }
}
