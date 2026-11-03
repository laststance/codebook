import type { DebugProtocol } from '@vscode/debugprotocol'

import { isFrameAtPosition } from './isFrameAtPosition'

/**
 * Throws unless the paused top frame is the position the debugger bound, for {@link ConfiguredBrowserRun} when it commits a pause.
 * A library stop pauses in a built file whose eval map is line-granular, so js-debug's columns there are not stable: it is compared by file and line only, and its failure names the frame and the bound place so a later mismatch can be read from the journal. Every other stop keeps the exact file, line, column and the short message.
 * @param frame - The debugger's top stack frame, if it reported one.
 * @param sourcePath - Absolute path of the file the stop belongs to (the built file for a library stop).
 * @param bound - One-based place the debugger bound, if known.
 * @param isLibraryStop - Whether the stop is a library stop.
 * @throws When the frame is not at the bound position under the rule above.
 * @example
 * assertFrameAtBoundPosition(frame, '/app/auth.ts', { line: 41, column: 24 }, false) // throws unless the frame is at 41:24
 * assertFrameAtBoundPosition(frame, '/lib/build/core.js', { line: 63, column: 1 }, true) // passes for a frame at 63:4
 */
export function assertFrameAtBoundPosition(
  frame: DebugProtocol.StackFrame | undefined,
  sourcePath: string,
  bound: { line: number; column: number } | undefined,
  isLibraryStop: boolean,
): asserts frame is DebugProtocol.StackFrame {
  // Kept apart: a failed predicate narrows `frame` to never.
  const reported = frame
  if (isFrameAtPosition(frame, sourcePath, bound, { lineOnly: isLibraryStop }))
    return
  const message = 'DAP frame differs from the bound configured source position'
  if (!isLibraryStop) throw new Error(message)
  // A library stop adds both places to the failure text.
  const placeOf = (
    path: string | undefined,
    position: { line?: number; column?: number } | undefined,
  ): string => `${path ?? 'no path'}:${position?.line}:${position?.column}`
  throw new Error(
    `${message} (library stop: frame ${placeOf(reported?.source?.path, reported)}, bound ${placeOf(sourcePath, bound)}, column not compared)`,
  )
}
