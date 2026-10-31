import type { BigIntStats } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

import { REPOSITORY_CHUNK_LIMIT_BYTES } from '../constants'
import { sha256 } from '../runtimeSupport/utils/sha256'

import type {
  NextPagesChunkModules,
  NextPagesDiscoveryCache,
} from './createNextPagesDiscoveryCache'
import { evaluatedModuleTexts } from './extractDevelopmentModule'
import type {
  NextPagesChunkFetcher,
  NextPagesDiscoveryStep,
} from './spendNextPagesDiscovery'

/**
 * Reads one chunk of the Next build and decodes its eval modules, once per run and chunk generation: a second stop in the same unchanged chunk takes the cached modules without reading the file again.
 * Called by {@link readPagesDevelopmentBundle} for the page and `_app` chunks (with the owned server as fallback when no file exists) and by {@link readNextServerOnlyReason} for the page's server compile.
 * @param step - The discovery step, which charges reads to the run's budget.
 * @param cache - The run's discovery cache.
 * @param chunkPath - The chunk's path in `.next/dev`, e.g. `static/chunks/pages/index.js`.
 * @param fetchChunk - Fetches the chunk from the owned server when no file of it exists; without it an absent chunk is `undefined`.
 * @returns The decoded chunk, or `undefined` when no file exists and no fetcher is given.
 * @throws `Declared chunk escapes the selected build` for a path outside `.next/dev`; `Build file changed during acquisition` when the file changed while it was read; read, budget and decoding failures.
 * @example
 * (await readNextChunkModules(step, cache, 'static/chunks/pages/index.js'))?.moduleTexts.length // => 8
 */
export async function readNextChunkModules(
  step: NextPagesDiscoveryStep,
  cache: NextPagesDiscoveryCache,
  chunkPath: string,
  fetchChunk?: NextPagesChunkFetcher,
): Promise<NextPagesChunkModules | undefined> {
  const buildRoot = resolve(step.root, '.next/dev'),
    absolutePath = resolve(buildRoot, chunkPath)
  if (!absolutePath.startsWith(`${buildRoot}${sep}`))
    throw new Error('Declared chunk escapes the selected build')
  const before = await lstatOrAbsent(absolutePath)
  const location = { chunkPath, absolutePath }
  if (before) {
    const generation = generationOf(before)
    return decodeOnce(step, cache, location, generation, () =>
      readUnchangedChunk(step, absolutePath, generation),
    )
  }
  // No file exists: the owned server's bytes stand for it until a file appears, whose generation then differs.
  if (!fetchChunk) return undefined
  return decodeOnce(step, cache, location, 'served', () =>
    step.fetchBuildText(chunkPath, REPOSITORY_CHUNK_LIMIT_BYTES, fetchChunk),
  )
}

/**
 * Returns the cached decoded chunk of a generation, or reads and decodes it and caches the result; called by {@link readNextChunkModules}.
 * @param step - The discovery step, whose deadline bounds decoding.
 * @param cache - The run's discovery cache.
 * @param location - The chunk's path in `.next/dev` (the cache key) and its absolute path.
 * @param generation - The generation the bytes will have.
 * @param read - Reads the chunk's text.
 * @returns The decoded chunk.
 * @example
 * await decodeOnce(step, cache, { chunkPath, absolutePath }, 'served', () => fetchText())
 */
async function decodeOnce(
  step: NextPagesDiscoveryStep,
  cache: NextPagesDiscoveryCache,
  location: { chunkPath: string; absolutePath: string },
  generation: string,
  read: () => Promise<string>,
): Promise<NextPagesChunkModules> {
  const cached = cache.chunks.get(location.chunkPath)
  if (cached?.generation === generation) return cached
  const text = await read()
  const chunk: NextPagesChunkModules = {
    generation,
    chunkPath: location.absolutePath,
    chunkHash: sha256(text),
    moduleTexts: [...evaluatedModuleTexts(text, step.deadline)],
  }
  cache.chunks.set(location.chunkPath, chunk)
  return chunk
}

/**
 * Reads a chunk file and confirms it kept the generation it was cached under; called by {@link readNextChunkModules}.
 * @param step - The discovery step.
 * @param absolutePath - The chunk file.
 * @param generation - The generation read before.
 * @returns The chunk's text.
 * @throws `Build file changed during acquisition` when the file's size or modification time changed around the read.
 * @example
 * await readUnchangedChunk(step, '/repo/.next/dev/static/chunks/pages/index.js', '262877:1761868740000000000')
 */
async function readUnchangedChunk(
  step: NextPagesDiscoveryStep,
  absolutePath: string,
  generation: string,
): Promise<string> {
  const text = await step.readBuildText(
    absolutePath,
    REPOSITORY_CHUNK_LIMIT_BYTES,
  )
  const after = await lstatOrAbsent(absolutePath)
  // A cached entry must name the bytes it holds, so a change between the two looks is refused, not cached.
  if (!after || generationOf(after) !== generation)
    throw new Error('Build file changed during acquisition')
  return text
}

/**
 * Names a file's generation by its size and modification time; called by {@link readNextChunkModules}.
 * @param status - The file's status, with exact numbers.
 * @returns `<size>:<mtimeNs>`.
 * @example
 * generationOf(status) // => '262877:1761868740000000000'
 */
function generationOf(status: BigIntStats): string {
  return `${status.size}:${status.mtimeNs}`
}

/**
 * Reads a path's own status (a link is not followed) with exact numbers; called by {@link readNextChunkModules}.
 * @param path - An absolute path.
 * @returns The status, or `undefined` when the path does not exist.
 * @throws Any other status failure.
 * @example
 * await lstatOrAbsent('/repo/.next/dev/static/chunks/pages/index.js') // => BigIntStats
 */
async function lstatOrAbsent(path: string): Promise<BigIntStats | undefined> {
  return lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
}
