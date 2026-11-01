import { join } from 'node:path'
import type { TestContext } from 'node:test'

import { LearningLibrary } from '../../learningLibrary'
import { RepositoryBookStore } from '../../repositoryBook'
import type { RepositoryOperation } from '../../repositoryConfigSchemas'
import { StudyService } from '../../service'

import { configuredRuntimeHarness } from './configuredRuntimeHarness'

/** The operations of {@link realRunInService}: a text and a click, so a run has a first operation to confirm. */
export const REAL_RUN_OPERATIONS: RepositoryOperation[] = [
  { kind: 'text', title: 'Amount', selector: '#amount', text: '120' },
  { kind: 'click', title: 'Create Invoice', selector: 'button[type=submit]' },
]

type HarnessOptions = NonNullable<
  Parameters<typeof configuredRuntimeHarness>[3]
>

/**
 * Hosts a real ConfiguredBrowserRun (driven through the controlled CDP harness, with a fake saved-session store of the real port) in a {@link StudyService}, so the run itself decides `session` and no stand-in view does; used by the saved-session tests that join the run's decision to the confirmation dialog.
 *
 * @param context - The test context that cleans the service up.
 * @param options - `savedSession` is what the fake store answers (the saved session, or a fresh profile; absent binds no store), `session` declares `fresh` in the configuration.
 * @returns The service, the receipt of the started and prepared run, and the CDP harness whose `inputRequests` lists the `Input.*` calls.
 * @example const { service, receipt, harness } = await realRunInService(context, { savedSession: { admission: 'saved' } })
 */
export async function realRunInService(
  context: TestContext,
  options: {
    savedSession?: HarnessOptions['savedSession']
    session?: 'fresh'
    extraVariables?: HarnessOptions['extraVariables']
    /** Receives the Output > Codebook lines of the run. */
    outputLines?: string[]
  } = {},
) {
  const abort = new AbortController()
  context.after(() => abort.abort())
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  // Registered before the harness: node:test runs after hooks in registration order, so the service drains its writes before the harness removes its folder.
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await configuredRuntimeHarness(
    context,
    {
      signal: abort.signal,
      deadlineAt: Date.now() + 300_000,
      preparationDeadlineAt: Date.now() + 300_000,
      outputLog: (line) => options.outputLines?.push(line.text),
    },
    [],
    {
      savedSession: options.savedSession,
      extraVariables: options.extraVariables,
      operations: {
        operations: REAL_RUN_OPERATIONS,
        stopOperations: [2],
        signInPaths: ['/login'],
        ...(options.session ? { session: options.session } : {}),
        controls: { '#amount': { tagName: 'input', type: 'text' } },
      },
    },
  )
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
    key: 'real-run',
    configuration: harness.definition.configuration,
  })
  await service.record(receipt).preparation
  return { service, receipt, harness }
}
