import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'

import { isFolderOfItsOwn } from './isFolderOfItsOwn'

/**
 * Lists everything below a folder with its entry types, only when a real directory stands at the folder's own path as its parent's own entry ({@link isFolderOfItsOwn}); called by {@link findWikiUpdateStartBlock}, {@link readWikiWatchStamp} and {@link detectWikiPublishConflicts} for the Wiki's output folder.
 *
 * Why: a recursive listing with entry types names a link below the folder and does not enter it, but it follows a link at the folder's own path. The Wiki's output folder lies in the learner's project, where a cloned repository decides what stands at that path: a link there (a junction on Windows) would make each look walk the folder the link leads to, before an update's timeout and cancel exist and every two seconds while a watch runs, and would report that folder's files as the Wiki's. The path is therefore looked at without following it first, and listed only when its real path is its own name under its parent's real path: the look alone calls some entries that lead elsewhere a directory (a junction to a volume on Windows).
 * Limit: the look and the listing are two steps. A path that a running program replaces by a link between them is listed through the link; a repository cannot do that.
 *
 * @param directory - The folder to list, for example the resolved Wiki output folder.
 * @returns
 * - A real directory: every entry below it, each with its type and its parent's path; a link below it is one entry and is not entered
 * - A link, a file, any other entry that is no directory at the folder's own path, or a directory that leads elsewhere: `undefined`, and nothing is listed
 * @throws The file system's error when nothing stands at the path (`ENOENT`) or the folder cannot be looked at or listed.
 * @example
 * await listFolderTreeWithoutFollowing('/repo/.codebook/wiki')           // => [Dirent 'index.html', Dirent 'pages', Dirent 'overview.html', …]
 * await listFolderTreeWithoutFollowing('/repo/.codebook/a-link-to-/usr') // => undefined
 */
export async function listFolderTreeWithoutFollowing(
  directory: string,
): Promise<Dirent[] | undefined> {
  // Only a directory of its own is listed, never the folder a link or another entry leads to.
  if (!(await isFolderOfItsOwn(directory))) return undefined
  return readdir(directory, { recursive: true, withFileTypes: true })
}
