import type * as vscode from 'vscode'

import { isStackFrameItem } from './isStackFrameItem'

/**
 * Says whether a text editor that becomes active while a stop waits for its keyboard hand-over is the paused file that the stop's own handling opened, where the editor's default (`debug.focusEditorOnBreak: true`) gives that file the keyboard; asked by {@link StudyWorkspace} in its active-editor listener once the hand-over is due ({@link isStopKeyboardHandOverDue}).
 * A stop the editor keeps in the background (read behind the focused frame of another session, or reported with the adapter's `preserveFocusHint`) reaches the front later by the editor's pass of the focus or by the learner's click in the Call Stack view, both preserving the focus, so no file gets the keyboard there (Cycle 0046 finding 602). Both editors open the paused file before they report the stop's frame; the rule does not depend on that order, which no trace showed reversed: while the frame is still to come, the reader's judgement of the stop's note decides; once it came, the judgement that frame got decides.
 *
 * @param state - What the reader knows when the text editor becomes active.
 * @param state.stopSessionId - The debug session of the stop that waits for its hand-over.
 * @param state.unreportedStopShown - Whether the stop's own handling brings the stop to the front now, while the editor has not reported its frame yet; `undefined` once the frame was reported.
 * @param state.activeStackItem - Run and Debug's active stack item now.
 * @param state.frameCameWithStop - Whether that item is a frame the stop's own handling brought.
 * @returns
 * - `true` when the frame is still to come and the stop's own handling brings it now
 * - `true` when the frame came first, is one of the stop's session and came with its stop
 * - `false` otherwise: the stop was kept in the background, or the shown frame is another session's or one the learner selected
 * @example
 * isOpenedByStopsOwnHandling({ stopSessionId: 'learner-node', unreportedStopShown: false, activeStackItem: browserFrame, frameCameWithStop: true }) // => false, the stop is kept behind the browser's frame
 * isOpenedByStopsOwnHandling({ stopSessionId: 'learner-node', unreportedStopShown: undefined, activeStackItem: learnerFrame, frameCameWithStop: true }) // => true, the stop's frame was reported first
 */
export function isOpenedByStopsOwnHandling(state: {
  stopSessionId: string
  unreportedStopShown: boolean | undefined
  activeStackItem: vscode.DebugThread | vscode.DebugStackFrame | undefined
  frameCameWithStop: boolean
}): boolean {
  // The frame is still to come: the stop's note decides, as it will for that frame.
  if (state.unreportedStopShown !== undefined) return state.unreportedStopShown
  // The frame came first: only a frame of the stop's session that came with its stop had its file opened for it.
  return (
    state.frameCameWithStop &&
    isStackFrameItem(state.activeStackItem) &&
    state.activeStackItem.session.id === state.stopSessionId
  )
}
