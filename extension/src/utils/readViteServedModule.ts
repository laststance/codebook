import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

import {
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
  REPOSITORY_MAP_LIMIT_BYTES,
  REPOSITORY_SOURCE_LIMIT_BYTES,
  VITE_MODULE_FETCH_TIMEOUT_MS,
} from '../constants'
import type { BundleSource } from '../repositoryBundle'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { viteRefusal } from '../viteRefusals'

import { readRepositoryBuildText } from './readRepositoryBuildText'
import { viteModuleUrl, type ViteModuleAddress } from './viteModuleUrl'

const INLINE_MAP =
  /^\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([A-Za-z\d+/=]+)$/gm

const servedMapSchema = z.object({
  version: z.literal(3),
  file: z.string().optional(),
  sources: z.array(z.string()).min(1),
  sourcesContent: z.array(z.string().nullable()).optional(),
  names: z.array(z.string()).default([]),
  mappings: z.string().min(1),
  sourceRoot: z.literal('').optional(),
})

/** Ends a seal with the refusal that names the stop, the reason and the fix. */
type Refuse = (reason: string) => never

/** Reads a response body whole, ending the read as soon as it passes the byte cap. */
async function readCappedBody(
  response: Response,
  limit: number,
): Promise<string | undefined> {
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return undefined
    }
    chunks.push(value)
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
}

/** Resolves one entry of a served map's `sources` to an absolute path of the package, or an absolute address for another origin. */
async function absoluteSourceOf(
  source: string,
  moduleUrl: string,
  packageRoot: string,
): Promise<string> {
  const resolved = new URL(source, moduleUrl)
  if (resolved.protocol === 'file:') return fileURLToPath(resolved)
  if (resolved.origin !== new URL(moduleUrl).origin) return resolved.href
  const path = join(
    packageRoot,
    ...decodeURIComponent(resolved.pathname).split('/'),
  )
  return realpath(path).catch(() => path)
}

/** Names why a response is not a servable module; `undefined` when it is. */
function servedProblemOf(response: Response, url: string): string | undefined {
  if (response.status >= 300 && response.status < 400)
    return `${url} redirects (status ${response.status}) and Codebook follows no redirect`
  if (!response.ok) return `${url} answered status ${response.status}`
  const contentType = response.headers.get('content-type') ?? ''
  if (!/javascript/i.test(contentType))
    return `${url} is served as ${contentType || 'no content type'}, not JavaScript`
  return undefined
}

/**
 * Fetches the module the owned server serves at an address: owned origin only, no redirect, JavaScript only, body capped.
 * @param address - The served address of the stop's file.
 * @param signal - The run's cancellation.
 * @param refuse - Ends the seal with a sentence.
 * @returns The served text, unchanged.
 */
async function fetchServedModule(
  address: ViteModuleAddress,
  signal: AbortSignal,
  refuse: Refuse,
): Promise<string> {
  const response = await fetch(address.url, {
    redirect: 'manual',
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(VITE_MODULE_FETCH_TIMEOUT_MS),
    ]),
  }).catch((error: unknown) => {
    signal.throwIfAborted()
    return refuse(
      `the server did not answer ${address.url} (${error instanceof Error ? error.name : 'error'})`,
    )
  })
  const problem = servedProblemOf(response, address.url)
  if (problem) {
    await response.body?.cancel()
    return refuse(problem)
  }
  const text = await readCappedBody(
    response,
    REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
  ).catch(() => refuse(`${address.url} is not valid UTF-8`))
  if (text === undefined)
    return refuse(
      `${address.url} exceeds ${REPOSITORY_JAVASCRIPT_LIMIT_BYTES} bytes`,
    )
  return text
}

/**
 * Reads the one inline map of a served module and normalizes it for the bundle verifier: every `sources` entry becomes an absolute path, the stop's own file appears exactly once, and its retained text equals the workspace file.
 * @param javascript - The served module.
 * @param address - The served address and real path of the stop's file.
 * @param sourceText - The workspace file's text.
 * @param packageRoot - The package root.
 * @param refuse - Ends the seal with a sentence.
 * @returns The normalized map as JSON text.
 */
async function normalizeServedMap(
  javascript: string,
  address: ViteModuleAddress,
  sourceText: string,
  packageRoot: string,
  refuse: Refuse,
): Promise<string> {
  const encodedMaps = [...javascript.matchAll(INLINE_MAP)]
  if (encodedMaps.length !== 1)
    refuse(
      `${address.url} has ${encodedMaps.length} inline source maps, not exactly one`,
    )
  const encoded = encodedMaps[0]![1]!
  const mapBytes = Buffer.from(encoded, 'base64')
  if (
    mapBytes.byteLength > REPOSITORY_MAP_LIMIT_BYTES ||
    mapBytes.toString('base64') !== encoded
  )
    refuse(`the inline map of ${address.url} is oversized or malformed`)
  const parsed = servedMapSchema.safeParse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(mapBytes)),
  )
  if (!parsed.success)
    return refuse(
      `the inline map of ${address.url} is not a flat version 3 map`,
    )
  const map = parsed.data
  const sources = await Promise.all(
    map.sources.map((entry) =>
      absoluteSourceOf(entry, address.url, packageRoot),
    ),
  )
  const matches = sources.flatMap((entry, index) =>
    entry === address.realPath ? [index] : [],
  )
  if (matches.length !== 1)
    refuse(
      `the inline map of ${address.url} does not name the stop's file exactly once`,
    )
  const retained = map.sourcesContent?.[matches[0]!]
  if (retained !== null && retained !== undefined && retained !== sourceText)
    refuse(
      `the inline map of ${address.url} carries source text that differs from the file`,
    )
  return JSON.stringify({
    ...map,
    file: map.file ?? '',
    sourceRoot: '',
    sources,
    sourcesContent: sources.map((_, index) =>
      index === matches[0] ? sourceText : (map.sourcesContent?.[index] ?? ''),
    ),
  })
}

/**
 * Seals one declared stop from the module the owned Vite dev server serves for its file: the served bytes unchanged and their inline map normalized to absolute originals.
 *
 * Why it exists: the executed bytes are checked against these served bytes before the click, so the seal is of what the browser will run. Called by the Vite adapter's `readBundle` once per stop, after the server is ready and before the browser opens.
 * It fetches only from the owned origin, follows no redirect, caps the body, and refuses a missing, non-JavaScript, map-less or foreign module with a sentence naming the file, line and address.
 *
 * @param packageRoot - The package root.
 * @param ownedOrigin - The origin the ready server reported.
 * @param source - The declared stop's source (path, line and the hash the article accepted).
 * @param signal - Ends the read when the run is cancelled.
 * @returns The bundle in the shape {@link readDevelopmentBundle} returns, with the discovery measurements.
 * @throws `VITE_SEAL_FAILED` for each refusal; a plain error when the source differs from the accepted article.
 * @example
 * const { bundle } = await readViteServedModule('/repo', 'http://127.0.0.1:3010', stop.source, signal)
 */
export async function readViteServedModule(
  packageRoot: string,
  ownedOrigin: string,
  source: RepositoryConfiguration['source'],
  signal: AbortSignal,
) {
  const started = performance.now()
  const refuse: Refuse = (reason) => {
    throw viteRefusal(
      'VITE_SEAL_FAILED',
      `Declared stop ${source.path}:${source.line} cannot be sealed: ${reason}. Move the stop to a JavaScript or TypeScript file under the package root that the entry page loads.`,
    )
  }
  const sourceText = await readRepositoryBuildText(
    packageRoot,
    join(packageRoot, source.path),
    REPOSITORY_SOURCE_LIMIT_BYTES,
    signal,
  )
  if (sha256(sourceText) !== source.hash)
    throw new Error('Selected source differs from the accepted article')
  const address = await viteModuleUrl(
    packageRoot,
    source.path,
    ownedOrigin,
  ).catch((error: unknown) =>
    refuse(error instanceof Error ? error.message : String(error)),
  )
  const javascript = await fetchServedModule(address, signal, refuse)
  const sourceMap = await normalizeServedMap(
    javascript,
    address,
    sourceText,
    packageRoot,
    refuse,
  )
  const bundle: BundleSource = {
    sourcePath: address.realPath,
    mapSource: address.realPath,
    scriptUrl: address.url,
    source: sourceText,
    javascript,
    sourceMap,
    chunkPath: '',
    chunkHash: sha256(javascript),
  }
  return {
    bundle,
    discovery: {
      readBytes: Buffer.byteLength(javascript),
      durationMs: performance.now() - started,
      candidates: [address.url],
      manifestHash: sha256(javascript),
    },
  }
}
