import { isLeftEmpty } from './isLeftEmpty'
import { isRecordedOwnerGone } from './isRecordedOwnerGone'
import { readProcessStart, type ProcessStartReader } from './readProcessStart'
import {
  readRecordedOwner,
  type StorageOwnerIdentity,
} from './readRecordedOwner'

/**
 * Says whether a storage lock file was left by a writer that no longer exists on this machine, so {@link withStorageLock} can take the lock over instead of refusing every later write until the file is removed by hand.
 * A lock records its owner's process id, host name, machine id, boot and process start ({@link RecordedOwner}). {@link removeStaleStorageLock} judges the lock with it, a second time under its claim, and {@link removeStaleStorageClaims} judges the claims and the prepared files of earlier takeovers, which record the same owner.
 * @param path - The `writer.lock` file that is present, or one takeover claim or prepared file beside it.
 * @param identity - The machine and the boot of this process.
 * @param readStart - Reads the start of the process that has the owner's id now; {@link readProcessStart} unless a caller adds its cache or a test names its own.
 * @param lockPath - The `writer.lock` file the path belongs to, beside which the file system's clock is probed for an empty file ({@link isLeftEmpty}); the path itself when it is the lock.
 * @returns
 * - `true` when the lock names this machine and an earlier boot, a process id that no longer exists, or a process id that another process has now ({@link isRecordedOwnerGone}, which probes a process id only for a record that names its process start in this process's form or its machine in clear)
 * - `true` for a file that was created and never written and has stayed empty ({@link isLeftEmpty}): a writer of an earlier build that was killed between the two left it
 * - `false` for every other lock: one of another machine, one whose process may still run, and one whose content is not an owner record
 * @example
 * await isStaleStorageLock('/storage/learning/writer.lock', await currentStorageOwner()) // => true after the editor that wrote it was killed
 */
export async function isStaleStorageLock(
  path: string,
  identity: StorageOwnerIdentity,
  readStart: ProcessStartReader = readProcessStart,
  lockPath: string = path,
): Promise<boolean> {
  const owner = await readRecordedOwner(path)
  // Without an owner record only emptiness says anything; any other content may be a lock this build cannot read.
  if (!owner) return isLeftEmpty(path, 'file', lockPath)
  return isRecordedOwnerGone(owner, identity, readStart)
}
