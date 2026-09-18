import { SourceMap, type SourceMapPayload } from 'node:module';
import type { Protocol } from 'devtools-protocol';
import type { SealedSource } from './inspect';
import { sha256 } from './utils/sha256';

/** Verifies executable/map/original correspondence for paused inspectors after their target/frame guards. @example verifySource(seal, executed, local, location, 9, '../fixture/cart.ts') */
export function verifySource(source: SealedSource, executed: string, local: string, location: Protocol.Debugger.Location, frameLine: number, mapSourcePath: string) {
  if (sha256(executed) !== sha256(source.javascript)) throw new Error('Executed JavaScript does not match the sealed build');
  if (sha256(local) !== sha256(source.source)) throw new Error('Local TypeScript changed after the build was sealed');
  const payload: SourceMapPayload = JSON.parse(source.sourceMap);
  if (payload.sources.length !== 1 || payload.sources[0] !== mapSourcePath || payload.sourcesContent?.[0] !== source.source) throw new Error('Source map does not contain the sealed TypeScript');
  const mapping = new SourceMap(payload).findEntry(location.lineNumber, location.columnNumber ?? 0);
  if (!('originalLine' in mapping) || mapping.originalLine + 1 !== frameLine) throw new Error('Executed JavaScript does not map to the DAP TypeScript stop');
  return { scriptId: location.scriptId, scriptLocation: location, mapping, typescriptHash: sha256(source.source), javascriptHash: sha256(executed), sourceMapHash: sha256(source.sourceMap) };
}
