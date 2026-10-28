import type { NodeServerStopCapture } from '../nodeServerDebugger'

/** The column and function name a server stop is written with. */
export type ServerStopFrame = { column: number; frameName: string }

/**
 * Resolves the column and function name of a captured server stop, falling back to the snapshot's top frame when the debugger did not report them.
 * Called by {@link NodeServerHistorySink} for every stop it writes; a debugger that reports neither and a snapshot with no frames still give a writable position (column 1, empty name).
 * @param capture - The capture of the stop hit.
 * @returns
 * - The capture's own column and name when the debugger reported them
 * - Otherwise the snapshot top frame's column and name
 * - Otherwise column 1 and an empty name
 * @example
 * resolveServerStopFrame({ column: 7, frameName: 'handler', snapshot, … }) // => { column: 7, frameName: 'handler' }
 * resolveServerStopFrame({ snapshot: { frames: [{ name: 'post', column: 3, … }], … }, … }) // => { column: 3, frameName: 'post' }
 * resolveServerStopFrame({ snapshot: { frames: [], … }, … }) // => { column: 1, frameName: '' }
 */
export function resolveServerStopFrame(
  capture: Pick<NodeServerStopCapture, 'column' | 'frameName' | 'snapshot'>,
): ServerStopFrame {
  const top = capture.snapshot.frames[0]
  return {
    column: capture.column ?? top?.column ?? 1,
    frameName: capture.frameName ?? top?.name ?? '',
  }
}
