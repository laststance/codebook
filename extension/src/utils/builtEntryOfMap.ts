import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The parts of a source map {@link builtEntryOfMap} reads. */
export type BuiltEntryMap = {
  sources: readonly string[]
  sourcesContent: readonly (string | null | undefined)[]
}

/**
 * Normalizes one map `sources` spelling to an absolute path: strips `file://`, resolves a relative spelling against the repository root.
 * Used by {@link builtEntryOfMap} so a spelling that differs from the module selection's exact path still names the same file.
 * @param source - A `sources` entry or the built file's path.
 * @param root - The directory a relative spelling resolves against.
 * @returns The absolute, normalized path.
 * @example normalizedSource('file:///repo/lib/build/core.js', '/repo') // => '/repo/lib/build/core.js'
 */
function normalizedSource(source: string, root: string): string {
  if (source.startsWith('file://')) return resolve(fileURLToPath(source))
  return isAbsolute(source) ? resolve(source) : resolve(root, source)
}

/**
 * Reads the retained text of the built file from an eval module's inline map, whichever way the map spells the file.
 *
 * Why it exists: the library seal compares the retained built text against the frozen build, and a lookup that misses the entry must not read as "the build changed". Called by {@link sealLibraryStop}.
 * @param map - The module's parsed inline map.
 * @param builtFile - The absolute built file the module was selected for.
 * @param root - The directory a relative `sources` spelling resolves against.
 * @returns The retained text, or `undefined` when no entry names the file or its `sourcesContent` entry is missing.
 * @example
 * builtEntryOfMap({ sources: ['/repo/lib/core.js'], sourcesContent: ['x'] }, '/repo/lib/core.js', '/repo') // => 'x'
 */
export function builtEntryOfMap(
  map: BuiltEntryMap,
  builtFile: string,
  root: string,
): string | undefined {
  const wanted = normalizedSource(builtFile, root)
  // An exact spelling wins; otherwise compare the normalized spellings.
  const exact = map.sources.indexOf(builtFile)
  const index =
    exact >= 0
      ? exact
      : map.sources.findIndex((source) => {
          try {
            return normalizedSource(source, root) === wanted
          } catch {
            // A malformed file:// URL names no file.
            return false
          }
        })
  const content = index >= 0 ? map.sourcesContent[index] : undefined
  return typeof content === 'string' ? content : undefined
}
