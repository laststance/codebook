import { PLAYBACK_SEEK_STOP_SNAP_MS } from '../constants'

/**
 * Moves a seek that lands just before a recorded stop onto that stop, so a whole-millisecond position still presents the stop's paused state.
 * Called by the playback controller for every seek command.
 * @param positionMs - The requested seek position.
 * @param stopPositionsMs - The recorded stops' exact elapsed times inside the seekable range.
 * @returns
 * - The earliest stop less than {@link PLAYBACK_SEEK_STOP_SNAP_MS} after the position: that stop's exact time
 * - Otherwise: the position unchanged
 * @example
 * snapSeekToRecordedStop(122_822, [122_822.02]) // => 122822.02
 * snapSeekToRecordedStop(122_821, [122_822.02]) // => 122821
 * snapSeekToRecordedStop(122_823, [122_822.02]) // => 122823
 */
export function snapSeekToRecordedStop(
  positionMs: number,
  stopPositionsMs: readonly number[],
): number {
  const following = stopPositionsMs.filter(
    (stopMs) =>
      stopMs > positionMs && stopMs - positionMs < PLAYBACK_SEEK_STOP_SNAP_MS,
  )
  return following.length ? Math.min(...following) : positionMs
}
