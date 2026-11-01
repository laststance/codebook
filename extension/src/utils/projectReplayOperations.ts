import type { RecordingContext } from '../recordingSchemas'

/** How a replay draws one operation: filled number (done), number with a cross (failed), outlined question mark (not finished or not run). */
export type ReplayOperationState = 'done' | 'failed' | 'pending'

/** One mark of the replay's operation row, with the moment a seek to it selects. */
export type ReplayOperationMark = {
  /** 1-based. */
  index: number
  /** How many operations the run declared. */
  total: number
  kind: 'text' | 'choose' | 'click'
  title: string
  /** The moment on the recording clock the operation's input was sent, kept inside the recording's range; absent for an operation that was never sent. */
  atMs: number | undefined
  state: ReplayOperationState
}

/**
 * Projects the operations of a saved version 3 run into the marks of the replay's operation row.
 * Called by {@link PlaybackController} for every state it reports, so the Study page draws the row from the same place as the history-coverage strip. A replay without operations (versions 1 and 2, or one saved by 0.2.70.0) yields none, and the page shows no row.
 * @param context - The recording's saved context, if it loaded.
 * @param range - The recording's range; a time outside it is clamped into it, so a seek to the mark stays inside the returned range.
 * @returns The marks in declared order, or an empty list.
 * @example
 * projectReplayOperations(context, { startMs: 0, endMs: 9000 })[0] // => { index: 1, total: 4, kind: 'choose', title: 'Choose customer', atMs: 1250, state: 'done' }
 */
export function projectReplayOperations(
  context: RecordingContext | undefined,
  range: { startMs: number; endMs: number } | undefined,
): ReplayOperationMark[] {
  const records = context?.study.operations
  if (!records || !range) return []
  return records.map((record) => ({
    index: record.index,
    total: records.length,
    kind: record.kind,
    title: record.title,
    atMs:
      record.atMs === undefined
        ? undefined
        : Math.min(range.endMs, Math.max(range.startMs, record.atMs)),
    state:
      record.state === 'done'
        ? 'done'
        : record.state === 'failed'
          ? 'failed'
          : 'pending',
  }))
}
