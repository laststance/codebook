import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** How deep an indexed map's sections may nest before the map counts as unreadable. */
const LIBRARY_SECTION_DEPTH_LIMIT = 8

/** Whether a value is a plain object. @example isRecord({}) // => true */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Turns a `file://` URL or an absolute path into the absolute path a debugger would bind, or `undefined` for anything else (a relative path, a `webpack://` URL).
 * @param text - A `sourceRoot` or a source as the map writes it.
 * @returns The resolved path; `null` when a `file://` URL cannot be converted (callers fail closed).
 * @example absolutePathOf('file:///repo/a/../src/core.ts') // => '/repo/src/core.ts'
 */
function absolutePathOf(text: string): string | undefined | null {
  if (/^file:/i.test(text)) {
    try {
      return resolve(fileURLToPath(text))
    } catch {
      return null
    }
  }
  return isAbsolute(text) ? resolve(text) : undefined
}

/**
 * Tells whether one parsed source map (or an indexed map's sections, recursively) may name one of the given files; fails closed.
 *
 * Why it exists: the App Router seal refuses a stop when another module of the chunk set could bind a breakpoint on the same file, and a competing map may spell the file with `sourceRoot` plus a relative source, a `file://` URL or inside an indexed map's sections. Called by {@link sourceMapTextMayNamePath}.
 * @param map - The parsed JSON of a source map.
 * @param paths - Absolute paths that would bind the stop file.
 * @param depth - How deep the sections nest so far.
 * @returns `true` when a source resolves to one of the paths, or when a part cannot be read (external section `url`, malformed shape, unconvertible URL, too deep); `false` for a readable map that names none.
 * @example sourceMapMayNamePath({ sourceRoot: '/repo/src', sources: ['core.ts'] }, ['/repo/src/core.ts']) // => true
 */
function sourceMapMayNamePath(
  map: unknown,
  paths: readonly string[],
  depth = 0,
): boolean {
  if (!isRecord(map) || depth > LIBRARY_SECTION_DEPTH_LIMIT) return true
  // An indexed map: every section's own map is read; an external url cannot be.
  if (Array.isArray(map.sections))
    return map.sections.some(
      (section: unknown) =>
        !isRecord(section) ||
        typeof section.url === 'string' ||
        sourceMapMayNamePath(section.map, paths, depth + 1),
    )
  if (!Array.isArray(map.sources)) return true
  const root =
    typeof map.sourceRoot === 'string' && map.sourceRoot !== ''
      ? absolutePathOf(map.sourceRoot)
      : undefined
  // A root that cannot be converted may point anywhere.
  if (root === null) return true
  return map.sources.some((source: unknown) => {
    // A null source names no file.
    if (source === null) return false
    if (typeof source !== 'string') return true
    if (paths.includes(source)) return true
    const own = absolutePathOf(source)
    if (own === null) return true
    // An absolute source ignores the root; a relative one is joined to an absolute root.
    const spelled =
      own ?? (root === undefined ? undefined : resolve(root, source))
    return spelled !== undefined && paths.includes(spelled)
  })
}

/**
 * Parses a source map text and runs {@link sourceMapMayNamePath}; text that is not JSON counts as possibly naming the file.
 * @param mapText - The decoded map text.
 * @param paths - Absolute paths that would bind the stop file.
 * @returns See {@link sourceMapMayNamePath}; `true` for text that is not JSON.
 * @example sourceMapTextMayNamePath('not json', ['/repo/src/core.ts']) // => true
 */
export function sourceMapTextMayNamePath(
  mapText: string,
  paths: readonly string[],
): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(mapText)
  } catch {
    return true
  }
  return sourceMapMayNamePath(parsed, paths)
}
