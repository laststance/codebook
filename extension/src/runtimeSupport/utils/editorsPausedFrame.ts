import {
  DEEMPHASIZED_FRAME_STOP_REASONS,
  EDITOR_STOP_FOCUS_FRAME_COUNT,
} from '../constants'

import type { DebugStackFrameOfAnswer } from './stackTraceResponseOf'

/**
 * Picks the frame the editor focuses for a stop from the frames its adapter answered so far, by the editor's own rule; asked by {@link StopKeyboardHandOver}, which hands a stop's keyboard over only at that frame.
 * Both editors focus the first frame that has a source and, unless the stop's reason is one of {@link DEEMPHASIZED_FRAME_STOP_REASONS}, whose own presentation hint, else its source's, is neither `deemphasize` nor `subtle` (`Thread.getTopStackFrame`: VS Code 1.140.0 workbench line 695 col 4742, Cursor 3.23.12 line 17299 col 4299; the hint check is `T3`/`kjt`). When no frame qualifies they focus the thread alone and open no file: js-debug pauses in Node's own code with every frame deemphasized by `skipFiles`, or an uncaught exception thrown there. The instruction-level rule of that method (a frame with an instruction pointer at an instruction breakpoint or step) is left out: js-debug offers neither.
 * @param frames - The frames of the stopped thread by index, as far as the adapter answered them; a hole is a frame not answered yet.
 * @param reason - The reason of the adapter's `stopped` event, if any.
 * @returns
 * - The first qualifying frame among the first {@link EDITOR_STOP_FOCUS_FRAME_COUNT}, once every frame above it is answered
 * - `undefined` when none qualifies so far, also when a hole comes before the first qualifying frame: the frame not answered yet may be the one the editor focuses
 * @example
 * editorsPausedFrame([{ id: 1, source: { path: '/app/timers.js' }, presentationHint: 'deemphasize' }], 'pause') // => undefined
 * editorsPausedFrame([{ id: 1, source: { path: '/app/vendor.js' }, presentationHint: 'deemphasize' }], 'breakpoint') // => the frame with id 1
 * editorsPausedFrame([undefined, { id: 2, source: { path: '/app/actions.ts' } }], 'breakpoint') // => undefined, the top frame is not answered yet
 */
export function editorsPausedFrame(
  frames: readonly (DebugStackFrameOfAnswer | undefined)[],
  reason: string | undefined,
): DebugStackFrameOfAnswer | undefined {
  const keepsDeemphasized =
    reason !== undefined && DEEMPHASIZED_FRAME_STOP_REASONS.has(reason)
  // The first frame with a source that the stop's reason lets the editor focus is the one it focuses.
  for (const frame of frames.slice(0, EDITOR_STOP_FOCUS_FRAME_COUNT)) {
    // A frame not answered yet may qualify, so no frame below it can be named before its answer.
    if (frame === undefined) return undefined
    if (
      frame.source !== undefined &&
      (keepsDeemphasized || !isDeemphasizedFrame(frame))
    )
      return frame
  }
  return undefined
}

/**
 * Says whether the editor shows a frame as deemphasized, by its own hint and else its source's; the hint check of {@link editorsPausedFrame}.
 * @param frame - A frame of the adapter's answer.
 * @returns `true` for the hint `deemphasize` or `subtle`; `false` otherwise.
 * @example isDeemphasizedFrame({ id: 1, presentationHint: 'normal', source: { presentationHint: 'deemphasize' } }) // => false, the frame's own hint counts
 */
function isDeemphasizedFrame(frame: DebugStackFrameOfAnswer): boolean {
  const hint = frame.presentationHint ?? frame.source?.presentationHint
  return hint === 'deemphasize' || hint === 'subtle'
}
