import { cutCauseForDisplay } from './cutCauseForDisplay'
import { NODE_LEARNING_SAVE_ACTION } from './describeNodeLearningSave'
import {
  describeNodeServerSealFailure,
  NODE_SERVER_SEAL_FAILURE_PREFIX,
} from './describeNodeServerSealFailure'
import { stripTerminalControls } from './stripTerminalControls'

/** What a server run's Save asks or tells the learner. */
export type NodeServerSaveMessage =
  | { kind: 'nothing-yet' }
  | { kind: 'unavailable'; cause: string }
  | {
      kind: 'question'
      /** The distinct declared stops with at least one recorded hit. */
      reached: number
      declared: number
      responseRecorded: boolean
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
export type NodeServerSaveText = { text: string; actions?: readonly string[] }

/**
 * Words what a server run's Save says: the refusals before there is anything to save, the question that precedes stopping the run, and the one notice after the seal.
 * Called by {@link NodeServerLearningSave}; the cause of an unavailable history is shown as it was worded when it was assigned, cut for display.
 * @param message - The question or notice.
 * @returns Its text and the actions it offers.
 * @example
 * describeNodeServerLearningSave({ kind: 'question', reached: 1, declared: 2, responseRecorded: false }).text
 * // => 'Saving stops the server run (1 of 2 stops recorded; no response recorded yet, so the response will not be saved). Save now?'
 */
export function describeNodeServerLearningSave(
  message: NodeServerSaveMessage,
): NodeServerSaveText {
  switch (message.kind) {
    case 'nothing-yet':
      return {
        text: 'Nothing to save yet: the server run has not sent its request.',
      }
    case 'unavailable':
      return {
        text: `Learning replay unavailable: ${cutCauseForDisplay(message.cause)}`,
      }
    case 'question': {
      const recorded = `${message.reached} of ${message.declared} stops recorded`
      return {
        text: message.responseRecorded
          ? `Saving stops the server run (${recorded}, response recorded). Save now?`
          : `Saving stops the server run (${recorded}; no response recorded yet, so the response will not be saved). Save now?`,
        actions: [NODE_LEARNING_SAVE_ACTION.saveAndStop],
      }
    }
    case 'saved':
      return {
        text: 'Server replay saved.',
        actions: [NODE_LEARNING_SAVE_ACTION.openReplay],
      }
    case 'partial':
      return {
        text: `Server replay saved as partial: ${stripTerminalControls(message.firstReason).replace(/\.$/, '')}${message.moreCount ? ` (+${message.moreCount} more)` : ''}.`,
        actions: [NODE_LEARNING_SAVE_ACTION.openReplay],
      }
    case 'explanation-missing':
      return {
        text: "Server replay saved; the chat's explanation is not saved yet.",
        actions: [NODE_LEARNING_SAVE_ACTION.openReplay],
      }
    case 'failed': {
      const cause = cutCauseForDisplay(message.cause)
      // A failure already worded by the seal ('Learning replay could not be saved: …') is shown as it is, not prefixed twice.
      return {
        text: cause.startsWith(NODE_SERVER_SEAL_FAILURE_PREFIX)
          ? cause
          : describeNodeServerSealFailure(cause),
      }
    }
  }
}
