import { systemErrorCode } from './systemErrorCode'

/**
 * Says whether no process with this id exists on this machine, probed with signal 0; called by {@link isRecordedOwnerGone} and {@link RecordingStore} to recognise what a killed editor left behind.
 * @param pid - The process id a lock, a connection descriptor or a recording recorded.
 * @returns
 * - `true` only when the probe answers `ESRCH`
 * - `false` while a process with that id runs, also one this user may not signal (`EPERM`), and for any other probe failure
 * @example
 * isProcessGone(process.pid) // => false
 * isProcessGone(2 ** 22 + 1) // => true where no such process exists
 */
export function isProcessGone(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return systemErrorCode(error) === 'ESRCH'
  }
}
