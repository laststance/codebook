import type { NodeServerHistoryRecorder } from '../nodeServerHistoryRecorder'
import type { NodeServerHistorySummary } from '../nodeServerHistoryTypes'

/** What {@link projectNodeServerHistory} reads of a server run's history. */
export type NodeServerHistoryProjectionInput = {
  studyId: string
  recorder: NodeServerHistoryRecorder | undefined
  /** Why no history started, when none did. */
  unavailable: string | undefined
  /** The history resource of this run, `codebook://node-history/<studyId>`. */
  historyUri: string
}

/** The problem a server run's history has, never a failure of the live run: a stable code, what is kept and what to do. */
export type NodeServerHistoryIssue = {
  code: 'HISTORY_UNAVAILABLE' | 'HISTORY_APPEND_FAILED' | 'HISTORY_SEAL_FAILED'
  message: string
  preserved: string
  next: string
}

/** The `nodeServer` fields a server run's history adds to the run resource. The verdicts exist only once the history was sealed and read. */
export type NodeServerHistoryProjection = {
  history: 'recording' | 'unavailable' | 'failed' | 'sealed'
  historyUri?: string
  historyIssue?: NodeServerHistoryIssue
  learningCoverage?: NodeServerHistorySummary['learningCoverage']
  learningMissing?: NodeServerHistorySummary['learningMissing']
  learningMissingCount?: number
  captureMissing?: NodeServerHistorySummary['captureMissing']
  captureMissingCount?: number
  materialRevision?: number
}

/**
 * Projects a server run's history for the run resource: its state, where its journal is read, the verdicts of the sealed history and the issue a history that is unavailable, failing or unsealable reports.
 * Called by {@link StudyService.state} for a node-server run. The verdicts (`learningCoverage`, `learningMissing`, `captureMissing`) exist only once the history was sealed and read: a live run supports no claim of saved learning.
 * @param input - The run's recorder or the cause it has none, and the history's URI.
 * @returns The `nodeServer` fields of the history.
 * @example projectNodeServerHistory({ studyId, recorder: undefined, unavailable: 'storage is full.', historyUri }).history // => 'unavailable'
 */
export function projectNodeServerHistory(
  input: NodeServerHistoryProjectionInput,
): NodeServerHistoryProjection {
  const { recorder } = input
  if (!recorder)
    return {
      history: 'unavailable',
      historyIssue: input.unavailable
        ? {
            code: 'HISTORY_UNAVAILABLE',
            message: input.unavailable,
            preserved:
              'The live run is unaffected; nothing of it is recorded for a replay, so its explanation stays in the chat.',
            next: 'Tell the learner the cause; do not claim a saved replay.',
          }
        : undefined,
    }
  const summary = recorder.sealed?.summary
  const appendFailure = recorder.appendFailure
  const historyIssue: NodeServerHistoryIssue | undefined =
    recorder.status === 'failed'
      ? {
          code: 'HISTORY_SEAL_FAILED',
          message: recorder.failure ?? 'The history could not be sealed.',
          preserved:
            'The run is stopped; what was recorded stays on disk and opens read-only from Saved studies when it can be read.',
          next: 'Do not claim saved learning and do not stop again; tell the learner the save failed.',
        }
      : appendFailure
        ? {
            code: 'HISTORY_APPEND_FAILED',
            message: appendFailure,
            preserved:
              'The live run goes on; the evidence recorded before the failure is kept and the history will seal as a partial replay.',
            next: 'Go on explaining in the chat; claim a saved replay only when the run resource reads learningCoverage complete and an empty captureMissing.',
          }
        : undefined
  return {
    history:
      recorder.status === 'sealed'
        ? 'sealed'
        : recorder.status === 'failed'
          ? 'failed'
          : 'recording',
    historyUri: input.historyUri,
    historyIssue,
    ...(summary
      ? {
          learningCoverage: summary.learningCoverage,
          learningMissing: summary.learningMissing,
          learningMissingCount: summary.learningMissingCount,
          captureMissing: summary.captureMissing,
          captureMissingCount: summary.captureMissingCount,
          materialRevision: summary.materialRevision,
        }
      : {}),
  }
}
