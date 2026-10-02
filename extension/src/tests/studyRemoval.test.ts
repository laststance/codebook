import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { test, type TestContext } from 'node:test'

import { LearningLibrary, type StudyMover } from '../learningLibrary'
import { RecordingStore } from '../recordingStore'

import { createConfiguredStudy } from './utils/createConfiguredStudy'

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
  // Arrange
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  const filesBefore = await filesBelow(storage.directory)
  storage.rejectMovesOf(() => true)
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
    cause:
      'Learning storage is locked by another writer or an interrupted session. No data changed; retry after resolving the lock.',
  })
  assert.deepEqual(storage.moved, [])
  assert.deepEqual(
    (await storage.library.list()).map((entry) => entry.id),
    [study.id],
  )
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

// Value: protects=a learner ledger that cannot be read stops a removal before its first move, so no recording leaves while the ledger may still name the study; fails_when=the ledger is read only when its rewrite step is reached, after the recording already went to the Trash; why_new=every removal test arranges a ledger that is readable or absent; seam=none
test('a removal on a library whose learner ledger cannot be read moves nothing and keeps the study with its recording', async (context) => {
  // Arrange: a saved study with a recording; the ledger file holds a version the library does not read.
  const storage = await removalStorage(context, 4)
  const study = await saveStudyWithRecording(storage)
  await writeFile(
    join(storage.directory, 'progress.repository.v4.json'),
    '{"version":3}',
  )
  const filesBefore = await filesBelow(storage.directory)
  // Act
  const removal = await storage.library.removeStudy(
    study.id,
    storage.moveToTrash,
  )
  // Assert
  assert.deepEqual(removal, {
    outcome: 'nothing-moved',
    cause: 'Version 4 progress has an incompatible schema.',
  })
  assert.deepEqual(storage.moved, [])
  assert.deepEqual(await filesBelow(storage.directory), filesBefore)
  assert.deepEqual(
    (await storage.recordings.list()).map((entry) => entry.studyId),
    [study.id],
  )
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

// Value: protects=a removal that changed the ledger and could not undo it says so, instead of claiming that nothing changed; fails_when=a failed write-back is swallowed and the outcome stays "nothing moved" while the ledger no longer names the study; why_new=the write-back is new; seam=the injected mover, which blocks the ledger path before it refuses the move
test('a removal that moved nothing and cannot write the ledger back is reported as partly moved and names both failures', async (context) => {
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
    /^\{"outcome":"partly-moved","cause":"Trash refused the archive; the learner ledger could not be written back: EISDIR/,
  )
  assert.deepEqual(
    (await readdir(storage.directory)).filter((name) => name.endsWith('.tmp')),
    [],
  )
})

// Value: protects=a ledger that so far existed only as a historical file reads the same after a removal that moved nothing; fails_when=the write-back needs the repository ledger file to have existed, or leaves the ledger without the selection of a study that is still there; why_new=the write-back has a second source for its bytes when the repository ledger file is created by the removal itself; seam=the injected mover
test('a removal that moved nothing leaves a ledger read from a historical file with the same selection and the historical file untouched', async (context) => {
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
