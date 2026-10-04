import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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
  writeFile,
} from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { test, type TestContext } from 'node:test'

import { LearningLibrary, type StudyMover } from '../learningLibrary'
import { RecordingStore } from '../recordingStore'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { createCrossRuntimeStudy } from './utils/createCrossRuntimeStudy'

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
  })
  assert.deepEqual(storage.moved, [])
  assert.equal((await readFile(ledgerPath)).equals(ledgerBefore), true)
  assert.deepEqual(await storage.library.readStudy(study.id), study)
})

// Value: protects=a removal that moved no file says that nothing moved and names the write-back that failed, so the reader keeps a study that is whole; fails_when=a failed write-back is swallowed, or it is answered as partly moved although no path is in the Trash; why_new=the write-back is new; seam=the injected mover, which blocks the ledger path before it refuses the move
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
  // Assert
  assert.match(
    JSON.stringify(removal),
    /^\{"outcome":"nothing-moved","cause":"Trash refused the archive; the learner ledger could not be written back: EISDIR/,
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

/** Gives the id of a process that has already exited on this machine, as the editor that left a lock or a connection descriptor behind. @example const pid = exitedProcessId() */
function exitedProcessId(): number {
  const exited = spawnSync(process.execPath, ['-e', ''])
  assert.equal(typeof exited.pid, 'number')
  return exited.pid
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

// Value: protects=an interrupted reservation's recording directory, which has no study, is not moved by asking to remove that id; fails_when=a removal without an archive moves the recording (the recording would be orphaned from nothing, or a later study's recording lost); why_new=the unknown-id test used an id without any files (0038-T4); seam=the injected mover
test('a recording directory without a saved study stays in place when that id is asked to be removed, and nothing moves', async (context) => {
  // Arrange: a recording directory under an id the library holds no archive for.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  await rm(join(storage.directory, `${study.id}.study.meta.v3.json`))
  await rm(join(storage.directory, `${study.id}.study.v3.json`))
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, {
    outcome: 'nothing-moved',
    cause: 'Study archive is unavailable.',
  })
  assert.deepEqual(storage.moved, [])
  assert.equal(
    (
      await lstat(join(storage.directory, 'recordings.v2', study.id))
    ).isDirectory(),
    true,
  )
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

// Value: protects=a storage lock left by an editor that was killed mid-removal does not refuse every later write until it is removed by hand; fails_when=a lock whose process no longer exists on this machine is treated like a live writer's lock (0038-F13); why_new=the lock tests used a lock of a live process; seam=a real exited process
test('a storage lock left by an exited editor process on this machine is taken over and the removal completes', async (context) => {
  // Arrange: the lock file names a process of this machine that has exited.
  const storage = await removalStorage(context, 4)
  const study = await saveStudy(storage)
  await writeFile(
    join(storage.directory, 'writer.lock'),
    JSON.stringify({ pid: exitedProcessId(), hostname: hostname() }),
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
    message: `Learning storage is locked by another writer or an interrupted session (lock file: ${join(await realpath(storage.directory), 'writer.lock')}). No data changed; retry after resolving the lock.`,
  })
})
