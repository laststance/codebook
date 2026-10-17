import { lstat, readdir, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { isFolderOfItsOwn } from './isFolderOfItsOwn'
import { passIfMissing } from './passIfMissing'
import { systemErrorCode } from './systemErrorCode'

/** What a system answers when it is asked to remove a directory that still holds entries: `ENOTEMPTY` on Linux, macOS and Windows, `EEXIST` on the systems that say it that way. */
const NOT_EMPTY_CODES = ['ENOTEMPTY', 'EEXIST']

/**
 * Asks the system to remove a directory as it is, before anything in it is listed; called by {@link removeWithoutFollowing} for every entry its look calls a directory.
 * Why first: what the look calls a directory can lead elsewhere (a junction to a volume on Windows, a mount point). The system removes such an entry as a name, or refuses with an error of its own; only a directory that holds entries answers "not empty".
 * @param path - The entry the look called a directory.
 * @returns `undefined` when the entry is gone (removed now, or no longer there); the system's error when it answered that the directory is not empty.
 * @throws The file system's error for every other answer (for example `EBUSY` for a mount point, `EPERM` for an entry this user may not remove).
 * @example
 * await removeIfEmpty('/repo/.codebook/wiki.update-run.json.takeover') // => undefined for an empty claim folder, which is gone
 */
async function removeIfEmpty(path: string): Promise<unknown> {
  try {
    await rmdir(path)
    return undefined
  } catch (error) {
    if (NOT_EMPTY_CODES.includes(systemErrorCode(error))) return error
    return passIfMissing(error)
  }
}

/**
 * Lists a directory the walk is about to empty; called by {@link removeEntriesOf} after the directory was shown to be its parent's own entry.
 * @param path - The directory.
 * @returns The names of its entries; none when the directory is gone meanwhile.
 * @throws The file system's error when the directory cannot be listed for another reason.
 * @example
 * await namesIn('/repo/.codebook/wiki.update-run.json.takeover-4f2c') // => ['4f2c']
 */
async function namesIn(path: string): Promise<string[]> {
  return (await readdir(path).catch(passIfMissing)) ?? []
}

/** The directory the walk looked at, by its device and file id as `lstat` reads them exactly (`bigint`), which another entry put at its path does not have. */
type LookedDirectory = { dev: bigint; ino: bigint }

/**
 * Confirms that a path still names the directory the walk looked at, before the walk lists it and before it removes each of its entries; called by {@link removeEntriesOf}.
 * Why: the walk removes an entry by its path below the directory's path, and a path whose directory was renamed and replaced by a link leads into the folder the link names, where the walk would remove that folder's entries of the same names.
 * @param path - The directory's path.
 * @param looked - Its device and file id at the walk's look.
 * @returns `true` while the same directory stands at the path; `false` once nothing does (another process removed it, which counts as removed).
 * @throws When another entry stands at the path now (a link, another directory): the walk stops, and nothing more below the path is removed.
 * @example
 * await isStillTheDirectory('/tmp/codebook-browser-a1b2c3', looked) // => true
 */
async function isStillTheDirectory(
  path: string,
  looked: LookedDirectory,
): Promise<boolean> {
  const now = await lstat(path, { bigint: true }).catch(passIfMissing)
  if (!now) return false
  // Another entry at the path: a link would lead the next removal elsewhere.
  if (!now.isDirectory() || now.dev !== looked.dev || now.ino !== looked.ino)
    throw new Error(
      `The folder ${path} was replaced by another entry while Codebook emptied it; nothing more in it was removed.`,
    )
  return true
}

/** What {@link removeWithoutFollowing} may be told beside the path. */
export type RemovalOrder = {
  /** The name of one entry of the directory at the path, removed after all its other entries and just before the directory itself: the owner marker by which a later sweep knows the folder ({@link removeAbandonedProfiles}), so a folder whose removal stops at an entry that refuses keeps it. Left out, the entries go in the order the system lists them. */
  lastEntry?: string
}

/**
 * Removes every entry of a directory that answered "not empty", after it is shown to be its parent's own entry; called by {@link removeWithoutFollowing} before it removes the emptied directory.
 * @param path - The directory that is not empty.
 * @param looked - The directory's device and file id at the walk's look, which the path must still name before the listing and before each entry's removal ({@link isStillTheDirectory}).
 * @param notEmptyError - What the system answered to its removal.
 * @param lastEntry - The name of the entry removed after all the others ({@link RemovalOrder}); none when left out.
 * @returns After every entry is removed; also when the directory is gone meanwhile.
 * @throws `notEmptyError` when the entry is no directory of its parent's own ({@link isFolderOfItsOwn}): nothing below it is listed. The error of {@link isStillTheDirectory} when another entry took the directory's place. The file system's error of the first entry that cannot be removed.
 * @example
 * await removeEntriesOf('/repo/.codebook/wiki.update-run.json.takeover-4f2c', error) // its owner file is gone
 */
async function removeEntriesOf(
  path: string,
  looked: LookedDirectory,
  notEmptyError: unknown,
  lastEntry?: string,
): Promise<void> {
  const isOwnFolder = await isFolderOfItsOwn(path).catch(passIfMissing)
  // An entry that leads elsewhere is never listed: the system's answer to its removal is the walk's error.
  if (isOwnFolder === false) throw notEmptyError
  // Gone since the system was asked: nothing is left to remove.
  if (isOwnFolder === undefined || !(await isStillTheDirectory(path, looked)))
    return
  const names = await namesIn(path)
  // The named entry goes last, so a removal that stops at an earlier entry leaves it in place.
  const ordered = [
    ...names.filter((name) => name !== lastEntry),
    ...names.filter((name) => name === lastEntry),
  ]
  for (const name of ordered) {
    // The listing and every removal below the path are made only while the path still names the directory looked at.
    if (!(await isStillTheDirectory(path, looked))) return
    await removeWithoutFollowing(join(path, name))
  }
}

/**
 * Removes what stands at a path by a walk of Codebook's own that follows no link; called by the claim on a Wiki update's marker ({@link claimWikiUpdateMarker}) and by the takeover claim and its sweep ({@link claimStorageLockTakeover}, {@link removeStaleStorageClaims}) for every entry they remove at the marker's or the lock's paths, and by the sweep of abandoned browser profile folders ({@link removeAbandonedProfiles}) for a folder of the shared profile root.
 *
 * Why: the marker's paths lie in the learner's project folder, where a cloned repository decides what stands there, and a link there must be removed as a name while the folder it leads to stays as it is. The recursive `rm` of Node.js does that as long as its first try succeeds; when the system refuses the look or the unlink with `EPERM`, its Windows path asks `stat`, which follows a link, and may go on into the folder the link leads to. Each editor runs the extension on its own Node.js, so the removal does not rest on what one version's fallback does. Every entry is looked at with `lstat`; a link or a file is removed with `unlink`; what the look calls a directory is handed to the system's `rmdir` first, and only when the system answers that it is not empty, and the entry is its parent's own ({@link isFolderOfItsOwn}), is it listed and emptied entry by entry. Every other answer is the walk's error for that entry. No other way is tried.
 * The look alone does not show every entry that leads elsewhere: on Windows the file system layer of Node.js calls a junction to a volume a directory. Such an entry is removed by `rmdir` as a name or fails by its name, and is never listed.
 * An entry that is gone at any step counts as removed, because another window may remove the same entry in the same moment.
 * A directory's path must still name the directory the walk looked at, by its device and file id, before the walk lists it and before it removes each of its entries ({@link isStillTheDirectory}); a directory that a running program renamed and replaced by a link or another directory stops the walk with an error, and nothing more below its path is removed.
 * Limit: the last confirmation and the removal it precedes are separate steps, so a program that renames the directory and puts a link at its path in between still leads one removal through the link. Only a program with write access to the directory's parent can do that, and every caller's parent keeps other users out: the profile sweep's root is the shared `/tmp` on macOS and Linux, where its sticky bit lets no other user rename this user's folder, and each profile folder is made with mode 0700; on Windows it is a folder of this user's own ({@link managedProfileRoot}); the storage locks', claims' and Wiki marker's paths lie in the learner's own project folder, where a cloned repository puts files but runs no program.
 *
 * @param path - The entry to remove: a file, a link (a junction on Windows) or a directory with its content.
 * @param order - The entry of a directory at the path to remove last ({@link RemovalOrder}); the entries go in the order the system lists them when left out.
 * @returns After the entry is gone; also when nothing stood at the path, or another process removed it meanwhile.
 * @throws The file system's error of the first entry that cannot be looked at, unlinked, listed or removed (for example `EPERM` for a link the system does not let this user remove, `ENOTEMPTY` for an entry that leads elsewhere and that the system does not remove as a name); what was removed before stays removed, and nothing below a link is touched.
 * @example
 * await removeWithoutFollowing('/repo/.codebook/wiki.update-run.json.takeover-4f2c') // the prepared claim folder and its owner file are gone
 * await removeWithoutFollowing('/repo/.codebook/a-link-to-the-project')              // the link is gone, the project keeps every file
 * await removeWithoutFollowing(profile, { lastEntry: 'codebook-owner.json' })          // the marker goes after every other entry of the profile folder
 */
export async function removeWithoutFollowing(
  path: string,
  order: RemovalOrder = {},
): Promise<void> {
  const entry = await lstat(path, { bigint: true }).catch(passIfMissing)
  if (!entry) return
  // A link, a file or a special file is one name: it is unlinked and never opened or listed.
  if (!entry.isDirectory()) {
    await unlink(path).catch(passIfMissing)
    return
  }
  // The system is asked first; only a directory it calls not empty is listed.
  const notEmptyError = await removeIfEmpty(path)
  if (notEmptyError === undefined) return
  await removeEntriesOf(
    path,
    { dev: entry.dev, ino: entry.ino },
    notEmptyError,
    order.lastEntry,
  )
  await rmdir(path).catch(passIfMissing)
}
