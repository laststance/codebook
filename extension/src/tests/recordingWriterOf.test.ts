import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { before, test, type TestContext } from 'node:test'

import { z } from 'zod'

import type * as libraryModule from '../learningLibrary'
import { LearningLibrary } from '../learningLibrary'
import { retainedRecordingHeaderSchema } from '../recordingSchemas'
import type * as storeModule from '../recordingStore'
import { RecordingStore } from '../recordingStore'
import { useEditorMachineId } from '../utils/currentStorageOwner'
import type * as judgeModule from '../utils/isRecordingWriterLive'
import type { ProcessStartsOfList } from '../utils/isRecordingWriterLive'
import type * as lookModule from '../utils/lookAtRecording'
import { openWithoutFollowing } from '../utils/openWithoutFollowing'
import { readProcessStart } from '../utils/readProcessStart'
import type * as regularFileModule from '../utils/readWikiRegularFile'
import { recordingOwnerRecordPath } from '../utils/recordingOwnerRecordPath'
import type * as writerModule from '../utils/recordingWriterOf'
import { recordingWriterOf } from '../utils/recordingWriterOf'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { idleChild } from './utils/idleChild'
import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'
import { loadModule } from './utils/loadModule'
import { rewriteWriterRecord } from './utils/rewriteWriterRecord'

// The editor's id of this machine, which stays the same when the host name follows the network; every record this file's windows write names it.
before(() => {
  useEditorMachineId('machine-a', undefined)
})

/**
 * Creates a private learning directory with a recording store and a study library that share it, removed with the test.
 * @param context - The test whose teardown removes the directory.
 * @example const storage = await recordingStorage(context)
 */
async function recordingStorage(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'codebook-recording-writer-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'learning')
  const workspaceKey = createConfiguredStudy().workspaceKey
  return {
    directory,
    workspaceKey,
    recordings: new RecordingStore(
      directory,
      workspaceKey,
      {},
      undefined,
      () => 4,
    ),
    library: new LearningLibrary(directory, workspaceKey, () => 4),
  }
}

/**
 * Starts one recording of a run that has not saved its study, as this window's store starts it, and leaves it unsealed.
 * @param storage - The test's storage.
 * @param version - The recording format: 2 (the configured runs' `recordings.v2`, the default) or 3 (`recordings.v3`).
 * @returns The recording's study id, its folder, and the writer that can seal it.
 * @example const recording = await startRecording(storage)
 */
async function startRecording(
  storage: Awaited<ReturnType<typeof recordingStorage>>,
  version: 2 | 3 = 2,
) {
  const instanceId = randomUUID(),
    runId = randomUUID()
  const studyId = `${instanceId}_${runId}`
  const writer = await storage.recordings.start(
    {
      workspaceKey: storage.workspaceKey,
      studyId,
      instanceId,
      runId,
      runtimeId: randomUUID(),
      profile: 'repository-browser',
      sourceBuild: {
        revision: 'writer-test',
        dirty: false,
        sourceHash: '1'.repeat(64),
      },
    },
    0,
    version,
  )
  return {
    studyId,
    folder: join(storage.directory, `recordings.v${version}`, studyId),
    writer,
  }
}

/**
 * Saves the study of a recording in the library that shares its storage, as the run's checkpoint saves it: a configured study with the recording's study id.
 * @param storage - The test's storage.
 * @param studyId - The recording's study id, `<instance id>_<run id>`.
 * @example await saveStudyOfRecording(storage, recording.studyId)
 */
async function saveStudyOfRecording(
  storage: Awaited<ReturnType<typeof recordingStorage>>,
  studyId: string,
): Promise<void> {
  const study = createConfiguredStudy()
  const [instanceId = '', runId = ''] = studyId.split('_')
  for (const observation of study.observations)
    observation.snapshotUri = observation.snapshotUri
      .replace(study.instanceId, instanceId)
      .replace(study.runId, runId)
  study.instanceId = instanceId
  study.runId = runId
  study.id = studyId
  await storage.library.saveStudy(study)
}

/**
 * Rewrites what a recording's header says of its writer, for a test that names another editor process or another creation time.
 * @param folder - The recording's folder.
 * @param change - The owner fields and the creation time to put in the header.
 * @example await rewriteHeader(folder, { owner: { pid: 4242 } })
 */
async function rewriteHeader(
  folder: string,
  change: { owner?: Record<string, unknown>; createdAt?: string },
): Promise<void> {
  const header: { owner: Record<string, unknown> } = JSON.parse(
    await readFile(join(folder, 'header.json'), 'utf8'),
  )
  await writeFile(
    join(folder, 'header.json'),
    JSON.stringify({
      ...header,
      ...change,
      owner: { ...header.owner, ...change.owner },
    }),
  )
}

/**
 * Says what {@link recordingWriterOf} finds of one recording's writer, without the recording's creation time, which the tests of the removal's dialog pin (it names that time).
 * @param folder - The recording's folder.
 * @param ownProcess - Whether this test process's own recording counts (`counts`, the default) or is left to the caller (`ignored`).
 * @param starts - The process starts the judgement takes as read in its list, for a test that names a start that cannot be read; read from the system when left out.
 * @returns The answer's kind, with the host for `on-another-host` and `unconfirmed-here`.
 * @example await writerOf(folder) // => { kind: 'gone' }
 */
async function writerOf(
  folder: string,
  ownProcess?: 'counts' | 'ignored',
  starts?: ProcessStartsOfList,
): Promise<Record<string, unknown>> {
  const answer = await recordingWriterOf(folder, ownProcess, starts)
  return Object.fromEntries(
    Object.entries(answer).filter(([field]) => field !== 'createdAt'),
  )
}

/** Says whether a path holds anything. @example await isPresent('/tmp/x') // => false */
function isPresent(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  )
}

// Value: protects=the place of a crashed window's recording in the library when its process id went to another process of this machine, and a live writer whose start a step of the clock moved; fails_when=a recording of 0.2.29.0 (a header, no record of its writer) is judged by its process id alone, so any process that got the id keeps the recording "being written" for good (R10 (a)), or the wall-clock comparison is taken as certain, so a live writer after a clock step counts as gone, is remembered so, and is removed without the learner's choice (CX13); why_new=Cycle 0046 /ship review R10 (a), and Codex review CX13: no comparison of wall-clock times is certain; seam=the recording's header, which names a live child process of the test that began after the recording's creation time
test('a recording made by 0.2.29.0 on this host whose writer’s process id a live process has that began after the recording was created has a writer this computer cannot confirm', async (context) => {
  // Arrange: the recording was created ten minutes ago by a window that crashed; a process that began just now has its id.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rm(recordingOwnerRecordPath(storage.directory, recording.studyId))
  const laterProcess = await idleChild(context)
  await rewriteHeader(recording.folder, {
    owner: { pid: laterProcess.pid!, hostname: hostname() },
    createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  })

  // Act
  const writer = await writerOf(recording.folder)

  // Assert
  assert.deepEqual(writer, { kind: 'unconfirmed-here', host: hostname() })
})

// Value: protects=the place of a crashed window's recording whose record of its writer has no process start (the window could not read its own start), once its process id went to a later process of this machine; fails_when=such a record is judged by its process id alone, so the later process keeps the recording "being written" for good and its study can never be removed, where a header alone gives the learner the choice (CX13); why_new=Cycle 0046 adversarial review AD9: a record without a start proves no more than the header; seam=the record of the writer without its start, and the header, which both name a live child process of the test that began after the recording's creation time
test('a recording whose record of its writer has no process start, and whose process id a live process has that began after the recording was created, has a writer this computer cannot confirm', async (context) => {
  // Arrange: the recording was created ten minutes ago by a window that could not read its own start and crashed; a process that began just now has its id. The record names the recording by its folder and its creation time, as the window wrote it.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  const laterProcess = await idleChild(context)
  const createdAt = new Date(Date.now() - 10 * 60_000).toISOString()
  await rewriteHeader(recording.folder, {
    owner: { pid: laterProcess.pid!, hostname: hostname() },
    createdAt,
  })
  await rewriteWriterRecord(storage.directory, recording.studyId, {
    pid: laterProcess.pid!,
    hostname: hostname(),
    processStart: undefined,
    recording: { folder: 'recordings.v2', createdAt },
  })

  // Act
  const writer = await writerOf(recording.folder)

  // Assert
  assert.deepEqual(writer, { kind: 'unconfirmed-here', host: hostname() })
})

// Value: protects=the place of a crashed window's recording whose writer's process id went to a process of another user, whose start Windows does not give this user; fails_when=the probe's refusal (EPERM) counts as the writer running and the unreadable start confirms nothing, so the recording counts as written for as long as that process lives, the removal refuses for good and tells the learner to stop a run in a window that does not exist; or a record whose start confirms the writer, run with other rights, loses that answer; why_new=Cycle 0046 adversarial review AD21: an editor that writes this user's storage runs as this user; seam=the process probe, which answers EPERM for the process id of no process, and the list's starts, in which that process's start cannot be read or is the start the record keeps
test('a recording whose writer’s process id a process of another user has, whose start this user cannot read, has a writer this computer cannot confirm, by its header and by its record; a start that confirms the record’s writer keeps it running', async (context) => {
  // Arrange: two recordings of this host, one with its header alone and one with a record of its writer, name a process id that the probe answers as another user's.
  const storage = await recordingStorage(context)
  const byHeader = await startRecording(storage)
  await rm(recordingOwnerRecordPath(storage.directory, byHeader.studyId))
  await rewriteHeader(byHeader.folder, {
    owner: { pid: ID_OF_NO_PROCESS, hostname: hostname() },
  })
  const byRecord = await startRecording(storage)
  const recordedStart = await readProcessStart(process.pid)
  await rewriteHeader(byRecord.folder, {
    owner: { pid: ID_OF_NO_PROCESS, hostname: hostname() },
  })
  await rewriteWriterRecord(storage.directory, byRecord.studyId, {
    pid: ID_OF_NO_PROCESS,
    processStart: recordedStart,
  })
  const kill = process.kill.bind(process)
  context.mock.method(
    process,
    'kill',
    (pid: number, signal?: string | number): true => {
      if (pid === ID_OF_NO_PROCESS)
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      return kill(pid, signal)
    },
  )

  // Act
  const writers = {
    byHeader: await writerOf(
      byHeader.folder,
      'counts',
      new Map([[`${ID_OF_NO_PROCESS}`, Promise.resolve(undefined)]]),
    ),
    byRecord: await writerOf(
      byRecord.folder,
      'counts',
      new Map([
        [`${ID_OF_NO_PROCESS} ${recordedStart}`, Promise.resolve(undefined)],
      ]),
    ),
    byRecordWithItsStart: await writerOf(
      byRecord.folder,
      'counts',
      new Map([
        [
          `${ID_OF_NO_PROCESS} ${recordedStart}`,
          Promise.resolve(recordedStart),
        ],
      ]),
    ),
  }

  // Assert
  assert.deepEqual(writers, {
    byHeader: { kind: 'unconfirmed-here', host: hostname() },
    byRecord: { kind: 'unconfirmed-here', host: hostname() },
    byRecordWithItsStart: { kind: 'may-run' },
  })
})

/**
 * Leaves a recording of an existing study id in another recording format's folder as a window of 0.2.29.0 leaves it, a header without a record of its writer, naming this host and a process id of no process: its header alone calls its writer gone.
 * @param storage - The test's storage.
 * @param studyId - The study id of a recording the store started in the other format.
 * @param folderName - The recording format's folder, `recordings.v2` or `recordings.v3`.
 * @param createdAt - When the recording was created; the same time as the other recording's makes their folders alone tell them apart.
 * @returns The recording's folder.
 * @example const headerOnly = await headerOnlyRecordingBeside(storage, recording.studyId, 'recordings.v2', createdAt)
 */
async function headerOnlyRecordingBeside(
  storage: Awaited<ReturnType<typeof recordingStorage>>,
  studyId: string,
  folderName: 'recordings.v2' | 'recordings.v3',
  createdAt: string,
): Promise<string> {
  const folder = join(storage.directory, folderName, studyId)
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'header.json'),
    JSON.stringify({
      owner: {
        pid: ID_OF_NO_PROCESS,
        hostname: hostname(),
        sessionId: randomUUID(),
      },
      createdAt,
    }),
  )
  return folder
}

// Value: protects=the recording of one study id in one recording format's folder that its own header judges, while a recording of the id in another format has the writer record; fails_when=the record, which is kept by the study id, judges every recording of the id, so the header-only recording takes the other recording's writer (here one of another machine) and is listed and refused as that writer's (AF10); why_new=Cycle 0046 review AF10: a record names the recording it was written for; seam=the record of the recordings.v3 recording, which the test makes name machine-b, and a recordings.v2 header of this host with a process id of no process, without a record, created at the very same time, so that the folder alone tells the two recordings apart (TT38)
test('a recording without its own writer record is judged by its header, although a recording of the same id in another format, created at the same time, has a record', async (context) => {
  // Arrange: recordings.v3/<id> has the record, which names machine-b; recordings.v2/<id>, created at the same time, has its header alone, which names this host and a process id of no process.
  const storage = await recordingStorage(context)
  const recorded = await startRecording(storage, 3)
  await rewriteHeader(recorded.folder, {
    owner: { pid: ID_OF_NO_PROCESS, sessionId: randomUUID() },
  })
  await rewriteWriterRecord(storage.directory, recorded.studyId, {
    pid: ID_OF_NO_PROCESS,
    machineId: 'machine-b',
  })
  const { createdAt } = JSON.parse(
    await readFile(join(recorded.folder, 'header.json'), 'utf8'),
  )
  const headerOnly = await headerOnlyRecordingBeside(
    storage,
    recorded.studyId,
    'recordings.v2',
    createdAt,
  )

  // Act
  const writers = {
    recorded: await writerOf(recorded.folder),
    headerOnly: await writerOf(headerOnly),
  }

  // Assert
  assert.deepEqual(writers, {
    recorded: { kind: 'on-another-host', host: hostname() },
    headerOnly: { kind: 'gone' },
  })
})

// Value: protects=a recording whose writer record names no recording, as a window of an earlier build of this delivery wrote it, which may be another format's record; fails_when=such a record is used for any recording of the id, so the header-only rules (the rules of 0.2.29.0, which leave the learner the choice where they cannot tell) are skipped for a recording the record may not be about (AF10); why_new=Cycle 0046 review AF10: the compatibility choice for a record without a recording is to ignore it; seam=the record, from which the test drops the recording it names and which it makes name machine-b, and the header, which names this host and a process id of no process
test('a writer record that names no recording, as an earlier build of this delivery wrote it, is not used: the recording is judged by its header', async (context) => {
  // Arrange
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rewriteHeader(recording.folder, {
    owner: { pid: ID_OF_NO_PROCESS, hostname: hostname() },
  })
  await rewriteWriterRecord(storage.directory, recording.studyId, {
    pid: ID_OF_NO_PROCESS,
    machineId: 'machine-b',
    recording: undefined,
  })

  // Act
  const writer = await writerOf(recording.folder)

  // Assert
  assert.deepEqual(writer, { kind: 'gone' })
})

// Value: protects=the writer record of another recording of the same study id when the study of one sealed recording is saved after the seal, the save that removes a sealed recording's record since Cycle 0047 row 98; fails_when=that removal removes the record kept by the study id whatever recording it names, so the other recording loses the record that judges it (AF10); why_new=Cycle 0047 row 242 (P2CORE-2): the test acted on the seal, which since row 98 removes no record, so it could not fail; seam=the record, which the test makes name the recordings.v3 recording of the id, the seal of the recordings.v2 recording by this window's writer, and the library's save of the study that follows it
test('the save that follows the seal of a recording removes only its own writer record and leaves the record of another recording of the same id', async (context) => {
  // Arrange: the store started recordings.v2/<id>; its record now names recordings.v3/<id>, as that recording's start would have written it.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  const recordPath = recordingOwnerRecordPath(
    storage.directory,
    recording.studyId,
  )
  await rewriteWriterRecord(storage.directory, recording.studyId, {
    recording: {
      folder: 'recordings.v3',
      createdAt: '2026-10-01T08:00:00.000Z',
    },
  })

  // Act
  await recording.writer.finish(1)
  await saveStudyOfRecording(storage, recording.studyId)

  // Assert
  assert.deepEqual(
    {
      isRecordPresent: await isPresent(recordPath),
      namedRecording: await readFile(recordPath, 'utf8').then(
        (text) => JSON.parse(text).recording,
        () => 'no record',
      ),
    },
    {
      isRecordPresent: true,
      namedRecording: {
        folder: 'recordings.v3',
        createdAt: '2026-10-01T08:00:00.000Z',
      },
    },
  )
})

// Value: protects=the recording of a crashed window on a computer whose host name changed since (macOS names itself after the network); fails_when=the writer is judged by the host name in the header, which is no longer this machine's, so the recording counts as written on another machine for good; why_new=Cycle 0046 /ship review R10 (b): the record of the writer's full identity is new; seam=the header and the record of the writer, which name the old host name, this editor's machine id and a process id of no process
test('a recording whose writer’s host name has changed since is judged by the record of its writer: of this machine, with a process that is gone, its writer is gone', async (context) => {
  // Arrange
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rewriteHeader(recording.folder, {
    owner: { pid: ID_OF_NO_PROCESS, hostname: 'laptop.home-network' },
  })
  await rewriteWriterRecord(storage.directory, recording.studyId, {
    pid: ID_OF_NO_PROCESS,
    hostname: 'laptop.home-network',
  })

  // Act
  const writer = await writerOf(recording.folder)

  // Assert
  assert.deepEqual(writer, { kind: 'gone' })
})

// Value: protects=the recording another computer with the same host name is writing into a shared storage folder; fails_when=the writer is judged by the host name, so this machine probes the other machine's process id, finds no process, and lists or removes the recording while it is written; why_new=Cycle 0046 /ship review R10 (b); seam=the header, which names this host name and a process id of no process, and the record of the writer, which names another editor machine id
test('a recording whose record names another machine with this host name has a writer on another host, although no process of its id runs here', async (context) => {
  // Arrange
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rewriteHeader(recording.folder, {
    owner: { pid: ID_OF_NO_PROCESS, hostname: hostname() },
  })
  await rewriteWriterRecord(storage.directory, recording.studyId, {
    pid: ID_OF_NO_PROCESS,
    machineId: 'machine-b',
  })

  // Act
  const writer = await writerOf(recording.folder)

  // Assert
  assert.deepEqual(writer, { kind: 'on-another-host', host: hostname() })
})

// Value: protects=the recording another computer is writing into a storage folder of a home folder it shares with this one, and so the editor's machine id (VS Code keeps it in the user data folder); fails_when=an equal machine id alone makes the two one machine, so this machine probes the other's process id, finds no process, and lists the recording as interrupted, and its removal moves it with no dialog (a regression against 0.2.29.0, which compared host names); why_new=Cycle 0046 adversarial review AD3; seam=the header and the record of the writer, which name another host name, this editor's machine id, another kernel boot and a process id of no process
test('a recording whose record names this editor’s machine id under another host name and another boot has a writer on another host, although no process of its id runs here', async (context) => {
  // Arrange
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rewriteHeader(recording.folder, {
    owner: { pid: ID_OF_NO_PROCESS, hostname: 'lab-18' },
  })
  await rewriteWriterRecord(storage.directory, recording.studyId, {
    pid: ID_OF_NO_PROCESS,
    hostname: 'lab-18',
    machineId: 'machine-a',
    boot: { id: 'boot-of-lab-18' },
  })

  // Act
  const writer = await writerOf(recording.folder)

  // Assert
  assert.deepEqual(writer, { kind: 'on-another-host', host: 'lab-18' })
})

// Value: protects=the recordings a window of 0.2.29.0 made (a header, no record of their writer), which keep the judgment they had; fails_when=a recording of another host, or of a live process that began before it, counts as no longer written (it is listed and removable while written), one of a gone process counts as written, or this window's own recording is not left to it on request; why_new=Cycle 0046 /ship review R10: the record of the writer is new, and a recording without it must behave as before but for the process start; seam=the headers, without records of their writers
test('a recording made by 0.2.29.0 is judged by its header as before: its writer is on another host, may run when it is a live process begun before it, and is gone once its process is gone', async (context) => {
  // Arrange: four recordings without records of their writers; the live process of the third began before it.
  const storage = await recordingStorage(context)
  const earlierProcess = await idleChild(context)
  const ofAnotherHost = await startRecording(storage),
    ofAGoneProcess = await startRecording(storage),
    ofAnEarlierProcess = await startRecording(storage),
    ofThisWindow = await startRecording(storage)
  for (const recording of [
    ofAnotherHost,
    ofAGoneProcess,
    ofAnEarlierProcess,
    ofThisWindow,
  ])
    await rm(recordingOwnerRecordPath(storage.directory, recording.studyId))
  await rewriteHeader(ofAnotherHost.folder, {
    owner: { pid: ID_OF_NO_PROCESS, hostname: 'another-machine' },
  })
  await rewriteHeader(ofAGoneProcess.folder, {
    owner: { pid: ID_OF_NO_PROCESS, hostname: hostname() },
  })
  await rewriteHeader(ofAnEarlierProcess.folder, {
    owner: { pid: earlierProcess.pid!, hostname: hostname() },
  })

  // Act
  const answers = {
    ofAnotherHost: await writerOf(ofAnotherHost.folder),
    ofAGoneProcess: await writerOf(ofAGoneProcess.folder),
    ofAnEarlierProcess: await writerOf(ofAnEarlierProcess.folder),
    ofThisWindow: await writerOf(ofThisWindow.folder),
    ofThisWindowLeftToIt: await writerOf(ofThisWindow.folder, 'ignored'),
  }

  // Assert
  assert.deepEqual(answers, {
    ofAnotherHost: { kind: 'on-another-host', host: 'another-machine' },
    ofAGoneProcess: { kind: 'gone' },
    ofAnEarlierProcess: { kind: 'may-run' },
    ofThisWindow: { kind: 'may-run' },
    ofThisWindowLeftToIt: { kind: 'left-to-caller' },
  })
})

// Value: protects=a recording whose run ended, which no writer holds any more, whatever its header names, and a folder whose header stands and cannot be read, which names no writer and proves none absent; fails_when=a sealed recording is judged by the process its header names, so a sealed recording of a live window is taken for that window's reservation and stays unlisted, or a removal refuses it; or a header that stands and gives nothing counts as finished, so a removal moves without the learner's choice a recording whose header a scanner holds while another window still records it or still has to save it (Cycle 0047 row 251, which changed this case's answer from finished to unreadable); why_new=Cycle 0046 review AF4: the seal had no test of its own once the yes-or-no form went; seam=the header, which names a live child process of the test, and a header the test makes unreadable
test('a sealed recording has no writer any more, whatever its header names, and one whose header stands and cannot be read is unreadable', async (context) => {
  // Arrange: two recordings whose headers name a live process of this machine; one is sealed, the other's header is no JSON.
  const storage = await recordingStorage(context)
  const liveProcess = await idleChild(context)
  const sealed = await startRecording(storage),
    unreadable = await startRecording(storage)
  await sealed.writer.finish(1)
  await rewriteHeader(sealed.folder, {
    owner: { pid: liveProcess.pid!, hostname: hostname() },
  })
  await writeFile(join(unreadable.folder, 'header.json'), 'no JSON')

  // Act
  const answers = {
    sealed: await writerOf(sealed.folder),
    unreadable: await writerOf(unreadable.folder),
  }

  // Assert
  assert.deepEqual(answers, {
    sealed: { kind: 'finished' },
    unreadable: { kind: 'unreadable' },
  })
})

// Value: protects=this window's own live run whose recording has only its header (its writer's record could not be written) while this computer's host name changed during the run (macOS takes it from the network); fails_when=the host name is compared before the process id, so this window's own reservation counts as a recording of another computer: Saved studies lists it as what is left of a removed study, and a removal offers to move it; why_new=Cycle 0046 security review SX1; seam=the recording's header, which names this test process under another host name, without a record of its writer
test('a recording whose header names this window’s own process under another host name is this window’s: it may run, it is left to this window when asked, and it is not listed', async (context) => {
  // Arrange: this window's run, recording under the host name it had when it began.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rm(recordingOwnerRecordPath(storage.directory, recording.studyId))
  await rewriteHeader(recording.folder, {
    owner: { pid: process.pid, hostname: 'laptop.home-network' },
  })

  // Act
  const answers = {
    counted: await writerOf(recording.folder),
    leftToThisWindow: await writerOf(recording.folder, 'ignored'),
    listed: (await storage.library.list()).map((entry) => entry.id),
  }

  // Assert
  assert.deepEqual(answers, {
    counted: { kind: 'may-run' },
    leftToThisWindow: { kind: 'left-to-caller' },
    listed: [],
  })
})

// Value: protects=the live recording of another computer whose editor has this window's process id, in a shared storage folder, with its header alone; fails_when=the process id and a creation time after this window began are taken for proof that the recording is this window's, so it is left to this window ('ignored') and a removal moves it with no dialog while the other computer records (S1); why_new=Cycle 0046 third review S1: only the session this window gave its own headers proves it; seam=the recording's header, which names another host, this test process's id, a creation time of now and a session of no store of this process, without a record of its writer
test('a recording of another computer whose editor has this window’s process id, created after this window began, has a writer on another host', async (context) => {
  // Arrange: the header names another host and this process's id, now, with another editor's session.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rm(recordingOwnerRecordPath(storage.directory, recording.studyId))
  await rewriteHeader(recording.folder, {
    owner: {
      pid: process.pid,
      hostname: 'other-computer.lan',
      sessionId: randomUUID(),
    },
    createdAt: new Date().toISOString(),
  })

  // Act
  const answers = {
    counted: await writerOf(recording.folder),
    leftToThisWindow: await writerOf(recording.folder, 'ignored'),
  }

  // Assert
  assert.deepEqual(answers, {
    counted: { kind: 'on-another-host', host: 'other-computer.lan' },
    leftToThisWindow: { kind: 'on-another-host', host: 'other-computer.lan' },
  })
})

// Value: protects=this window's own live recording whose writer record cannot prove one machine (it names no editor's machine id) after the host name changed during the run, and the recording of another computer whose editor has this window's process id and a writer record; fails_when=the record's machine is compared before the recording is told this window's own, so this window's run counts as one of another host (listed, and offered to the learner's dialog), or the record's process id alone makes another computer's recording this window's (S17); why_new=Cycle 0046 third OCR review S17: S1's rule must hold for the record path too; seam=the header and the writer record of two recordings: this window's, with another host name in both and no machine id in the record, and another computer's, with this process's id and another session in the header and another host name and machine id in the record
test('this window’s recording whose host name changed is its own also when its writer record cannot prove one machine, and another computer’s recording with this window’s process id and a record is another host’s', async (context) => {
  // Arrange
  const storage = await recordingStorage(context)
  const ofThisWindow = await startRecording(storage)
  await rewriteHeader(ofThisWindow.folder, {
    owner: { hostname: 'laptop.home-network' },
  })
  await rewriteWriterRecord(storage.directory, ofThisWindow.studyId, {
    hostname: 'laptop.home-network',
    machineId: undefined,
  })
  const ofAnotherComputer = await startRecording(storage)
  await rewriteHeader(ofAnotherComputer.folder, {
    owner: {
      pid: process.pid,
      hostname: 'other-computer.lan',
      sessionId: randomUUID(),
    },
  })
  await rewriteWriterRecord(storage.directory, ofAnotherComputer.studyId, {
    hostname: 'other-computer.lan',
    machineId: 'machine-b',
  })

  // Act
  const answers = {
    ofThisWindowCounted: await writerOf(ofThisWindow.folder),
    ofThisWindowLeftToIt: await writerOf(ofThisWindow.folder, 'ignored'),
    ofAnotherComputerLeftToThisWindow: await writerOf(
      ofAnotherComputer.folder,
      'ignored',
    ),
  }

  // Assert
  assert.deepEqual(answers, {
    ofThisWindowCounted: { kind: 'may-run' },
    ofThisWindowLeftToIt: { kind: 'left-to-caller' },
    ofAnotherComputerLeftToThisWindow: {
      kind: 'on-another-host',
      host: 'other-computer.lan',
    },
  })
})

// Value: protects=the live recording of an earlier editor process that had this window's process id (before a restart, or a process this id went to before), under another host name; fails_when=the process id alone makes the recording this window's, so it is left to this window ('ignored') and a removal moves it with no dialog (TT34; S1's rule: only this window's own session proves it); why_new=Cycle 0046 third testing review TT34: only the positive case of this window's own recording was pinned; seam=the recording's header, which names this test process's id, another host, a creation time an hour before this process began and another session, without a record of its writer
test('a recording of an earlier process with this window’s process id, created before this window began, is not this window’s: its writer is on another host', async (context) => {
  // Arrange: the header names this process's id under another host, an hour before this process began, with another editor's session.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rm(recordingOwnerRecordPath(storage.directory, recording.studyId))
  await rewriteHeader(recording.folder, {
    owner: {
      pid: process.pid,
      hostname: 'laptop.home-network',
      sessionId: randomUUID(),
    },
    createdAt: new Date(
      Date.now() - process.uptime() * 1_000 - 60 * 60_000,
    ).toISOString(),
  })

  // Act
  const leftToThisWindow = await writerOf(recording.folder, 'ignored')

  // Assert
  assert.deepEqual(leftToThisWindow, {
    kind: 'on-another-host',
    host: 'laptop.home-network',
  })
})

// Value: protects=this window's own live recording under a host name that changed during the run, while this window's own process start cannot be read (a PowerShell or ps query that fails); fails_when=telling this window's own recording needs this process's start, so its own reservation counts as another host's whenever the start cannot be read: Saved studies lists it and a removal offers the dialog (TT36; the SX1 defect again); why_new=Cycle 0046 third testing review TT36: S1 tells it by this window's session, which needs no start; seam=the list's starts, in which this process's start cannot be read, and the header, which names this test process under another host name
test('this window’s recording under a changed host name is still its own while this window’s own process start cannot be read', async (context) => {
  // Arrange: this window's run, recording under the host name it had when it began; the start of this process reads as unknown.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rm(recordingOwnerRecordPath(storage.directory, recording.studyId))
  await rewriteHeader(recording.folder, {
    owner: { pid: process.pid, hostname: 'laptop.home-network' },
  })
  const startsWithoutOwn = (): ProcessStartsOfList =>
    new Map([[`${process.pid}`, Promise.resolve(undefined)]])

  // Act
  const answers = {
    counted: await writerOf(recording.folder, 'counts', startsWithoutOwn()),
    leftToThisWindow: await writerOf(
      recording.folder,
      'ignored',
      startsWithoutOwn(),
    ),
  }

  // Assert
  assert.deepEqual(answers, {
    counted: { kind: 'may-run' },
    leftToThisWindow: { kind: 'left-to-caller' },
  })
})

// Value: protects=the plain refusal for a live writer of this machine whose record names its start, while that start cannot be read here (a PowerShell or ps query that times out); fails_when=AD21's gate is skipped for a process of this user, so an unreadable start makes such a writer 'unconfirmed-here' and the learner is offered "Move to Trash Anyway" for a recording a live window still writes (TT35); why_new=Cycle 0046 third testing review TT35: the AD21 test used a process of another user only; seam=the header and the record, which name a live child process of the test (this user's) with its own start, and the list's starts, in which that start cannot be read
test('a live writer of this user whose recorded start cannot be read here may still run', async (context) => {
  // Arrange: another window of this user, a live child process, whose start the record keeps; its start reads as unknown in this list.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  const otherWindow = await idleChild(context)
  await rewriteHeader(recording.folder, {
    owner: {
      pid: otherWindow.pid!,
      hostname: hostname(),
      sessionId: randomUUID(),
    },
  })
  const recordedStart = await readProcessStart(otherWindow.pid!)
  await rewriteWriterRecord(storage.directory, recording.studyId, {
    pid: otherWindow.pid!,
    processStart: recordedStart,
  })

  // Act
  const writer = await writerOf(
    recording.folder,
    'ignored',
    new Map([
      [`${otherWindow.pid!} ${recordedStart}`, Promise.resolve(undefined)],
    ]),
  )

  // Assert
  assert.deepEqual(writer, { kind: 'may-run' })
})

// Value: protects=a live writer of this host whose computed start lies just after its recording's creation time, as a corrected clock or the rounding of a computed start puts it; fails_when=the 60 s tolerance of the later-process rule is dropped, so such a writer counts as one this computer cannot confirm and the learner is offered "Move to Trash Anyway" for a recording it still writes (TT45); why_new=Cycle 0046 third testing review TT45: no test sat at the tolerance; seam=the list's starts, which give a live child process of the test a start 30 s and 90 s after the recording's creation, and the header without a record of its writer
test('a live writer whose start lies 30 s after the recording was created may still run, and one 90 s after is one this computer cannot confirm', async (context) => {
  // Arrange: a recording of this host with its header alone, created at 09:00:00; a live process has its writer's id.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rm(recordingOwnerRecordPath(storage.directory, recording.studyId))
  const liveProcess = await idleChild(context)
  await rewriteHeader(recording.folder, {
    owner: {
      pid: liveProcess.pid!,
      hostname: hostname(),
      sessionId: randomUUID(),
    },
    createdAt: '2026-10-18T09:00:00.000Z',
  })
  const startedAt = (start: string): ProcessStartsOfList =>
    new Map([[`${liveProcess.pid!}`, Promise.resolve(`win:${start}`)]])

  // Act
  const writers = {
    thirtySecondsAfter: await writerOf(
      recording.folder,
      'counts',
      startedAt('2026-10-18T09:00:30.0000000Z'),
    ),
    ninetySecondsAfter: await writerOf(
      recording.folder,
      'counts',
      startedAt('2026-10-18T09:01:30.0000000Z'),
    ),
  }

  // Assert
  assert.deepEqual(writers, {
    thirtySecondsAfter: { kind: 'may-run' },
    ninetySecondsAfter: { kind: 'unconfirmed-here', host: hostname() },
  })
})

// Value: protects=a recording whose writer record was left by an earlier recording of the same study id in the same format folder (a start after a restart that could not write its own record); fails_when=the record's creation time is not compared, so the earlier recording's writer (here one of another machine) judges the new recording, which is then listed and refused as that writer's (TT39); why_new=Cycle 0046 third testing review TT39: the creation-time half of AF10 had no test; seam=the record, which the test makes name machine-b and another creation time in the same folder, and the header, which names this host and a process id of no process
test('a writer record that names an earlier recording in the same folder is not used: the recording is judged by its header', async (context) => {
  // Arrange: the record names recordings.v2/<id> created on 2026-10-01; the recording there now was created later.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rewriteHeader(recording.folder, {
    owner: { pid: ID_OF_NO_PROCESS, sessionId: randomUUID() },
  })
  await rewriteWriterRecord(storage.directory, recording.studyId, {
    pid: ID_OF_NO_PROCESS,
    machineId: 'machine-b',
    recording: {
      folder: 'recordings.v2',
      createdAt: '2026-10-01T08:00:00.000Z',
    },
  })

  // Act
  const writer = await writerOf(recording.folder)

  // Assert
  assert.deepEqual(writer, { kind: 'gone' })
})

// Value: protects=every list and removal while a recording's header.json is a valid header padded past a header's bound (a damaged or hostile storage folder); fails_when=the header's bound is not applied, so a header of any size up to the Wiki's 64 MiB is parsed, names a writer, and is read at every list (TT40); why_new=Cycle 0046 third testing review TT40: AD11's bound had no test with a header that would parse; seam=the recording's header.json, the store's own header with a padding field that takes it past 65 536 bytes
test('a valid recording header padded past a header’s bound is no header: the recording counts as finished', async (context) => {
  // Arrange: the recording's own header, padded to more than 64 KiB.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  const header: Record<string, unknown> = JSON.parse(
    await readFile(join(recording.folder, 'header.json'), 'utf8'),
  )
  await writeFile(
    join(recording.folder, 'header.json'),
    JSON.stringify({ ...header, padding: 'x'.repeat(70_000) }),
  )

  // Act
  const writer = await writerOf(recording.folder)

  // Assert
  assert.deepEqual(writer, { kind: 'finished' })
})

// Value: protects=every judgement of a recording's writer while its writer record is a valid record padded past a record's bound (a damaged or hostile storage folder); fails_when=the record's bound is not applied, so a record of any size up to the Wiki's 64 MiB is read whole and judges the recording (here as another machine's) (TT41, S5); why_new=Cycle 0046 third testing review TT41: the writer record's bound had no test; seam=the record, which the test makes name machine-b and pads past 65 536 bytes, and the header, which names this host and a process id of no process
test('a valid writer record padded past a record’s bound is no record: the recording is judged by its header', async (context) => {
  // Arrange: the record names machine-b and is padded to more than 64 KiB; the header names this host and a process id of no process.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rewriteHeader(recording.folder, {
    owner: { pid: ID_OF_NO_PROCESS, sessionId: randomUUID() },
  })
  await rewriteWriterRecord(storage.directory, recording.studyId, {
    pid: ID_OF_NO_PROCESS,
    machineId: 'machine-b',
    padding: 'x'.repeat(70_000),
  })

  // Act
  const writer = await writerOf(recording.folder)

  // Assert
  assert.deepEqual(writer, { kind: 'gone' })
})

// Value: protects=the judgement of a recording's writer while a link (a junction on Windows) stands at the place of the folder of writer records and leads to a valid record that names the recording; fails_when=the record is read through that link and judges the recording (here as another machine's), so a file a link puts there decides whether a recording is listed and moved (TT37, CX14's read); why_new=Cycle 0046 third testing review TT37: the file behind the link in CX14's test never parsed as a record; seam=a link at `recording-owners` to a folder of the test with a valid record that names the recording and machine-b, and the header, which names this host and a process id of no process
test('a valid writer record behind a link at the place of the folder of writer records is not read: the recording is judged by its header', async (context) => {
  // Arrange: the recording's header names this host and a process id of no process; its folder of records is a link to a folder with a valid record of machine-b that names it.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rewriteHeader(recording.folder, {
    owner: { pid: ID_OF_NO_PROCESS, sessionId: randomUUID() },
  })
  const { createdAt } = JSON.parse(
    await readFile(join(recording.folder, 'header.json'), 'utf8'),
  )
  const elsewhere = join(storage.directory, '..', 'elsewhere')
  await mkdir(elsewhere)
  await writeFile(
    join(elsewhere, `${recording.studyId}.json`),
    JSON.stringify({
      pid: ID_OF_NO_PROCESS,
      hostname: 'other-computer.lan',
      machineId: 'machine-b',
      recording: { folder: 'recordings.v2', createdAt },
    }),
  )
  await rm(join(storage.directory, 'recording-owners'), { recursive: true })
  await symlink(
    elsewhere,
    join(storage.directory, 'recording-owners'),
    'junction',
  )

  // Act
  const writer = await writerOf(recording.folder)

  // Assert
  assert.deepEqual(writer, { kind: 'gone' })
})

// Value: protects=the recording another computer with this host name is writing into a shared storage folder, seen by this window in the instant after its header appeared and before its writer's record did; fails_when=the judgement by the header alone ('gone': no process of that id runs here) is remembered for the window's lifetime, so the record that names the other machine is never read and a Delete removes the live recording; why_new=Cycle 0046 Codex review CX11: P1 remembered every 'gone'; seam=the record of the writer, removed and then put back naming another machine, between two judgements of one window
test('a writer judged gone by its header alone is judged again by its record once the record appears', async (context) => {
  // Arrange: the header names this host and a process id of no process; the record that names the other machine comes after it.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  const recordPath = recordingOwnerRecordPath(
    storage.directory,
    recording.studyId,
  )
  const record: Record<string, unknown> = JSON.parse(
    await readFile(recordPath, 'utf8'),
  )
  await rm(recordPath)
  await rewriteHeader(recording.folder, {
    owner: { pid: ID_OF_NO_PROCESS, hostname: hostname() },
  })
  const byTheHeaderAlone = await writerOf(recording.folder)
  await writeFile(
    recordPath,
    JSON.stringify({
      ...record,
      pid: ID_OF_NO_PROCESS,
      machineId: 'machine-b',
    }),
  )

  // Act
  const byTheRecord = await writerOf(recording.folder)

  // Assert
  assert.deepEqual(
    { byTheHeaderAlone, byTheRecord },
    {
      byTheHeaderAlone: { kind: 'gone' },
      byTheRecord: { kind: 'on-another-host', host: hostname() },
    },
  )
})

/** The owner of a recording's header as 0.2.29.0 reads it (its `recordingSchemas.ts`, `z.strictObject` of these three fields): any other field makes it refuse the recording. */
const OWNER_AS_0_2_29_0_READS_IT = z.strictObject({
  pid: z.number().int().positive(),
  hostname: z.string().min(1),
  sessionId: z.uuid(),
})

/** The names 0.2.29.0 accepts in a recording's folder (its `RecordingStore.inventory`): any other name makes it refuse the recording with "Recording contains unknown files.". */
const NAME_IN_A_RECORDING_AS_0_2_29_0_ACCEPTS_IT =
  /^(?:header\.json|frames\.jsonl|sealed\.json|context\.json|[a-f0-9]{64}\.png|(?:header|context|sealed)\.json\.[a-f0-9-]{36}\.tmp)$/

// Value: protects=a window of 0.2.29.0 that shares the storage (until it is reloaded after an update, and after a rollback), which must still list and replay what this build records; fails_when=this build writes the writer's identity into the header or the recording's folder, or puts any entry that is no recording folder into a recordings root, which 0.2.29.0 refuses ("Recording library contains a non-directory entry.", "Recording contains unknown files.", a header schema error); why_new=Cycle 0046 /ship review R10: the record of the writer is new and lies outside every recording; seam=none, the folders as this build writes them, read with 0.2.29.0's rules
test('the folders this build writes for a recording stay as 0.2.29.0 reads them: the header names its writer in the three fields it knows, and the record of the writer lies outside every recordings root', async (context) => {
  // Arrange: one recording that is being written and one that was sealed before its run saved its study, which keeps the record of its writer until that save (Cycle 0047 row 36).
  const storage = await recordingStorage(context)
  const beingWritten = await startRecording(storage),
    sealed = await startRecording(storage)
  await sealed.writer.finish(1)

  // Act
  const headers = await Promise.all(
    [beingWritten, sealed].map(async (recording) =>
      retainedRecordingHeaderSchema.parse(
        JSON.parse(
          await readFile(join(recording.folder, 'header.json'), 'utf8'),
        ),
      ),
    ),
  )
  const recordingsRoot = await readdir(
    join(storage.directory, 'recordings.v2'),
    {
      withFileTypes: true,
    },
  )
  const namesInRecordings = [
    ...(await readdir(beingWritten.folder)),
    ...(await readdir(sealed.folder)),
  ]

  // Assert
  assert.deepEqual(
    {
      ownersRead: headers.map(
        (header) => OWNER_AS_0_2_29_0_READS_IT.safeParse(header.owner).success,
      ),
      everyRootEntryIsARecordingFolder: recordingsRoot.every((entry) =>
        entry.isDirectory(),
      ),
      namesUnknownTo0_2_29_0: namesInRecordings.filter(
        (name) => !NAME_IN_A_RECORDING_AS_0_2_29_0_ACCEPTS_IT.test(name),
      ),
      learningDirectory: (await readdir(storage.directory)).sort(),
      writerRecords: (
        await readdir(join(storage.directory, 'recording-owners'))
      ).sort(),
    },
    {
      ownersRead: [true, true],
      everyRootEntryIsARecordingFolder: true,
      namesUnknownTo0_2_29_0: [],
      learningDirectory: ['recording-owners', 'recordings.v2'],
      writerRecords: [
        `${beingWritten.studyId}.json`,
        `${sealed.studyId}.json`,
      ].sort(),
    },
  )
})

// Value: protects=the record of a recording's writer lasting exactly as long as its run holds the recording, so it never judges a finished recording and never stays behind, also for a run whose checkpoint saved the study while it ran; fails_when=the record is not written when the recording starts (the recording is judged by its header alone), the seal removes it because a checkpoint saved the study before the seal, so the study's final state is not saved yet while nothing holds the recording (Cycle 0047 row 98, ADV-10), or the save that follows the seal leaves it; why_new=Cycle 0046 /ship review R10 (b); the record went at the seal of a recording whose study was saved until Cycle 0047 row 98 (ADV-10); seam=none, the store's own start and seal, and the library's saves
test('the record of a recording’s writer names this window’s process when the recording starts, stays at the seal after a checkpoint saved the study, and goes with the save that follows the seal', async (context) => {
  // Arrange: the run's checkpoint has saved its study before the recording is sealed.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await saveStudyOfRecording(storage, recording.studyId)
  const recordPath = recordingOwnerRecordPath(
    storage.directory,
    recording.studyId,
  )
  const recordAtStart: Record<string, unknown> = JSON.parse(
    await readFile(recordPath, 'utf8'),
  )

  // Act
  await recording.writer.finish(1)
  const isRecordLeftAfterTheSeal = await isPresent(recordPath)
  await saveStudyOfRecording(storage, recording.studyId)
  const isRecordLeftAfterTheSaveThatFollowsTheSeal = await isPresent(recordPath)

  // Assert
  assert.deepEqual(
    {
      pid: recordAtStart.pid,
      hostname: recordAtStart.hostname,
      machineId: recordAtStart.machineId,
      processStart: recordAtStart.processStart,
      isRecordLeftAfterTheSeal,
      isRecordLeftAfterTheSaveThatFollowsTheSeal,
    },
    {
      pid: process.pid,
      hostname: hostname(),
      machineId: 'machine-a',
      processStart: await readProcessStart(process.pid),
      isRecordLeftAfterTheSeal: true,
      isRecordLeftAfterTheSaveThatFollowsTheSeal: false,
    },
  )
})

// Value: protects=the finished recording of a run that has not saved its study yet, which another window must neither list as what is left of a removed study nor move to the Trash before that save; fails_when=the seal removes the record of the writer whatever the study's state, so nothing tells another window that the run still holds the recording, or the save leaves the record, so after the archive was removed by hand the rest stays unlisted while the writer runs; why_new=Cycle 0047 row 36 (P3RT14); seam=none, the store's own start and seal, and the library's save; no_claim=a second editor window (studyRemoval tests)
test('the record of a recording’s writer stays after the seal while the run has not saved its study, and goes with the study’s save', async (context) => {
  // Arrange
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  const recordPath = recordingOwnerRecordPath(
    storage.directory,
    recording.studyId,
  )

  // Act
  await recording.writer.finish(1)
  const isRecordLeftAfterTheSeal = await isPresent(recordPath)
  await saveStudyOfRecording(storage, recording.studyId)
  const isRecordLeftAfterTheSave = await isPresent(recordPath)

  // Assert
  assert.deepEqual(
    { isRecordLeftAfterTheSeal, isRecordLeftAfterTheSave },
    { isRecordLeftAfterTheSeal: true, isRecordLeftAfterTheSave: false },
  )
})

// Value: protects=no record of a writer outlives its recording: after a removal of the study, and after a recording was removed some other way (by hand, by 0.2.29.0, a crash between the two removals); fails_when=the record stays in the learning directory for good; why_new=Cycle 0046 /ship review R10 (b); seam=a record whose recording is gone, written as a removal by hand leaves it
test('the record of a recording’s writer goes with a removal of its study, and one whose recording is gone is removed at the next start of a recording', async (context) => {
  // Arrange: a recording whose run never saved its study, left by a crashed editor, and a record whose recording a learner removed by hand.
  const storage = await recordingStorage(context)
  const removed = await startRecording(storage)
  await rewriteHeader(removed.folder, {
    owner: { pid: ID_OF_NO_PROCESS, hostname: hostname() },
  })
  await rewriteWriterRecord(storage.directory, removed.studyId, {
    pid: ID_OF_NO_PROCESS,
  })
  const removedByHand = await startRecording(storage)
  await rm(removedByHand.folder, { recursive: true })
  const moved: string[] = []

  // Act
  const removal = await storage.library.removeStudy(
    removed.studyId,
    async (path) => {
      moved.push(path)
      await rm(path, { recursive: true })
    },
  )
  const recordsAfterTheRemoval = await readdir(
    join(storage.directory, 'recording-owners'),
  )
  const next = await startRecording(storage)

  // Assert
  assert.deepEqual(
    {
      removal,
      moved,
      recordsAfterTheRemoval,
      recordsAfterTheNextStart: await readdir(
        join(storage.directory, 'recording-owners'),
      ),
    },
    {
      removal: { outcome: 'moved' },
      moved: [removed.folder],
      recordsAfterTheRemoval: [`${removedByHand.studyId}.json`],
      recordsAfterTheNextStart: [`${next.studyId}.json`],
    },
  )
})

// Value: protects=a recording whose record of its writer cannot be written (a file stands where its folder would be) still starts, and is judged by its header; fails_when=the record is a condition of the start, so no run can be recorded; why_new=Cycle 0046 /ship review R10 (b): the record is a help, not a part of the recording; seam=a file at the folder's path
test('a recording starts without a record of its writer when a file stands where the records’ folder would be', async (context) => {
  // Arrange
  const storage = await recordingStorage(context)
  await mkdir(storage.directory, { recursive: true })
  await writeFile(join(storage.directory, 'recording-owners'), 'a file')

  // Act
  const recording = await startRecording(storage)

  // Assert
  assert.deepEqual(
    {
      isRecordingStarted: await isPresent(
        join(recording.folder, 'header.json'),
      ),
      fileAtTheFolderPath: await readFile(
        join(storage.directory, 'recording-owners'),
        'utf8',
      ),
      writer: await writerOf(recording.folder),
    },
    {
      isRecordingStarted: true,
      fileAtTheFolderPath: 'a file',
      writer: { kind: 'may-run' },
    },
  )
})

// Value: protects=the saved studies list and the recordings list of this build beside the folder of writer records; fails_when=the library or the recording store takes the folder, or a record in it, for a study, a recording or a leftover of one, and lists it or counts it; why_new=Cycle 0046 /ship review R10 (b): the folder is new in the learning directory; seam=none
test('the folder of writer records adds no entry to the saved studies or to the recordings', async (context) => {
  // Arrange: one recording that a run of this window still writes, whose writer's record lies in the folder.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)

  // Act
  const studies = await storage.library.list()
  const recordings = (await storage.recordings.list()).map(
    (entry) => entry.studyId,
  )

  // Assert
  assert.deepEqual(
    { studies, recordings, savedStudies: await storage.library.usage() },
    {
      studies: [],
      recordings: [recording.studyId],
      savedStudies: { count: 0, limit: 4 },
    },
  )
})

/**
 * Loads the recording store and the study library as a window runs them, with the one reader of process starts that judges recording writers ({@link isRecordingWriterLive}) counted: every process id that reader is asked for is noted.
 * @returns The two classes, and the process ids read, in the order they were asked for.
 * @example const observed = await windowWithCountedStartReads(); await new observed.RecordingStore(directory, workspaceKey).list(); observed.startReads // => [4242]
 */
async function windowWithCountedStartReads() {
  const startReads: number[] = []
  const judge = await loadModule<typeof judgeModule>(
    resolve(__dirname, '../utils/isRecordingWriterLive.js'),
    {
      './readProcessStart': {
        readProcessStart: (
          ...reading: Parameters<typeof readProcessStart>
        ): ReturnType<typeof readProcessStart> => {
          startReads.push(reading[0])
          return readProcessStart(...reading)
        },
      },
    },
    { Error },
  )
  const recordingJudgement = await loadModule<typeof writerModule>(
    resolve(__dirname, '../utils/recordingWriterOf.js'),
    { './isRecordingWriterLive': judge },
    { Error },
  )
  const { RecordingStore: ObservedStore } = await loadModule<
    typeof storeModule
  >(
    resolve(__dirname, '../recordingStore.js'),
    { './utils/isRecordingWriterLive': judge },
    { Error },
  )
  const { LearningLibrary: ObservedLibrary } = await loadModule<
    typeof libraryModule
  >(
    resolve(__dirname, '../learningLibrary.js'),
    { './utils/recordingWriterOf': recordingJudgement },
    { Error },
  )
  return {
    RecordingStore: ObservedStore,
    LearningLibrary: ObservedLibrary,
    startReads,
  }
}

/**
 * Starts four recordings of runs that saved no study and names their writers as two other windows would: three of a window that still runs (a live child process of the test, with its own start in each record), and one of a window that crashed, whose process id a later process has now (the record keeps the crashed window's start).
 * @param context - The test, at whose end the child processes end.
 * @param storage - The test's storage.
 * @returns The study ids of the live window's three recordings and of the crashed window's one.
 * @example const { ofLiveWindow, ofCrashedWindow } = await recordingsOfTwoOtherWindows(context, storage)
 */
async function recordingsOfTwoOtherWindows(
  context: TestContext,
  storage: Awaited<ReturnType<typeof recordingStorage>>,
) {
  const liveWindow = await idleChild(context),
    laterProcess = await idleChild(context)
  const liveStart = await readProcessStart(liveWindow.pid!)
  const ofLiveWindow: string[] = []
  for (let recordingIndex = 0; recordingIndex < 3; recordingIndex += 1) {
    const recording = await startRecording(storage)
    await rewriteHeader(recording.folder, {
      owner: { pid: liveWindow.pid!, hostname: hostname() },
    })
    await rewriteWriterRecord(storage.directory, recording.studyId, {
      pid: liveWindow.pid!,
      processStart: liveStart,
    })
    ofLiveWindow.push(recording.studyId)
  }
  const crashed = await startRecording(storage)
  await rewriteHeader(crashed.folder, {
    owner: { pid: laterProcess.pid!, hostname: hostname() },
  })
  await rewriteWriterRecord(storage.directory, crashed.studyId, {
    pid: laterProcess.pid!,
  })
  return {
    liveWindow: liveWindow.pid!,
    laterProcess: laterProcess.pid!,
    ofLiveWindow,
    ofCrashedWindow: crashed.studyId,
  }
}

// Value: protects=every refresh of the recordings list on Windows, where each read of a process's start is a PowerShell of up to 3 s; fails_when=the list asks the system for a writer's start once for each of its recordings instead of once for each process, or asks again on every list for a writer it already found gone; why_new=Cycle 0046 repeat review P1: the judgements of a list shared no read; seam=the reader of process starts of the loaded judgement, which counts the process ids it is asked for
test('the recordings list reads the start of each writer process once per list, and does not read again for a writer it found gone', async (context) => {
  // Arrange: three recordings of one live window and one of a crashed window, listed by another window twice.
  const storage = await recordingStorage(context)
  const writers = await recordingsOfTwoOtherWindows(context, storage)
  const observed = await windowWithCountedStartReads()
  const otherWindow = new observed.RecordingStore(
    storage.directory,
    storage.workspaceKey,
  )

  // Act
  const firstList = await otherWindow.list()
  const readsOfTheFirstList = observed.startReads.splice(0).sort()
  const secondList = await otherWindow.list()
  const readsOfTheSecondList = observed.startReads.splice(0).sort()

  // Assert
  const statusOf = (list: typeof firstList) =>
    Object.fromEntries(list.map((entry) => [entry.studyId, entry.status]))
  assert.deepEqual(
    {
      statuses: [statusOf(firstList), statusOf(secondList)],
      readsOfTheFirstList,
      readsOfTheSecondList,
    },
    {
      statuses: [
        Object.fromEntries([
          ...writers.ofLiveWindow.map((studyId) => [studyId, 'unfinalized']),
          [writers.ofCrashedWindow, 'interrupted'],
        ]),
        Object.fromEntries([
          ...writers.ofLiveWindow.map((studyId) => [studyId, 'unfinalized']),
          [writers.ofCrashedWindow, 'interrupted'],
        ]),
      ],
      readsOfTheFirstList: [writers.liveWindow, writers.laterProcess].sort(),
      readsOfTheSecondList: [writers.liveWindow],
    },
  )
})

// Value: protects=every refresh of the saved studies list on Windows; fails_when=the list's look for what is left of studies without an archive asks the system for a writer's start once for each recording instead of once for each process, or asks again for a writer it already found gone; why_new=Cycle 0046 repeat review P1; seam=the reader of process starts of the loaded judgement, which counts the process ids it is asked for
test('the saved studies list reads the start of each writer process once per list, and does not read again for a writer it found gone', async (context) => {
  // Arrange: three recordings of one live window and one of a crashed window, none of a saved study; another window lists the library twice.
  const storage = await recordingStorage(context)
  const writers = await recordingsOfTwoOtherWindows(context, storage)
  const observed = await windowWithCountedStartReads()
  const otherWindow = new observed.LearningLibrary(
    storage.directory,
    storage.workspaceKey,
    () => 4,
  )

  // Act
  const firstList = await otherWindow.list()
  const readsOfTheFirstList = observed.startReads.splice(0).sort()
  const secondList = await otherWindow.list()
  const readsOfTheSecondList = observed.startReads.splice(0).sort()

  // Assert
  assert.deepEqual(
    {
      listed: [firstList, secondList].map((list) =>
        // The loaded library builds its arrays in a realm of its own; they are compared as arrays of this one.
        Array.from(list, (entry) => entry.id),
      ),
      readsOfTheFirstList,
      readsOfTheSecondList,
    },
    {
      listed: [[writers.ofCrashedWindow], [writers.ofCrashedWindow]],
      readsOfTheFirstList: [writers.liveWindow, writers.laterProcess].sort(),
      readsOfTheSecondList: [writers.liveWindow],
    },
  )
})

// Value: protects=the live recording of a window whose process id an earlier, crashed window's recording names too, on Windows, where the start of a process this user may not read (one run as administrator) comes from the process table and confirms only the start it is asked for (row 33); fails_when=the list keeps one read per process id whatever start a record expects, so the earlier record's read (the table's time, which confirms no other start) answers the live window's record too: its writer is judged gone, a gone writer is not judged again while this window runs, and this window's Delete moves the live recording to the Trash, so the live window's next save throws StudyRemovedWithItsRecordingError; why_new=Cycle 0047 row 236 (P2CLA-2): the list's reads were kept by process id alone; seam=the reader of process starts of the loaded judgement, which answers for the live window's process as the Windows table does: the record's start when it is the one asked for, the table's time otherwise; no_claim=a real process table on Windows (row 33's tests read it)
test('a live window’s recording is judged by its own recorded start when an earlier recording of the same list names its process id with another start', async (context) => {
  // Arrange: a recording of a crashed window and one of a live window, both naming the live window's process id; the crashed one's record keeps an earlier start.
  const storage = await recordingStorage(context)
  const liveWindow = await idleChild(context)
  const liveStart = (await readProcessStart(liveWindow.pid!))!
  const startForm = liveStart.slice(0, liveStart.indexOf(':'))
  const crashedStart = `${startForm}:the start of the crashed window`
  const tableTime = `${startForm}:the creation time of the process table`
  const ofCrashedWindow = await startRecording(storage)
  const ofLiveWindow = await startRecording(storage)
  for (const [recording, processStart] of [
    [ofCrashedWindow, crashedStart],
    [ofLiveWindow, liveStart],
  ] as const) {
    await rewriteHeader(recording.folder, {
      owner: { pid: liveWindow.pid!, hostname: hostname() },
    })
    await rewriteWriterRecord(storage.directory, recording.studyId, {
      pid: liveWindow.pid!,
      processStart,
    })
  }
  const judge = await loadModule<typeof judgeModule>(
    resolve(__dirname, '../utils/isRecordingWriterLive.js'),
    {
      './readProcessStart': {
        readProcessStart: async (
          ...[pid, inputs]: Parameters<typeof readProcessStart>
        ): ReturnType<typeof readProcessStart> => {
          if (pid !== liveWindow.pid) return readProcessStart(pid, inputs)
          // The process table confirms only the start it is asked for; any other start is answered by the table's own time.
          return inputs?.expectedStart === liveStart ? liveStart : tableTime
        },
      },
    },
    { Error },
  )
  const { recordingWriterOf: judgedWriterOf } = await loadModule<
    typeof writerModule
  >(
    resolve(__dirname, '../utils/recordingWriterOf.js'),
    { './isRecordingWriterLive': judge },
    { Error },
  )
  const kindOf = async (
    folder: string,
    starts: ProcessStartsOfList,
  ): Promise<string> => (await judgedWriterOf(folder, 'counts', starts)).kind

  // Act: one list judges the crashed window's recording first; a later list, as a removal makes, judges the live one again.
  const oneList: ProcessStartsOfList = new Map()
  const inOneList = {
    ofCrashedWindow: await kindOf(ofCrashedWindow.folder, oneList),
    ofLiveWindow: await kindOf(ofLiveWindow.folder, oneList),
  }
  const ofLiveWindowInALaterList = await kindOf(ofLiveWindow.folder, new Map())

  // Assert
  assert.deepEqual(
    { inOneList, ofLiveWindowInALaterList },
    {
      inOneList: { ofCrashedWindow: 'gone', ofLiveWindow: 'may-run' },
      ofLiveWindowInALaterList: 'may-run',
    },
  )
})

/**
 * Answers what a call gave within a bound, or `timed out`, so a test of a read that may wait for good ends either way.
 * @param calling - The call.
 * @param boundMs - How long the test waits.
 * @returns The call's answer, or `timed out`.
 * @example await withinBound(library.list(), 5_000) // => [] or 'timed out'
 */
async function withinBound<Answer>(
  calling: Promise<Answer>,
  boundMs: number,
): Promise<Answer | 'timed out'> {
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<'timed out'>((resolveTimedOut) => {
    timer = setTimeout(() => resolveTimedOut('timed out'), boundMs)
  })
  try {
    return await Promise.race([calling, timedOut])
  } finally {
    clearTimeout(timer)
  }
}

// Value: protects=the memory and the time of every list and removal while a recording's header.json is a large file (a damaged or hostile storage folder); fails_when=the header is read whole under the Wiki's 64 MiB bound and only then refused for passing the header's bound, so a 48 MiB header is read five times per removal, two of them under the storage lock (S5); why_new=Cycle 0046 third review PD3-2 (S5); seam=the opener of a loaded readWikiRegularFile, whose handle counts the bytes it reads, under a loaded lookAtRecording
test('a recording’s header larger than a header may be is refused by its size, and none of its bytes is read', async (context) => {
  // Arrange: a run that saved no study, whose header.json is 1 MiB; the opener counts what is read through it.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await writeFile(
    join(recording.folder, 'header.json'),
    Buffer.alloc(1024 * 1024, 0x20),
  )
  let bytesRead = 0
  const regularFiles = await loadModule<typeof regularFileModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    {
      './openWithoutFollowing': {
        openWithoutFollowing: async (
          ...opening: Parameters<typeof openWithoutFollowing>
        ) => {
          const file = await openWithoutFollowing(...opening)
          const read = file.read.bind(file)
          file.read = async (...reading: Parameters<typeof file.read>) => {
            const result = await read(...reading)
            bytesRead += result.bytesRead
            return result
          }
          return file
        },
      },
    },
    { Error, RangeError },
  )
  const { lookAtRecording: lookWithCountedReads } = await loadModule<
    typeof lookModule
  >(
    resolve(__dirname, '../utils/lookAtRecording.js'),
    { './readWikiRegularFile': regularFiles },
    { Error },
  )

  // Act
  const look = await lookWithCountedReads(recording.folder)

  // Assert
  assert.deepEqual(
    { header: look.header, bytesRead },
    { header: undefined, bytesRead: 0 },
  )
})

/**
 * Lets every open that waits on a named pipe through and puts a regular file in the pipe's place, so that no later open waits on it; called by the named-pipe test once its library calls returned or timed out, before its storage is removed.
 * Why: a product that opens the pipe as a file that may block holds one thread of the test's process per open for good, and the process would never end.
 * @param pipePath - The pipe's path.
 * @example releaseThePipe('/tmp/…/recordings.v2/<id>/header.json')
 */
function releaseThePipe(pipePath: string): void {
  // An open for reading and writing never waits on a pipe, and as its writer it lets every waiting open through.
  let writer: number | undefined
  try {
    writer = openSync(pipePath, fsConstants.O_RDWR | fsConstants.O_NONBLOCK)
  } catch {
    // No pipe is there any more.
  }
  // A regular file takes the pipe's place, so an open the product makes afterwards does not wait.
  rmSync(pipePath, { force: true })
  writeFileSync(pipePath, '')
  // With its last writer closed, a read of the pipe that is under way ends.
  if (writer !== undefined) closeSync(writer)
}

// Value: protects=every list of Saved studies and every removal while a named pipe stands at a recording's header.json (a damaged or hostile storage folder); fails_when=the header is opened as a file that may block, so the open waits for a writer of the pipe for good and holds the list, the removal and the editor's process; why_new=Cycle 0046 adversarial review AD11; seam=a named pipe made at the header's path; on Windows, which has no named pipes in a folder, the test is skipped
test('a named pipe at a recording’s header neither holds the list of saved studies nor the removal of its study', async (context) => {
  if (process.platform === 'win32')
    return context.skip('Windows has no named pipe in a folder')
  // Arrange: a run that saved no study, whose header is a named pipe.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  const headerPath = join(recording.folder, 'header.json')
  await rm(headerPath)
  execFileSync('mkfifo', [headerPath])
  // Act
  let listed: Awaited<ReturnType<typeof storage.library.list>> | 'timed out'
  let removal:
    Awaited<ReturnType<typeof storage.library.removeStudy>> | 'timed out'
  try {
    listed = await withinBound(storage.library.list(), 5_000)
    removal = await withinBound(
      storage.library.removeStudy(recording.studyId, async () => undefined),
      5_000,
    )
  } finally {
    // Every open that still waits on the pipe is let go, before the storage is removed, and no later open can wait on it: a regression fails here instead of holding the test's process.
    releaseThePipe(headerPath)
  }

  // Assert
  assert.deepEqual(
    {
      listed: listed === 'timed out' ? listed : listed.map((entry) => entry.id),
      removal: removal === 'timed out' ? removal : removal.outcome,
    },
    { listed: [recording.studyId], removal: 'moved' },
  )
})

// Value: protects=a file of the learner's that a link (a junction on Windows) at the place of the folder of writer records leads to; fails_when=a record is written, removed at a study's removal or at a recording's seal, or read through that link, so an unrelated `<id>.json` is overwritten or deleted without the Trash, or taken for a writer; why_new=Cycle 0046 Codex review CX14: the record's write, read and removals followed the folder; seam=a link at `recording-owners` to a folder of the test that holds an unrelated file named like each recording's record
test('a link at the place of the folder of writer records is never followed: a recording’s start writes nothing through it, and a removal and a seal delete nothing behind it', async (context) => {
  // Arrange: two recordings, then their folder of records replaced by a link to a folder that holds an unrelated file named like each record.
  const storage = await recordingStorage(context)
  const removed = await startRecording(storage),
    sealed = await startRecording(storage)
  await rewriteHeader(removed.folder, {
    owner: { pid: ID_OF_NO_PROCESS, hostname: hostname() },
  })
  const elsewhere = join(storage.directory, '..', 'elsewhere')
  await mkdir(elsewhere)
  for (const recording of [removed, sealed])
    await writeFile(
      join(elsewhere, `${recording.studyId}.json`),
      'A file of the learner.',
    )
  await rm(join(storage.directory, 'recording-owners'), { recursive: true })
  await symlink(
    elsewhere,
    join(storage.directory, 'recording-owners'),
    'junction',
  )

  // Act
  const removal = await storage.library.removeStudy(
    removed.studyId,
    async (path) => rm(path, { recursive: true }),
  )
  await sealed.writer.finish(1)
  const started = await startRecording(storage)

  // Assert
  assert.deepEqual(
    {
      removal: removal.outcome,
      startedWriter: await writerOf(started.folder),
      behindTheLink: (await readdir(elsewhere)).sort(),
      contents: await Promise.all(
        [removed, sealed].map((recording) =>
          readFile(join(elsewhere, `${recording.studyId}.json`), 'utf8'),
        ),
      ),
    },
    {
      removal: 'moved',
      startedWriter: { kind: 'may-run' },
      behindTheLink: [
        `${removed.studyId}.json`,
        `${sealed.studyId}.json`,
      ].sort(),
      contents: ['A file of the learner.', 'A file of the learner.'],
    },
  )
})
