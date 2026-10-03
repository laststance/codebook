import { SourceMap } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Protocol } from 'devtools-protocol'

import { bundleSchema, mapSchema, type BundleSource } from '../repositoryBundle'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { isCommentAt } from './isCommentAt'
import { isSourcePosition } from './isSourcePosition'
import { sourceMapMappedPositions } from './sourceMapMappedPositions'

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
  // Split once on first use: a scan asks the generated text at every mapping in its range.
  let generatedLines: string[] | undefined
  const isCodeAt = (generatedLine: number, generatedColumn: number): boolean =>
    !isCommentAt(
      (generatedLines ??= bundle.javascript.split(/\r\n|\r|\n/))[generatedLine],
      generatedColumn,
    )
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
     * Maps a generated location of this module back to a line of the sealed original, so a pause can be placed in source terms before any debugger frame exists.
     * Called by {@link isPauseAtStop} to tell a declared stop's pause from one the debug adapter makes for itself, and by {@link pausePlace} to name where a participant is paused.
     * @param location - A generated position in this module; a missing column is column 0.
     * @returns
     * - The 1-based original line of the nearest mapping at or before the location
     * - `undefined` before the first mapping, and for a mapping that names another original of the bundle
     * @example
     * verifier.originalLine({ lineNumber: 0, columnNumber: 0 }) // => 1
     */
    originalLine(
      location: Pick<Protocol.Debugger.Location, 'lineNumber' | 'columnNumber'>,
    ): number | undefined {
      const mapping = sourceMap.findEntry(
        location.lineNumber,
        location.columnNumber ?? 0,
      )
      // The map answers the nearest earlier mapping, so only a location before the first one has no entry.
      if (
        !('originalSource' in mapping) ||
        !isSameOriginal(mapping.originalSource, originalPath)
      )
        return undefined
      return mapping.originalLine + 1
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
