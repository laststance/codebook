import type { ConfiguredOperationRecord } from '../configuredStudySchemas'
import type { RecordingOperation } from '../recordingSchemas'

/**
 * Gives the recording context's form of a saved operation record: its index, kind, title, sent time and final effect.
 * Called by {@link buildRecordingContext} when a recording context is written and by {@link validateRecordingContext} when it is read back.
 * @param record - A saved study's operation record.
 * @returns The context entry; `outcome` is the final effect the run resource reported when the run ended, not the dispatch receipt.
 * @example recordingOperationOf({ index: 2, kind: 'choose', title: 'Pick', atMs: 900, state: 'done', ack: 'yes', valueCheck: 'passed', effect: 'dispatched' }).outcome // => 'dispatched'
 */
export function recordingOperationOf(
  record: ConfiguredOperationRecord,
): RecordingOperation {
  return {
    index: record.index,
    kind: record.kind,
    title: record.title,
    ...(record.atMs === undefined ? {} : { atMs: record.atMs }),
    outcome: record.effect,
  }
}
