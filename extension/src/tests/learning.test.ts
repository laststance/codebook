import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { LearningLibrary } from '../learningLibrary'
import {
  learningState,
  type LearnerDecision,
  type StudyArchive,
} from '../studyModel'
import { validateStudy } from '../utils/validateStudy'
import { loadModule } from './utils/loadModule'
import { atomicPrivateWrite } from '../utils/atomicPrivateWrite'
import { decodeLearnerProgress } from '../utils/decodeLearnerProgress'

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
  const writer = await loadModule<typeof import('../utils/atomicPrivateWrite')>(
    resolve(__dirname, '../utils/atomicPrivateWrite.js'),
    {
      'node:fs/promises': {
        ...filesystem,
        rename: async () => {
          throw new Error('Injected rename failure')
        },
      },
    },
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
