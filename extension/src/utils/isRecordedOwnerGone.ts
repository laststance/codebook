import { PROCESS_START_NAMESPACE_MARK } from '../constants'

import { canJudgeOwnerHere } from './canJudgeOwnerHere'
import { isFromEarlierBoot } from './isFromEarlierBoot'
import { isProcessGone } from './isProcessGone'
import { isSameStorageMachine } from './isSameStorageMachine'
import { namesMachineInClear } from './namesMachineInClear'
import { readProcessStart, type ProcessStartReader } from './readProcessStart'
import type { RecordedOwner, StorageOwnerIdentity } from './readRecordedOwner'
import { withoutBootTime } from './withoutBootTime'

/**
 * Says whether a recorded owner cannot be a process of this boot: it was recorded under an earlier boot, or no process has its id; called by {@link isRecordedOwnerGone} before any start is read, and by {@link isGoneWithoutItsStart} for a record without a start that names its machine in clear.
 * A record with its owner's start is not judged by a boot time, which a clock step moves ({@link withoutBootTime}); a kernel boot id still tells an earlier boot. Process ids start again with a restart, so the id of an earlier boot says nothing about a process of this one.
 * @param owner - The owner the file records.
 * @param identity - The machine and the boot of this process.
 * @returns `true` for an owner of an earlier boot ({@link isFromEarlierBoot}) and for one whose process id names no process ({@link isProcessGone}); `false` while a process of this boot has the id.
 * @example
 * hasNoProcessOfThisBoot({ pid: process.pid, boot: { id: 'boot-1' } }, { hostname: 'workstation', boot: { id: 'boot-2' } }) // => true
 * hasNoProcessOfThisBoot({ pid: process.pid }, { hostname: 'workstation' })                                           // => false
 */
function hasNoProcessOfThisBoot(
  owner: RecordedOwner,
  identity: StorageOwnerIdentity,
): boolean {
  const judgedBy =
    owner.processStart === undefined ? identity : withoutBootTime(identity)
  return (
    isFromEarlierBoot(owner.boot, judgedBy.boot) || isProcessGone(owner.pid)
  )
}

/**
 * Judges a record without its owner's process start (written by 0.2.29.0, or by a window whose start could not be read), on its machine alone; called by {@link isRecordedOwnerGone} for every such record.
 * A record that names its machine in clear lies in private storage, which two spaces of process ids do not share, and is judged as before the start was recorded: by its boot and its process id ({@link hasNoProcessOfThisBoot}).
 * A record that names its machine by pseudonyms alone lies in a project folder that two spaces of process ids of one computer can open (a Windows window and a WSL window, two WSL distributions), and without a start it says nothing about the space its process id is of. That id is therefore not probed, and a boot time is not weighed: only two kernel boot ids that differ call its owner gone, because every process of an earlier boot has ended, whatever space it ran in.
 * @param owner - The owner the file records, without a process start.
 * @param identity - The machine and the boot of this process.
 * @returns
 * - `false` for an owner of another machine, or of none ({@link isSameStorageMachine})
 * - A record that names its machine in clear ({@link namesMachineInClear}): `true` when it cannot be a process of this boot (an earlier boot, or a process id that names no process); `false` while a process of this boot has the id
 * - A record that names its machine by pseudonyms alone: `true` when it and this process name two different kernel boot ids; `false` otherwise, whatever process has its id here, or none
 * @example
 * isGoneWithoutItsStart({ pid: 4242, hostname: 'workstation', boot: { id: 'boot-1' } }, { hostname: 'workstation', boot: { id: 'boot-2' } })                        // => true
 * isGoneWithoutItsStart({ pid: process.pid, hostname: 'workstation' }, { hostname: 'workstation' })                                                          // => false
 * isGoneWithoutItsStart({ pid: 2 ** 22 + 1, hostKey: 'd195d36bd79da7df' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df', boot: { id: 'boot-2' } }) // => false, although no process has that id here
 */
function isGoneWithoutItsStart(
  owner: RecordedOwner,
  identity: StorageOwnerIdentity,
): boolean {
  if (!isSameStorageMachine(owner, identity)) return false
  // Only a record of private storage is probed by its process id: one in a project folder may name a process of another space of process ids.
  return namesMachineInClear(owner)
    ? hasNoProcessOfThisBoot(owner, identity)
    : isFromEarlierBoot(owner.boot, withoutBootTime(identity).boot)
}

/** The pid namespace in the form of a Linux process start, with the system before it: `linux@4026531836` in `linux@4026531836:16362446`. A mark after the first colon is part of the time and is not matched. */
const PID_NAMESPACE_IN_FORM = new RegExp(
  `^([^:${PROCESS_START_NAMESPACE_MARK}]*)${PROCESS_START_NAMESPACE_MARK}[^:]*`,
)

/**
 * Takes the pid namespace out of a Linux process start, which leaves what no namespace changes: the system and the clock ticks since the kernel's boot, one clock for every pid namespace of a kernel (unless a time namespace moves it); called by {@link hasItsIdGoneToAnotherProcess} for both starts it compares.
 * @param processStart - A process start as {@link readProcessStart} gives it.
 * @returns The start without `@<namespace>` in its form; a start whose form names no namespace as it is.
 * @example
 * withoutPidNamespace('linux@4026531836:16362446')        // => 'linux:16362446'
 * withoutPidNamespace('win:2026-10-05T09:12:33.1234567Z') // => 'win:2026-10-05T09:12:33.1234567Z'
 */
function withoutPidNamespace(processStart: string): string {
  return processStart.replace(PID_NAMESPACE_IN_FORM, '$1')
}

/**
 * Says whether the process that has a recorded owner's id now is another process than the owner; called by {@link isRecordedOwnerGone} once a process of this boot is known to have the id.
 * The two starts are compared without their pid namespaces ({@link withoutPidNamespace}). That only matters for a record that names its machine in clear and another pid namespace, the one case in which a start of another namespace is compared at all ({@link canJudgeOwnerHere}): the recorded `linux@A:<ticks>` and the start read here, `linux@B:<ticks>`, differ in the namespace by construction, and a live owner whose record names a namespace number that has ended (its WSL distribution was restarted alone) must not be called gone for the number alone, while a process id that went to another process is told by its other ticks.
 * @param pid - The owner's process id.
 * @param recordedStart - The start the owner wrote, which the reader is given as `expectedStart`.
 * @param readStart - Reads the start of the process that has the id now.
 * @returns `true` when that process began at another time than the recorded one; `false` when it began at the recorded time, and when its start cannot be read: the process may be the owner.
 * @example
 * await hasItsIdGoneToAnotherProcess(4242, 'linux@4026531836:100', async () => 'linux@4026531836:200') // => true
 * await hasItsIdGoneToAnotherProcess(4242, 'linux@4026532214:100', async () => 'linux@4026531836:100') // => false
 * await hasItsIdGoneToAnotherProcess(4242, 'linux@4026531836:100', async () => undefined)              // => false
 */
async function hasItsIdGoneToAnotherProcess(
  pid: number,
  recordedStart: string,
  readStart: ProcessStartReader,
): Promise<boolean> {
  const liveStart = await readStart(pid, { expectedStart: recordedStart })
  return (
    liveStart !== undefined &&
    withoutPidNamespace(liveStart) !== withoutPidNamespace(recordedStart)
  )
}

/**
 * Says whether the process a storage lock, a takeover claim, a connection descriptor, a profile marker or a Wiki update marker names no longer exists, so that what a killed editor left behind is told from what a running one owns; called by {@link isStaleStorageLock} (the lock, and through {@link removeStaleStorageClaims} every claim and prepared file, also those beside a Wiki update marker), {@link evidenceInUseElsewhere}, {@link removeAbandonedProfiles} and {@link readLiveWikiUpdateMarker} (a marker that names its machine).
 * A record that carries its owner's process start is judged by that start: no clock moves it, and a process id that is in use again has another one. The boot time, which a correction of the clock moves, then decides nothing; only two kernel boot ids that differ still do, without a read. Such a record is judged only where its process can be probed ({@link canJudgeOwnerHere}): a start of another system names a process of another space of process ids (a Windows window and a WSL window share a host name), and so does, for a record in a project folder, which names its machine by pseudonyms alone, a Linux start of another pid namespace (two WSL distributions share the host name, the kernel and its boot id), and one that names no pid namespace, because its reader could not read it: it may be of any. Its id names another process here, or none, and its owner is therefore never called gone, unless it was recorded under another kernel boot id. A record that names its machine in clear lies in private storage, which two spaces of process ids do not share, and is judged whatever pid namespace its start names: by the kernel boot id, the process id, and the clock ticks of the start read here.
 * A record without a start (written by 0.2.29.0, or by a window whose start could not be read) that names its machine in clear is judged by its process id and its boot, as before. One that names its machine by pseudonyms alone (a Wiki update marker or its claim, of a window whose start could not be read) says nothing about the space its process id is of, so that id is never probed: only another kernel boot id calls its owner gone ({@link isGoneWithoutItsStart}), and otherwise the marker counts until its run expires and the claim until its age rule removes it ({@link claimWikiUpdateMarker}).
 * @param owner - The owner the file records.
 * @param identity - The machine, the boot and the process start of this process.
 * @param readStart - Reads the start of the process that has the owner's id now; {@link readProcessStart} unless a caller adds its cache or a test names its own. It is given the recorded start as `expectedStart`, which a kept start may confirm.
 * @returns
 * - `false` for an owner of another machine, or of none, and for one whose start names another space of process ids (another system; for a record without a machine in clear also another pid namespace, and a Linux start that names none) under the same kernel boot, or where either side names no kernel boot id: its process cannot be probed here and may run. Nothing is probed or read for it
 * - `true` for an owner recorded under another kernel boot id, whatever process has its id now and whatever form its start has, and, for a record with a start or with its machine in clear, for one whose process id names no process
 * - A record with a start, whose process id is in use: `true` when the process that has the id now began at another time, compared without the pid namespace; `false` when it began at the recorded time, and when its start cannot be read
 * - A record without a start that names its machine in clear, whose process id is in use: `true` when its boot time lies before this boot's by more than the tolerance ({@link isFromEarlierBoot}); `false` otherwise, also for a process this user may not signal
 * - A record without a start that names its machine by pseudonyms alone: `true` only when it was recorded under another kernel boot id; `false` otherwise, also when no process has its process id here. Nothing is probed or read for it
 * @example
 * await isRecordedOwnerGone({ pid: 4242, hostname: 'workstation', boot: { id: 'boot-1' } }, { hostname: 'workstation', boot: { id: 'boot-2' } })                                  // => true
 * await isRecordedOwnerGone({ pid: process.pid, hostname: 'another-machine' }, { hostname: 'workstation' })                                                                     // => false
 * await isRecordedOwnerGone({ pid: 4242, hostname: 'workstation', processStart: 'linux:100' }, { hostname: 'workstation', processStart: 'linux:300' }, async () => 'linux:200') // => true while a process has the id 4242
 * await isRecordedOwnerGone({ pid: 4242, hostname: 'workstation', processStart: 'win:2026-10-05T09:12:33.1234567Z' }, { hostname: 'workstation', processStart: 'linux:300' })    // => false, whatever has the id 4242 here
 * await isRecordedOwnerGone({ pid: 4242, hostKey: 'd195d36bd79da7df' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df', processStart: 'linux:300' })                      // => false, whatever has the id 4242 here
 */
export async function isRecordedOwnerGone(
  owner: RecordedOwner,
  identity: StorageOwnerIdentity,
  readStart: ProcessStartReader = readProcessStart,
): Promise<boolean> {
  const { processStart } = owner
  if (processStart === undefined) return isGoneWithoutItsStart(owner, identity)
  // A record of another machine or of another space of process ids is not probed here: its owner may run.
  if (!canJudgeOwnerHere(owner, identity)) return false
  return (
    hasNoProcessOfThisBoot(owner, identity) ||
    hasItsIdGoneToAnotherProcess(owner.pid, processStart, readStart)
  )
}
