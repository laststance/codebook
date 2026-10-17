import type * as vscode from 'vscode'

import { STUDY_SOURCE_SCHEME } from '../../constants'
import type { StopKeyboardHandOver } from '../stopKeyboardHandOver'

import { isStackFrameItem } from './isStackFrameItem'

/**
 * Names the text editor that gets a stop's keyboard hand-over when the editor reports that stop's frame, with the session of that stop; asked by {@link StudyWorkspace} for a frame that came with a stop whose hand-over is due.
 * Only the frame the editor's own stop handling focuses counts: the first frame of the stopped thread that its rule lets it focus, as the adapter answered the editor's `stackTrace` request ({@link StopKeyboardHandOver.pausedFrameIdOf}). For a stop where no frame qualifies (js-debug's pause in Node's own code, all frames deemphasized by `skipFiles`) the editor focuses the thread alone and opens no file, and a frame the learner selects later is none of the stop's. Both editors report that frame after they opened its paused file (`focusStackFrame` awaits `openInEditor` before it sets the focus, VS Code 1.140 and Cursor 3.23), so the active text editor shows that frame's source then, whether the opening made it active or found it active already, as at a step within the file (Cycle 0046 finding 603). The editor's default (`debug.focusEditorOnBreak: true`) focuses that editor in both cases.
 *
 * @param state - What the reader knows when the editor reports the frame.
 * @param state.activeStackItem - Run and Debug's active stack item: the reported frame.
 * @param state.activeTextEditor - The active text editor.
 * @param state.handOver - The reader's hand-over record, which names the frame the editor focuses for a stop that still waits for its hand-over.
 * @returns
 * - The frame's session and the active text editor, when the item is the frame the editor focuses for a stop that waits for its hand-over and that editor shows no captured source
 * - `undefined` for a thread or no item, for any other frame, for a stop that was handed over already or does not wait for one, without a text editor, and for the captured source, which is the reader's own document
 * @example
 * pausedEditorOfStop({ activeStackItem: { session, threadId: 1, frameId: 1000 }, activeTextEditor: actionsEditor, handOver }) // => { sessionId: 'learner-node', editor: actionsEditor } when 1000 is the frame the editor focuses for learner-node's stop
 * pausedEditorOfStop({ activeStackItem: { session, threadId: 1, frameId: 1001 }, activeTextEditor: actionsEditor, handOver }) // => undefined, a frame the learner selected
 */
export function pausedEditorOfStop(state: {
  activeStackItem: vscode.DebugThread | vscode.DebugStackFrame | undefined
  activeTextEditor: vscode.TextEditor | undefined
  handOver: Pick<StopKeyboardHandOver, 'pausedFrameIdOf'>
}): { sessionId: string; editor: vscode.TextEditor } | undefined {
  const { activeStackItem, activeTextEditor } = state
  // Only the frame the editor focuses for a stop that still waits hands over: a thread is no stop, another frame was selected, and a done stop had its hand-over.
  if (
    !isStackFrameItem(activeStackItem) ||
    state.handOver.pausedFrameIdOf(activeStackItem.session.id) !==
      activeStackItem.frameId
  )
    return undefined
  // The captured source is the reader's own document, never the paused file.
  if (
    !activeTextEditor ||
    activeTextEditor.document.uri.scheme === STUDY_SOURCE_SCHEME
  )
    return undefined
  return { sessionId: activeStackItem.session.id, editor: activeTextEditor }
}
