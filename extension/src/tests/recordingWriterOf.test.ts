import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, constants as fsConstants, openSync } from 'node:fs'
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
import { readProcessStart } from '../utils/readProcessStart'
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
 * @returns The recording's study id, its folder, and the writer that can seal it.
 * @example const recording = await startRecording(storage)
 */
async function startRecording(
  storage: Awaited<ReturnType<typeof recordingStorage>>,
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
  )
  return {
    studyId,
    folder: join(storage.directory, 'recordings.v2', studyId),
    writer,
  }
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
 * @returns The answer's kind, with the host for `on-another-host`.
 * @example await writerOf(folder) // => { kind: 'gone' }
 */
async function writerOf(
  folder: string,
  ownProcess?: 'counts' | 'ignored',
): Promise<Record<string, unknown>> {
  const answer = await recordingWriterOf(folder, ownProcess)
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
  // Arrange: the recording was created ten minutes ago by a window that could not read its own start and crashed; a process that began just now has its id.
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  const laterProcess = await idleChild(context)
  await rewriteHeader(recording.folder, {
    owner: { pid: laterProcess.pid!, hostname: hostname() },
    createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  })
  await rewriteWriterRecord(storage.directory, recording.studyId, {
    pid: laterProcess.pid!,
    hostname: hostname(),
    processStart: undefined,
  })

  // Act
  const writer = await writerOf(recording.folder)

  // Assert
  assert.deepEqual(writer, { kind: 'unconfirmed-here', host: hostname() })
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

// Value: protects=a recording whose run ended, which no writer holds any more, whatever its header names; fails_when=a sealed recording, or a folder whose header cannot be read, is judged by the process its header names, so a sealed recording of a live window is taken for that window's reservation and stays unlisted, or a removal refuses it; why_new=Cycle 0046 review AF4: the seal had no test of its own once the yes-or-no form went; seam=the header, which names a live child process of the test, and a header the test makes unreadable
test('a sealed recording, and one whose header cannot be read, have no writer any more, whatever their header names', async (context) => {
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
    unreadable: { kind: 'finished' },
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
  // Arrange: one recording that is being written and one that was sealed.
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
      writerRecords: await readdir(join(storage.directory, 'recording-owners')),
    },
    {
      ownersRead: [true, true],
      everyRootEntryIsARecordingFolder: true,
      namesUnknownTo0_2_29_0: [],
      learningDirectory: ['recording-owners', 'recordings.v2'],
      writerRecords: [`${beingWritten.studyId}.json`],
    },
  )
})

// Value: protects=the record of a recording's writer lasting exactly as long as the writer, so it never judges a finished recording and never stays behind; fails_when=the record is not written when the recording starts (the recording is judged by its header alone), or stays after the seal; why_new=Cycle 0046 /ship review R10 (b); seam=none, the store's own start and seal
test('the record of a recording’s writer names this window’s process when the recording starts and is gone once the recording is sealed', async (context) => {
  // Arrange
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  const recordPath = recordingOwnerRecordPath(
    storage.directory,
    recording.studyId,
  )
  const recordAtStart: Record<string, unknown> = JSON.parse(
    await readFile(recordPath, 'utf8'),
  )

  // Act
  await recording.writer.finish(1)

  // Assert
  assert.deepEqual(
    {
      pid: recordAtStart.pid,
      hostname: recordAtStart.hostname,
      machineId: recordAtStart.machineId,
      processStart: recordAtStart.processStart,
      isRecordLeftAfterTheSeal: await isPresent(recordPath),
    },
    {
      pid: process.pid,
      hostname: hostname(),
      machineId: 'machine-a',
      processStart: await readProcessStart(process.pid),
      isRecordLeftAfterTheSeal: false,
    },
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
  // A read that waits on the pipe is let go at the end, so the test process can end in any case.
  context.after(() => {
    try {
      closeSync(
        openSync(headerPath, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK),
      )
    } catch {
      // Nothing waits on the pipe.
    }
  })

  // Act
  const listed = await withinBound(storage.library.list(), 5_000)
  const removal = await withinBound(
    storage.library.removeStudy(recording.studyId, async () => undefined),
    5_000,
  )

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
