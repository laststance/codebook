import { lstat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import {
  MAX_RECORDING_HEADER_BYTES,
  RECORDING_HEADER_FILE,
  RECORDING_SEAL_FILE,
} from '../constants'
import { recordingHeaderSchema } from '../recordingSchemas'

import {
  recordingWriterState,
  type OwnProcessRule,
  type ProcessStartsOfList,
  type RecordingWriterState,
} from './isRecordingWriterLive'
import { readBoundedFile } from './readBoundedFile'
import { recordingOwnerRecordPath } from './recordingOwnerRecordPath'

/** The owner a recording's header names and when the recording was created, read without the rest of the header, whose other fields depend on the recording's format. */
const headerOwnerSchema = z.object({
  owner: recordingHeaderSchema.shape.owner,
  createdAt: recordingHeaderSchema.shape.createdAt,
})

/** What {@link recordingWriterOf} found of one recording directory: `finished` for a sealed recording and for one without a readable header, which no writer has; otherwise its writer's state, with the time the recording was created. */
export type RecordingWriterOfDirectory =
  { kind: 'finished' } | (RecordingWriterState & { createdAt: string })

/**
 * Looks at the writer of one recording directory: a sealed recording is finished, a directory without a readable header was never handed to a writer, and the writer of any other is judged ({@link recordingWriterState}); called by {@link recordingMayStillBeWritten} and by {@link LearningLibrary.removeStudy}, which tells a writer of this machine from one it cannot probe.
 * @param directory - The directory of one recording, `<learning directory>/recordings.vN/<study id>`.
 * @param ownProcess - `counts` (the default) when a recording this very process started counts like any other; `ignored` when the caller judges its own recordings by its own run state.
 * @param starts - The process starts of the caller's list ({@link ProcessStartsOfList}), so that each writer's process is asked once in that list; one for this call alone when left out.
 * @returns `finished`, or the writer's state with the recording's creation time.
 * @example await recordingWriterOf('/…/recordings.v2/<study id>', 'ignored') // => { kind: 'on-another-host', host: 'laptop.home-network', createdAt: '2026-10-05T09:00:00.000Z' }
 */
export async function recordingWriterOf(
  directory: string,
  ownProcess: OwnProcessRule = 'counts',
  starts?: ProcessStartsOfList,
): Promise<RecordingWriterOfDirectory> {
  const isSealed = await lstat(join(directory, RECORDING_SEAL_FILE)).then(
    () => true,
    () => false,
  )
  if (isSealed) return { kind: 'finished' }
  const header = await readBoundedFile(
    join(directory, RECORDING_HEADER_FILE),
    MAX_RECORDING_HEADER_BYTES,
  )
    .then((bytes) => headerOwnerSchema.parse(JSON.parse(bytes.toString())))
    .catch(() => undefined)
  if (!header) return { kind: 'finished' }
  const state = await recordingWriterState(
    recordingOwnerRecordPath(dirname(dirname(directory)), basename(directory)),
    header,
    ownProcess,
    starts,
  )
  return { ...state, createdAt: header.createdAt }
}

/**
 * Says whether the editor that reserved a recording directory may still be writing it, so that {@link LearningLibrary} takes the recording of a run whose study is not saved yet neither for what is left of a removed study nor for something a removal may move, and moves no study whose recording another window's run still writes.
 * A sealed recording is finished. A directory without a readable header was never handed to a writer. An unsealed one counts as being written while its writer may run ({@link recordingWriterOf}): by the record of the writer's full identity that this build keeps outside the recording, or, for a recording without one (made by 0.2.29.0), by the header's host name and process id, with a process id that went to a process begun after the recording counted as gone.
 * @param directory - The directory of one recording, `<learning directory>/recordings.vN/<study id>`.
 * @param ownProcess - `counts` (the default) when a recording this very process started counts like any other; `ignored` for {@link LearningLibrary.removeStudy}, which asks for other windows only: this window refuses to remove a study whose own run has not stopped, and a recording of its own that a stopped run left unsealed is no longer written.
 * @param starts - The process starts of the caller's list ({@link ProcessStartsOfList}), so that each writer's process is asked once in that list; one for this call alone when left out.
 * @returns
 * - `false` for a sealed recording, for a directory whose header cannot be read, for an unsealed recording whose writer is gone from this machine, and with `ignored` for one this process started
 * - `true` for an unsealed recording whose writer still runs on this machine or runs on another one
 * @example
 * await recordingMayStillBeWritten('/…/recordings.v2/<study id>') // => false once the run's recording is sealed
 * await recordingMayStillBeWritten('/…/recordings.v2/<study id>', 'ignored') // => false for the unsealed recording of this window's own stopped run
 */
export async function recordingMayStillBeWritten(
  directory: string,
  ownProcess: OwnProcessRule = 'counts',
  starts?: ProcessStartsOfList,
): Promise<boolean> {
  const { kind } = await recordingWriterOf(directory, ownProcess, starts)
  return kind === 'may-run' || kind === 'on-another-host'
}
