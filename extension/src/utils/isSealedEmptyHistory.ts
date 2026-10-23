import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { NODE_TEST_HISTORY_SEAL_LIMIT_BYTES } from '../constants'
import { nodeTestHistorySealSchema } from '../nodeTestHistorySchemas'

import { systemErrorCode } from './systemErrorCode'

/**
 * Tells whether a test history's folder holds a seal that records no entry and no journal byte, beside an empty or absent journal: the history that a run ended before its first entry used to leave (before Decision D6 the store sealed it; since then it removes the folder at the seal). Called by {@link NodeTestHistoryStore} wherever it lists a history or counts one toward the saved study limit, so both follow one rule; a history it answers `true` for is removed.
 * The seal's own counts decide, not the journal's size alone: a history whose seal records entries but whose journal is gone or empty is damaged, not empty, and it stays to be read as unavailable with its learning material and header (F251).
 * @param historyDirectory - The history's folder.
 * @returns `true` when `sealed.json` is a regular file of at most {@link NODE_TEST_HISTORY_SEAL_LIMIT_BYTES} bytes whose seal records `entryCount` 0 and `journalBytes` 0, and `events.jsonl` is empty or absent; `false` otherwise, also when a file cannot be inspected or the seal cannot be read or parsed.
 * @example await isSealedEmptyHistory('/…/node-tests.v1/<study id>') // => true for a legacy history sealed with no entry, false for one whose seal records 4 entries but whose journal was lost
 */
export async function isSealedEmptyHistory(
  historyDirectory: string,
): Promise<boolean> {
  const sealPath = join(historyDirectory, 'sealed.json')
  const seal = await lstat(sealPath).catch(() => undefined)
  if (!seal?.isFile() || seal.size > NODE_TEST_HISTORY_SEAL_LIMIT_BYTES)
    return false
  const recorded = await readFile(sealPath, 'utf8').then(
    (text) => {
      try {
        return nodeTestHistorySealSchema.safeParse(JSON.parse(text))
      } catch {
        return undefined
      }
    },
    () => undefined,
  )
  // Only a seal that itself says the history holds nothing lets the folder go.
  if (
    !recorded?.success ||
    recorded.data.entryCount !== 0 ||
    recorded.data.journalBytes !== 0
  )
    return false
  const journal = await lstat(join(historyDirectory, 'events.jsonl')).then(
    (entry) => entry,
    (error: unknown) =>
      systemErrorCode(error) === 'ENOENT' ? null : undefined,
  )
  return journal === null || journal?.size === 0
}
