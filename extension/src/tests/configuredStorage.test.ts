import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import type * as LearningLibraryModule from '../learningLibrary'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { atomicPrivateWrite } from '../utils/atomicPrivateWrite'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { loadModule } from './utils/loadModule'

test('retired archives cannot prevent retry from repairing a current repository checkpoint', async (context) => {
  // Arrange
  const { directory, library, study, metadataPath, archivePath } =
    await storageHarness(context)
  await library.saveStudy(study)
  await rm(metadataPath)
  const retiredPath = join(
    directory,
    '00000000-0000-4000-8000-000000000000_11111111-1111-4111-8111-111111111111.study.v2.json',
  )
  const original = '{"version":2,"unsupported":"preserve original bytes"}'
  await writeFile(retiredPath, original)
  const current = await readFile(archivePath)
  // Act
  await library.reconcile()
  // Assert
  assert.equal((await library.readCheckpoint(study.id)).status, 'saved')
  assert.equal(
    (await library.list()).find((entry) => entry.format === 'v2')?.metadata,
    'unavailable',
  )
  assert.equal(await readFile(retiredPath, 'utf8'), original)
  assert.deepEqual(await readFile(archivePath), current)
})

/** Gives storage tests private files and deterministic captured data without native runtime claims. @example const { library, study } = await storageHarness(context) */
async function storageHarness(context: TestContext) {
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-configured-storage-'),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const study = createConfiguredStudy(),
    library = new LearningLibrary(directory, study.workspaceKey)
  return {
    directory,
    study,
    library,
    archivePath: join(directory, `${study.id}.study.v3.json`),
    metadataPath: join(directory, `${study.id}.study.meta.v3.json`),
  }
}

test('interrupted configured metadata saving retains readable evidence and explicit retry repairs only its checkpoint', async (context) => {
  // Arrange
  const { directory, study, archivePath } = await storageHarness(context)
  let rejectMetadata = true
  const module = await loadModule<typeof LearningLibraryModule>(
    resolve(__dirname, '../learningLibrary.js'),
    {
      './utils/atomicPrivateWrite': {
        atomicPrivateWrite: async (
          ...arguments_: Parameters<typeof atomicPrivateWrite>
        ) => {
          if (rejectMetadata && arguments_[0].endsWith('.study.meta.v3.json'))
            throw new Error('Injected configured metadata failure')
          return atomicPrivateWrite(...arguments_)
        },
      },
    },
  )
  const library = new module.LearningLibrary(directory, study.workspaceKey)
  // Act
  await assert.rejects(library.saveStudy(study), /configured metadata failure/)
  const before = await readFile(archivePath),
    incomplete = await library.readCheckpoint(study.id)
  assert.equal((await library.list())[0]?.outcome, 'unverified')
  rejectMetadata = false
  await library.reconcile()
  const recovered = await new LearningLibrary(
    directory,
    study.workspaceKey,
  ).readCheckpoint(study.id)
  // Assert
  assert.equal(incomplete.status, 'failed')
  assert.equal(incomplete.study.observations.length, 1)
  assert.equal(recovered.status, 'saved')
  assert.equal((await library.list())[0]?.outcome, 'demonstrated')
  assert.deepEqual(await readFile(archivePath), before)
})

test('configured checkpoints advance from preparation through one observation and completion without rewriting accepted facts', async (context) => {
  // Arrange
  const { library, study } = await storageHarness(context)
  const preparing = {
    ...study,
    savedAt: study.createdAt,
    state: 'preparing',
    terminal: false,
    finalOutcome: 'pending-teardown' as const,
    descriptor: undefined,
    operation: undefined,
    observations: [],
    captures: [],
  }
  const ready = {
    ...preparing,
    savedAt: '2026-09-20T00:00:01.000Z',
    state: 'ready',
    descriptor: study.descriptor,
  }
  const paused = {
    ...study,
    savedAt: '2026-09-20T00:00:04.000Z',
    state: 'paused-browser',
    terminal: false,
    finalOutcome: 'pending-teardown' as const,
    operation: {
      ...study.operation!,
      inputAcknowledged: false,
      continuedPause: undefined,
      afterVerified: false,
    },
    captures: study.captures.slice(0, 2),
  }
  // Act
  await library.saveStudy(preparing)
  await library.saveStudy(ready)
  await library.saveStudy(paused)
  await library.saveStudy(study)
  const interpreted = structuredClone(study)
  interpreted.savedAt = '2026-09-20T00:00:11.000Z'
  interpreted.observations[0]!.interpretations.push({
    id: '55555555-5555-4555-8555-555555555555',
    text: 'The captured flag is false.',
    createdAt: '2026-09-20T00:00:11.000Z',
    facts: [{ path: 'value:enabled', value: false }],
  })
  await library.saveStudy(interpreted)
  const checkpoint = await library.readCheckpoint(study.id)
  // Assert
  assert.equal(checkpoint.status, 'saved')
  assert.equal(checkpoint.study.finalOutcome, 'demonstrated')
  assert.equal(checkpoint.study.observations[0]?.interpretations.length, 2)
  await assert.rejects(library.saveStudy(study), /older checkpoint/)
  await assert.rejects(
    library.saveStudy({
      ...interpreted,
      terminal: false,
      finalOutcome: 'pending-teardown',
    }),
    /older checkpoint/,
  )
})

test('changed configured intent, citations, operation receipts and captured facts cannot replace valid retained history', async (context) => {
  // Arrange
  const { library, study, archivePath } = await storageHarness(context)
  await library.saveStudy(study)
  const before = await readFile(archivePath)
  const changedIntent = structuredClone(study)
  changedIntent.configuration.action.title = 'Different intent'
  changedIntent.configurationHash = sha256(
    JSON.stringify(changedIntent.configuration),
  )
  const changedDescriptor = structuredClone(study)
  changedDescriptor.descriptor!.anchors.reverse()
  changedDescriptor.configuration.book.anchorIndex = 1
  changedDescriptor.configurationHash = sha256(
    JSON.stringify(changedDescriptor.configuration),
  )
  const changedOperation = structuredClone(study)
  changedOperation.operation!.key = 'another-operation'
  const changedReceipt = structuredClone(study)
  changedReceipt.finalOutcome = 'partial'
  changedReceipt.operation!.afterVerified = false
  const changedFacts = structuredClone(study)
  changedFacts.observations[0]!.values['value:nextTheme'] = 'light'
  changedFacts.observations[0]!.interpretations[0]!.facts[0]!.value = 'light'
  // Act / Assert
  await assert.rejects(
    library.saveStudy(changedIntent),
    /intent changed after acceptance/,
  )
  await assert.rejects(
    library.saveStudy(changedDescriptor),
    /intent changed after acceptance/,
  )
  await assert.rejects(
    library.saveStudy(changedOperation),
    /operation identity/,
  )
  await assert.rejects(library.saveStudy(changedReceipt), /confirmed receipts/)
  await assert.rejects(library.saveStudy(changedFacts), /Captured observation/)
  assert.deepEqual(await readFile(archivePath), before)
  assert.equal((await library.readCheckpoint(study.id)).status, 'saved')
})

test('configured copied source descriptors cannot change even when a new descriptor is internally consistent', async (context) => {
  // Arrange
  const { library, study, archivePath } = await storageHarness(context)
  await library.saveStudy(study)
  const before = await readFile(archivePath)
  const changed = structuredClone(study)
  // Ordered acquisition sources are sealed once; even an equivalent reorder cannot replace them later.
  changed.descriptor!.sources.reverse()
  // Act / Assert
  await assert.rejects(library.saveStudy(changed), /descriptor changed/)
  assert.deepEqual(await readFile(archivePath), before)
})

test('competing configured checkpoint writers preserve the winning interpretation instead of losing it', async (context) => {
  // Arrange
  const { library, directory, study } = await storageHarness(context)
  await library.saveStudy(study)
  const other = new LearningLibrary(directory, study.workspaceKey),
    first = structuredClone(study),
    second = structuredClone(study)
  first.observations[0]!.interpretations.push({
    id: '55555555-5555-4555-8555-555555555555',
    text: 'First annotation.',
    createdAt: '2026-09-20T00:00:10.000Z',
    facts: [{ path: 'value:nextTheme', value: 'dark' }],
  })
  second.observations[0]!.interpretations.push({
    id: '66666666-6666-4666-8666-666666666666',
    text: 'Second annotation.',
    createdAt: '2026-09-20T00:00:10.000Z',
    facts: [{ path: 'value:enabled', value: false }],
  })
  // Act
  const results = await Promise.allSettled([
    library.saveStudy(first),
    other.saveStudy(second),
  ])
  const checkpoint = await library.readCheckpoint(study.id)
  // Assert
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  )
  assert.equal(
    results.filter((result) => result.status === 'rejected').length,
    1,
  )
  assert.equal(checkpoint.study.observations[0]?.interpretations.length, 2)
  assert.equal(checkpoint.status, 'saved')
})

test('a mismatched configured checkpoint hash is repaired explicitly without replacing captured bytes', async (context) => {
  // Arrange
  const { library, study, archivePath, metadataPath } =
    await storageHarness(context)
  await library.saveStudy(study)
  const before = await readFile(archivePath)
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  metadata.archive.hash = '0'.repeat(64)
  await writeFile(metadataPath, JSON.stringify(metadata))
  // Act
  const invalid = await library.readCheckpoint(study.id)
  await library.reconcile()
  const repaired = await library.readCheckpoint(study.id)
  // Assert
  assert.equal(invalid.status, 'failed')
  assert.match(invalid.reason!, /differs from its catalog checkpoint/)
  assert.equal(repaired.status, 'saved')
  assert.deepEqual(await readFile(archivePath), before)
})
