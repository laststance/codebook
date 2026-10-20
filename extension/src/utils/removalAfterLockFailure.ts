import type { StudyRemoval } from '../learningLibrary'

/**
 * Decides what a removal answers when its storage lock failed; called by {@link LearningLibrary.removeStudy} in two places.
 * 1. The lock call rejected (`settled` is `undefined`): it rejects only before or in the steps, since a release that fails after them goes to `onReleaseFailure` and not to the rejection (task 21), so nothing moved.
 * 2. The lock could not be released after the steps settled (`settled` is their outcome): what the steps settled decides what moved, and the lock failure is named in the answer.
 * @param settled - What the removal's steps settled; `undefined` when they never finished.
 * @param cause - The message of the rejection, or of the failed release.
 * @returns
 * - The steps never finished (the lock was not taken, or a read before the first move failed): `nothing-moved` with the cause
 * - The steps moved everything and the release failed: `moved`, with the cause as `unreleasedLock`
 * - The steps failed on their own and the release failed: their outcome, its cause extended by the lock failure
 * @example
 * removalAfterLockFailure(undefined, 'Learning storage is locked.') // => { outcome: 'nothing-moved', cause: 'Learning storage is locked.' }
 * removalAfterLockFailure({ outcome: 'moved' }, 'EPERM: unlink')     // => { outcome: 'moved', unreleasedLock: 'EPERM: unlink' }
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
