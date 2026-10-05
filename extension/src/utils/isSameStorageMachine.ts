import type { RecordedOwner, StorageOwnerIdentity } from './readRecordedOwner'

/** The fields of a storage owner by which its machine is told: the host name, the editor's machine id and the two pseudonyms of {@link deriveMachineKeys}. */
type MachineNames = Pick<
  RecordedOwner,
  'hostname' | 'machineId' | 'machineKey' | 'hostKey'
>

/** Says whether a record and this process share a pseudonym of their machine, whichever of the two it is on either side: a writer without an editor's machine id has its host name's digest as both. @example sharesMachineKey({ machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df' }, { machineKey: '1fb1404a9738d5ed', hostKey: 'd195d36bd79da7df' }) // => true */
function sharesMachineKey(
  recorded: MachineNames,
  current: MachineNames,
): boolean {
  const currentKeys = [current.machineKey, current.hostKey]
  return [recorded.machineKey, recorded.hostKey].some(
    (key) => key !== undefined && currentKeys.includes(key),
  )
}

/** Says whether a record names neither a host name nor an editor's machine id, as one written into a learner's project folder does, which must not name the computer. @example namesNoMachineInClear({ hostKey: 'd195d36bd79da7df' }) // => true */
function namesNoMachineInClear(recorded: MachineNames): boolean {
  return recorded.hostname === undefined && recorded.machineId === undefined
}

/**
 * Says whether a recorded storage owner ran on this machine, the only place where its process id, its boot and its process start can be judged; called by {@link isRecordedOwnerGone} and by the release of {@link withStorageLock}.
 * The editor's machine id stays the same when the host name follows the network (macOS), and it tells two machines with one host name apart. A record or a reader without one (an earlier build, a remote window, a plain Node process) is compared by host name.
 * A record that names neither (one written into a learner's project folder, which must not name the computer) is compared by the pseudonyms of {@link deriveMachineKeys}, and any match counts. Three limits follow from that: an editor's machine id differs between VS Code and Cursor on one computer, which is why the host name's digest carries their match; two computers with one host name therefore look like one machine, and a process id of the other is probed here unless its recorded start has another system's form ({@link canJudgeOwnerHere}); and a digest is a pseudonym in a file a commit can publish, so the digest of a common host name can be found by trying names.
 * @param recorded - The owner a lock, a claim, a descriptor or a marker names.
 * @param current - The identity of this process.
 * @returns
 * - The record names neither a host name nor a machine id: `true` when one of its pseudonyms is one of this process's; `false` for a record without pseudonyms, which names no machine
 * - Both carry a machine id: `true` when the ids are equal
 * - Otherwise: `true` when the recorded host name is this machine's
 * @example
 * isSameStorageMachine({ hostname: 'laptop.local', machineId: 'f3a1' }, { hostname: 'laptop.lan', machineId: 'f3a1' }) // => true
 * isSameStorageMachine({ hostname: 'laptop.local' }, { hostname: 'laptop.local', machineId: 'f3a1' })                // => true
 * isSameStorageMachine({ hostKey: 'd195d36bd79da7df' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df' })    // => true
 * isSameStorageMachine({}, { hostname: 'laptop.local' })                                                             // => false
 */
export function isSameStorageMachine(
  recorded: MachineNames,
  current: MachineNames & Pick<StorageOwnerIdentity, 'hostname'>,
): boolean {
  // A record that names its machine by pseudonyms alone is compared by them.
  if (namesNoMachineInClear(recorded))
    return sharesMachineKey(recorded, current)
  if (recorded.machineId !== undefined && current.machineId !== undefined)
    return recorded.machineId === current.machineId
  return recorded.hostname === current.hostname
}
