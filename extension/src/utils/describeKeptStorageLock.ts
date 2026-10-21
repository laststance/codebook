/**
 * Words the failure of a release that left this window's storage lock in place without throwing, because the owner of the lock could not be read at any attempt; called by {@link withStorageLock} for its `onReleaseFailure` caller (a study removal, {@link removalAfterLockFailure}).
 * Why: a release that throws names its cause (`EPERM: unlink …`); one that ends `kept` has no system error, so the caller would answer without a word while the lock still refuses every other window.
 * @param lockPath - The `writer.lock` file the release left.
 * @returns The sentence: which file stays, why, and that this window takes it back.
 * @example
 * describeKeptStorageLock('/storage/learning/writer.lock') // => 'The storage lock file /storage/learning/writer.lock was left in place: …'
 */
export function describeKeptStorageLock(lockPath: string): string {
  return `The storage lock file ${lockPath} was left in place: the system would not let this window read its owner to remove it. This window tries to take it back; until then other windows are refused.`
}
