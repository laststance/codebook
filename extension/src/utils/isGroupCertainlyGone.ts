/**
 * Says whether a process group certainly has no member left, counting a probe that fails as "still there".
 * Why: a stop or a sweep may treat a group as ended only on a positive answer; a probe error (a member the user may not signal, a failed system call) says nothing about the group, and reading it as "gone" would let a retried stop or the orphan sweep act on a guess.
 * Called by the node-server run, the identity check of a retried close in {@link launchNodeServer} and the orphan sweep {@link reapNodeServerOrphans}.
 * @param isGroupGone - The probe ({@link isProcessGroupGone} or a test's own); it may throw.
 * @param processGroup - The group id.
 * @returns
 * - `true` when the probe answered that the group has no member left
 * - `false` while it has a member, and when the probe throws
 * @example
 * isGroupCertainlyGone(isProcessGroupGone, 4242) // => false while a member runs, and when the probe throws
 */
export function isGroupCertainlyGone(
  isGroupGone: (processGroup: number) => boolean,
  processGroup: number,
): boolean {
  try {
    return isGroupGone(processGroup)
  } catch {
    return false
  }
}
