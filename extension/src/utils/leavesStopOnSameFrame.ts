import type { RecordingFrame } from '../recordingSchemas'

/** The two facts of a projected moment ({@link projectRecording}) that decide whether its image can stay: its recorded frame and its stop. */
interface RecordedMoment {
  frame?: Pick<RecordingFrame, 'hash'>
  observation?: unknown
}

/**
 * Compares the recorded frames of two moments for {@link leavesStopOnSameFrame}.
 * @returns `true` when the shown moment has a recorded frame and the next one has a frame with the same hash; `false` for a new frame or a recorded gap
 * @example sameRecordedFrame({ frame: { hash: 'a' } }, { frame: { hash: 'a' } }) // => true
 */
function sameRecordedFrame(
  shown: RecordedMoment,
  next: RecordedMoment,
): boolean {
  return shown.frame !== undefined && shown.frame.hash === next.frame?.hash
}

/**
 * Tells the playback controller's Play step that the playhead leaves a stop for no stop (the end of the stop's sealed pause) while the recorded image stays the same.
 * Called by {@link PlaybackController} when the stop on screen changes, so it keeps that image on screen and retires only the stop's native values and source highlight.
 * @param shown - The moment on screen now; `undefined` before the first presentation.
 * @param next - The moment about to be presented.
 * @returns
 * - `true` when a stop is on screen, the next moment has none, and both have a recorded frame with the same hash
 * - `false` otherwise: entering or changing a stop, a new frame, a recorded gap, or nothing on screen yet
 * @example
 * leavesStopOnSameFrame({ frame: { hash: 'a' }, observation: stop }, { frame: { hash: 'a' } }) // => true
 * leavesStopOnSameFrame({ frame: { hash: 'a' }, observation: stop }, { frame: { hash: 'b' } }) // => false
 * leavesStopOnSameFrame({ frame: { hash: 'a' } }, { frame: { hash: 'a' }, observation: stop }) // => false
 */
export function leavesStopOnSameFrame(
  shown: RecordedMoment | undefined,
  next: RecordedMoment,
): boolean {
  // Only the end of a stop leaves the image; entering or changing a stop shows its loading state.
  if (!shown?.observation || next.observation) return false
  return sameRecordedFrame(shown, next)
}
