import { lstat, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { REMOVAL_RELISTS_BEFORE_LAST_ENTRY } from '../constants'

import { isFolderOfItsOwn } from './isFolderOfItsOwn'
import { openWithoutFollowing } from './openWithoutFollowing'
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
 * @param lastEntry - The name of the entry left for {@link removeLastEntryAndDirectory} ({@link RemovalOrder}); none when left out, and every entry is removed.
 * @returns `true` once every listed entry but the last one is removed; `false` when the directory is gone meanwhile.
 * @throws `notEmptyError` when the entry is no directory of its parent's own ({@link isFolderOfItsOwn}): nothing below it is listed. The error of {@link isStillTheDirectory} when another entry took the directory's place. The file system's error of the first entry that cannot be removed.
 * @example
 * await removeEntriesOf('/repo/.codebook/wiki.update-run.json.takeover-4f2c', looked, error) // => true, its owner file is gone
 */
async function removeEntriesOf(
  path: string,
  looked: LookedDirectory,
  notEmptyError: unknown,
  lastEntry?: string,
): Promise<boolean> {
  const isOwnFolder = await isFolderOfItsOwn(path).catch(passIfMissing)
  // An entry that leads elsewhere is never listed: the system's answer to its removal is the walk's error.
  if (isOwnFolder === false) throw notEmptyError
  // Gone since the system was asked: nothing is left to remove.
  if (isOwnFolder === undefined || !(await isStillTheDirectory(path, looked)))
    return false
  const names = (await namesIn(path)).filter((name) => name !== lastEntry)
  return removeNamedEntries(path, looked, names)
}

/**
 * Removes the named entries of a directory, one by one; called by {@link removeEntriesOf} for the first listing and by {@link removeLastEntryAndDirectory} for each listing after it.
 * @param path - The directory, shown to be its parent's own.
 * @param looked - Its device and file id at the walk's look ({@link isStillTheDirectory}).
 * @param names - The entries a listing gave, without the one that goes last.
 * @returns `true` once the entries are removed; `false` when the directory is gone meanwhile.
 * @throws The error of {@link isStillTheDirectory} when another entry took the directory's place, and the file system's error of the first entry that cannot be removed.
 * @example
 * await removeNamedEntries('/tmp/codebook-browser-a1b2c3', looked, ['Default']) // => true, only the marker is left
 */
async function removeNamedEntries(
  path: string,
  looked: LookedDirectory,
  names: string[],
): Promise<boolean> {
  for (const name of names) {
    // The listing and every removal below the path are made only while the path still names the directory looked at.
    if (!(await isStillTheDirectory(path, looked))) return false
    await removeWithoutFollowing(join(path, name))
  }
  return true
}

/** A regular file's bytes and permission bits, kept so that the entry can be written back. */
type KeptEntry = { bytes: Uint8Array; mode: number }

/**
 * Reads the entry that goes last before the walk removes it, so that it can be written back when the directory cannot be removed after it; called by {@link removeLastEntryAndDirectory}.
 * @param path - The entry's path.
 * @returns Its bytes and permission bits for a regular file; `undefined` for a link, any other entry, a missing one, and one that cannot be read.
 * @example
 * await keptEntryAt('/tmp/codebook-browser-a1b2c3/codebook-owner.json') // => { bytes: Uint8Array(…), mode: 0o644 }
 */
async function keptEntryAt(path: string): Promise<KeptEntry | undefined> {
  const file = await openWithoutFollowing(path).catch(() => undefined)
  if (!file) return undefined
  try {
    const entry = await file.stat()
    // A pipe, a device or a folder at the path is no marker to keep.
    if (!entry.isFile()) return undefined
    return { bytes: await file.readFile(), mode: entry.mode & 0o777 }
  } catch {
    return undefined
  } finally {
    await file.close()
  }
}

/**
 * Removes the entry that goes last and then the directory, once nothing else is left in it; called by {@link removeWithoutFollowing} for a directory with a {@link RemovalOrder.lastEntry} after its listed entries are removed.
 * Why: another program may make an entry in the directory after the walk's listing (Chrome writing a file as it ends, an antivirus scan). Before the last entry goes, the directory is listed again, up to {@link REMOVAL_RELISTS_BEFORE_LAST_ENTRY} times, and the new entries are removed first; the last entry is removed only when it is all that is left. An entry made after that, before the directory's own removal, makes the system answer "not empty": the last entry is written back then, so a later removal still knows the directory.
 * @param path - The directory, shown to be its parent's own.
 * @param looked - Its device and file id at the walk's look ({@link isStillTheDirectory}).
 * @param lastEntry - The entry that goes last (the owner marker of a profile folder).
 * @returns After the directory is gone; also when it went meanwhile.
 * @throws When the directory still gains entries after its last listing: its last entry stays. The system's error of the directory's removal, after the last entry was written back. Every error of {@link removeNamedEntries}.
 * @example
 * await removeLastEntryAndDirectory('/tmp/codebook-browser-a1b2c3', looked, 'codebook-owner.json') // the folder and its marker are gone
 */
async function removeLastEntryAndDirectory(
  path: string,
  looked: LookedDirectory,
  lastEntry: string,
): Promise<void> {
  // Entries made after a listing are removed before the last entry; each listing may find new ones.
  for (let relist = 0; ; relist += 1) {
    const others = (await namesIn(path)).filter((name) => name !== lastEntry)
    if (others.length === 0) break
    if (relist === REMOVAL_RELISTS_BEFORE_LAST_ENTRY)
      throw new Error(
        `The folder ${path} kept gaining entries while Codebook emptied it (${others.join(', ')}); its ${lastEntry} stays, so a later removal tries again.`,
      )
    if (!(await removeNamedEntries(path, looked, others))) return
  }
  const lastEntryPath = join(path, lastEntry)
  const kept = await keptEntryAt(lastEntryPath)
  await removeWithoutFollowing(lastEntryPath)
  try {
    await rmdir(path)
  } catch (error) {
    // An entry made after the last listing keeps the directory: the last entry goes back, made new and never through a link.
    if (kept && NOT_EMPTY_CODES.includes(systemErrorCode(error)))
      await writeFile(lastEntryPath, kept.bytes, {
        flag: 'wx',
        mode: kept.mode,
      }).catch(() => undefined)
    passIfMissing(error)
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
  const looked = { dev: entry.dev, ino: entry.ino }
  const emptied = await removeEntriesOf(
    path,
    looked,
    notEmptyError,
    order.lastEntry,
  )
  // The entry that goes last is removed only when nothing else is left, and comes back when the directory still cannot go.
  if (emptied && order.lastEntry !== undefined)
    return removeLastEntryAndDirectory(path, looked, order.lastEntry)
  await rmdir(path).catch(passIfMissing)
}
