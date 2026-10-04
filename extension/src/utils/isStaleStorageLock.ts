import { hostname } from 'node:os'

import { isProcessGone } from './isProcessGone'
import { readRecordedOwner } from './readRecordedOwner'

/**
 * Says whether a storage lock file was left by a writer process that no longer exists on this machine, so {@link withStorageLock} can take the lock over instead of refusing every later write until the file is removed by hand.
 * A lock records `{ pid, hostname }`; one that cannot be read, names another machine, has no host (written by an earlier build) or whose process may still run is not stale. {@link removeStaleStorageLock} judges the lock with it, a second time under its claim, and {@link claimStorageLockTakeover} judges the claims of earlier takeovers, which record the same owner.
 * @param lockPath - The `writer.lock` file that is present, or one takeover claim beside it.
 * @returns
 * - `true` when the lock names this machine and a process id that no longer exists
 * - `false` for every other lock
 * @example
 * await isStaleStorageLock('/storage/learning/writer.lock') // => true after the editor that wrote it was killed
 */
export async function isStaleStorageLock(lockPath: string): Promise<boolean> {
  const owner = await readRecordedOwner(lockPath)
  return owner?.hostname === hostname() && isProcessGone(owner.pid)
}
