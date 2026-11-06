import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { EXTENSION_BUILD_HASH_CONCURRENCY } from '../constants'

import { systemErrorCode } from './systemErrorCode'

/**
 * Hashes (SHA-256) tracked files as they are on disk, so a WXT build's effect on them can be compared afterwards.
 * Called by {@link buildWxtExtension} before the build and again after the build's process tree ended.
 * @param repositoryRoot - The folder the paths are relative to.
 * @param paths - Repository-relative tracked paths.
 * @returns Path to hash; a file that is missing hashes as `absent`, one that cannot be read as `unreadable:<code>`.
 * @example
 * await hashTrackedFiles('/repo', ['a.ts']) // => Map { 'a.ts' => 'e3b0c442…' }
 */
export async function hashTrackedFiles(
  repositoryRoot: string,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>()
  // Batches bound the open files; each batch hashes its files in parallel.
  for (
    let start = 0;
    start < paths.length;
    start += EXTENSION_BUILD_HASH_CONCURRENCY
  ) {
    const batch = paths.slice(start, start + EXTENSION_BUILD_HASH_CONCURRENCY)
    const batchHashes = await Promise.all(
      batch.map(async (path) => {
        try {
          const content = await readFile(join(repositoryRoot, path))
          return createHash('sha256').update(content).digest('hex')
        } catch (error) {
          const code = systemErrorCode(error)
          return code === 'ENOENT'
            ? 'absent'
            : `unreadable:${code ?? 'unknown'}`
        }
      }),
    )
    batch.forEach((path, index) => hashes.set(path, batchHashes[index] ?? ''))
  }
  return hashes
}
