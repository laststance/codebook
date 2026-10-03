import { assertOwnedProcessGroup } from './assertOwnedProcessGroup'
import { isUnreapedProcessGroupError } from './isUnreapedProcessGroupError'
import { systemErrorCode } from './systemErrorCode'

/**
 * Sends a signal to every member of an owned process group and treats a group with nobody left to receive it as already released.
 *
 * The caller decides afterwards, with {@link isProcessGroupGone} inside its own bound, whether the group has ended; this function only delivers.
 * Called by the release of the owned Vitest listing in {@link listVitestTestFiles}, first with `SIGTERM` and then with `SIGKILL`.
 *
 * @param processGroup - Process group id, the pid of the detached group leader.
 * @param signal - The signal to deliver.
 * @throws A `RangeError` for a group id that is not an integer greater than 1, and any failure other than "no member could receive the signal": the
 * group is gone (`ESRCH`) or, on macOS, holds only exited members not reaped yet (`EPERM`, see {@link isUnreapedProcessGroupError}).
 * @example
 * ```ts
 * signalProcessGroup(child.pid, 'SIGTERM')
 * ```
 */
export function signalProcessGroup(
  processGroup: number,
  signal: NodeJS.Signals,
): void {
  assertOwnedProcessGroup(processGroup)
  try {
    process.kill(-processGroup, signal)
  } catch (error) {
    if (
      systemErrorCode(error) !== 'ESRCH' &&
      !isUnreapedProcessGroupError(error)
    )
      throw error
  }
}
