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
import { stripTerminalControls } from './stripTerminalControls'

/**
 * Words a stored capture reason for a server replay's surfaces: free of terminal controls and line breaks, with the storage layer's name for the history replaced by the learner's word for it.
 * @param reason - A reason as the store wrote it.
 * @returns The reason as the replay reads it.
 * @example wordServerCaptureReason('Interrupted Node server history after its verified prefix: EIO') // => 'Interrupted server replay after its verified prefix: EIO'
 */
function wordServerCaptureReason(reason: string): string {
  return stripTerminalControls(reason)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\bNode server histor(y|ies)\b/gi, (_match, ending: string) =>
      ending === 'y' ? 'server replay' : 'server replays',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (first) => first.toUpperCase())
}

/**
 * Lists every reason a server history's capture is partial or interrupted, in the words of its replay: a seal's reasons uncut, else the reason the store gave an unsealed history.
 * @param history - The verified history.
 * @returns The reasons; empty for a complete capture.
 * @example serverCaptureReasons(history) // => ['No response was recorded: the history ended before the server answered.']
 */
function serverCaptureReasons(
  history: Pick<HistoryIndexOf<NodeServerHistoryTypes>, 'seal' | 'reason'>,
): string[] {
  if (history.seal)
    return history.seal.reasons.map((reason) =>
      wordServerCaptureReason(reason.text),
    )
  return history.reason ? [wordServerCaptureReason(history.reason)] : []
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
  return adaptServerReplay(model, serverCaptureReasons(history))
}
