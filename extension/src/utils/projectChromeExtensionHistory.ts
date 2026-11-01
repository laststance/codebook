import type { ChromeExtensionHistoryRecorder } from '../chromeExtensionHistoryRecorder'
import type { ExtensionHistorySummary } from '../chromeExtensionHistoryTypes'
import { EXTENSION_HISTORY_EMPTY_MESSAGE } from '../constants'

/** What {@link projectChromeExtensionHistory} reads of an extension run's history. */
export type ChromeExtensionHistoryProjectionInput = {
  recorder: ChromeExtensionHistoryRecorder | undefined
  /** Why no history started, when none did. */
  unavailable: string | undefined
  /** The history resource of this run, `codebook://node-history/<studyId>`. */
  historyUri: string
}

/** The problem an extension run's history has, never a failure of the live run: a stable code, what is kept and what to do. */
export type ChromeExtensionHistoryIssue = {
  code: 'HISTORY_UNAVAILABLE' | 'HISTORY_APPEND_FAILED' | 'HISTORY_SEAL_FAILED'
  message: string
  preserved: string
  next: string
}

/** The `chromeExtension` fields an extension run's history adds to the run resource. `captureMissing` exists only once the history was sealed and read. */
export type ChromeExtensionHistoryProjection = {
  history: 'recording' | 'unavailable' | 'failed' | 'sealed'
  historyUri?: string
  historyIssue?: ChromeExtensionHistoryIssue
  /** The stable codes of the parts the sealed capture misses, in the seal's order; empty for a complete capture. */
  captureMissing?: string[]
  /** How much of the sealed history the saved learning material explains; `none` until the chat saved some. */
  learningCoverage?: ExtensionHistorySummary['learningCoverage']
  /** Every citation the material still owes (a captured stop by its capture's sequence, or the result). */
  learningMissing?: ExtensionHistorySummary['learningMissing']
  materialRevision?: number
}

/**
 * Projects an extension run's history for the run resource: its state, where its journal is read, the capture codes of the sealed history and the issue a history that is unavailable, failing or unsealable reports.
 * Called by {@link StudyService.state} for a chrome-extension run. The live run is unaffected by every state; a saved replay is claimed only from a sealed history with an empty `captureMissing`.
 * @param input - The run's recorder or the cause it has none, and the history's URI.
 * @returns The `chromeExtension` fields of the history.
 * @example projectChromeExtensionHistory({ recorder: undefined, unavailable: 'storage is full.', historyUri }).history // => 'unavailable'
 */
export function projectChromeExtensionHistory(
  input: ChromeExtensionHistoryProjectionInput,
): ChromeExtensionHistoryProjection {
  const { recorder } = input
  if (!recorder)
    return {
      history: 'unavailable',
      ...(input.unavailable
        ? {
            historyIssue: {
              code: 'HISTORY_UNAVAILABLE' as const,
              message: input.unavailable,
              preserved:
                'The live run is unaffected; nothing of it is recorded for a replay, so its explanation stays in the chat.',
              next: 'Tell the learner the cause; do not claim a saved replay.',
            },
          }
        : {}),
    }
  // A history sealed with no stop was removed with its folder: no URI answers, and a normal "nothing recorded" end is no failure.
  if (recorder.isRemovedAsEmpty)
    return {
      history: 'unavailable',
      historyIssue: {
        code: 'HISTORY_UNAVAILABLE',
        message: EXTENSION_HISTORY_EMPTY_MESSAGE,
        preserved:
          'The run ended before any declared stop paused, so nothing was recorded for a replay.',
        next: 'Tell the learner no stop was reached; do not claim a saved replay.',
      },
    }
  const appendFailure = recorder.appendFailure
  const historyIssue: ChromeExtensionHistoryIssue | undefined =
    recorder.status === 'failed'
      ? {
          code: 'HISTORY_SEAL_FAILED',
          message: recorder.failure ?? 'The history could not be sealed.',
          preserved:
            'The run is stopped; what was recorded stays on disk and opens read-only from Saved studies when it can be read.',
          next: 'Do not claim a saved replay; tell the learner the recording failed.',
        }
      : appendFailure
        ? {
            code: 'HISTORY_APPEND_FAILED',
            message: appendFailure,
            preserved:
              'The live run goes on; the evidence recorded before the failure is kept and the history will seal as a partial replay.',
            next: 'Go on explaining in the chat; claim a saved replay only from a sealed history whose captureMissing is empty.',
          }
        : undefined
  const summary = recorder.sealed?.summary
  return {
    history:
      recorder.status === 'sealed'
        ? 'sealed'
        : recorder.status === 'failed'
          ? 'failed'
          : 'recording',
    historyUri: input.historyUri,
    ...(historyIssue ? { historyIssue } : {}),
    ...(summary
      ? {
          captureMissing: summary.captureMissing.map((reason) => reason.code),
          learningCoverage: summary.learningCoverage,
          learningMissing: summary.learningMissing,
          materialRevision: summary.materialRevision,
        }
      : {}),
  }
}
