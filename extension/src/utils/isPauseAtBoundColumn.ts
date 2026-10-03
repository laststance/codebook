import type { Protocol } from 'devtools-protocol'

import type { createBundleVerifier } from './createBundleVerifier'

/** A declared stop as far as its bound column is compared: the sealed map's column reader and, once known, where the debugger bound the stop. */
interface BoundColumnTarget {
  verifier: Pick<ReturnType<typeof createBundleVerifier>, 'originalColumn'>
  /** The position the debugger verified the stop's breakpoint at; absent until that binding is known. */
  bound?: { column: number }
}

/**
 * Tells whether a pause on a declared stop's line is at the column the debugger bound that stop at, so another statement of the same line is not taken for the stop.
 * {@link ConfiguredBrowserRun} asks it after {@link isPauseAtStop} placed a pause on the stop's line: the debug adapter can pause for a breakpoint of its own at another column of that line and resume it by itself.
 * @param event - The pause as the runtime reported it.
 * @param stop - The declared stop the pause was placed on.
 * @returns
 * - `true` while the stop's binding is not known yet (a server stop before its pause is inspected), and when the top frame maps to the bound column
 * - `false` when the binding is known and the top frame maps to another column, or to none
 * @example
 * isPauseAtBoundColumn(pauseAt('9', 0, 6), { bound: { column: 1 }, verifier }) // the map puts 0:6 at column 7 => false
 */
export function isPauseAtBoundColumn(
  event: Protocol.Debugger.PausedEvent,
  stop: BoundColumnTarget,
): boolean {
  const location = event.callFrames[0]?.location
  if (!stop.bound || !location) return true
  return stop.verifier.originalColumn(location) === stop.bound.column
}
