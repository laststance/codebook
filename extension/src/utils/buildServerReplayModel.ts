import type {
  NodeServerHistoryEntry,
  NodeServerHistoryHeader,
  NodeServerStopEntry,
} from '../nodeServerHistorySchemas'
import type { NodeServerHistorySummary } from '../nodeServerHistoryTypes'

import { rehydrateNodeServerEntries } from './rehydrateServerStopSnapshot'

/** The entries of a server journal a learner moves through: the request attempt and its withdrawal, output, a stop hit, the response and the request failure. `source` is storage only and `end` ends the timeline, so neither is an event. */
export type ServerReplayEvent = Exclude<
  NodeServerHistoryEntry,
  { type: 'source' | 'end' | 'request-sent' | 'output-truncated' }
>

/** What the model keeps of one request attempt: whether its bytes were handed to the socket, and the code of a refusal before that. */
export type ServerReplayAttempt = {
  attempt: number
  sent: boolean
  withdrawnCode?: string
}

/** The three verdicts a replay states beside its events: sealed, capture complete, learning complete. */
export type ServerReplayVerdicts = {
  saved: boolean
  captureComplete: boolean
  learningCoverage: NodeServerHistorySummary['learningCoverage']
}

/**
 * A server history read once into what a replay asks of it: the learner events in journal order, a lookup by sequence, the stops by number and hit with their rehydrated snapshots, when the recording ended and the three verdicts.
 * Built by {@link buildServerReplayModel}; the workspace's select, supersede and commit order moves over it unchanged. It holds data only: it imports no launcher and no HTTP sender, so a replay can never start the server or resend the request.
 */
export type ServerReplayModel = {
  studyId: string
  header: NodeServerHistoryHeader
  status: 'recording' | 'complete' | 'partial' | 'interrupted'
  events: readonly ServerReplayEvent[]
  /** The position of each event in {@link events}, by journal sequence. */
  indexBySequence: ReadonlyMap<number, number>
  attempts: readonly ServerReplayAttempt[]
  /** The recorded response or request failure, when the journal holds one. */
  terminal?: Extract<ServerReplayEvent, { type: 'response' | 'request-failed' }>
  /** The time the recording ended: the `end` entry's, else the last event's; the timeline ends here. */
  endedAtMs: number
  /** Whether the journal ended with neither a response nor a request failure. */
  endedBeforeAnswer: boolean
  /** The declared stops hit more than once, by declared index. */
  repeatedStops: ReadonlySet<number>
  verdicts: ServerReplayVerdicts
}

/**
 * Reads a verified server history once into a {@link ServerReplayModel}: every stop's snapshot is rehydrated from its `source` entry, the learner events keep their journal order (entries sharing one time stay in order), a late `end` after the terminal entry only moves the timeline's end, and the three verdicts come from the seal and the learning coverage the summary already counted.
 * Called once per opened history by the Study workspace.
 * @param history - The verified history as the store reads it.
 * @param verdicts - The verdicts of the history's summary.
 * @returns The model.
 * @example const model = buildServerReplayModel(await store.read(studyId), { saved: true, captureComplete: true, learningCoverage: 'complete' })
 */
export function buildServerReplayModel(
  history: {
    header: NodeServerHistoryHeader
    entries: readonly NodeServerHistoryEntry[]
    status: ServerReplayModel['status']
    seal?: unknown
  },
  verdicts: ServerReplayVerdicts,
): ServerReplayModel {
  const entries = rehydrateNodeServerEntries(history.entries)
  const events = entries.filter(isReplayEvent)
  const terminal = events.find(
    (event) => event.type === 'response' || event.type === 'request-failed',
  )
  const end = entries.find((entry) => entry.type === 'end')
  return {
    studyId: history.header.studyId,
    header: history.header,
    status: history.status,
    events,
    indexBySequence: new Map(
      events.map((event, position) => [event.sequence, position]),
    ),
    attempts: collectAttempts(entries),
    ...(terminal?.type === 'response' || terminal?.type === 'request-failed'
      ? { terminal }
      : {}),
    // The timeline ends at `end`; a journal with no `end` ends at its last event.
    endedAtMs: Math.max(end?.elapsedMs ?? 0, events.at(-1)?.elapsedMs ?? 0),
    endedBeforeAnswer: terminal === undefined,
    repeatedStops: repeatedStopIndexes(events),
    verdicts,
  }
}

/** Reads each request attempt's send mark and withdrawal code from the journal's entries. */
function collectAttempts(
  entries: readonly NodeServerHistoryEntry[],
): ServerReplayAttempt[] {
  const attempts = new Map<number, ServerReplayAttempt>()
  for (const entry of entries) {
    if (entry.type === 'request')
      attempts.set(entry.attempt, { attempt: entry.attempt, sent: false })
    const attempt =
      entry.type === 'request-sent' || entry.type === 'request-withdrawn'
        ? attempts.get(entry.attempt)
        : undefined
    if (attempt && entry.type === 'request-sent') attempt.sent = true
    if (attempt && entry.type === 'request-withdrawn')
      attempt.withdrawnCode = entry.code
  }
  return [...attempts.values()]
}

/** Finds the declared stops that were hit more than once. */
function repeatedStopIndexes(
  events: readonly ServerReplayEvent[],
): ReadonlySet<number> {
  const hits = new Map<number, number>()
  for (const event of events)
    if (event.type === 'stop')
      hits.set(
        event.declaredStopIndex,
        (hits.get(event.declaredStopIndex) ?? 0) + 1,
      )
  return new Set(
    [...hits].filter(([, count]) => count > 1).map(([index]) => index),
  )
}

/** Says whether a journal entry is a learner event. */
function isReplayEvent(
  entry: NodeServerHistoryEntry,
): entry is ServerReplayEvent {
  return (
    entry.type !== 'source' &&
    entry.type !== 'end' &&
    entry.type !== 'request-sent' &&
    entry.type !== 'output-truncated'
  )
}

/**
 * Finds the event a saved playhead restores: the event itself, or for a sequence that names a storage-only entry (`source`, a send mark, `end`) the nearest earlier learner event; a playhead before every event, or none, restores the replay's opening moment.
 * @param model - The replay model.
 * @param sequence - The saved reader position's journal sequence.
 * @returns The event to restore, or the opening moment when no earlier event exists; `undefined` for a history with no events.
 * @example restoreServerPlayhead(model, 3)?.sequence // => 2 when sequence 3 is a source entry after the request at 2
 */
export function restoreServerPlayhead(
  model: ServerReplayModel,
  sequence: number,
): ServerReplayEvent | undefined {
  const exact = model.indexBySequence.get(sequence)
  if (exact !== undefined) return model.events[exact]
  const earlier = model.events.findLast((event) => event.sequence < sequence)
  return earlier ?? openingServerEvent(model)
}

/**
 * Finds the moment a replay opens at when nothing was saved: its first recorded stop, else its request, else its first event.
 * @param model - The replay model.
 * @returns The opening event, or `undefined` for a history with no events.
 * @example openingServerEvent(model)?.type // => 'stop'
 */
export function openingServerEvent(
  model: ServerReplayModel,
): ServerReplayEvent | undefined {
  return (
    model.events.find((event) => event.type === 'stop') ??
    model.events.find((event) => event.type === 'request') ??
    model.events[0]
  )
}

/**
 * Finds the previous or next recorded stop hit from a moment, in journal order, so Previous and Next stop visit every hit of a stop that was hit again.
 * @param model - The replay model.
 * @param sequence - The moment the learner is at.
 * @param direction - `next` for a later hit, `previous` for an earlier one.
 * @returns The stop event, or `undefined` when there is none in that direction.
 * @example neighbourServerStop(model, 1, 'next')?.hit // => 1
 */
export function neighbourServerStop(
  model: ServerReplayModel,
  sequence: number,
  direction: 'next' | 'previous',
): NodeServerStopEntry | undefined {
  const stops = model.events.filter(
    (event): event is NodeServerStopEntry => event.type === 'stop',
  )
  return direction === 'next'
    ? stops.find((stop) => stop.sequence > sequence)
    : stops.findLast((stop) => stop.sequence < sequence)
}

/**
 * Finds one recorded hit of a declared stop by its number and hit, the lookup a `Stop <n> · hit <k>` link and a saved reading position use.
 * @param model - The replay model.
 * @param stopNumber - The declared stop's number, counted from 1.
 * @param hit - The hit's number, counted from 1.
 * @returns The stop event, or `undefined` for a hit the journal does not hold.
 * @example findServerStop(model, 2, 3)?.sequence // => 14
 */
export function findServerStop(
  model: ServerReplayModel,
  stopNumber: number,
  hit: number,
): NodeServerStopEntry | undefined {
  return model.events.find(
    (event): event is NodeServerStopEntry =>
      event.type === 'stop' &&
      event.declaredStopIndex === stopNumber - 1 &&
      event.hit === hit,
  )
}
