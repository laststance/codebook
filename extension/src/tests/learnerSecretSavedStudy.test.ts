import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { RepositoryBookStore } from '../repositoryBook'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StudyService } from '../service'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { captureStudy } from '../utils/captureStudy'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

const SECRET = 'typed-by-learner'

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

/** Runs a version 3 study whose password the learner typed, on the controlled runtime, until its first stop is committed. */
async function pausedSecretRun(context: TestContext) {
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    capturedValue: SECRET,
    operations: {
      operations: [
        {
          kind: 'text',
          title: 'Password',
          selector: '#password',
          secret: 'ask-learner',
        },
      ],
      stopOperations: [1],
      controls: { '#password': { tagName: 'input', type: 'password' } },
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
    key: 'learner-secret-study',
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  await record.preparation
  service.action(
    { ...receipt, key: 'one', action: 'repository-operation' },
    { learnerSecret: SECRET },
  )
  await waitUntil(
    () => harness.run.view().snapshots.length === 1,
    'committed first stop',
  )
  return { service, record, receipt, library, harness }
}

// protects=ENG-4/CEO-S6: a value the page copied from the learner's secret is absent in plain form from the saved study, the recording context, the run resource, the journal and runtime.json, while the page received it; fails_when=any stored form keeps the copy; no_claim=restart and reopen from disk (learning library tests) and the real page, debugger and renderer: the controlled runtime stands in for them
test('a copy of the typed secret is masked in the saved study, the recording context, the run resource and the journal', async (context) => {
  // Arrange
  const { service, record, library, harness } = await pausedSecretRun(context)
  // Act
  const archive = await captureStudy(service, record, library.workspaceKey)
  assert.ok(archive)
  const recordingContext = buildRecordingContext(
    archive,
    service.maskLearnerSecretsInData(harness.run.view().events),
    1,
  )
  const journal = await readAllText(harness.run.view().artifactDirectory)
  // Assert
  assert.deepEqual(harness.insertedTexts, [SECRET])
  assert.ok(journal.length > 0)
  for (const [name, text] of [
    ['saved study', JSON.stringify(archive)],
    ['recording context', JSON.stringify(recordingContext)],
    ['evidence journal and runtime.json', journal],
    ['run resource', JSON.stringify(service.state(record))],
  ] as const)
    assert.equal(text.includes(SECRET), false, `${name} holds the secret`)
  assert.match(JSON.stringify(archive), /\[masked\]/)
})
