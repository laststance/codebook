import {
  REPOSITORY_CHUNK_LIMIT_BYTES,
  REPOSITORY_DISCOVERY_TIMEOUT_MS,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
  REPOSITORY_MAP_LIMIT_BYTES,
} from '../constants'
import { mapSchema, type BundleSource } from '../repositoryBundle'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { sameScriptUrl } from './sameScriptUrl'

/** Extracts JSON string payloads without executing webpack code for pre-input acquisition by {@link readDevelopmentBundle}. @example extractDevelopmentModule(chunk, sourcePath, source, chunkPath, scriptUrl) */
export function extractDevelopmentModule(
  chunk: string,
  sourcePath: string,
  source: string,
  chunkPath: string,
  scriptUrl: string,
  deadline = performance.now() + REPOSITORY_DISCOVERY_TIMEOUT_MS,
): BundleSource | undefined {
  if (Buffer.byteLength(chunk) > REPOSITORY_CHUNK_LIMIT_BYTES)
    throw new Error('Application chunk exceeds byte limit')
  const candidates: BundleSource[] = []
  // Scan the two webpack eval literal forms without recursive regexp matching on large chunks.
  const literals = webpackEvalLiterals(chunk),
    chunkHash = sha256(chunk)
  for (const literal of literals) {
    if (performance.now() >= deadline)
      throw new Error('Module discovery deadline exceeded')
    const bundle = bundleOfEvaluatedModule(
      JSON.parse(literal),
      sourcePath,
      source,
      chunkPath,
      chunkHash,
      scriptUrl,
    )
    if (bundle) candidates.push(bundle)
  }
  if (performance.now() >= deadline)
    throw new Error('Module discovery deadline exceeded')
  if (candidates.length > 1) throw new Error('Ambiguous evaluated module')
  return candidates[0]
}

/**
 * Reads one evaluated webpack module's text (its code, `sourceURL` and inline source map) as a sealed bundle of a cited original, for {@link extractDevelopmentModule} (each eval literal of a built chunk) and {@link sealRuntimeModuleInstance} (the text a runtime reports for a script it parsed).
 * @param javascript - The evaluated module text.
 * @param sourcePath - The absolute path of the cited original.
 * @param source - The frozen text of the cited original.
 * @param chunkPath - The built chunk the module was acquired from, kept as the bundle's identity.
 * @param chunkHash - The SHA-256 of that chunk.
 * @param scriptUrl - The script address the module must carry as its effective `sourceURL`.
 * @returns The bundle, or `undefined` when the module carries another script address.
 * @throws When the module's script identity or inline map is ambiguous, malformed or over its byte limit, or its map does not name the exact original.
 * @example
 * ```ts
 * bundleOfEvaluatedModule(text, '/repo/auth.ts', source, chunkPath, chunkHash, 'webpack-internal:///(middleware)/./auth.ts')
 * ```
 */
export function bundleOfEvaluatedModule(
  javascript: string,
  sourcePath: string,
  source: string,
  chunkPath: string,
  chunkHash: string,
  scriptUrl: string,
): BundleSource | undefined {
  const urls = [...javascript.matchAll(/^\/\/# sourceURL=(.+)$/gm)]
  if (!urls.some((url) => sameScriptUrl(scriptUrl, url[1]!))) return undefined
  if (Buffer.byteLength(javascript) > REPOSITORY_JAVASCRIPT_LIMIT_BYTES)
    throw new Error('Selected JavaScript module exceeds byte limit')
  // Next webpack emits a non-identifying placeholder before the effective final script URL.
  if (
    !sameScriptUrl(scriptUrl, urls.at(-1)![1]!) ||
    urls.slice(0, -1).some((url) => url[1] !== '[module]')
  )
    throw new Error('Module has ambiguous script identity')
  const encodedMaps = [
    ...javascript.matchAll(
      /^\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([A-Za-z\d+/=]+)$/gm,
    ),
  ]
  if (encodedMaps.length !== 1)
    throw new Error('Module has missing or ambiguous inline maps')
  const mapBytes = Buffer.from(encodedMaps[0]![1]!, 'base64')
  if (mapBytes.byteLength > REPOSITORY_MAP_LIMIT_BYTES)
    throw new Error('Inline map exceeds byte limit')
  if (mapBytes.toString('base64') !== encodedMaps[0]![1])
    throw new Error('Inline map encoding is malformed')
  const sourceMap = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(mapBytes),
    payload = mapSchema.parse(JSON.parse(sourceMap))
  if (!payload.sources.includes(sourcePath))
    throw new Error('Selected module does not name the exact original')
  return {
    sourcePath,
    source,
    sourceMap,
    javascript,
    mapSource: sourcePath,
    scriptUrl,
    chunkPath,
    chunkHash,
  }
}

/** Scans large webpack chunks for {@link extractDevelopmentModule} without executing payloads or recursive regexp matching. @example [...webpackEvalLiterals('eval("work()");')] */
function* webpackEvalLiterals(chunk: string): Generator<string> {
  const trustedTypesPrefix = '__webpack_require__.ts('
  let offset = 0
  while ((offset = chunk.indexOf('eval(', offset)) !== -1) {
    offset += 5
    const trustedTypes = chunk.startsWith(trustedTypesPrefix, offset)
    if (trustedTypes) offset += trustedTypesPrefix.length
    if (chunk[offset] !== '"') continue
    const start = offset++
    let escaped = false,
      closed = false
    while (offset < chunk.length) {
      const character = chunk[offset++]
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character === '"') {
        closed = true
        break
      }
    }
    if (
      !closed ||
      chunk[offset] !== ')' ||
      (trustedTypes && chunk[offset + 1] !== ')')
    )
      continue
    yield chunk.slice(start, offset)
    offset += trustedTypes ? 2 : 1
  }
}
