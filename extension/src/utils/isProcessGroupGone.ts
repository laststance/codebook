import { systemErrorCode } from './systemErrorCode'

/** What the error code of a signal-0 probe says about the probed process group. */
const IS_GROUP_GONE_BY_PROBE_ERROR_CODE: ReadonlyMap<string, boolean> = new Map(
  [
    ['ESRCH', true],
    // macOS: the group holds only exited members that their parent has not reaped yet, so it still exists.
    ['EPERM', false],
  ],
)

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
 * @throws Any other failure of the probe.
 * @example
 * ```ts
 * await waitUntil(() => isProcessGroupGone(child.pid), 'owned group exit', 1_000)
 * ```
 */
export function isProcessGroupGone(processGroup: number): boolean {
  try {
    process.kill(-processGroup, 0)
    return false
  } catch (error) {
    const isGone = IS_GROUP_GONE_BY_PROBE_ERROR_CODE.get(systemErrorCode(error))
    // An unknown probe failure says nothing about the group; the release reports it.
    if (isGone === undefined) throw error
    return isGone
  }
}
