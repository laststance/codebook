import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, test, type TestContext } from 'node:test'

import { z } from 'zod'

import { LearningLibrary } from '../learningLibrary'
import { retainedRecordingHeaderSchema } from '../recordingSchemas'
import { RecordingStore } from '../recordingStore'
import { useEditorMachineId } from '../utils/currentStorageOwner'
import { readProcessStart } from '../utils/readProcessStart'
import { recordingMayStillBeWritten } from '../utils/recordingMayStillBeWritten'
import { recordingOwnerRecordPath } from '../utils/recordingOwnerRecordPath'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { idleChild } from './utils/idleChild'
import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'

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
 * Rewrites the record of a recording's writer beside the recordings, for a test that names another editor process or another machine there.
 * @param storage - The test's storage.
 * @param studyId - The recording's study id.
 * @param change - The fields to put in the record.
 * @example await rewriteWriterRecord(storage, studyId, { machineId: 'machine-b' })
 */
async function rewriteWriterRecord(
  storage: Awaited<ReturnType<typeof recordingStorage>>,
  studyId: string,
  change: Record<string, unknown>,
): Promise<void> {
  const path = recordingOwnerRecordPath(storage.directory, studyId)
  const record: Record<string, unknown> = JSON.parse(
    await readFile(path, 'utf8'),
  )
  await writeFile(path, JSON.stringify({ ...record, ...change }))
}

/** Says whether a path holds anything. @example await isPresent('/tmp/x') // => false */
function isPresent(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  )
}

// Value: protects=the place of a crashed window's recording in the library when its process id went to another process of this machine; fails_when=a recording of 0.2.29.0 (a header, no record of its writer) is judged by its process id alone, so any process that got the id keeps the recording "being written" for good: the list hides it, a removal refuses it, and it still counts against the library's limit; why_new=Cycle 0046 /ship review R10 (a): no process start was compared for a recording; seam=the recording's header, which names a live child process of the test that began after the recording's creation time
test('a recording made by 0.2.29.0 on this host whose writer’s process id went to a process begun after the recording was created is no longer being written', async (context) => {
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
  const mayStillBeWritten = await recordingMayStillBeWritten(recording.folder)

  // Assert
  assert.equal(mayStillBeWritten, false)
})

// Value: protects=the recording of a crashed window on a computer whose host name changed since (macOS names itself after the network); fails_when=the writer is judged by the host name in the header, which is no longer this machine's, so the recording counts as written on another machine for good; why_new=Cycle 0046 /ship review R10 (b): the record of the writer's full identity is new; seam=the header and the record of the writer, which name the old host name, this editor's machine id and a process id of no process
test('a recording whose writer’s host name has changed since is judged by the record of its writer: of this machine, with a process that is gone, it is no longer being written', async (context) => {
  // Arrange
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rewriteHeader(recording.folder, {
    owner: { pid: ID_OF_NO_PROCESS, hostname: 'laptop.home-network' },
  })
  await rewriteWriterRecord(storage, recording.studyId, {
    pid: ID_OF_NO_PROCESS,
    hostname: 'laptop.home-network',
  })

  // Act
  const mayStillBeWritten = await recordingMayStillBeWritten(recording.folder)

  // Assert
  assert.equal(mayStillBeWritten, false)
})

// Value: protects=the recording another computer with the same host name is writing into a shared storage folder; fails_when=the writer is judged by the host name, so this machine probes the other machine's process id, finds no process, and lists or removes the recording while it is written; why_new=Cycle 0046 /ship review R10 (b); seam=the header, which names this host name and a process id of no process, and the record of the writer, which names another editor machine id
test('a recording whose record names another machine with this host name stays being written, although no process of its id runs here', async (context) => {
  // Arrange
  const storage = await recordingStorage(context)
  const recording = await startRecording(storage)
  await rewriteHeader(recording.folder, {
    owner: { pid: ID_OF_NO_PROCESS, hostname: hostname() },
  })
  await rewriteWriterRecord(storage, recording.studyId, {
    pid: ID_OF_NO_PROCESS,
    machineId: 'machine-b',
  })

  // Act
  const mayStillBeWritten = await recordingMayStillBeWritten(recording.folder)

  // Assert
  assert.equal(mayStillBeWritten, true)
})

// Value: protects=the recordings a window of 0.2.29.0 made (a header, no record of their writer), which keep the judgment they had; fails_when=a recording of another host, or of a live process that began before it, counts as no longer written (it is listed and removable while written), one of a gone process counts as written, or this window's own recording is not left to it on request; why_new=Cycle 0046 /ship review R10: the record of the writer is new, and a recording without it must behave as before but for the process start; seam=the headers, without records of their writers
test('a recording made by 0.2.29.0 is judged by its header as before: written on another host or by a live process begun before it, no longer written once its process is gone', async (context) => {
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
    ofAnotherHost: await recordingMayStillBeWritten(ofAnotherHost.folder),
    ofAGoneProcess: await recordingMayStillBeWritten(ofAGoneProcess.folder),
    ofAnEarlierProcess: await recordingMayStillBeWritten(
      ofAnEarlierProcess.folder,
    ),
    ofThisWindow: await recordingMayStillBeWritten(ofThisWindow.folder),
    ofThisWindowLeftToIt: await recordingMayStillBeWritten(
      ofThisWindow.folder,
      'ignored',
    ),
  }

  // Assert
  assert.deepEqual(answers, {
    ofAnotherHost: true,
    ofAGoneProcess: false,
    ofAnEarlierProcess: true,
    ofThisWindow: true,
    ofThisWindowLeftToIt: false,
  })
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
  await rewriteWriterRecord(storage, removed.studyId, { pid: ID_OF_NO_PROCESS })
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
      mayStillBeWritten: await recordingMayStillBeWritten(recording.folder),
    },
    {
      isRecordingStarted: true,
      fileAtTheFolderPath: 'a file',
      mayStillBeWritten: true,
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
