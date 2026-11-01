import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { RepositoryBookStore } from '../repositoryBook'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StudyService } from '../service'
import { assertStudyCheckpoint } from '../utils/assertStudyCheckpoint'
import { captureStudy } from '../utils/captureStudy'
import { preparedInputsOf } from '../utils/preparedInputsOf'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

const PASSWORD = 'hunter2-prepared-password'
const EMAIL = 'learner@example.invalid'

/** Reads every file under a folder as text, so a search covers the whole evidence journal. */
async function readAllText(folder: string): Promise<string> {
  let combined = ''
  for (const entry of await readdir(folder, {
    withFileTypes: true,
    recursive: true,
  })) {
    if (!entry.isFile() || entry.name.endsWith('.png')) continue
    combined += await readFile(join(entry.parentPath, entry.name), 'utf8')
  }
  return combined
}

/** Runs a repository-browser study with a password and an email prepared, on the controlled runtime, until its first stop is committed. */
async function pausedPreparedRun(context: TestContext) {
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    initialInputs: [
      { selector: '#email', text: EMAIL },
      { selector: '#password', text: PASSWORD },
    ],
    preparedControls: {
      '#email': { type: 'email', name: 'email' },
      '#password': { type: 'password', name: 'password' },
    },
  })
  const library = new LearningLibrary(
    join(harness.directory, '.learning'),
    '0'.repeat(64),
  )
  books = new RepositoryBookStore(harness.sources, library)
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Two citations.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: harness.definition.descriptor.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  service = new StudyService(
    {
      workspace: harness.directory,
      host: {
        id: 'vscode',
        productVersion: 'test',
        apiVersion: 'test',
        commit: 'test',
      },
      build: {
        revision: 'controlled-runtime',
        dirty: false,
        sourceHash: '0'.repeat(64),
      },
      prerequisites: async () => ({ ready: true, missing: [] }),
      createRuntime: async () => harness.run,
    },
    join(harness.directory, '.service'),
  )
  service.repository = books
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'prepared-secret-study',
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, key: 'one', action: 'repository-click' })
  await waitUntil(
    () => harness.run.view().snapshots.length === 1,
    'committed first stop',
  )
  return { service, record, receipt, library, harness }
}

// protects=a prepared password is absent in plain form from the manifest resource, runtime.json, the evidence journal, the run resource and the saved study while the page still receives it; fails_when=any stored or served form keeps the declared password; no_claim=the recording context is derived from the saved study and is not built here; the page, debugger and renderer are the controlled runtime's stand-ins
test('a prepared password is masked in every stored and served form while the page receives it', async (context) => {
  // Arrange
  const { service, record, library, harness } = await pausedPreparedRun(context)
  // Act
  const manifest = await readResource(
    service,
    service.uri(record.id, 'manifest'),
  )
  const archive = await captureStudy(service, record, library.workspaceKey)
  const journal = await readAllText(harness.run.view().artifactDirectory)
  const runResource = JSON.stringify(service.state(record))
  // Assert
  assert.deepEqual(harness.insertedTexts, [EMAIL, PASSWORD])
  assert.ok(archive)
  assert.ok('text' in manifest)
  // The search is meaningful only when the journal holds the run's files.
  assert.ok(journal.length > 0)
  for (const [name, text] of [
    ['manifest resource', manifest.text],
    ['saved study', JSON.stringify(archive)],
    ['evidence journal and runtime.json', journal],
    ['run resource', runResource],
  ] as const)
    assert.equal(text.includes(PASSWORD), false, `${name} holds the password`)
  assert.deepEqual(preparedInputsOf(archive.configuration), [
    { selector: '#email', text: EMAIL },
    { selector: '#password', text: '[masked]' },
  ])
})

// protects=the configuration hash is the existing hash over the canonical redacted configuration, and the start, save, continue, re-save sequence keeps the checkpoint invariants; fails_when=the saved study hashes the declared password, or a later save changes the configuration after the first; no_claim=restart and reopen from disk is the learning library's own test; the runtime is the controlled stand-in
test('the saved study hash covers the redacted configuration and survives continue and a second save', async (context) => {
  // Arrange
  const { service, record, receipt, library, harness } =
    await pausedPreparedRun(context)
  const expectedCanonical = {
    ...harness.definition.configuration,
    initialInputs: [
      { selector: '#email', text: EMAIL },
      { selector: '#password', text: '[masked]' },
    ],
  }
  const first = await captureStudy(service, record, library.workspaceKey)
  assert.ok(first)
  // Act
  await service.continue(
    service.state(record).participants.browser.continueArguments!,
  )
  await service.stop(receipt)
  const second = await captureStudy(service, record, library.workspaceKey)
  // Assert
  assert.ok(second)
  assert.equal(
    first.configurationHash,
    sha256(JSON.stringify(expectedCanonical)),
  )
  assert.equal(second.configurationHash, first.configurationHash)
  assert.equal(service.state(record).configurationHash, first.configurationHash)
  assert.doesNotThrow(() => assertStudyCheckpoint(first, second))
})

// protects=before a prepared text's control is resolved the run resource shows [pending] and never the text, and a secret one is masked as soon as it is resolved; fails_when=the view shows the declared text before apply or stores [pending] in the hashed form; no_claim=the controlled stand-in holds the insert open, so the timing of a real page is not shown
test('a prepared text reads [pending] in the run view until its control is resolved', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    initialInputs: [
      { selector: '#password', text: PASSWORD },
      { selector: '#email', text: EMAIL },
    ],
    preparedControls: {
      '#password': { type: 'password' },
      '#email': { type: 'email' },
    },
    holdInputInsert: true,
  })
  // Act
  void harness.run.prepare().catch(() => undefined)
  await waitUntil(
    () => harness.insertedTexts.length === 1,
    'the first prepared text sent',
  )
  const view = harness.run.view()
  // Assert
  assert.deepEqual(preparedInputsOf(view.definition.configuration), [
    { selector: '#password', text: '[masked]' },
    { selector: '#email', text: '[pending]' },
  ])
  assert.equal(JSON.stringify(view).includes(PASSWORD), false)
  assert.equal(JSON.stringify(view).includes(EMAIL), false)
  assert.deepEqual([...(view.preparedTextStates ?? [])], ['secret'])
})
