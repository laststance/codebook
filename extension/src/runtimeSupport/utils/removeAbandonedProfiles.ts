import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import {
  MANAGED_PROFILE_OWNER_FILE,
  MANAGED_PROFILE_PREFIX,
  MANAGED_PROFILE_SWEEP_LIMIT,
} from '../../constants'
import { isRecordedOwnerGone } from '../../utils/isRecordedOwnerGone'
import {
  readRecordedOwner,
  type StorageOwnerIdentity,
} from '../../utils/readRecordedOwner'
import { withoutBootTime } from '../../utils/withoutBootTime'

import { profileProcesses } from './profileProcesses'

/**
 * Removes one profile folder when no process uses it as its profile; called by {@link removeAbandonedProfiles} for a folder whose owner is gone.
 * @param profile - The profile folder.
 * @returns
 * - `true` when the folder was removed
 * - `false` when a process still runs with it, when the processes cannot be listed, and when the removal fails: the folder stays
 * @example
 * await removeUnusedProfile('/tmp/codebook-browser-a1b2c3') // => true
 */
async function removeUnusedProfile(profile: string): Promise<boolean> {
  try {
    if ((await profileProcesses(profile)).length) return false
    await rm(profile, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/**
 * Reads one profile folder's owner marker and says whether its owner is gone from this machine; called by {@link removeAbandonedProfiles} for each candidate folder before anything is removed.
 * @param profile - The profile folder.
 * @param judgedBy - The identity of this process without its boot time ({@link withoutBootTime}), by which the marker's owner is judged.
 * @returns
 * - `true` when the marker is readable and its process is gone
 * - `false` when there is no readable marker, or when its owner may still run: the folder is not known to be abandoned
 * @example
 * await isProfileOwnerGone('/tmp/codebook-browser-a1b2c3', withoutBootTime(identity)) // => true after the editor that made it was killed
 */
async function isProfileOwnerGone(
  profile: string,
  judgedBy: StorageOwnerIdentity,
): Promise<boolean> {
  const owner = await readRecordedOwner(
    join(profile, MANAGED_PROFILE_OWNER_FILE),
  )
  if (!owner) return false
  return isRecordedOwnerGone(owner, judgedBy)
}

/**
 * Removes the browser profile folders that a killed editor left behind, so that they do not pile up in the profile root; called by {@link HostBrowser.launch} before a managed run creates its own folder.
 *
 * A folder is removed only on proof that Codebook made it and nothing uses it: it is a real directory, it carries the owner marker
 * ({@link MANAGED_PROFILE_OWNER_FILE}), the marker's process is gone from this machine ({@link isRecordedOwnerGone}, judged without a boot time,
 * see {@link withoutBootTime}), and no process runs with the folder as its profile. A folder without a readable marker is never touched, whoever made it.
 *
 * @param root - The directory that holds the profile folders: {@link MANAGED_PROFILE_ROOT} in the product, a directory of their own in tests.
 * @param identity - The machine and the boot of this process, by which a marker's owner is judged.
 * @returns The folders that were removed, in the order the directory listed them; empty when the root cannot be read. Nothing here throws: what cannot be
 * read, judged or removed stays in place.
 * @example
 * await removeAbandonedProfiles('/tmp', await currentStorageOwner()) // => ['/tmp/codebook-browser-a1b2c3'] after the editor that made it was killed
 */
export async function removeAbandonedProfiles(
  root: string,
  identity: StorageOwnerIdentity,
): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  // A link with the prefix is no profile folder of Codebook's making; only real directories are looked at, and a bounded number of them.
  const candidates = entries
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith(MANAGED_PROFILE_PREFIX),
    )
    .slice(0, MANAGED_PROFILE_SWEEP_LIMIT)
  const judgedBy = withoutBootTime(identity)
  const removed: string[] = []
  for (const candidate of candidates) {
    const profile = join(root, candidate.name)
    // No marker, or an owner that may still run: the folder is not known to be abandoned.
    if (!(await isProfileOwnerGone(profile, judgedBy))) continue
    if (await removeUnusedProfile(profile)) removed.push(profile)
  }
  return removed
}
