import type { DebugProtocol } from '@vscode/debugprotocol';

type CheckedNodeFrame =
  | { status: 'matched'; frame: DebugProtocol.StackFrame; observedFrame: DebugProtocol.StackFrame }
  | { status: 'wrong-position'; observedFrame: DebugProtocol.StackFrame }
  | { status: 'unrelated'; observedFrame?: DebugProtocol.StackFrame };

/**
 * Classifies each DAP stack trace for the owned Node run so a moved breakpoint fails promptly.
 * @param frames - Frames from the current paused thread.
 * @param sourcePath - Exact declared source file.
 * @param line - Declared one-based source line.
 * @param column - Declared one-based source column.
 * @param reason - DAP stopped-event reason for this thread.
 * @returns An exact frame, a wrong-position breakpoint, or an unrelated pause.
 * @example selectCheckedNodeFrame([frame], '/project/data.ts', 224, 17, 'breakpoint').status // 'matched'
 */
export function selectCheckedNodeFrame(
  frames: DebugProtocol.StackFrame[], sourcePath: string, line: number, column: number, reason: string,
): CheckedNodeFrame {
  const exactFrame = frames.find(frame => frame.source?.path === sourcePath && frame.line === line && frame.column === column);
  if (exactFrame) return { status: 'matched', frame: exactFrame, observedFrame: exactFrame };
  const observedFrame = frames.find(frame => frame.source?.path === sourcePath);
  if (reason === 'breakpoint' && observedFrame) return { status: 'wrong-position', observedFrame };
  return { status: 'unrelated', observedFrame };
}
