import type {
  ExtensionHistoryEntry,
  ExtensionHistoryEntryOf,
  ExtensionHistoryHeader,
  ExtensionPauseCloseReason,
} from '../chromeExtensionHistorySchemas'

import { extensionCaptureHasSource } from './extensionCaptureHasSource'

/** The frame a journal `frame` entry describes: the blob's hash and size, and when it was received on the run clock. */
export type ExtensionReplayFrame = {
  /** The journal sequence of the `frame` entry, the key a lazily loaded blob is cached under. */
  sequence: number
  kind: 'stream' | 'pin'
  hash: string
  byteLength: number
  width: number
  height: number
  /** When the frame was received; its place on the timeline. */
  capturedAtMs: number
}

/** One recorded pause: a stop the run accepted, with what its journal holds of it. */
export type ExtensionReplayPause = {
  pauseId: string
  /** The declared stop number, counted from 1. */
  stopIndex: number
  context: string
  openSequence: number
  openMs: number
  /** Absent for a pause the history never saw close (an interrupted history). */
  closeSequence?: number
  closeMs?: number
  /** Where the stop executed: the capture's, else the declared stop's, else a marker for a stop the header does not declare. */
  path: string
  line: number
  /** The pause's capture, absent when the run never completed it. */
  capture?: ExtensionHistoryEntryOf<'capture'>
  /** The screenshot taken at this pause, when the live run pinned one. */
  pin?: ExtensionReplayFrame
  /** The last stream frame received at or before the pause opened. */
  precedingStream?: ExtensionReplayFrame
  /** Whether the capture holds a debugger snapshot with a top frame. */
  hasSnapshot: boolean
  /** Whether the top frame's source text matches the capture's path, line and hash (the proof a stop's source is the executed one). */
  hasSource: boolean
}

/** An event of the replay's timeline: what moves the playhead. A `capture` and a `pin` are not events; they belong to their pause. */
export type ExtensionReplayEvent = {
  sequence: number
  /** Its place on the timeline in milliseconds of the run clock; a stream frame's is when it was received. */
  timeMs: number
  type: 'pause-open' | 'pause-close' | 'frame' | 'result'
  pauseId?: string
  frame?: ExtensionReplayFrame
  /** Why the pause closed, on a `pause-close` event. */
  closeReason?: ExtensionPauseCloseReason
}

/** What the Application pane shows of a moment: the pause's pinned frame, a stream frame (with how far before the stop it was received, at a stop), or nothing recorded. */
export type ExtensionMomentFrame =
  | { state: 'pinned'; frame: ExtensionReplayFrame }
  | { state: 'stream'; frame: ExtensionReplayFrame; beforeStopMs?: number }
  | { state: 'none' }

/** The replay at one event: the selected stop (the most recently opened pause still open) and the frame to show. */
export type ExtensionReplayMoment = {
  event: ExtensionReplayEvent
  stop?: ExtensionReplayPause
  frame: ExtensionMomentFrame
}

/** An extension history read once into what a replay asks of it. Holds data only: no Chrome, debugger or file handle. */
export type ExtensionReplayModel = {
  studyId: string
  header: ExtensionHistoryHeader
  status: 'recording' | 'complete' | 'partial' | 'interrupted'
  reason?: string
  /** The timeline in order: by run-clock time, equal times by journal sequence. */
  events: readonly ExtensionReplayEvent[]
  /** The moment at each event, parallel to {@link events}. */
  moments: readonly ExtensionReplayMoment[]
  /** The position of each event in {@link events}, by journal sequence. */
  indexBySequence: ReadonlyMap<number, number>
  pauses: ReadonlyMap<string, ExtensionReplayPause>
  /** The recorded result, when the journal holds one. */
  result?: ExtensionHistoryEntryOf<'result'>
  /** The time the timeline ends: the last event's. */
  endedAtMs: number
}

/** The pauses, the unsorted timeline events and the result a journal holds; filled by {@link collectExtensionReplay}. */
type CollectedExtensionReplay = {
  pauses: Map<string, ExtensionReplayPause>
  events: ExtensionReplayEvent[]
  result?: ExtensionHistoryEntryOf<'result'>
}

/**
 * Records a `pause-open` entry as a pause and as a timeline event; a stop the header does not declare keeps a marker place.
 * @param collected - What the pass holds so far.
 * @param header - The history's header, for the stop's declared place.
 * @param entry - The entry.
 * @example openExtensionPause(collected, header, entry)
 */
function openExtensionPause(
  collected: CollectedExtensionReplay,
  header: ExtensionHistoryHeader,
  entry: ExtensionHistoryEntryOf<'pause-open'>,
): void {
  const declared = header.declaredStops.find(
    (stop) => stop.index === entry.stopIndex,
  )
  collected.pauses.set(entry.pauseId, {
    pauseId: entry.pauseId,
    stopIndex: entry.stopIndex,
    context: entry.context,
    openSequence: entry.sequence,
    openMs: entry.elapsedMs,
    path: declared?.path ?? '(not declared)',
    line: declared?.line ?? 1,
    hasSnapshot: false,
    hasSource: false,
  })
  collected.events.push({
    sequence: entry.sequence,
    timeMs: entry.elapsedMs,
    type: 'pause-open',
    pauseId: entry.pauseId,
  })
}

/**
 * Attaches a `capture` entry to its pause: the executed place, whether it holds a snapshot and whether its source is proven. A capture of a pause the journal never opened, or a second one, belongs to no stop and is skipped.
 * @param collected - What the pass holds so far.
 * @param entry - The entry.
 * @example captureExtensionPause(collected, entry)
 */
function captureExtensionPause(
  collected: CollectedExtensionReplay,
  entry: ExtensionHistoryEntryOf<'capture'>,
): void {
  const pause = collected.pauses.get(entry.pauseId)
  if (!pause || pause.capture) return
  pause.capture = entry
  pause.path = entry.path
  pause.line = entry.line
  pause.hasSnapshot = entry.debuggerSnapshot.frames.length > 0
  pause.hasSource = extensionCaptureHasSource(entry)
}

/**
 * Closes a pause at a `pause-close` entry and records the close as a timeline event.
 * @param collected - What the pass holds so far.
 * @param entry - The entry.
 * @example closeExtensionPause(collected, entry)
 */
function closeExtensionPause(
  collected: CollectedExtensionReplay,
  entry: ExtensionHistoryEntryOf<'pause-close'>,
): void {
  const pause = collected.pauses.get(entry.pauseId)
  // A close journaled after the fact stands where the pause left the debugger, not where the entry was appended.
  const endedMs = entry.endedAtMs ?? entry.elapsedMs
  if (pause && pause.closeSequence === undefined) {
    pause.closeSequence = entry.sequence
    pause.closeMs = endedMs
  }
  collected.events.push({
    sequence: entry.sequence,
    timeMs: endedMs,
    type: 'pause-close',
    pauseId: entry.pauseId,
    closeReason: entry.reason,
  })
}

/**
 * Records a `frame` entry: a pin joins the pause it names (a second pin is ignored); a stream frame is a timeline event at the time it was received.
 * @param collected - What the pass holds so far.
 * @param entry - The entry.
 * @example collectExtensionFrame(collected, entry)
 */
function collectExtensionFrame(
  collected: CollectedExtensionReplay,
  entry: ExtensionHistoryEntryOf<'frame'>,
): void {
  const frame: ExtensionReplayFrame = {
    sequence: entry.sequence,
    kind: entry.kind,
    hash: entry.hash,
    byteLength: entry.byteLength,
    width: entry.width,
    height: entry.height,
    capturedAtMs: entry.capturedAtMs,
  }
  if (entry.kind === 'pin') {
    const pause = entry.pauseId
      ? collected.pauses.get(entry.pauseId)
      : undefined
    if (pause && !pause.pin) pause.pin = frame
    return
  }
  collected.events.push({
    sequence: entry.sequence,
    timeMs: entry.capturedAtMs,
    type: 'frame',
    frame,
  })
}

/**
 * Reads the frames, pauses and results of a journal in one pass; the first step of {@link buildExtensionReplayModel}.
 * @param header - The history's header, for a stop's declared place.
 * @param entries - The verified entries in journal order.
 * @returns The pauses by id, the timeline events unsorted and the recorded result.
 * @example const { pauses, events } = collectExtensionReplay(header, entries)
 */
function collectExtensionReplay(
  header: ExtensionHistoryHeader,
  entries: readonly ExtensionHistoryEntry[],
): CollectedExtensionReplay {
  const collected: CollectedExtensionReplay = {
    pauses: new Map(),
    events: [],
  }
  for (const entry of entries) {
    if (entry.type === 'pause-open')
      openExtensionPause(collected, header, entry)
    else if (entry.type === 'capture') captureExtensionPause(collected, entry)
    else if (entry.type === 'pause-close') closeExtensionPause(collected, entry)
    else if (entry.type === 'frame') collectExtensionFrame(collected, entry)
    else if (!collected.result) {
      collected.result = entry
      collected.events.push({
        sequence: entry.sequence,
        timeMs: entry.elapsedMs,
        type: 'result',
      })
    }
  }
  return collected
}

/**
 * Derives the moment at each event of an ordered timeline: the selected stop is the most recently opened pause still open (a pause opened inside another shows from its open to its close, then the outer one again; between a close and the next open there is no stop), and the frame is the stop's pinned frame, else the last stream frame at or before the stop's open with its distance, else nothing; between stops the last stream frame so far plays.
 * @param events - The timeline in order.
 * @param pauses - The pauses by id; each gains its `precedingStream` here.
 * @returns One moment per event.
 * @example deriveExtensionMoments(events, pauses)[0]?.frame.state // => 'none' before any frame
 */
function deriveExtensionMoments(
  events: readonly ExtensionReplayEvent[],
  pauses: ReadonlyMap<string, ExtensionReplayPause>,
): ExtensionReplayMoment[] {
  const open: ExtensionReplayPause[] = []
  let lastStream: ExtensionReplayFrame | undefined
  return events.map((event): ExtensionReplayMoment => {
    const pause = event.pauseId ? pauses.get(event.pauseId) : undefined
    if (event.type === 'frame' && event.frame) lastStream = event.frame
    trackOpenPause(event.type, pause, open, lastStream)
    const stop = open.at(-1)
    return {
      event,
      ...(stop ? { stop } : {}),
      frame: frameOfMoment(stop, lastStream),
    }
  })
}

/**
 * Keeps the list of open pauses in step with one timeline event: a pause that opens joins it with the stream frame received before it, and a pause that closes leaves it; called by {@link deriveExtensionMoments} for each event.
 * @param type - The event's type.
 * @param pause - The event's pause, absent for a frame or the result.
 * @param open - The pauses open before the event, most recently opened last; changed in place.
 * @param lastStream - The last stream frame received before the event.
 * @example trackOpenPause('pause-open', pause, open, frame) // open now ends with pause
 */
function trackOpenPause(
  type: ExtensionReplayEvent['type'],
  pause: ExtensionReplayPause | undefined,
  open: ExtensionReplayPause[],
  lastStream: ExtensionReplayFrame | undefined,
): void {
  if (!pause) return
  if (type === 'pause-open') {
    pause.precedingStream = lastStream
    open.push(pause)
    return
  }
  // A close ends the latest opening of that pause; a close of a pause that is not open changes nothing.
  if (type === 'pause-close') {
    const at = open.lastIndexOf(pause)
    if (at >= 0) open.splice(at, 1)
  }
}

/**
 * Chooses the frame a moment shows: at a stop its pinned frame, else the last stream frame at or before the stop's open (with the distance), else nothing; with no stop the last stream frame received so far.
 * @param stop - The selected stop, if any.
 * @param lastStream - The last stream frame at or before the event.
 * @returns The frame choice.
 * @example frameOfMoment(undefined, undefined) // => { state: 'none' }
 */
function frameOfMoment(
  stop: ExtensionReplayPause | undefined,
  lastStream: ExtensionReplayFrame | undefined,
): ExtensionMomentFrame {
  if (stop) {
    if (stop.pin) return { state: 'pinned', frame: stop.pin }
    return stop.precedingStream
      ? {
          state: 'stream',
          frame: stop.precedingStream,
          beforeStopMs: Math.max(
            0,
            stop.openMs - stop.precedingStream.capturedAtMs,
          ),
        }
      : { state: 'none' }
  }
  return lastStream ? { state: 'stream', frame: lastStream } : { state: 'none' }
}

/**
 * Reads a verified chrome-extension history once into a {@link ExtensionReplayModel}: the ordered timeline of pauses, frames and the result, and the moment at each event.
 * Times are the host's run clock, never Chrome's; a frame stands where it was received, not where its entry was appended, and equal times keep journal order.
 * Called once per opened history by {@link adaptExtensionReplay}.
 * @param history - The history as the store reads it.
 * @returns The model.
 * @example const model = buildExtensionReplayModel(await store.read(studyId))
 */
export function buildExtensionReplayModel(history: {
  header: ExtensionHistoryHeader
  entries: readonly ExtensionHistoryEntry[]
  status: ExtensionReplayModel['status']
  reason?: string
}): ExtensionReplayModel {
  const { pauses, events, result } = collectExtensionReplay(
    history.header,
    history.entries,
  )
  const ordered = [...events].sort(
    (left, right) =>
      left.timeMs - right.timeMs || left.sequence - right.sequence,
  )
  return {
    studyId: history.header.studyId,
    header: history.header,
    status: history.status,
    ...(history.reason === undefined ? {} : { reason: history.reason }),
    events: ordered,
    moments: deriveExtensionMoments(ordered, pauses),
    indexBySequence: new Map(
      ordered.map((event, position) => [event.sequence, position]),
    ),
    pauses,
    ...(result ? { result } : {}),
    endedAtMs: ordered.at(-1)?.timeMs ?? 0,
  }
}

/**
 * Finds the event a saved playhead restores: the event itself, or for a sequence that names a journal entry that is no event (a capture or a pin) the event with the greatest sequence below it; a playhead before every event, or none, restores the opening moment.
 * @param model - The replay model.
 * @param sequence - The saved reader position's journal sequence.
 * @returns The event to restore; `undefined` for a history with no event.
 * @example restoreExtensionPlayhead(model, 7)?.sequence // => 6 when sequence 7 is a capture after the pause-open at 6
 */
export function restoreExtensionPlayhead(
  model: ExtensionReplayModel,
  sequence: number,
): ExtensionReplayEvent | undefined {
  const exact = model.indexBySequence.get(sequence)
  if (exact !== undefined) return model.events[exact]
  const earlier = model.events
    .filter((event) => event.sequence < sequence)
    .reduce<ExtensionReplayEvent | undefined>(
      (best, event) => (!best || event.sequence > best.sequence ? event : best),
      undefined,
    )
  return earlier ?? openingExtensionEvent(model)
}

/**
 * Finds the moment a replay opens at when nothing was saved: its first recorded stop, else its first event.
 * @param model - The replay model.
 * @returns The opening event; `undefined` for a history with no event.
 * @example openingExtensionEvent(model)?.type // => 'pause-open'
 */
export function openingExtensionEvent(
  model: ExtensionReplayModel,
): ExtensionReplayEvent | undefined {
  return (
    model.events.find((event) => event.type === 'pause-open') ?? model.events[0]
  )
}
