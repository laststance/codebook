import {
  NODE_SERVER_HISTORY_REASON_CODES as CODES,
  NODE_SERVER_REQUEST_CAPTURE_LIMIT,
} from '../constants'
import type {
  NodeServerHistoryEntry,
  NodeServerHistoryHeader,
  NodeServerSealReason,
  NodeServerSourceEntry,
  NodeServerStopEntry,
} from '../nodeServerHistorySchemas'

import { isPresentableServerStop } from './isPresentableServerStop'

/** What only the writer knows when it seals: the failed append, the bounds it reached and the run's capture budget. */
export type NodeServerCaptureFacts = {
  /** The first failed append: the entry before the gap and the failure's cause (already without private paths). */
  appendFailure?: { lastEntry: string; cause: string }
  sizeLimitReached?: boolean
  captureBudgetExhausted?: boolean
}

/**
 * Words an entry the way a reason names the last good entry of a broken history.
 * @param entry - The entry.
 * @returns `stop 2 (entry 14)`, `the request (entry 3)`, `the response (entry 9)` or `output (entry 5)`.
 * @example describeLastNodeServerEntry(stopEntry) // => 'stop 2 (entry 14)'
 */
export function describeLastNodeServerEntry(
  entry: NodeServerHistoryEntry,
): string {
  const where = `(entry ${entry.sequence})`
  if (entry.type === 'stop')
    return `stop ${entry.declaredStopIndex + 1} ${where}`
  if (entry.type === 'request') return `the request ${where}`
  if (entry.type === 'response') return `the response ${where}`
  return `${entry.type} ${where}`
}

/** Words how a closed server exited: `exit code 1` or `signal SIGTERM`. */
function describeExit(
  end: Extract<NodeServerHistoryEntry, { type: 'end' }>,
): string {
  if (end.signal) return `signal ${end.signal}`
  return end.exitCode === undefined || end.exitCode === null
    ? 'exit code unknown'
    : `exit code ${end.exitCode}`
}

/** The "No response was recorded" reason of a history with no terminal entry, or the request-failure one. */
function noResponseReason(
  entries: readonly NodeServerHistoryEntry[],
): NodeServerSealReason | undefined {
  if (entries.some((entry) => entry.type === 'response')) return undefined
  const failed = entries.find((entry) => entry.type === 'request-failed')
  if (failed)
    return {
      code: CODES.noResponseRequestFailed,
      params: { code: failed.code },
      text: `No response was recorded: the request failed with ${failed.code}.`,
    }
  const end = entries.find((entry) => entry.type === 'end')
  // A history with no `end` (an append failed) says why in the append reason instead.
  if (!end) return undefined
  if (end.reason === 'stopped')
    return {
      code: CODES.noResponseStopped,
      params: {},
      text: 'No response was recorded: the run was stopped before the server answered.',
    }
  if (end.reason === 'closed')
    return {
      code: CODES.noResponseExited,
      params: { exit: describeExit(end) },
      text: `No response was recorded: the server exited (${describeExit(end)}) before it answered.`,
    }
  const failure = end.code ?? 'an unknown failure'
  return {
    code: CODES.noResponseRunFailed,
    params: { code: failure },
    text: `No response was recorded: the run failed with ${failure}.`,
  }
}

/** The reasons of the stops a history holds: unreached declared stops, unpresentable snapshots, executed sources that were not stored and unreadable values. */
function stopReasons(
  header: Pick<NodeServerHistoryHeader, 'declaredStops'>,
  stops: readonly NodeServerStopEntry[],
  sources: readonly NodeServerSourceEntry[],
): NodeServerSealReason[] {
  const reasons: NodeServerSealReason[] = []
  const reached = new Set(stops.map((stop) => stop.declaredStopIndex))
  header.declaredStops.forEach((_declared, index) => {
    if (!reached.has(index))
      reasons.push({
        code: CODES.stopNotReached,
        params: { stop: index + 1 },
        text: `Declared stop ${index + 1} was not reached.`,
      })
  })
  const reportedSnapshots = new Set<number>()
  const reportedSources = new Set<number>()
  for (const stop of stops) {
    const number = stop.declaredStopIndex + 1
    if (
      !isPresentableServerStop(stop) &&
      !reportedSnapshots.has(stop.declaredStopIndex)
    ) {
      reportedSnapshots.add(stop.declaredStopIndex)
      reasons.push({
        code: CODES.snapshotMissing,
        params: { stop: number, hit: stop.hit },
        text: `The debugger state at stop ${number} was not recorded.`,
      })
    }
    // The replay must show the source that executed: a stop whose top-frame text was not stored is not a complete capture.
    const unstored = sources.find(
      (source) =>
        source.path === stop.source.path &&
        source.hash === stop.source.hash &&
        source.sourceUnavailable !== undefined,
    )
    if (
      unstored?.sourceUnavailable &&
      !reportedSources.has(stop.declaredStopIndex)
    ) {
      reportedSources.add(stop.declaredStopIndex)
      reasons.push({
        code: CODES.sourceUnavailable,
        params: { stop: number, reason: unstored.sourceUnavailable },
        text: `The source at stop ${number} was not recorded (${unstored.sourceUnavailable}).`,
      })
    }
    for (const value of stop.unavailable)
      reasons.push({
        code: CODES.valueUnavailable,
        params: { path: value.path, stop: number, hit: stop.hit },
        text: `${value.path} at stop ${number} could not be read.`,
      })
  }
  return reasons
}

/**
 * Decides what a node-server history lacks, as structured reasons in the plan's table order; the one evaluator behind the seal, the live cache, the library, Save and MCP, so capture completeness is never computed twice.
 * A 4xx or 5xx response is a complete capture; a status is never a reason. The list is uncut: answers cap it with {@link capMissingList}.
 * @param header - The history's header (the declared stops).
 * @param entries - The journal's entries as written (stored snapshots, top-frame text by hash).
 * @param facts - What only the writer knows when it seals.
 * @returns Every reason that holds, empty for a complete capture.
 * @example evaluateNodeServerCapture(header, entries, {}) // => []
 */
export function evaluateNodeServerCapture(
  header: Pick<NodeServerHistoryHeader, 'declaredStops'>,
  entries: readonly NodeServerHistoryEntry[],
  facts: NodeServerCaptureFacts = {},
): NodeServerSealReason[] {
  const reasons: NodeServerSealReason[] = []
  const noResponse = noResponseReason(entries)
  if (noResponse) reasons.push(noResponse)
  reasons.push(
    ...stopReasons(
      header,
      entries.filter((entry) => entry.type === 'stop'),
      entries.filter((entry) => entry.type === 'source'),
    ),
  )
  if (facts.appendFailure)
    reasons.push({
      code: CODES.appendFailed,
      params: facts.appendFailure,
      text: `The history could not be written after ${facts.appendFailure.lastEntry}: ${facts.appendFailure.cause}.`,
    })
  if (facts.sizeLimitReached)
    reasons.push({
      code: CODES.sizeLimit,
      params: {},
      text: 'The history reached its size limit; later events were not recorded.',
    })
  if (facts.captureBudgetExhausted)
    reasons.push({
      code: CODES.captureBudgetExhausted,
      params: { hits: NODE_SERVER_REQUEST_CAPTURE_LIMIT },
      text: `The capture budget (${NODE_SERVER_REQUEST_CAPTURE_LIMIT} stop hits) was used up; later hits were not recorded.`,
    })
  if (entries.some((entry) => entry.type === 'output-truncated'))
    reasons.push({
      code: CODES.outputTruncated,
      params: {},
      text: 'The history cut its output at the output budget; later output was not recorded.',
    })
  return reasons
}
