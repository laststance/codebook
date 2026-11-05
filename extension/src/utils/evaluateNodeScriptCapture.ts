import { NODE_SCRIPT_HISTORY_REASON_CODES as CODES } from '../constants'
import type {
  NodeScriptEndEntry,
  NodeScriptHistoryEntry,
  NodeScriptHistoryHeader,
} from '../nodeScriptHistorySchemas'
import type { NodeServerSealReason } from '../nodeServerHistorySchemas'

import {
  capturedStopReasons,
  closingReasons,
  stopNotReachedReason,
  unreachedStopReasons,
  type NodeServerCaptureFacts,
} from './evaluateNodeServerCapture'

/**
 * Words how a script ended when its end is a gap in the capture: stopped by the learner, ended at a limit, or with an exit code that could not be read.
 * @param end - The journal's `end` entry.
 * @returns The reason, or `undefined` when the script ended by itself or by a signal and its exit is known (a nonzero exit is an observed result, never a gap).
 * @example endReason({ kind: 'stopped', … })?.code // => 'SCRIPT_HISTORY_RUN_STOPPED'
 */
function endReason(end: NodeScriptEndEntry): NodeServerSealReason | undefined {
  if (end.kind === 'stopped')
    return {
      code: CODES.runStopped,
      params: {},
      text: 'The run was stopped before the script ended on its own.',
    }
  if (end.kind === 'limit')
    return {
      code: CODES.runLimit,
      params: { limit: end.limit ?? 'unknown' },
      text: `The run was ended at its ${end.limit ?? 'unknown'} limit before the script ended on its own.`,
    }
  if (end.exitUnknown !== undefined)
    return {
      code: CODES.exitUnknown,
      params: { reason: end.exitUnknown },
      text: `The script's exit code could not be read: ${end.exitUnknown}.`,
    }
  return undefined
}

/**
 * Decides what a node-script history lacks, as structured reasons: the end that was a gap, declared stops never reached or not observed, unpresentable snapshots, unstored sources, unreadable values and the writer's bounds; the one evaluator behind the seal, the library, Save and the resources.
 * A declared stop the run did not reach before the capture budget was spent is not observed (its breakpoints were retired), never "not reached". A nonzero exit is a complete capture; an exit code is never a reason.
 * @param header - The history's header (the declared stops).
 * @param entries - The journal's entries as written.
 * @param facts - What only the writer knows when it seals.
 * @returns Every reason that holds, empty for a complete capture.
 * @example evaluateNodeScriptCapture(header, entries, {}) // => []
 */
export function evaluateNodeScriptCapture(
  header: Pick<NodeScriptHistoryHeader, 'declaredStops'>,
  entries: readonly NodeScriptHistoryEntry[],
  facts: NodeServerCaptureFacts = {},
): NodeServerSealReason[] {
  const end = entries.find((entry) => entry.type === 'end')
  const stops = entries.filter((entry) => entry.type === 'stop')
  const notObserved = new Set(end?.stopsNotObserved)
  const endGap = end
    ? endReason(end)
    : facts.interrupted === true && !facts.appendFailure
      ? {
          code: CODES.endMissing,
          params: {},
          text: 'The recording ended before the script ended.',
        }
      : undefined
  return [
    ...(endGap ? [endGap] : []),
    ...unreachedStopReasons(header, stops, (index) =>
      notObserved.has(index)
        ? {
            code: CODES.stopNotObserved,
            params: { stop: index + 1 },
            text: `Declared stop ${index + 1} was not observed: the capture budget was used up before the script reached it.`,
          }
        : stopNotReachedReason(index),
    ),
    ...capturedStopReasons(
      stops,
      entries.filter((entry) => entry.type === 'source'),
    ),
    ...closingReasons(
      {
        ...facts,
        captureBudgetExhausted:
          facts.captureBudgetExhausted === true ||
          end?.captureBudgetExhausted === true,
      },
      entries.some((entry) => entry.type === 'output-truncated'),
    ),
  ]
}
