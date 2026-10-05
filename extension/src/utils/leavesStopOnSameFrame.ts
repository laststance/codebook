import type { projectRecording } from './projectRecording'

type RecordedMoment = Pick<
  ReturnType<typeof projectRecording>,
  'frame' | 'observation'
>

/**
 * Tells the playback controller's Play step that the playhead leaves a stop for no stop (the end of the stop's sealed pause) while the recorded image stays the same.
 * Called by {@link PlaybackController} when the stop on screen changes, so it keeps that image on screen and retires only the stop's native values and source highlight.
 * @param shown - The moment on screen now; `undefined` before the first presentation.
 * @param next - The moment about to be presented.
 * @returns
 * - `true` when a stop is on screen, the next moment has none, and both have a recorded frame with the same hash
 * - `false` otherwise: entering or changing a stop, a new frame, a recorded gap, or nothing on screen yet
 * @example
 * leavesStopOnSameFrame({ frame: { hash: 'a' }, observation: stop }, { frame: { hash: 'a' }, observation: undefined }) // => true
 * leavesStopOnSameFrame({ frame: { hash: 'a' }, observation: stop }, { frame: { hash: 'b' }, observation: undefined }) // => false
 * leavesStopOnSameFrame({ frame: { hash: 'a' }, observation: undefined }, { frame: { hash: 'a' }, observation: stop }) // => false
 */
export function leavesStopOnSameFrame(
  shown: RecordedMoment | undefined,
  next: RecordedMoment,
): boolean {
  const shownFrameHash = shown?.frame?.hash
  return (
    Boolean(shown?.observation) &&
    !next.observation &&
    shownFrameHash !== undefined &&
    shownFrameHash === next.frame?.hash
  )
}
