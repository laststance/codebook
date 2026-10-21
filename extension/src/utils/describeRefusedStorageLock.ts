import { STORAGE_LOCK_UNWRITTEN_GRACE_MS } from '../constants'

import { judgeLeftEmpty } from './judgeLeftEmpty'

/**
 * Finds the cause a refusal of {@link withStorageLock} can name beyond "another writer or an interrupted session", so that the learner knows what to do; called by {@link withStorageLock} when it is about to refuse a write because the lock file is present.
 * Two causes are known: the lock is this window's own leftover that its release and its take-backs could not remove (a scanner or an indexer holds the file), and the lock is an empty file old by this window's clock in a folder that takes no new file, so the clock probe that would judge it cannot be made ({@link judgeLeftEmpty}; the lock stays on purpose, Cycle 0048 task 40). Every other lock gets no added sentence.
 * @param lockPath - The `writer.lock` file that stays.
 * @param isOwnLeftover - Whether this process's release of that lock left it in place and no take-back has removed it.
 * @returns A sentence that begins with a space, to follow the refusal's own; `''` when no cause is known.
 * @example
 * await describeRefusedStorageLock('/storage/learning/writer.lock', false) // => '' for a lock of a live writer
 */
export async function describeRefusedStorageLock(
  lockPath: string,
  isOwnLeftover: boolean,
): Promise<string> {
  if (isOwnLeftover)
    return ' This window itself left the lock: the system would not let it read or remove the file, and its tries to take the lock back have not removed it. Close the program that holds the file (a virus scanner or an indexer can), then retry; if the lock stays, move the file away.'
  // A judgement that fails for another reason adds nothing: the plain refusal stands.
  const verdict = await judgeLeftEmpty(lockPath, 'file').catch(() => 'kept')
  if (verdict !== 'clock-unknown') return ''
  return ` The lock file is empty and older than ${STORAGE_LOCK_UNWRITTEN_GRACE_MS / 1_000} seconds, but the folder takes no new file now (a full disk, a read-only folder or a quota), so Codebook cannot read the clock of the file system to tell whether a writer left it. Make room or write access in the folder, then retry; if the lock stays, move the file away.`
}
