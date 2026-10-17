import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import {
  MANAGED_PROFILE_OWNER_FILE,
  MANAGED_PROFILE_PREFIX,
  MANAGED_PROFILE_SWEEP_LIMIT,
} from '../../constants'
import { isRecordedOwnerGone } from '../../utils/isRecordedOwnerGone'
import {
  readProcessStart,
  type ProcessStartReader,
} from '../../utils/readProcessStart'
import {
  readRecordedOwner,
  type StorageOwnerIdentity,
} from '../../utils/readRecordedOwner'
import { withoutBootTime } from '../../utils/withoutBootTime'

import { listProcesses, type ListedProcess } from './listProcesses'
import { profileProcesses } from './profileProcesses'

/**
 * Removes one profile folder when no process uses it as its profile; called by {@link sweepProfile} for a folder whose owner is gone.
 * @param profile - The profile folder.
 * @param processes - The one process listing of the sweep ({@link ProfileSweep}), made at its first folder whose owner is gone.
 * @returns
 * - `true` when the folder was removed
 * - `false` when a process still runs with it, when the processes cannot be listed, and when the removal fails: the folder stays
 * @example
 * await removeUnusedProfile('/tmp/codebook-browser-a1b2c3', sweep.processes()) // => true
 */
async function removeUnusedProfile(
  profile: string,
  processes: Promise<ListedProcess[]>,
): Promise<boolean> {
  try {
    if ((await profileProcesses(profile, await processes)).length) return false
    await rm(profile, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/** What one sweep has done so far: how many folders with a readable owner marker it judged, which is what its bound counts, and the folders it removed; `processes` gives the sweep's one process listing, made when it is first asked for, and `readStart` reads a process's start and keeps what the sweep has read. */
type ProfileSweep = {
  judgedCount: number
  removed: string[]
  processes: () => Promise<ListedProcess[]>
  readStart: ProcessStartReader
}

/**
 * Judges one profile folder by its owner marker, removes it when its owner is gone and nothing uses it, and records both in the sweep; called by {@link removeAbandonedProfiles} for each real directory with the profile prefix.
 * A folder without a readable marker is never touched, whoever made it, and is not counted: it takes none of the sweep's bound.
 * @param profile - The profile folder.
 * @param judgedBy - The identity of this process without its boot time ({@link withoutBootTime}), by which the marker's owner is judged.
 * @param sweep - The running sweep: its `judgedCount` grows by one for a folder with a readable marker, and `removed` gains the folder when it was removed. A folder whose owner may still run ({@link isRecordedOwnerGone}), that a process still uses, or whose removal failed is counted and stays.
 * @example
 * await sweepProfile('/tmp/codebook-browser-a1b2c3', { hostname: 'workstation' }, sweep) // sweep: { judgedCount: 1, removed: ['/tmp/codebook-browser-a1b2c3'] } after the editor that made it was killed
 */
async function sweepProfile(
  profile: string,
  judgedBy: StorageOwnerIdentity,
  sweep: ProfileSweep,
): Promise<void> {
  const owner = await readRecordedOwner(
    join(profile, MANAGED_PROFILE_OWNER_FILE),
  )
  if (!owner) return
  sweep.judgedCount += 1
  // An owner that may still run: the folder is not known to be abandoned.
  if (!(await isRecordedOwnerGone(owner, judgedBy, sweep.readStart))) return
  if (await removeUnusedProfile(profile, sweep.processes()))
    sweep.removed.push(profile)
}

/**
 * Removes the browser profile folders that a killed editor left behind, so that they do not pile up in the profile root; started by {@link HostBrowser.launch} beside a managed run's start, which does not wait for it, and awaited by {@link HostBrowser.close}.
 *
 * A folder is removed only on proof that Codebook made it and nothing uses it: it is a real directory, it carries the owner marker
 * ({@link MANAGED_PROFILE_OWNER_FILE}), the marker's process is gone from this machine, also when another process has its id now ({@link isRecordedOwnerGone}, judged without a boot time,
 * see {@link withoutBootTime}), and no process runs with the folder as its profile. A folder without a readable marker is never touched, whoever made it.
 * One sweep judges at most {@link MANAGED_PROFILE_SWEEP_LIMIT} marked folders; the folders without a marker that builds before the marker left behind
 * take none of that bound, so they cannot keep the marked folders listed after them from being looked at. The processes are listed once per sweep, at its first folder
 * whose owner is gone, and every such folder is matched against that one listing. A listing that fails, runs longer than its time bound or prints more than its limit
 * ({@link listProcesses}) removes nothing: every folder stays for a later run, like a folder whose removal fails. The starts of the marker's processes are kept for the sweep, so the folders of one running editor cost one read;
 * a kept start never calls an owner gone.
 *
 * @param root - The directory that holds the profile folders: {@link MANAGED_PROFILE_ROOT} in the product, a directory of their own in tests.
 * @param identity - The machine and the boot of this process, by which a marker's owner is judged.
 * @param listRunningProcesses - Lists the processes of this machine; {@link listProcesses} unless a test counts the listings.
 * @param readStart - Reads the start of the process that has a marker's process id now; {@link readProcessStart} unless a test names its own.
 * @returns The folders that were removed, in the order the directory listed them; empty when the root cannot be read. Nothing here throws: what cannot be
 * read, judged or removed stays in place.
 * @example
 * await removeAbandonedProfiles('/tmp', await currentStorageOwner()) // => ['/tmp/codebook-browser-a1b2c3'] after the editor that made it was killed
 */
export async function removeAbandonedProfiles(
  root: string,
  identity: StorageOwnerIdentity,
  listRunningProcesses: () => Promise<ListedProcess[]> = listProcesses,
  readStart: ProcessStartReader = readProcessStart,
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
    judgedCount: 0,
    removed: [],
    // One listing serves every folder of the sweep; it is made only when a folder's owner is gone.
    processes: () => (listing ??= listRunningProcesses()),
    readStart: (pid, inputs) => readStart(pid, { ...inputs, cache }),
  }
  for (const candidate of candidates) {
    // The bound counts the folders whose marker was judged, not the listing: a folder without a readable marker costs one failed read. The rest wait for a later run.
    if (sweep.judgedCount >= MANAGED_PROFILE_SWEEP_LIMIT) break
    await sweepProfile(join(root, candidate.name), judgedBy, sweep)
  }
  return sweep.removed
}
