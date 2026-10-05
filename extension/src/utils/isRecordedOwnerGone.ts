import { isFromEarlierBoot } from './isFromEarlierBoot'
import { isProcessGone } from './isProcessGone'
import { isSameStorageMachine } from './isSameStorageMachine'
import type { RecordedOwner, StorageOwnerIdentity } from './readRecordedOwner'

/**
 * Says whether the process a storage lock, a takeover claim or a connection descriptor names no longer exists, so that what a killed editor left behind is told from what a running one owns; called by {@link isStaleStorageLock} and {@link evidenceInUseElsewhere}.
 * @param owner - The owner the file records.
 * @param identity - The machine and the boot of this process.
 * @returns
 * - `false` for an owner of another machine, or of none: its process cannot be probed here and may run
 * - `true` for an owner of this machine recorded before its last restart, whatever process has its id now, and for one whose process id names no process
 * - `false` while a process with that id runs under the same boot, also one this user may not signal
 * @example
 * isRecordedOwnerGone({ pid: 4242, hostname: 'workstation', boot: { id: 'boot-1' } }, { hostname: 'workstation', boot: { id: 'boot-2' } }) // => true
 * isRecordedOwnerGone({ pid: process.pid, hostname: 'another-machine' }, { hostname: 'workstation' })                                    // => false
 */
export function isRecordedOwnerGone(
  owner: RecordedOwner,
  identity: StorageOwnerIdentity,
): boolean {
  if (!isSameStorageMachine(owner, identity)) return false
  // Process ids start again with a restart, so the id of an earlier boot says nothing about a process of this one.
  return (
    isFromEarlierBoot(owner.boot, identity.boot) || isProcessGone(owner.pid)
  )
}
