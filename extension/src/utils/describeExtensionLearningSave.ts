import { cutCauseForDisplay } from './cutCauseForDisplay'
import { NODE_LEARNING_SAVE_ACTION } from './describeNodeLearningSave'
import {
  describeNodeServerSealFailure,
  NODE_SERVER_SEAL_FAILURE_PREFIX,
} from './describeNodeServerSealFailure'
import { describeReplayOutcome } from './describeReplayOutcome'
import { stripTerminalControls } from './stripTerminalControls'

/** What an extension run's Save asks or tells the learner. */
export type ExtensionSaveMessage =
  | { kind: 'nothing-recorded' }
  | { kind: 'unavailable'; cause: string }
  | {
      kind: 'question'
      /** The distinct declared stops with at least one recorded pause. */
      reached: number
      declared: number
      resultRecorded: boolean
    }
  | { kind: 'saved' }
  | {
      kind: 'partial'
      /** The first reason the capture is partial, and how many more there are. */
      firstReason: string
      moreCount: number
    }
  | { kind: 'explanation-missing' }
  | {
      /** The history failed or its sealed summary could not be read or verified; `cause` is the reason, without private paths. */
      kind: 'failed'
      cause: string
    }

/** The words of one message and the actions it offers; the question's Cancel is the modal dialog's own. */
export type ExtensionSaveText = { text: string; actions?: readonly string[] }

/** Where an extension run's learning replay stands, beside the run's own state. */
export type ExtensionLearningStatus =
  | { kind: 'recording'; reached: number; declared: number }
  | { kind: 'finished' }
  /** A write failed while the run lives: nothing more is recorded, so the replay will be partial; `cause` is the raw reason. */
  | { kind: 'append-failed'; cause: string }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'partial' }
  /** No history started: storage unavailable, full or refused. */
  | { kind: 'unavailable'; cause: string }
  /** The history could not be written or sealed: the cause is the whole sentence. */
  | { kind: 'failed'; cause: string }

/**
 * Words what an extension run's Save says: the refusal before there is anything to save, the question that precedes stopping the run, and the one notice after the seal.
 * Called by {@link ChromeExtensionLearningSave}; the cause of an unavailable history is shown as it was worded when it was assigned, cut for display.
 * @param message - The question or notice.
 * @returns Its text and the actions it offers.
 * @example describeExtensionLearningSave({ kind: 'saved' }).text // => 'Extension replay saved.'
 */
export function describeExtensionLearningSave(
  message: ExtensionSaveMessage,
): ExtensionSaveText {
  switch (message.kind) {
    case 'nothing-recorded':
      return {
        text: 'Nothing to save: the extension run recorded no pause or result.',
      }
    case 'unavailable':
      return {
        text: `Learning replay unavailable: ${cutCauseForDisplay(message.cause)}`,
      }
    case 'question': {
      const recorded = `${message.reached} of ${message.declared} stops recorded`
      return {
        text: message.resultRecorded
          ? `Saving stops the extension run (${recorded}, result recorded). Save now?`
          : `Saving stops the extension run (${recorded}; no result recorded yet, so the result will not be saved). Save now?`,
        actions: [NODE_LEARNING_SAVE_ACTION.saveAndStop],
      }
    }
    case 'saved':
    case 'partial':
    case 'explanation-missing':
      return describeReplayOutcome('Extension', message)
    case 'failed': {
      const cause = cutCauseForDisplay(stripTerminalControls(message.cause))
      // A failure already worded by the seal is shown as it is, not prefixed twice.
      return {
        text: cause.startsWith(NODE_SERVER_SEAL_FAILURE_PREFIX)
          ? cause
          : describeNodeServerSealFailure(cause),
      }
    }
  }
}

/**
 * Words the status bar item of an extension run: the learning replay's state beside where the run stands.
 * Called by {@link ChromeExtensionLearningSave.item} for the current extension run.
 * @param runText - The run's own status text (its phase).
 * @param learning - Where the run's learning replay stands.
 * @returns The item's `text` and `tooltip`.
 * @example describeExtensionStatus('Paused at stop 1 of 2', { kind: 'recording', reached: 1, declared: 2 }).text // => '$(record) Recording explanation · Paused at stop 1 of 2 · Save learning replay'
 */
export function describeExtensionStatus(
  runText: string,
  learning: ExtensionLearningStatus,
): { text: string; tooltip: string } {
  switch (learning.kind) {
    case 'recording':
      return {
        text: `$(record) Recording explanation · ${runText} · Save learning replay`,
        tooltip: `Save learning replay stops this extension run and saves its pauses, executed source, debugger values, frames and result (${learning.reached} of ${learning.declared} stops recorded).`,
      }
    case 'append-failed':
      return {
        text: `$(warning) ${runText} · Learning replay will be partial: ${cutCauseForDisplay(stripTerminalControls(learning.cause))}`,
        tooltip:
          'Recording stopped after a write failed. Save still stops the run and saves what was recorded before the failure.',
      }
    case 'finished':
      return {
        text: '$(save) Recording finished · Save learning replay',
        tooltip:
          "Save learning replay saves the sealed extension history with the chat's learning material.",
      }
    case 'saving':
      return {
        text: '$(sync~spin) Saving learning…',
        tooltip: 'Codebook is sealing the extension history.',
      }
    case 'saved':
      return {
        text: '$(check) Learning saved · Open replay',
        tooltip:
          'Saved: the extension history is complete and the chat explained it. Opens the extension replay.',
      }
    case 'partial':
      return {
        text: '$(warning) Learning partially saved · Open replay',
        tooltip:
          'Saved what was recorded. Open replay to inspect it and what is missing.',
      }
    case 'unavailable':
      return {
        text: `${runText} · Learning replay unavailable: ${cutCauseForDisplay(learning.cause)}`,
        tooltip: `This extension run is not recorded for a learning replay: ${cutCauseForDisplay(learning.cause)}`,
      }
    case 'failed':
      return {
        text: `${runText} · ${cutCauseForDisplay(learning.cause)}`,
        tooltip: `${cutCauseForDisplay(learning.cause)} The run is unaffected; what was recorded opens read-only if it can be read.`,
      }
  }
}
