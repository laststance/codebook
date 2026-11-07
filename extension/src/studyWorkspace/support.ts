import * as vscode from 'vscode'

import type {
  AGENT_SELECTION_FAILED_PANE_KEYBOARD_MESSAGES,
  CHAT_KEYBOARD_RETURNED_MESSAGES,
} from '../constants'
import { MILLISECONDS_PER_SECOND } from '../constants'
import {
  type NodeTestHistoryIndex,
  type NodeTestHistoryLearningDecision,
} from '../nodeTestHistorySchemas'
import { type ExtensionReplayPresentation } from '../utils/adaptExtensionReplay'
import type { ServerReplayPresentation } from '../utils/adaptServerReplay'
import { type NodeLearningMaterialOfHistory } from '../utils/projectNodeLearningSummary'
import { showPlainNotice } from '../utils/showPlainNotice'

/** What opening a replay reads: its history (a server replay's in its test-shaped view), the sidecars and the server presentation when it is one; see `StudyWorkspace.readNodeHistoryOpening`. */
export type NodeHistoryOpening = {
  history: NodeTestHistoryIndex
  learningDecision?: NodeTestHistoryLearningDecision
  learningMaterial?: NodeLearningMaterialOfHistory
  savedSequence?: number
  positionError?: unknown
  serverReplay?: ServerReplayPresentation
  extensionReplay?: ExtensionReplayPresentation
}

/**
 * Words the phase line of a recorded frame in the Application pane; called by the playback's frame preview and by `StudyWorkspace`'s presentation of a moment, so both name the same time.
 * @param positionMs - The recorded moment in milliseconds.
 * @returns The phase text, for example `Recorded · 1.50 s`.
 * @example recordedFrameLabel(1500) // => 'Recorded · 1.50 s'
 */
export function recordedFrameLabel(positionMs: number): string {
  return `Recorded · ${(positionMs / MILLISECONDS_PER_SECOND).toFixed(2)} s`
}

/** What one close of the tabs an earlier host session left behind did, read from the editor's tab model after the editor answered. */
export interface LeftoverTabClose {
  /** `true` when at least one of the requested tabs is gone. */
  closedAny: boolean
  /** Set when the tab that had focus was closed: the tab the editor activated in its place, `undefined` when its group is empty. */
  closedFocus?: { activatedTab: vscode.Tab | undefined }
  /** Documents of the captured-source tabs that closed; the active text editor may report one of them for a moment longer. */
  closedSourceUris: string[]
  /** `true` when a leftover captured-source tab is still in the window. */
  capturedSourceKept: boolean
  /** `true` when a dead Codebook pane is still in the window. */
  deadPaneKept: boolean
  /** Set when the proof of the groups an earlier window recorded focused one of them before the close and so took the keyboard: the cause its give-back tells, which says whether a group was closed (`StudyWorkspace.retireLeftoverApplicationGroup`); `undefined` when no proof ran, and when it needed no focus. */
  proofTookKeyboard: LeftoverProofKeyboard | undefined
}

/**
 * A pause of the editor's debugger as the chat's record of `StudyWorkspace` notes it, from the stack frame that reported it until the next frame or the pause's end.
 * `openedByDebugger`: the document the debugger had opened with the keyboard when the frame was reported, `undefined` when no text editor was active then.
 * `state`: `'unsettled'` until the reader's first reveal at that pause, `'settling'` while its one return of the keyboard to the chat runs, `'settled'` after it: from then an editor that becomes active is the learner's choice or the next stop's paused file.
 * `returned`: that one return, from the moment it began: it resolves to whether the chat got the keyboard. Kept with the pause, because a second reveal of the same stop (the Application pane's, while the captured source's return runs) asks the same question and must get the same answer.
 */
export interface KeyboardPauseOfRecord {
  openedByDebugger: string | undefined
  state: 'unsettled' | 'settling' | 'settled'
  returned?: Promise<boolean>
}

/** Why the reader gave a chat its keyboard back, which names the sentence the learner is told once ({@link CHAT_KEYBOARD_RETURNED_MESSAGES}, row 648). */
export type ChatKeyboardReturnCause =
  keyof typeof CHAT_KEYBOARD_RETURNED_MESSAGES

/** What a proof of the groups an earlier window recorded owes the tab it took the keyboard from, as the cause of its give-back: `leftoverProof` once it retired a group, `unprovenLeftoverProof` when it focused a group and closed none (`StudyWorkspace.retireLeftoverApplicationGroup`, Cycle 0046 FX-D1-1). */
export type LeftoverProofKeyboard = Extract<
  ChatKeyboardReturnCause,
  'leftoverProof' | 'unprovenLeftoverProof'
>

/** The key of one keyboard notice in {@link keyboardNoticesTold}. */
type KeyboardNotice =
  | 'close'
  | 'pause'
  | 'chosen'
  | 'runEnd'
  | 'preparation'
  | 'agentSelection'
  | 'summaryBehindChat'
  | 'learnerReturn'
  | 'readEnded'
  | `chatReturned:${ChatKeyboardReturnCause}`
  | 'agentSelectionApplication'
  | `agentSelectionFailed:${keyof typeof AGENT_SELECTION_FAILED_PANE_KEYBOARD_MESSAGES}`

/**
 * The keyboard notices the reader told in this editor session, each of them told once: `'close'` is {@link STUDY_CLOSE_KEYBOARD_MESSAGE}, `'pause'` is {@link SOURCE_TOOK_PAUSED_FOCUS_MESSAGE}, `'chosen'` is {@link PANE_TOOK_CHOSEN_EDITOR_FOCUS_MESSAGE}, `'runEnd'` is {@link RUN_CLOSED_PANE_KEYBOARD_MESSAGE}, `'preparation'` is {@link APPLICATION_GROUP_TOOK_KEYBOARD_MESSAGE} or {@link APPLICATION_GROUP_MAY_HAVE_KEYBOARD_MESSAGE}, whichever came first, `'agentSelection'` is {@link AGENT_SELECTION_TOOK_KEYBOARD_MESSAGE}, `'summaryBehindChat'` is {@link LEARNING_SUMMARY_KEPT_BEHIND_CHAT_MESSAGE}, `'learnerReturn'` is {@link LEARNER_RETURN_CLOSED_STUDY_PANE_MESSAGE}, `'readEnded'` is {@link READ_ENDED_FOR_AGENT_KEYBOARD_MESSAGE}, the `chatReturned:` keys are one key per entry of {@link CHAT_KEYBOARD_RETURNED_MESSAGES}, named by its cause (its `pause` entry is {@link CHAT_EDITOR_TAB_KEYBOARD_RETURNED_MESSAGE}), the `agentSelectionFailed:` keys are one key per entry of {@link AGENT_SELECTION_FAILED_PANE_KEYBOARD_MESSAGES}, named by its place, `'agentSelectionApplication'` is either sentence of {@link AGENT_SELECTION_APPLICATION_KEYBOARD_MESSAGES}, whichever came first.
 * Kept with the module and not with a `StudyWorkspace`: the extension disposes its reader and makes a new one when the workspace folders change, and the extension host loads this module once, so the marks live as long as the host does.
 * @example
 * tellKeyboardNoticeOnce('close', STUDY_CLOSE_KEYBOARD_MESSAGE) // told now; a second call tells nothing
 */
const keyboardNoticesTold = new Set<KeyboardNotice>()

/**
 * Tells the learner one keyboard notice at most once in the editor session ({@link keyboardNoticesTold}); the one body of every tell-once keyboard notice of `StudyWorkspace`, called by its `tell…` methods and by `StudyWorkspace.endReadForAdmission` (Cycle 0046 S1).
 * @param notice - The notice's key.
 * @param sentence - The sentence shown when the notice was not told yet in this session.
 * @returns
 * - `true` when the notice was told now.
 * - `false` when it was told earlier in the session; nothing is shown then.
 * @example
 * tellKeyboardNoticeOnce('close', STUDY_CLOSE_KEYBOARD_MESSAGE) // => true, and the sentence is shown
 * tellKeyboardNoticeOnce('close', STUDY_CLOSE_KEYBOARD_MESSAGE) // => false, and nothing is shown
 */
export function tellKeyboardNoticeOnce(
  notice: KeyboardNotice,
  sentence: string,
): boolean {
  if (keyboardNoticesTold.has(notice)) return false
  keyboardNoticesTold.add(notice)
  void showPlainNotice(vscode.window, 'information', sentence)
  return true
}

/** The view types of the Application and the Study explanation: the own panes whose focus report an entry takes for no change of the learner's (the Repository Wiki is not among them). */
export const STUDY_PANE_KINDS = [
  'codebook.scopedBrowser',
  'codebook.studyContext',
] as const
