import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { MANAGED_PROFILE_OWNER_FILE } from '../../constants'
import { currentUserName } from '../../utils/currentUserName'
import type { StorageOwnerIdentity } from '../../utils/readRecordedOwner'

import { writeOwnedBrowserMarker } from './ownedBrowserMarker'

/**
 * Marks a profile folder as an owned browser's, the proof by which the orphan sweep may stop that browser and remove the folder after an editor crash (ER18).
 * Called by the owned launch right after it made the folder. The owner marker has the content {@link HostBrowser} writes for its managed profiles (that writer is private to a module that needs the editor API, so the few lines are repeated here), so the existing sweep knows the folder; `codebook-owned-browser` additionally allows the sweep to stop a live browser that names the folder.
 * @param folder - The profile folder, which exists.
 * @param owner - The machine, boot and start of this process.
 * @param executable - The browser executable the launch will spawn; `codebook-owned-browser` records it so the sweep signals only a process that runs exactly it.
 * @example
 * await writeOwnedProfileMarkers('/tmp/codebook-browser-a1b2c3', owner, '/opt/chrome/chrome')
 */
export async function writeOwnedProfileMarkers(
  folder: string,
  owner: StorageOwnerIdentity,
  executable: string,
): Promise<void> {
  const user = currentUserName()
  await writeOwnedBrowserMarker(folder, { executable })
  // The owner marker goes last: a folder with only the first file is judged by no sweep.
  await writeFile(
    join(folder, MANAGED_PROFILE_OWNER_FILE),
    JSON.stringify({
      pid: process.pid,
      ...owner,
      ...(user !== undefined && { user }),
      createdAt: new Date().toISOString(),
    }),
  )
}
