import { StudyError } from '../errors'
import type { NodeTestHistoryEntry } from '../nodeTestHistorySchemas'
import type { ResourceContent } from '../resources'

import { maskSavedDebugSnapshot } from './maskSavedDebugSnapshot'
import { maskSavedFacts } from './maskSavedFacts'
import { maskSavedOutputEntries } from './maskSavedOutputEntries'
import { readJsonPage } from './readJsonPage'

/** One test-history entry an agent may cite, in the lean form the events list returns: never the executed source text or a debugger snapshot. */
type LeanTestEvent = Record<string, unknown> & {
  sequence: number
  type: string
  elapsedMs: number
}

/**
 * Reduces one test journal entry to the lean form a learning step cites: a stop keeps its sequence, index, source path, line and hash and its facts, masked again by {@link maskSavedFacts} so a history saved before the shape rules serves no Cookie, Authorization or secret URL query value; an output keeps its channel and text (the journal bounds one output entry); the result keeps its exit code and signal.
 * Called by {@link readTestEventsPage}; the whole entry (snapshot, frame, output tail) is {@link readTestEntryDetail}'s answer.
 * @param entry - A test journal entry whose output was masked again ({@link maskSavedOutputEntries}).
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
        facts: maskSavedFacts(entry.facts),
      }
    case 'output':
      return { ...head, channel: entry.channel, text: entry.text }
    case 'result':
      return { ...head, exitCode: entry.exitCode, signal: entry.signal }
  }
}

/**
 * Answers a test history's events list: every entry a learning step may cite, lean, in pages; the output is masked again as one stream per channel ({@link maskSavedOutputEntries}) so a history saved before the shape rules serves no Cookie line, Authorization value or `rawHeaders` list its test logged.
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
  return readJsonPage(
    `${baseUri}/events`,
    maskSavedOutputEntries(entries).map(leanTestEvent),
    page,
  )
}

/**
 * Answers one test-history entry in full (a stop with its frame, its facts and its debugger snapshot, masked again by {@link maskSavedFacts} and {@link maskSavedDebugSnapshot}; an output and the result's output tail, masked again by {@link maskSavedOutputEntries}) so a history saved before the shape rules serves no cookie or credential value.
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
  const stored = entries.find((candidate) => candidate.sequence === sequence)
  if (!stored)
    throw new StudyError(
      'NOT_FOUND',
      `The history ${studyId} has no entry with sequence ${sequence}. Read ${baseUri}/events for the sequences it holds.`,
    )
  // An output is masked as part of its channel's stream and a result's tail on its own; a stop holds no output.
  const entry =
    stored.type === 'stop'
      ? stored
      : (maskSavedOutputEntries(entries).find(
          (candidate) => candidate.sequence === sequence,
        ) ?? stored)
  return readJsonPage(
    `${baseUri}/events/${sequence}`,
    entry.type === 'stop'
      ? {
          ...entry,
          facts: maskSavedFacts(entry.facts),
          debuggerSnapshot: maskSavedDebugSnapshot(entry.debuggerSnapshot),
        }
      : entry,
    page,
  )
}
