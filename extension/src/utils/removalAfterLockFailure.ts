import type { StudyRemoval } from '../learningLibrary'

/**
 * Decides what a removal answers when its storage lock call rejected; called by {@link LearningLibrary.removeStudy}.
 * The lock call also rejects when its release fails after the steps ran, so what the steps settled decides what moved, not the rejection.
 * @param settled - What the removal's steps had settled before the lock call rejected; `undefined` when they never finished.
 * @param cause - The rejection's message.
 * @returns
 * - The steps never finished (the lock was not taken, or a read before the first move failed): `nothing-moved` with the cause
 * - The steps moved everything: `moved`, with the cause as `unreleasedLock`
 * - The steps failed on their own: their outcome, its cause extended by the lock failure
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
