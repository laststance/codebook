import type { projectRecording } from './projectRecording'

/** The two facts of a projected moment ({@link projectRecording}) that decide whether its image can stay: its recorded frame and its stop. */
type RecordedMoment = Pick<
  ReturnType<typeof projectRecording>,
  'frame' | 'observation'
>

/**
 * Says for {@link leavesStopForNoStop} whether both moments hold a recorded frame, so neither side is a recorded gap.
 * @returns `true` when both have a frame, whatever their hashes; `false` when either has none
 * @example hasFrameOnBothSides({ frame: frameA }, { frame: frameB }) // => true
 */
function hasFrameOnBothSides(
  shown: RecordedMoment,
  next: RecordedMoment,
): boolean {
  return shown.frame !== undefined && next.frame !== undefined
}

/**
 * Tells the playback controller's Play step that the playhead leaves a stop for no stop (the end of the stop's sealed pause) with a recorded image on both sides.
 * Called by {@link PlaybackController} when the stop on screen changes: it then keeps the image on screen and retires only the stop's native values, session and source highlight, and the next moment's frame replaces the image once it has painted. The application usually goes on right after a pause, so the next frame is often a newer one.
 * @param shown - The moment on screen now; `undefined` before the first presentation.
 * @param next - The moment about to be presented.
 * @returns
 * - `true` when a stop is on screen, the next moment has none, and both moments have a recorded frame (the same one or a newer one)
 * - `false` otherwise: entering a stop, changing from one stop to another, a side without a recorded frame (a recorded gap), or nothing on screen yet
 * @example
 * leavesStopForNoStop({ frame: frameA, observation: stop }, { frame: frameA, observation: undefined }) // => true
 * leavesStopForNoStop({ frame: frameA, observation: stop }, { frame: frameB, observation: undefined }) // => true
 * leavesStopForNoStop({ frame: frameA, observation: stop }, { frame: undefined, observation: undefined }) // => false
 * leavesStopForNoStop({ frame: frameA, observation: undefined }, { frame: frameA, observation: stop }) // => false
 */
export function leavesStopForNoStop(
  shown: RecordedMoment | undefined,
  next: RecordedMoment,
): boolean {
  // Only the end of a stop keeps the image; entering or changing a stop shows its loading state.
  if (!shown?.observation || next.observation) return false
  return hasFrameOnBothSides(shown, next)
}
