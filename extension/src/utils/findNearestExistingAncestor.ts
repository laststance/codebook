import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Finds the nearest folder at or above a path that exists, so a file watcher can stand where a first Wiki's folders are not made yet.
 *
 * Why: in a fresh project the Wiki output's parent (`.codebook/`) does not exist until a run makes it; a watcher on a missing folder would never fire, and the output may lie outside the workspace.
 * Trigger: {@link LlmWikiView} calls it at each refresh to keep its watcher on the closest folder that exists.
 *
 * @param path - An absolute path, usually the Wiki output folder.
 * @returns The path itself when it is a folder, else the nearest parent that is; the path's root when nothing below exists.
 * @example
 * await findNearestExistingAncestor('/repo/.codebook/wiki') // => '/repo' while .codebook does not exist yet
 */
export async function findNearestExistingAncestor(
  path: string,
): Promise<string> {
  let candidate = path
  for (;;) {
    const candidateStat = await stat(candidate).catch(() => undefined)
    if (candidateStat?.isDirectory()) return candidate
    const parent = dirname(candidate)
    // The root has no parent: nothing below it exists either.
    if (parent === candidate) return candidate
    candidate = parent
  }
}
