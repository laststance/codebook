import type { DebugProtocol } from '@vscode/debugprotocol'

import { isFrameAtPosition } from './isFrameAtPosition'

/**
 * Tells whether the top frame of a refreshed native stack is still the source a paused stop was captured at, for {@link ConfiguredBrowserRun} when js-debug announces the same pause again.
 * Once the stop's binding is known the frame must sit at that exact position. A refresh that arrives before the binding is known is held to the cited file and to a line the binding itself may be on, at any column: the declared line, or a later line the stop accepts as its binding; the stop is still committed only at the bound position.
 * @param frame - The debugger's top stack frame after the refresh, if it reported one.
 * @param stop - The paused stop: its source file, its declared line, once known the position the debugger bound, and which lines its binding may be on.
 * @returns `true` only when the frame names the stop's file at the bound position, or, while nothing is bound yet, on the declared line or a line the stop accepts.
 * @example
 * isRefreshedFrameAtStop(frame, { sourcePath: '/app/auth.ts', declaredLine: 41, bound: { line: 41, column: 24 }, acceptsBoundLine: (line) => line === 41 }) // frame at 41:24 => true, at 41:11 => false
 * isRefreshedFrameAtStop(frame, { sourcePath: '/app/auth.ts', declaredLine: 41, acceptsBoundLine: (line) => line === 41 }) // frame at 41:11 => true, at 42:1 => false
 * isRefreshedFrameAtStop(frame, { sourcePath: '/app/auth.ts', declaredLine: 41, acceptsBoundLine: (line) => line === 42 }) // frame at 42:1 => true
 */
export function isRefreshedFrameAtStop(
  frame: DebugProtocol.StackFrame | undefined,
  stop: RefreshedStop,
): frame is DebugProtocol.StackFrame {
  return isFrameAtPosition(
    frame,
    stop.sourcePath,
    stop.bound ?? positionBeforeBinding(frame, stop),
  )
}

/** The paused stop a refreshed frame is compared with: its source file, its declared line, once known the position the debugger bound, and which lines its binding may be on. */
interface RefreshedStop {
  sourcePath: string
  declaredLine: number
  bound?: { line: number; column: number }
  acceptsBoundLine: (line: number) => boolean
}

/** Gives {@link isRefreshedFrameAtStop} the position a refreshed frame must be at while nothing is bound: the frame's own column, on its own line when that line may be the binding's and on the declared line otherwise, so any column of such a line matches. @example positionBeforeBinding({ id: 1, name: 'authorize', line: 41, column: 11 }, { sourcePath: '/app/auth.ts', declaredLine: 41, acceptsBoundLine: (line) => line === 41 }) // { line: 41, column: 11 } */
function positionBeforeBinding(
  frame: DebugProtocol.StackFrame | undefined,
  stop: RefreshedStop,
): { line: number; column: number } | undefined {
  if (!frame) return undefined
  const mayBeBound = stop.acceptsBoundLine(frame.line)
  return {
    line: mayBeBound ? frame.line : stop.declaredLine,
    column: frame.column,
  }
}
