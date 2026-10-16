import type * as vscode from 'vscode'

import { STUDY_SOURCE_SCHEME } from '../../constants'
import type { StopKeyboardHandOver } from '../stopKeyboardHandOver'

import { isStackFrameItem } from './isStackFrameItem'

/**
 * Names the text editor that gets a stop's keyboard hand-over when the editor reports that stop's frame; asked by {@link StudyWorkspace} for a frame that came with a stop whose hand-over is due.
 * Both editors report a stop's frame after they opened its paused file (`focusStackFrame` awaits `openInEditor` before it sets the focus, VS Code 1.140 and Cursor 3.23), so the active text editor is the paused file then, whether the opening made it active or found it active already, as at a step within the file (Cycle 0046 finding 603). The editor's default (`debug.focusEditorOnBreak: true`) focuses that editor in both cases. Nothing later in the pause is the paused file.
 *
 * @param state - What the reader knows when the editor reports the frame.
 * @param state.activeStackItem - Run and Debug's active stack item: the stop's frame.
 * @param state.activeTextEditor - The active text editor.
 * @param state.handOver - The reader's hand-over record, which says whether that frame's stop still waits for its hand-over.
 * @returns
 * - The active text editor, when the item is a frame whose stop waits for its hand-over and that editor shows no captured source
 * - `undefined` for a thread or no item, for a stop that was handed over already or does not wait for one, without a text editor, and for the captured source, which is the reader's own document
 * @example
 * pausedEditorOfStop({ activeStackItem: learnerFrame, activeTextEditor: actionsEditor, handOver }) // => actionsEditor, the step's stop in actions.ts waits for its hand-over
 * pausedEditorOfStop({ activeStackItem: learnerFrame, activeTextEditor: capturedSourceEditor, handOver }) // => undefined
 */
export function pausedEditorOfStop(state: {
  activeStackItem: vscode.DebugThread | vscode.DebugStackFrame | undefined
  activeTextEditor: vscode.TextEditor | undefined
  handOver: Pick<StopKeyboardHandOver, 'isArmedFor'>
}): vscode.TextEditor | undefined {
  const { activeStackItem, activeTextEditor } = state
  // Only the frame of a stop that still waits for its hand-over hands over: a thread is no stop, and a done stop had its hand-over.
  if (
    !isStackFrameItem(activeStackItem) ||
    !state.handOver.isArmedFor(activeStackItem.session.id)
  )
    return undefined
  // The captured source is the reader's own document, never the paused file.
  return activeTextEditor?.document.uri.scheme === STUDY_SOURCE_SCHEME
    ? undefined
    : activeTextEditor
}
