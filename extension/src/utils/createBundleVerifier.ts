import { SourceMap, type SourceMapping } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Protocol } from 'devtools-protocol'

import { bundleSchema, mapSchema, type BundleSource } from '../repositoryBundle'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { isCommentAt } from './isCommentAt'
import { isSourcePosition } from './isSourcePosition'
import { sourceMapGeneratedRange } from './sourceMapGeneratedRange'
import { sourceMapMappedPositions } from './sourceMapMappedPositions'
import { walkSourceMapSegments } from './walkSourceMapSegments'

/** Seals one parsed map for {@link ConfiguredBrowserRun} before input, rejecting ambiguous originals without changing legacy verification. @example createBundleVerifier(bundle).hashes.sourceMap.length // 64 */
export function createBundleVerifier(input: BundleSource) {
  const bundle = bundleSchema.parse(input),
    payload = mapSchema.parse(JSON.parse(bundle.sourceMap))
  const originalPath = canonicalSource(bundle.mapSource)
  const matches = payload.sources.flatMap((source, index) =>
    canonicalSource(source) === originalPath ? [index] : [],
  )
  // Aliases to the same original are ambiguous even when their literal map strings differ.
  if (
    matches.length !== 1 ||
    payload.sources.length !== payload.sourcesContent.length
  )
    throw new Error('Missing or ambiguous map source')
  if (payload.sourcesContent[matches[0]!] !== bundle.source)
    throw new Error('Map original differs from frozen source')
  if (canonicalSource(bundle.sourcePath) !== originalPath)
    throw new Error('Map original differs from native source path')
  const sourceMap = new SourceMap(payload)
  // Split once on first use: a scan asks the generated text at every mapping in its range, and a list of break locations asks it for every location.
  let splitGeneratedLines: string[] | undefined
  const generatedLines = (): string[] =>
    (splitGeneratedLines ??= bundle.javascript.split(/\r\n|\r|\n/))
  /** Reads the sealed original position of a generated location for `originalLine` and `originalColumn`; unmapped generated code has none. */
  const originalPosition = (
    location: Pick<Protocol.Debugger.Location, 'lineNumber' | 'columnNumber'>,
  ): { line: number; column: number } | undefined => {
    const generatedColumn = location.columnNumber ?? 0
    // A location past the end of the executed module is no place of it; the once-split lines answer without another pass over the module text.
    if (
      !isColumnOfGeneratedLine(
        generatedLines()[location.lineNumber],
        generatedColumn,
      )
    )
      return undefined
    const mapping = originalMappingOfLine(
      sourceMap,
      location.lineNumber,
      generatedColumn,
      originalPath,
    )
    if (!mapping) return undefined
    return {
      line: mapping.originalLine + 1,
      column: mapping.originalColumn + 1,
    }
  }
  const isCodeAt = (generatedLine: number, generatedColumn: number): boolean =>
    !isCommentAt(generatedLines()[generatedLine], generatedColumn)
  const hashes = Object.freeze({
    typescript: sha256(bundle.source),
    javascript: sha256(bundle.javascript),
    sourceMap: sha256(bundle.sourceMap),
  })
  return {
    hashes,
    /** Reports frozen-map positions in a line range, leaving out mappings onto a comment the generated module kept: preparation asks whether a declared line is mapped at all, the binding rule asks which later line is the first that could run, and a binding failure lists the selected citation's lines as hints; callers must still verify a real pause. @example verifier.mappedPositions(1, 3).positions // [{ line: 1, column: 1 }] */
    mappedPositions(startLine: number, endLine: number) {
      return sourceMapMappedPositions(
        payload.mappings,
        matches[0]!,
        startLine,
        endLine,
        isCodeAt,
      )
    },
    /**
     * Lists every column the sealed map puts code on, on one line of the cited source, so {@link boundColumnOfInstance} can tell which statement of a line another script's map means by a bound column.
     * @param line - One-based line of the sealed original.
     * @returns The distinct one-based original columns of the line's code mappings (a kept comment is no code), ascending; empty for a line the map does not reach.
     * @example
     * verifier.mappedColumnsOfLine(1) // => [1, 9] for a line with two mapped statements
     */
    mappedColumnsOfLine(line: number): number[] {
      const columns = new Set<number>()
      walkSourceMapSegments(
        payload.mappings,
        ({ generatedLine, generatedColumn, original }) => {
          if (!original || original.sourceIndex !== matches[0]) return
          if (
            original.line + 1 === line &&
            isCodeAt(generatedLine, generatedColumn)
          )
            columns.add(original.column + 1)
        },
      )
      return [...columns].sort((left, right) => left - right)
    },
    /**
     * Gives the generated range that holds every place the sealed map puts on one line of the cited source, so {@link ConfiguredBrowserRun} asks the debugger for the break locations of that line instead of the whole module's.
     * @param line - One-based line of the sealed original.
     * @returns The range ({@link sourceMapGeneratedRange}: an exclusive `end` at the end of the span the line's last mapping governs), absent when the scan found no mapping of the line, and whether the scan read the whole map.
     * @example
     * verifier.generatedRangeOfLine(2) // => { range: { start: { lineNumber: 1, columnNumber: 0 }, end: { lineNumber: 2, columnNumber: 0 } }, complete: true }
     */
    generatedRangeOfLine(line: number) {
      return sourceMapGeneratedRange(payload.mappings, matches[0]!, line)
    },
    /**
     * Maps a generated location of this module back to a line of the sealed original, so a pause can be placed in source terms before any debugger frame exists.
     * Called by {@link isPauseAtStop} to tell a declared stop's pause from one the debug adapter makes for itself, and by {@link pausePlace} to name where a participant is paused.
     * @param location - A generated position in this module; a missing column is column 0.
     * @returns
     * - The 1-based original line of the mapping at or before the location on the same generated line
     * - `undefined` for unmapped generated code: before the first mapping of its line, past the end of the module, in a segment without an original, and for a mapping that names another original of the bundle
     * @example
     * verifier.originalLine({ lineNumber: 0, columnNumber: 0 }) // => 1
     */
    originalLine(
      location: Pick<Protocol.Debugger.Location, 'lineNumber' | 'columnNumber'>,
    ): number | undefined {
      return originalPosition(location)?.line
    },
    /**
     * Maps a generated location of this module back to a column of the sealed original, so {@link isPauseAtBoundColumn} can tell the bound position of a stop from another statement on its line.
     * @param location - A generated position in this module; a missing column is column 0.
     * @returns The 1-based original column under the rule of `originalLine`, or `undefined` for unmapped generated code.
     * @example
     * verifier.originalColumn({ lineNumber: 0, columnNumber: 0 }) // => 1
     */
    originalColumn(
      location: Pick<Protocol.Debugger.Location, 'lineNumber' | 'columnNumber'>,
    ): number | undefined {
      return originalPosition(location)?.column
    },
    /**
     * Tells whether a generated location of this module belongs to another original of the bundle, so a pause there is never taken for a stop of this source ({@link ConfiguredBrowserRun} asks before it adopts a held pause).
     * @param location - A generated position in this module; a missing column is column 0.
     * @returns `true` when the nearest mapping at or before the location names another original; `false` for this original and for unmapped code.
     * @example
     * verifier.isInAnotherOriginal({ lineNumber: 2, columnNumber: 0 }) // => true where the map puts generated line 2 in other.tsx
     */
    isInAnotherOriginal(
      location: Pick<Protocol.Debugger.Location, 'lineNumber' | 'columnNumber'>,
    ): boolean {
      const mapping = sourceMap.findEntry(
        location.lineNumber,
        location.columnNumber ?? 0,
      )
      return (
        'originalSource' in mapping &&
        typeof mapping.originalSource === 'string' &&
        !isSameOriginal(mapping.originalSource, originalPath)
      )
    },
    /** Confirms exact source and generated coordinates for the guarded paused inspector. @example verifier.verify(js, tsx, location, 'script-1', 19, 5) */
    verify(
      executed: string,
      local: string,
      location: Protocol.Debugger.Location,
      scriptId: string,
      frameLine: number,
      frameColumn: number,
    ) {
      if (sha256(executed) !== hashes.javascript)
        throw new Error('Executed JavaScript differs from frozen module')
      if (sha256(local) !== hashes.typescript)
        throw new Error('Current original differs from frozen source')
      if (location.scriptId !== scriptId)
        throw new Error('Paused script differs from selected module')
      if (
        !isSourcePosition(
          bundle.javascript,
          location.lineNumber,
          location.columnNumber ?? 0,
        )
      )
        throw new Error('Generated position is outside executed source')
      if (!isSourcePosition(bundle.source, frameLine - 1, frameColumn - 1))
        throw new Error('DAP position is outside original source')
      const mapping = sourceMap.findEntry(
        location.lineNumber,
        location.columnNumber ?? 0,
      )
      if (
        !('originalSource' in mapping) ||
        canonicalSource(mapping.originalSource) !== originalPath ||
        mapping.originalLine + 1 !== frameLine ||
        mapping.originalColumn + 1 !== frameColumn
      )
        throw new Error(
          'Generated location does not match exact DAP source position',
        )
      return { ...hashes, scriptId, scriptLocation: location, mapping }
    },
  }
}

/**
 * Says whether a generated column lies on a generated line of the executed module; called by the `originalPosition` reader of {@link createBundleVerifier} before the map is asked.
 * @param generatedLineText - The text of the generated line, `undefined` for a line past the end of the module.
 * @param generatedColumn - The zero-based generated column; the column right after the last character still counts.
 * @returns
 * - `true` for a safe integer from 0 to the line's length on a line the module has
 * - `false` otherwise: the location is no place of the module
 * @example
 * isColumnOfGeneratedLine('const a = 1', 11) // => true
 * isColumnOfGeneratedLine(undefined, 0)      // => false
 */
function isColumnOfGeneratedLine(
  generatedLineText: string | undefined,
  generatedColumn: number,
): boolean {
  return (
    generatedLineText !== undefined &&
    Number.isSafeInteger(generatedColumn) &&
    generatedColumn >= 0 &&
    generatedColumn <= generatedLineText.length
  )
}

/**
 * Narrows what the map answered to a mapping that names an original; called by {@link originalMappingOfLine}.
 * @param entry - The answer of {@link SourceMap.findEntry}: a mapping, or an empty object where the map has none.
 * @returns
 * - The mapping when it carries an original source as a string
 * - `undefined` for an empty answer and for a segment without an original
 * @example
 * sourceMappingOf({}) // => undefined
 */
function sourceMappingOf(
  entry: ReturnType<SourceMap['findEntry']>,
): SourceMapping | undefined {
  return 'originalSource' in entry && typeof entry.originalSource === 'string'
    ? entry
    : undefined
}

/**
 * Reads the mapping of a generated location onto this module's original; called by the `originalPosition` reader of {@link createBundleVerifier}.
 * @param sourceMap - The sealed map.
 * @param generatedLine - The zero-based generated line of the location.
 * @param generatedColumn - The zero-based generated column of the location.
 * @param originalPath - The canonical path of this module's original.
 * @returns
 * - The mapping when it lies on the same generated line and names this module's original
 * - `undefined` otherwise: the map answers the nearest earlier mapping, also one of an earlier generated line or a segment without an original, and either means the location itself is unmapped code
 * @example
 * originalMappingOfLine(sourceMap, 0, 4, '/src/theme.tsx') // => { generatedLine: 0, generatedColumn: 0, originalSource: '/src/theme.tsx', originalLine: 0, originalColumn: 0 }
 */
function originalMappingOfLine(
  sourceMap: SourceMap,
  generatedLine: number,
  generatedColumn: number,
  originalPath: string,
): SourceMapping | undefined {
  const mapping = sourceMappingOf(
    sourceMap.findEntry(generatedLine, generatedColumn),
  )
  // The map answers the nearest earlier mapping, also one of an earlier generated line or a segment without an original: either means the location itself is unmapped code.
  if (
    !mapping ||
    mapping.generatedLine !== generatedLine ||
    !isSameOriginal(mapping.originalSource, originalPath)
  )
    return undefined
  return mapping
}

/** Compares a mapping's original with this module's for {@link createBundleVerifier}; an original that cannot be canonicalized is another one, so a pause handler that asks never throws. @example isSameOriginal('/src/./theme.tsx', '/src/theme.tsx') // true */
function isSameOriginal(source: string, originalPath: string): boolean {
  try {
    return canonicalSource(source) === originalPath
  } catch {
    return false
  }
}

/** Canonicalizes only declared local/file originals for {@link createBundleVerifier}; foreign URLs remain distinct. @example canonicalSource('/src/./theme.tsx') // '/src/theme.tsx' */
function canonicalSource(source: string): string {
  if (source.startsWith('file://')) return resolve(fileURLToPath(source))
  if (/^[a-z][a-z\d+.-]*:/i.test(source)) return new URL(source).href
  if (!source.startsWith('/'))
    throw new Error('Unsupported relative map original')
  return resolve(source)
}
