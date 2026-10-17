import { lstat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import {
  MAX_RECORDING_HEADER_BYTES,
  RECORDING_HEADER_FILE,
  RECORDING_SEAL_FILE,
  STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS,
} from '../constants'
import { recordingHeaderSchema } from '../recordingSchemas'

import { currentStorageOwner } from './currentStorageOwner'
import { isProcessGone } from './isProcessGone'
import { isRecordedOwnerGone } from './isRecordedOwnerGone'
import { isSameStorageMachine } from './isSameStorageMachine'
import { processStartedAtMs } from './processStartedAtMs'
import { readBoundedFile } from './readBoundedFile'
import { readProcessStart } from './readProcessStart'
import { readRecordedOwner, type RecordedOwner } from './readRecordedOwner'
import { recordingOwnerRecordPath } from './recordingOwnerRecordPath'

/** The owner a recording's header names and when the recording was created, read without the rest of the header, whose other fields depend on the recording's format. */
const headerOwnerSchema = z.object({
  owner: recordingHeaderSchema.shape.owner,
  createdAt: recordingHeaderSchema.shape.createdAt,
})

/** What a recording's header says of its writer: the editor process and the time the recording was created. */
type HeaderOwner = z.infer<typeof headerOwnerSchema>

/** Whether a recording this very process started counts like any other (`counts`) or is left to the caller's own run state (`ignored`); see {@link recordingMayStillBeWritten}. */
type OwnProcessRule = 'counts' | 'ignored'

/**
 * Judges a recording's writer by the record of its full identity that this build keeps outside the recording ({@link recordingOwnerRecordPath}), as a storage lock's owner is judged ({@link isRecordedOwnerGone}); called by {@link recordingMayStillBeWritten} when that record exists.
 * The editor's machine id and the machine's pseudonyms tell this machine after its host name changed (macOS follows the network) and another machine with the same host name; the process start tells a process id that went to another process.
 * @param owner - The record of the writer.
 * @param ownProcess - Whether this process's own recording counts.
 * @returns `true` while the writer may still run (also one of another machine, which is not probed); `false` once it is gone, and with `ignored` for this process's own recording.
 * @example await isWriterLiveByRecord({ pid: 4242, hostname: 'laptop.lan', machineId: 'f3a1…', processStart: 'ps:Mon Oct  5 09:12:33 2026' }, 'counts') // => false once process 4242 is another process
 */
async function isWriterLiveByRecord(
  owner: RecordedOwner,
  ownProcess: OwnProcessRule,
): Promise<boolean> {
  const identity = await currentStorageOwner()
  // This process's own recording is left to the caller's own run state when it asks so.
  if (
    ownProcess === 'ignored' &&
    owner.pid === process.pid &&
    isSameStorageMachine(owner, identity)
  )
    return false
  return !(await isRecordedOwnerGone(owner, identity))
}

/**
 * Says whether the process that has a recording writer's id now began after the recording was created, beyond the tolerance of a corrected clock: then it is another process, and the writer is gone; called by {@link isWriterLiveByHeader} for a live process id of this host.
 * @param header - What the header says of the writer.
 * @returns `true` when the process began later than the recording's creation plus {@link STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS}; `false` when it began before, and when its start cannot be read: it may be the writer.
 * @example await hasIdGoneToALaterProcess({ owner: { pid: 4242, hostname: 'workstation', sessionId }, createdAt: '2026-10-05T09:00:00.000Z' }) // => true for a process that began at 10:00
 */
async function hasIdGoneToALaterProcess(header: HeaderOwner): Promise<boolean> {
  const start = await readProcessStart(header.owner.pid).catch(() => undefined)
  const startedAtMs =
    start === undefined ? undefined : processStartedAtMs(start)
  return (
    startedAtMs !== undefined &&
    startedAtMs >
      Date.parse(header.createdAt) + STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS
  )
}

/**
 * Judges a recording's writer by its header alone, for a recording without a record of its full identity (one 0.2.29.0 made, or one whose record could not be written); called by {@link recordingMayStillBeWritten}.
 * @param header - What the header says of the writer.
 * @param ownProcess - Whether this process's own recording counts.
 * @returns
 * - `true` for a writer of another host name, which cannot be probed, and for a live process of this host that began before the recording was created
 * - `false` for a process of this host that is gone, for one that began after the recording was created (its id went to another process: {@link hasIdGoneToALaterProcess}), and with `ignored` for this process's own recording
 * @example await isWriterLiveByHeader({ owner: { pid: 2 ** 22 + 1, hostname: hostname(), sessionId }, createdAt }, 'counts') // => false
 */
async function isWriterLiveByHeader(
  header: HeaderOwner,
  ownProcess: OwnProcessRule,
): Promise<boolean> {
  const { owner } = header
  // Only a process of this machine can be probed; any other owner may still be writing.
  if (owner.hostname !== hostname()) return true
  // This process's own recording is left to the caller's own run state when it asks so.
  if (ownProcess === 'ignored' && owner.pid === process.pid) return false
  if (isProcessGone(owner.pid)) return false
  return !(await hasIdGoneToALaterProcess(header))
}

/**
 * Says whether the editor that reserved a recording directory may still be writing it, so that {@link LearningLibrary} takes the recording of a run whose study is not saved yet neither for what is left of a removed study nor for something a removal may move, and moves no study whose recording another window's run still writes.
 * A sealed recording is finished. A directory without a readable header was never handed to a writer. An unsealed one counts as being written while its writer may run: by the record of the writer's full identity that this build keeps outside the recording ({@link isWriterLiveByRecord}), or, for a recording without one (made by 0.2.29.0), by the header's host name and process id, with a process id that went to a process begun after the recording counted as gone ({@link isWriterLiveByHeader}).
 * @param directory - The directory of one recording, `<learning directory>/recordings.vN/<study id>`.
 * @param ownProcess - `counts` (the default) when a recording this very process started counts like any other; `ignored` for {@link LearningLibrary.removeStudy}, which asks for other windows only: this window refuses to remove a study whose own run has not stopped, and a recording of its own that a stopped run left unsealed is no longer written.
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
): Promise<boolean> {
  const isSealed = await lstat(join(directory, RECORDING_SEAL_FILE)).then(
    () => true,
    () => false,
  )
  if (isSealed) return false
  const header = await readBoundedFile(
    join(directory, RECORDING_HEADER_FILE),
    MAX_RECORDING_HEADER_BYTES,
  )
    .then((bytes) => headerOwnerSchema.parse(JSON.parse(bytes.toString())))
    .catch(() => undefined)
  if (!header) return false
  const recordedOwner = await readRecordedOwner(
    recordingOwnerRecordPath(dirname(dirname(directory)), basename(directory)),
  )
  // The record of this build names the writer fully; a recording of 0.2.29.0 has its header alone.
  return recordedOwner
    ? isWriterLiveByRecord(recordedOwner, ownProcess)
    : isWriterLiveByHeader(header, ownProcess)
}
