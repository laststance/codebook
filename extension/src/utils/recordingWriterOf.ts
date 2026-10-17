import { basename, dirname } from 'node:path'

import {
  recordingWriterState,
  type OwnProcessRule,
  type ProcessStartsOfList,
  type RecordingWriterState,
} from './isRecordingWriterLive'
import { lookAtRecording } from './lookAtRecording'
import { recordingOwnerRecordPath } from './recordingOwnerRecordPath'

/** What {@link recordingWriterOf} found of one recording directory: `finished` for a sealed recording and for one without a readable header, which no writer has; otherwise its writer's state, with the time the recording was created. */
export type RecordingWriterOfDirectory =
  { kind: 'finished' } | (RecordingWriterState & { createdAt: string })

/**
 * Looks at the writer of one recording directory, so that {@link LearningLibrary} takes the recording of a run whose study is not saved yet neither for what is left of a removed study nor for something a removal may move, and tells a writer of this machine from one it cannot confirm; called by its list ({@link LearningLibrary.list}, for every recording of a study without an archive) and by its removal ({@link LearningLibrary.removeStudy}, before its storage lock).
 * A sealed recording is finished, and a directory without a readable header was never handed to a writer ({@link lookAtRecording}). The writer of any other is judged by {@link recordingWriterState}: by the record of its full identity that this build keeps outside the recording, or, for a recording without one (made by 0.2.29.0), by the header's host name and process id.
 * @param directory - The directory of one recording, `<learning directory>/recordings.vN/<study id>`.
 * @param ownProcess - `counts` (the default) when a recording this very process started counts like any other; `ignored` when the caller asks for other windows only, as a removal does: this window refuses to remove a study whose own run has not stopped, and a recording of its own that a stopped run left unsealed is no longer written.
 * @param starts - The process starts of the caller's list ({@link ProcessStartsOfList}), so that each writer's process is asked once in that list; one for this call alone when left out.
 * @returns
 * - `finished` for a sealed recording and for a directory whose header cannot be read
 * - otherwise the writer's state with the recording's creation time: `may-run` (a writer of this machine), `on-another-host` (one this machine cannot probe, with the host the recording names), `unconfirmed-here` (a live process of this host that began after the recording, by the clock), `gone`, or `left-to-caller` (this process, with `ignored`)
 * @example
 * await recordingWriterOf('/…/recordings.v2/<study id>') // => { kind: 'finished' } once the run's recording is sealed
 * await recordingWriterOf('/…/recordings.v2/<study id>', 'ignored') // => { kind: 'on-another-host', host: 'laptop.home-network', createdAt: '2026-10-05T09:00:00.000Z' }
 */
export async function recordingWriterOf(
  directory: string,
  ownProcess: OwnProcessRule = 'counts',
  starts?: ProcessStartsOfList,
): Promise<RecordingWriterOfDirectory> {
  const { isSealed, header } = await lookAtRecording(directory)
  if (isSealed || !header) return { kind: 'finished' }
  const state = await recordingWriterState(
    recordingOwnerRecordPath(dirname(dirname(directory)), basename(directory)),
    header,
    ownProcess,
    starts,
  )
  return { ...state, createdAt: header.createdAt }
}
