import {
  EXTENSION_BUILD_GIT_MAX_BUFFER_BYTES,
  EXTENSION_BUILD_GIT_TIMEOUT_MS,
} from '../constants'

import { runOpenedFolderGit } from './runOpenedFolderGit'

/**
 * Lists the files Git tracks under a folder, repository-relative, for the tracked-file checks of a WXT build.
 * Called by {@link buildWxtExtension} for the `.wxt` check and the pre-build snapshot.
 * @param repositoryRoot - The repository root, Git's working folder.
 * @param folder - The absolute folder inside the repository whose tracked files are listed.
 * @returns The tracked paths with forward slashes, in Git's order; empty when none is tracked.
 * @throws What {@link runOpenedFolderGit} throws (no Git, a timeout, too much output).
 * @example
 * await listTrackedFiles('/repo', '/repo/extension/.wxt') // => []
 */
export async function listTrackedFiles(
  repositoryRoot: string,
  folder: string,
): Promise<string[]> {
  const output = await runOpenedFolderGit(
    repositoryRoot,
    ['ls-files', '-z', '--', folder],
    {
      timeoutMs: EXTENSION_BUILD_GIT_TIMEOUT_MS,
      maxBuffer: EXTENSION_BUILD_GIT_MAX_BUFFER_BYTES,
    },
  )
  return output.split('\0').filter((path) => path !== '')
}
