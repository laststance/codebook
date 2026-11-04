import {
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
  REPOSITORY_MAP_LIMIT_BYTES,
} from '../constants'
import { sha256 } from '../runtimeSupport/utils/sha256'

import type { FrozenLibraryBuild } from './libraryBuildStop'
import { readRepositoryBuildText } from './readRepositoryBuildText'

/**
 * Finds the first frozen built file or build map on disk whose SHA-256 is no longer the frozen one.
 *
 * Why it exists: the App Router seal sees only the module Next composed, whose map carries `sourcesContent` but no hash of the built file, so a rebuild with other settings that keeps the same `sourcesContent` would otherwise seal. The dev server Codebook starts compiles after the freeze, so an unchanged build on disk means the chunk came from the frozen build; this disk check stands in for the built-entry comparison the Pages seal makes with `matchesBuiltText`. Called by `sealAppLibraryStop` before it accepts a module.
 * @param frozen - The freeze, with the SHA-256 of every candidate's built file and map.
 * @param realRoot - The real repository root the freeze read below.
 * @param deadline - When the discovery step ends, on the `performance.now()` clock.
 * @param signal - Ends the read with the run.
 * @returns The repository-relative path of the first missing, unreadable, oversized or changed file, or `undefined` when every file is as frozen.
 * @throws `Module discovery deadline exceeded`; the signal's reason when the run aborts.
 * @example await changedFrozenFileOf(frozen, '/repo', step.deadline, signal) // => 'packages/lib/build/modern/core.js.map'
 */
export async function changedFrozenFileOf(
  frozen: FrozenLibraryBuild,
  realRoot: string,
  deadline: number,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  for (const candidate of frozen.candidates) {
    const files = [
      {
        path: candidate.builtPath,
        hash: candidate.builtSha256,
        limit: REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
      },
      {
        path: `${candidate.builtPath}.map`,
        hash: candidate.mapSha256,
        limit: REPOSITORY_MAP_LIMIT_BYTES,
      },
    ]
    for (const { path, hash, limit } of files) {
      if (performance.now() >= deadline)
        throw new Error('Module discovery deadline exceeded')
      try {
        const text = await readRepositoryBuildText(
          realRoot,
          path,
          limit,
          signal,
        )
        if (sha256(text) !== hash) return path
      } catch {
        // The run's own abort is not a changed build.
        signal?.throwIfAborted()
        // A missing, linked, oversized or unreadable file is no longer the frozen build.
        return path
      }
    }
  }
  return undefined
}
