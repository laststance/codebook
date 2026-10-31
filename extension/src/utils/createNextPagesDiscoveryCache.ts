/** One `.next/dev` chunk's decoded eval modules as one read of the run gave them, valid while the chunk keeps its generation. */
export type NextPagesChunkModules = {
  /** `<size>:<mtimeNs>` of the file on disk, or `served` for bytes the owned server served because no file existed. */
  generation: string
  /** The chunk's absolute path in the build (where a served chunk would be), named by the sealed bundle. */
  chunkPath: string
  /** SHA-256 of the chunk's text. */
  chunkHash: string
  /** The chunk's eval modules, decoded once ({@link evaluatedModuleTexts}). */
  moduleTexts: readonly string[]
}

/**
 * What one run's Pages discovery has read and spent: every stop of the run seals through it, so a chunk two stops share is read and decoded once, and {@link REPOSITORY_DISCOVERY_LIMIT_BYTES} and {@link REPOSITORY_DISCOVERY_TIMEOUT_MS} bound the run's total, not each stop's.
 * Created by {@link createNextPagesDiscoveryCache}; read and updated by {@link spendNextPagesDiscovery} and {@link readNextChunkModules}.
 */
export type NextPagesDiscoveryCache = {
  /** Bytes the run's Pages discovery has read so far, from disk or the owned server. */
  readBytes: number
  /** Milliseconds the run's Pages discovery has spent so far. */
  spentMs: number
  /** Decoded chunks by their path in `.next/dev`, e.g. `static/chunks/pages/index.js`. */
  readonly chunks: Map<string, NextPagesChunkModules>
}

/**
 * Creates the empty discovery cache of one Pages run.
 * Called once per run by the Next run before it seals the first Pages stop; the same cache is handed to every {@link readPagesDevelopmentBundle} and {@link readNextServerOnlyReason} call of that run.
 * @returns A cache with nothing read or spent.
 * @example
 * createNextPagesDiscoveryCache() // => { readBytes: 0, spentMs: 0, chunks: Map(0) {} }
 */
export function createNextPagesDiscoveryCache(): NextPagesDiscoveryCache {
  return { readBytes: 0, spentMs: 0, chunks: new Map() }
}
