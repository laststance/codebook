import type { RecordedOwner, StorageOwnerIdentity } from './readRecordedOwner'

/**
 * Says whether a recorded storage owner ran on this machine, the only place where its process id and its boot can be judged; called by {@link isRecordedOwnerGone} and by the release of {@link withStorageLock}.
 * The editor's machine id stays the same when the host name follows the network (macOS), and it tells two machines with one host name apart. A record or a reader without one (an earlier build, a remote window, a plain Node process) is compared by host name.
 * @param recorded - The owner a lock, a claim or a descriptor names.
 * @param current - The identity of this process.
 * @returns
 * - Both carry a machine id: `true` when the ids are equal
 * - Otherwise: `true` when the recorded host name is this machine's; a record without a host name names no machine and gives `false`
 * @example
 * isSameStorageMachine({ hostname: 'laptop.local', machineId: 'f3a1' }, { hostname: 'laptop.lan', machineId: 'f3a1' }) // => true
 * isSameStorageMachine({ hostname: 'laptop.local' }, { hostname: 'laptop.local', machineId: 'f3a1' })                // => true
 * isSameStorageMachine({}, { hostname: 'laptop.local' })                                                             // => false
 */
export function isSameStorageMachine(
  recorded: Pick<RecordedOwner, 'hostname' | 'machineId'>,
  current: Pick<StorageOwnerIdentity, 'hostname' | 'machineId'>,
): boolean {
  if (recorded.machineId !== undefined && current.machineId !== undefined)
    return recorded.machineId === current.machineId
  return recorded.hostname === current.hostname
}
