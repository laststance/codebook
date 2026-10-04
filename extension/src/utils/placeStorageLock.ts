import { randomUUID } from 'node:crypto'
import { link, unlink, writeFile } from 'node:fs/promises'

import { PRIVATE_FILE_MODE } from '../constants'

import type { RecordedOwner } from './readRecordedOwner'
import { systemErrorCode } from './systemErrorCode'

/**
 * Places a storage lock that names its owner from the moment it exists, so that a writer killed at any point leaves no empty lock that nobody can judge; called by {@link withStorageLock} for each attempt to take the lock.
 * The owner is written into `<lock>.pending-<uuid>` first and that file is then given the lock's name with a hard link, which succeeds only while no lock is present. A prepared file left by a kill is removed by the next writer that holds the lock ({@link removeStaleStorageClaims}).
 * @param lockPath - The `writer.lock` file to create.
 * @param owner - The process that takes the lock, with its machine and boot.
 * @throws The system error with code `EEXIST` while a lock is present, and whatever writing in the storage directory throws.
 * @example
 * await placeStorageLock('/storage/learning/writer.lock', { pid: process.pid, hostname: 'workstation' })
 */
export async function placeStorageLock(
  lockPath: string,
  owner: RecordedOwner,
): Promise<void> {
  const preparedPath = `${lockPath}.pending-${randomUUID()}`,
    record = JSON.stringify(owner),
    exclusive = { mode: PRIVATE_FILE_MODE, flag: 'wx' }
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
