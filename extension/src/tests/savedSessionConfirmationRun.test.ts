import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { RepositoryBookStore } from '../repositoryBook'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StudyService } from '../service'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

const OPERATION_ACTION = 'repository-operation'

const OPERATIONS: RepositoryOperation[] = [
  { kind: 'text', title: 'Amount', selector: '#amount', text: '120' },
  { kind: 'click', title: 'Create Invoice', selector: 'button[type=submit]' },
]

/**
 * Hosts a real {@link ConfiguredBrowserRun} (driven through the controlled CDP harness) in a {@link StudyService}, reporting the saved session as lane B will: the run's view gets `session: 'saved'`.
 * @example const { service, receipt, harness } = await savedSessionRun(context)
 */
async function savedSessionRun(context: TestContext) {
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    operations: {
      operations: OPERATIONS,
      stopOperations: [2],
      controls: { '#amount': { tagName: 'input', type: 'text' } },
    },
  })
  // A stand-in for lane B's decision: the real run does not set `session` yet.
  const savedRun = new Proxy(harness.run, {
    get(target, property) {
      if (property === 'view')
        return () => ({ ...target.view(), session: 'saved' as const })
      const member = Reflect.get(target, property, target)
      return typeof member === 'function' ? member.bind(target) : member
    },
  })
  const library = new LearningLibrary(
    join(harness.directory, '.learning'),
    '0'.repeat(64),
  )
  const books = new RepositoryBookStore(harness.sources, library)
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
  const service = new StudyService(
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
      createRuntime: async () => savedRun,
    },
    join(harness.directory, '.service'),
  )
  service.repository = books
  context.after(async () => {
    await service.shutdown()
    books.dispose()
  })
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'saved-session-run',
    configuration: harness.definition.configuration,
  })
  await service.record(receipt).preparation
  return { service, receipt, harness }
}

// protects=AC6a: a declined confirmation sends no CDP Input.* request to the page, the run stays ready with operation 1 not run, and after Review again and Run the same operation is sent; fails_when=any Input request reaches the page before a confirmed answer; no_claim=a real browser or editor (the harness fakes the protocol); session saved is set by the test as lane B's stand-in
test('a declined confirmation sends no input event to the page, and Review again then Run sends operation 1', async (context) => {
  // Arrange
  const { service, receipt, harness } = await savedSessionRun(context)
  const answers = [false, true]
  const { environment } = service
  environment.confirmSavedSessionOperations = async () =>
    answers.shift() ?? false
  environment.noticeOperationsConfirmation = async () => undefined
  // Act
  const declined = await service
    .performAction({ ...receipt, key: 'op-1', action: OPERATION_ACTION })
    .catch((error: { code: string }) => error)
  // Assert: nothing reached the page
  assert.equal((declined as { code: string }).code, 'OPERATIONS_NOT_CONFIRMED')
  assert.deepEqual(harness.inputRequests, [])
  assert.deepEqual(harness.insertedTexts, [])
  assert.equal(harness.run.view().status, 'ready')
  assert.equal(harness.run.view().operations?.[0]?.state, 'not-run')
  // Act
  assert.equal(
    await service.reviewSavedSessionOperations(receipt.runId),
    'confirmed',
  )
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  await waitUntil(
    () => harness.run.view().operations?.[0]?.state === 'done',
    'operation 1 done',
  )
  // Assert: after Run the operation reached the page
  assert.notEqual(harness.inputRequests.length, 0)
})
