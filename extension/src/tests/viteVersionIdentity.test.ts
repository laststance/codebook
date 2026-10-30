import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { RecordingStore } from '../recordingStore'
import { RepositoryBookStore } from '../repositoryBook'
import { readResource } from '../resources'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StudyService } from '../service'
import { captureStudy } from '../utils/captureStudy'
import { createRecordingObserver } from '../utils/createRecordingObserver'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

const NO_STOPS: never[] = []

/**
 * Starts a service over a controlled run on the given adapter, clicks once and stops, so a test reads the run resource, the manifest and the captured study.
 * @param context - The test, which shuts the service down when it ends.
 * @param adapter - `vite-dev` for the Vite stand-in, absent for Next.
 * @returns The service, the receipt, the run's record and the learning library.
 */
async function runOnce(context: TestContext, adapter?: 'vite-dev') {
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await configuredRuntimeHarness(
      context,
      undefined,
      NO_STOPS,
      adapter ? { adapter } : {},
    ),
    directory = join(harness.directory, '.learning')
  const library = new LearningLibrary(directory, '0'.repeat(64)),
    store = new RecordingStore(directory, library.workspaceKey)
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
  service.recordings = store
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'identity',
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  harness.observeRecording(() => createRecordingObserver(record))
  await record.preparation
  harness.requireUnavailableValue()
  service.action({ ...receipt, key: 'one', action: 'repository-click' })
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'explicit incomplete observation',
  )
  await service.stop(receipt)
  return { service, receipt, record, library }
}

// protects=the Vite version a run started on reaches the run resource, the manifest and the saved study's identity (Final acceptance freezes supported dependency versions); fails_when=any of the three omits viteVersion for a vite-dev run; no_claim=the real launcher reporting it (viteLauncher tests)
test('a vite-dev run names the Vite version in its run resource, its manifest and its saved study', async (context) => {
  // Arrange / Act
  const { service, receipt, record, library } = await runOnce(
    context,
    'vite-dev',
  )
  const resource = await readResource(service, receipt.runUri)
  const manifest = await readResource(service, `${receipt.runUri}/manifest`)
  const archive = await captureStudy(service, record, library.workspaceKey)
  // Assert
  assert.ok('text' in resource && 'text' in manifest)
  assert.equal(JSON.parse(resource.text).viteVersion, '8.3.5')
  assert.equal(JSON.parse(manifest.text).viteVersion, '8.3.5')
  assert.equal(archive?.version, 6)
  assert.equal(archive?.viteVersion, '8.3.5')
})

// protects=a Next run's resource, manifest and study stay as they were, with no viteVersion key (existing replays and manifest hashes unchanged); fails_when=a Next run gains a viteVersion; no_claim=none
test('a Next run has no viteVersion in its run resource, its manifest or its saved study', async (context) => {
  // Arrange / Act
  const { service, receipt, record, library } = await runOnce(context)
  const resource = await readResource(service, receipt.runUri)
  const manifest = await readResource(service, `${receipt.runUri}/manifest`)
  const archive = await captureStudy(service, record, library.workspaceKey)
  // Assert
  assert.ok('text' in resource && 'text' in manifest)
  assert.equal('viteVersion' in JSON.parse(resource.text), false)
  assert.equal('viteVersion' in JSON.parse(manifest.text), false)
  assert.equal(archive?.version, 6)
  assert.equal(archive?.viteVersion, undefined)
})
