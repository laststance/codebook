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
  // The generator decodes one literal at a time, so each module is read right after its own literal, as before the split.
  return selectEvaluatedModule(
    evaluatedModuleTexts(chunk, deadline),
    { sourcePath, source, chunkPath, chunkHash: sha256(chunk) },
    scriptUrl,
    deadline,
  )
}

/**
 * Decodes every webpack eval literal of a built chunk into the module text it would evaluate, without executing any of it.
 * Called by {@link extractDevelopmentModule} for one stop, and by {@link readNextChunkModules}, which keeps a Pages chunk's decoded modules for every stop of a run.
 * @param chunk - The built chunk's text.
 * @param deadline - The `performance.now()` time after which decoding stops.
 * @returns The module texts, one per eval literal, in chunk order (lazily, as a generator).
 * @throws When the chunk exceeds {@link REPOSITORY_CHUNK_LIMIT_BYTES}, a literal is no JSON string, or the deadline passes.
 * @example
 * [...evaluatedModuleTexts('eval("work();");', performance.now() + 1000)] // => ['work();']
 */
export function* evaluatedModuleTexts(
  chunk: string,
  deadline: number,
): Generator<string> {
  if (Buffer.byteLength(chunk) > REPOSITORY_CHUNK_LIMIT_BYTES)
    throw new Error('Application chunk exceeds byte limit')
  // Scan the two webpack eval literal forms without recursive regexp matching on large chunks.
  for (const literal of webpackEvalLiterals(chunk)) {
    if (performance.now() >= deadline)
      throw new Error('Module discovery deadline exceeded')
    yield JSON.parse(literal)
  }
}

/**
 * Picks the one evaluated module that carries a script address, as the sealed bundle of a cited original.
 * Called by {@link extractDevelopmentModule} and by the Pages readers ({@link readPagesDevelopmentBundle}, {@link readNextServerOnlyReason}) over a chunk's decoded modules.
 * @param moduleTexts - The decoded modules of one chunk ({@link evaluatedModuleTexts}).
 * @param identity - The cited original and the chunk the modules came from, as {@link bundleOfEvaluatedModule} takes it.
 * @param scriptUrl - The script address the module must carry as its effective `sourceURL`.
 * @param deadline - The `performance.now()` time after which the search stops.
 * @returns The sealed bundle, or `undefined` when no module of the chunk carries the address.
 * @throws When two modules carry the address, a module's identity or map is malformed, or the deadline passes.
 * @example
 * selectEvaluatedModule(texts, { sourcePath, source, chunkPath, chunkHash }, 'webpack-internal:///(pages-dir-browser)/./src/pages/index.tsx', deadline)?.scriptUrl
 * // => 'webpack-internal:///(pages-dir-browser)/./src/pages/index.tsx'
 */
export function selectEvaluatedModule(
  moduleTexts: Iterable<string>,
  identity: Pick<
    BundleSource,
    'sourcePath' | 'source' | 'chunkPath' | 'chunkHash'
  >,
  scriptUrl: string,
  deadline: number,
): BundleSource | undefined {
  const candidates: BundleSource[] = []
  for (const javascript of moduleTexts) {
    if (performance.now() >= deadline)
      throw new Error('Module discovery deadline exceeded')
    const bundle = bundleOfEvaluatedModule(javascript, identity, scriptUrl)
    if (bundle) candidates.push(bundle)
  }
  if (performance.now() >= deadline)
    throw new Error('Module discovery deadline exceeded')
  if (candidates.length > 1) throw new Error('Ambiguous evaluated module')
  return candidates[0]
}

/**
 * Reads one evaluated webpack module's text (its code, `sourceURL` and inline source map) as a sealed bundle of a cited original, for {@link extractDevelopmentModule} (each eval literal of a built chunk) and {@link ConfiguredBrowserRun}'s sealing of a runtime instance (the text a runtime reports for a script it parsed).
 * An instance of another webpack layer of a declared stop's module is accepted only as the same original: its inline map must name the exact source path, and the caller's verifier ({@link createBundleVerifier}) refuses a map whose retained original differs from the frozen text. Its generated code may differ from the sealed instance's, which is why it carries its own map; pass the stop's sealed bundle as `identity` and the announced address as `scriptUrl`.
 * @param javascript - The evaluated module text.
 * @param identity - The cited original and the chunk it was acquired from, kept as the bundle's identity: `sourcePath` is the original's absolute path, `source` its frozen text, `chunkPath` the built chunk and `chunkHash` that chunk's SHA-256. One object typed from {@link BundleSource}, so a caller cannot swap the four strings.
 * @param scriptUrl - The script address the module must carry as its effective `sourceURL`.
 * @returns The bundle, or `undefined` when the module carries another script address.
 * @throws When the module's script identity or inline map is ambiguous, malformed or over its byte limit, or its map does not name the exact original.
 * @example
 * ```ts
 * bundleOfEvaluatedModule(text, { sourcePath: '/repo/auth.ts', source, chunkPath, chunkHash }, 'webpack-internal:///(middleware)/./auth.ts')
 * ```
 */
export function bundleOfEvaluatedModule(
  javascript: string,
  identity: Pick<
    BundleSource,
    'sourcePath' | 'source' | 'chunkPath' | 'chunkHash'
  >,
  scriptUrl: string,
): BundleSource | undefined {
  const { sourcePath, source, chunkPath, chunkHash } = identity
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
