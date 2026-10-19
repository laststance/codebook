import { hostname } from 'node:os'

import { STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS } from '../constants'
import type { RecordingHeader } from '../recordingSchemas'

import { currentStorageOwner } from './currentStorageOwner'
import { isProcessGone } from './isProcessGone'
import { isProcessOfAnotherUser } from './isProcessOfAnotherUser'
import { isRecordedOwnerGone } from './isRecordedOwnerGone'
import { isSameStorageMachine } from './isSameStorageMachine'
import { isOwnRecording } from './ownRecordingSessions'
import { processStartedAtMs } from './processStartedAtMs'
import { readProcessStart, type ProcessStartReader } from './readProcessStart'
import type { RecordedOwner } from './readRecordedOwner'
import { readRecordingWriterRecord } from './readRecordingWriterRecord'

/** What a recording's header says of its writer: the editor process (its id and its host name) and the time the recording was created. */
export type RecordingWriterOfHeader = {
  owner: Pick<RecordingHeader['owner'], 'pid' | 'hostname' | 'sessionId'>
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
 * - `unconfirmed-here`: a recording of this host whose writer's process id a live process has that this computer cannot confirm as the writer: one of another user whose start cannot be read here, or, for a recording with its header alone or with a record of its writer without the writer's start, one of another user or one that began, by the clock, after the recording. That is another process that got the id, or the writer itself, run with other rights or seen after a step of the clock (no comparison of wall-clock times is certain), so this is neither `gone` nor remembered
 * - `gone`: the writer is gone, for good
 * - `left-to-caller`: this process's own recording, which the caller judges itself (`ignored`)
 */
export type RecordingWriterState =
  | { kind: 'may-run' }
  | { kind: 'on-another-host'; host: string }
  | { kind: 'unconfirmed-here'; host: string }
  | { kind: 'gone' }
  | { kind: 'left-to-caller' }

/** The recordings whose writer this window found gone by the record of its full identity, by the recording's directory and creation time: such a writer never comes back, so it is not judged again for as long as this window runs. A judgement by the header alone is not kept: the record can appear after the header (it is written right after it), and then it decides. */
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
 * Judges a recording's writer by the record of its full identity that this build keeps outside the recording ({@link recordingOwnerRecordPath}), as a storage lock's owner is judged ({@link isRecordedOwnerGone}); called by {@link recordingWriterState} when that record exists and names this recording ({@link readRecordingWriterRecord}), and the recording is not this process's own ({@link isOwnRecording}).
 * The editor's machine id and the machine's pseudonyms tell this machine after its host name changed (macOS follows the network) and another machine with the same host name; the process start tells a process id that went to another process.
 * A record without its writer's start (one of a window whose start could not be read) proves no more than the header does once its process id is in use: that live process is judged as the header's is, by the recording's creation time ({@link liveWriterStateHere}). A record with a start proves nothing either when the process with its id belongs to another user and its start cannot be read here ({@link isUnreadableProcessOfAnotherUser}).
 * @param owner - The record of the writer.
 * @param header - What the header says of the writer; its host name names a writer whose record gives none.
 * @param readStart - The list's reader of process starts ({@link readStartOncePerList}).
 * @returns
 * - `on-another-host` for a record of another machine, which is not probed
 * - `gone` once a writer of this machine is gone ({@link isRecordedOwnerGone})
 * - for a record without a start whose process id is in use, what {@link liveWriterStateHere} answers: `unconfirmed-here` or `may-run`
 * - `unconfirmed-here` for a record with a start whose process id a process of another user has, whose start cannot be read here
 * - `may-run` otherwise, while it may still run
 * @example await writerStateByRecord({ pid: 4242, hostname: 'laptop.lan', machineId: 'f3a1…', processStart: 'ps:Mon Oct  5 09:12:33 2026' }, header, readStart) // => { kind: 'gone' } once process 4242 is another process
 */
async function writerStateByRecord(
  owner: RecordedOwner,
  header: RecordingWriterOfHeader,
  readStart: ProcessStartReader,
): Promise<RecordingWriterState> {
  const identity = await currentStorageOwner()
  // A writer of another machine cannot be probed from here: it may run, there.
  if (!isSameStorageMachine(owner, identity))
    return {
      kind: 'on-another-host',
      host: owner.hostname ?? header.owner.hostname,
    }
  if (await isRecordedOwnerGone(owner, identity, readStart))
    return { kind: 'gone' }
  const host = owner.hostname ?? header.owner.hostname
  // Without the writer's start the record proves no more than the header: its live process is judged as the header's is.
  if (owner.processStart === undefined)
    return liveWriterStateHere(owner.pid, header.createdAt, host, readStart)
  // A process of another user whose start cannot be read is not confirmed as the writer by the record's start.
  if (
    await isUnreadableProcessOfAnotherUser(
      owner.pid,
      owner.processStart,
      readStart,
    )
  )
    return { kind: 'unconfirmed-here', host }
  return { kind: 'may-run' }
}

/**
 * Says whether the live process that has a recorded writer's id belongs to another user ({@link isProcessOfAnotherUser}) and its start cannot be read here, so that the start the record keeps neither confirms it as the writer nor tells another process; called by {@link writerStateByRecord} for a record with a start that {@link isRecordedOwnerGone} did not call gone.
 * Windows refuses PowerShell the start of another user's process (and of one run as administrator); the read then takes the creation time from the process table ({@link readProcessStart}), and a start stays unread only where that query fails too, or where Linux hides other users' processes (`hidepid`). Such a record's writer would otherwise be judged running for as long as that process lives.
 * @param pid - The writer's process id, which a live process has.
 * @param recordedStart - The start the record keeps, which the reader is given as `expectedStart`.
 * @param readStart - The list's reader of process starts ({@link readStartOncePerList}); the start is read once per list.
 * @returns `true` for a process of another user whose start cannot be read; `false` for a process of this user, and for one whose start reads (the record's start then decided already).
 * @example await isUnreadableProcessOfAnotherUser(4, 'win:2026-10-05T09:12:33.1234567Z', readStart) // => true for the Windows System process, seen by a user who is no administrator
 */
async function isUnreadableProcessOfAnotherUser(
  pid: number,
  recordedStart: string,
  readStart: ProcessStartReader,
): Promise<boolean> {
  if (!isProcessOfAnotherUser(pid)) return false
  const liveStart = await readStart(pid, {
    expectedStart: recordedStart,
  }).catch(() => undefined)
  return liveStart === undefined
}

/**
 * Says whether the process that has a recording writer's id now began after the recording was created, beyond the tolerance of a corrected clock: then it is likely another process that got the id, but a step of the clock can make the writer itself look so, since a Linux start is computed from clock ticks and the boot time; called by {@link liveWriterStateHere}, which answers `unconfirmed-here` then.
 * @param pid - The writer's process id.
 * @param createdAt - When the recording was created.
 * @param readStart - The list's reader of process starts ({@link readStartOncePerList}).
 * @returns `true` when the process began later than the recording's creation plus {@link STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS}; `false` when it began before, and when its start cannot be read: it may be the writer.
 * @example await hasIdGoneToALaterProcess(4242, '2026-10-05T09:00:00.000Z', readStart) // => true for a process that began at 10:00
 */
async function hasIdGoneToALaterProcess(
  pid: number,
  createdAt: string,
  readStart: ProcessStartReader,
): Promise<boolean> {
  const start = await readStart(pid).catch(() => undefined)
  const startedAtMs =
    start === undefined ? undefined : processStartedAtMs(start)
  return (
    startedAtMs !== undefined &&
    startedAtMs > Date.parse(createdAt) + STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS
  )
}

/**
 * Judges the live process of this host that has a recording writer's id, when nothing but the recording's creation time tells whether it is the writer; called by {@link writerStateByHeader} for a header without a record of its writer, and by {@link writerStateByRecord} for a record without its writer's start, each once that id is known to be in use.
 * @param pid - The writer's process id, which a live process has.
 * @param createdAt - When the recording was created.
 * @param host - The host name the recording gives its writer, which an uncertain answer names.
 * @param readStart - The list's reader of process starts ({@link readStartOncePerList}).
 * @returns
 * - `unconfirmed-here` for a process of another user ({@link isProcessOfAnotherUser}), which an editor that writes this user's storage is not, unless it was run with other rights
 * - `unconfirmed-here` for a process that began, by the clock, after the recording was created ({@link hasIdGoneToALaterProcess})
 * - `may-run` for a process of this user that began before the recording was created, or whose start cannot be read
 * Neither `unconfirmed-here` is certain, so the learner decides.
 * @example await liveWriterStateHere(4242, '2026-10-05T09:00:00.000Z', 'workstation', readStart) // => { kind: 'unconfirmed-here', host: 'workstation' } for a process that began at 10:00
 */
async function liveWriterStateHere(
  pid: number,
  createdAt: string,
  host: string,
  readStart: ProcessStartReader,
): Promise<RecordingWriterState> {
  return isProcessOfAnotherUser(pid) ||
    (await hasIdGoneToALaterProcess(pid, createdAt, readStart))
    ? { kind: 'unconfirmed-here', host }
    : { kind: 'may-run' }
}

/**
 * Judges a recording's writer by its header alone, for a recording without a record of its full identity (one 0.2.29.0 made, one whose record could not be written, or another format's recording of the same id) that is not this process's own ({@link isOwnRecording}); called by {@link recordingWriterState}.
 * @param header - What the header says of the writer.
 * @param readStart - The list's reader of process starts ({@link readStartOncePerList}).
 * @returns
 * - `on-another-host` for a writer of another host name, which cannot be probed
 * - `gone` for a process of this host that is gone
 * - for a live process of this host, what {@link liveWriterStateHere} answers: `unconfirmed-here` or `may-run`
 * @example await writerStateByHeader({ owner: { pid: 2 ** 22 + 1, hostname: hostname(), sessionId }, createdAt }, readStart) // => { kind: 'gone' }
 */
async function writerStateByHeader(
  header: RecordingWriterOfHeader,
  readStart: ProcessStartReader,
): Promise<RecordingWriterState> {
  const { owner } = header
  // Only a process of this machine can be probed; any other owner may still be writing.
  if (owner.hostname !== hostname())
    return { kind: 'on-another-host', host: owner.hostname }
  if (isProcessGone(owner.pid)) return { kind: 'gone' }
  return liveWriterStateHere(
    owner.pid,
    header.createdAt,
    owner.hostname,
    readStart,
  )
}

/**
 * Judges the editor process that writes an unsealed recording, the one rule for every judgment of a recording's writer: {@link recordingWriterOf}, through which the library's list ({@link LearningLibrary.entryWithoutArchive}) and the removal of a study ({@link LearningLibrary.writerVerdictsOf}, before its storage lock) tell a writer of this machine from one it cannot confirm, and {@link isRecordingWriterLive}, through which only the status {@link RecordingStore.ownerState} gives a recording another session wrote.
 * This process's own recording ({@link isOwnRecording}: its header names this process and one of its writer sessions) is told first, before any machine or host check. Otherwise the record of the writer's full identity that this build keeps outside the recording decides when it exists and names this recording ({@link readRecordingWriterRecord}: the record is kept by the study id, which recordings of several formats can share); a recording without such a record (made by 0.2.29.0, or another format's recording of the same id) is judged by its header's host name and process id, a process id that a process of another user or a process begun after the recording has leaving the learner the choice (`unconfirmed-here`, {@link writerStateByHeader}); a record without the writer's start is judged as its header is, once its process id is in use.
 * Cost: a judgement may ask the system for a process's start (a PowerShell of up to {@link PROCESS_START_QUERY_TIMEOUT_MS} on Windows). A list hands every judgement of it one {@link ProcessStartsOfList}, so each process is asked once in that list; a writer its record shows gone is not judged again while this window runs (a judgement by the header alone is made again at every list).
 * @param directory - The directory of the recording, `<learning directory>/recordings.vN/<study id>`; its writer record ({@link recordingOwnerRecordPath}) may not exist, or may name another recording.
 * @param header - What the recording's header says of its writer.
 * @param ownProcess - `counts` (the default) when this very process counts like any other writer; `ignored` when the caller judges its own recordings by its own run state.
 * @param starts - The process starts of the caller's list; a new one, for this judgement alone, when left out.
 * @returns What was found ({@link RecordingWriterState}).
 * @example
 * await recordingWriterState('/storage/learning/recordings.v2/<id>', header) // => { kind: 'on-another-host', host: 'laptop.home-network' } for a recording of 0.2.29.0 made under an earlier host name
 */
export async function recordingWriterState(
  directory: string,
  header: RecordingWriterOfHeader,
  ownProcess: OwnProcessRule = 'counts',
  starts: ProcessStartsOfList = new Map(),
): Promise<RecordingWriterState> {
  // This window's own recording, by what this window knows, is told before any machine or host check: one whose host name changed while it records is still this window's.
  if (isOwnRecording(header.owner))
    return ownProcess === 'ignored'
      ? { kind: 'left-to-caller' }
      : { kind: 'may-run' }
  const recording = `${directory}\n${header.createdAt}`
  if (goneWriters.has(recording)) return { kind: 'gone' }
  const readStart = readStartOncePerList(starts)
  const recordedOwner = await readRecordingWriterRecord(
    directory,
    header.createdAt,
  )
  // The record of this build names the writer fully; a recording of 0.2.29.0, and another format's recording of the same id, has its header alone.
  const state = recordedOwner
    ? await writerStateByRecord(recordedOwner, header, readStart)
    : await writerStateByHeader(header, readStart)
  // Only a record's judgement is stable: a header's alone can change once the writer's record appears, so it is not remembered.
  if (state.kind === 'gone' && recordedOwner) goneWriters.add(recording)
  return state
}

/**
 * Judges what holds a sealed recording: the run that wrote it, while that run has not saved its study from a checkpoint taken after the seal, so that another window takes the recording neither for what is left of a removed study nor for something a removal may move; called by {@link recordingWriterOf} for a sealed recording with a readable header whose run has not released it ({@link isSealedRecordingReleased}); a released one is finished without this judgement.
 * A sealed recording keeps the record of its writer's full identity ({@link recordingOwnerRecordPath}) after its seal ({@link RecordingWriter.finish}) until its study is saved from a checkpoint its run took after the seal ({@link removeWriterRecordsOfSealedRecordings}), and that record decides, as it does for an unsealed recording ({@link writerStateByRecord}). Nothing holds a sealed recording without such a record (its study was saved so, it was made by 0.2.29.0, or its record could not be written), nor this window's own: this window lists the finished recording of its own run whose archive could not be saved yet, and Retry storage there writes the archive.
 * @param directory - The directory of the recording, `<learning directory>/recordings.vN/<study id>`.
 * @param header - What the recording's header says of its writer.
 * @param starts - The process starts of the caller's list; a new one, for this judgement alone, when left out.
 * @returns The state of the writer whose run may still save the study ({@link RecordingWriterState}: `may-run`, `on-another-host`, `unconfirmed-here`, or `gone`); `undefined` when nothing holds the recording, which is then finished.
 * @example
 * await sealedRecordingWriterState('/storage/learning/recordings.v2/<id>', header) // => { kind: 'may-run' } while another window of this machine has not saved that study
 * await sealedRecordingWriterState('/storage/learning/recordings.v2/<id>', header) // => undefined once that window saved it
 */
export async function sealedRecordingWriterState(
  directory: string,
  header: RecordingWriterOfHeader,
  starts: ProcessStartsOfList = new Map(),
): Promise<RecordingWriterState | undefined> {
  // This window's own run is judged by this window, by its header's session.
  if (isOwnRecording(header.owner)) return undefined
  const recordedOwner = await readRecordingWriterRecord(
    directory,
    header.createdAt,
  )
  // Without its writer's record a sealed recording waits for no save.
  if (!recordedOwner) return undefined
  // A record that names this very process (its id and its start on this machine) is this window's own as well.
  const identity = await currentStorageOwner()
  if (
    recordedOwner.pid === process.pid &&
    recordedOwner.processStart !== undefined &&
    recordedOwner.processStart === identity.processStart &&
    isSameStorageMachine(recordedOwner, identity)
  )
    return undefined
  return writerStateByRecord(
    recordedOwner,
    header,
    readStartOncePerList(starts),
  )
}

/**
 * Says whether the editor process that writes an unsealed recording may still run, on this machine or on another one ({@link recordingWriterState}); called only by the status {@link RecordingStore.ownerState} gives a recording another session wrote (`unfinalized` while its writer may run, `interrupted` once it is gone).
 * @param directory - The directory of the recording, `<learning directory>/recordings.vN/<study id>`.
 * @param header - What the recording's header says of its writer.
 * @param ownProcess - `counts` (the default) when this very process counts like any other writer; `ignored` when the caller judges its own recordings by its own run state.
 * @param starts - The process starts of the caller's list; a new one, for this judgement alone, when left out.
 * @returns `true` while the writer may still run, on this machine or on another one; `false` once it is gone from this machine, for a writer this computer cannot confirm (`unconfirmed-here`), and with `ignored` for this process.
 * @example
 * await isRecordingWriterLive('/storage/learning/recordings.v2/<id>', header) // => false for a crashed editor whose process id another process has now
 * await isRecordingWriterLive(directory, header, 'counts', starts) // every recording of one list with one `starts`
 */
export async function isRecordingWriterLive(
  directory: string,
  header: RecordingWriterOfHeader,
  ownProcess: OwnProcessRule = 'counts',
  starts: ProcessStartsOfList = new Map(),
): Promise<boolean> {
  const { kind } = await recordingWriterState(
    directory,
    header,
    ownProcess,
    starts,
  )
  return kind === 'may-run' || kind === 'on-another-host'
}
