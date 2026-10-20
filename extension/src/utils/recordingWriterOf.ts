import {
  recordingWriterState,
  sealedRecordingWriterState,
  type OwnProcessRule,
  type ProcessStartsOfList,
  type RecordingWriterState,
} from './isRecordingWriterLive'
import { isSealedRecordingReleased } from './isSealedRecordingReleased'
import { lookAtRecording, type RecordingLook } from './lookAtRecording'

/**
 * What {@link recordingWriterOf} found of one recording directory.
 * - `finished`: one without a header, which no writer has, and a sealed recording that no run holds any more, each by a look that proves it so
 * - `unreadable`: one whose header, or whose writer record, stands and gave the look nothing ({@link RecordingLook.mayHaveFailedRead}), where nothing else names a writer that may still hold it: the read may have failed for a moment (a scanner on Windows holds the file) while another window still records it or still has to save its study, so it is neither finished nor anyone's reservation, and Delete asks the learner about it (Cycle 0047 row 251)
 * - otherwise its writer's state, with the time the recording was created
 */
export type RecordingWriterOfDirectory =
  | { kind: 'finished' }
  | { kind: 'unreadable' }
  | (RecordingWriterState & { createdAt: string })

/**
 * Looks at the writer of one recording directory, so that {@link LearningLibrary} takes the recording of a run whose study is not saved yet neither for what is left of a removed study nor for something a removal may move, and tells a writer of this machine from one it cannot confirm; called by its list ({@link LearningLibrary.entryWithoutArchive}, for every recording of a study without an archive, with `counts` through {@link isReservedByRunHere}) and by its removal ({@link LearningLibrary.writerVerdictsOf}, before the storage lock of {@link LearningLibrary.removeStudy}, once per recording with `ignored` and the look it made).
 * A directory without a header was never handed to a writer ({@link lookAtRecording}). A sealed recording is finished once no run holds it: its run holds it until it has saved a checkpoint of its study taken after the seal, also when a checkpoint taken before the seal saved the study, even one whose save ended after the seal, by the record of its writer that the seal keeps until then ({@link sealedRecordingWriterState}, {@link removeWriterRecordsOfSealedRecordings}); before that save another window would list it as what is left of a removed study, or remove the study, and could move it to the Trash before the run's state after the seal is saved; the run's save then finds the study gone and writes nothing ({@link StudyRemovedWithItsRecordingError}). The writer of any other is judged by {@link recordingWriterState}: by the record of its full identity that this build keeps outside the recording, when that record names this recording, or, for a recording without such a record (made by 0.2.29.0, another format's recording of the same id, or one whose record could not be written), by the header's host name and process id.
 * A look that may have failed to read ({@link RecordingLook.mayHaveFailedRead}) never gives `finished`, before the removal's lock, in the list or under the lock (Cycle 0047 row 251): a header that stands and gave nothing names no writer and proves none absent, so the recording is `unreadable`; a writer record that stands and gave nothing leaves the header to judge the writer ({@link sealedRecordingWriterState}), and a sealed recording that this still leaves unheld is `unreadable` too.
 * @param directory - The directory of one recording, `<learning directory>/recordings.vN/<study id>`.
 * @param ownProcess - `counts` (the default) when a recording this very process started counts like any other; `ignored` when the caller asks for other windows only, as a removal does: this window refuses to remove a study whose own run has not stopped, and a recording of its own that a stopped run left unsealed is no longer written.
 * @param starts - The process starts of the caller's list ({@link ProcessStartsOfList}), so that each writer's process is asked once in that list; one for this call alone when left out.
 * @param look - The look at the recording the caller already made ({@link lookAtRecording}), so that its answer is judged from that very look; one made now when left out.
 * @returns
 * - `finished` for a directory without a header, and for a sealed recording that its run has released ({@link isSealedRecordingReleased}): one without the record of its writer, or this window's own; each only by a look that read the header and the record, or proved them absent
 * - `unreadable` for a directory whose header stands and gave the look nothing, and for a sealed recording whose writer record stands and gave the look nothing and whose header leaves it unheld (this window's own)
 * - for a sealed recording whose writer's record is kept, the state of that writer, whose run may still save the study (`may-run`, `on-another-host`, `unconfirmed-here`, `gone`), with the recording's creation time; for one whose record the look saw and cannot read, the state its header gives (`may-run`, `on-another-host`, `unconfirmed-here`), and `unreadable` where the header would call the writer gone (Cycle 0048 task 1)
 * - `unreadable` also for an unsealed recording whose header calls the writer gone while its writer record stands as a regular file that cannot be read now ({@link isWriterRecordUnreadable}, Cycle 0048 task 30)
 * - otherwise the writer's state with the recording's creation time: `may-run` (a writer of this machine), `on-another-host` (one this machine cannot probe, with the host the recording names), `unconfirmed-here` (a live process of this host that this computer cannot confirm as the writer: of another user, or one that began after the recording, by the clock), `gone`, or `left-to-caller` (this process, with `ignored`)
 * @example
 * await recordingWriterOf('/…/recordings.v2/<study id>') // => { kind: 'finished' } once the run's recording is sealed and its study saved
 * await recordingWriterOf('/…/recordings.v2/<study id>') // => { kind: 'unreadable' } while a scanner holds its header
 * await recordingWriterOf('/…/recordings.v2/<study id>', 'ignored') // => { kind: 'on-another-host', host: 'laptop.home-network', createdAt: '2026-10-05T09:00:00.000Z' }
 */
export async function recordingWriterOf(
  directory: string,
  ownProcess: OwnProcessRule = 'counts',
  starts?: ProcessStartsOfList,
  look?: RecordingLook,
): Promise<RecordingWriterOfDirectory> {
  const seen = look ?? (await lookAtRecording(directory))
  const { isSealed, header } = seen
  // Only a look that proves no header there finds no writer; a header that stands and gave nothing may hide one.
  if (!header)
    return seen.mayHaveFailedRead
      ? { kind: 'unreadable' }
      : { kind: 'finished' }
  if (isSealed) {
    // The look decides whether the record is there, so the answer is judged from that very look.
    const holder = isSealedRecordingReleased(seen)
      ? undefined
      : await sealedRecordingWriterState(directory, header, starts)
    // A record that stands and cannot be read, with a header that proves no writer gone, is nobody's reservation and nobody's rest.
    if (holder?.kind === 'unreadable') return { kind: 'unreadable' }
    if (holder) return { ...holder, createdAt: header.createdAt }
    // A look that may have failed to read releases nothing by itself.
    return seen.mayHaveFailedRead
      ? { kind: 'unreadable' }
      : { kind: 'finished' }
  }
  const state = await recordingWriterState(
    directory,
    header,
    ownProcess,
    starts,
  )
  // A record that stands and cannot be read, with a header that proves no writer gone, is nobody's reservation and nobody's rest.
  if (state.kind === 'unreadable') return { kind: 'unreadable' }
  return { ...state, createdAt: header.createdAt }
}
