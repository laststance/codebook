import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fsPromises, {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { sha256 } from '../runtimeSupport/utils/sha256'
import {
  learningState,
  type LearnerDecision,
  type StudyArchive,
} from '../studyModel'
import type * as AtomicPrivateBytesModule from '../utils/atomicPrivateBytes'
import { atomicPrivateWrite } from '../utils/atomicPrivateWrite'
import type * as AtomicPrivateWriteModule from '../utils/atomicPrivateWrite'
import { decodeLearnerProgress } from '../utils/decodeLearnerProgress'
import { systemTrashName } from '../utils/systemTrashName'
import { validateStudy } from '../utils/validateStudy'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { loadModule } from './utils/loadModule'

const workspaceKey = sha256('workspace-a'),
  source = 'const nextTheme = \"dark\";\n',
  sourceHash = sha256(source)

/** Supplies a bounded captured stop to persistence/selection regressions without simulating a real debugger. @example const study = capturedStudy() */
function capturedStudy(): StudyArchive & {
  instanceId: ReturnType<typeof randomUUID>
} {
  const instanceId = randomUUID(),
    runId = randomUUID(),
    study = createConfiguredStudy(source)
  return {
    ...study,
    workspaceKey,
    id: `${instanceId}_${runId}`,
    instanceId,
    runId,
    terminal: false,
    finalOutcome: 'pending-teardown',
    observations: study.observations.map((observation) => ({
      ...observation,
      interpretations: [],
      snapshotUri: `codebook://${instanceId}/runs/${runId}/snapshots/${encodeURIComponent(observation.id)}`,
    })),
  }
}

/** Makes explicit learner intents for library tests, never derived from execution success. @example decision(true) */
function decision(understood: boolean): LearnerDecision {
  return {
    id: randomUUID(),
    item: 'repository/interface/theme',
    sourceHash,
    understood,
    context: { kind: 'source' },
    at: '2026-09-18T10:00:00.000Z',
  }
}

test('capturing a successful observation never checks understanding and explicit choices survive a fresh library instance', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, workspaceKey),
    study = capturedStudy()
  // Act
  await library.saveStudy(study)
  const before = await library.readProgress()
  await library.decide(decision(true))
  const restarted = new LearningLibrary(directory, workspaceKey),
    after = await restarted.readProgress()
  // Assert
  assert.equal(before.decisions.length, 0)
  assert.equal(
    learningState(after, 'repository/interface/theme', sourceHash).understood,
    true,
  )
  assert.equal(
    (await restarted.readStudy(study.id)).observations[0]?.values[
      'value:nextTheme'
    ],
    'dark',
  )
  await assert.rejects(
    new LearningLibrary(directory, sha256('workspace-b')).readProgress(),
    /another workspace/,
  )
  await assert.rejects(
    new LearningLibrary(directory, sha256('workspace-b')).readStudy(study.id),
    /different workspace/,
  )
})

test('understanding is scoped to the learning item even when another item uses identical source bytes', () => {
  // Arrange
  const progress = decodeLearnerProgress(
    {
      version: 4,
      workspaceKey,
      decisions: [
        { ...decision(true), item: 'repository/interface/alternate' },
      ],
    },
    workspaceKey,
  )
  // Act
  const selected = learningState(
    progress,
    'repository/interface/theme',
    sourceHash,
  )
  // Assert
  assert.equal(selected.understood, false)
  assert.equal(
    learningState(progress, 'repository/interface/alternate', sourceHash)
      .understood,
    true,
  )
})

test('queued learner choices and navigation retain both decisions and repeated intent does not double count', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, workspaceKey),
    checked = decision(true),
    unchecked = decision(false)
  // Act
  await Promise.all([
    library.decide(checked),
    library.select({
      profile: 'repository-browser',
      itemId: 'repository/interface/alternate',
      follow: false,
      tab: 'overview',
    }),
    library.decide(unchecked),
  ])
  const progress = await library.decide(unchecked)
  // Assert
  assert.equal(progress.decisions.length, 2)
  assert.equal(progress.selection?.itemId, 'repository/interface/alternate')
  assert.equal(
    learningState(progress, 'repository/interface/theme', sourceHash)
      .understood,
    false,
  )
  await assert.rejects(
    library.decide({ ...unchecked, understood: true }),
    /different decision/,
  )
})

test('another writer or corrupt progress fails visibly without replacing persisted learner history', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, workspaceKey)
  await library.decide(decision(true))
  const path = join(directory, 'progress.repository.v4.json'),
    prior = await readFile(path, 'utf8')
  await writeFile(join(directory, 'writer.lock'), 'another writer')
  // Act / Assert
  await assert.rejects(library.decide(decision(false)), /locked/)
  assert.equal(await readFile(path, 'utf8'), prior)
  await rm(join(directory, 'writer.lock'))
  await writeFile(path, '{broken')
  await assert.rejects(
    library.select({
      profile: 'repository-browser',
      itemId: 'repository/interface/alternate',
      follow: false,
      tab: 'overview',
    }),
  )
  assert.equal(await readFile(path, 'utf8'), '{broken')
})

test('altered captured source or image cannot be read as the original historical observation', () => {
  // Arrange
  const changedSource = capturedStudy(),
    changedImage = capturedStudy()
  changedSource.observations[0]!.source.text = 'different source'
  changedImage.captures = [
    {
      phase: 'paused-browser',
      status: 'captured',
      base64: Buffer.from('other image').toString('base64'),
      hash: sha256('test-image-bytes'),
    },
  ]
  // Act / Assert
  assert.throws(
    () => validateStudy(changedSource, workspaceKey),
    /source differs/,
  )
  assert.throws(
    () => validateStudy(changedImage, workspaceKey),
    /image.*changed/,
  )
})

test('a later checkpoint cannot rewrite captured values or erase an existing observation', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, workspaceKey),
    study = capturedStudy()
  await library.saveStudy(study)
  // Act / Assert
  await assert.rejects(
    async () => library.saveStudy({ ...study, observations: [] }),
    /observation.*changed|captured pause/,
  )
  const changed = structuredClone(study)
  changed.observations[0]!.values['value:nextTheme'] = 'light'
  await assert.rejects(
    async () => library.saveStudy(changed),
    /observation.*changed|captured pause/,
  )
  assert.equal(
    (await library.readStudy(study.id)).observations[0]?.values[
      'value:nextTheme'
    ],
    'dark',
  )
})

test('a rejected atomic rename retains the old value and cleans its own incomplete temporary file', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'progress.repository.v4.json')
  await writeFile(path, 'old value')
  const filesystem = await import('node:fs/promises')
  // The JSON writer publishes through the byte writer, which owns the rename.
  const byteWriter = await loadModule<typeof AtomicPrivateBytesModule>(
    resolve(__dirname, '../utils/atomicPrivateBytes.js'),
    {
      'node:fs/promises': {
        ...filesystem,
        rename: async () => {
          throw new Error('Injected rename failure')
        },
      },
    },
  )
  const writer = await loadModule<typeof AtomicPrivateWriteModule>(
    resolve(__dirname, '../utils/atomicPrivateWrite.js'),
    { './atomicPrivateBytes': byteWriter },
  )
  // Act / Assert
  await assert.rejects(
    writer.atomicPrivateWrite(path, { understood: true }, 1000),
    /rename failure/,
  )
  assert.equal(await readFile(path, 'utf8'), 'old value')
  assert.deepEqual(await readdir(directory), ['progress.repository.v4.json'])
})

test('a configured sixteen-entry library rejects the seventeenth study without losing history and still checkpoints an existing study', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, workspaceKey, () => 16),
    studies = Array.from({ length: 16 }, () => capturedStudy())
  for (const study of studies) await library.saveStudy(study)
  const before = await Promise.all(
    studies.map((study) =>
      readFile(join(directory, `${study.id}.study.v3.json`), 'utf8'),
    ),
  )
  // Act
  await assert.rejects(library.saveStudy(capturedStudy()), /library is full/)
  const after = await Promise.all(
    studies.map((study) =>
      readFile(join(directory, `${study.id}.study.v3.json`), 'utf8'),
    ),
  )
  await library.saveStudy({
    ...studies[0]!,
    savedAt: '2026-09-20T00:00:11.000Z',
    terminal: true,
  })
  // Assert
  assert.deepEqual(after, before)
  assert.equal((await library.list()).length, 16)
  assert.equal((await library.readStudy(studies[0]!.id)).terminal, true)
  assert.equal((await readdir(directory)).includes('writer.lock'), false)
})

// Value: protects=after a rollback a study the newer release saved stays listed, counted and untouched, and its older file never stands in for it; fails_when=the listing skips a file whose format number it does not know and shows the older file as the study, or a read ends in a schema error (RT-1, DX-15, PC-4.1); why_new=the library knew only the suffixes of its own formats; seam=the library directory, into which the test writes files as a newer Codebook would name them
test('a library that holds a study in a newer format beside its older file lists it as saved by a newer Codebook, counts it once and refuses to read it', async (context) => {
  // Arrange: one study this Codebook saved, one study that also has a file in format 5, and one whose format 4 files (archive and sidecar) hold format 6.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, workspaceKey, () => 16),
    readable = capturedStudy(),
    savedAgainByNewer = capturedStudy(),
    newerInKnownFile = capturedStudy()
  await library.saveStudy(readable)
  await library.saveStudy(savedAgainByNewer)
  const newerPath = join(directory, `${savedAgainByNewer.id}.study.v5.json`),
    newerBytes = JSON.stringify({ ...savedAgainByNewer, version: 5 })
  await writeFile(newerPath, newerBytes)
  await writeFile(
    join(directory, `${newerInKnownFile.id}.study.v4.json`),
    JSON.stringify({ ...newerInKnownFile, version: 6 }),
  )
  await writeFile(
    join(directory, `${newerInKnownFile.id}.study.meta.v4.json`),
    JSON.stringify({ version: 6, id: newerInKnownFile.id }),
  )
  const olderBytes = await readFile(
    join(directory, `${savedAgainByNewer.id}.study.v3.json`),
    'utf8',
  )
  // Act
  const listed = await library.list(),
    count = await library.savedStudyCount()
  const readOfNewer = library.readStudy(savedAgainByNewer.id),
    checkpointOfNewer = library.readCheckpoint(savedAgainByNewer.id),
    readOfKnownFile = library.readStudy(newerInKnownFile.id)
  // Assert
  const newerSentence =
      'This study was saved in format 5 by a newer Codebook; this Codebook reads formats up to 4. Update the extension to open it. The study is kept as it is.',
    newerSentenceOfKnownFile =
      'This study was saved in format 6 by a newer Codebook; this Codebook reads formats up to 4. Update the extension to open it. The study is kept as it is.'
  await assert.rejects(readOfNewer, { message: newerSentence })
  await assert.rejects(checkpointOfNewer, { message: newerSentence })
  await assert.rejects(readOfKnownFile, { message: newerSentenceOfKnownFile })
  assert.equal(count, 3)
  assert.deepEqual(
    Object.fromEntries(
      listed.map((entry) => [
        entry.id,
        {
          format: entry.format,
          metadata: entry.metadata,
          outcome: entry.outcome,
          reason: entry.reason,
        },
      ]),
    ),
    {
      [readable.id]: {
        format: 'v3',
        metadata: 'validated',
        outcome: 'pending-teardown',
        reason: undefined,
      },
      [savedAgainByNewer.id]: {
        format: 'newer',
        metadata: 'unavailable',
        outcome: 'Saved by a newer Codebook; kept as it is',
        reason: newerSentence,
      },
      [newerInKnownFile.id]: {
        format: 'newer',
        metadata: 'unavailable',
        outcome: 'Saved by a newer Codebook; kept as it is',
        reason: newerSentenceOfKnownFile,
      },
    },
  )
  assert.equal(await readFile(newerPath, 'utf8'), newerBytes)
  assert.equal(
    await readFile(
      join(directory, `${savedAgainByNewer.id}.study.v3.json`),
      'utf8',
    ),
    olderBytes,
  )
})

// Value: protects=a learner whose editor could not move a saved study to the Trash is not told to delete one when a save is refused; fails_when=the library words its refusal without asking whether a removal can work in this window (B-M3, C-L3); why_new=only the run refusal read the removal availability; seam=the library's reader of the removal availability
test('a save refused by a full library names no delete remedy after this editor’s Trash refused a removal', async (context) => {
  // Arrange: a library full at one study, in a window whose last removal left its study in the library.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(
    directory,
    workspaceKey,
    () => 1,
    () => 'trash-refused',
  )
  await library.saveStudy(capturedStudy())
  // Act
  const save = library.saveStudy(capturedStudy())
  // Assert
  await assert.rejects(save, {
    message: `Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, then retry storage; this editor could not move a saved study to the ${systemTrashName()} in this session. Existing learning was kept.`,
  })
})

test('one thousand learner choices retain their bytes when new intent is rejected and identical retry still succeeds', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, workspaceKey),
    decisions = Array.from({ length: 1000 }, () => decision(true))
  const path = join(directory, 'progress.repository.v4.json'),
    before = JSON.stringify({ version: 4, workspaceKey, decisions })
  await writeFile(path, before)
  // Act
  await assert.rejects(library.decide(decision(false)), /history is full/)
  const retried = await library.decide(decisions[999]!)
  // Assert
  assert.equal(retried.decisions.length, 1000)
  assert.equal(await readFile(path, 'utf8'), before)
  assert.equal((await readdir(directory)).includes('writer.lock'), false)
})

test('the exact UTF-8 byte limit is writable and an oversized replacement preserves the old document', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'progress.repository.v4.json')
  // Act
  await atomicPrivateWrite(path, 'あ', 5)
  await assert.rejects(
    atomicPrivateWrite(path, 'あい', 5),
    /Storage limit exceeded/,
  )
  // Assert
  assert.equal(await readFile(path, 'utf8'), '"あ"')
  assert.deepEqual(await readdir(directory), ['progress.repository.v4.json'])
})

// Value: protects=Retry storage over a full library reads every study's checkpoint without listing the library directory once a study (Cycle 0045 review PL-4); fails_when=each read of a study lists the directory for a newer format, so the listings grow with studies times files; why_new=no test counted the listings; seam=the directory listing of node:fs/promises
test('Retry storage over sixty-four saved studies lists the library directory once', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, workspaceKey, () => 64)
  for (let saved = 0; saved < 64; saved += 1)
    await library.saveStudy(capturedStudy())
  let listingsOfLibrary = 0
  const readdirBefore = fsPromises.readdir
  context.mock.method(
    fsPromises,
    'readdir',
    (...input: Parameters<typeof readdirBefore>) => {
      if (input[0] === directory) listingsOfLibrary += 1
      return readdirBefore(...input)
    },
  )
  // Act
  await library.reconcile()
  // Assert
  assert.equal(listingsOfLibrary, 1)
})

// Value: protects=a file in the library directory that is named like an archive of a newer format but belongs to no study leaves the saved studies usable (Cycle 0045 review PL-5); fails_when=the listing parses the file's prefix as a study id and throws, which breaks the list, the save admission, the removal, forgetting absent studies and Retry storage together; why_new=every listing test named its files after study ids; seam=the library directory, into which the test writes the stray file
test('a stray x.study.v5.json in the library leaves the list, save admission, removal, forgetting absent studies and Retry storage working', async (context) => {
  // Arrange: two saved studies and the stray file beside them.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, workspaceKey, () => 3),
    kept = capturedStudy(),
    removed = capturedStudy(),
    removedByHand = capturedStudy()
  await library.saveStudy(kept)
  await library.saveStudy(removed)
  await writeFile(join(directory, 'x.study.v5.json'), '{"version":5}')
  // Act
  const listedIds = (await library.list()).map((entry) => entry.id).sort()
  const admitsThird = await library.admitsStudy(removedByHand.id)
  await library.saveStudy(removedByHand)
  const removal = await library.removeStudy(removed.id, (path) =>
    rm(path, { recursive: true }),
  )
  await library.select({
    studyId: removedByHand.id,
    profile: 'repository-browser',
    itemId: 'repository/interface/theme',
    follow: false,
    tab: 'overview',
  })
  await rm(join(directory, `${removedByHand.id}.study.v3.json`))
  await rm(join(directory, `${removedByHand.id}.study.meta.v3.json`))
  const forgotten = await library.forgetAbsentStudies()
  const retry = await library.reconcile().then(
    () => 'reconciled',
    (error: unknown) => String(error),
  )
  // Assert
  assert.deepEqual(listedIds, [kept.id, removed.id].sort())
  assert.equal(admitsThird, true)
  assert.deepEqual(removal, { outcome: 'moved' })
  assert.deepEqual(forgotten, [removedByHand.id])
  assert.equal(retry, 'reconciled')
  assert.deepEqual(
    (await library.list()).map((entry) => entry.id),
    [kept.id],
  )
  assert.equal(
    await readFile(join(directory, 'x.study.v5.json'), 'utf8'),
    '{"version":5}',
  )
})

// Value: protects=Retry storage still repairs the library when one study's known file holds the format of a newer Codebook, and writes over neither that study's archive nor its catalog sidecar; fails_when=the repair reads that study's archive, which is refused as a newer format, and the whole Retry storage fails with that study's sentence, or a sidecar of a newer format beside a readable archive counts as a failed checkpoint and is written again in this Codebook's format, although the list shows the study as kept as it is (Cycle 0046 row 94); why_new=found in Cycle 0046 while the repair was changed to read each study from the one listing; the sidecar was added by the delegated review of that change; seam=the library directory, into which the test writes the files a newer Codebook would write under a known name
test('Retry storage over a library with a study a newer Codebook saved under a known file name repairs the other studies and keeps that study as it is', async (context) => {
  // Arrange: one saved study whose sidecar is gone, one study whose format 4 archive holds format 6, and one saved study whose sidecar a newer Codebook wrote again in format 6 beside the readable archive.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-learning-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, workspaceKey, () => 16),
    repaired = capturedStudy(),
    newerInKnownFile = capturedStudy(),
    newerSidecarOnly = capturedStudy()
  await library.saveStudy(repaired)
  await rm(join(directory, `${repaired.id}.study.meta.v3.json`))
  const newerBytes = JSON.stringify({ ...newerInKnownFile, version: 6 })
  await writeFile(
    join(directory, `${newerInKnownFile.id}.study.v4.json`),
    newerBytes,
  )
  await library.saveStudy(newerSidecarOnly)
  const newerSidecar = join(
      directory,
      `${newerSidecarOnly.id}.study.meta.v3.json`,
    ),
    newerSidecarBytes = JSON.stringify({ version: 6, id: newerSidecarOnly.id })
  await writeFile(newerSidecar, newerSidecarBytes)
  // Act
  const retry = await library.reconcile().then(
    () => 'reconciled',
    (error: unknown) => String(error),
  )
  const checkpointOfNewerSidecar = await library
    .readCheckpoint(newerSidecarOnly.id)
    .then(
      (checkpoint) => checkpoint.status,
      (error: unknown) => String(error),
    )
  // Assert
  assert.equal(retry, 'reconciled')
  assert.equal((await library.readCheckpoint(repaired.id)).status, 'saved')
  assert.equal(
    await readFile(
      join(directory, `${newerInKnownFile.id}.study.v4.json`),
      'utf8',
    ),
    newerBytes,
  )
  assert.equal(await readFile(newerSidecar, 'utf8'), newerSidecarBytes)
  assert.equal(
    checkpointOfNewerSidecar,
    'Error: This study was saved in format 6 by a newer Codebook; this Codebook reads formats up to 4. Update the extension to open it. The study is kept as it is.',
  )
  assert.deepEqual(
    (await library.list())
      .filter((entry) => entry.id === newerSidecarOnly.id)
      .map((entry) => ({ format: entry.format, outcome: entry.outcome })),
    [{ format: 'newer', outcome: 'Saved by a newer Codebook; kept as it is' }],
  )
})
