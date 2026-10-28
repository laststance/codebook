import { StudyError } from '../errors'
import type { NodeServerHistoryEntry } from '../nodeServerHistorySchemas'
import type { NodeServerHistoryTypes } from '../nodeServerHistoryTypes'
import type { NodeHistoryStore } from '../nodeTestHistoryStore'
import type { ResourceContent } from '../resources'

import { readJsonPage } from './readJsonPage'
import { rehydrateNodeServerEntries } from './rehydrateServerStopSnapshot'
import { withKnownNodeHistory } from './withKnownNodeHistory'

/** The entries of a server history an agent may cite, in the lean form the events list returns: never the executed source text or a whole snapshot. */
type LeanServerEvent = Record<string, unknown> & {
  sequence: number
  type: string
  elapsedMs: number
}

/**
 * Reduces one journal entry to its lean, citable form, or to nothing for an entry no learning step may cite (`source`, `end`, the send marks and `output-truncated`).
 * Called by {@link readServerHistoryResource} for the events list; the whole entry, snapshot and body included, is {@link readServerHistoryResource}'s per-entry detail.
 * @param entry - A server journal entry as stored.
 * @returns The lean event, or `undefined` for a storage-only entry.
 * @example leanServerEvent(stopEntry) // => { sequence: 4, type: 'stop', elapsedMs: 60, declaredStopIndex: 0, hit: 1, path: 'src/handler.ts', line: 2, sourceHash: '…', facts: { 'value:id': '7' } }
 */
function leanServerEvent(
  entry: NodeServerHistoryEntry,
): LeanServerEvent | undefined {
  const head = {
    sequence: entry.sequence,
    type: entry.type,
    elapsedMs: entry.elapsedMs,
  }
  switch (entry.type) {
    case 'request':
      return {
        ...head,
        attempt: entry.attempt,
        method: entry.method,
        path: entry.path,
        bodyBytes: entry.bodyBytes,
      }
    case 'stop':
      return {
        ...head,
        declaredStopIndex: entry.declaredStopIndex,
        hit: entry.hit,
        path: entry.source.path,
        line: entry.source.line,
        sourceHash: entry.source.hash,
        facts: entry.facts,
        unavailable: entry.unavailable,
      }
    case 'output':
      return { ...head, channel: entry.channel, text: entry.text }
    case 'response':
      return {
        ...head,
        status: entry.status,
        contentType: entry.contentType,
        bodyBytes: entry.bodyBytes,
        readCut: entry.readCut,
      }
    case 'request-failed':
      return { ...head, code: entry.code, message: entry.message }
    default:
      return undefined
  }
}

/**
 * The page a server history's events list reads: every page of one read is pinned to the prefix that existed at its first page, so a history still recording reads consistently; the first read pins the last sequence it sees and returns `through` in its `nextUri`.
 * @param baseUri - `codebook://node-history/<id>`.
 * @param entries - The journal's entries as stored.
 * @param through - The pinned last sequence, or `undefined` for a first read, which pins the journal's current end.
 * @param page - The returned page cursor, `pages/<hash>/<offset>`, absent for the first page.
 * @returns One page of the lean list of events with sequence up to `through`.
 * @example readServerEventsPage('codebook://node-history/a_b', history.entries, undefined, undefined)
 */
function readServerEventsPage(
  baseUri: string,
  entries: readonly NodeServerHistoryEntry[],
  through: number | undefined,
  page: string | undefined,
): ResourceContent {
  const last = through ?? entries.at(-1)?.sequence ?? 0
  const events = entries
    .filter((entry) => entry.sequence <= last)
    .flatMap((entry) => leanServerEvent(entry) ?? [])
  return readJsonPage(`${baseUri}/events/through/${last}`, events, page)
}

/** The three verdicts and their capped lists as the history resource and the run resource state them. */
function serverVerdicts(
  summary: Awaited<
    ReturnType<NodeHistoryStore<NodeServerHistoryTypes>['summarize']>
  >,
  sealed: boolean,
) {
  return {
    profile: 'node-server' as const,
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
 * Answers a `codebook://node-history/<id>` resource for a server history: the history with its three verdicts, the lean events list, one entry's detail, or the learning material.
 * Called by {@link readResource} for an id the history repository resolves to the node-server profile.
 * @param store - The workspace's server history store.
 * @param studyId - The history's study id.
 * @param suffix - What follows the id in the URI: `events`, `events/through/<n>` with an optional `/pages/…`, `events/<sequence>` with an optional `/pages/…`, `learning-material`, a `pages/…` cursor, or nothing.
 * @returns The resource's first or requested page.
 * @throws `NOT_FOUND` for an id without a history folder or an entry the history does not hold; `INVALID_REFERENCE` for a page cursor the content does not match.
 * @example await readServerHistoryResource(store, studyId, 'events/4')
 */
export async function readServerHistoryResource(
  store: NodeHistoryStore<NodeServerHistoryTypes>,
  studyId: string,
  suffix: string | undefined,
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
    return readServerEventsPage(
      baseUri,
      history.entries,
      events[1] === undefined ? undefined : Number(events[1]),
      events[2]?.slice(1),
    )
  const detail = /^events\/(\d+)(\/pages\/[a-f0-9]{64}\/\d+)?$/.exec(
    suffix ?? '',
  )
  if (detail) {
    const sequence = Number(detail[1])
    // The stored stop keeps its top frame's source by hash; the detail restores the whole snapshot.
    const entry = rehydrateNodeServerEntries(history.entries).find(
      (candidate) => candidate.sequence === sequence,
    )
    if (!entry)
      throw new StudyError(
        'NOT_FOUND',
        `The history ${studyId} has no entry with sequence ${sequence}. Read ${baseUri}/events for the sequences it holds.`,
      )
    return readJsonPage(
      `${baseUri}/events/${sequence}`,
      entry,
      detail[2]?.slice(1),
    )
  }
  if (
    suffix === 'learning-material' ||
    suffix?.startsWith('learning-material/pages/')
  ) {
    const material = await withKnownNodeHistory(store, studyId, () =>
      store.readLearningMaterial(studyId),
    )
    return readJsonPage(
      `${baseUri}/learning-material`,
      material ?? {
        studyId,
        revision: 0,
        status: 'not-saved',
        content: undefined,
      },
      suffix.startsWith('learning-material/pages/')
        ? suffix.slice('learning-material/'.length)
        : undefined,
    )
  }
  const summary = await withKnownNodeHistory(store, studyId, () =>
    store.summarize(studyId),
  )
  return readJsonPage(
    baseUri,
    {
      header: history.header,
      status: history.status,
      reason: history.reason,
      seal: history.seal
        ? {
            status: history.seal.status,
            endedAt: history.seal.endedAt,
            entryCount: history.seal.entryCount,
            capture: history.seal.capture,
          }
        : undefined,
      entryCount: history.entries.length,
      ...serverVerdicts(summary, history.seal !== undefined),
      eventsUri: `${baseUri}/events`,
    },
    suffix,
  )
}
