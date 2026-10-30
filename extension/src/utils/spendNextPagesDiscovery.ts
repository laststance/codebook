import { lstat, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  REPOSITORY_DISCOVERY_LIMIT_BYTES,
  REPOSITORY_DISCOVERY_TIMEOUT_MS,
} from '../constants'

import type { NextPagesDiscoveryCache } from './createNextPagesDiscoveryCache'
import { readRepositoryBuildText } from './readRepositoryBuildText'

/**
 * Fetches one build chunk from the owned development server when no file of it exists in `.next/dev`; the Next run passes one bound to its owned origin.
 * @param chunkPath - The chunk's path in `.next/dev`, as the build manifest lists it, e.g. `static/chunks/pages/index.js` (served at `/_next/<chunkPath>`).
 * @param bounds - The most bytes the run's discovery may still take, and the signal that ends the fetch with the run or its discovery time.
 * @returns The chunk's text.
 */
export type NextPagesChunkFetcher = (
  chunkPath: string,
  bounds: { limitBytes: number; signal: AbortSignal },
) => Promise<string>

/** One Pages discovery step's access to bytes, charged to the run's budget ({@link NextPagesDiscoveryCache}). */
export type NextPagesDiscoveryStep = {
  /** The canonical workspace. */
  readonly root: string
  /** When the run's discovery time ends, on the `performance.now()` clock. */
  readonly deadline: number
  readonly signal?: AbortSignal
  /** Reads bounded, contained, unlinked bytes inside the workspace ({@link readRepositoryBuildText}). */
  readBuildText(path: string, limitBytes: number): Promise<string>
  /** Takes a chunk's bytes from the owned server through the run's fetcher, within the same bounds. */
  fetchBuildText(
    chunkPath: string,
    limitBytes: number,
    fetchChunk: NextPagesChunkFetcher,
  ): Promise<string>
}

/**
 * Runs one Pages discovery step within what is left of the run's discovery budget: bytes read count against {@link REPOSITORY_DISCOVERY_LIMIT_BYTES} and time against {@link REPOSITORY_DISCOVERY_TIMEOUT_MS}, both for the whole run, kept in the cache.
 * Called by {@link readPagesDevelopmentBundle} for each stop and by {@link readNextServerOnlyReason}, so several stops of one run share one budget.
 * @param cache - The run's discovery cache, which carries the bytes and time spent.
 * @param workspace - The opened workspace.
 * @param signal - Ends the step with the run.
 * @param work - The step, given its byte access and deadline.
 * @returns What the step returns.
 * @throws `Build discovery resource limit exceeded` when the run's budget is spent before or during the step; whatever the step throws.
 * @example
 * await spendNextPagesDiscovery(cache, '/repo', signal, (step) => step.readBuildText('.next/dev/build-manifest.json', limit))
 */
export async function spendNextPagesDiscovery<Result>(
  cache: NextPagesDiscoveryCache,
  workspace: string,
  signal: AbortSignal | undefined,
  work: (step: NextPagesDiscoveryStep) => Promise<Result>,
): Promise<Result> {
  const started = performance.now()
  const deadline = started + REPOSITORY_DISCOVERY_TIMEOUT_MS - cache.spentMs
  // Every read first checks what the run has left, so the first step past the budget is refused before it reads.
  const takeBudget = () => {
    signal?.throwIfAborted()
    if (
      performance.now() >= deadline ||
      cache.readBytes >= REPOSITORY_DISCOVERY_LIMIT_BYTES
    )
      throw new Error('Build discovery resource limit exceeded')
    const timeout = AbortSignal.timeout(
      Math.max(1, Math.ceil(deadline - performance.now())),
    )
    return {
      remainingBytes: REPOSITORY_DISCOVERY_LIMIT_BYTES - cache.readBytes,
      readSignal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }
  }
  try {
    takeBudget()
    const root = await realpath(workspace)
    return await work({
      root,
      deadline,
      signal,
      async readBuildText(path, limitBytes) {
        const { remainingBytes, readSignal } = takeBudget()
        if ((await lstat(resolve(root, path))).size > remainingBytes)
          throw new Error('Build discovery resource limit exceeded')
        const text = await readRepositoryBuildText(
          root,
          path,
          Math.min(limitBytes, remainingBytes),
          readSignal,
        )
        cache.readBytes += Buffer.byteLength(text)
        return text
      },
      async fetchBuildText(chunkPath, limitBytes, fetchChunk) {
        const { remainingBytes, readSignal } = takeBudget()
        const text = await fetchChunk(chunkPath, {
          limitBytes: Math.min(limitBytes, remainingBytes),
          signal: readSignal,
        })
        const bytes = Buffer.byteLength(text)
        // The fetcher is told the bound; served bytes past it are refused all the same.
        if (bytes > remainingBytes)
          throw new Error('Build discovery resource limit exceeded')
        if (bytes > limitBytes)
          throw new Error('Served build text exceeds byte limit')
        cache.readBytes += bytes
        return text
      },
    })
  } finally {
    cache.spentMs += performance.now() - started
  }
}
