import type { StudyRemoval } from '../learningLibrary'

/**
 * Decides what a removal answers when its storage lock failed; called by {@link LearningLibrary.outcomeOfFailedRemoval} for a lock call that rejected, and by {@link LearningLibrary.removeStudy} for a release that failed.
 * 1. The lock call rejected (`settled` is `undefined`): it rejects only before or in the steps, since a release that fails after them goes to `onReleaseFailure` and not to the rejection (task 21), so nothing moved.
 * 2. The lock could not be released (`settled` is the answer so far): the steps' outcome, or the `nothing-moved` answer of a lock call that rejected before or in the steps, whose release then failed too (Cycle 0048 task 211). What that answer says moved stands, and the lock failure is named in the answer.
 * @param settled - The answer so far: what the removal's steps settled, or the answer of a lock call that rejected; `undefined` for the rejection itself.
 * @param cause - The message of the rejection, or of the failed release.
 * @returns
 * - No answer so far (the lock was not taken, or a read before the first move failed): `nothing-moved` with the cause
 * - The steps moved everything and the release failed: `moved`, with the cause as `unreleasedLock`
 * - Any other answer and the release failed (the steps failed on their own, or the lock call rejected): that answer, its cause extended by the lock failure
 * @example
 * removalAfterLockFailure(undefined, 'Learning storage is locked.') // => { outcome: 'nothing-moved', cause: 'Learning storage is locked.' }
 * removalAfterLockFailure({ outcome: 'moved' }, 'EPERM: unlink')     // => { outcome: 'moved', unreleasedLock: 'EPERM: unlink' }
 * removalAfterLockFailure({ outcome: 'nothing-moved', cause: 'Learning storage is locked' }, 'EPERM: unlink') // => { outcome: 'nothing-moved', cause: 'Learning storage is locked; the storage lock could not be released: EPERM: unlink' }
 */
export function removalAfterLockFailure(
  settled: StudyRemoval | undefined,
  cause: string,
): StudyRemoval {
  if (!settled) return { outcome: 'nothing-moved', cause }
  if (settled.outcome === 'moved')
    return { outcome: 'moved', unreleasedLock: cause }
  return {
    ...settled,
    cause: `${settled.cause}; the storage lock could not be released: ${cause}`,
  }
}
