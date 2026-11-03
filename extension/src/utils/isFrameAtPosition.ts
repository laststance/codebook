import { resolve } from 'node:path'

import type { DebugProtocol } from '@vscode/debugprotocol'

/**
 * Tells whether a native top frame sits in a file at an exact position, for {@link ConfiguredBrowserRun} when it commits a pause and when it re-checks one after a stack refresh.
 * The position is the caller's: at a commit the place the debugger bound, which may differ from the requested column and, by the stop's binding rule, lie on a later line than the declared one; at a refresh before the binding is known, the declared line or a later line the stop accepts, with the frame's own column (see {@link isRefreshedFrameAtStop}).
 * @param frame - The debugger's top stack frame, if it reported one.
 * @param sourcePath - Absolute path of the source file the stop belongs to.
 * @param position - One-based line and column the frame is compared with; `undefined` when the caller has none, which never matches.
 * @param options - `lineOnly` compares file and line but not column, for a library stop: Next's eval map of a bundled library module is line-granular, so the columns js-debug reports on a built line are not stable.
 * @returns `true` only when the frame names that file, line and column (column left out under `lineOnly`).
 * @example
 * isFrameAtPosition({ id: 1, name: 'authorize', source: { path: '/app/auth.ts' }, line: 41, column: 24 }, '/app/auth.ts', { line: 41, column: 24 }) // => true
 * isFrameAtPosition({ id: 1, name: 'authorize', source: { path: '/app/auth.ts' }, line: 41, column: 11 }, '/app/auth.ts', { line: 41, column: 24 }) // => false
 * isFrameAtPosition({ id: 1, name: 'authorize', source: { path: '/app/auth.ts' }, line: 41, column: 11 }, '/app/auth.ts', { line: 41, column: 24 }, { lineOnly: true }) // => true
 */
export function isFrameAtPosition(
  frame: DebugProtocol.StackFrame | undefined,
  sourcePath: string,
  position: { line: number; column: number } | undefined,
  options: { lineOnly?: boolean } = {},
): frame is DebugProtocol.StackFrame {
  if (!frame?.source?.path || !position) return false
  // A library stop compares file and line only; every other stop compares file, line and column as one location.
  if (options.lineOnly)
    return (
      `${resolve(frame.source.path)}:${frame.line}` ===
      `${sourcePath}:${position.line}`
    )
  return (
    `${resolve(frame.source.path)}:${frame.line}:${frame.column}` ===
    `${sourcePath}:${position.line}:${position.column}`
  )
}
