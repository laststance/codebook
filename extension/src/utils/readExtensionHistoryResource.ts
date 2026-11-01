import type { ExtensionHistoryEntry } from '../chromeExtensionHistorySchemas'
import type { ExtensionHistoryTypes } from '../chromeExtensionHistoryTypes'
import { CHROME_EXTENSION_PROFILE } from '../constants'
import { StudyError } from '../errors'
import type { NodeHistoryStore } from '../nodeTestHistoryStore'
import type { ResourceContent } from '../resources'

import { readHistoryResourceTail } from './readHistoryResourceTail'
import { readJsonPage } from './readJsonPage'
import { withKnownNodeHistory } from './withKnownNodeHistory'

/**
 * Reduces one journal entry to the lean form the events list returns: never a snapshot, the executed source text or frame bytes (a frame is named by its hash).
 * Called by {@link readExtensionHistoryResource} for the events list; the whole entry is its own detail resource.
 * @param entry - An extension journal entry as stored.
 * @returns The lean event.
 * @example leanExtensionEvent(captureEntry) // => { sequence: 4, type: 'capture', elapsedMs: 60, pauseId, path: 'popup.js', line: 3, sourceHash: '…', sourceBytes: 812 }
 */
function leanExtensionEvent(
  entry: ExtensionHistoryEntry,
): Record<string, unknown> {
  if (entry.type === 'capture') {
    const { debuggerSnapshot: _snapshot, ...lean } = entry
    return lean
  }
  return entry
}

/**
 * Answers one entry's detail page: the entry as stored, whole.
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
  return readJsonPage(`${baseUri}/events/${sequence}`, entry, page)
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
