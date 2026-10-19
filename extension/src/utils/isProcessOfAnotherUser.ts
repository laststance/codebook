import { systemErrorCode } from './systemErrorCode'

/**
 * Says whether a live process of this machine belongs to another user, whom this user may not signal (the probe with signal 0 answers `EPERM`); called by the judgement of a recording's writer ({@link recordingWriterState}) once the writer's process id is known to be in use.
 * Why: an editor that writes this user's storage runs as this user, so such a process is likely another process that got the writer's id. It can also be the writer itself, run with other rights (an editor started as administrator on Windows). Either way this computer cannot confirm the writer, and the learner decides; the probe of {@link isProcessGone} counts such a process as running, which alone would keep a crashed writer's recording for good.
 * @param pid - The process id a recording names as its writer's.
 * @returns `true` when the probe answers `EPERM`; `false` while this user may signal the process, when no process has the id, and for any other probe failure.
 * @example
 * isProcessOfAnotherUser(process.pid) // => false
 * isProcessOfAnotherUser(1)           // => true for a user other than root on Linux and macOS
 */
export function isProcessOfAnotherUser(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return systemErrorCode(error) === 'EPERM'
  }
}
