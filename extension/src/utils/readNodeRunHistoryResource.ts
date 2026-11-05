import type { z } from 'zod'

import type { NODE_SCRIPT_PROFILE, NODE_SERVER_PROFILE } from '../constants'
import { StudyError } from '../errors'
import type { HistorySealBase, HistoryTypes } from '../historyStorageDescriptor'
import type { NodeScriptHistorySummary } from '../nodeScriptHistoryTypes'
import type {
  nodeRunOutputEntrySchema,
  nodeRunStopEntrySchema,
} from '../nodeServerHistorySchemas'
import type { NodeServerHistorySummary } from '../nodeServerHistoryTypes'
import type { NodeHistoryStore } from '../nodeTestHistoryStore'
import type { ResourceContent } from '../resources'

import { answerUnreadableHistoryEntry } from './answerUnreadableHistoryEntry'
import { maskSavedFacts } from './maskSavedFacts'
import { readHistoryResourceTail } from './readHistoryResourceTail'
import { readJsonPage } from './readJsonPage'
import { withKnownNodeHistory } from './withKnownNodeHistory'

/** The entries of a node run's history an agent may cite, in the lean form the events list returns: never the executed source text or a whole snapshot. */
export type LeanRunEvent = Record<string, unknown> & {
  sequence: number
  type: string
  elapsedMs: number
}

/**
 * Reduces a stop or an output of any node run's journal to its lean, citable form; a stop's facts are masked again by {@link maskSavedFacts}, so a history saved before the shape rules serves no Cookie, Authorization or secret URL query value.
 * Called by the server's and the script's lean reducers for the entries they share.
 * @param entry - A stop or an output entry, whose output was masked again.
 * @returns The lean event.
 * @example leanEvidenceEvent(outputEntry) // => { sequence: 2, type: 'output', elapsedMs: 5, channel: 'stdout', text: 'hi\n' }
 */
export function leanEvidenceEvent(
  entry:
    | z.infer<typeof nodeRunStopEntrySchema>
    | z.infer<typeof nodeRunOutputEntrySchema>,
): LeanRunEvent {
  const head = {
    sequence: entry.sequence,
    type: entry.type,
    elapsedMs: entry.elapsedMs,
  }
  if (entry.type === 'output')
    return { ...head, channel: entry.channel, text: entry.text }
  return {
    ...head,
    declaredStopIndex: entry.declaredStopIndex,
    hit: entry.hit,
    path: entry.source.path,
    line: entry.source.line,
    sourceHash: entry.source.hash,
    facts: maskSavedFacts(entry.facts),
    unavailable: entry.unavailable,
  }
}

/** What differs between the server's and the script's history resource: how a saved entry is masked, reduced to its lean form and restored, how the header is masked and how the verdicts are stated. */
export type NodeRunResourceProfile<Types extends HistoryTypes> = {
  /** Masks the output (and, for a server, the request path and redirect) a history saved before the shape rules kept. */
  mask(entries: readonly Types['Entry'][]): Types['Entry'][]
  /** Reduces a masked entry to its lean, citable form, or to nothing for a storage-only entry. */
  lean(entry: Types['Entry']): LeanRunEvent | undefined
  /** Restores every stop's whole snapshot and masks the entries again. */
  rehydrate(entries: readonly Types['Entry'][]): Types['Entry'][]
  /** Masks the header again where it declares anything secret-shaped. */
  maskHeader(header: Types['Header']): Types['Header']
}

/**
 * The page a node run history's events list reads: every page of one read is pinned to the prefix that existed at its first page, so a history still recording reads consistently; the first read pins the last sequence it sees and returns `through` in its `nextUri`.
 * @param baseUri - `codebook://node-history/<id>`.
 * @param entries - The journal's entries as stored; the pinned prefix is masked again before it is served, so a history saved before the shape rules serves no Cookie line, Authorization value or `?code=` URL in its output, request path or stops.
 * @param through - The pinned last sequence, or `undefined` for a first read, which pins the journal's current end.
 * @param page - The returned page cursor, `pages/<hash>/<offset>`, absent for the first page.
 * @returns One page of the lean list of events with sequence up to `through`.
 * @param profile - How the profile masks and reduces its entries.
 * @example readEventsPage('codebook://node-history/a_b', history.entries, undefined, undefined)
 */
function readEventsPage<Types extends HistoryTypes>(
  baseUri: string,
  entries: readonly Types['Entry'][],
  through: number | undefined,
  page: string | undefined,
  profile: NodeRunResourceProfile<Types>,
): ResourceContent {
  // A pin past the journal's end (or beyond the safe integers) is the journal's own end: the pin never names what does not exist.
  const end = entries.at(-1)?.sequence ?? 0
  const last = Math.min(through ?? end, end)
  // The mask reads the pinned prefix as one stream, so every page of one read sees the same texts however far the journal has grown.
  const events = profile
    .mask(entries.filter((entry) => entry.sequence <= last))
    .flatMap((entry) => profile.lean(entry) ?? [])
  return readJsonPage(`${baseUri}/events/through/${last}`, events, page)
}

/** The three verdicts and their capped lists as the history resource and the run resource state them, for a server or a script history. */
export function nodeRunVerdicts(
  profile: typeof NODE_SERVER_PROFILE | typeof NODE_SCRIPT_PROFILE,
  summary:
    | Pick<
        NodeServerHistorySummary,
        | 'captureComplete'
        | 'captureMissing'
        | 'captureMissingCount'
        | 'learningCoverage'
        | 'learningMissing'
        | 'learningMissingCount'
        | 'materialRevision'
      >
    | NodeScriptHistorySummary
    | undefined,
  sealed: boolean,
) {
  return {
    profile,
    // Saved: the history is sealed. Capture complete: no partial reason. Learning complete: the material cites the request, a hit of every reached stop and the terminal entry.
    saved: sealed,
    captureComplete: summary?.captureComplete ?? false,
    captureMissing: summary?.captureMissing ?? [],
    captureMissingCount: summary?.captureMissingCount ?? 0,
    learningCoverage: summary?.learningCoverage ?? 'none',
    learningMissing: summary?.learningMissing ?? [],
    learningMissingCount: summary?.learningMissingCount ?? 0,
    materialRevision: summary?.materialRevision ?? 0,
  }
}

/**
 * Answers one entry's detail page: the stop restored to its whole snapshot, or the entry; output, request path and redirect location are masked again ({@link maskSavedServerEntries}) so a history saved before the shape rules serves no credential in them.
 * Called by {@link readNodeRunHistoryResource} for `events/<sequence>`; only the restoration of the entries is turned into the coded answer, so another failure keeps its own cause.
 * @param baseUri - The history's resource address.
 * @param studyId - The history's study id.
 * @param entries - The verified journal entries.
 * @param sequence - The entry asked for.
 * @param page - The page cursor, when the content spans pages.
 * @returns The entry's first or requested page.
 * @throws `EVIDENCE_UNAVAILABLE` when a stop cannot be restored; `NOT_FOUND` when no entry has the sequence.
 * @param profile - How the profile restores its entries.
 * @example readEntryDetail('codebook://node-history/a_b', 'a_b', entries, 4, undefined)
 */
function readEntryDetail<Types extends HistoryTypes>(
  baseUri: string,
  studyId: string,
  entries: readonly Types['Entry'][],
  sequence: number,
  page: string | undefined,
  profile: NodeRunResourceProfile<Types>,
): ResourceContent {
  let entry: Types['Entry'] | undefined
  try {
    // The stored stop keeps its top frame's source by hash; the detail restores the whole snapshot.
    entry = profile
      .rehydrate(entries)
      .find((candidate) => candidate.sequence === sequence)
  } catch (error) {
    // Only a stop that cannot be restored answers a coded error, never a raw schema dump.
    throw answerUnreadableHistoryEntry(error, studyId, baseUri)
  }
  if (!entry)
    throw new StudyError(
      'NOT_FOUND',
      `The history ${studyId} has no entry with sequence ${sequence}. Read ${baseUri}/events for the sequences it holds.`,
    )
  return readJsonPage(`${baseUri}/events/${sequence}`, entry, page)
}

/**
 * Answers a `codebook://node-history/<id>` resource for a node run history (server or script): the history with its three verdicts, the lean events list, one entry's detail, or the learning material.
 * Called by {@link readServerHistoryResource} and {@link readScriptHistoryResource} for an id the history repository resolves to their profile.
 * @param store - The workspace's store of the profile.
 * @param studyId - The history's study id.
 * @param suffix - What follows the id in the URI: `events`, `events/through/<n>` with an optional `/pages/…`, `events/<sequence>` with an optional `/pages/…`, `learning-material`, a `pages/…` cursor, or nothing.
 * @param profile - How the profile masks, reduces and restores its entries.
 * @param verdicts - States the profile's verdicts from the store's summary and whether the history is sealed.
 * @returns The resource's first or requested page.
 * @throws `NOT_FOUND` for an id without a history folder or an entry the history does not hold; `INVALID_REFERENCE` for a page cursor the content does not match.
 * @example await readNodeRunHistoryResource(store, studyId, 'events/4', profile, verdicts)
 */
export async function readNodeRunHistoryResource<
  Types extends HistoryTypes & {
    Seal: HistorySealBase & { capture: string }
    Summary: Parameters<typeof nodeRunVerdicts>[1]
  },
>(
  store: NodeHistoryStore<Types>,
  studyId: string,
  suffix: string | undefined,
  profile: NodeRunResourceProfile<Types>,
  verdicts: (
    summary: Types['Summary'] | undefined,
    sealed: boolean,
  ) => Record<string, unknown>,
): Promise<ResourceContent> {
  const baseUri = `codebook://node-history/${studyId}`
  const history = await withKnownNodeHistory(store, studyId, () =>
    store.read(studyId),
  )
  const events =
    /^events(?:\/through\/(\d+))?(\/pages\/[a-f0-9]{64}\/\d+)?$/.exec(
      suffix ?? '',
    )
  if (events)
    return readEventsPage(
      baseUri,
      history.entries,
      events[1] === undefined ? undefined : Number(events[1]),
      events[2]?.slice(1),
      profile,
    )
  const detail = /^events\/(\d+)(\/pages\/[a-f0-9]{64}\/\d+)?$/.exec(
    suffix ?? '',
  )
  if (detail) {
    return readEntryDetail(
      baseUri,
      studyId,
      history.entries,
      Number(detail[1]),
      detail[2]?.slice(1),
      profile,
    )
  }
  return readHistoryResourceTail({
    store,
    studyId,
    history: { ...history, header: profile.maskHeader(history.header) },
    suffix,
    verdicts: (summary) => verdicts(summary, history.seal !== undefined),
  })
}
