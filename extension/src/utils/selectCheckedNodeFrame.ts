import type { DebugProtocol } from '@vscode/debugprotocol';

type CheckedNodeFrame =
  | { status: 'matched'; frame: DebugProtocol.StackFrame; observedFrame: DebugProtocol.StackFrame }
  | { status: 'wrong-position'; observedFrame: DebugProtocol.StackFrame }
  | { status: 'unrelated'; observedFrame?: DebugProtocol.StackFrame };

/**
 * Classifies each DAP stack trace for the owned Node run so a moved breakpoint fails promptly.
 * Only the paused (top) frame identifies the stop: the replay snapshot binds the verified source to that frame, so a declared call site deeper in the stack is a different pause.
 * @param frames - Frames from the current paused thread, top frame first.
 * @param sourcePath - Exact declared source file.
 * @param line - Declared one-based source line.
 * @param column - Declared one-based source column.
 * @param reason - DAP stopped-event reason for this thread.
 * @returns
 * - `matched` when the top frame is exactly the declared position
 * - `wrong-position` when a breakpoint paused the top frame elsewhere in the declared source
 * - `unrelated` for any other pause, with the first declared-source frame (if any) for diagnostics
 * @example selectCheckedNodeFrame([frame], '/project/data.ts', 224, 17, 'breakpoint').status // 'matched'
 */
export function selectCheckedNodeFrame(
  frames: DebugProtocol.StackFrame[], sourcePath: string, line: number, column: number, reason: string,
): CheckedNodeFrame {
  const pausedFrame = frames[0];
  const pausedInDeclaredSource = pausedFrame?.source?.path === sourcePath;
  if (pausedFrame && pausedInDeclaredSource && pausedFrame.line === line && pausedFrame.column === column) return { status: 'matched', frame: pausedFrame, observedFrame: pausedFrame };
  if (pausedFrame && pausedInDeclaredSource && reason === 'breakpoint') return { status: 'wrong-position', observedFrame: pausedFrame };
  return { status: 'unrelated', observedFrame: frames.find(frame => frame.source?.path === sourcePath) };
}
