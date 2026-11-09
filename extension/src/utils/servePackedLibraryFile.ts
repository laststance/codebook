import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { STATIC_PAGE_CDN_FILE_LIMIT_BYTES } from '../constants'

import { isInsideFolder } from './isInsideFolder'
import { contentTypeOfPath } from './startStaticPageServer'

/** One file the redirect serves in place of a CDN file: the bytes the browser receives and, for a script with a map, the map it carries inline. */
export type ServedPackedFile = Readonly<{
  /** The path below the package folder, as requested. */
  path: string
  contentType: string
  body: Buffer
  /** The text of a script file, as served. */
  text?: string
  /** The inline map of a script file, parsed, with `sources` as absolute paths (the checked-out path where the bytes are equal). */
  map?: Readonly<{
    version: 3
    file?: string
    sources: string[]
    sourcesContent?: (string | null)[]
    names: string[]
    mappings: string
  }>
}>

/** The script extensions whose `sourceMappingURL` comment is replaced. */
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(['.js', '.mjs', '.cjs'])

/** The trailing `sourceMappingURL` comment of a script. */
const TRAILING_MAP_COMMENT = /\/\/[#@]\s*sourceMappingURL=([^\s]+)\s*$/

/**
 * Reads a text file inside a folder by real path, or `undefined` when it is absent, linked out, or not a regular file.
 * @param folder - The folder's real path.
 * @param path - The absolute path to read.
 * @returns The bytes; `undefined` when the file cannot be served.
 * @example await readInside('/p', '/p/dist/a.js') // => Buffer
 */
async function readInside(
  folder: string,
  path: string,
): Promise<Buffer | undefined> {
  try {
    const real = await realpath(path)
    if (!isInsideFolder(folder, real)) return undefined
    const info = await stat(real)
    if (!info.isFile() || info.size > STATIC_PAGE_CDN_FILE_LIMIT_BYTES)
      return undefined
    return await readFile(real)
  } catch {
    return undefined
  }
}

/** Why a path of the packed copy cannot be served: `absent` (no such file, or it leaves the folder), `too-large` (over {@link STATIC_PAGE_CDN_FILE_LIMIT_BYTES}) or `unreadable` (a directory or a read error). */
export type PackedFileAbsenceCause = 'absent' | 'too-large' | 'unreadable'

/** A `sourceMappingURL` that carries the map itself: a base64 JSON data URL. */
const INLINE_MAP_REFERENCE =
  /^data:application\/json(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]*)$/i

/** A source of a map that names a location by URL scheme (`webpack://…`, `file://…`); a one-letter scheme is a Windows drive. */
const URL_SOURCE = /^[A-Za-z][A-Za-z0-9+.-]+:/

/** The packed copy's files as the browser receives them, read once each. */
export type PackedLibraryFiles = Readonly<{
  /**
   * Reads one file of the packed copy as the browser receives it.
   * @param path - The path below the package folder.
   * @returns The served file; `undefined` when the path is absent or resolves outside the packed folder.
   * @example await files.read('dist/lib.mjs') // => { path: 'dist/lib.mjs', contentType: 'text/javascript; charset=utf-8', … }
   */
  read: (path: string) => Promise<ServedPackedFile | undefined>
  /**
   * Tells why a path that `read` could not serve is absent.
   * @param path - The path below the package folder.
   * @returns `absent` for a missing file or a path outside the folder, `too-large` for a file over the size limit, `unreadable` for a directory or a read error.
   * @example await files.absenceCause('dist/missing.mjs') // => 'absent'
   */
  absenceCause: (path: string) => Promise<PackedFileAbsenceCause>
}>

/**
 * Names one source: the checked-out file when it lies in the packed copy and holds the map's own text, else the packed path.
 * Called by {@link namedMap} for each source of a packed map.
 * @param roots - The packed copy's real folder and the checked-out library's real folder.
 * @param packedPath - The source resolved against the map's folder.
 * @param retained - The map's `sourcesContent` entry for the source.
 * @returns The absolute path the sealed map names the source by, forward slashes.
 * @example await checkedOutNameOf({ packed: '/p', libraryRoot: '/repo/packages/lib' }, '/p/src/a.ts', 'let a') // => '/repo/packages/lib/src/a.ts'
 */
async function checkedOutNameOf(
  roots: { packed: string; libraryRoot: string },
  packedPath: string,
  retained: unknown,
): Promise<string> {
  const fromPacked = relative(roots.packed, packedPath)
  const isInPacked =
    fromPacked !== '' &&
    fromPacked !== '..' &&
    !fromPacked.startsWith(`..${sep}`)
  if (isInPacked && typeof retained === 'string') {
    const checkedOut = join(roots.libraryRoot, fromPacked)
    const text = await readInside(roots.libraryRoot, checkedOut)
    if (text?.toString('utf8') === retained)
      return checkedOut.replaceAll('\\', '/')
  }
  return packedPath.replaceAll('\\', '/')
}

/**
 * Names a map source that is a URL: a `file://` URL by its path, any other scheme as written.
 * Called by {@link namedMap}.
 * @param source - The `sources` entry, a URL.
 * @returns The path for a valid `file://` URL, else the entry unchanged.
 * @example fileUrlSourceName('file:///repo/src/a.ts') // => '/repo/src/a.ts'
 * @example fileUrlSourceName('webpack://lib/src/a.ts') // => 'webpack://lib/src/a.ts'
 */
function fileUrlSourceName(source: string): string {
  if (!source.toLowerCase().startsWith('file:')) return source
  try {
    return fileURLToPath(source).replaceAll('\\', '/')
  } catch {
    return source
  }
}

/**
 * Parses a packed map and names its sources: absolute paths, and the checked-out path where the bytes are equal.
 * Called by {@link createPackedLibraryFiles} for a script whose map the packed copy holds.
 * @param roots - The packed copy's real folder and the checked-out library's real folder.
 * @param mapPath - The map file's absolute path.
 * @param mapBytes - The map file's bytes.
 * @returns The map; `undefined` when it is not a flat version 3 map.
 * @example await namedMap(roots, '/p/dist/a.mjs.map', bytes) // => { version: 3, sources: ['/repo/src/a.ts'], … }
 */
async function namedMap(
  roots: { packed: string; libraryRoot: string },
  mapPath: string,
  mapBytes: Buffer,
): Promise<NonNullable<ServedPackedFile['map']> | undefined> {
  let parsed: {
    version?: unknown
    sources?: unknown
    sourcesContent?: unknown
    names?: unknown
    mappings?: unknown
    file?: unknown
    sourceRoot?: unknown
    sections?: unknown
  }
  try {
    parsed = JSON.parse(mapBytes.toString('utf8'))
  } catch {
    return undefined
  }
  const { sources, mappings } = parsed
  if (
    parsed.version !== 3 ||
    parsed.sections !== undefined ||
    !Array.isArray(sources) ||
    sources.length === 0 ||
    !sources.every((entry) => typeof entry === 'string') ||
    typeof mappings !== 'string' ||
    mappings === ''
  )
    return undefined
  const sourceRoot =
    typeof parsed.sourceRoot === 'string' ? parsed.sourceRoot : ''
  const contents: unknown[] = Array.isArray(parsed.sourcesContent)
    ? parsed.sourcesContent
    : []
  const named: string[] = []
  for (const [index, source] of sources.entries()) {
    // A source given as a URL is not resolved into a path of the packed copy: `file://` becomes its path, any other scheme stays as written.
    if (URL_SOURCE.test(source)) {
      named.push(fileUrlSourceName(source))
      continue
    }
    const packedPath = resolve(dirname(mapPath), sourceRoot, source)
    named.push(await checkedOutNameOf(roots, packedPath, contents[index]))
  }
  return {
    version: 3,
    ...(typeof parsed.file === 'string' ? { file: parsed.file } : {}),
    sources: named,
    ...(Array.isArray(parsed.sourcesContent)
      ? {
          sourcesContent: contents.map((entry) =>
            typeof entry === 'string' ? entry : null,
          ),
        }
      : {}),
    names: Array.isArray(parsed.names)
      ? parsed.names.filter((name) => typeof name === 'string')
      : [],
    mappings,
  }
}

/**
 * Finds the map a script's trailing `sourceMappingURL` names: the map file beside the script, or the base64 JSON map the reference carries inline.
 * Called by {@link createPackedLibraryFiles} for each script that has the comment.
 * @param roots - The packed copy's real folder and the checked-out library's real folder.
 * @param scriptPath - The script's absolute path; sources of an inline map resolve against its folder.
 * @param reference - The `sourceMappingURL` value.
 * @returns The named map; `undefined` when the reference names no readable flat version 3 map (a malformed percent-encoding, an absent file, a data URL that is not base64 JSON, an inline map over the size limit).
 * @example await mapOfReference(roots, '/p/dist/a.mjs', 'a.mjs.map') // => { version: 3, sources: ['/repo/src/a.ts'], … }
 */
async function mapOfReference(
  roots: { packed: string; libraryRoot: string },
  scriptPath: string,
  reference: string,
): Promise<NonNullable<ServedPackedFile['map']> | undefined> {
  if (reference.startsWith('data:')) {
    // A map already inline is decoded and named like an external one.
    const encoded = INLINE_MAP_REFERENCE.exec(reference)?.[1]
    if (encoded === undefined) return undefined
    const decoded = Buffer.from(encoded, 'base64')
    return decoded.length > STATIC_PAGE_CDN_FILE_LIMIT_BYTES
      ? undefined
      : namedMap(roots, scriptPath, decoded)
  }
  let mapName: string
  try {
    mapName = decodeURI(reference)
  } catch {
    // A reference with a malformed percent-encoding names no map file.
    return undefined
  }
  const mapPath = join(dirname(scriptPath), mapName)
  const mapBytes = await readInside(roots.packed, mapPath)
  return mapBytes === undefined ? undefined : namedMap(roots, mapPath, mapBytes)
}

/**
 * Serves the files of the packed copy of a declared library, with a script's source map inlined and its sources named by the checked-out files.
 *
 * Why it exists: js-debug fetches a referenced map itself, outside the browser's network, so only a map carried inside the script reaches it (Cycle 0105 E1). The map's `sources` become absolute paths, and each source whose bytes equal the checked-out file below the library folder is renamed to that file, as the pack route's devtool wrap names it. The redirect and the library seal both read through one instance, so the bytes sealed are the bytes served. Called by the run's library planning ({@link ConfiguredBrowserRun}).
 * @param packedRoot - The packed copy's folder (`<private>/node_modules/<name>`).
 * @param libraryRoot - The checked-out library's real folder.
 * @returns The files, each read once.
 * @example
 * const files = createPackedLibraryFiles('/tmp/run/node_modules/lib', '/repo/packages/lib')
 * (await files.read('dist/lib.mjs'))?.contentType // => 'text/javascript; charset=utf-8'
 */
export function createPackedLibraryFiles(
  packedRoot: string,
  libraryRoot: string,
): PackedLibraryFiles {
  const cache = new Map<string, Promise<ServedPackedFile | undefined>>()
  let realPackedRoot: Promise<string> | undefined
  const readOnce = async (
    path: string,
  ): Promise<ServedPackedFile | undefined> => {
    realPackedRoot ??= realpath(packedRoot)
    const root = await realPackedRoot.catch(() => undefined)
    if (root === undefined || path.includes('\0')) return undefined
    const absolute = resolve(root, path)
    const body = await readInside(root, absolute)
    if (body === undefined) return undefined
    const contentType = contentTypeOfPath(absolute)
    const plain = { path, contentType, body }
    if (!SCRIPT_EXTENSIONS.has(extname(absolute).toLowerCase())) return plain
    const text = body.toString('utf8')
    const reference = TRAILING_MAP_COMMENT.exec(text)?.[1]
    // A script without a map is served as it is.
    if (reference === undefined) return { ...plain, text }
    const map = await mapOfReference(
      { packed: root, libraryRoot },
      absolute,
      reference,
    )
    // A script whose reference names no readable map is served as it is.
    if (map === undefined) return { ...plain, text }
    const inlined = text.replace(
      TRAILING_MAP_COMMENT,
      `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`,
    )
    return { ...plain, body: Buffer.from(inlined, 'utf8'), text: inlined, map }
  }
  const absenceCauseOf = async (
    path: string,
  ): Promise<PackedFileAbsenceCause> => {
    realPackedRoot ??= realpath(packedRoot)
    const root = await realPackedRoot.catch(() => undefined)
    if (root === undefined || path.includes('\0')) return 'absent'
    try {
      const real = await realpath(resolve(root, path))
      if (!isInsideFolder(root, real)) return 'absent'
      const info = await stat(real)
      if (!info.isFile()) return 'unreadable'
      return info.size > STATIC_PAGE_CDN_FILE_LIMIT_BYTES
        ? 'too-large'
        : 'unreadable'
    } catch (error) {
      return error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
        ? 'absent'
        : 'unreadable'
    }
  }
  return {
    absenceCause: absenceCauseOf,
    read(path) {
      let served = cache.get(path)
      if (served === undefined) {
        served = readOnce(path)
        cache.set(path, served)
      }
      return served
    },
  }
}
