import { systemErrorCode } from './systemErrorCode'

/**
 * Error codes that mean the signal had no member to reach: the group is gone (`ESRCH`), or, on macOS, it holds only exited members that their
 * parent has not reaped yet (`EPERM`).
 */
const NO_MEMBER_TO_SIGNAL_ERROR_CODES: ReadonlySet<string> = new Set([
  'ESRCH',
  'EPERM',
])

/**
 * Sends a signal to every member of an owned process group and treats a group with nobody left to receive it as already released.
 *
 * The caller decides afterwards, with {@link isProcessGroupGone} inside its own bound, whether the group has ended; this function only delivers.
 * Called by the release of the owned Vitest listing in {@link listVitestTestFiles}, first with `SIGTERM` and then with `SIGKILL`.
 *
 * @param processGroup - Process group id, the pid of the detached group leader.
 * @param signal - The signal to deliver.
 * @throws Any failure other than "no member could receive the signal".
 * @example
 * ```ts
 * signalProcessGroup(child.pid, 'SIGTERM')
 * ```
 */
export function signalProcessGroup(
  processGroup: number,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-processGroup, signal)
  } catch (error) {
    if (!NO_MEMBER_TO_SIGNAL_ERROR_CODES.has(systemErrorCode(error)))
      throw error
  }
}
