import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  MANAGED_PROFILE_OWNER_FILE,
  MANAGED_PROFILE_PREFIX,
  MANAGED_PROFILE_SWEEP_LIMIT,
} from '../../constants'
import { currentUserName } from '../../utils/currentUserName'
import { isRecordedOwnerGone } from '../../utils/isRecordedOwnerGone'
import {
  readProcessStart,
  type ProcessStartReader,
} from '../../utils/readProcessStart'
import {
  readRecordedOwner,
  type StorageOwnerIdentity,
} from '../../utils/readRecordedOwner'
import { removeWithoutFollowing } from '../../utils/removeWithoutFollowing'
import { withoutBootTime } from '../../utils/withoutBootTime'

import {
  listProcesses,
  type ListedProcess,
  type ProcessListingInputs,
} from './listProcesses'
import {
  readOwnedBrowserMarker,
  type OwnedBrowserMarker,
} from './ownedBrowserMarker'
import { ownedBrowserProcessSet } from './ownedBrowserProcesses'
import { profileProcesses } from './profileProcesses'
import {
  REAL_PROCESS_STOPPER,
  stopListedProcesses,
  type ProcessStopper,
} from './stopListedProcesses'

/**
 * Stops the live browser of an owned profile whose editor is gone, so the folder can be removed (ER18); called by {@link removeUnusedProfile}.
 * The processes are listed again right now, because the sweep's one listing may be minutes old and a pid can have been reused since. Only the browser's main process, proven by the pid and executable the launch recorded and the exact `--user-data-dir` ({@link ownedBrowserProcessSet}), is signalled through its process group, and never this process; its helpers end with it; when anything else still names the folder, nothing is signalled and the folder stays.
 * @param profile - The owned profile folder.
 * @param marker - The executable and pid recorded in the folder's owned-browser marker.
 * @param sweep - The running sweep, for its listing and signals.
 * @returns `true` when no process names the folder any more.
 * @example
 * await stopOrphanBrowser('/tmp/codebook-browser-a1b2c3', { executable: '/opt/chrome/chrome', pid: 4242 }, sweep) // => true
 */
async function stopOrphanBrowser(
  profile: string,
  marker: OwnedBrowserMarker,
  sweep: Pick<ProfileSweep, 'stopper' | 'listAgain'>,
): Promise<boolean> {
  const inputs = { pathsMayNotResolve: true }
  const listing = await sweep.listAgain()
  const named = await profileProcesses(profile, listing, inputs)
  // Nothing names the folder any more.
  if (named.length === 0) return true
  const { main, foreign } = await ownedBrowserProcessSet(
    profile,
    marker,
    listing,
    named,
    inputs,
  )
  // Without a proven main process, or with a stranger that only names the folder, nothing is signalled and the folder stays.
  if (main === undefined || foreign.length > 0) return false
  if (main.pid === process.pid) return false
  // Only the main process's group (spawned detached) or pid is signalled; its helpers end with it.
  const stopped = await stopListedProcesses([main.pid], sweep.stopper, {
    groupLeaders: [main.pid],
  })
  if (!stopped) return false
  // A fresh listing proves that nothing names the folder before it is removed.
  const remaining = await profileProcesses(
    profile,
    await sweep.listAgain(),
    inputs,
  )
  return remaining.length === 0
}

/**
 * Removes one profile folder when no process uses it as its profile; called by {@link sweepProfile} for a folder whose owner is gone.
 * The folder is removed by {@link removeWithoutFollowing}, which unlinks every link inside it as a name: the recursive `rm` of Node.js follows a link it cannot unlink on Windows and empties the folder the link leads to. Its owner marker ({@link MANAGED_PROFILE_OWNER_FILE}) is removed last, after every other entry, so a removal that stops at an entry the system refuses (a file Windows still holds) leaves a folder a later sweep still knows and tries again.
 * @param profile - The profile folder.
 * @param processes - The one process listing of the sweep ({@link ProfileSweep}), made at its first folder whose owner is gone.
 * @returns
 * - `true` when the folder was removed
 * - `false` when a process still runs with it, when the processes cannot be listed, and when the removal fails: what was not removed stays, the marker among it
 * @example
 * await removeUnusedProfile('/tmp/codebook-browser-a1b2c3', sweep.processes()) // => true
 */
async function removeUnusedProfile(
  profile: string,
  processes: Promise<ListedProcess[]>,
  sweep: Pick<ProfileSweep, 'stopper' | 'listAgain'>,
): Promise<boolean> {
  try {
    // A folder of this user's own root on a volume that resolves no path is judged and removed by its listed path.
    const using = await profileProcesses(profile, await processes, {
      pathsMayNotResolve: true,
    })
    // A browser still names the folder: only an owned browser's folder lets the sweep stop it first.
    if (using.length) {
      const marker = await readOwnedBrowserMarker(profile)
      if (!marker || !(await stopOrphanBrowser(profile, marker, sweep)))
        return false
    }
    // The marker goes last: a folder whose removal stops at an entry that refuses keeps it, and a later sweep tries again.
    await removeWithoutFollowing(profile, {
      lastEntry: MANAGED_PROFILE_OWNER_FILE,
      pathsMayNotResolve: true,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Says whether a profile folder is a real directory of this user, before its owner marker is read; called by {@link sweepProfile} for each candidate folder.
 * Why: on macOS and Linux the profile root is the shared `/tmp`, where another user of the machine can make a folder with the profile prefix and a marker that names a gone process of this machine. Such a folder is never judged, so it is neither removed nor counted. Windows has no user id; there the root is the user's own local application data folder ({@link managedProfileRoot}), which other users cannot open.
 * @param profile - The candidate folder.
 * @returns
 * - `true` for a real directory (looked at without following a link) whose owner is the user this process runs as; on Windows, which has no user id (`process.getuid` is absent), for every real directory of the user's own root
 * - `false` for a folder of another user, for a link, and for a path that cannot be looked at
 * @example
 * await isOwnProfileFolder('/tmp/codebook-browser-a1b2c3') // => true for a folder this user's editor made
 * await isOwnProfileFolder('/tmp/codebook-browser-planted') // => false for a folder another user made
 */
async function isOwnProfileFolder(profile: string): Promise<boolean> {
  const entry = await lstat(profile).catch(() => undefined)
  if (!entry?.isDirectory()) return false
  // Windows has no user id to compare: there the root is the user's own local application data folder (managedProfileRoot), and every real directory in it is judged by its marker.
  return process.getuid === undefined || entry.uid === process.getuid()
}

/** What one sweep has done so far: how many folders with a readable owner marker it judged, which is what its bound counts, and the folders it removed; `processes` gives the sweep's one process listing, made when it is first asked for, and `readStart` reads a process's start and keeps what the sweep has read. */
type ProfileSweep = {
  /** The operating-system user this sweep runs as ({@link currentUserName}); `undefined` where the system names none. */
  userName: string | undefined
  judgedCount: number
  removed: string[]
  processes: () => Promise<ListedProcess[]>
  readStart: ProcessStartReader
  /** Lists the processes again, after an orphan browser was stopped. */
  listAgain: () => Promise<ListedProcess[]>
  /** The signals by which an owned profile's orphan browser is stopped. */
  stopper: ProcessStopper
}

/**
 * Judges one profile folder by its owner marker, removes it when its owner is gone and nothing uses it, and records both in the sweep; called by {@link removeAbandonedProfiles} for each real directory with the profile prefix.
 * A folder of another user ({@link isOwnProfileFolder}) and a folder without a readable marker are never touched, whoever made them, and are not counted: they take none of the sweep's bound.
 * @param profile - The profile folder.
 * @param judgedBy - The identity of this process without its boot time ({@link withoutBootTime}), by which the marker's owner is judged.
 * @param sweep - The running sweep: its `judgedCount` grows by one for a folder of this user with a readable marker, and `removed` gains the folder when it was removed. A folder whose owner may still run ({@link isRecordedOwnerGone}), that a process still uses, or whose removal failed is counted and stays.
 * @example
 * await sweepProfile('/tmp/codebook-browser-a1b2c3', { hostname: 'workstation' }, sweep) // sweep: { judgedCount: 1, removed: ['/tmp/codebook-browser-a1b2c3'] } after the editor that made it was killed
 */
async function sweepProfile(
  profile: string,
  judgedBy: StorageOwnerIdentity,
  sweep: ProfileSweep,
): Promise<void> {
  // A folder another user made in the shared root is not this editor's to judge, whatever its marker says.
  if (!(await isOwnProfileFolder(profile))) return
  const owner = await readRecordedOwner(
    join(profile, MANAGED_PROFILE_OWNER_FILE),
  )
  if (!owner) return
  // A marker that names another user is that user's to judge, wherever the folder lies (a root several users share on Windows).
  if (owner.user !== undefined && owner.user !== sweep.userName) return
  sweep.judgedCount += 1
  // An owner that may still run: the folder is not known to be abandoned.
  if (!(await isRecordedOwnerGone(owner, judgedBy, sweep.readStart))) return
  if (await removeUnusedProfile(profile, sweep.processes(), sweep))
    sweep.removed.push(profile)
}

/**
 * Removes the browser profile folders that a killed editor left behind, so that they do not pile up in the profile root; started by {@link HostBrowser.launch} beside a managed run's start, which does not wait for it, and awaited by {@link HostBrowser.close}.
 *
 * A folder is removed only on proof that Codebook made it for this user and nothing uses it: it is a real directory of the user this process runs as ({@link isOwnProfileFolder}; Windows has no user id to compare, and its root is the user's own local application data folder), it carries the owner marker
 * ({@link MANAGED_PROFILE_OWNER_FILE}), the marker's process is gone from this machine, also when another process has its id now ({@link isRecordedOwnerGone}, judged without a boot time,
 * see {@link withoutBootTime}), and no process runs with the folder as its profile. A folder without a readable marker is never touched, whoever made it.
 * One sweep judges at most {@link MANAGED_PROFILE_SWEEP_LIMIT} marked folders; the folders without a marker that builds before the marker left behind,
 * and the folders of other users, take none of that bound, so they cannot keep the marked folders listed after them from being looked at. The processes are listed once per sweep, at its first folder
 * whose owner is gone, and every such folder is matched against that one listing, which counts every process that may be this user's: on Windows also a process of another logon session whose owner cannot be confirmed ({@link ProcessListingInputs.keepsUnconfirmedOwners}), so a folder such a process names stays. A listing that fails, runs longer than its time bound or prints more than its limit
 * ({@link listProcesses}) removes nothing: every folder stays for a later run, like a folder whose removal fails. A folder is removed by {@link removeWithoutFollowing}: a link inside it is removed as a name, and the files it leads to stay. The starts of the marker's processes are kept for the sweep, so the folders of one running editor cost one read;
 * a kept start never calls an owner gone.
 *
 * @param root - The directory that holds the profile folders: {@link managedProfileRoot} in the product (the shared `/tmp` on macOS and Linux, the user's own local application data folder on Windows), a directory of their own in tests.
 * @param identity - The machine and the boot of this process, by which a marker's owner is judged.
 * @param listRunningProcesses - Lists the processes of this machine, asked to keep the processes whose owner cannot be confirmed; {@link listProcesses} unless a test counts the listings or names its own listing.
 * @param readStart - Reads the start of the process that has a marker's process id now; {@link readProcessStart} unless a test names its own.
 * @param userName - The operating-system user this sweep runs as; {@link currentUserName} unless a test names its own. A folder whose marker names another user is left and not counted, on every system.
 * @param stopper - The signals by which a live browser of an owned profile (`codebook-owned-browser`) whose editor is gone is stopped before its folder is removed (ER18); {@link REAL_PROCESS_STOPPER} unless a test names its own. A folder without that file keeps the rule above: a process that names it keeps it.
 * @returns The folders that were removed, in the order the directory listed them; empty when the root cannot be read. Nothing here throws: what cannot be
 * read, judged or removed stays in place.
 * @example
 * await removeAbandonedProfiles('/tmp', await currentStorageOwner()) // => ['/tmp/codebook-browser-a1b2c3'] after the editor that made it was killed
 */
export async function removeAbandonedProfiles(
  root: string,
  identity: StorageOwnerIdentity,
  listRunningProcesses: (
    inputs: ProcessListingInputs,
  ) => Promise<ListedProcess[]> = listProcesses,
  readStart: ProcessStartReader = readProcessStart,
  userName: string | undefined = currentUserName(),
  stopper: ProcessStopper = REAL_PROCESS_STOPPER,
): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  // A link with the prefix is no profile folder of Codebook's making; only real directories are looked at.
  const candidates = entries.filter(
    (entry) =>
      entry.isDirectory() && entry.name.startsWith(MANAGED_PROFILE_PREFIX),
  )
  const judgedBy = withoutBootTime(identity)
  let listing: Promise<ListedProcess[]> | undefined
  const cache = new Map<number, Promise<string | undefined>>()
  const sweep: ProfileSweep = {
    userName,
    judgedCount: 0,
    removed: [],
    // One listing serves every folder of the sweep; it is made only when a folder's owner is gone. A process that may be this user's holds the folder it names (Cycle 0047 row 196).
    processes: () =>
      (listing ??= listRunningProcesses({ keepsUnconfirmedOwners: true })),
    readStart: (pid, inputs) => readStart(pid, { ...inputs, cache }),
    listAgain: () =>
      listRunningProcesses({
        keepsUnconfirmedOwners: true,
        withParentPids: true,
      }),
    stopper,
  }
  for (const candidate of candidates) {
    // The bound counts the folders whose marker was judged, not the listing: a folder without a readable marker costs one failed read. The rest wait for a later run.
    if (sweep.judgedCount >= MANAGED_PROFILE_SWEEP_LIMIT) break
    await sweepProfile(join(root, candidate.name), judgedBy, sweep)
  }
  return sweep.removed
}
