import { assertOwnedProcessGroup } from './assertOwnedProcessGroup'
import { isUnreapedProcessGroupError } from './isUnreapedProcessGroupError'
import { systemErrorCode } from './systemErrorCode'

/**
 * Tells whether an owned process group has no member left, so that its release can end.
 *
 * Probes the group with signal 0. A group whose last members have exited but are not reaped yet still exists; the caller keeps waiting inside
 * its own bound instead of failing the release with the probe's error. Called by the release of the owned Vitest listing in {@link listVitestTestFiles}.
 *
 * @param processGroup - Process group id, the pid of the detached group leader.
 * @returns
 * - `true` when no such group exists
 * - `false` while the group has a member, alive or exited and not reaped yet
 * @throws A `RangeError` for a group id that is not an integer greater than 1, and any other failure of the probe, including `EPERM` outside macOS
 * (a live member the user may not signal).
 * @example
 * ```ts
 * await waitUntil(() => isProcessGroupGone(child.pid), 'owned group exit', 1_000)
 * ```
 */
export function isProcessGroupGone(processGroup: number): boolean {
  assertOwnedProcessGroup(processGroup)
  try {
    process.kill(-processGroup, 0)
    return false
  } catch (error) {
    if (systemErrorCode(error) === 'ESRCH') return true
    // macOS: the group holds only exited members that their parent has not reaped yet, so it still exists.
    if (isUnreapedProcessGroupError(error)) return false
    // Any other probe failure says nothing about the group; the release reports it.
    throw error
  }
}
