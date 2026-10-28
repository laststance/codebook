import { NODE_SERVER_HISTORY_REASON_CODES } from '../constants'
import type { HistoryIndexOf } from '../historyStorageDescriptor'
import type {
  NodeServerHistorySummary,
  NodeServerHistoryTypes,
} from '../nodeServerHistoryTypes'

import {
  adaptServerReplay,
  type ServerReplayPresentation,
} from './adaptServerReplay'
import { buildServerReplayModel } from './buildServerReplayModel'
import { wordNodeCaptureReason } from './wordNodeCaptureReason'

/** Words a stored capture reason for a server replay's surfaces, by the one rule a test replay's reasons follow (controls and line breaks gone, one bounded line). */
function wordServerCaptureReason(reason: string): string {
  return wordNodeCaptureReason(reason, 'node-server') ?? ''
}

/**
 * Lists every reason a server history's capture is partial or interrupted, in the words of its replay: a seal's reasons uncut, else the reason the store gave an unsealed history.
 * @param history - The verified history.
 * @returns The reasons; empty for a complete capture.
 * @example serverCaptureReasons(history) // => ['No response was recorded: the history ended before the server answered.']
 */
function serverCaptureReasons(
  history: Pick<HistoryIndexOf<NodeServerHistoryTypes>, 'seal' | 'reason'>,
  summary: NodeServerHistorySummary | undefined,
): string[] {
  if (history.seal)
    return history.seal.reasons.map((reason) =>
      wordServerCaptureReason(reason.text),
    )
  // An unsealed history carries the reason the store gave it and what the shared evaluator found in its verified prefix, such as a declared stop never reached.
  return [
    ...(history.reason ? [wordServerCaptureReason(history.reason)] : []),
    ...(summary?.captureMissing ?? []).map((reason) =>
      wordServerCaptureReason(reason.text),
    ),
  ]
}

/** The codes of the seal reasons that say the history was recorded with no response. */
const NO_RESPONSE_REASON_CODES: ReadonlySet<string> = new Set([
  NODE_SERVER_HISTORY_REASON_CODES.noResponseRequestFailed,
  NODE_SERVER_HISTORY_REASON_CODES.noResponseStopped,
  NODE_SERVER_HISTORY_REASON_CODES.noResponseExited,
  NODE_SERVER_HISTORY_REASON_CODES.noResponseRunFailed,
])

/**
 * Picks the no-response reason of a sealed history by its code, so a stop or write reason is never worded as why no response came.
 * @param history - The verified history.
 * @returns The reason in the replay's words; `undefined` for an unsealed history or one whose seal holds no no-response reason.
 * @example noResponseReasonOf(history) // => 'No response was recorded: the run was stopped before the server answered.'
 */
function noResponseReasonOf(
  history: Pick<HistoryIndexOf<NodeServerHistoryTypes>, 'seal'>,
): string | undefined {
  const reason = history.seal?.reasons.find((candidate) =>
    NO_RESPONSE_REASON_CODES.has(candidate.code),
  )
  return reason ? wordServerCaptureReason(reason.text) : undefined
}

/**
 * Reads a verified server history once into what the Study workspace presents: the replay model with its three verdicts, its test-shaped view for the shared selection path, and its capture reasons.
 * Called by the Study workspace when it opens a server replay.
 * @param history - The history the server store read, its source entries intact.
 * @param summary - The history's summary, for its learning verdict; absent when it could not be read.
 * @returns The presentation.
 * @example const replay = presentServerHistory(await store.read(studyId), await store.summarize(studyId))
 */
export function presentServerHistory(
  history: HistoryIndexOf<NodeServerHistoryTypes>,
  summary: NodeServerHistorySummary | undefined,
): ServerReplayPresentation {
  const model = buildServerReplayModel(history, {
    saved: history.seal !== undefined,
    captureComplete: history.seal?.capture === 'complete',
    learningCoverage: summary?.learningCoverage ?? 'none',
  })
  return adaptServerReplay(
    model,
    serverCaptureReasons(history, summary),
    noResponseReasonOf(history),
  )
}
