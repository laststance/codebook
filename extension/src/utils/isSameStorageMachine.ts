import { namesMachineInClear } from './namesMachineInClear'
import type {
  BootIdentity,
  RecordedOwner,
  StorageOwnerIdentity,
} from './readRecordedOwner'

/** The fields of a storage owner by which its machine is told: the host name, the editor's machine id, the two pseudonyms of {@link deriveMachineKeys}, and the boot, which confirms an equal machine id under another host name. */
type MachineNames = Pick<
  RecordedOwner,
  'hostname' | 'machineId' | 'machineKey' | 'hostKey' | 'boot'
>

/**
 * Says whether a record and this process ran under one boot of one machine, by an exact boot id alone: the kernel's boot id on Linux, the boot session on macOS ({@link readBootIdentity}); called by {@link isSameStorageMachine} for an equal editor's machine id under another host name.
 * Why: VS Code keeps its machine id in the editor's user data folder, so two computers that share a home folder (a network home, a copied profile, lab computers with a redirected profile) share it, while a host name that follows the network (macOS) changes within one boot. A computed boot time (the clock minus the uptime) proves nothing: two such computers can start within the same minute. Windows names its boots by no id, so there an equal machine id counts only with the same host name.
 * @param recorded - The boot the record names; `undefined` for one that names none (an earlier build, or a computed time beside an unknown start).
 * @param current - The boot of this process.
 * @returns `true` for two equal boot ids; `false` when either names no id, and for two that differ, whatever boot times they name.
 * @example
 * isSameBoot({ id: 'boot-1' }, { id: 'boot-1' })                       // => true
 * isSameBoot({ startedAtMs: 1_000 }, { startedAtMs: 31_000 })          // => false: a boot time proves no machine
 * isSameBoot({ id: 'boot-1' }, { id: 'boot-2' })                       // => false
 */
function isSameBoot(
  recorded: BootIdentity | undefined,
  current: BootIdentity | undefined,
): boolean {
  return (
    recorded !== undefined &&
    current !== undefined &&
    'id' in recorded &&
    'id' in current &&
    recorded.id === current.id
  )
}

/**
 * Says whether a record and this process name two different boots by their ids; called by {@link sharesMachineKey} for a record whose host name's digest is this machine's and whose machine id's digest is not.
 * @param recorded - The boot the record names; `undefined` for one that names none.
 * @param current - The boot of this process.
 * @returns `true` only when both name a boot id and the two differ; `false` when either names none (Windows, a macOS boot session that could not be read), whatever boot times they name, and for two equal ids.
 * @example
 * namesAnotherBoot({ id: 'boot-1' }, { id: 'boot-2' })                 // => true
 * namesAnotherBoot(undefined, { id: 'boot-2' })                        // => false
 * namesAnotherBoot({ startedAtMs: 1_000 }, { startedAtMs: 600_000 })   // => false
 */
function namesAnotherBoot(
  recorded: BootIdentity | undefined,
  current: BootIdentity | undefined,
): boolean {
  return (
    recorded !== undefined &&
    current !== undefined &&
    'id' in recorded &&
    'id' in current &&
    recorded.id !== current.id
  )
}

/**
 * Says whether a record that names its machine by pseudonyms alone and this process are of one machine: by the digest of the host name, or by the digest of the editor's machine id under the same boot ({@link isSameBoot}); called by {@link isSameStorageMachine}.
 * A writer without an editor's machine id has its host name's digest as both pseudonyms, so the host name's digest, which every identity of this build carries, also tells that writer. The host name's digest is what VS Code and Cursor on one computer share while their machine ids differ, so it counts beside another machine id's digest, unless the two name different boot ids ({@link namesAnotherBoot}): that is another computer with the same host name (two Macs with the default name on one shared folder) as much as an earlier boot of this one, and a record of another computer must not be judged here.
 * @param recorded - The pseudonyms and the boot the record names.
 * @param current - The pseudonyms and the boot of this process.
 * @returns `true` for an equal `machineKey` with an equal `hostKey` or under the same boot, and for an equal `hostKey` beside another `machineKey` where no two boot ids differ; `false` otherwise.
 * @example
 * sharesMachineKey({ machineKey: '1fb1404a9738d5ed', hostKey: 'd195d36bd79da7df' }, { machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df' }) // => true
 * sharesMachineKey({ machineKey: '1fb1404a9738d5ed', hostKey: 'd195d36bd79da7df', boot: { id: 'boot-1' } }, { machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df', boot: { id: 'boot-2' } }) // => false: another computer of one host name, or an earlier boot
 * sharesMachineKey({ machineKey: 'f9c8c7ddcf3d5f56', hostKey: '807ae35e0ef0b99a' }, { machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df' }) // => false without the same boot
 */
function sharesMachineKey(
  recorded: MachineNames,
  current: MachineNames,
): boolean {
  // This host name's digest beside another editor's machine id under another boot id may be another computer with this host name.
  if (recorded.hostKey !== undefined && recorded.hostKey === current.hostKey)
    return (
      recorded.machineKey === current.machineKey ||
      !namesAnotherBoot(recorded.boot, current.boot)
    )
  return (
    recorded.machineKey !== undefined &&
    recorded.machineKey === current.machineKey &&
    isSameBoot(recorded.boot, current.boot)
  )
}

/**
 * Says whether a recorded storage owner ran on this machine, the only place where its process id, its boot and its process start can be judged; called by {@link isRecordedOwnerGone} for a record without a process start, by {@link canJudgeOwnerHere} for one with a start, and by the release of {@link withStorageLock}.
 * The editor's machine id stays the same when the host name follows the network (macOS), and it tells two machines with one host name apart. It is no proof of one machine on its own: VS Code keeps it in the editor's user data folder, which two computers that share a home folder share. An equal machine id under another host name therefore counts only under the same boot ({@link isSameBoot}); another boot, or none to compare, makes the record another host's, whose lock stays until it is moved away and whose recording the learner decides on. A record or a reader without a machine id (an earlier build, a remote window, a plain Node process) is compared by host name.
 * A record that names neither (one written into a learner's project folder, which must not name the computer) is compared by the pseudonyms of {@link deriveMachineKeys} in the same way ({@link sharesMachineKey}): the machine id's digest counts with the host name's digest or under the same boot, and the host name's digest beside another machine id's digest counts unless the two name different boot ids. Four limits follow from that. An editor's machine id differs between VS Code and Cursor on one computer, which is why the host name's digest carries their match within one boot; a record of the other editor from before a restart is told from one of another computer by nothing, and counts as another computer's (a marker until its run expires, a claim until its age rule removes it). Two computers with one host name look like one machine where either side names no boot id (Windows, a macOS boot session that could not be read) or both share an editor's machine id, and a process id of the other is then probed here when such a record names the start of its process in the form of this process's own, which on Linux must name the pid namespace of both ({@link canJudgeOwnerHere}), while one without a start is never probed ({@link isRecordedOwnerGone}). Where both name a boot id that differs, they are two machines, and neither calls the other's live marker gone. And a digest is a pseudonym in a file a commit can publish, so the digest of a common host name can be found by trying names.
 * @param recorded - The owner a lock, a claim, a descriptor or a marker names.
 * @param current - The identity of this process.
 * @returns
 * - The record names neither a host name nor a machine id: `true` when its host name's digest is this process's, beside the same machine id's digest or where no two boot ids differ, or when its machine id's digest is this process's under the same boot; `false` otherwise, also for a record of this host name's digest, another machine id's digest and another boot id, and for a record without pseudonyms, which names no machine
 * - Both carry a machine id: `true` when the ids are equal and so are the host names or the boots; `false` for two ids that differ, also under one host name
 * - Otherwise: `true` when the recorded host name is this machine's
 * @example
 * isSameStorageMachine({ hostname: 'laptop.local', machineId: 'f3a1', boot: { id: 'boot-1' } }, { hostname: 'laptop.lan', machineId: 'f3a1', boot: { id: 'boot-1' } }) // => true
 * isSameStorageMachine({ hostname: 'lab-17', machineId: 'f3a1', boot: { id: 'boot-1' } }, { hostname: 'lab-18', machineId: 'f3a1', boot: { id: 'boot-2' } })                // => false
 * isSameStorageMachine({ hostname: 'laptop.local' }, { hostname: 'laptop.local', machineId: 'f3a1' })                // => true
 * isSameStorageMachine({ hostKey: 'd195d36bd79da7df' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df' })    // => true
 * isSameStorageMachine({ machineKey: '1fb1404a9738d5ed', hostKey: 'd195d36bd79da7df', boot: { id: 'boot-2' } }, { hostname: 'workstation', machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df', boot: { id: 'boot-1' } }) // => false
 * isSameStorageMachine({}, { hostname: 'laptop.local' })                                                             // => false
 */
export function isSameStorageMachine(
  recorded: MachineNames,
  current: MachineNames & Pick<StorageOwnerIdentity, 'hostname'>,
): boolean {
  // A record that names its machine by pseudonyms alone is compared by them.
  if (!namesMachineInClear(recorded)) return sharesMachineKey(recorded, current)
  const isSameHostName = recorded.hostname === current.hostname
  // An equal machine id names one machine only with the same host name or under the same boot: two computers that share a home folder share it.
  if (recorded.machineId !== undefined && current.machineId !== undefined)
    return (
      recorded.machineId === current.machineId &&
      (isSameHostName || isSameBoot(recorded.boot, current.boot))
    )
  return isSameHostName
}
