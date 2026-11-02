import { join } from 'node:path'
import type { TestContext } from 'node:test'

import { LearningLibrary } from '../../learningLibrary'
import { RepositoryBookStore } from '../../repositoryBook'
import { StudyService } from '../../service'

import { entryRenderHarness } from './entryRenderHarness'

/** The service-hosted entry-render run ({@link serviceHostedEntryRun}). */
export type ServiceHostedEntryRun = Awaited<
  ReturnType<typeof serviceHostedEntryRun>
>

/**
 * Hosts the real run of an entry-render harness in a {@link StudyService}, as the editor does, and starts it without waiting for its preparation: an entry-render pause is published while the run is still preparing.
 *
 * Why it exists: the run resource, `codebook_continue`, Save and Stop are service behaviours; the entry-load tests that follow the agent's call order (AC 11a, AC 15) need the service around the scripted run. Called by tests of `serverRenderEntryService.test.ts`.
 * @param context - The test; its end shuts the service down.
 * @param extra - Harness options handed to {@link entryRenderHarness}.
 * @param additionalStops - Further stops of the configuration.
 * @returns The service, the start receipt and the harness; `state()` reads the run resource.
 * @example
 * const { service, receipt, harness, state } = await serviceHostedEntryRun(context)
 * state().state // => 'preparing'
 */
export async function serviceHostedEntryRun(
  context: TestContext,
  extra: Parameters<typeof entryRenderHarness>[1] = {},
  additionalStops: Parameters<typeof entryRenderHarness>[3] = [],
) {
  const harness = await entryRenderHarness(
    context,
    extra,
    undefined,
    additionalStops,
  )
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
      summary: 'One citation.',
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
      createRuntime: async () => harness.run,
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
    key: 'run-1',
    configuration: harness.definition.configuration,
  })
  return {
    service,
    receipt,
    harness,
    /** Stops the service's maintenance timer, which releases a completed run within 250 ms and so changes its state from `completed` to `stopping` and `stopped` at a moment a loaded machine's test can straddle; a test that reads or captures the completed run calls it first, and the end of the test shuts the service down. @example run.holdMaintenance() */
    holdMaintenance: (): void => clearInterval(service['maintenance']),
    /** Reads the run resource as the agent does. @example state().participants.server?.continueArguments */
    state: () => service.state(service.record(receipt)),
  }
}
