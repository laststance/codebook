import type {
  ExtensionHistoryEntry,
  ExtensionHistoryHeader,
  ExtensionHistorySealReason,
} from '../chromeExtensionHistorySchemas'
import {
  EXTENSION_HISTORY_REASON_CODES as CODES,
  EXTENSION_HISTORY_RESULT_UNREAD_CAUSE,
} from '../constants'

/** What only the writer knows when it seals, beside what the journal says. */
export type ExtensionCaptureFacts = {
  /** The first failed append: the entry before the gap and the failure's cause (already without private paths). */
  appendFailure?: { lastEntry: string; cause: string }
  /** Whether an entry or byte bound refused an entry. */
  sizeLimitReached?: boolean
  /** Whether a stream frame was dropped (a full queue) or could not be stored. */
  filmstripIncomplete?: boolean
  /** Whether the surface closed while the run lived. */
  surfaceEnded?: boolean
}

/**
 * Words an entry the way a reason names the last good entry of a broken history.
 * @param entry - The entry.
 * @returns `capture (entry 4)` or `result (entry 9)`.
 * @example describeLastExtensionEntry(captureEntry) // => 'capture (entry 4)'
 */
export function describeLastExtensionEntry(
  entry: ExtensionHistoryEntry,
): string {
  return `${entry.type} (entry ${entry.sequence})`
}

/** The reasons of the stops: declared stops never reached, pauses with no capture, captures whose executed source was not stored. */
function stopReasons(
  header: Pick<ExtensionHistoryHeader, 'declaredStops'>,
  entries: readonly ExtensionHistoryEntry[],
): ExtensionHistorySealReason[] {
  const reasons: ExtensionHistorySealReason[] = []
  const opened = entries.filter((entry) => entry.type === 'pause-open')
  const captures = entries.filter((entry) => entry.type === 'capture')
  const reachedStops = new Set(opened.map((pause) => pause.stopIndex))
  for (const declared of header.declaredStops)
    if (!reachedStops.has(declared.index))
      reasons.push({
        code: CODES.stopNotReached,
        params: { stop: declared.index },
        text: `Declared stop ${declared.index} was not reached.`,
      })
  const capturedPauses = new Set(captures.map((capture) => capture.pauseId))
  for (const pause of opened)
    if (!capturedPauses.has(pause.pauseId))
      reasons.push({
        code: CODES.snapshotMissing,
        params: { stop: pause.stopIndex },
        text: `Stop ${pause.stopIndex} paused, but its values and source were not captured.`,
      })
  const stopOfPause = new Map(opened.map((pause) => [pause.pauseId, pause]))
  for (const capture of captures) {
    if (capture.debuggerSnapshot.frames[0]?.source !== undefined) continue
    const stop = stopOfPause.get(capture.pauseId)?.stopIndex
    reasons.push({
      code: CODES.sourceUnavailable,
      params: { stop: stop ?? 0 },
      text: `The executed source of stop ${stop ?? '?'} was not stored.`,
    })
  }
  // A pause with no pin frame: the live run pins best-effort, and a pin that arrived late or was refused by a budget is not stored.
  const pinnedPauses = new Set(
    entries.flatMap((entry) =>
      entry.type === 'frame' && entry.kind === 'pin' && entry.pauseId
        ? [entry.pauseId]
        : [],
    ),
  )
  for (const pause of opened)
    if (!pinnedPauses.has(pause.pauseId))
      reasons.push({
        code: CODES.pinnedFrameMissing,
        params: { stop: pause.stopIndex },
        text: `The surface frame pinned at stop ${pause.stopIndex} was not recorded.`,
      })
  return reasons
}

/** The reasons of the run's ending and of the filmstrip: no result, the surface ending, missing frames. */
function endingReasons(
  entries: readonly ExtensionHistoryEntry[],
  facts: ExtensionCaptureFacts,
): ExtensionHistorySealReason[] {
  const reasons: ExtensionHistorySealReason[] = []
  // The terminal result a run that ended before its result was read gets is no recorded result: it ends the journal, and the capture still misses the result.
  const hasReadResult = entries.some(
    (entry) =>
      entry.type === 'result' &&
      !(
        entry.outcome === 'unavailable' &&
        entry.cause === EXTENSION_HISTORY_RESULT_UNREAD_CAUSE &&
        entry.before === undefined &&
        entry.after === undefined
      ),
  )
  if (!hasReadResult)
    reasons.push({
      code: CODES.resultMissing,
      params: {},
      text: 'The result of the run was not recorded.',
    })
  const lostSurface = entries.some(
    (entry) => entry.type === 'pause-close' && entry.reason === 'surface-lost',
  )
  if (facts.surfaceEnded || lostSurface)
    reasons.push({
      code: CODES.surfaceEnded,
      params: {},
      text: 'The extension surface closed before the run ended.',
    })
  const hasStreamFrame = entries.some(
    (entry) => entry.type === 'frame' && entry.kind === 'stream',
  )
  if (facts.filmstripIncomplete || !hasStreamFrame)
    reasons.push({
      code: CODES.filmstripMissing,
      params: {},
      text: hasStreamFrame
        ? 'Some frames of the surface were not recorded.'
        : 'No frame of the surface was recorded.',
    })
  return reasons
}

/** The reasons of the writer's own limits: a reached bound and a failed append. */
function writerReasons(
  facts: ExtensionCaptureFacts,
): ExtensionHistorySealReason[] {
  const reasons: ExtensionHistorySealReason[] = []
  if (facts.sizeLimitReached)
    reasons.push({
      code: CODES.sizeLimit,
      params: {},
      text: 'The history reached its size limit; the part recorded before it is kept.',
    })
  if (facts.appendFailure)
    reasons.push({
      code: CODES.appendFailed,
      params: {
        lastEntry: facts.appendFailure.lastEntry,
        cause: facts.appendFailure.cause,
      },
      text: `Recording stopped after ${facts.appendFailure.lastEntry}: ${facts.appendFailure.cause}`,
    })
  return reasons
}

/**
 * Decides which parts of a chrome-extension history are missing, from its journal and the facts only the writer knows; the seal keeps the result and an unsealed (interrupted) history is judged by it again on every read.
 * Detects: declared stops never reached, pauses without a capture or a pinned frame, captures without their source, no result, the surface ending, a bound reached, a failed append and a filmstrip with no frames or dropped ones.
 * @param header - The history's header, whose declared stops say what had to be reached.
 * @param entries - The verified entries.
 * @param facts - What only the writer knows.
 * @returns The reasons in a stable order; empty exactly when the capture is complete.
 * @example evaluateExtensionHistoryCapture(header, entries, {}).map((reason) => reason.code) // => ['EXTENSION_HISTORY_RESULT_MISSING']
 */
export function evaluateExtensionHistoryCapture(
  header: Pick<ExtensionHistoryHeader, 'declaredStops'>,
  entries: readonly ExtensionHistoryEntry[],
  facts: ExtensionCaptureFacts,
): ExtensionHistorySealReason[] {
  return [
    ...stopReasons(header, entries),
    ...endingReasons(entries, facts),
    ...writerReasons(facts),
  ]
}
