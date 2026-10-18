import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

import { systemErrorCode } from './systemErrorCode'

/**
 * Says whether two names of one entry are the same name, as a file system that ignores case or stores another Unicode form may answer a real path; called by {@link isFolderOfItsOwn} for the last part of a path and of its real path.
 * @param realName - The name the file system answered.
 * @param writtenName - The name as the caller wrote it.
 * @returns `true` when both are equal, also when they differ only in case or in Unicode form.
 * @example
 * isSameName('wiki', 'Wiki')     // => true
 * isSameName('elsewhere', 'wiki') // => false
 */
function isSameName(realName: string, writtenName: string): boolean {
  return (
    realName === writtenName ||
    realName.normalize('NFC').toLowerCase() ===
      writtenName.normalize('NFC').toLowerCase()
  )
}

/**
 * Answers a real path that cannot be read as "no entry of its parent", unless the entry is gone; called by {@link isFolderOfItsOwn} for the real path of an entry and of its parent.
 * @param error - What `realpath` threw.
 * @returns `false` for every failure but a missing entry.
 * @throws The given error itself for `ENOENT`: an entry that vanished after the look is gone, not a folder that leads elsewhere.
 * @example
 * await realpath(path).catch(falseUnlessMissing) // => false for a junction whose volume cannot be named
 */
function falseUnlessMissing(error: unknown): false {
  if (systemErrorCode(error) === 'ENOENT') throw error
  return false
}

/**
 * Says whether an entry is where its parent says it is: its real path is its own name under its parent's real path; called by {@link isFolderOfItsOwn} for an entry the look without following called a directory.
 * @param path - The entry's path as written.
 * @param pathsMayNotResolve - Takes an entry whose real path and whose parent's real path both cannot be read (a volume that resolves no path, as some Windows RAM disks, `subst` and network drives) as its parent's own; {@link isFolderOfItsOwn}'s caller decides.
 * @returns `true` when both real paths can be read and agree, and with `pathsMayNotResolve` when neither can be read; `false` when the entry leads elsewhere, and when the system cannot name one of the two real paths.
 * @throws The file system's `ENOENT` when the entry or its parent is gone.
 * @example
 * await isNamedByItsParent('/link-to-the-project/.codebook/wiki') // => true: '/the-project/.codebook/wiki' lies under '/the-project/.codebook'
 */
async function isNamedByItsParent(
  path: string,
  pathsMayNotResolve: boolean,
): Promise<boolean> {
  const realParent = await realpath(dirname(path)).catch(falseUnlessMissing)
  const realPath = await realpath(path).catch(falseUnlessMissing)
  // A volume that resolves no path at all, the parent's as little as the entry's, shows nothing either way: a caller that knows the folder may take it as it stands.
  if (realParent === false && realPath === false) return pathsMayNotResolve
  // A real path the system cannot name shows no entry of its parent.
  if (realParent === false || realPath === false) return false
  return (
    dirname(realPath) === realParent &&
    isSameName(basename(realPath), basename(path))
  )
}

/**
 * Says whether a real directory stands at a path as its parent's own entry, before anything below that path is listed, read or removed; called by {@link listFolderTreeWithoutFollowing}, {@link listPlacedClaims}, {@link findWikiUpdateStartBlock}, {@link removeWithoutFollowing} and the sweeps that read an owner file below a prepared claim folder.
 *
 * Why: these paths lie in the learner's project folder, where a cloned repository decides what stands there, and a listing or a read below a path follows whatever the path leads to. A look without following (`lstat`) refuses a link, but it does not see every entry that leads elsewhere: the file system layer of Node.js on Windows calls a junction whose target is a volume (`\\??\\Volume{…}\\`) a directory, because it reports only junctions to a drive path as links. So the look is not enough. A directory of its own is where its parent says it is: its real path is its own name under its parent's real path. An entry that leads elsewhere has another real path and is answered as no folder.
 * The parent is compared by its real path, not as written, so a project that is itself reached through a link, a mapped drive or a short name still has folders of its own. A mount point on Linux or macOS is its parent's own entry by this rule; no repository can carry one.
 * Limit: a last part written as a Windows short name (`WIKI~1`) has another real name and is answered as no folder. The look and what follows it are separate steps: a path that a running program replaces between them is not covered.
 *
 * @param path - The path that is to be listed, read below or emptied.
 * @param pathsMayNotResolve - For a folder the caller knows to lie in a root of its own (the sweep of abandoned browser profiles): a directory on a volume that resolves no path, its parent's neither, is its parent's own. `false` unless a caller says so, so a folder of the learner's project must always show its real path.
 * @returns `true` for a directory whose real path is its name under its parent's real path; `false` for a link, a junction, a file, a special file, for a directory that leads elsewhere, and for one whose real path the system cannot name.
 * @throws The file system's error when nothing stands at the path (`ENOENT`) or the path or its parent cannot be looked at.
 * @example
 * await isFolderOfItsOwn('/repo/.codebook/wiki')           // => true
 * await isFolderOfItsOwn('/repo/.codebook/a-link-to-/usr') // => false
 */
export async function isFolderOfItsOwn(
  path: string,
  pathsMayNotResolve = false,
): Promise<boolean> {
  const entry = await lstat(path)
  return entry.isDirectory() && isNamedByItsParent(path, pathsMayNotResolve)
}
