/** A flat version 3 source map reduced to the fields stop resolution reads. */
export interface FlatSourceMap {
  sources: readonly string[]
  /** The map's `sourceRoot`, or the empty string when it has none. */
  sourceRoot: string
  /** One entry per source; `null` where the build embedded no text. `undefined` when the map has no usable `sourcesContent` at all. */
  sourcesContent: readonly (string | null)[] | undefined
}

/** Why a map text yields no sources: `indexed` maps (with `sections`) are not read; everything else unparseable is `malformed`. */
export type FlatSourceMapProblem = 'indexed' | 'malformed'

/** Narrows an unknown JSON value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parses the text of a source map and accepts only a flat version 3 map.
 * Why: a `wxt-build` stop resolves through the sources a build's maps list, and an indexed map's sections are not read, so such a map lists nothing instead of a guess.
 * Called by {@link readChunkSourceMap} for every map a loaded chunk names.
 * @param text - The map file's text or a decoded `data:` map.
 * @returns
 * - The map's sources, `sourceRoot` and `sourcesContent` for a flat version 3 map
 * - `'indexed'` for a map with `sections`
 * - `'malformed'` for text that is not JSON, not version 3, or whose `sources` is not a list of strings and nulls (a `null` source is skipped)
 * @example
 * parseFlatSourceMap('{"version":3,"sources":["../src/a.ts"],"mappings":""}')
 * // => { sources: ['../src/a.ts'], sourceRoot: '', sourcesContent: undefined }
 * parseFlatSourceMap('{"version":3,"sections":[]}') // => 'indexed'
 */
export function parseFlatSourceMap(
  text: string,
): FlatSourceMap | FlatSourceMapProblem {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return 'malformed'
  }
  if (!isRecord(parsed) || parsed.version !== 3) return 'malformed'
  // An indexed map nests its maps in `sections`; this version lists nothing for it.
  if ('sections' in parsed) return 'indexed'
  const { sources, sourceRoot, sourcesContent } = parsed
  if (
    !Array.isArray(sources) ||
    !sources.every((source) => typeof source === 'string' || source === null)
  )
    return 'malformed'
  const content =
    Array.isArray(sourcesContent) &&
    sourcesContent.every((entry) => typeof entry === 'string' || entry === null)
      ? sourcesContent
      : undefined
  // The spec allows a `null` source; skip it and keep `sourcesContent` aligned by index.
  const keptSources: string[] = []
  const keptContent: (string | null)[] = []
  sources.forEach((source, index) => {
    if (typeof source !== 'string') return
    keptSources.push(source)
    keptContent.push(content?.[index] ?? null)
  })
  return {
    sources: keptSources,
    sourceRoot: typeof sourceRoot === 'string' ? sourceRoot : '',
    sourcesContent: content && keptContent,
  }
}
