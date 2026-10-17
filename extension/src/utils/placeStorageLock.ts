import { randomUUID } from 'node:crypto'
import { link, unlink, writeFile } from 'node:fs/promises'

import { PRIVATE_FILE_MODE } from '../constants'

import { PREPARED_LOCK_SUFFIX } from './preparedLockSuffix'
import type { RecordedOwner } from './readRecordedOwner'
import { systemErrorCode } from './systemErrorCode'

/**
 * Places a storage lock that names its owner from the moment it exists, so that a writer killed at any point leaves no empty lock that nobody can judge; called by {@link withStorageLock} for each attempt to take the lock, and by {@link claimWikiUpdateMarker} to create a Wiki update's marker, which other windows read the same way.
 * The owner is written into `<lock>.pending-<uuid>` ({@link PREPARED_LOCK_SUFFIX}) first and that file is then given the lock's name with a hard link, which succeeds only while no lock is present. A prepared file left by a kill is removed by a later sweep of {@link removeStaleStorageClaims}, once its owner is gone: beside a storage lock at a process's first hold of the storage directory and at every takeover of a stale lock ({@link withStorageLock}), beside a marker at every claim on it ({@link claimWikiUpdateMarker}), which also removes one by its age where its owner cannot be judged.
 * Limit: on a file system that cannot link, the lock is created in place and exists without content for the time of one write.
 * @param lockPath - The `writer.lock` file, or the marker file, to create.
 * @param owner - The process that takes the lock, with its machine and boot; a marker's record adds its own fields, and the whole record is written.
 * @param fileMode - The mode the file is created with: private to this user unless the caller names another (a marker in a project folder is readable like the project's files).
 * @throws The system error with code `EEXIST` while a lock is present, and whatever writing in the storage directory throws.
 * @example
 * await placeStorageLock('/storage/learning/writer.lock', { pid: process.pid, hostname: 'workstation' })
 */
export async function placeStorageLock(
  lockPath: string,
  owner: RecordedOwner,
  fileMode: number = PRIVATE_FILE_MODE,
): Promise<void> {
  const preparedPath = `${lockPath}${PREPARED_LOCK_SUFFIX}${randomUUID()}`,
    record = JSON.stringify(owner),
    exclusive = { mode: fileMode, flag: 'wx' }
  try {
    await writeFile(preparedPath, record, exclusive)
    await link(preparedPath, lockPath).catch((error: unknown) => {
      if (systemErrorCode(error) === 'EEXIST') throw error
      // A file system without hard links cannot give a written file a second name; there the lock is created in place, and one a kill leaves empty is taken over as abandoned ({@link isLeftEmpty}).
      return writeFile(lockPath, record, exclusive)
    })
  } finally {
    await unlink(preparedPath).catch(() => undefined)
  }
}
