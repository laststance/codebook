import { isFromEarlierBoot } from './isFromEarlierBoot'
import { isProcessGone } from './isProcessGone'
import { isSameStorageMachine } from './isSameStorageMachine'
import { readProcessStart, type ProcessStartReader } from './readProcessStart'
import type { RecordedOwner, StorageOwnerIdentity } from './readRecordedOwner'
import { withoutBootTime } from './withoutBootTime'

/**
 * Says whether a live process's start proves that it is not the recorded owner; called by {@link isRecordedOwnerGone} once a process is known to have the owner's id.
 * Only two starts of one form (`linux:`, `ps:`, `win:`) can be compared. A start of another form was read by another system's query, in another space of process ids (a Windows window and a WSL window can share a host name and a project folder), or by a build that reads starts differently; it says nothing about the process that has the id here.
 * @param recordedStart - The start the owner wrote.
 * @param liveStart - The start of the process that has the owner's id now; `undefined` when it cannot be read.
 * @returns `true` when both starts have one form and differ; `false` when they are equal, when the live start cannot be read, and when their forms differ: the process may be the owner.
 * @example
 * beganAtAnotherTime('linux:100', 'linux:200')                        // => true
 * beganAtAnotherTime('linux:100', 'linux:100')                        // => false
 * beganAtAnotherTime('win:2026-10-05T09:12:33.1234567Z', 'linux:200') // => false
 * beganAtAnotherTime('linux:100', undefined)                          // => false
 */
function beganAtAnotherTime(
  recordedStart: string,
  liveStart: string | undefined,
): boolean {
  if (liveStart === undefined || liveStart === recordedStart) return false
  const formOf = (start: string): string => start.slice(0, start.indexOf(':'))
  return formOf(liveStart) === formOf(recordedStart)
}

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
 * Says whether the process a storage lock, a takeover claim, a connection descriptor or a profile marker names no longer exists, so that what a killed editor left behind is told from what a running one owns; called by {@link isStaleStorageLock}, {@link evidenceInUseElsewhere} and {@link removeAbandonedProfiles}.
 * A record that carries its owner's process start is judged by that start: no clock moves it, and a process id that is in use again has another one. The boot time, which a correction of the clock moves, then decides nothing; only two kernel boot ids that differ still do, without a read. A record without a start (written by 0.2.29.0, or by a window whose start could not be read) is judged by its process id and its boot, as before.
 * @param owner - The owner the file records.
 * @param identity - The machine and the boot of this process.
 * @param readStart - Reads the start of the process that has the owner's id now; {@link readProcessStart} unless a caller adds its cache or a test names its own. It is given the recorded start as `expectedStart`, which a kept start may confirm.
 * @returns
 * - `false` for an owner of another machine, or of none: its process cannot be probed here and may run
 * - `true` for an owner recorded under another kernel boot id, whatever process has its id now, and for one whose process id names no process
 * - A record with a start, whose process id is in use: `true` when the process that has the id now began at another time; `false` when it began at the recorded time, when its start cannot be read, and when its start has another form than the recorded one ({@link beganAtAnotherTime})
 * - A record without a start, whose process id is in use: `true` when its boot time lies before this boot's by more than the tolerance ({@link isFromEarlierBoot}); `false` otherwise, also for a process this user may not signal
 * @example
 * await isRecordedOwnerGone({ pid: 4242, hostname: 'workstation', boot: { id: 'boot-1' } }, { hostname: 'workstation', boot: { id: 'boot-2' } })      // => true
 * await isRecordedOwnerGone({ pid: process.pid, hostname: 'another-machine' }, { hostname: 'workstation' })                                         // => false
 * await isRecordedOwnerGone({ pid: 4242, hostname: 'workstation', processStart: 'linux:100' }, { hostname: 'workstation' }, async () => 'linux:200') // => true while a process has the id 4242
 */
export async function isRecordedOwnerGone(
  owner: RecordedOwner,
  identity: StorageOwnerIdentity,
  readStart: ProcessStartReader = readProcessStart,
): Promise<boolean> {
  if (!isSameStorageMachine(owner, identity)) return false
  if (hasNoProcessOfThisBoot(owner, identity)) return true
  const { processStart } = owner
  if (processStart === undefined) return false
  // A process has the id: it is the owner only when it began at the recorded time, and one whose start cannot be read may be the owner.
  return beganAtAnotherTime(
    processStart,
    await readStart(owner.pid, { expectedStart: processStart }),
  )
}
