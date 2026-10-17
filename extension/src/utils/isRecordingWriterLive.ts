import { hostname } from 'node:os'

import { STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS } from '../constants'
import type { RecordingHeader } from '../recordingSchemas'

import { currentStorageOwner } from './currentStorageOwner'
import { isProcessGone } from './isProcessGone'
import { isRecordedOwnerGone } from './isRecordedOwnerGone'
import { isSameStorageMachine } from './isSameStorageMachine'
import { processStartedAtMs } from './processStartedAtMs'
import { readProcessStart } from './readProcessStart'
import { readRecordedOwner, type RecordedOwner } from './readRecordedOwner'

/** What a recording's header says of its writer: the editor process (its id and its host name) and the time the recording was created. */
export type RecordingWriterOfHeader = {
  owner: Pick<RecordingHeader['owner'], 'pid' | 'hostname'>
  createdAt: RecordingHeader['createdAt']
}

/** Whether a recording this very process started counts like any other (`counts`) or is left to the caller's own run state (`ignored`); see {@link isRecordingWriterLive}. */
export type OwnProcessRule = 'counts' | 'ignored'

/**
 * Judges a recording's writer by the record of its full identity that this build keeps outside the recording ({@link recordingOwnerRecordPath}), as a storage lock's owner is judged ({@link isRecordedOwnerGone}); called by {@link isRecordingWriterLive} when that record exists.
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
 * @example await hasIdGoneToALaterProcess({ owner: { pid: 4242, hostname: 'workstation' }, createdAt: '2026-10-05T09:00:00.000Z' }) // => true for a process that began at 10:00
 */
async function hasIdGoneToALaterProcess(
  header: RecordingWriterOfHeader,
): Promise<boolean> {
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
 * Judges a recording's writer by its header alone, for a recording without a record of its full identity (one 0.2.29.0 made, or one whose record could not be written); called by {@link isRecordingWriterLive}.
 * @param header - What the header says of the writer.
 * @param ownProcess - Whether this process's own recording counts.
 * @returns
 * - `true` for a writer of another host name, which cannot be probed, and for a live process of this host that began before the recording was created
 * - `false` for a process of this host that is gone, for one that began after the recording was created (its id went to another process: {@link hasIdGoneToALaterProcess}), and with `ignored` for this process's own recording
 * @example await isWriterLiveByHeader({ owner: { pid: 2 ** 22 + 1, hostname: hostname() }, createdAt }, 'counts') // => false
 */
async function isWriterLiveByHeader(
  header: RecordingWriterOfHeader,
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
 * Says whether the editor process that writes an unsealed recording may still run, the one rule for every judgment of a recording's writer: {@link recordingMayStillBeWritten} (what the library lists and may move) and the status {@link RecordingStore} gives a recording another session wrote (`unfinalized` while its writer may run, `interrupted` once it is gone).
 * The record of the writer's full identity that this build keeps outside the recording decides when it exists ({@link isWriterLiveByRecord}); a recording without one (made by 0.2.29.0) is judged by its header's host name and process id, a process id that went to a process begun after the recording counting as gone ({@link isWriterLiveByHeader}).
 * @param ownerRecordPath - The record of the recording's writer ({@link recordingOwnerRecordPath}); it may not exist.
 * @param header - What the recording's header says of its writer.
 * @param ownProcess - `counts` (the default) when this very process counts like any other writer; `ignored` when the caller judges its own recordings by its own run state.
 * @returns `true` while the writer may still run, on this machine or on another one; `false` once it is gone from this machine, and with `ignored` for this process.
 * @example
 * await isRecordingWriterLive('/storage/learning/recording-owners/<id>.json', header) // => false for a crashed editor whose process id another process has now
 */
export async function isRecordingWriterLive(
  ownerRecordPath: string,
  header: RecordingWriterOfHeader,
  ownProcess: OwnProcessRule = 'counts',
): Promise<boolean> {
  const recordedOwner = await readRecordedOwner(ownerRecordPath)
  // The record of this build names the writer fully; a recording of 0.2.29.0 has its header alone.
  return recordedOwner
    ? isWriterLiveByRecord(recordedOwner, ownProcess)
    : isWriterLiveByHeader(header, ownProcess)
}
