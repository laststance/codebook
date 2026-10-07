import { LARGEST_PROCESS_ID } from '../constants'

import { systemErrorCode } from './systemErrorCode'

/**
 * Says whether a number can be the id of a process at all, on any system; called by {@link isProcessGone} before it asks the system, which takes other numbers for something else or refuses them.
 * A process id is a whole number from 1 to {@link LARGEST_PROCESS_ID}. Zero and a negative number mean a process group or every process to the system's signal call, and a larger number or a fraction is refused by it as no id, with an error that says nothing about a process.
 * @param pid - The number a record names as its owner's process id.
 * @returns `true` for a whole number from 1 to 2147483647; `false` for every other number.
 * @example
 * canBeProcessId(1)             // => true
 * canBeProcessId(4_294_967_295) // => false
 * canBeProcessId(0)             // => false
 */
function canBeProcessId(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0 && pid <= LARGEST_PROCESS_ID
}

/**
 * Says whether no process with this id exists on this machine, probed with signal 0, to recognise what a killed editor left behind; called by {@link isRecordedOwnerGone} for the owner of a lock, a claim, a descriptor or a profile marker, by {@link readLiveWikiUpdateMarker} for the owner of a Wiki update marker, by {@link evidenceInUseElsewhere} for a descriptor that names a process and no machine, and by {@link RecordingStore} for the owner of a recording.
 * A number that no system gives a process names none and is not handed to the probe ({@link canBeProcessId}): a file a repository supplies can record any number, and the probe's refusal of one would otherwise read as a process that may still run.
 * @param pid - The process id a lock, a connection descriptor, a marker or a recording recorded.
 * @returns
 * - `true` for a number that cannot be a process id (above {@link LARGEST_PROCESS_ID}, zero or below, a fraction), without a probe
 * - `true` when the probe answers `ESRCH`
 * - `false` while a process with that id runs, also one this user may not signal (`EPERM`, as process 1 answers), and for any other probe failure
 * @example
 * isProcessGone(process.pid)    // => false
 * isProcessGone(2 ** 22 + 1)    // => true where no such process exists
 * isProcessGone(4_294_967_295)  // => true on every system
 */
export function isProcessGone(pid: number): boolean {
  // An id no system can give a process names none; the probe would refuse it, or take it for a process group.
  if (!canBeProcessId(pid)) return true
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return systemErrorCode(error) === 'ESRCH'
  }
}
