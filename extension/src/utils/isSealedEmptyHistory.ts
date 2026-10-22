import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Tells whether a test history's folder holds a seal and no journal entry, the history that a run ended before its first entry used to leave (before Decision D6 the store sealed it; since then it removes the folder at the seal); a cheap check of two file sizes, not a read of the journal. Called by {@link NodeTestHistoryStore} wherever it lists a history or counts one toward the saved study limit, so both follow one rule.
 * @param historyDirectory - The history's folder.
 * @returns `true` when `sealed.json` exists and `events.jsonl` is empty or absent; `false` otherwise, also when either file cannot be inspected.
 * @example await isSealedEmptyHistory('/…/node-tests.v1/<study id>') // => true for a legacy history sealed with no entry
 */
export async function isSealedEmptyHistory(
  historyDirectory: string,
): Promise<boolean> {
  const seal = await lstat(join(historyDirectory, 'sealed.json')).catch(
    () => undefined,
  )
  if (!seal?.isFile()) return false
  const journal = await lstat(join(historyDirectory, 'events.jsonl')).then(
    (entry) => entry,
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? null
        : undefined,
  )
  return journal === null || journal?.size === 0
}
