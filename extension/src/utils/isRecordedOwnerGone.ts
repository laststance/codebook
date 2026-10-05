import { canJudgeOwnerHere } from './canJudgeOwnerHere'
import { isFromEarlierBoot } from './isFromEarlierBoot'
import { isProcessGone } from './isProcessGone'
import { isSameStorageMachine } from './isSameStorageMachine'
import { readProcessStart, type ProcessStartReader } from './readProcessStart'
import type { RecordedOwner, StorageOwnerIdentity } from './readRecordedOwner'
import { withoutBootTime } from './withoutBootTime'

/**
 * Says whether a recorded owner cannot be a process of this boot: it was recorded under an earlier boot, or no process has its id; called by {@link isRecordedOwnerGone} before any start is read.
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
 * Judges a record without its owner's process start as before the start was recorded: on its machine, by its boot and its process id; called by {@link isRecordedOwnerGone} for a record of 0.2.29.0 and for one of a window whose start could not be read.
 * @param owner - The owner the file records, without a process start.
 * @param identity - The machine and the boot of this process.
 * @returns `true` for an owner of this machine ({@link isSameStorageMachine}) that cannot be a process of this boot ({@link hasNoProcessOfThisBoot}); `false` for an owner of another machine and while a process of this boot has the id.
 * @example
 * isGoneByBootAndProcessId({ pid: 4242, hostname: 'workstation', boot: { id: 'boot-1' } }, { hostname: 'workstation', boot: { id: 'boot-2' } }) // => true
 * isGoneByBootAndProcessId({ pid: process.pid, hostname: 'workstation' }, { hostname: 'workstation' })                                    // => false
 */
function isGoneByBootAndProcessId(
  owner: RecordedOwner,
  identity: StorageOwnerIdentity,
): boolean {
  return (
    isSameStorageMachine(owner, identity) &&
    hasNoProcessOfThisBoot(owner, identity)
  )
}

/**
 * Says whether the process that has a recorded owner's id now is another process than the owner; called by {@link isRecordedOwnerGone} once a process of this boot is known to have the id.
 * @param pid - The owner's process id.
 * @param recordedStart - The start the owner wrote, which the reader is given as `expectedStart`.
 * @param readStart - Reads the start of the process that has the id now.
 * @returns `true` when that process began at another time than the recorded one; `false` when it began at the recorded time, and when its start cannot be read: the process may be the owner.
 * @example
 * await hasItsIdGoneToAnotherProcess(4242, 'linux:100', async () => 'linux:200') // => true
 * await hasItsIdGoneToAnotherProcess(4242, 'linux:100', async () => undefined)   // => false
 */
async function hasItsIdGoneToAnotherProcess(
  pid: number,
  recordedStart: string,
  readStart: ProcessStartReader,
): Promise<boolean> {
  const liveStart = await readStart(pid, { expectedStart: recordedStart })
  return liveStart !== undefined && liveStart !== recordedStart
}

/**
 * Says whether the process a storage lock, a takeover claim, a connection descriptor or a profile marker names no longer exists, so that what a killed editor left behind is told from what a running one owns; called by {@link isStaleStorageLock}, {@link evidenceInUseElsewhere} and {@link removeAbandonedProfiles}.
 * A record that carries its owner's process start is judged by that start: no clock moves it, and a process id that is in use again has another one. The boot time, which a correction of the clock moves, then decides nothing; only two kernel boot ids that differ still do, without a read. Such a record is judged only where its process can be probed ({@link canJudgeOwnerHere}): a start of another form names a process of another space of process ids (a Windows window and a WSL window share a host name, and two WSL distributions also the kernel and its boot id, which is why a Linux start names its pid namespace), whose id names another process here, or none, and whose owner is therefore never called gone, unless it was recorded under another kernel boot id.
 * A record without a start (written by 0.2.29.0, or by a window whose start could not be read) is judged by its process id and its boot, as before.
 * @param owner - The owner the file records.
 * @param identity - The machine, the boot and the process start of this process.
 * @param readStart - Reads the start of the process that has the owner's id now; {@link readProcessStart} unless a caller adds its cache or a test names its own. It is given the recorded start as `expectedStart`, which a kept start may confirm.
 * @returns
 * - `false` for an owner of another machine, or of none, and for one whose start has another form (another system, another pid namespace) under the same kernel boot, or where either side names no kernel boot id: its process cannot be probed here and may run. Nothing is probed or read for it
 * - `true` for an owner recorded under another kernel boot id, whatever process has its id now and whatever form its start has, and for one whose process id names no process
 * - A record with a start, whose process id is in use: `true` when the process that has the id now began at another time; `false` when it began at the recorded time, and when its start cannot be read
 * - A record without a start, whose process id is in use: `true` when its boot time lies before this boot's by more than the tolerance ({@link isFromEarlierBoot}); `false` otherwise, also for a process this user may not signal
 * @example
 * await isRecordedOwnerGone({ pid: 4242, hostname: 'workstation', boot: { id: 'boot-1' } }, { hostname: 'workstation', boot: { id: 'boot-2' } })                                  // => true
 * await isRecordedOwnerGone({ pid: process.pid, hostname: 'another-machine' }, { hostname: 'workstation' })                                                                     // => false
 * await isRecordedOwnerGone({ pid: 4242, hostname: 'workstation', processStart: 'linux:100' }, { hostname: 'workstation', processStart: 'linux:300' }, async () => 'linux:200') // => true while a process has the id 4242
 * await isRecordedOwnerGone({ pid: 4242, hostname: 'workstation', processStart: 'win:2026-10-05T09:12:33.1234567Z' }, { hostname: 'workstation', processStart: 'linux:300' })    // => false, whatever has the id 4242 here
 */
export async function isRecordedOwnerGone(
  owner: RecordedOwner,
  identity: StorageOwnerIdentity,
  readStart: ProcessStartReader = readProcessStart,
): Promise<boolean> {
  const { processStart } = owner
  if (processStart === undefined)
    return isGoneByBootAndProcessId(owner, identity)
  // A record of another machine or of another space of process ids is not probed here: its owner may run.
  if (!canJudgeOwnerHere(owner, identity)) return false
  return (
    hasNoProcessOfThisBoot(owner, identity) ||
    hasItsIdGoneToAnotherProcess(owner.pid, processStart, readStart)
  )
}
