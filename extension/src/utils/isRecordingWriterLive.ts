import { hostname } from 'node:os'

import { STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS } from '../constants'
import type { RecordingHeader } from '../recordingSchemas'

import { currentStorageOwner } from './currentStorageOwner'
import { isProcessGone } from './isProcessGone'
import { isRecordedOwnerGone } from './isRecordedOwnerGone'
import { isSameStorageMachine } from './isSameStorageMachine'
import { processStartedAtMs } from './processStartedAtMs'
import { readProcessStart, type ProcessStartReader } from './readProcessStart'
import { readRecordedOwner, type RecordedOwner } from './readRecordedOwner'

/** What a recording's header says of its writer: the editor process (its id and its host name) and the time the recording was created. */
export type RecordingWriterOfHeader = {
  owner: Pick<RecordingHeader['owner'], 'pid' | 'hostname'>
  createdAt: RecordingHeader['createdAt']
}

/** Whether a recording this very process started counts like any other (`counts`) or is left to the caller's own run state (`ignored`); see {@link recordingWriterState}. */
export type OwnProcessRule = 'counts' | 'ignored'

/** The process starts one list of recordings has read, by process id, so that each process is read once in that list, also when several judgements ask for it at once; the caller makes one for each list and drops it with the list. */
export type ProcessStartsOfList = Map<number, Promise<string | undefined>>

/**
 * What a judgement found of a recording's writer.
 * - `may-run`: a writer of this machine that may still run (a live process that is the writer, as far as this machine can tell)
 * - `on-another-host`: a writer that may still run only because the recording names another host (its header alone, or a record of another machine), which this machine cannot probe; `host` is the name the recording gives it
 * - `gone`: the writer is gone, for good
 * - `left-to-caller`: this process's own recording, which the caller judges itself (`ignored`)
 */
export type RecordingWriterState =
  | { kind: 'may-run' }
  | { kind: 'on-another-host'; host: string }
  | { kind: 'gone' }
  | { kind: 'left-to-caller' }

/** The recordings whose writer this window found gone, by the record's path and the recording's creation time: a writer that is gone never comes back, so it is not judged again for as long as this window runs. */
const goneWriters = new Set<string>()

/**
 * Gives the reader of process starts for one list: each process id is read once, and every judgement of that list that asks for it shares the read, also one under way; called by {@link recordingWriterState} for the reads of {@link isRecordedOwnerGone} and {@link hasIdGoneToALaterProcess}.
 * Within one list a process's start is read once and answers every recording of that list, whatever start a record expects: the caller compares. A later list reads again ({@link readProcessStart} keeps no start of another process by itself).
 * @param starts - The starts of the list.
 * @returns A reader with the signature of {@link readProcessStart}.
 * @example const readStart = readStartOncePerList(new Map()); await readStart(4242); await readStart(4242) // one query
 */
function readStartOncePerList(starts: ProcessStartsOfList): ProcessStartReader {
  return (pid, inputs) => {
    const kept = starts.get(pid)
    if (kept) return kept
    const read = readProcessStart(pid, inputs)
    starts.set(pid, read)
    return read
  }
}

/**
 * Judges a recording's writer by the record of its full identity that this build keeps outside the recording ({@link recordingOwnerRecordPath}), as a storage lock's owner is judged ({@link isRecordedOwnerGone}); called by {@link recordingWriterState} when that record exists.
 * The editor's machine id and the machine's pseudonyms tell this machine after its host name changed (macOS follows the network) and another machine with the same host name; the process start tells a process id that went to another process.
 * @param owner - The record of the writer.
 * @param header - What the header says of the writer; its host name names a writer whose record gives none.
 * @param ownProcess - Whether this process's own recording counts.
 * @param readStart - The list's reader of process starts ({@link readStartOncePerList}).
 * @returns `on-another-host` for a record of another machine, which is not probed; `left-to-caller` with `ignored` for this process's own recording; `gone` once a writer of this machine is gone; `may-run` while it may still run.
 * @example await writerStateByRecord({ pid: 4242, hostname: 'laptop.lan', machineId: 'f3a1…', processStart: 'ps:Mon Oct  5 09:12:33 2026' }, header, 'counts', readStart) // => { kind: 'gone' } once process 4242 is another process
 */
async function writerStateByRecord(
  owner: RecordedOwner,
  header: RecordingWriterOfHeader,
  ownProcess: OwnProcessRule,
  readStart: ProcessStartReader,
): Promise<RecordingWriterState> {
  const identity = await currentStorageOwner()
  // A writer of another machine cannot be probed from here: it may run, there.
  if (!isSameStorageMachine(owner, identity))
    return {
      kind: 'on-another-host',
      host: owner.hostname ?? header.owner.hostname,
    }
  // This process's own recording is left to the caller's own run state when it asks so.
  if (ownProcess === 'ignored' && owner.pid === process.pid)
    return { kind: 'left-to-caller' }
  return (await isRecordedOwnerGone(owner, identity, readStart))
    ? { kind: 'gone' }
    : { kind: 'may-run' }
}

/**
 * Says whether the process that has a recording writer's id now began after the recording was created, beyond the tolerance of a corrected clock: then it is another process, and the writer is gone; called by {@link writerStateByHeader} for a live process id of this host.
 * @param header - What the header says of the writer.
 * @param readStart - The list's reader of process starts ({@link readStartOncePerList}).
 * @returns `true` when the process began later than the recording's creation plus {@link STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS}; `false` when it began before, and when its start cannot be read: it may be the writer.
 * @example await hasIdGoneToALaterProcess({ owner: { pid: 4242, hostname: 'workstation' }, createdAt: '2026-10-05T09:00:00.000Z' }, readStart) // => true for a process that began at 10:00
 */
async function hasIdGoneToALaterProcess(
  header: RecordingWriterOfHeader,
  readStart: ProcessStartReader,
): Promise<boolean> {
  const start = await readStart(header.owner.pid).catch(() => undefined)
  const startedAtMs =
    start === undefined ? undefined : processStartedAtMs(start)
  return (
    startedAtMs !== undefined &&
    startedAtMs >
      Date.parse(header.createdAt) + STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS
  )
}

/**
 * Says whether a header names this very process as a recording's writer: its process id is this process's, and the recording was not created before this process began (by the clock, with the tolerance of a corrected clock); called by {@link writerStateByHeader} before it compares the host name, which can change while this window records (macOS takes it from the network).
 * @param header - What the header says of the writer.
 * @param readStart - The list's reader of process starts ({@link readStartOncePerList}); this process's own start is read once and kept ({@link readProcessStart}).
 * @returns `true` when the id is this process's and the recording began after it, or this process's start cannot be read; `false` for another process id, and for a recording created before this process began, which an earlier process of that id made.
 * @example await isThisProcessWriter({ owner: { pid: process.pid, hostname: 'laptop.home-network' }, createdAt: new Date().toISOString() }, readStart) // => true
 */
async function isThisProcessWriter(
  header: RecordingWriterOfHeader,
  readStart: ProcessStartReader,
): Promise<boolean> {
  if (header.owner.pid !== process.pid) return false
  const start = await readStart(process.pid).catch(() => undefined)
  const startedAtMs =
    start === undefined ? undefined : processStartedAtMs(start)
  return (
    startedAtMs === undefined ||
    Date.parse(header.createdAt) >=
      startedAtMs - STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS
  )
}

/**
 * Judges a recording's writer by its header alone, for a recording without a record of its full identity (one 0.2.29.0 made, or one whose record could not be written); called by {@link recordingWriterState}.
 * @param header - What the header says of the writer.
 * @param ownProcess - Whether this process's own recording counts.
 * @param readStart - The list's reader of process starts ({@link readStartOncePerList}).
 * @returns
 * - for this process's own recording ({@link isThisProcessWriter}), whatever host name the header gives: `left-to-caller` with `ignored`, `may-run` with `counts`
 * - `on-another-host` for a writer of another host name, which cannot be probed
 * - `gone` for a process of this host that is gone, and for one that began after the recording was created (its id went to another process: {@link hasIdGoneToALaterProcess})
 * - `may-run` for a live process of this host that began before the recording was created
 * @example await writerStateByHeader({ owner: { pid: 2 ** 22 + 1, hostname: hostname() }, createdAt }, 'counts', readStart) // => { kind: 'gone' }
 */
async function writerStateByHeader(
  header: RecordingWriterOfHeader,
  ownProcess: OwnProcessRule,
  readStart: ProcessStartReader,
): Promise<RecordingWriterState> {
  const { owner } = header
  // This window's own recording, also one whose host name changed while it records, is told first: it may run, or it is left to the caller's own run state.
  if (await isThisProcessWriter(header, readStart))
    return ownProcess === 'ignored'
      ? { kind: 'left-to-caller' }
      : { kind: 'may-run' }
  // Only a process of this machine can be probed; any other owner may still be writing.
  if (owner.hostname !== hostname())
    return { kind: 'on-another-host', host: owner.hostname }
  if (isProcessGone(owner.pid)) return { kind: 'gone' }
  return (await hasIdGoneToALaterProcess(header, readStart))
    ? { kind: 'gone' }
    : { kind: 'may-run' }
}

/**
 * Judges the editor process that writes an unsealed recording, the one rule for every judgment of a recording's writer: {@link isRecordingWriterLive} (what the library lists, the status {@link RecordingStore} gives a recording another session wrote) and the removal of a study ({@link LearningLibrary.removeStudy}), which tells a writer of this machine from one it cannot probe.
 * The record of the writer's full identity that this build keeps outside the recording decides when it exists ({@link writerStateByRecord}); a recording without one (made by 0.2.29.0) is judged by its header's host name and process id, a process id that went to a process begun after the recording counting as gone ({@link writerStateByHeader}).
 * Cost: a judgement may ask the system for a process's start (a PowerShell of up to {@link PROCESS_START_QUERY_TIMEOUT_MS} on Windows). A list hands every judgement of it one {@link ProcessStartsOfList}, so each process is asked once in that list; a writer found gone is not judged again while this window runs.
 * @param ownerRecordPath - The record of the recording's writer ({@link recordingOwnerRecordPath}); it may not exist.
 * @param header - What the recording's header says of its writer.
 * @param ownProcess - `counts` (the default) when this very process counts like any other writer; `ignored` when the caller judges its own recordings by its own run state.
 * @param starts - The process starts of the caller's list; a new one, for this judgement alone, when left out.
 * @returns What was found ({@link RecordingWriterState}).
 * @example
 * await recordingWriterState('/storage/learning/recording-owners/<id>.json', header) // => { kind: 'on-another-host', host: 'laptop.home-network' } for a recording of 0.2.29.0 made under an earlier host name
 */
export async function recordingWriterState(
  ownerRecordPath: string,
  header: RecordingWriterOfHeader,
  ownProcess: OwnProcessRule = 'counts',
  starts: ProcessStartsOfList = new Map(),
): Promise<RecordingWriterState> {
  const recording = `${ownerRecordPath}\n${header.createdAt}`
  if (goneWriters.has(recording)) return { kind: 'gone' }
  const readStart = readStartOncePerList(starts)
  const recordedOwner = await readRecordedOwner(ownerRecordPath)
  // The record of this build names the writer fully; a recording of 0.2.29.0 has its header alone.
  const state = recordedOwner
    ? await writerStateByRecord(recordedOwner, header, ownProcess, readStart)
    : await writerStateByHeader(header, ownProcess, readStart)
  if (state.kind === 'gone') goneWriters.add(recording)
  return state
}

/**
 * Says whether the editor process that writes an unsealed recording may still run, on this machine or on another one ({@link recordingWriterState}); called by the status {@link RecordingStore} gives a recording another session wrote (`unfinalized` while its writer may run, `interrupted` once it is gone).
 * @param ownerRecordPath - The record of the recording's writer ({@link recordingOwnerRecordPath}); it may not exist.
 * @param header - What the recording's header says of its writer.
 * @param ownProcess - `counts` (the default) when this very process counts like any other writer; `ignored` when the caller judges its own recordings by its own run state.
 * @param starts - The process starts of the caller's list; a new one, for this judgement alone, when left out.
 * @returns `true` while the writer may still run, on this machine or on another one; `false` once it is gone from this machine, and with `ignored` for this process.
 * @example
 * await isRecordingWriterLive('/storage/learning/recording-owners/<id>.json', header) // => false for a crashed editor whose process id another process has now
 * await isRecordingWriterLive(path, header, 'counts', starts) // every recording of one list with one `starts`
 */
export async function isRecordingWriterLive(
  ownerRecordPath: string,
  header: RecordingWriterOfHeader,
  ownProcess: OwnProcessRule = 'counts',
  starts: ProcessStartsOfList = new Map(),
): Promise<boolean> {
  const { kind } = await recordingWriterState(
    ownerRecordPath,
    header,
    ownProcess,
    starts,
  )
  return kind === 'may-run' || kind === 'on-another-host'
}
