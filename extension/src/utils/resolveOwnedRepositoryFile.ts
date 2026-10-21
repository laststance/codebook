import { realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { isInsideFolder } from './isInsideFolder'

/**
 * Resolves a repository-relative path to the real file node-test may read or run, so a link that leaves the opened checkout, a folder and a path that does not exist are never taken for the repository's file; called by {@link checkNodeTestFiles} for the cited test and source files, by {@link prepareNodeTestLaunch} for the Vitest program, and by {@link readVitestPrerequisite} for the Vitest package file.
 * @param root - The repository's real root.
 * @param path - A path relative to the root.
 * @returns The file's real path, or `undefined` when it does not exist, resolves outside the root, or is no regular file.
 * @example
 * await resolveOwnedRepositoryFile('/repo', 'app/lib/data.test.ts') // => '/repo/app/lib/data.test.ts'
 * await resolveOwnedRepositoryFile('/repo', 'link-to-etc/passwd')  // => undefined
 */
export async function resolveOwnedRepositoryFile(
  root: string,
  path: string,
): Promise<string | undefined> {
  const file = await realpath(join(root, path)).catch(() => undefined)
  if (!file || !isInsideFolder(root, file)) return undefined
  const entry = await stat(file).catch(() => undefined)
  return entry?.isFile() ? file : undefined
}
