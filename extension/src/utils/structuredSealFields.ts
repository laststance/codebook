import { sha256 } from '../runtimeSupport/utils/sha256'

import { cutHistoryReason } from './cutHistoryReason'

/**
 * Reads the entries of a journal's bytes, each line parsed by the profile's entry parser.
 * Called by a profile's seal builder, which judges the capture from the journal as written.
 * @param journal - The journal file's bytes.
 * @param parseEntry - The profile's entry parser.
 * @returns The entries in order.
 * @throws What the parser or `JSON.parse` throws for a bad line.
 * @example const entries = parseJournalEntries(journal, (value) => nodeServerHistoryEntrySchema.parse(value))
 */
export function parseJournalEntries<Entry>(
  journal: Buffer,
  parseEntry: (value: unknown) => Entry,
): Entry[] {
  return journal
    .toString('utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseEntry(JSON.parse(line)))
}

/**
 * Builds the fields of a structured seal from its journal and the reasons the capture misses: complete exactly when no reason is named.
 * Called by the node-server and the chrome-extension profile's seal builders, which validate the result with their seal schema.
 * @param input - The profile's seal `version`, the history's identity, the journal and its entry count, when it ended, and the reasons.
 * @returns The seal's fields, ready for the seal schema.
 * @example structuredSealFields({ version: 1, studyId, entryCount: 4, journal, endedAt, reasons: [] }).status // => 'complete'
 */
export function structuredSealFields<Version extends number>(input: {
  version: Version
  studyId: string
  entryCount: number
  journal: Buffer
  endedAt: string
  reasons: readonly { text: string }[]
}) {
  const complete = input.reasons.length === 0
  return {
    version: input.version,
    studyId: input.studyId,
    entryCount: input.entryCount,
    journalBytes: input.journal.byteLength,
    journalHash: sha256(input.journal),
    status: complete ? ('complete' as const) : ('partial' as const),
    endedAt: input.endedAt,
    reasons: input.reasons,
    capture: complete ? ('complete' as const) : ('incomplete' as const),
    ...(input.reasons[0]
      ? { reason: cutHistoryReason(input.reasons[0].text) }
      : {}),
  }
}
