import { StudyError } from '../errors'
import type { NodeTestHistoryEntry } from '../nodeTestHistorySchemas'
import type { ResourceContent } from '../resources'

import { readJsonPage } from './readJsonPage'

/** One test-history entry an agent may cite, in the lean form the events list returns: never the executed source text or a debugger snapshot. */
type LeanTestEvent = Record<string, unknown> & {
  sequence: number
  type: string
  elapsedMs: number
}

/**
 * Reduces one test journal entry to the lean form a learning step cites: a stop keeps its sequence, index, source path, line and hash and its facts; an output keeps its channel and text (the journal bounds one output entry); the result keeps its exit code and signal.
 * Called by {@link readTestEventsPage}; the whole entry (snapshot, frame, output tail) is {@link readTestEntryDetail}'s answer.
 * @param entry - A test journal entry as stored.
 * @returns The lean event.
 * @example leanTestEvent(stopEntry) // => { sequence: 2, type: 'stop', elapsedMs: 5, index: 0, path: 'src/theme.ts', line: 1, sourceHash: '…', facts: [...] }
 */
function leanTestEvent(entry: NodeTestHistoryEntry): LeanTestEvent {
  const head = {
    sequence: entry.sequence,
    type: entry.type,
    elapsedMs: entry.elapsedMs,
  }
  switch (entry.type) {
    case 'stop':
      return {
        ...head,
        index: entry.index,
        path: entry.source.path,
        line: entry.source.line,
        sourceHash: entry.source.hash,
        facts: entry.facts,
      }
    case 'output':
      return { ...head, channel: entry.channel, text: entry.text }
    case 'result':
      return { ...head, exitCode: entry.exitCode, signal: entry.signal }
  }
}

/**
 * Answers a test history's events list: every entry a learning step may cite, lean, in pages.
 * Called by {@link readResource} for `codebook://node-history/<studyId>/events` of a test history, with the cursor of a later page when one is asked.
 * @param baseUri - `codebook://node-history/<studyId>`.
 * @param entries - The journal entries as stored.
 * @param page - The page cursor `pages/<hash>/<offset>`, absent for the first page.
 * @returns One page of the lean list.
 * @example readTestEventsPage('codebook://node-history/a_b', history.entries, undefined)
 */
export function readTestEventsPage(
  baseUri: string,
  entries: readonly NodeTestHistoryEntry[],
  page: string | undefined,
): ResourceContent {
  return readJsonPage(`${baseUri}/events`, entries.map(leanTestEvent), page)
}

/**
 * Answers one test-history entry in full (a stop with its frame and debugger snapshot).
 * Called by {@link readResource} for `events/<sequence>`.
 * @param baseUri - `codebook://node-history/<studyId>`.
 * @param studyId - The history's study id.
 * @param entries - The journal entries as stored.
 * @param sequence - The entry asked for.
 * @param page - The page cursor, when the entry spans pages.
 * @returns The entry's first or requested page.
 * @throws `NOT_FOUND` when no entry has the sequence.
 * @example readTestEntryDetail('codebook://node-history/a_b', 'a_b', history.entries, 2, undefined)
 */
export function readTestEntryDetail(
  baseUri: string,
  studyId: string,
  entries: readonly NodeTestHistoryEntry[],
  sequence: number,
  page: string | undefined,
): ResourceContent {
  const entry = entries.find((candidate) => candidate.sequence === sequence)
  if (!entry)
    throw new StudyError(
      'NOT_FOUND',
      `The history ${studyId} has no entry with sequence ${sequence}. Read ${baseUri}/events for the sequences it holds.`,
    )
  return readJsonPage(`${baseUri}/events/${sequence}`, entry, page)
}
