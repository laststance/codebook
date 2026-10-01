import { resolve } from 'node:path'

import type { DebugProtocol } from '@vscode/debugprotocol'

/**
 * Tells whether a native top frame sits in a file at an exact position, for {@link ConfiguredBrowserRun} when it commits a pause and when it re-checks one after a stack refresh.
 * The position is the one the debugger bound, which lies on the declared line and may differ from the requested column.
 * @param frame - The debugger's top stack frame, if it reported one.
 * @param sourcePath - Absolute path of the source file the stop belongs to.
 * @param position - One-based line and column the breakpoint bound at; `undefined` while nothing is bound.
 * @returns `true` only when the frame names that file, line and column.
 * @example
 * isFrameAtPosition({ id: 1, name: 'authorize', source: { path: '/app/auth.ts' }, line: 41, column: 24 }, '/app/auth.ts', { line: 41, column: 24 }) // => true
 * isFrameAtPosition({ id: 1, name: 'authorize', source: { path: '/app/auth.ts' }, line: 41, column: 11 }, '/app/auth.ts', { line: 41, column: 24 }) // => false
 */
export function isFrameAtPosition(
  frame: DebugProtocol.StackFrame | undefined,
  sourcePath: string,
  position: { line: number; column: number } | undefined,
): frame is DebugProtocol.StackFrame {
  if (!frame?.source?.path || !position) return false
  // File, line and column are compared as one location.
  return (
    `${resolve(frame.source.path)}:${frame.line}:${frame.column}` ===
    `${sourcePath}:${position.line}:${position.column}`
  )
}
