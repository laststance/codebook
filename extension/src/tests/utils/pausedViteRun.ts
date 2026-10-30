import { join } from 'node:path'
import type { TestContext } from 'node:test'

import { LearningLibrary } from '../../learningLibrary'
import { RepositoryBookStore } from '../../repositoryBook'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'
import { StudyService } from '../../service'

import { configuredRuntimeHarness } from './configuredRuntimeHarness'

/**
 * Runs a Vite stop on the controlled runtime until its first pause is committed, with an env-file value as the debugger's captured value and as the inlined text of the executed module.
 * @param context - The test context, which shuts the service down when the test ends.
 * @param secret - The env-file value the debugger reports, the executed module inlines and the source map lists.
 * @returns The service, the run's record and receipt, the library and the controlled run.
 * @example
 * const { service, record, library } = await pausedViteRun(context, 'plainsecret1')
 */
export async function pausedViteRun(context: TestContext, secret: string) {
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    adapter: 'vite-dev',
    capturedValue: secret,
    moduleJavascript: `const nextTheme = "${secret}";`,
    maskedValues: [secret],
    sourceMapNames: [secret],
  })
  const directory = join(harness.directory, '.learning')
  const library = new LearningLibrary(directory, '0'.repeat(64))
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
    key: 'vite-masking-study',
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, key: 'one', action: 'repository-click' })
  await waitUntil(
    () => harness.run.view().snapshots.length === 1,
    'committed Vite pause',
  )
  return { service, record, receipt, library, harness }
}
