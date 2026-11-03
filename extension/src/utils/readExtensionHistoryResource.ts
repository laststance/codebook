import type { ExtensionHistoryEntry } from '../chromeExtensionHistorySchemas'
import type { ExtensionHistoryTypes } from '../chromeExtensionHistoryTypes'
import { CHROME_EXTENSION_PROFILE } from '../constants'
import { StudyError } from '../errors'
import type { NodeHistoryStore } from '../nodeTestHistoryStore'
import type { ResourceContent } from '../resources'

import { maskSavedDebugSnapshot } from './maskSavedDebugSnapshot'
import { maskSavedFacts } from './maskSavedFacts'
import { readHistoryResourceTail } from './readHistoryResourceTail'
import { readJsonPage } from './readJsonPage'
import { withKnownNodeHistory } from './withKnownNodeHistory'

/**
 * Masks again the observed values and the cause a result entry holds ({@link maskSavedFacts}), so a history saved before the shape rules serves no Cookie, Authorization or secret URL query value an observed storage key, cookie or page value held.
 * Called by {@link leanExtensionEvent} and {@link readEntryDetail} for a `result` entry.
 * @param entry - A result entry as stored.
 * @returns The entry with its `before`, `after` and `cause` masked; a member the entry does not hold stays absent.
 * @example maskExtensionResult(resultEntry).after // => { value: '[masked]' } for a stored { value: 'sid=abc; theme=dark' }
 */
function maskExtensionResult(
  entry: Extract<ExtensionHistoryEntry, { type: 'result' }>,
): ExtensionHistoryEntry {
  return {
    ...entry,
    ...(entry.before === undefined
      ? {}
      : { before: maskSavedFacts(entry.before) }),
    ...(entry.after === undefined
      ? {}
      : { after: maskSavedFacts(entry.after) }),
    ...(entry.cause === undefined
      ? {}
      : { cause: maskSavedFacts(entry.cause) }),
  }
}

/**
 * Masks again what one entry holds before its detail is served: a capture's facts and debugger snapshot, a result's observed values.
 * Called by {@link readEntryDetail}.
 * @param entry - An extension journal entry as stored.
 * @returns The whole entry with those members masked; any other entry as stored.
 * @example maskExtensionEntryDetail(captureEntry).facts // => { 'value:cookie': '[masked]' } for a stored Cookie-shaped fact
 */
function maskExtensionEntryDetail(
  entry: ExtensionHistoryEntry,
): ExtensionHistoryEntry {
  if (entry.type === 'capture')
    return {
      ...entry,
      facts: maskSavedFacts(entry.facts),
      debuggerSnapshot: maskSavedDebugSnapshot(entry.debuggerSnapshot),
    }
  return entry.type === 'result' ? maskExtensionResult(entry) : entry
}

/**
 * Reduces one journal entry to the lean form the events list returns: never a snapshot, the executed source text or frame bytes (a frame is named by its hash).
 * Called by {@link readExtensionHistoryResource} for the events list; the whole entry is its own detail resource. A capture's facts and a result's observed values are masked again by {@link maskSavedFacts}, so a history saved before the shape rules serves no Cookie, Authorization or secret URL query value.
 * @param entry - An extension journal entry as stored.
 * @returns The lean event.
 * @example leanExtensionEvent(captureEntry) // => { sequence: 4, type: 'capture', elapsedMs: 60, pauseId, path: 'popup.js', line: 3, sourceHash: '…', sourceBytes: 812 }
 */
function leanExtensionEvent(
  entry: ExtensionHistoryEntry,
): Record<string, unknown> {
  if (entry.type === 'capture') {
    const { debuggerSnapshot: _snapshot, ...lean } = entry
    return { ...lean, facts: maskSavedFacts(lean.facts) }
  }
  return entry.type === 'result' ? maskExtensionResult(entry) : entry
}

/**
 * Answers one entry's detail page: the entry as stored, whole, with a capture's facts and debugger snapshot masked again by {@link maskSavedFacts} and {@link maskSavedDebugSnapshot}, and a result's observed values by {@link maskSavedFacts}, so a history saved before the shape rules serves no cookie or credential value.
 * Called by {@link readExtensionHistoryResource} for `events/<sequence>`.
 * @param baseUri - The history's resource address.
 * @param entries - The verified journal entries.
 * @param sequence - The entry asked for.
 * @param page - The page cursor, when the content spans pages.
 * @returns The entry's first or requested page.
 * @throws `NOT_FOUND` when no entry has the sequence.
 * @example readEntryDetail('codebook://node-history/a_b', entries, 4, undefined)
 */
function readEntryDetail(
  baseUri: string,
  entries: readonly ExtensionHistoryEntry[],
  sequence: number,
  page: string | undefined,
): ResourceContent {
  const entry = entries.find((value) => value.sequence === sequence)
  if (!entry)
    throw new StudyError(
      'NOT_FOUND',
      `The history has no entry with sequence ${sequence}. Read ${baseUri}/events for the sequences it holds.`,
    )
  return readJsonPage(
    `${baseUri}/events/${sequence}`,
    maskExtensionEntryDetail(entry),
    page,
  )
}

/**
 * Answers a `codebook://node-history/<id>` resource for a chrome-extension history: the history with its capture codes, the lean events list, or one entry in full.
 * Called by {@link readResource} for an id the history repository resolves to the chrome-extension profile. The replies carry masked values only and never absolute paths; frames are named by hash.
 * @param store - The workspace's extension history store.
 * @param studyId - The history's study id.
 * @param suffix - What follows the id in the URI: `events` with an optional `/pages/…`, `events/<sequence>` with an optional `/pages/…`, `learning-material`, a `pages/…` cursor, or nothing.
 * @returns The resource's first or requested page.
 * @throws `NOT_FOUND` for an id without a history folder or an entry the history does not hold.
 * @example await readExtensionHistoryResource(store, studyId, 'events/4')
 */
export async function readExtensionHistoryResource(
  store: NodeHistoryStore<ExtensionHistoryTypes>,
  studyId: string,
  suffix: string | undefined,
): Promise<ResourceContent> {
  const baseUri = `codebook://node-history/${studyId}`
  const history = await withKnownNodeHistory(store, studyId, () =>
    store.read(studyId),
  )
  const route = /^events(?:\/(\d+))?(\/pages\/[a-f0-9]{64}\/\d+)?$/.exec(
    suffix ?? '',
  )
  if (route && route[1] === undefined)
    return readJsonPage(
      `${baseUri}/events`,
      history.entries.map(leanExtensionEvent),
      route[2]?.slice(1),
    )
  if (route?.[1] !== undefined)
    return readEntryDetail(
      baseUri,
      history.entries,
      Number(route[1]),
      route[2]?.slice(1),
    )
  return readHistoryResourceTail({
    store,
    studyId,
    history,
    suffix,
    verdicts: (summary) => ({
      profile: CHROME_EXTENSION_PROFILE,
      captureComplete: summary?.captureComplete ?? false,
      captureMissing: (summary?.captureMissing ?? []).map(
        (reason) => reason.code,
      ),
      learningCoverage: summary?.learningCoverage ?? 'none',
      learningMissing: summary?.learningMissing ?? [],
      materialRevision: summary?.materialRevision ?? 0,
      learningMaterialUri: `${baseUri}/learning-material`,
    }),
  })
}
