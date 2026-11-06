import {
  EXTENSION_BUILD_GIT_MAX_BUFFER_BYTES,
  EXTENSION_BUILD_GIT_TIMEOUT_MS,
} from '../constants'

import { runOpenedFolderGit } from './runOpenedFolderGit'

/**
 * Which files a source snapshot covers: `tracked` (the files the repository tracks; the WXT build) or `tracked-and-untracked` (also untracked files that are not ignored; the library build).
 */
export type SourceSnapshotFileSet = 'tracked' | 'tracked-and-untracked'

/**
 * Lists the files of a folder that a source snapshot covers, repository-relative, for the source checks of a build.
 * Called by {@link buildWxtExtension} for the `.wxt` check and the pre-build snapshot, by {@link findChangedTrackedFile} when the file set includes untracked files, and by the library build.
 * @param repositoryRoot - The repository root, the working folder of the listing.
 * @param folder - The absolute folder inside the repository whose files are listed.
 * @param fileSet - `tracked` (default) lists `ls-files`; `tracked-and-untracked` lists `ls-files --cached --others --exclude-standard`.
 * @returns The paths with forward slashes, in listing order, without duplicates; empty when none is listed.
 * @throws What {@link runOpenedFolderGit} throws (no Git, a timeout, too much output).
 * @example
 * await listTrackedFiles('/repo', '/repo/extension/.wxt') // => []
 * await listTrackedFiles('/repo', '/repo', 'tracked-and-untracked') // => ['a.ts', 'new-file.ts']
 */
export async function listTrackedFiles(
  repositoryRoot: string,
  folder: string,
  fileSet: SourceSnapshotFileSet = 'tracked',
): Promise<string[]> {
  const output = await runOpenedFolderGit(
    repositoryRoot,
    fileSet === 'tracked'
      ? ['ls-files', '-z', '--', folder]
      : [
          'ls-files',
          '-z',
          '--cached',
          '--others',
          '--exclude-standard',
          '--',
          folder,
        ],
    {
      timeoutMs: EXTENSION_BUILD_GIT_TIMEOUT_MS,
      maxBuffer: EXTENSION_BUILD_GIT_MAX_BUFFER_BYTES,
    },
  )
  // An unmerged path is listed once per stage, so duplicates are dropped.
  return [...new Set(output.split('\0').filter((path) => path !== ''))]
}
