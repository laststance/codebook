import { lstat, readdir, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { systemErrorCode } from './systemErrorCode'

/**
 * Lets only the failure "nothing is there" pass; called by {@link removeWithoutFollowing} for each of its file system calls, because an entry another window removed in the same moment is removed.
 * @param error - What the look, the unlink or the removal of the emptied directory threw.
 * @returns `undefined` for `ENOENT`.
 * @throws The given error itself for every other failure.
 * @example
 * await lstat(path).catch(passIfMissing) // => undefined when nothing stands at the path
 */
function passIfMissing(error: unknown): undefined {
  if (systemErrorCode(error) !== 'ENOENT') throw error
  return undefined
}

/**
 * Removes what stands at a path by a walk of Codebook's own that follows no link; called by the claim on a Wiki update's marker ({@link claimWikiUpdateMarker}) and by the takeover claim and its sweep ({@link claimStorageLockTakeover}, {@link removeStaleStorageClaims}) for every entry they remove at the marker's or the lock's paths.
 *
 * Why: the marker's paths lie in the learner's project folder, where a cloned repository decides what stands there, and a link there must be removed as a name while the folder it leads to stays as it is. The recursive `rm` of Node.js does that as long as its first try succeeds; when the system refuses the look or the unlink with `EPERM`, its Windows path asks `stat`, which follows a link, and may go on into the folder the link leads to. Each editor runs the extension on its own Node.js, so the removal does not rest on what one version's fallback does: every entry is looked at with `lstat`, a link or a file is removed with `unlink`, only a real directory is listed, and a failure is the file system's error for that entry. No other way is tried.
 * Limit: the look and the listing are two steps; a path that a running program replaces by a link between them is listed through the link. A repository cannot do that.
 *
 * @param path - The entry to remove: a file, a link (a junction on Windows) or a directory with its content.
 * @returns After the entry is gone; also when nothing stood at the path, or another process removed it meanwhile.
 * @throws The file system's error of the first entry that cannot be looked at, unlinked, listed or removed (for example `EPERM` for a link the system does not let this user remove); what was removed before stays removed, and nothing below a link is touched.
 * @example
 * await removeWithoutFollowing('/repo/.codebook/wiki.update-run.json.takeover-4f2c') // the prepared claim folder and its owner file are gone
 * await removeWithoutFollowing('/repo/.codebook/a-link-to-the-project')              // the link is gone, the project keeps every file
 */
export async function removeWithoutFollowing(path: string): Promise<void> {
  const entry = await lstat(path).catch(passIfMissing)
  if (!entry) return
  // A link, a file or a special file is one name: it is unlinked and never opened or listed.
  if (!entry.isDirectory()) {
    await unlink(path).catch(passIfMissing)
    return
  }
  // Only a directory of its own is emptied, entry by entry, each looked at the same way.
  for (const name of await readdir(path))
    await removeWithoutFollowing(join(path, name))
  await rmdir(path).catch(passIfMissing)
}
