import { SourceMap } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Protocol } from 'devtools-protocol';
import { sha256 } from '../runtimeSupport/utils/sha256';
import { bundleSchema, mapSchema, type BundleSource } from '../repositoryBundle';
import { isSourcePosition } from './isSourcePosition';
import { sourceMapMappedPositions } from './sourceMapMappedPositions';

/** Seals one parsed map for {@link ConfiguredBrowserRun} before input, rejecting ambiguous originals without changing legacy verification. @example createBundleVerifier(bundle).hashes.sourceMap.length // 64 */
export function createBundleVerifier(input: BundleSource) {
  const bundle = bundleSchema.parse(input), payload = mapSchema.parse(JSON.parse(bundle.sourceMap));
  const originalPath = canonicalSource(bundle.mapSource);
  const matches = payload.sources.flatMap((source, index) => canonicalSource(source) === originalPath ? [index] : []);
  // Aliases to the same original are ambiguous even when their literal map strings differ.
  if (matches.length !== 1 || payload.sources.length !== payload.sourcesContent.length) throw new Error('Missing or ambiguous map source');
  if (payload.sourcesContent[matches[0]!] !== bundle.source) throw new Error('Map original differs from frozen source');
  if (canonicalSource(bundle.sourcePath) !== originalPath) throw new Error('Map original differs from native source path');
  const sourceMap = new SourceMap(payload);
  const hashes = Object.freeze({ typescript: sha256(bundle.source), javascript: sha256(bundle.javascript), sourceMap: sha256(bundle.sourceMap) });
  return {
    hashes,
    /** Reports frozen-map positions inside the selected citation after an exact binding timeout; callers must still verify a real pause. @example verifier.mappedPositions(1, 3).positions // [{ line: 1, column: 1 }] */
    mappedPositions(startLine: number, endLine: number) { return sourceMapMappedPositions(payload.mappings, matches[0]!, startLine, endLine); },
    /** Checks an exact original position before registering a lazy native breakpoint; does not prove a runtime binding. @example verifier.hasMappedPosition(19, 5) */
    hasMappedPosition(line: number, column: number): boolean { return sourceMapMappedPositions(payload.mappings, matches[0]!, line, line, column).positions.some(position => position.line === line && position.column === column); },
    /** Confirms exact source and generated coordinates for the guarded paused inspector. @example verifier.verify(js, tsx, location, 'script-1', 19, 5) */
    verify(executed: string, local: string, location: Protocol.Debugger.Location, scriptId: string, frameLine: number, frameColumn: number) {
      if (sha256(executed) !== hashes.javascript) throw new Error('Executed JavaScript differs from frozen module');
      if (sha256(local) !== hashes.typescript) throw new Error('Current original differs from frozen source');
      if (location.scriptId !== scriptId) throw new Error('Paused script differs from selected module');
      if (!isSourcePosition(bundle.javascript, location.lineNumber, location.columnNumber ?? 0)) throw new Error('Generated position is outside executed source');
      if (!isSourcePosition(bundle.source, frameLine - 1, frameColumn - 1)) throw new Error('DAP position is outside original source');
      const mapping = sourceMap.findEntry(location.lineNumber, location.columnNumber ?? 0);
      if (!('originalSource' in mapping) || canonicalSource(mapping.originalSource) !== originalPath || mapping.originalLine + 1 !== frameLine || mapping.originalColumn + 1 !== frameColumn) throw new Error('Generated location does not match exact DAP source position');
      return { ...hashes, scriptId, scriptLocation: location, mapping };
    },
  };
}

/** Canonicalizes only declared local/file originals for {@link createBundleVerifier}; foreign URLs remain distinct. @example canonicalSource('/src/./theme.tsx') // '/src/theme.tsx' */
function canonicalSource(source: string): string {
  if (source.startsWith('file://')) return resolve(fileURLToPath(source));
  if (/^[a-z][a-z\d+.-]*:/i.test(source)) return new URL(source).href;
  if (!source.startsWith('/')) throw new Error('Unsupported relative map original');
  return resolve(source);
}
