import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fsPromises, {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { isDeepStrictEqual } from 'node:util'

import type * as libraryModule from '../learningLibrary'
import { LearningLibrary, type StudyMover } from '../learningLibrary'
import { RecordingStore } from '../recordingStore'
import type * as lookModule from '../utils/lookAtRecording'
import { readProcessStart } from '../utils/readProcessStart'
import type * as writerRecordModule from '../utils/readRecordingWriterRecord'
import { readWikiRegularFile } from '../utils/readWikiRegularFile'
import { recordingOwnerRecordPath } from '../utils/recordingOwnerRecordPath'
import { recordingWriterOf } from '../utils/recordingWriterOf'
import { studyRemovalMessages } from '../utils/studyRemovalMessages'
import type * as lockModule from '../utils/withStorageLock'
import { withStorageLock } from '../utils/withStorageLock'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { createCrossRuntimeStudy } from './utils/createCrossRuntimeStudy'
import { idleChild } from './utils/idleChild'
import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'
import { loadModule } from './utils/loadModule'
import { rewriteWriterRecord } from './utils/rewriteWriterRecord'

/**
 * Creates a private learning directory with a study library and a recording store that share it and one limit, plus a Trash outside it.
 * The mover records every path it is asked to move, relative to the library, and really moves it into that Trash, as the editor's Trash does; `rejectAt` makes it fail for the paths a test names.
 * @param context - The test whose teardown removes the directories.
 * @param limit - The Saved Study Limit both stores read.
 * @example const storage = await removalStorage(context, 2)
 */
async function removalStorage(context: TestContext, limit: number) {
  const root = await mkdtemp(join(tmpdir(), 'codebook-removal-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'learning'),
    trash = join(root, 'trash')
  await mkdir(trash)
  const workspaceKey = createConfiguredStudy().workspaceKey
  const library = new LearningLibrary(directory, workspaceKey, () => limit),
    recordings = new RecordingStore(
      directory,
      workspaceKey,
      {},
      undefined,
      () => limit,
    )
  const moved: string[] = []
  let rejectAt: (path: string) => boolean = () => false
  const moveToTrash: StudyMover = async (path) => {
    const moving = relative(directory, path)
    if (rejectAt(moving)) throw new Error(`Trash refused ${basename(path)}`)
    moved.push(moving)
    await rename(path, join(trash, `${moved.length}-${basename(path)}`))
  }
  return {
    directory,
    workspaceKey,
    library,
    recordings,
    moved,
    moveToTrash,
    rejectMovesOf(matches: (path: string) => boolean): void {
      rejectAt = matches
    },
  }
}

/** Saves one distinct configured study without a recording, as a run leaves it whose recording was never started. @example const study = await saveStudy(storage) */
async function saveStudy(storage: Awaited<ReturnType<typeof removalStorage>>) {
  const study = createConfiguredStudy(),
    runId = randomUUID()
  for (const observation of study.observations)
    observation.snapshotUri = observation.snapshotUri.replace(
      study.runId,
      runId,
    )
  study.runId = runId
  study.id = `${study.instanceId}_${runId}`
  await storage.library.saveStudy(study)
  return study
}

/** Makes the learner ledger name a saved study as its selection, as opening the study in the reader does. @example await selectStudy(storage, study.id) */
async function selectStudy(
  storage: Awaited<ReturnType<typeof removalStorage>>,
  studyId: string,
): Promise<void> {
  await storage.library.select({
    studyId,
    profile: 'repository-browser',
    itemId: 'repository/interface/theme',
    follow: false,
    tab: 'overview',
  })
}

/** Saves one distinct configured study with a finished recording, as a stopped explained run leaves it. @example const study = await saveStudyWithRecording(storage) */
async function saveStudyWithRecording(
  storage: Awaited<ReturnType<typeof removalStorage>>,
) {
  const study = await saveStudy(storage),
    runId = study.runId
  const recording = await storage.recordings.start(
    {
      workspaceKey: study.workspaceKey,
      studyId: study.id,
      instanceId: study.instanceId,
      runId,
      runtimeId: randomUUID(),
      profile: study.profile,
      sourceBuild: {
        revision: 'removal-test',
        dirty: false,
        sourceHash: '1'.repeat(64),
      },
    },
    0,
  )
  await recording.finish(1)
  return study
}

/** Reads every file below a directory with its bytes, so a test can assert that a removal left other material byte-identical. @example assert.deepEqual(await filesBelow(directory), before) */
async function filesBelow(directory: string): Promise<[string, string][]> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
  return Promise.all(
    files.map(async (path): Promise<[string, string]> => [
      relative(directory, path),
      (await readFile(path)).toString('base64'),
    ]),
  )
}

/** Makes the removal of the storage lock file fail while the lock is held, so the lock cannot be released and stays, as a lock does whose file the editor may not delete. @example await blockLockRelease(context, storage.directory) */
async function blockLockRelease(
  context: TestContext,
  directory: string,
): Promise<void> {
  const lockPath = join(await realpath(directory), 'writer.lock')
  const unlinkBefore = fsPromises.unlink
  context.mock.method(
    fsPromises,
    'unlink',
    async (...input: Parameters<typeof unlinkBefore>) => {
      if (input[0] === lockPath)
        throw Object.assign(
          new Error(`EPERM: operation not permitted, unlink '${lockPath}'`),
          { code: 'EPERM' },
        )
      return unlinkBefore(...input)
    },
  )
}

// Value: protects=a removal moves exactly the study's files, the recording first and the archive last, and makes room in a full library; fails_when=a step is dropped, reordered or touches another study; why_new=no removal existed; seam=the injected mover, which keeps the library free of the editor API
test('removing a saved study moves its recording, its catalog sidecar and its archive to the Trash in that order and makes room in a full library', async (context) => {
  // Arrange: a library full at two studies, each with a recording, and one learner decision.
  const storage = await removalStorage(context, 2)
  const removed = await saveStudyWithRecording(storage),
    kept = await saveStudyWithRecording(storage)
  await storage.library.decide({
    id: '77777777-7777-4777-8777-777777777777',
    item: 'repository/interface/theme',
    sourceHash: 'a'.repeat(64),
    understood: true,
    context: { kind: 'source' },
    at: '2026-10-02T00:00:00.000Z',
  })
  const decisionsBefore = (await storage.library.readProgress()).decisions
  const keptFilesBefore = (await filesBelow(storage.directory)).filter(
    ([path]) => path.includes(kept.id),
  )
  const newStudyId = `${randomUUID()}_${randomUUID()}`
  assert.equal(await storage.library.admitsStudy(newStudyId), false)
  // Act
  const removal = await storage.library.removeStudy(
    removed.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(storage.moved, [
    join('recordings.v2', removed.id),
    `${removed.id}.study.meta.v3.json`,
    `${removed.id}.study.v3.json`,
  ])
  assert.deepEqual(
    (await storage.library.list()).map((entry) => entry.id),
    [kept.id],
  )
  assert.deepEqual(
    (await storage.recordings.list()).map((entry) => entry.studyId),
    [kept.id],
  )
  assert.equal(await storage.library.admitsStudy(newStudyId), true)
  assert.deepEqual(
    (await filesBelow(storage.directory)).filter(([path]) =>
      path.includes(kept.id),
    ),
    keptFilesBefore,
  )
  assert.equal(keptFilesBefore.length > 2, true)
  assert.deepEqual(
    (await storage.library.readProgress()).decisions,
    decisionsBefore,
  )
  assert.equal(decisionsBefore.length, 1)
})

// Value: protects=after a removal nothing the reader remembered points at the removed study, and what it remembered about other studies is untouched; fails_when=the ledger or the playback position keeps naming a study that is gone, or a removal rewrites a ledger that names another study; why_new=no removal existed; seam=the injected mover
test('removing a saved study forgets the remembered selection, repository return and playback position of that study only', async (context) => {
  // Arrange: the ledger and the playback position remember the study that will be removed.
  const storage = await removalStorage(context, 4)
  const removed = await saveStudyWithRecording(storage),
    other = await saveStudyWithRecording(storage)
  const article = {
    bookId: 'interface',
    revision: 1,
    nodeId: 'theme',
    anchorIndex: 0,
  }
  const selectionOf = (studyId: string) => ({
    studyId,
    profile: 'repository-browser' as const,
    itemId: 'repository/interface/theme' as const,
    follow: false,
    tab: 'overview' as const,
  })
  await storage.library.select(selectionOf(removed.id))
  await storage.library.rememberRepositoryReturn({
    studyId: removed.id,
    selection: article,
  })
  await storage.recordings.savePreference({
    version: 1,
    workspaceKey: storage.workspaceKey,
    studyId: removed.id,
    positionMs: 1_000,
  })
  // Act
  const removal = await storage.library.removeStudy(
    removed.id,
    storage.moveToTrash,
  )
  const progressAfterRemoval = await storage.library.readProgress()
  // Arrange again: now everything remembers the other study, and a third study is removed.
  const third = await saveStudyWithRecording(storage)
  await storage.library.select(selectionOf(other.id))
  await storage.library.rememberRepositoryReturn({
    studyId: other.id,
    selection: article,
  })
  await storage.recordings.savePreference({
    version: 1,
    workspaceKey: storage.workspaceKey,
    studyId: other.id,
    positionMs: 2_000,
  })
  const ledgerPath = join(storage.directory, 'progress.repository.v4.json'),
    playbackPath = join(storage.directory, 'playback.v1.json')
  const ledgerBefore = await readFile(ledgerPath, 'utf8'),
    playbackBefore = await readFile(playbackPath, 'utf8')
  // Act again
  await storage.library.removeStudy(third.id, storage.moveToTrash)
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(storage.moved.slice(0, 4), [
    join('recordings.v2', removed.id),
    'playback.v1.json',
    `${removed.id}.study.meta.v3.json`,
    `${removed.id}.study.v3.json`,
  ])
  assert.deepEqual(progressAfterRemoval.selection, {
    profile: 'repository-browser',
    itemId: 'repository/interface/theme',
    follow: false,
    tab: 'overview',
  })
  assert.equal(progressAfterRemoval.repositoryReturn, undefined)
  assert.equal(await readFile(ledgerPath, 'utf8'), ledgerBefore)
  assert.equal(await readFile(playbackPath, 'utf8'), playbackBefore)
  assert.equal(JSON.parse(playbackBefore).studyId, other.id)
})

// Value: protects=a Trash that refuses the first move leaves the study exactly as it was; fails_when=the removal goes on after a failed move or reports a partial removal; why_new=no removal existed; seam=the injected mover
test('a removal whose first move the Trash refuses moves nothing and leaves the study listed and readable', async (context) => {
  // Arrange: the Trash refuses the first move, the recording, and would take the sidecar and the archive, so a removal that went on would leave them in storage.moved.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  const filesBefore = await filesBelow(storage.directory)
  storage.rejectMovesOf((path) => path === join('recordings.v2', study.id))
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, {
    outcome: 'nothing-moved',
    cause: `Trash refused ${study.id}`,
    trashRefused: true,
  })
  assert.deepEqual(storage.moved, [])
  assert.deepEqual(await filesBelow(storage.directory), filesBefore)
  assert.deepEqual(await storage.library.readStudy(study.id), study)
})

// Value: protects=a removal that fails after the recording moved keeps the study listed, and deleting it again finishes the removal; fails_when=the archive is moved before the recording, or a second removal trips over the paths that are already gone; why_new=no removal existed; seam=the injected mover
test('a removal whose archive move the Trash refuses is reported as partly moved, and a second removal moves only what is left', async (context) => {
  // Arrange: the Trash takes the recording and the sidecar and refuses the archive.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  storage.rejectMovesOf((path) => path.endsWith('.study.v3.json'))
  // Act
  const first = await storage.library.removeStudy(study.id, storage.moveToTrash)
  const listedAfterFirst = await storage.library.list()
  storage.rejectMovesOf(() => false)
  const second = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(first, {
    outcome: 'partly-moved',
    cause: `Trash refused ${study.id}.study.v3.json`,
    trashRefused: true,
  })
  assert.deepEqual(
    listedAfterFirst.map((entry) => [entry.id, entry.metadata]),
    [[study.id, 'unavailable']],
  )
  assert.deepEqual(second, { outcome: 'moved' })
  assert.deepEqual(storage.moved, [
    join('recordings.v2', study.id),
    `${study.id}.study.meta.v3.json`,
    `${study.id}.study.v3.json`,
  ])
  assert.deepEqual(await storage.library.list(), [])
})

// Value: protects=an older format of a study can never reappear as the study while a removal is unfinished; fails_when=the highest format is moved before a lower one; why_new=no removal existed; seam=the injected mover
test('a study kept in two formats stays listed by its highest format until the last move of its removal', async (context) => {
  // Arrange: the study also has a preserved first-format archive; the Trash refuses the current archive.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  await writeFile(
    join(storage.directory, `${study.id}.study.json`),
    '{"version":1}',
  )
  storage.rejectMovesOf((path) => path.endsWith('.study.v3.json'))
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.equal(removal.outcome, 'partly-moved')
  assert.deepEqual(storage.moved, [
    join('recordings.v2', study.id),
    `${study.id}.study.meta.v3.json`,
    `${study.id}.study.json`,
  ])
  assert.deepEqual(
    (await storage.library.list()).map((entry) => [entry.id, entry.format]),
    [[study.id, 'v3']],
  )
})

// Value: protects=a saved study in a format the reader cannot open can still be removed to make room; fails_when=the removal needs a readable archive or a sidecar; why_new=no removal existed; seam=the injected mover
test('a study kept only in the first archive format, which cannot be opened, can be removed', async (context) => {
  // Arrange
  const storage = await removalStorage(context, 4)
  const studyId = `${randomUUID()}_${randomUUID()}`
  await mkdir(storage.directory, { recursive: true })
  await writeFile(join(storage.directory, `${studyId}.study.json`), 'not json')
  assert.deepEqual(
    (await storage.library.list()).map((entry) => entry.format),
    ['legacy-v1'],
  )
  // Act
  const removal = await storage.library.removeStudy(
    studyId,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(storage.moved, [`${studyId}.study.json`])
  assert.deepEqual(await storage.library.list(), [])
})

// Value: protects=a damaged playback position file is neither moved nor a reason to stop a removal; fails_when=the removal parses the file strictly and fails, or moves a file it cannot attribute; why_new=no removal existed; seam=the injected mover
test('a playback position file that cannot be parsed is left in place and the removal still completes', async (context) => {
  // Arrange
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  const playbackPath = join(storage.directory, 'playback.v1.json')
  await writeFile(playbackPath, 'not json')
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.equal(storage.moved.includes('playback.v1.json'), false)
  assert.equal(await readFile(playbackPath, 'utf8'), 'not json')
})

// Value: protects=a removal never runs against a library another window is writing; fails_when=the removal ignores the storage lock or rejects instead of reporting that nothing changed; why_new=no removal existed; seam=the injected mover
test('a removal while another writer holds the storage lock moves nothing and names the lock', async (context) => {
  // Arrange: another window's lock file is present.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  await writeFile(join(storage.directory, 'writer.lock'), '{"pid":1}')
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, {
    outcome: 'nothing-moved',
    cause: `Learning storage is locked by another writer or an interrupted session (lock file: ${join(await realpath(storage.directory), 'writer.lock')}). No data changed; retry after resolving the lock.`,
  })
  assert.deepEqual(storage.moved, [])
  assert.deepEqual(
    (await storage.library.list()).map((entry) => entry.id),
    [study.id],
  )
})

// Value: protects=a study a newer Codebook saved staying whole when a removal reaches the library although the window's catalog did not know the newer file yet; fails_when=the removal lists only the formats it knows, moves the older archive, the sidecar and the recording to the Trash and leaves the newer archive listed without them; why_new=Cycle 0045 local review (runtime-1 #5: only the workspace's catalog guarded this, and another window can save the newer file after it was read); seam=the library directory, into which the test writes a file as a newer Codebook would name it, and the injected mover
test('a removal of a study that a newer Codebook saved again beside its older archive moves nothing, and its files are not listed for removal by hand', async (context) => {
  // Arrange: a saved study with a recording, and beside its v3 archive the archive of format 5 that a newer Codebook wrote.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  await writeFile(
    join(storage.directory, `${study.id}.study.v5.json`),
    JSON.stringify({ ...study, version: 5 }),
  )
  const filesBefore = await filesBelow(storage.directory)
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  const filesForRemovalByHand = storage.library.studyFiles(study.id)
  // Assert
  assert.deepEqual(removal, {
    outcome: 'nothing-moved',
    cause:
      'This study was saved in format 5 by a newer Codebook; this Codebook reads formats up to 4. Update the extension to open it. The study is kept as it is.',
  })
  await assert.rejects(filesForRemovalByHand, {
    message:
      'This study was saved in format 5 by a newer Codebook; this Codebook reads formats up to 4. Update the extension to open it. The study is kept as it is.',
  })
  assert.deepEqual(storage.moved, [])
  assert.deepEqual(await filesBelow(storage.directory), filesBefore)
})

// Value: protects=asking to remove a study the library does not hold changes nothing; fails_when=the removal moves a leftover recording or playback file of an unknown id, or rejects; why_new=no removal existed; seam=the injected mover
test('a removal of a study the library does not hold moves nothing and says the archive is unavailable', async (context) => {
  // Arrange
  const storage = await removalStorage(context, 4)
  await saveStudyWithRecording(storage)
  // Act
  const removal = await storage.library.removeStudy(
    `${randomUUID()}_${randomUUID()}`,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, {
    outcome: 'nothing-moved',
    cause: 'Study archive is unavailable.',
  })
  assert.deepEqual(storage.moved, [])
})

// Value: protects=a learner ledger that cannot be read does not keep a full library from making room, and the removal leaves that ledger byte-identical; fails_when=an unreadable ledger ends every removal as "Nothing was deleted" (0038-F11), or the removal rewrites a ledger it could not read; why_new=every removal test arranged a ledger that is readable or absent; seam=none
test('a removal on a library whose learner ledger cannot be read moves the study with its recording and leaves the ledger byte-identical', async (context) => {
  // Arrange: a saved study with a recording; the ledger file holds a version the library does not read.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  await writeFile(
    join(storage.directory, 'progress.repository.v4.json'),
    '{"version":3}',
  )
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(storage.moved, [
    join('recordings.v2', study.id),
    `${study.id}.study.meta.v3.json`,
    `${study.id}.study.v3.json`,
  ])
  assert.deepEqual(await filesBelow(storage.directory), [
    [
      'progress.repository.v4.json',
      Buffer.from('{"version":3}').toString('base64'),
    ],
  ])
  assert.deepEqual(await storage.recordings.list(), [])
})

// Value: protects=a removal takes its turn among the other writers of the learning directory instead of deadlocking or overtaking them; fails_when=the removal takes the storage lock more than once or outside the writers' queue; why_new=the removal is the first writer that touches the study, the ledger and the playback file in one step; seam=the injected mover
test('a removal queued between a study save and a playback position save completes and all three take effect', async (context) => {
  // Arrange
  const storage = await removalStorage(context, 4)
  const removed = await saveStudyWithRecording(storage),
    other = createConfiguredStudy()
  // Act: three writers are queued without waiting for each other.
  const [, removal] = await Promise.all([
    storage.library.saveStudy(other),
    storage.library.removeStudy(removed.id, storage.moveToTrash),
    storage.recordings.savePreference({
      version: 1,
      workspaceKey: storage.workspaceKey,
      studyId: other.id,
      positionMs: 3_000,
    }),
  ])
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(
    (await storage.library.list()).map((entry) => entry.id),
    [other.id],
  )
  assert.equal((await storage.recordings.readPreference())?.studyId, other.id)
  assert.equal(
    (await readdir(storage.directory)).includes('writer.lock'),
    false,
  )
})

// Value: protects=a removal that fails at its first file move is reported as having moved nothing, and the learner ledger is exactly as before; fails_when=the ledger rewrite alone is counted as a change (the study is then reported as partly moved although every file is still there), or the rewritten ledger is left without its reference to a study that still exists; why_new=every earlier refused-move test arranged a ledger that did not name the study; seam=the injected mover
test('a removal whose first file move the Trash refuses after the ledger was rewritten moves nothing and leaves the ledger byte-identical', async (context) => {
  // Arrange: a study without a recording that the ledger names; the Trash refuses its catalog sidecar, the first file move.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await selectStudy(storage, study.id)
  const ledgerPath = join(storage.directory, 'progress.repository.v4.json')
  const ledgerBefore = await readFile(ledgerPath)
  const filesBefore = await filesBelow(storage.directory)
  storage.rejectMovesOf((path) => path.endsWith('.study.meta.v3.json'))
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, {
    outcome: 'nothing-moved',
    cause: `Trash refused ${study.id}.study.meta.v3.json`,
    trashRefused: true,
  })
  assert.deepEqual(storage.moved, [])
  assert.equal((await readFile(ledgerPath)).equals(ledgerBefore), true)
  assert.deepEqual(await filesBelow(storage.directory), filesBefore)
  assert.equal(
    (await storage.library.readProgress()).selection?.studyId,
    study.id,
  )
})

// Value: protects=a study that consists of its archive alone is still there, with the ledger naming it, after the Trash refused that archive; fails_when=the ledger rewrite is the only step before the archive and is counted as a partial removal; why_new=the smallest study (no sidecar, no recording) makes the ledger rewrite the only change before the failure; seam=the injected mover
test('a removal of a study that has only its archive, refused by the Trash, moves nothing and leaves the ledger byte-identical', async (context) => {
  // Arrange: one archive, no sidecar, no recording, and a ledger that names the study.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await selectStudy(storage, study.id)
  await rm(join(storage.directory, `${study.id}.study.meta.v3.json`))
  const ledgerPath = join(storage.directory, 'progress.repository.v4.json')
  const ledgerBefore = await readFile(ledgerPath)
  storage.rejectMovesOf((path) => path.endsWith('.study.v3.json'))
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, {
    outcome: 'nothing-moved',
    cause: `Trash refused ${study.id}.study.v3.json`,
    trashRefused: true,
  })
  assert.deepEqual(storage.moved, [])
  assert.equal((await readFile(ledgerPath)).equals(ledgerBefore), true)
  assert.deepEqual(await storage.library.readStudy(study.id), study)
})

// Value: protects=a removal that moved no file says that nothing moved and names the write-back that failed, so the reader keeps a study that is whole, and still says that the Trash refused, so a full library stops offering deletion; fails_when=a failed write-back is swallowed, it is answered as partly moved although no path is in the Trash, or the write-back's branch drops trashRefused (TC4: the regex anchored at the start never saw it); why_new=the write-back is new, and Cycle 0046 testing review TC4; seam=the injected mover, which blocks the ledger path before it refuses the move
test('a removal that moved nothing and cannot write the ledger back says that nothing moved and names both failures', async (context) => {
  // Arrange: the ledger names the study; the mover puts a directory in the ledger's place and then refuses the archive.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await selectStudy(storage, study.id)
  await rm(join(storage.directory, `${study.id}.study.meta.v3.json`))
  const ledgerPath = join(storage.directory, 'progress.repository.v4.json')
  const refusingMover: StudyMover = async () => {
    await rm(ledgerPath)
    await mkdir(join(ledgerPath, 'blocked'), { recursive: true })
    throw new Error('Trash refused the archive')
  }
  // Act
  const removal = await storage.library.removeStudy(study.id, refusingMover)
  // Assert: the outcome and the Trash's refusal exactly, the cause by its start (the system words the write-back's failure).
  const { cause, ...withoutCause } =
    'cause' in removal ? removal : { cause: '', ...removal }
  assert.deepEqual(withoutCause, {
    outcome: 'nothing-moved',
    trashRefused: true,
  })
  assert.match(
    cause,
    /^Trash refused the archive; the learner ledger could not be written back: EISDIR/,
  )
  assert.deepEqual(
    (await readdir(storage.directory)).filter((name) => name.endsWith('.tmp')),
    [],
  )
})

// Value: protects=a removal that moved every file is reported as moved even when its storage lock cannot be released afterwards; fails_when=the lock's rejection is read as "nothing moved"; why_new=no test made the release fail after the steps ran; seam=the injected mover, which removes the lock file with its last move
test('a removal whose storage lock cannot be released after every file moved is reported as moved and names the lock failure', async (context) => {
  // Arrange: the Trash takes every file and the lock file can no longer be removed from the last one on, so the release fails.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  const moverThatLosesTheLock: StudyMover = async (path) => {
    await storage.moveToTrash(path)
    if (path.endsWith('.study.v3.json'))
      await blockLockRelease(context, storage.directory)
  }
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    moverThatLosesTheLock,
  )
  // Assert
  assert.match(
    JSON.stringify(removal),
    /^\{"outcome":"moved","unreleasedLock":"(EISDIR|EPERM): [^"]*, unlink /,
  )
  assert.deepEqual(storage.moved, [
    join('recordings.v2', study.id),
    `${study.id}.study.meta.v3.json`,
    `${study.id}.study.v3.json`,
  ])
  assert.deepEqual(await storage.library.list(), [])
})

// Value: protects=a removal that moved every file names the storage lock that its release left in place without a thrown error (the lock's owner could not be read at any attempt, as on Windows while a scanner holds the file), so the learner is told that other windows are refused; fails_when=a release that answers kept reaches no onReleaseFailure, so the removal answers moved with no unreleasedLock and the storage line says nothing about a lock that still blocks other windows; why_new=Cycle 0048 task 131 (Codex adversarial, Codex structured, native adversarial): the test above makes the release throw, none made it end kept; seam=the injected mover, which overwrites the lock file with text that is no owner record with its last move; no_claim=a real scanner on Windows
test('a removal whose storage lock stays in place because its owner cannot be read is reported as moved and names the lock', async (context) => {
  // Arrange: the Trash takes every file and, with the last one, the lock file is overwritten with bytes that are no owner record, so the release reads no owner at any of its attempts.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  const lockPath = join(await realpath(storage.directory), 'writer.lock')
  const moverThatSpoilsTheLock: StudyMover = async (path) => {
    await storage.moveToTrash(path)
    if (path.endsWith('.study.v3.json')) await writeFile(lockPath, 'unreadable')
  }
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    moverThatSpoilsTheLock,
  )
  // Assert
  assert.deepEqual(removal, {
    outcome: 'moved',
    unreleasedLock: `The storage lock file ${lockPath} was left in place: the system would not let this window read its owner to remove it. This window tries to take it back; until then other windows are refused.`,
  })
  assert.deepEqual(await storage.library.list(), [])
})

// Value: protects=a removal that stopped half way keeps saying so when its storage lock cannot be released either; fails_when=the lock's rejection hides that a recording already moved; why_new=the existing partly-moved tests release the lock; seam=the injected mover
test('a removal that stopped at a refused sidecar and then cannot release its storage lock is reported as partly moved and names both failures', async (context) => {
  // Arrange: the Trash takes the recording, then refuses the sidecar while the lock file disappears.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  const moverThatLosesTheLock: StudyMover = async (path) => {
    if (!path.endsWith('.study.meta.v3.json')) return storage.moveToTrash(path)
    await blockLockRelease(context, storage.directory)
    throw new Error('Trash refused the sidecar')
  }
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    moverThatLosesTheLock,
  )
  // Assert
  assert.match(
    JSON.stringify(removal),
    /^\{"outcome":"partly-moved","cause":"Trash refused the sidecar; the storage lock could not be released: (EISDIR|EPERM): [^"]*, unlink /,
  )
  assert.deepEqual(storage.moved, [join('recordings.v2', study.id)])
  assert.deepEqual(
    (await storage.library.list()).map((entry) => entry.id),
    [study.id],
  )
})

// Value: protects=a removal the Trash refused at its first file still says that nothing moved, and why, when its storage lock cannot be released; fails_when=the refused move's cause is replaced by the lock's rejection; why_new=the nothing-moved tests release the lock; seam=the injected mover
test('a removal the Trash refused at its first file and that cannot release its storage lock says that nothing moved and names both failures', async (context) => {
  // Arrange: a study with only its archive and sidecar; the Trash refuses the sidecar while the lock file disappears.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const moverThatLosesTheLock: StudyMover = async () => {
    await blockLockRelease(context, storage.directory)
    throw new Error('Trash refused the sidecar')
  }
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    moverThatLosesTheLock,
  )
  // Assert
  assert.match(
    JSON.stringify(removal),
    /^\{"outcome":"nothing-moved","cause":"Trash refused the sidecar; the storage lock could not be released: (EISDIR|EPERM): [^"]*, unlink /,
  )
  assert.deepEqual(
    (await storage.library.list()).map((entry) => [entry.id, entry.metadata]),
    [[study.id, 'validated']],
  )
})

// Value: protects=a ledger that so far existed only as a historical file reads the same after a removal that moved nothing, and the learning directory holds the same files; fails_when=the write-back needs the repository ledger file to have existed, leaves the ledger without the selection of a study that is still there, or leaves the repository ledger file the removal created (0039-F4); why_new=the write-back has a second source for its bytes when the repository ledger file is created by the removal itself; seam=the injected mover
test('a removal that moved nothing leaves a ledger read from a historical file with the same selection, the historical file untouched and no repository ledger file', async (context) => {
  // Arrange: the only ledger file is a historical one whose selection names the study.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const historicalPath = join(storage.directory, 'progress.v4.json')
  const historicalLedger = JSON.stringify({
    version: 4,
    workspaceKey: storage.workspaceKey,
    decisions: [],
    selection: {
      studyId: study.id,
      profile: 'repository-browser',
      itemId: 'repository/interface/theme',
      follow: false,
      tab: 'overview',
    },
  })
  await writeFile(historicalPath, historicalLedger)
  const progressBefore = await storage.library.readProgress()
  storage.rejectMovesOf(() => true)
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, {
    outcome: 'nothing-moved',
    cause: `Trash refused ${study.id}.study.meta.v3.json`,
    trashRefused: true,
  })
  assert.deepEqual(await storage.library.readProgress(), progressBefore)
  assert.equal(progressBefore.selection?.studyId, study.id)
  assert.equal(await readFile(historicalPath, 'utf8'), historicalLedger)
  await assert.rejects(
    lstat(join(storage.directory, 'progress.repository.v4.json')),
    { code: 'ENOENT' },
  )
})

// Value: protects=deleting a saved study also takes the raw evidence of its run (screenshots, sealed source, events) out of the extension's storage; fails_when=the evidence directory stays behind, or moves after the study so that a failure leaves it orphaned; why_new=the removal did not know the evidence directory; seam=the injected mover
test('removing a saved study moves the raw evidence directory of its run after the recording and before the catalog sidecar', async (context) => {
  // Arrange: a study with a recording, and its run's evidence directory beside the learning directory.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  const evidenceDirectory = join(
    storage.directory,
    '..',
    'agent',
    study.instanceId,
    study.runId,
  )
  await mkdir(evidenceDirectory, { recursive: true })
  await writeFile(join(evidenceDirectory, 'events.jsonl'), '{"sequence":1}\n')
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
    evidenceDirectory,
  )
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(storage.moved, [
    join('recordings.v2', study.id),
    join('..', 'agent', study.instanceId, study.runId),
    `${study.id}.study.meta.v3.json`,
    `${study.id}.study.v3.json`,
  ])
  await assert.rejects(lstat(evidenceDirectory), { code: 'ENOENT' })
})

// Value: protects=a removal follows no link and moves no stray file out of the agent storage; fails_when=the evidence path is moved without checking that it is a real directory; why_new=the evidence step is new; seam=the injected mover
test('an evidence path that is a file or a symbolic link is left in place and the removal still completes', async (context) => {
  // Arrange: one study whose evidence path is a file, one whose evidence path links to a directory elsewhere.
  const storage = await removalStorage(context, 4)
  const studyWithFile = await saveStudy(storage),
    studyWithLink = await saveStudy(storage)
  const agentDirectory = join(storage.directory, '..', 'agent'),
    linkedDirectory = join(storage.directory, '..', 'elsewhere')
  const evidenceFile = join(agentDirectory, 'file-run'),
    evidenceLink = join(agentDirectory, 'link-run')
  await mkdir(agentDirectory)
  await mkdir(linkedDirectory)
  await writeFile(evidenceFile, 'not a directory')
  await symlink(linkedDirectory, evidenceLink)
  // Act
  const removalWithFile = await storage.library.removeStudy(
    studyWithFile.id,
    storage.moveToTrash,
    evidenceFile,
  )
  const removalWithLink = await storage.library.removeStudy(
    studyWithLink.id,
    storage.moveToTrash,
    evidenceLink,
  )
  // Assert
  assert.deepEqual(removalWithFile, { outcome: 'moved' })
  assert.deepEqual(removalWithLink, { outcome: 'moved' })
  assert.deepEqual(storage.moved, [
    `${studyWithFile.id}.study.meta.v3.json`,
    `${studyWithFile.id}.study.v3.json`,
    `${studyWithLink.id}.study.meta.v3.json`,
    `${studyWithLink.id}.study.v3.json`,
  ])
  assert.equal(await readFile(evidenceFile, 'utf8'), 'not a directory')
  assert.equal((await lstat(evidenceLink)).isSymbolicLink(), true)
})

// Value: protects=a study whose run left no evidence directory is removed as before; fails_when=a named evidence path that does not exist stops the removal; why_new=the evidence step is new and most older studies have no evidence directory left; seam=the injected mover
test('a removal that names an evidence directory that does not exist moves the study as before', async (context) => {
  // Arrange
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
    join(storage.directory, '..', 'agent', study.instanceId, study.runId),
  )
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(storage.moved, [
    `${study.id}.study.meta.v3.json`,
    `${study.id}.study.v3.json`,
  ])
})

// Value: protects=evidence that already went to the Trash is counted: a later refusal is a partial removal the learner can finish; fails_when=the evidence move is not counted as a moved path; why_new=the evidence step is new; seam=the injected mover
test('a removal whose sidecar move the Trash refuses after the evidence moved is reported as partly moved', async (context) => {
  // Arrange: a study without a recording whose run left evidence; the Trash refuses the catalog sidecar.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const evidenceDirectory = join(
    storage.directory,
    '..',
    'agent',
    study.instanceId,
    study.runId,
  )
  await mkdir(evidenceDirectory, { recursive: true })
  storage.rejectMovesOf((path) => path.endsWith('.study.meta.v3.json'))
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
    evidenceDirectory,
  )
  // Assert
  assert.deepEqual(removal, {
    outcome: 'partly-moved',
    cause: `Trash refused ${study.id}.study.meta.v3.json`,
    trashRefused: true,
  })
  assert.deepEqual(storage.moved, [
    join('..', 'agent', study.instanceId, study.runId),
  ])
})

// Value: protects=a Trash that takes the recording but refuses the raw evidence leaves a removal the learner finishes by deleting again; fails_when=a refused evidence move is swallowed or the second removal trips over the recording that is gone; why_new=only a refusal after the evidence had moved was tested; seam=the injected mover
test('a removal whose evidence move the Trash refuses after the recording moved is reported as partly moved, and a second removal moves the evidence and the rest of the study', async (context) => {
  // Arrange: a study with a recording whose run left evidence; the Trash takes the recording and refuses the evidence directory.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  const evidenceDirectory = join(
    storage.directory,
    '..',
    'agent',
    study.instanceId,
    study.runId,
  )
  await mkdir(evidenceDirectory, { recursive: true })
  await writeFile(join(evidenceDirectory, 'events.jsonl'), '{"sequence":1}\n')
  storage.rejectMovesOf(
    (path) => path === join('..', 'agent', study.instanceId, study.runId),
  )
  // Act
  const first = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
    evidenceDirectory,
  )
  const movedByFirst = [...storage.moved]
  const evidenceLeftByFirst = await readdir(evidenceDirectory)
  storage.rejectMovesOf(() => false)
  const second = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
    evidenceDirectory,
  )
  // Assert
  assert.deepEqual(first, {
    outcome: 'partly-moved',
    cause: `Trash refused ${study.runId}`,
    trashRefused: true,
  })
  assert.deepEqual(movedByFirst, [join('recordings.v2', study.id)])
  assert.deepEqual(evidenceLeftByFirst, ['events.jsonl'])
  assert.deepEqual(second, { outcome: 'moved' })
  assert.deepEqual(storage.moved, [
    join('recordings.v2', study.id),
    join('..', 'agent', study.instanceId, study.runId),
    `${study.id}.study.meta.v3.json`,
    `${study.id}.study.v3.json`,
  ])
  await assert.rejects(lstat(evidenceDirectory), { code: 'ENOENT' })
  assert.deepEqual(
    (await filesBelow(storage.directory)).filter(([path]) =>
      path.includes(study.id),
    ),
    [],
  )
  assert.deepEqual(await storage.library.list(), [])
})

// Value: protects=the count sentence after a removal and the "would a run be admitted now" question read the same figures the admission uses; fails_when=usage counts a study twice across formats or fails under an invalid limit; why_new=usage is new; seam=none
test('the library reports how many studies it keeps and its limit, and only the count while the limit setting is invalid', async (context) => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-usage-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  let limitSetting: unknown = 3
  const study = createConfiguredStudy()
  const library = new LearningLibrary(
    root,
    study.workspaceKey,
    () => limitSetting,
  )
  await library.saveStudy(study)
  await writeFile(join(root, `${study.id}.study.json`), '{"version":1}')
  // Act
  const usage = await library.usage()
  limitSetting = 0
  const usageUnderInvalidLimit = await library.usage()
  // Assert
  assert.deepEqual(usage, { count: 1, limit: 3 })
  assert.deepEqual(usageUnderInvalidLimit, { count: 1 })
})

/** Writes an archive file under a fresh study id, as a study restored from the Trash appears in the library; its sidecar is absent, so the list shows it as unavailable. @example await placeArchive(storage.directory) */
async function placeArchive(directory: string): Promise<string> {
  const studyId = `${randomUUID()}_${randomUUID()}`
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, `${studyId}.study.v3.json`), '{}')
  return studyId
}

// Value: protects=a library holding more saved studies than its maximum (a study restored from the Trash into a full library) can still be listed, counted and emptied; fails_when=the library refuses every list, usage, admission and save above the maximum (0038-F8), so the learner cannot delete anything; why_new=no test placed more than 256 archives; seam=none
test('a library holding 257 saved studies after one was restored from the Trash lists and counts them all, refuses a new study and lets one be removed', async (context) => {
  // Arrange: 257 archives at the maximum limit of 256.
  const storage = await removalStorage(context, 256)
  const studyIds: string[] = []
  for (let placed = 0; placed < 257; placed++)
    studyIds.push(await placeArchive(storage.directory))
  // Act
  const listed = await storage.library.list()
  const usage = await storage.library.usage()
  const admitsNewStudy = await storage.library.admitsStudy(
    `${randomUUID()}_${randomUUID()}`,
  )
  const admitsKeptStudy = await storage.library.admitsStudy(studyIds[0]!)
  const removal = await storage.library.removeStudy(
    studyIds[0]!,
    storage.moveToTrash,
  )
  // Assert
  assert.equal(listed.length, 257)
  assert.deepEqual(usage, { count: 257, limit: 256 })
  assert.equal(admitsNewStudy, false)
  assert.equal(admitsKeptStudy, true)
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(await storage.library.usage(), { count: 256, limit: 256 })
})

// Value: protects=an archive moved to the Trash by another window while the list is read leaves the listing of the others intact; fails_when=the stat of a vanished archive rejects the whole listing (0038-F12), so a concurrent checkpoint reports "History not saved"; why_new=no test removed an archive between the directory read and its stat; seam=the directory read, which names one archive that is already gone
test('a saved study that leaves the library while the list is read is left out and the other saved studies are listed', async (context) => {
  // Arrange: one saved study; the directory read also names an archive that is gone by the time it is inspected.
  const storage = await removalStorage(context, 4)
  const kept = await saveStudy(storage)
  const vanishedName = `${randomUUID()}_${randomUUID()}.study.v3.json`
  const readdirBefore = fsPromises.readdir
  context.mock.method(
    fsPromises,
    'readdir',
    async (...input: Parameters<typeof readdirBefore>) => {
      const names = await readdirBefore(...input)
      return input[0] === storage.directory ? [...names, vanishedName] : names
    },
  )
  // Act
  const listed = await storage.library.list()
  context.mock.restoreAll()
  // Assert
  assert.deepEqual(
    listed.map((entry) => [entry.id, entry.metadata]),
    [[kept.id, 'validated']],
  )
})

// Value: protects=a removal never moves anything outside the learning directory through a recording root that was replaced by a link; fails_when=the recording step follows `recordings.v2` to a directory elsewhere and moves the directory named after the study (0038-F14); why_new=every removal test used a real recording root; seam=the injected mover
test('a recording root replaced by a symbolic link is not followed: the removal moves only the study files inside the library', async (context) => {
  // Arrange: `recordings.v2` links to a directory outside the library that holds a directory named after the study.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const outside = join(storage.directory, '..', 'outside')
  await mkdir(join(outside, study.id), { recursive: true })
  await writeFile(join(outside, study.id, 'keep.txt'), 'outside the library')
  await symlink(outside, join(storage.directory, 'recordings.v2'))
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(storage.moved, [
    `${study.id}.study.meta.v3.json`,
    `${study.id}.study.v3.json`,
  ])
  assert.equal(
    await readFile(join(outside, study.id, 'keep.txt'), 'utf8'),
    'outside the library',
  )
})

// Value: protects=evidence that cannot be inspected is not silently left behind while the removal reports success; fails_when=an evidence directory whose inspection fails is skipped and the outcome is `moved` (0039-F16), so it stays without a retry; why_new=the evidence tests used paths that exist or are absent; seam=the inspection of the evidence path, which is refused
test('a removal whose evidence directory cannot be inspected stops there as partly moved, and the study stays listed for a second removal', async (context) => {
  // Arrange: a study with a recording; inspecting its evidence path is refused.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  const evidenceDirectory = join(
    storage.directory,
    '..',
    'agent',
    study.instanceId,
    study.runId,
  )
  await mkdir(evidenceDirectory, { recursive: true })
  const lstatBefore = fsPromises.lstat
  context.mock.method(
    fsPromises,
    'lstat',
    async (...input: Parameters<typeof lstatBefore>) => {
      if (input[0] === evidenceDirectory)
        throw Object.assign(new Error('EACCES: permission denied, lstat'), {
          code: 'EACCES',
        })
      return lstatBefore(...input)
    },
  )
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
    evidenceDirectory,
  )
  context.mock.restoreAll()
  // Assert
  assert.deepEqual(removal, {
    outcome: 'partly-moved',
    cause: 'EACCES: permission denied, lstat',
  })
  assert.deepEqual(storage.moved, [join('recordings.v2', study.id)])
  assert.deepEqual(
    (await storage.library.list()).map((entry) => entry.id),
    [study.id],
  )
})

// Value: protects=a path the Trash took is counted as moved even when the editor's call rejects afterwards; fails_when=a mover that rejects after moving is read as "not moved" (0039-F16), so the study is reported as whole although its files are gone; why_new=every refusing mover refused before moving; seam=the injected mover
test('a Trash move that rejects after the file already left the library is counted as moved and the removal completes', async (context) => {
  // Arrange: the Trash moves the catalog sidecar and then rejects the call.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const moverThatRejectsAfterMoving: StudyMover = async (path) => {
    await storage.moveToTrash(path)
    if (path.endsWith('.study.meta.v3.json'))
      throw new Error('Trash answered late')
  }
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    moverThatRejectsAfterMoving,
  )
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(storage.moved, [
    `${study.id}.study.meta.v3.json`,
    `${study.id}.study.v3.json`,
  ])
  assert.deepEqual(await storage.library.list(), [])
})

// Value: protects=a recording folder the Trash took is counted as moved, also when something made the folder again at its path before the editor's call rejected; fails_when=any entry at the path after a rejected move counts as the Trash's refusal, so the removal reports that nothing was deleted although the recording is in the Trash, and the window offers no removal any more (AD10 case c); why_new=Cycle 0046 adversarial review AD10: the entry at the path is compared with the one there before the move; seam=the injected mover, which moves the folder, makes an empty folder at its path and rejects
test('a Trash move that rejects after the folder left the library and another was made at its path counts the folder as moved, and the removal completes', async (context) => {
  // Arrange: a saved study with a recording; the Trash takes the recording folder, then an empty folder appears at its path, then the call rejects.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  const recordingFolder = join(storage.directory, 'recordings.v2', study.id)
  const moverThatRejectsAfterThePathWasMadeAgain: StudyMover = async (path) => {
    await storage.moveToTrash(path)
    if (path !== recordingFolder) return
    await mkdir(path)
    throw new Error('Trash answered late')
  }
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    moverThatRejectsAfterThePathWasMadeAgain,
  )
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(storage.moved, [
    join('recordings.v2', study.id),
    `${study.id}.study.meta.v3.json`,
    `${study.id}.study.v3.json`,
  ])
  assert.deepEqual(await readdir(recordingFolder), [])
})

// Value: protects=a removal whose moved folder cannot be looked at afterwards never tells the learner that nothing was deleted; fails_when=a look that fails after a rejected move counts as the path still being there, so the outcome reads "Nothing was deleted" and the Trash's refusal, although the recording is in the Trash (AD10 case b); why_new=Cycle 0046 adversarial review AD10; seam=the injected mover, which moves the recording folder, puts a link that leads to itself where its parent folder was (so the look answers ELOOP, as a folder this user may not read answers EACCES, for root as well) and rejects
test('a Trash move that rejects for a folder that cannot be looked at afterwards ends as partly moved and says that whether it moved is unknown', async (context) => {
  // Arrange: a saved study with a recording; the Trash takes the recording folder, then a link that leads to itself stands where the recordings folder was, then the call rejects.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  const recordingsRoot = join(storage.directory, 'recordings.v2'),
    recordingFolder = join(recordingsRoot, study.id)
  const moverWhoseFolderCannotBeLookedAt: StudyMover = async (path) => {
    await storage.moveToTrash(path)
    if (path !== recordingFolder) return
    await rm(recordingsRoot, { recursive: true })
    await symlink('recordings.v2', recordingsRoot)
    throw new Error('Trash answered late')
  }
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    moverWhoseFolderCannotBeLookedAt,
  )
  // Assert
  assert.deepEqual(removal, {
    outcome: 'partly-moved',
    cause: `Trash answered late; whether ${recordingFolder} left the library could not be checked: ELOOP: too many symbolic links encountered, lstat '${recordingFolder}'`,
    moveUnknown: true,
  })
  assert.deepEqual(storage.moved, [join('recordings.v2', study.id)])
  assert.deepEqual(
    (await storage.library.list()).map((entry) => entry.id),
    [study.id],
  )
})

// Value: protects=a recording folder the Trash took is counted as moved when a file stands where its parent folder was before the editor's call rejected; fails_when=the look's ENOTDIR (nothing can be at a path whose folder is a file) is read as unknown, so the removal stops and says that Codebook could not tell whether the study moved (S7); why_new=Cycle 0046 CodeRabbit review CR2 (S7); seam=the injected mover, which moves the recording folder, puts a file where recordings.v2 was and rejects
test('a Trash move that rejects after the folder left the library and a file took its parent folder’s place counts the folder as moved, and the removal completes', async (context) => {
  // Arrange: a saved study with a recording; the Trash takes the recording folder, then a file stands where the recordings folder was, then the call rejects.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  const recordingsRoot = join(storage.directory, 'recordings.v2'),
    recordingFolder = join(recordingsRoot, study.id)
  const moverWhoseParentBecameAFile: StudyMover = async (path) => {
    await storage.moveToTrash(path)
    if (path !== recordingFolder) return
    await rm(recordingsRoot, { recursive: true })
    await writeFile(recordingsRoot, '')
    throw new Error('Trash answered late')
  }
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    moverWhoseParentBecameAFile,
  )
  // Assert
  assert.deepEqual(
    { removal, moved: storage.moved },
    {
      removal: { outcome: 'moved' },
      moved: [
        join('recordings.v2', study.id),
        `${study.id}.study.meta.v3.json`,
        `${study.id}.study.v3.json`,
      ],
    },
  )
})

// Value: protects=moving the last run's evidence leaves no empty instance directory in the agent storage; fails_when=the instance directory stays behind after its only run's evidence went to the Trash (0040-N9-5); why_new=the evidence test asserted only the run directory; seam=the injected mover
test('moving the evidence of an instance’s only run also removes the instance directory that is left empty, and keeps one that still holds another run', async (context) => {
  // Arrange: two studies; the first instance has one run, the second instance has two.
  const storage = await removalStorage(context, 4)
  const lonely = await saveStudy(storage),
    shared = await saveStudy(storage)
  const agent = join(storage.directory, '..', 'agent')
  const lonelyEvidence = join(agent, 'lonely-instance', lonely.runId),
    sharedEvidence = join(agent, 'shared-instance', shared.runId)
  await mkdir(lonelyEvidence, { recursive: true })
  await mkdir(sharedEvidence, { recursive: true })
  await mkdir(join(agent, 'shared-instance', 'other-run'))
  // Act
  await storage.library.removeStudy(
    lonely.id,
    storage.moveToTrash,
    lonelyEvidence,
  )
  await storage.library.removeStudy(
    shared.id,
    storage.moveToTrash,
    sharedEvidence,
  )
  // Assert
  assert.deepEqual((await readdir(agent)).sort(), ['shared-instance'])
  assert.deepEqual(await readdir(join(agent, 'shared-instance')), ['other-run'])
})

// Value: protects=only a study identity can name what a removal moves; fails_when=a path-like id reaches the steps (0038-T5); why_new=no negative identity test existed; seam=the injected mover
test('removing an id that is not a study identity is refused before anything is inspected or moved', async (context) => {
  // Arrange
  const storage = await removalStorage(context, 4)
  await saveStudy(storage)
  // Act / Assert
  assert.throws(() => storage.library.removeStudy('../x', storage.moveToTrash))
  assert.deepEqual(storage.moved, [])
})

// Value: protects=the current archive format and recording format are removed as one unit in order; fails_when=the v4 archive, its sidecar or the `recordings.v3` directory is skipped or reordered (0038-T6); why_new=removal tests used only the v3 archive and `recordings.v2`; seam=the injected mover
test('removing a cross-runtime study moves its recordings.v3 directory, its v4 sidecar and its v4 archive in that order', async (context) => {
  // Arrange: a v4 study with a cross-runtime recording.
  const storage = await removalStorage(context, 4)
  const study = createCrossRuntimeStudy()
  await storage.library.saveStudy(study)
  const recording = await storage.recordings.start(
    {
      workspaceKey: study.workspaceKey,
      studyId: study.id,
      instanceId: study.instanceId,
      runId: study.runId,
      runtimeId: randomUUID(),
      profile: study.profile,
      sourceBuild: {
        revision: 'removal-test',
        dirty: false,
        sourceHash: '1'.repeat(64),
      },
    },
    0,
    3,
  )
  await recording.finish(1)
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(storage.moved, [
    join('recordings.v3', study.id),
    `${study.id}.study.meta.v4.json`,
    `${study.id}.study.v4.json`,
  ])
  assert.deepEqual(await storage.library.list(), [])
})

// Value: protects=a storage lock left by an editor that was killed mid-removal does not refuse every later write until it is removed by hand; fails_when=a lock whose process no longer exists on this machine is treated like a live writer's lock (0038-F13); why_new=the lock tests used a lock of a live process; seam=none (the lock names a process id that no process has)
test('a storage lock left by an exited editor process on this machine is taken over and the removal completes', async (context) => {
  // Arrange: the lock file names a process of this machine that has exited: an id no process can have, because the id of a child that just exited could be given to another process before the lock is judged.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await writeFile(
    join(storage.directory, 'writer.lock'),
    JSON.stringify({ pid: ID_OF_NO_PROCESS, hostname: hostname() }),
  )
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.equal(
    (await readdir(storage.directory)).includes('writer.lock'),
    false,
  )
})

// Value: protects=a lock of a process that still runs is never taken over; fails_when=the stale-lock recovery takes a live writer's lock; why_new=the recovery is new; seam=none
test('a storage lock of a process that still runs on this machine keeps refusing the removal with the lock sentence', async (context) => {
  // Arrange: the lock names this test process.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await writeFile(
    join(storage.directory, 'writer.lock'),
    JSON.stringify({ pid: process.pid, hostname: hostname() }),
  )
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, {
    outcome: 'nothing-moved',
    cause: `Learning storage is locked by another writer or an interrupted session (lock file: ${join(await realpath(storage.directory), 'writer.lock')}). No data changed; retry after resolving the lock.`,
  })
  assert.deepEqual(storage.moved, [])
})

// Value: protects=a lock file that is already gone when the removal releases it is no failure; fails_when=the release's ENOENT is reported as an unreleased lock (0040-D8); why_new=the release reported every unlink failure; seam=the injected mover, which removes the lock file with the last move
test('a removal whose storage lock file is already gone at its release is reported as moved without a lock failure', async (context) => {
  // Arrange
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const moverThatRemovesTheLock: StudyMover = async (path) => {
    await storage.moveToTrash(path)
    if (path.endsWith('.study.v3.json'))
      await rm(join(storage.directory, 'writer.lock'))
  }
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    moverThatRemovesTheLock,
  )
  // Assert
  assert.deepEqual(removal, { outcome: 'moved' })
})

// Value: protects=a lock that a removal could not release keeps refusing later writes with the lock sentence, as the reader's storage line says; fails_when=a later write ignores the lock that stayed; why_new=every unreleased-lock test deleted the lock file (0040-D12c); seam=the injected mover, after whose last move the lock file can no longer be removed
test('after a removal could not release its storage lock and the lock stayed, a later study save is refused with the lock sentence', async (context) => {
  // Arrange: the removal completes while the lock cannot be released.
  const storage = await removalStorage(context, 4)
  const removed = await saveStudy(storage)
  const moverThatKeepsTheLock: StudyMover = async (path) => {
    await storage.moveToTrash(path)
    if (path.endsWith('.study.v3.json'))
      await blockLockRelease(context, storage.directory)
  }
  const removal = await storage.library.removeStudy(
    removed.id,
    moverThatKeepsTheLock,
  )
  // Act
  const save = storage.library.saveStudy(createConfiguredStudy())
  // Assert
  assert.equal(removal.outcome, 'moved')
  await assert.rejects(save, {
    message: `Learning storage is locked by another writer or an interrupted session (lock file: ${join(await realpath(storage.directory), 'writer.lock')}). No data changed; retry after resolving the lock. This window itself left the lock: the system would not let it read or remove the file, and its tries to take the lock back have not removed it. Close the program that holds the file (a virus scanner or an indexer can), then retry; if the lock stays, move the file away.`,
  })
})

// Value: protects=what a removal by hand left of a saved study stays reachable: it is listed, its files are named, and removing them frees the place its recording takes; fails_when=a study is listed by its archive alone, so after the learner removed only the archive its recording still counts against the limit, no list shows it, and the "full" message points at a study that is not listed (Cycle 0046 row 86); why_new=every removal by hand in the tests removed all files of a study; seam=the file system, on which the test removes the files as the learner does
test('what is left of a saved study whose archive alone was removed by hand stays listed as an entry that cannot be opened, with its remaining files, and removing them frees its place', async (context) => {
  // Arrange: a limit of one; the one saved study has a finished recording. The learner removes the archive alone and presses Retry storage / refresh, which forgets absent studies and repairs the catalog.
  const storage = await removalStorage(context, 1)
  const study = await saveStudyWithRecording(storage)
  const archive = join(storage.directory, `${study.id}.study.v3.json`),
    sidecar = join(storage.directory, `${study.id}.study.meta.v3.json`),
    recording = join(storage.directory, 'recordings.v2', study.id)
  await utimes(
    sidecar,
    new Date('2026-09-20T00:00:01.000Z'),
    new Date('2026-09-20T00:00:01.000Z'),
  )
  await utimes(
    recording,
    new Date('2026-09-20T00:00:02.000Z'),
    new Date('2026-09-20T00:00:02.000Z'),
  )
  const nextRecording = (): Promise<string> => {
    const runId = randomUUID()
    return storage.recordings
      .start(
        {
          workspaceKey: study.workspaceKey,
          studyId: `${study.instanceId}_${runId}`,
          instanceId: study.instanceId,
          runId,
          runtimeId: randomUUID(),
          profile: study.profile,
          sourceBuild: {
            revision: 'removal-test',
            dirty: false,
            sourceHash: '1'.repeat(64),
          },
        },
        0,
      )
      .then(
        () => 'admitted',
        (error: unknown) => String(error),
      )
  }
  // Act
  await rm(archive)
  await storage.library.forgetAbsentStudies()
  await storage.library.reconcile()
  const listedAfterRetry = await storage.library.list()
  const filesLeft = await storage.library.studyFiles(study.id)
  const readOfTheStudy = await storage.library.readStudy(study.id).then(
    () => 'read',
    (error: unknown) => String(error),
  )
  const recordingWhileListed = await nextRecording()
  for (const path of filesLeft) await rm(path, { recursive: true })
  const listedAfterRemoval = await storage.library.list()
  const recordingAfterRemoval = await nextRecording()
  // Assert
  assert.deepEqual(listedAfterRetry, [
    {
      id: study.id,
      savedAt: '2026-09-20T00:00:02.000Z',
      format: 'archive-missing',
      metadata: 'unavailable',
      outcome: 'Archive missing; remaining files kept',
    },
  ])
  assert.deepEqual(filesLeft, [recording, sidecar])
  assert.equal(readOfTheStudy, 'Error: Study archive is unavailable.')
  assert.equal(
    recordingWhileListed,
    'Error: Recording library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study that has a recording from Saved studies in the Study workspace, before starting another session. Existing recordings were kept.',
  )
  assert.deepEqual(listedAfterRemoval, [])
  assert.equal(recordingAfterRemoval, 'admitted')
})

// Value: protects=in a window with a Trash the learner can delete what is left of a saved study without its archive, so its recording stops taking a place of the limit; fails_when=a removal refuses every study without an archive, so the listed entry cannot be deleted (Cycle 0046 row 86); why_new=the test this one replaces, "a recording directory without a saved study stays in place when that id is asked to be removed, and nothing moves", stated the opposite for the same files: a finished recording whose archive and catalog sidecar were removed; seam=the injected mover
test('what is left of a saved study without its archive and its catalog sidecar, a finished recording, is listed and moves to the Trash when the study is deleted', async (context) => {
  // Arrange: a finished recording whose study lost its archive and its catalog sidecar.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  await rm(join(storage.directory, `${study.id}.study.meta.v3.json`))
  await rm(join(storage.directory, `${study.id}.study.v3.json`))
  // Act
  const listedBefore = (await storage.library.list()).map((entry) => ({
    id: entry.id,
    format: entry.format,
    outcome: entry.outcome,
  }))
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(listedBefore, [
    {
      id: study.id,
      format: 'archive-missing',
      outcome: 'Archive missing; remaining files kept',
    },
  ])
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(storage.moved, [join('recordings.v2', study.id)])
  assert.deepEqual(await storage.library.list(), [])
  assert.deepEqual(await storage.recordings.list(), [])
})

/**
 * Names an editor process (another window's, or this test process's own) as the writer of a recording this test process started, in both places a window of this build names it: the header, and the record of the writer's full identity beside the recordings ({@link recordingOwnerRecordPath}).
 * @param storage - The removal storage of the test.
 * @param studyId - The recording's study id, a recording of the configured format.
 * @param owner - The editor process: its id and its host name. Its start is read from the system, so a live process is judged by its own start, and an id of no process has none.
 * @example await nameWriterOfRecording(storage, studyId, { pid: child.pid!, hostname: hostname() })
 */
async function nameWriterOfRecording(
  storage: Awaited<ReturnType<typeof removalStorage>>,
  studyId: string,
  owner: { pid: number; hostname: string },
): Promise<void> {
  const headerPath = join(
    storage.directory,
    'recordings.v2',
    studyId,
    'header.json',
  )
  const header: { owner: Record<string, unknown> } = JSON.parse(
    await readFile(headerPath, 'utf8'),
  )
  await writeFile(
    headerPath,
    JSON.stringify({ ...header, owner: { ...header.owner, ...owner } }),
  )
  // The writer's own start, or none for an id of no process.
  await rewriteWriterRecord(storage.directory, studyId, {
    ...owner,
    processStart: await readProcessStart(owner.pid).catch(() => undefined),
  })
}

// Value: protects=the recording of a run whose study is not saved yet is not taken for what is left of a removed study: it is neither listed as an entry that cannot be opened nor moved by a removal of its id; fails_when=every recording directory without an archive is listed and removable, so a learner (also one in another window) deletes the recording a running editor is writing (0038-T4), or a recording whose writer has ended stays unlisted and keeps its place for good (Cycle 0046 row 86); why_new=the listing of studies without an archive is new; seam=the recording's header, in which the test names an owner process that has ended, and the injected mover
test('a recording that is still being written for a study that is not saved yet is neither listed nor moved, and one whose writer has ended is listed', async (context) => {
  // Arrange: two reserved recordings without a saved study. This test process writes the first; the header of the second names an editor process that has ended.
  const storage = await removalStorage(context, 4)
  const reserve = async (): Promise<string> => {
    const instanceId = randomUUID(),
      runId = randomUUID()
    await storage.recordings.start(
      {
        workspaceKey: storage.workspaceKey,
        studyId: `${instanceId}_${runId}`,
        instanceId,
        runId,
        runtimeId: randomUUID(),
        profile: 'repository-browser',
        sourceBuild: {
          revision: 'removal-test',
          dirty: false,
          sourceHash: '1'.repeat(64),
        },
      },
      0,
    )
    return `${instanceId}_${runId}`
  }
  const beingWritten = await reserve(),
    leftByKilledEditor = await reserve()
  await nameWriterOfRecording(storage, leftByKilledEditor, {
    pid: ID_OF_NO_PROCESS,
    hostname: hostname(),
  })
  // Act
  const listed = (await storage.library.list()).map((entry) => ({
    id: entry.id,
    format: entry.format,
  }))
  const removalOfTheOneBeingWritten = await storage.library.removeStudy(
    beingWritten,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(listed, [
    { id: leftByKilledEditor, format: 'archive-missing' },
  ])
  assert.deepEqual(removalOfTheOneBeingWritten, {
    outcome: 'nothing-moved',
    cause: 'Study archive is unavailable.',
  })
  assert.deepEqual(storage.moved, [])
  assert.equal(
    (
      await lstat(join(storage.directory, 'recordings.v2', beingWritten))
    ).isDirectory(),
    true,
  )
})

/**
 * Starts the recording of a distinct study that is not saved yet, as another editor's run starts it: the recording's header and the record of its writer name that editor's process and host instead of this test process. The tests that use it show what they vary themselves: the record of another machine, the saves of the study and the seal, in their order.
 * @param storage - The removal storage of the test.
 * @param writer - The editor process the recording names: its id and its host name.
 * @returns The study, which is not saved, and the writer of its recording, which is not sealed.
 * @example const { study, recording } = await recordingStartedBy(storage, { pid: otherWindow.pid!, hostname: hostname() })
 */
async function recordingStartedBy(
  storage: Awaited<ReturnType<typeof removalStorage>>,
  writer: { pid: number; hostname: string },
) {
  const study = createConfiguredStudy(),
    runId = randomUUID()
  for (const observation of study.observations)
    observation.snapshotUri = observation.snapshotUri.replace(
      study.runId,
      runId,
    )
  study.runId = runId
  study.id = `${study.instanceId}_${runId}`
  const recording = await storage.recordings.start(
    {
      workspaceKey: study.workspaceKey,
      studyId: study.id,
      instanceId: study.instanceId,
      runId,
      runtimeId: randomUUID(),
      profile: study.profile,
      sourceBuild: {
        revision: 'removal-test',
        dirty: false,
        sourceHash: '1'.repeat(64),
      },
    },
    0,
  )
  await nameWriterOfRecording(storage, study.id, writer)
  return { study, recording }
}

/**
 * Records and seals the recording of a run whose study is not saved yet, as another editor window leaves it when its run has ended and its first save has not happened: the recording names a live process of this machine, the other window, in its header and in the record of its writer.
 * @param context - The test, at whose end the other window's process is killed.
 * @param storage - The removal storage of the test.
 * @returns The study the other window has not saved yet, whose id the recording has.
 * @example const unsaved = await sealedRecordingOfAnotherWindow(context, storage)
 */
async function sealedRecordingOfAnotherWindow(
  context: TestContext,
  storage: Awaited<ReturnType<typeof removalStorage>>,
) {
  const otherWindow = await idleChild(context)
  const { study, recording } = await recordingStartedBy(storage, {
    pid: otherWindow.pid!,
    hostname: hostname(),
  })
  await recording.finish(1)
  return study
}

// Value: protects=the recording of another window's run that has ended and has not saved its study yet (its first save failed and waits for Retry storage, or is still on its way); fails_when=a sealed recording counts as finished whatever run holds it, so this window lists it as "Archive missing; remaining files kept" and Delete moves it to the Trash before the other window saves the study, which then has no recording (data loss); why_new=Cycle 0047 row 36 (P3RT14); seam=the recording's header and writer record, which name a live child process of the test as the other window, and the injected mover; no_claim=a real second editor window
test('the finished recording of another window whose study that window has not saved yet is neither listed nor moved by this window', async (context) => {
  // Arrange
  const storage = await removalStorage(context, 4)
  const unsaved = await sealedRecordingOfAnotherWindow(context, storage)

  // Act
  const listed = (await storage.library.list()).map((entry) => entry.id)
  const removal = await storage.library.removeStudy(
    unsaved.id,
    storage.moveToTrash,
  )

  // Assert
  assert.deepEqual(
    {
      listed,
      removal,
      moved: storage.moved,
      recordingLeft: await readdir(join(storage.directory, 'recordings.v2')),
    },
    {
      listed: [],
      removal: {
        outcome: 'nothing-moved',
        cause: 'Study archive is unavailable.',
      },
      moved: [],
      recordingLeft: [unsaved.id],
    },
  )
})

// Value: protects=a learner's library after an editor window of this computer was closed (or crashed) once its run had sealed its recording and before it ever saved the run's study: the recording, whose writer record names that window's process that has ended, is listed as what is left of the study and moves to the Trash with it; fails_when=a sealed recording's writer record keeps it held whatever its writer's state (isRecordingWriterLive.ts sealedRecordingWriterState does not judge the record's writer), so the recording of a window that will never save is hidden from Saved studies and refuses Delete for good (Cycle 0047 row 200, state cell U40); why_new=Cycle 0047 row 200 (S2SM-U40): the sealed-recording tests had a live writer only; seam=the recording's header and writer record, which name a process id of no process on this machine as the closed window, and the injected mover
test('the finished recording of a closed window of this computer that never saved its study is listed and moves to the Trash with the study', async (context) => {
  // Arrange: a recording sealed by a run whose window, a process of this machine, has ended before it saved the study.
  const storage = await removalStorage(context, 4)
  const instanceId = randomUUID(),
    runId = randomUUID(),
    studyId = `${instanceId}_${runId}`
  const recording = await storage.recordings.start(
    {
      workspaceKey: storage.workspaceKey,
      studyId,
      instanceId,
      runId,
      runtimeId: randomUUID(),
      profile: 'repository-browser',
      sourceBuild: {
        revision: 'removal-test',
        dirty: false,
        sourceHash: '1'.repeat(64),
      },
    },
    0,
  )
  await nameWriterOfRecording(storage, studyId, {
    pid: ID_OF_NO_PROCESS,
    hostname: hostname(),
  })
  await recording.finish(1)

  // Act
  const listed = (await storage.library.list()).map((entry) => ({
    id: entry.id,
    format: entry.format,
  }))
  const removal = await storage.library.removeStudy(
    studyId,
    storage.moveToTrash,
  )

  // Assert
  assert.deepEqual(
    {
      listed,
      removal,
      moved: storage.moved,
      recordingsLeft: await readdir(join(storage.directory, 'recordings.v2')),
    },
    {
      listed: [{ id: studyId, format: 'archive-missing' }],
      removal: { outcome: 'moved' },
      moved: [join('recordings.v2', studyId)],
      recordingsLeft: [],
    },
  )
})

// Value: protects=the finished recording of another window's run once that window saved its study: from then on the study is listed by its archive, and what its archive leaves when it is removed by hand is listed again and removable (Cycle 0046 row 86); fails_when=the record of the writer that keeps the finished recording for its run's first save outlives the save, so after the archive was removed by hand the rest stays unlisted and keeps its place while the other window runs; why_new=Cycle 0047 row 36 (P3RT14): the seal keeps that record until the save; seam=the recording's header and writer record, which name a live child process of the test as the other window, the library's save of the study, as the other window saves it, and the injected mover; no_claim=a real second editor window
test('once another window saved the study of its finished recording, the study is listed by its archive, and what is left after its archive was removed by hand is listed and moves to the Trash', async (context) => {
  // Arrange: the other window saves its study; later the learner removes its archive and its catalog sidecar by hand.
  const storage = await removalStorage(context, 4)
  const unsaved = await sealedRecordingOfAnotherWindow(context, storage)
  await storage.library.saveStudy(unsaved)
  const listedWhenSaved = (await storage.library.list()).map((entry) => ({
    id: entry.id,
    format: entry.format,
  }))
  await rm(join(storage.directory, `${unsaved.id}.study.meta.v3.json`))
  await rm(join(storage.directory, `${unsaved.id}.study.v3.json`))

  // Act
  const listedAfterRemovalByHand = (await storage.library.list()).map(
    (entry) => ({ id: entry.id, format: entry.format }),
  )
  const removal = await storage.library.removeStudy(
    unsaved.id,
    storage.moveToTrash,
  )

  // Assert
  assert.deepEqual(
    {
      listedWhenSaved,
      listedAfterRemovalByHand,
      removal,
      moved: storage.moved,
    },
    {
      listedWhenSaved: [{ id: unsaved.id, format: 'v3' }],
      listedAfterRemovalByHand: [{ id: unsaved.id, format: 'archive-missing' }],
      removal: { outcome: 'moved' },
      moved: [join('recordings.v2', unsaved.id)],
    },
  )
})

// Value: protects=the study of another window's run whose checkpoint saved it while it ran, after that run sealed its recording and before its save of the final state; fails_when=the seal removes the record of the writer because an archive of the study exists, or an archive alone releases a sealed recording, so this window's Delete moves the study and its recording to the Trash between that window's seal and its final save, which then writes the study back without its recording (data loss); why_new=Cycle 0047 row 98 (ADV-10); seam=the recording's header and writer record, which name a live child process of the test as the other window, the library's saves of the study, as that window's checkpoints save it, and the injected mover; no_claim=a real second editor window
test('the study of another window that its run saved before sealing the recording is not moved before that window saves it again after the seal, and moves with its recording once it did', async (context) => {
  // Arrange: another window of this machine records a study, its checkpoint saves the study while the run goes on, and the run then seals the recording.
  const storage = await removalStorage(context, 4)
  const otherWindow = await idleChild(context)
  const { study, recording } = await recordingStartedBy(storage, {
    pid: otherWindow.pid!,
    hostname: hostname(),
  })
  await storage.library.saveStudy(study)
  await recording.finish(1)

  // Act
  const removalBeforeTheSaveAfterTheSeal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  const movedBeforeTheSaveAfterTheSeal = [...storage.moved]
  await storage.library.saveStudy(study)
  const removalAfterTheSaveAfterTheSeal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )

  // Assert
  assert.deepEqual(
    {
      removalBeforeTheSaveAfterTheSeal: { ...removalBeforeTheSaveAfterTheSeal },
      movedBeforeTheSaveAfterTheSeal,
      removalAfterTheSaveAfterTheSeal: { ...removalAfterTheSaveAfterTheSeal },
      moved: storage.moved,
    },
    {
      removalBeforeTheSaveAfterTheSeal: {
        outcome: 'nothing-moved',
        cause:
          'Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.',
      },
      movedBeforeTheSaveAfterTheSeal: [],
      removalAfterTheSaveAfterTheSeal: { outcome: 'moved' },
      moved: [
        join('recordings.v2', study.id),
        `${study.id}.study.meta.v3.json`,
        `${study.id}.study.v3.json`,
      ],
    },
  )
})

/**
 * Loads a study library whose looks at a recording read its files through a reader that fails once, under the storage lock, for one path: the read answers nothing, as a read of a file a scanner holds for a moment on Windows does.
 * @param storage - The removal storage of the test.
 * @param failingPath - The file whose first read under the lock fails.
 * @returns A library on the test's learning directory, and whether the read failed.
 * @example const observed = await libraryWhoseReadFailsOnceUnderTheLock(storage, headerPath)
 */
async function libraryWhoseReadFailsOnceUnderTheLock(
  storage: Awaited<ReturnType<typeof removalStorage>>,
  failingPath: string,
): Promise<{ library: LearningLibrary; hasReadFailed: () => boolean }> {
  let isUnderTheLock = false,
    hasReadFailed = false
  const failingReader = {
    readWikiRegularFile: async (
      ...reading: Parameters<typeof readWikiRegularFile>
    ): ReturnType<typeof readWikiRegularFile> => {
      if (isUnderTheLock && !hasReadFailed && reading[0] === failingPath) {
        hasReadFailed = true
        return undefined
      }
      return readWikiRegularFile(...reading)
    },
  }
  const writerRecordReader = await loadModule<typeof writerRecordModule>(
    resolve(__dirname, '../utils/readRecordingWriterRecord.js'),
    { './readWikiRegularFile': failingReader },
    { Error },
  )
  const look = await loadModule<typeof lookModule>(
    resolve(__dirname, '../utils/lookAtRecording.js'),
    {
      './readWikiRegularFile': failingReader,
      './readRecordingWriterRecord': writerRecordReader,
    },
    { Error },
  )
  const { LearningLibrary: ObservedLibrary } = await loadModule<
    typeof libraryModule
  >(
    resolve(__dirname, '../learningLibrary.js'),
    {
      './utils/lookAtRecording': look,
      './utils/withStorageLock': {
        withStorageLock: async (
          ...[directory, operation]: Parameters<typeof withStorageLock>
        ): ReturnType<typeof withStorageLock> =>
          withStorageLock(directory, async () => {
            isUnderTheLock = true
            try {
              return await operation()
            } finally {
              isUnderTheLock = false
            }
          }),
      },
    },
    { Error },
  )
  return {
    library: new ObservedLibrary(
      storage.directory,
      storage.workspaceKey,
      () => 4,
    ),
    hasReadFailed: () => hasReadFailed,
  }
}

/**
 * Records and seals the recording of a study that another editor window saved while its run went on and has not saved after the seal, so that window still holds the recording: its header and the record of its writer name a live process of this machine, the other window.
 * @param context - The test, at whose end the other window's process is killed.
 * @param storage - The removal storage of the test.
 * @returns The study's id.
 * @example const studyId = await studySavedBeforeItsSealedRecording(context, storage)
 */
async function studySavedBeforeItsSealedRecording(
  context: TestContext,
  storage: Awaited<ReturnType<typeof removalStorage>>,
): Promise<string> {
  const otherWindow = await idleChild(context)
  const { study, recording } = await recordingStartedBy(storage, {
    pid: otherWindow.pid!,
    hostname: hostname(),
  })
  await storage.library.saveStudy(study)
  await recording.finish(1)
  return study.id
}

// Value: protects=the finished recording of another window's run that has not saved its study after the seal, while a read of its header or of its writer record fails for a moment under the removal's storage lock (a scanner on Windows holds the file); fails_when=the look under the lock takes the read that failed for a header or a record that is not there, counts the sealed recording as released and moves it to the Trash with the study, so that window's checkpoint after the seal is lost; why_new=Cycle 0047 row 239 (P2CLA-7): the look told no failed read from a missing file; seam=the file reader of the loaded library's looks, which answers nothing at its first read of the header, or of the writer record, under the lock, and the injected mover; no_claim=a real scanner on Windows
test('a read of the header or of the writer record that fails once under the removal’s lock keeps another window’s finished recording, whose study it has not saved after the seal', async (context) => {
  // Arrange: in two libraries, another window of this machine saved a study while its run went on and then sealed the recording; it has not saved the study after the seal.
  const ofTheHeaderCase = await removalStorage(context, 4),
    ofTheRecordCase = await removalStorage(context, 4)
  const headerCaseStudy = await studySavedBeforeItsSealedRecording(
      context,
      ofTheHeaderCase,
    ),
    recordCaseStudy = await studySavedBeforeItsSealedRecording(
      context,
      ofTheRecordCase,
    )
  const headerReadFails = await libraryWhoseReadFailsOnceUnderTheLock(
    ofTheHeaderCase,
    join(
      ofTheHeaderCase.directory,
      'recordings.v2',
      headerCaseStudy,
      'header.json',
    ),
  )
  const recordReadFails = await libraryWhoseReadFailsOnceUnderTheLock(
    ofTheRecordCase,
    recordingOwnerRecordPath(ofTheRecordCase.directory, recordCaseStudy),
  )

  // Act
  const removalWhoseHeaderReadFails = await headerReadFails.library.removeStudy(
    headerCaseStudy,
    ofTheHeaderCase.moveToTrash,
  )
  const removalWhoseRecordReadFails = await recordReadFails.library.removeStudy(
    recordCaseStudy,
    ofTheRecordCase.moveToTrash,
  )

  // Assert
  const refusal = {
    outcome: 'nothing-moved',
    cause:
      'Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.',
  }
  assert.deepEqual(
    {
      removalWhoseHeaderReadFails: { ...removalWhoseHeaderReadFails },
      removalWhoseRecordReadFails: { ...removalWhoseRecordReadFails },
      readsFailed: [
        headerReadFails.hasReadFailed(),
        recordReadFails.hasReadFailed(),
      ],
      moved: [ofTheHeaderCase.moved, ofTheRecordCase.moved],
    },
    {
      removalWhoseHeaderReadFails: refusal,
      removalWhoseRecordReadFails: refusal,
      readsFailed: [true, true],
      moved: [[], []],
    },
  )
})

/**
 * Makes every read of one file fail for the rest of the test, as a scanner on Windows that holds the file through a whole Delete does: its open throws, and with `isLookFailing` so does the look at it that does not follow a link (`lstat`), each with the code the test names.
 * @param context - The test, at whose end both calls are restored.
 * @param path - The file whose reads fail.
 * @param failure - The code both calls throw, and whether the look at the file fails as well.
 * @returns A handle whose `release` ends the failures, as a scanner that lets the file go does.
 * @example
 * failEveryReadOf(context, headerPath, { code: 'EBUSY', isLookFailing: false })
 * const scanner = failEveryReadOf(context, headerPath, { code: 'EBUSY', isLookFailing: false })
 * scanner.release() // the next read of the file succeeds
 */
function failEveryReadOf(
  context: TestContext,
  path: string,
  failure: { code: 'EBUSY' | 'EACCES'; isLookFailing: boolean },
): { release: () => void } {
  let isHeld = true
  const failed = (call: string): Error =>
    Object.assign(new Error(`${failure.code}: ${call} '${path}'`), {
      code: failure.code,
    })
  const openBefore = fsPromises.open
  context.mock.method(
    fsPromises,
    'open',
    async (...input: Parameters<typeof openBefore>) => {
      if (isHeld && input[0] === path) throw failed('open')
      return openBefore(...input)
    },
  )
  const handle = {
    release: (): void => {
      isHeld = false
    },
  }
  // The look at the file fails only where the test asks for it.
  if (!failure.isLookFailing) return handle
  const lstatBefore = fsPromises.lstat
  context.mock.method(
    fsPromises,
    'lstat',
    async (...input: Parameters<typeof lstatBefore>) => {
      if (isHeld && input[0] === path) throw failed('lstat')
      return lstatBefore(...input)
    },
  )
  return handle
}

// Value: protects=the finished recording of another window's run that has not saved its study, while every read of its header fails through a whole Delete (a scanner on Windows holds the file); fails_when=a look without a header counts the recording as finished before it asks whether the header stands and gave nothing, so Delete moves the recording to the Trash, both looks without a header being the same, before that window saved its study (data loss), or the list hides a recording whose writer nobody can name; why_new=Cycle 0047 row 251 (P3CXA-C1, P3S7-G2): row 239 held only for a read that fails under the lock; seam=the open of the header, which fails at every read, and the injected mover; no_claim=a real scanner on Windows, the editor's dialog (studyWorkspaceRemoval tests)
test('a header that fails at every read of a Delete keeps another window’s finished recording until the learner moves it anyway: the list shows it, and Delete asks first', async (context) => {
  // Arrange: another window of this machine sealed the recording of a study it has not saved; every read of the recording's header fails.
  const storage = await removalStorage(context, 4)
  const unsaved = await sealedRecordingOfAnotherWindow(context, storage)
  const directory = join(storage.directory, 'recordings.v2', unsaved.id)
  failEveryReadOf(context, join(directory, 'header.json'), {
    code: 'EBUSY',
    isLookFailing: false,
  })

  // Act
  const listed = (await storage.library.list()).map((entry) => ({
    id: entry.id,
    format: entry.format,
  }))
  const removal = await storage.library.removeStudy(
    unsaved.id,
    storage.moveToTrash,
  )
  const movedBeforeTheLearnersChoice = [...storage.moved]
  const recordingsBeforeTheLearnersChoice = await readdir(
    join(storage.directory, 'recordings.v2'),
  )
  const agreed =
    removal.outcome === 'nothing-moved' && removal.unconfirmedWriter
      ? [removal.unconfirmedWriter]
      : []
  const removalAnyway = await storage.library.removeStudy(
    unsaved.id,
    storage.moveToTrash,
    undefined,
    { move: agreed },
  )

  // Assert
  assert.deepEqual(
    {
      listed,
      removal: { ...removal },
      movedBeforeTheLearnersChoice,
      recordingsBeforeTheLearnersChoice,
      removalAnyway: { ...removalAnyway },
      moved: storage.moved,
    },
    {
      listed: [{ id: unsaved.id, format: 'archive-missing' }],
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Codebook could not read the files of its recording now. A virus scanner may hold them, or another editor window may still record it or still have to save it.',
        unconfirmedWriter: { directory, place: 'unreadable' },
      },
      movedBeforeTheLearnersChoice: [],
      recordingsBeforeTheLearnersChoice: [unsaved.id],
      removalAnyway: { outcome: 'moved' },
      moved: [join('recordings.v2', unsaved.id)],
    },
  )
})

// Value: protects=the finished recording of another window's run that has not saved its study, while every read of its writer record fails through a whole Delete (a scanner on Windows holds the file); fails_when=the judgement reads the record again, takes the read that fails for no record and counts the sealed recording as finished, so the list shows it as what is left of a removed study and Delete moves it to the Trash, the look under the lock failing the same way, before that window saved its study (data loss); why_new=Cycle 0047 row 251 (P3CXA-C1, P3OCR2a1-1, P3S7-G2); seam=the open of the writer record, which fails at every read, and the injected mover; no_claim=a real scanner on Windows
test('a writer record that fails at every read of a Delete keeps another window’s finished recording: its header names that live window, so the list does not show the recording and nothing moves', async (context) => {
  // Arrange: another window of this machine sealed the recording of a study it has not saved; every read of the record of its writer fails.
  const storage = await removalStorage(context, 4)
  const unsaved = await sealedRecordingOfAnotherWindow(context, storage)
  failEveryReadOf(
    context,
    recordingOwnerRecordPath(storage.directory, unsaved.id),
    { code: 'EBUSY', isLookFailing: false },
  )

  // Act
  const listed = (await storage.library.list()).map((entry) => entry.id)
  const removal = await storage.library.removeStudy(
    unsaved.id,
    storage.moveToTrash,
  )

  // Assert
  assert.deepEqual(
    {
      listed,
      removal: { ...removal },
      moved: storage.moved,
      recordingLeft: await readdir(join(storage.directory, 'recordings.v2')),
    },
    {
      listed: [],
      removal: {
        outcome: 'nothing-moved',
        cause: 'Study archive is unavailable.',
      },
      moved: [],
      recordingLeft: [unsaved.id],
    },
  )
})

// Value: protects=the finished recording of another window's run that has not saved its study after the seal, while every read of its writer record and every look at that file fail through a whole Delete (EACCES); fails_when=the look turns every failed look at the record into no record, so it proves the record absent, counts the sealed recording as released, and Delete moves the study and the recording to the Trash before that window saved its state after the seal (data loss); why_new=Cycle 0047 row 251 (P3CXA-C2): the look told no missing file from a look that failed; seam=the open and the lstat of the writer record, which throw EACCES at every call, and the injected mover; no_claim=a real file the user may not read
test('a writer record whose read and whose look both fail at every call of a Delete keeps another window’s finished recording and its study: nothing moves, and the removal says that window has to save it', async (context) => {
  // Arrange: another window of this machine saved a study while its run went on and sealed the recording; every open and every look at the record of its writer fails with EACCES.
  const storage = await removalStorage(context, 4)
  const studyId = await studySavedBeforeItsSealedRecording(context, storage)
  failEveryReadOf(
    context,
    recordingOwnerRecordPath(storage.directory, studyId),
    {
      code: 'EACCES',
      isLookFailing: true,
    },
  )

  // Act
  const removal = await storage.library.removeStudy(
    studyId,
    storage.moveToTrash,
  )

  // Assert
  assert.deepEqual(
    {
      removal: { ...removal },
      moved: storage.moved,
      recordingLeft: await readdir(join(storage.directory, 'recordings.v2')),
    },
    {
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.',
      },
      moved: [],
      recordingLeft: [studyId],
    },
  )
})

// Value: protects=the learner's way out for a study whose recording's header is damaged for good: Delete asks, and Move to Trash Anyway moves the study with its recording; fails_when=a header that stands and gives nothing keeps the study for good, so it can never be deleted, or it is moved without the learner's choice although the header may only have failed to read for a moment; why_new=Cycle 0047 row 251 (P3CXA-C1): a header that stands and gives nothing no longer counts as finished; seam=the recording's header.json, which the test overwrites with text that is no JSON, and the injected mover
test('a study whose recording’s header is damaged for good moves to the Trash with its recording once the learner chooses Move to Trash Anyway, and not before', async (context) => {
  // Arrange: a saved study whose finished recording's header is no JSON.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  const directory = join(storage.directory, 'recordings.v2', study.id)
  await writeFile(join(directory, 'header.json'), 'no JSON')

  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  const movedBeforeTheLearnersChoice = [...storage.moved]
  const agreed =
    removal.outcome === 'nothing-moved' && removal.unconfirmedWriter
      ? [removal.unconfirmedWriter]
      : []
  const removalAnyway = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
    undefined,
    { move: agreed },
  )

  // Assert
  assert.deepEqual(
    {
      removal: { ...removal },
      movedBeforeTheLearnersChoice,
      removalAnyway: { ...removalAnyway },
      moved: storage.moved,
    },
    {
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Codebook could not read the files of its recording now. A virus scanner may hold them, or another editor window may still record it or still have to save it.',
        unconfirmedWriter: { directory, place: 'unreadable' },
      },
      movedBeforeTheLearnersChoice: [],
      removalAnyway: { outcome: 'moved' },
      moved: [
        join('recordings.v2', study.id),
        `${study.id}.study.meta.v3.json`,
        `${study.id}.study.v3.json`,
      ],
    },
  )
})

// Value: protects=the study of another window's run whose checkpoint was taken before that run sealed its recording and was saved after the seal, before the run's save of its final state; fails_when=the save releases the recording because the disk shows it sealed at the save, not because the archive it saved was taken after the seal, so this window's Delete moves the study and its recording to the Trash between that checkpoint's save and the final save, which then writes the study back without its recording (data loss; Cycle 0047 row 124, ADV2-2 = CXA2-1); or the final save, whose archive says the run stopped after the seal, keeps the recording held; why_new=Cycle 0047 row 124 (ADV2-2 = CXA2-1); seam=the recording's header and writer record, which name a live child process of the test as the other window, the library's saves of that window's checkpoints (the archive taken while the run stopped, and the one taken once it had stopped), and the injected mover; no_claim=a real second editor window and its checkpoint queue (studyWorkspace tests)
test('the study of another window whose checkpoint taken before the seal is saved after it is not moved before that window saves the study it took after the seal, and moves with its recording once it did', async (context) => {
  // Arrange: another window of this machine records a study; a checkpoint of its study is taken while its run stops, and the run seals the recording before that checkpoint's save ends.
  const storage = await removalStorage(context, 4)
  const otherWindow = await idleChild(context)
  const { study: finalStudy, recording } = await recordingStartedBy(storage, {
    pid: otherWindow.pid!,
    hostname: hostname(),
  })
  finalStudy.savedAt = '2026-09-20T00:00:20.000Z'
  const checkpointTakenBeforeTheSeal = {
    ...finalStudy,
    state: 'stopping',
    savedAt: '2026-09-20T00:00:10.000Z',
  }
  await recording.finish(1)
  await storage.library.saveStudy(checkpointTakenBeforeTheSeal)

  // Act
  const removalBeforeTheFinalSave = await storage.library.removeStudy(
    finalStudy.id,
    storage.moveToTrash,
  )
  const movedBeforeTheFinalSave = [...storage.moved]
  await storage.library.saveStudy(finalStudy)
  const removalAfterTheFinalSave = await storage.library.removeStudy(
    finalStudy.id,
    storage.moveToTrash,
  )

  // Assert
  assert.deepEqual(
    {
      removalBeforeTheFinalSave: { ...removalBeforeTheFinalSave },
      movedBeforeTheFinalSave,
      removalAfterTheFinalSave: { ...removalAfterTheFinalSave },
      moved: storage.moved,
    },
    {
      removalBeforeTheFinalSave: {
        outcome: 'nothing-moved',
        cause:
          'Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.',
      },
      movedBeforeTheFinalSave: [],
      removalAfterTheFinalSave: { outcome: 'moved' },
      moved: [
        join('recordings.v2', finalStudy.id),
        `${finalStudy.id}.study.meta.v3.json`,
        `${finalStudy.id}.study.v3.json`,
      ],
    },
  )
})

// Value: protects=a learner whose Delete meets the finished recording of a run on another computer (a shared storage folder) that has not saved its study yet, reading a refusal and a dialog that are true for it; fails_when=the refusal and the dialog say only that the recording "may still be running" and that Codebook cannot tell whether a window "still records it", although the recording is sealed and its run only still has to save it, so the learner takes Move to Trash Anyway for safe because no window records any more; why_new=Cycle 0047 row 57: since row 36 a sealed recording stays its run's until the study is saved, so a writer this computer cannot confirm also holds a finished recording; seam=the recording's header and the record of its writer, which name an editor of another machine, the removal's messages, and the injected mover; no_claim=a real second computer, the editor's dialog (studyWorkspaceRemoval tests)
test('the finished recording of a run on another computer that has not saved its study keeps the study, and the refusal and its dialog say a window there may still have to save it', async (context) => {
  // Arrange: a recording without a saved study, sealed; its header and the record of its writer name an editor of another machine, whose run has not saved the study.
  const storage = await removalStorage(context, 4)
  const instanceId = randomUUID(),
    runId = randomUUID()
  const studyId = `${instanceId}_${runId}`
  const recording = await storage.recordings.start(
    {
      workspaceKey: storage.workspaceKey,
      studyId,
      instanceId,
      runId,
      runtimeId: randomUUID(),
      profile: 'repository-browser',
      sourceBuild: {
        revision: 'removal-test',
        dirty: false,
        sourceHash: '1'.repeat(64),
      },
    },
    0,
  )
  await nameWriterOfRecording(storage, studyId, {
    pid: ID_OF_NO_PROCESS,
    hostname: 'old-laptop.local',
  })
  await rewriteWriterRecord(storage.directory, studyId, {
    machineId: 'machine-b',
  })
  await recording.finish(1)
  const directory = join(storage.directory, 'recordings.v2', studyId)
  const { createdAt }: { createdAt: string } = JSON.parse(
    await readFile(join(directory, 'header.json'), 'utf8'),
  )
  const startedAt = new Date(createdAt).toLocaleString()
  const messages = studyRemovalMessages('Trash')

  // Act
  const removal = await storage.library.removeStudy(
    studyId,
    storage.moveToTrash,
  )
  const dialog = {
    title: messages.unconfirmedWriterTitle([
      { host: 'old-laptop.local', startedAt, place: 'another-computer' },
    ]),
    detail: messages.unconfirmedWriterDetail([
      { host: 'old-laptop.local', startedAt, place: 'another-computer' },
    ]),
  }

  // Assert
  assert.deepEqual(
    { removal, dialog, moved: storage.moved },
    {
      removal: {
        outcome: 'nothing-moved',
        cause: `Its recording was started on old-laptop.local at ${startedAt}. Codebook cannot tell from this computer whether an editor window still records it or still has to save it.`,
        unconfirmedWriter: {
          directory,
          host: 'old-laptop.local',
          startedAt: createdAt,
          place: 'another-computer',
        },
      },
      dialog: {
        title:
          "This study's recording may still be in use on another computer. Move the study to the Trash anyway?",
        detail: `Its recording was started on old-laptop.local at ${startedAt}. Codebook cannot tell from this computer whether an editor window still records it or still has to save it. If a window still records it or still has to save it, on that computer or on this one, the recording is lost. If none does, nothing is lost. Cancel keeps the study and its recording as they are.`,
      },
      moved: [],
    },
  )
})

// Value: protects=a learner whose Delete meets the study of a run on another computer (a shared storage folder) that a checkpoint taken before the seal saved and whose final save failed there, reading a refusal and a dialog that are true for it; fails_when=the archive of the earlier checkpoint releases the sealed recording again (as before Cycle 0047 row 98), so Delete moves the study and its recording without a word while the window there may still save it by Retry storage and write the study back without its recording; or the refusal stops saying that a window there may still have to save it; why_new=Cycle 0047 row 128 (ADV2-11): the study stays held by its writer's record after a failed final save, and Delete asks; seam=the recording's header and the record of its writer, which name an editor of another machine, the library's save of that run's checkpoint taken while it stopped, the removal's messages, and the injected mover; no_claim=a real second computer and its failed write, the editor's dialog (studyWorkspaceRemoval tests)
test('the study of a run on another computer whose final save failed after a checkpoint saved it before the seal keeps its recording held, and the refusal and its dialog say a window there may still have to save it', async (context) => {
  // Arrange: an editor of another machine records a study; a checkpoint taken while its run stopped saved the study; the run sealed the recording, and its save of the final state failed there.
  const storage = await removalStorage(context, 4)
  const { study, recording } = await recordingStartedBy(storage, {
    pid: ID_OF_NO_PROCESS,
    hostname: 'old-laptop.local',
  })
  study.state = 'stopping'
  await rewriteWriterRecord(storage.directory, study.id, {
    machineId: 'machine-b',
  })
  await storage.library.saveStudy(study)
  await recording.finish(1)
  const directory = join(storage.directory, 'recordings.v2', study.id)
  const { createdAt }: { createdAt: string } = JSON.parse(
    await readFile(join(directory, 'header.json'), 'utf8'),
  )
  const startedAt = new Date(createdAt).toLocaleString()
  const messages = studyRemovalMessages('Trash')

  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  const dialog = {
    title: messages.unconfirmedWriterTitle([
      { host: 'old-laptop.local', startedAt, place: 'another-computer' },
    ]),
    detail: messages.unconfirmedWriterDetail([
      { host: 'old-laptop.local', startedAt, place: 'another-computer' },
    ]),
  }

  // Assert
  assert.deepEqual(
    { removal, dialog, moved: storage.moved },
    {
      removal: {
        outcome: 'nothing-moved',
        cause: `Its recording was started on old-laptop.local at ${startedAt}. Codebook cannot tell from this computer whether an editor window still records it or still has to save it.`,
        unconfirmedWriter: {
          directory,
          host: 'old-laptop.local',
          startedAt: createdAt,
          place: 'another-computer',
        },
      },
      dialog: {
        title:
          "This study's recording may still be in use on another computer. Move the study to the Trash anyway?",
        detail: `Its recording was started on old-laptop.local at ${startedAt}. Codebook cannot tell from this computer whether an editor window still records it or still has to save it. If a window still records it or still has to save it, on that computer or on this one, the recording is lost. If none does, nothing is lost. Cancel keeps the study and its recording as they are.`,
      },
      moved: [],
    },
  )
})

/**
 * Leaves a recording of a saved study in one recording format's folder as a window of 0.2.29.0 leaves it, a header without a record of its writer, naming the writer's process and host and the time the recording was created.
 * @param storage - The removal storage of the test.
 * @param studyId - The saved study's id.
 * @param recordingsRoot - The recording format's folder, `recordings.v2` or `recordings.v3`.
 * @param writer - The process id and host name the header names, and when the recording was created.
 * @example await headerOnlyRecording(storage, study.id, 'recordings.v3', { pid: ID_OF_NO_PROCESS, hostname: 'host-one', createdAt: '2026-10-01T08:00:00.000Z' })
 */
async function headerOnlyRecording(
  storage: Awaited<ReturnType<typeof removalStorage>>,
  studyId: string,
  recordingsRoot: 'recordings.v2' | 'recordings.v3',
  writer: { pid: number; hostname: string; createdAt: string },
): Promise<void> {
  const folder = join(storage.directory, recordingsRoot, studyId)
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'header.json'),
    JSON.stringify({
      owner: {
        pid: writer.pid,
        hostname: writer.hostname,
        sessionId: randomUUID(),
      },
      createdAt: writer.createdAt,
    }),
  )
}

// Value: protects=the learner's consent to each recording of a study that the removal moves although its writer may still run elsewhere; fails_when=the refusal names only the first such recording, so the dialog names one host and "Move to Trash Anyway" moves the recordings of every host (AD6, probe p3 E3); why_new=Cycle 0046 adversarial review AD6: no study had two such recordings; seam=two recordings of one study in two recording formats, each a header of another host without a record of its writer, and the injected mover
test('a study whose recordings name two other hosts is refused with both hosts and both starts, and nothing moves', async (context) => {
  // Arrange: a saved study with a recording of host-one (recordings.v3, 2026-10-01) and one of host-two (recordings.v2, 2026-10-17); no process here has their process id.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await headerOnlyRecording(storage, study.id, 'recordings.v3', {
    pid: ID_OF_NO_PROCESS,
    hostname: 'host-one',
    createdAt: '2026-10-01T08:00:00.000Z',
  })
  await headerOnlyRecording(storage, study.id, 'recordings.v2', {
    pid: ID_OF_NO_PROCESS,
    hostname: 'host-two',
    createdAt: '2026-10-17T08:00:00.000Z',
  })
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(
    { removal, moved: storage.moved },
    {
      removal: {
        outcome: 'nothing-moved',
        cause: `Its recordings were started on host-one at ${new Date('2026-10-01T08:00:00.000Z').toLocaleString()} and on host-two at ${new Date('2026-10-17T08:00:00.000Z').toLocaleString()}. Codebook cannot tell from this computer whether an editor window still records them or still has to save them.`,
        unconfirmedWriter: {
          directory: join(storage.directory, 'recordings.v3', study.id),
          host: 'host-one',
          startedAt: '2026-10-01T08:00:00.000Z',
          place: 'another-computer',
        },
        otherUnconfirmedWriters: [
          {
            directory: join(storage.directory, 'recordings.v2', study.id),
            host: 'host-two',
            startedAt: '2026-10-17T08:00:00.000Z',
            place: 'another-computer',
          },
        ],
      },
      moved: [],
    },
  )
})

// Value: protects=the learner's consent to each recording a removal moves although its writer may still run elsewhere, also when a recording appears after their dialog; fails_when="Move to Trash Anyway" judges the writers again in its move and moves a recording of another host that the dialog never named (S2, probe: host-two written while the dialog was open, and both moved); why_new=Cycle 0046 Claude adversarial review #3 (S2): the learner's move names the writers it agreed to; seam=two recordings of one study, each a header of another host without a record, the second written between the refusal and the learner's move, and the injected mover
test('a learner’s move that names the writers of a dialog keeps the study when a recording of another host appeared since, and names the writers anew', async (context) => {
  // Arrange: the study has a recording of host-one; the removal is refused with it; then a recording of host-two appears.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await headerOnlyRecording(storage, study.id, 'recordings.v3', {
    pid: ID_OF_NO_PROCESS,
    hostname: 'host-one',
    createdAt: '2026-10-01T08:00:00.000Z',
  })
  const refusal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  const agreed =
    refusal.outcome !== 'moved' && refusal.unconfirmedWriter
      ? [refusal.unconfirmedWriter]
      : []
  await headerOnlyRecording(storage, study.id, 'recordings.v2', {
    pid: ID_OF_NO_PROCESS,
    hostname: 'host-two',
    createdAt: '2026-10-17T08:00:00.000Z',
  })
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
    undefined,
    { move: agreed },
  )
  // Assert
  assert.deepEqual(
    {
      agreedHosts: agreed.map((writer) =>
        'host' in writer ? writer.host : undefined,
      ),
      outcome: removal.outcome,
      named:
        removal.outcome === 'moved'
          ? []
          : [
              removal.unconfirmedWriter && 'host' in removal.unconfirmedWriter
                ? removal.unconfirmedWriter.host
                : undefined,
              ...(removal.otherUnconfirmedWriters ?? []).map((writer) =>
                'host' in writer ? writer.host : undefined,
              ),
            ],
      moved: storage.moved,
    },
    {
      agreedHosts: ['host-one'],
      outcome: 'nothing-moved',
      named: ['host-one', 'host-two'],
      moved: [],
    },
  )
})

// Value: protects=the dialog's title and warning about a study whose recordings have writers in both places, which must warn of the one on another computer; fails_when=the first recording found leads, so a writer of this computer gives the title "in another editor window" and the warning drops "on another computer"; why_new=Cycle 0046 adversarial review AD6: the refusal names several writers in an order; seam=a recording of this host whose header names a live child process begun after it (recordings.v3) and one of another host (recordings.v2), each a header without a record of its writer, and the injected mover
test('a study whose recordings have a writer on another computer and one of this computer names the one on another computer first', async (context) => {
  // Arrange: the recordings.v3 recording names a live process of this computer that began after it; the recordings.v2 recording names another host.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const laterProcess = await idleChild(context)
  await headerOnlyRecording(storage, study.id, 'recordings.v3', {
    pid: laterProcess.pid!,
    hostname: hostname(),
    createdAt: '2026-10-01T08:00:00.000Z',
  })
  await headerOnlyRecording(storage, study.id, 'recordings.v2', {
    pid: ID_OF_NO_PROCESS,
    hostname: 'host-two',
    createdAt: '2026-10-17T08:00:00.000Z',
  })
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(
    removal.outcome === 'moved'
      ? removal
      : {
          unconfirmedWriter: removal.unconfirmedWriter,
          otherUnconfirmedWriters: removal.otherUnconfirmedWriters,
        },
    {
      unconfirmedWriter: {
        directory: join(storage.directory, 'recordings.v2', study.id),
        host: 'host-two',
        startedAt: '2026-10-17T08:00:00.000Z',
        place: 'another-computer',
      },
      otherUnconfirmedWriters: [
        {
          directory: join(storage.directory, 'recordings.v3', study.id),
          host: hostname(),
          startedAt: '2026-10-01T08:00:00.000Z',
          place: 'this-computer',
        },
      ],
    },
  )
})

// Value: protects=the recording an editor on another machine is writing into a shared storage folder (a synced or network home), for a study it has not saved yet; fails_when=the owner is judged by its process id on this machine, where no process of that id runs, so a removal of its id moves it away while the other editor writes it, without the learner's choice; why_new=Cycle 0046 /ship review T1: the "another machine" half of the rule that judges a recording's writer (now recordingWriterOf) had no test, and dropping it survived every test. Since AF2 such a recording is listed, so the learner can reach the dialog about it, and the removal waits for their choice; seam=the recording's header, in which the test names an editor of another machine with a process id that no process of this machine has, and the injected mover
test('a recording whose header names an editor of another machine is listed but not moved without the learner’s choice, although no process of its id runs on this machine', async (context) => {
  // Arrange: one reserved recording without a saved study, as a window of 0.2.29.0 makes it (a header, and no record of its writer beside the recordings); its header names an editor on another machine, with a process id no process here has.
  const storage = await removalStorage(context, 4)
  const instanceId = randomUUID(),
    runId = randomUUID()
  const ofAnotherMachine = `${instanceId}_${runId}`
  await storage.recordings.start(
    {
      workspaceKey: storage.workspaceKey,
      studyId: ofAnotherMachine,
      instanceId,
      runId,
      runtimeId: randomUUID(),
      profile: 'repository-browser',
      sourceBuild: {
        revision: 'removal-test',
        dirty: false,
        sourceHash: '1'.repeat(64),
      },
    },
    0,
  )
  const headerPath = join(
    storage.directory,
    'recordings.v2',
    ofAnotherMachine,
    'header.json',
  )
  const header: {
    owner: { pid: number; hostname: string }
    createdAt: string
  } = JSON.parse(await readFile(headerPath, 'utf8'))
  await writeFile(
    headerPath,
    JSON.stringify({
      ...header,
      owner: {
        ...header.owner,
        pid: ID_OF_NO_PROCESS,
        hostname: 'another-machine',
      },
    }),
  )
  await rm(recordingOwnerRecordPath(storage.directory, ofAnotherMachine))

  // Act
  const listed = (await storage.library.list()).map((entry) => ({
    id: entry.id,
    format: entry.format,
  }))
  const removal = await storage.library.removeStudy(
    ofAnotherMachine,
    storage.moveToTrash,
  )

  // Assert
  assert.deepEqual(
    {
      listed,
      removal,
      moved: storage.moved,
      isRecordingInPlace: await lstat(
        join(storage.directory, 'recordings.v2', ofAnotherMachine),
      ).then(
        (entry) => entry.isDirectory(),
        () => false,
      ),
    },
    {
      listed: [{ id: ofAnotherMachine, format: 'archive-missing' }],
      removal: {
        outcome: 'nothing-moved',
        cause: `Its recording was started on another-machine at ${new Date(header.createdAt).toLocaleString()}. Codebook cannot tell from this computer whether an editor window still records it or still has to save it.`,
        unconfirmedWriter: {
          directory: join(storage.directory, 'recordings.v2', ofAnotherMachine),
          host: 'another-machine',
          startedAt: header.createdAt,
          place: 'another-computer',
        },
      },
      moved: [],
      isRecordingInPlace: true,
    },
  )
})

/**
 * Starts the recording of a saved study as a run of the given window does, and leaves it unsealed, as a run that still writes it leaves it.
 * @param storage - The removal storage of the test.
 * @param study - The saved study whose run is recorded.
 * @param owner - The editor process the header and the record of the writer name ({@link nameWriterOfRecording}): its id and its host name.
 * @returns The recording's directory.
 * @example await recordingStillWrittenBy(storage, study, { pid: child.pid!, hostname: hostname() })
 */
async function recordingStillWrittenBy(
  storage: Awaited<ReturnType<typeof removalStorage>>,
  study: Awaited<ReturnType<typeof saveStudy>>,
  owner: { pid: number; hostname: string },
): Promise<string> {
  await storage.recordings.start(
    {
      workspaceKey: study.workspaceKey,
      studyId: study.id,
      instanceId: study.instanceId,
      runId: study.runId,
      runtimeId: randomUUID(),
      profile: study.profile,
      sourceBuild: {
        revision: 'removal-test',
        dirty: false,
        sourceHash: '1'.repeat(64),
      },
    },
    0,
  )
  await nameWriterOfRecording(storage, study.id, owner)
  return join(storage.directory, 'recordings.v2', study.id)
}

// Value: protects=a saved study whose run another editor window is still recording; fails_when=a removal in this window moves that window's recording (and the study's other files) while it writes it, so its next journal append fails with ENOENT and its next save writes the archive again: the removed study comes back without its recording; why_new=Cycle 0046 /ship review R9: the guard of a recording that may still be written applied only to a study without an archive; seam=the recording's header, which names a live child process of the test as the other window's editor, and the injected mover
test('a saved study whose recording another live editor window is still writing is not moved: the removal says so and every file stays', async (context) => {
  // Arrange: a saved study with an archive; another window, a live process of this machine, is still recording its run.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const otherWindow = await idleChild(context)
  const recording = await recordingStillWrittenBy(storage, study, {
    pid: otherWindow.pid!,
    hostname: hostname(),
  })
  const filesBefore = await filesBelow(storage.directory)

  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )

  // Assert
  assert.deepEqual(
    {
      removal,
      moved: storage.moved,
      isRecordingInPlace: await lstat(recording).then(
        (entry) => entry.isDirectory(),
        () => false,
      ),
      isEveryFileUnchanged: isDeepStrictEqual(
        await filesBelow(storage.directory),
        filesBefore,
      ),
    },
    {
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.',
      },
      moved: [],
      isRecordingInPlace: true,
      isEveryFileUnchanged: true,
    },
  )
})

// Value: protects=a removal in the window whose own run recorded the study, after that run stopped (the window refuses to remove a study whose run has not stopped), also when its recording was never sealed; fails_when=this window's own process counts as another window that still records, so a study whose seal failed can never be removed until the editor restarts; why_new=Cycle 0046 /ship review R9: the new refusal must not hold for this window's own recordings; seam=none, the recording as this window's store starts it
test('a saved study whose unsealed recording this window’s own process started is moved with its recording', async (context) => {
  // Arrange: a saved study with an archive whose recording this test process started and never sealed.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await recordingStillWrittenBy(storage, study, {
    pid: process.pid,
    hostname: hostname(),
  })

  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )

  // Assert
  assert.deepEqual(
    { removal, moved: storage.moved },
    {
      removal: { outcome: 'moved' },
      moved: [
        join('recordings.v2', study.id),
        `${study.id}.study.meta.v3.json`,
        `${study.id}.study.v3.json`,
      ],
    },
  )
})

// Value: protects=another editor window's writes to the shared storage (a recording's start, an archive's save, a playback position) while this window removes a study whose recording that window still writes; fails_when=the removal judges the recordings' writers under the storage lock, where a judgement can ask the system for a process's start (a PowerShell of up to 3 s on Windows), so the other window's write in that time meets the lock and is refused at once; why_new=Cycle 0046 repeat review P2: R9's judgement ran under the lock; seam=the judgement of the loaded library, which looks at the lock file and lets another window (its own copy of the storage lock, with a queue of its own) write while it judges
test('a removal judges the writers of the study’s recordings before it takes the storage lock, so a write of another window meanwhile is not refused', async (context) => {
  // Arrange: a saved study whose recording another live window still writes; while this window judges that writer, the other window writes to the storage.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const otherWindow = await idleChild(context)
  await recordingStillWrittenBy(storage, study, {
    pid: otherWindow.pid!,
    hostname: hostname(),
  })
  const { withStorageLock: lockOfTheOtherWindow } = await loadModule<
    typeof lockModule
  >(resolve(__dirname, '../utils/withStorageLock.js'), {}, { Error })
  const whileJudging: { isLockHeld: boolean; writeOfTheOtherWindow: string }[] =
    []
  // The judgement (one for the study's one recording) first notes whether the lock is held and lets the other window write.
  const noteTheLockAndWriteMeanwhile = async (): Promise<void> => {
    whileJudging.push({
      isLockHeld: await lstat(join(storage.directory, 'writer.lock')).then(
        () => true,
        () => false,
      ),
      writeOfTheOtherWindow: await lockOfTheOtherWindow(
        storage.directory,
        async () => 'written',
      ).catch((error: Error) => error.message),
    })
  }
  const { LearningLibrary: ObservedLibrary } = await loadModule<
    typeof libraryModule
  >(
    resolve(__dirname, '../learningLibrary.js'),
    {
      './utils/recordingWriterOf': {
        recordingWriterOf: async (
          ...judging: Parameters<typeof recordingWriterOf>
        ): ReturnType<typeof recordingWriterOf> => {
          await noteTheLockAndWriteMeanwhile()
          return recordingWriterOf(...judging)
        },
      },
    },
    { Error },
  )
  const library = new ObservedLibrary(
    storage.directory,
    storage.workspaceKey,
    () => 4,
  )

  // Act
  const removal = await library.removeStudy(study.id, storage.moveToTrash)

  // Assert
  assert.deepEqual(
    { removal: { ...removal }, whileJudging, moved: storage.moved },
    {
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.',
      },
      whileJudging: [{ isLockHeld: false, writeOfTheOtherWindow: 'written' }],
      moved: [],
    },
  )
})

/**
 * Loads the study library with a storage lock that runs a step of the test right before the library takes it: after a removal judged the writers of the study's recordings, before its look under the lock, as another window's start can fall between the two.
 * @param storage - The removal storage of the test.
 * @param stepBeforeTheLock - What changes on disk between the judgement and the lock.
 * @returns A library on the test's learning directory.
 * @example const library = await libraryWithStepBeforeTheLock(storage, () => writeFile(sealPath, '{}'))
 */
async function libraryWithStepBeforeTheLock(
  storage: Awaited<ReturnType<typeof removalStorage>>,
  stepBeforeTheLock: () => Promise<void>,
): Promise<LearningLibrary> {
  const { LearningLibrary: ObservedLibrary } = await loadModule<
    typeof libraryModule
  >(
    resolve(__dirname, '../learningLibrary.js'),
    {
      './utils/withStorageLock': {
        withStorageLock: async (
          ...locking: Parameters<typeof withStorageLock>
        ): ReturnType<typeof withStorageLock> => {
          await stepBeforeTheLock()
          return withStorageLock(...locking)
        },
      },
    },
    { Error },
  )
  return new ObservedLibrary(storage.directory, storage.workspaceKey, () => 4)
}

// Value: protects=a study whose recording another window had only begun (its folder made, its header not yet written) when this window judged the writers before its lock; fails_when=the removal reuses the verdict 'finished' of the folder without a header under the lock, so it moves the recording the other window has just started; why_new=Cycle 0046 Codex review CX12: under the lock only the seal was looked at again; seam=the storage lock of the loaded library, right before which the test writes the header
test('a header written between the removal’s judgement and its lock keeps the study: nothing moves, and the removal says another window records it', async (context) => {
  // Arrange: a saved study whose recording folder another window has just made, without its header yet.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const folder = join(storage.directory, 'recordings.v2', study.id)
  await mkdir(folder, { recursive: true })
  const library = await libraryWithStepBeforeTheLock(storage, () =>
    writeFile(
      join(folder, 'header.json'),
      JSON.stringify({
        owner: {
          pid: process.pid,
          hostname: hostname(),
          sessionId: randomUUID(),
        },
        createdAt: new Date().toISOString(),
      }),
    ),
  )

  // Act
  const removal = await library.removeStudy(study.id, storage.moveToTrash)

  // Assert
  assert.deepEqual(
    { removal: { ...removal }, moved: storage.moved },
    {
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.',
      },
      moved: [],
    },
  )
})

// Value: protects=a study whose recording another window had only begun (its folder made, its header not yet written) when this window judged the writers before its lock, while the header that window then writes fails to read under the lock (a scanner holds it); fails_when=the look under the lock is compared without whether a read may have failed, so two looks without a header are the same, the verdict 'finished' of the folder without a header is used again, and the recording the other window has just started moves to the Trash; why_new=Cycle 0047 row 251 (P3CXA-C1): the comparison of the two looks left out mayHaveFailedRead; seam=the storage lock of the loaded library, right before which the test writes the header and makes every later read of it fail, and the injected mover; no_claim=a real scanner on Windows
test('a header written between the removal’s judgement and its lock that fails to read under the lock keeps the study: nothing moves, and the removal says another window records it', async (context) => {
  // Arrange: a saved study whose recording folder another window has just made, without its header yet; right before the lock the header appears and a scanner holds it.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const folder = join(storage.directory, 'recordings.v2', study.id)
  await mkdir(folder, { recursive: true })
  const headerPath = join(folder, 'header.json')
  const library = await libraryWithStepBeforeTheLock(storage, async () => {
    await writeFile(
      headerPath,
      JSON.stringify({
        owner: {
          pid: process.pid,
          hostname: hostname(),
          sessionId: randomUUID(),
        },
        createdAt: new Date().toISOString(),
      }),
    )
    failEveryReadOf(context, headerPath, {
      code: 'EBUSY',
      isLookFailing: false,
    })
  })

  // Act
  const removal = await library.removeStudy(study.id, storage.moveToTrash)

  // Assert
  assert.deepEqual(
    { removal: { ...removal }, moved: storage.moved },
    {
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.',
      },
      moved: [],
    },
  )
})

// Value: protects=the learner who deletes a study while a read of a recording's writer record failed at the look before the lock and does not at the look under it (a scanner on Windows held the file for a moment); fails_when=a look that differs only because a failed read ended gets the sentence of another window's recording, so the learner is sent to save a recording in a window that may not exist; why_new=Cycle 0048 task 20 (S11-N16): the failed read that ends between the two looks was worded as another window's run; seam=the storage lock of the loaded library, right before which the test removes the file at the writer record's place that gave no record, and the injected mover; no_claim=a real scanner on Windows
test('a read that failed before the removal’s lock and no longer fails under it keeps the study with a sentence about the read, not about another window', async (context) => {
  // Arrange: a saved study whose recording has a header of this host and a process id of no process, and a file that is no record at the place of its writer record; right before the lock that file goes.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await headerOnlyRecording(storage, study.id, 'recordings.v2', {
    pid: ID_OF_NO_PROCESS,
    hostname: hostname(),
    createdAt: '2026-10-01T08:00:00.000Z',
  })
  const recordPath = recordingOwnerRecordPath(storage.directory, study.id)
  await mkdir(dirname(recordPath), { recursive: true })
  await writeFile(recordPath, 'no JSON')
  const library = await libraryWithStepBeforeTheLock(storage, async () => {
    await rm(recordPath)
  })

  // Act
  const removal = await library.removeStudy(study.id, storage.moveToTrash)

  // Assert
  assert.deepEqual(
    { removal: { ...removal }, moved: storage.moved },
    {
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Codebook could not read a recording of this study just now. Delete the study again.',
      },
      moved: [],
    },
  )
})

// Value: protects=the learner who deletes a study while the read of a recording's header failed at the look before the lock and does not under it (a scanner on Windows held the header for a moment); fails_when=the look under the lock now has a header, and the comparison of the two looks takes that header for a start of another window, so the learner is sent to save a recording in a window that may not exist; why_new=Cycle 0048 task 38 (Red Team): task 20's sentence did not come where the failed read hid the header from the first look; seam=the open of the header, which fails until right before the storage lock of the loaded library, and the injected mover; no_claim=a real scanner on Windows
test('a header whose read failed before the removal’s lock and passes under it keeps the study with a sentence about the read, not about another window', async (context) => {
  // Arrange: a saved study whose recording has a header of this host and a process id of no process; a scanner holds the header until right before the lock.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await headerOnlyRecording(storage, study.id, 'recordings.v2', {
    pid: ID_OF_NO_PROCESS,
    hostname: hostname(),
    createdAt: '2026-10-01T08:00:00.000Z',
  })
  const scanner = failEveryReadOf(
    context,
    join(storage.directory, 'recordings.v2', study.id, 'header.json'),
    { code: 'EBUSY', isLookFailing: false },
  )
  const library = await libraryWithStepBeforeTheLock(storage, async () => {
    scanner.release()
  })

  // Act
  const removal = await library.removeStudy(study.id, storage.moveToTrash)

  // Assert
  assert.deepEqual(
    { removal: { ...removal }, moved: storage.moved },
    {
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Codebook could not read a recording of this study just now. Delete the study again.',
      },
      moved: [],
    },
  )
})

// Value: protects=the learner who deletes a study while the read of a recording's writer record failed at the look before the lock and does not under it, so the record stands under the lock (a scanner on Windows held the record for a moment); fails_when=the look under the lock now has a record, and the comparison of the two looks takes that record for a start of another window, so the learner is sent to save a recording in a window that may not exist; why_new=Cycle 0048 task 38 (Red Team): task 20's sentence did not come where the record's read failed and passes under the lock with the record in place; seam=the open of the writer record, which fails until right before the storage lock of the loaded library, and the injected mover; no_claim=a real scanner on Windows
test('a writer record whose read failed before the removal’s lock and passes under it keeps the study with a sentence about the read, not about another window', async (context) => {
  // Arrange: a saved study whose recording has a header and a writer record of this host; a scanner holds the record until right before the lock.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await headerOnlyRecording(storage, study.id, 'recordings.v2', {
    pid: ID_OF_NO_PROCESS,
    hostname: hostname(),
    createdAt: '2026-10-01T08:00:00.000Z',
  })
  const recordPath = recordingOwnerRecordPath(storage.directory, study.id)
  await mkdir(dirname(recordPath), { recursive: true })
  await writeFile(
    recordPath,
    JSON.stringify({
      pid: ID_OF_NO_PROCESS,
      hostname: hostname(),
      machineId: 'machine-b',
      recording: {
        folder: 'recordings.v2',
        createdAt: '2026-10-01T08:00:00.000Z',
      },
    }),
  )
  const scanner = failEveryReadOf(context, recordPath, {
    code: 'EBUSY',
    isLookFailing: false,
  })
  const library = await libraryWithStepBeforeTheLock(storage, async () => {
    scanner.release()
  })

  // Act
  const removal = await library.removeStudy(study.id, storage.moveToTrash)

  // Assert
  assert.deepEqual(
    { removal: { ...removal }, moved: storage.moved },
    {
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Codebook could not read a recording of this study just now. Delete the study again.',
      },
      moved: [],
    },
  )
})

// Value: protects=a study whose recording another window restarted (a header of another creation time and a writer record) at the moment a read that failed before the lock ends; fails_when=the comparison without what the failed read hid also leaves out the header the first look did read, so a recording that was begun again is worded as a read that changed and the learner is told to delete again instead of to save the recording in the other window; why_new=Cycle 0048 task 38 (Red Team): the fix for the hidden header or record must keep the header that changed; seam=the open of the writer record, which fails until right before the storage lock of the loaded library, at which step the test writes a header of another creation time and its record, and the injected mover; no_claim=a real second editor window
test('a failed read of the writer record that ends together with a changed header keeps the study with the sentence about another window', async (context) => {
  // Arrange: as above, with a record held by a scanner; right before the lock another window begins the recording again, with another creation time, and the scanner lets the record go.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const folder = join(storage.directory, 'recordings.v2', study.id)
  await headerOnlyRecording(storage, study.id, 'recordings.v2', {
    pid: ID_OF_NO_PROCESS,
    hostname: hostname(),
    createdAt: '2026-10-01T08:00:00.000Z',
  })
  const recordPath = recordingOwnerRecordPath(storage.directory, study.id)
  const recordOf = (createdAt: string): string =>
    JSON.stringify({
      pid: ID_OF_NO_PROCESS,
      hostname: hostname(),
      machineId: 'machine-b',
      recording: { folder: 'recordings.v2', createdAt },
    })
  await mkdir(dirname(recordPath), { recursive: true })
  await writeFile(recordPath, recordOf('2026-10-01T08:00:00.000Z'))
  const scanner = failEveryReadOf(context, recordPath, {
    code: 'EBUSY',
    isLookFailing: false,
  })
  const library = await libraryWithStepBeforeTheLock(storage, async () => {
    await writeFile(
      join(folder, 'header.json'),
      JSON.stringify({
        owner: {
          pid: ID_OF_NO_PROCESS,
          hostname: hostname(),
          sessionId: randomUUID(),
        },
        createdAt: '2026-10-17T08:00:00.000Z',
      }),
    )
    await writeFile(recordPath, recordOf('2026-10-17T08:00:00.000Z'))
    scanner.release()
  })

  // Act
  const removal = await library.removeStudy(study.id, storage.moveToTrash)

  // Assert
  assert.deepEqual(
    { removal: { ...removal }, moved: storage.moved },
    {
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.',
      },
      moved: [],
    },
  )
})

// Value: protects=a study whose recording another computer with this host name writes, when that computer's writer record appears between this window's judgement and its lock (the instant after its header was written); fails_when=the look under the lock does not compare whether a writer record is there, so the verdict 'gone' of the header alone (this host name, no process of its id here) is reused and the recording is moved with no refusal and no dialog (TT33, CX12); why_new=Cycle 0046 third testing review TT33: no test made a record appear between the judgement and the lock; seam=the storage lock of the loaded library, right before which the test writes the record that names the recording and machine-b
test('a writer record written between the removal’s judgement and its lock keeps the study: nothing moves, and the removal says another window records it', async (context) => {
  // Arrange: a saved study whose recording has its header alone, of this host name and a process id of no process; its record appears right before the removal's lock.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await headerOnlyRecording(storage, study.id, 'recordings.v2', {
    pid: ID_OF_NO_PROCESS,
    hostname: hostname(),
    createdAt: '2026-10-01T08:00:00.000Z',
  })
  const recordPath = recordingOwnerRecordPath(storage.directory, study.id)
  const library = await libraryWithStepBeforeTheLock(storage, async () => {
    await mkdir(dirname(recordPath), { recursive: true })
    await writeFile(
      recordPath,
      JSON.stringify({
        pid: ID_OF_NO_PROCESS,
        hostname: hostname(),
        machineId: 'machine-b',
        recording: {
          folder: 'recordings.v2',
          createdAt: '2026-10-01T08:00:00.000Z',
        },
      }),
    )
  })

  // Act
  const removal = await library.removeStudy(study.id, storage.moveToTrash)

  // Assert
  assert.deepEqual(
    { removal: { ...removal }, moved: storage.moved },
    {
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.',
      },
      moved: [],
    },
  )
})

// Value: protects=a study whose recording another window of this machine sealed, and whose study that window saved after the seal, between this window's judgement and its lock; fails_when=the removal reuses the verdict of a live writer found before the lock, so it refuses a study whose run has just ended and saved it, or a look under the lock that skips the seal or the writer's record keeps refusing it; why_new=Cycle 0046 testing review TC1: no test changed the disk between the judgement and the lock; since Cycle 0047 row 98 (ADV-10) the seal alone releases no recording whose writer's record is kept, the save that follows the seal does, so the step is the seal and that save; seam=the storage lock of the loaded library, right before which the test writes the recording's seal and saves the study as that window does
test('a recording sealed, and its study saved after the seal, between the removal’s judgement and its lock moves with the study', async (context) => {
  // Arrange: a saved study whose recording a live window of this machine writes; that window seals it and saves the study right before the removal's lock.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const otherWindow = await idleChild(context)
  const recording = await recordingStillWrittenBy(storage, study, {
    pid: otherWindow.pid!,
    hostname: hostname(),
  })
  let isRunEnded = false
  const library = await libraryWithStepBeforeTheLock(storage, async () => {
    // The other window ends its run once: a later lock of the removal finds the study moved.
    if (isRunEnded) return
    isRunEnded = true
    await writeFile(join(recording, 'sealed.json'), '{}')
    await storage.library.saveStudy(study)
  })

  // Act
  const removal = await library.removeStudy(study.id, storage.moveToTrash)

  // Assert
  assert.deepEqual(
    { removal: { ...removal }, moved: storage.moved },
    {
      removal: { outcome: 'moved' },
      moved: [
        join('recordings.v2', study.id),
        `${study.id}.study.meta.v3.json`,
        `${study.id}.study.v3.json`,
      ],
    },
  )
})

// Value: protects=a learner who deletes what is left of a study (its catalog file) while another open window of this machine ends the run that records it: that window seals the recording between this window's judgement and its lock and has not saved the study yet; fails_when=the refusal still says that window "is still recording this study" and asks to "Stop its run", although its run has ended and only its save is missing, so the learner looks for a recording that no longer runs; why_new=Cycle 0047 row 55: since row 36 a sealed recording stays its run's until the study is saved, so the refusal of another window's recording also meets a finished one; seam=the recording's header and writer record, which name a live child process of the test as the other window, the storage lock of the loaded library, right before which the test writes the recording's seal, and the injected mover; no_claim=a real second editor window
test('a recording another window seals between the removal’s judgement and its lock, before it saved the study, keeps the study, and the refusal asks to save that window’s learning replay instead of saying it still records', async (context) => {
  // Arrange: a study of which only the catalog file is left beside the recording a live window of this machine writes; that window seals the recording right before the removal's lock and has not saved the study.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await rm(join(storage.directory, `${study.id}.study.v3.json`))
  const otherWindow = await idleChild(context)
  const recording = await recordingStillWrittenBy(storage, study, {
    pid: otherWindow.pid!,
    hostname: hostname(),
  })
  const library = await libraryWithStepBeforeTheLock(storage, () =>
    writeFile(join(recording, 'sealed.json'), '{}'),
  )

  // Act
  const removal = await library.removeStudy(study.id, storage.moveToTrash)

  // Assert
  assert.deepEqual(
    {
      removal: { ...removal },
      moved: storage.moved,
      leftInTheLibrary: (await readdir(storage.directory)).sort(),
    },
    {
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.',
      },
      moved: [],
      leftInTheLibrary: [
        `${study.id}.study.meta.v3.json`,
        'recording-owners',
        'recordings.v2',
      ],
    },
  )
})

// Value: protects=a recording a window of this machine starts for a saved study between this window's judgement and its lock; fails_when=a recording the removal never judged counts as finished under the lock, so the removal moves the recording that window has just begun to write; why_new=Cycle 0046 testing review TC1; seam=the storage lock of the loaded library, right before which a recording store of this machine starts the study's recording
test('a recording started between the removal’s judgement and its lock keeps the study: nothing moves, and the removal says another window records it', async (context) => {
  // Arrange: a saved study without a recording; a window of this machine starts one right before the removal's lock.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  const library = await libraryWithStepBeforeTheLock(storage, async () => {
    await storage.recordings.start(
      {
        workspaceKey: study.workspaceKey,
        studyId: study.id,
        instanceId: study.instanceId,
        runId: study.runId,
        runtimeId: randomUUID(),
        profile: study.profile,
        sourceBuild: {
          revision: 'removal-test',
          dirty: false,
          sourceHash: '1'.repeat(64),
        },
      },
      0,
    )
  })

  // Act
  const removal = await library.removeStudy(study.id, storage.moveToTrash)

  // Assert
  assert.deepEqual(
    { removal: { ...removal }, moved: storage.moved },
    {
      removal: {
        outcome: 'nothing-moved',
        cause:
          'Another editor window has not finished recording and saving this study. Save its learning replay in that window, then delete the study again.',
      },
      moved: [],
    },
  )
})
