import { sameScriptUrl } from './sameScriptUrl';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { mapSchema, type BundleSource } from '../repositoryBundle';
import { REPOSITORY_DISCOVERY_TIMEOUT_MS, REPOSITORY_JAVASCRIPT_LIMIT_BYTES, REPOSITORY_MAP_LIMIT_BYTES } from '../constants';

/** Extracts JSON string payloads without executing webpack code for pre-input acquisition by {@link readDevelopmentBundle}. @example extractDevelopmentModule(chunk, sourcePath, source, chunkPath, scriptUrl) */
export function extractDevelopmentModule(chunk: string, sourcePath: string, source: string, chunkPath: string, scriptUrl: string, deadline = performance.now() + REPOSITORY_DISCOVERY_TIMEOUT_MS): BundleSource | undefined {
  if (Buffer.byteLength(chunk) > REPOSITORY_JAVASCRIPT_LIMIT_BYTES) throw new Error('Application chunk exceeds byte limit');
  const candidates: BundleSource[] = [];
  // Accept only the two observed webpack eval literal forms; JSON decoding never invokes the application.
  const literals = chunk.matchAll(/eval\((?:__webpack_require__\.ts\()?((?:"(?:[^"\\]|\\.)*"))\)/g);
  for (const literal of literals) {
    if (performance.now() >= deadline) throw new Error('Module discovery deadline exceeded');
    const javascript: string = JSON.parse(literal[1]!);
    const urls = [...javascript.matchAll(/^\/\/# sourceURL=(.+)$/gm)];
    if (!urls.some(url => sameScriptUrl(scriptUrl, url[1]!))) continue;
    // Next webpack emits a non-identifying placeholder before the effective final script URL.
    if (!sameScriptUrl(scriptUrl, urls.at(-1)![1]!) || urls.slice(0, -1).some(url => url[1] !== '[module]')) throw new Error('Module has ambiguous script identity');
    const encodedMaps = [...javascript.matchAll(/^\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([A-Za-z\d+/=]+)$/gm)];
    if (encodedMaps.length !== 1) throw new Error('Module has missing or ambiguous inline maps');
    const mapBytes = Buffer.from(encodedMaps[0]![1]!, 'base64');
    if (mapBytes.byteLength > REPOSITORY_MAP_LIMIT_BYTES) throw new Error('Inline map exceeds byte limit');
    if (mapBytes.toString('base64') !== encodedMaps[0]![1]) throw new Error('Inline map encoding is malformed');
    const sourceMap = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(mapBytes), payload = mapSchema.parse(JSON.parse(sourceMap));
    if (!payload.sources.includes(sourcePath)) throw new Error('Selected module does not name the exact original');
    candidates.push({ sourcePath, source, sourceMap, javascript, mapSource: sourcePath, scriptUrl, chunkPath, chunkHash: sha256(chunk) });
  }
  if (performance.now() >= deadline) throw new Error('Module discovery deadline exceeded');
  if (candidates.length > 1) throw new Error('Ambiguous evaluated module');
  return candidates[0];
}
