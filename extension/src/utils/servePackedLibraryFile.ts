import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'

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

/** The packed copy's files as the browser receives them, read once each. */
export type PackedLibraryFiles = Readonly<{
  /**
   * Reads one file of the packed copy as the browser receives it.
   * @param path - The path below the package folder.
   * @returns The served file; `undefined` when the path is absent or resolves outside the packed folder.
   * @example await files.read('dist/lib.mjs') // => { path: 'dist/lib.mjs', contentType: 'text/javascript; charset=utf-8', … }
   */
  read: (path: string) => Promise<ServedPackedFile | undefined>
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
    // A script without a map, or with a map already inline, is served as it is.
    if (reference === undefined || reference.startsWith('data:'))
      return { ...plain, text }
    const mapPath = join(dirname(absolute), decodeURI(reference))
    const mapBytes = await readInside(root, mapPath)
    const map =
      mapBytes === undefined
        ? undefined
        : await namedMap({ packed: root, libraryRoot }, mapPath, mapBytes)
    if (map === undefined) return { ...plain, text }
    const inlined = text.replace(
      TRAILING_MAP_COMMENT,
      `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`,
    )
    return { ...plain, body: Buffer.from(inlined, 'utf8'), text: inlined, map }
  }
  return {
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
