import type { DebugProtocol } from '@vscode/debugprotocol'

import { isFrameAtPosition } from './isFrameAtPosition'

/**
 * Tells whether the top frame of a refreshed native stack is still the source a paused stop was captured at, for {@link ConfiguredBrowserRun} when js-debug announces the same pause again.
 * Once the stop's binding is known the frame must sit at that exact position. A refresh that arrives before the binding is known is held to the cited file and the declared line at any column, the rule the binding itself must meet; the stop is still committed only at the bound position.
 * @param frame - The debugger's top stack frame after the refresh, if it reported one.
 * @param stop - The paused stop: its source file, its declared line and, once known, the position the debugger bound.
 * @returns `true` only when the frame names the stop's file at the bound position, or on the declared line while nothing is bound yet.
 * @example
 * isRefreshedFrameAtStop(frame, { sourcePath: '/app/auth.ts', declaredLine: 41, bound: { line: 41, column: 24 } }) // frame at 41:24 => true, at 41:11 => false
 * isRefreshedFrameAtStop(frame, { sourcePath: '/app/auth.ts', declaredLine: 41 }) // frame at 41:11 => true, at 42:1 => false
 */
export function isRefreshedFrameAtStop(
  frame: DebugProtocol.StackFrame | undefined,
  stop: {
    sourcePath: string
    declaredLine: number
    bound?: { line: number; column: number }
  },
): frame is DebugProtocol.StackFrame {
  // While nothing is bound, the frame's own column stands in for the unknown one, so any column of the declared line matches.
  return isFrameAtPosition(
    frame,
    stop.sourcePath,
    stop.bound ?? (frame && { line: stop.declaredLine, column: frame.column }),
  )
}
