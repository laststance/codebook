import type * as vscode from 'vscode'

/**
 * Says whether Run and Debug's active stack item names a stack frame, which the editor reports only while a debug session is paused; asked by {@link StudyWorkspace} and {@link BrowserViewport} wherever they act on a pause.
 * VS Code 1.140 and Cursor 3.23 report three states (`MainThreadDebugService` forwards the view model's focus, and the debug service sets that focus to the thread alone 200 ms after the focused session went on running): no item before a session's first stop, a frame while the focused thread is stopped, and that thread without a frame from then until it stops again or the session ends. So "an item is selected" does not mean "paused"; only a frame does. For those 200 ms after a continue the frame of the pause that just ended is still reported.
 * @param item - `vscode.debug.activeStackItem`.
 * @returns `true` for a stack frame (it carries a frame id), `false` for a thread and for no item.
 * @example
 * isStackFrameItem({ session, threadId: 1, frameId: 7 }) // => true, the session is paused
 * isStackFrameItem({ session, threadId: 1 }) // => false, the session runs again
 */
export function isStackFrameItem(
  item: vscode.DebugThread | vscode.DebugStackFrame | undefined,
): item is vscode.DebugStackFrame {
  return item !== undefined && 'frameId' in item
}
