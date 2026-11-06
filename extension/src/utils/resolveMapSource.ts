import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** A URL scheme at the start of a source, such as `webpack:` or `file:`. */
const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/

/**
 * Resolves one source entry of a source map to an absolute path: `sourceRoot` plus the source, URL-decoded, against the map's folder.
 * Why: a build's maps name project files relative to the map (`../../src/App.tsx`), possibly with a `sourceRoot` and percent-encoded characters, and a stop is matched by the absolute path.
 * Called by {@link listMappedSources} for every source of every map a loaded chunk names.
 * @param mapFolder - The folder the map file lies in (for a `data:` map, the chunk's folder).
 * @param sourceRoot - The map's `sourceRoot`, or the empty string.
 * @param source - One entry of the map's `sources`.
 * @returns
 * - The normalized absolute path for a relative, root-absolute or `file:` source
 * - `undefined` for another URL scheme (`webpack:`, `http:`) or an entry that is not valid URL encoding
 * @example
 * resolveMapSource('/out/assets', '', '../../src/My%20App.tsx') // => '/src/My App.tsx'
 * resolveMapSource('/out', 'src/', 'a.ts')                       // => '/out/src/a.ts'
 * resolveMapSource('/out', '', 'webpack://app/a.ts')             // => undefined
 */
export function resolveMapSource(
  mapFolder: string,
  sourceRoot: string,
  source: string,
): string | undefined {
  // An absolute source ignores the root; a relative one is appended to it.
  const isAbsoluteSource = source.startsWith('/') || URL_SCHEME.test(source)
  const separator = sourceRoot === '' || sourceRoot.endsWith('/') ? '' : '/'
  const joined = isAbsoluteSource
    ? source
    : `${sourceRoot}${separator}${source}`
  try {
    if (joined.startsWith('file:')) return resolve(fileURLToPath(joined))
    if (URL_SCHEME.test(joined)) return undefined
    return resolve(mapFolder, decodeURIComponent(joined))
  } catch {
    // A malformed percent sequence or file url names no file.
    return undefined
  }
}
