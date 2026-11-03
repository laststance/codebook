import { join } from 'node:path'
import type { TestContext } from 'node:test'

import { LearningLibrary } from '../../learningLibrary'
import { RepositoryBookStore } from '../../repositoryBook'
import type { RuntimeControl } from '../../runtime'
import { StudyService } from '../../service'

import { configuredRuntimeHarness } from './configuredRuntimeHarness'
import type { PagesHitScript, ServerHit } from './serverRenderParticipant'

/** The entry page of a Pages server run: `getServerSideProps` holds `const count = 3` on line 5 and returns it on line 6. */
export const PAGES_SERVER_PAGE_SOURCE = [
  'export default function Home({ count }) {',
  '  return count',
  '}',
  'export async function getServerSideProps({ query }) {',
  '  const count = 3',
  '  return { props: { count } }',
  '}',
  '',
].join('\n')

/** The line of {@link PAGES_SERVER_PAGE_SOURCE} that returns the props. */
export const PAGES_SERVER_RETURN_LINE = 6

/** Where the entry page lives in the stand-in project. */
export const PAGES_SERVER_PAGE_PATH = 'src/pages/index.tsx'

/** What a Pages server run harness accepts beyond its defaults ({@link configuredRuntimeHarness}'s options and the control). */
export type PagesServerRunOptions = Partial<
  Parameters<typeof configuredRuntimeHarness>[3]
> & {
  control?: RuntimeControl
  additionalStops?: Parameters<typeof configuredRuntimeHarness>[2]
}

/**
 * Gives the generated place and the source place of a hit on a line of a stand-in page, whose server module maps one generated line to each source line, with the stack the hit pauses with.
 * @param line - The 1-based source line the stop sits on.
 * @param pages - The recorded stack the hit pauses with.
 * @returns The fields a scripted server hit takes.
 * @example harness.server!.hit(hitOnLine(6, { fixture: 'get-server-side-props-before-await' }))
 */
export function hitOnLine(
  line: number,
  pages: PagesHitScript,
): Pick<ServerHit, 'generated' | 'source' | 'pages'> {
  return {
    generated: { line: line - 1, column: 0 },
    source: { line, column: 1 },
    pages,
  }
}

/**
 * Builds the control the service gives a run; the whole-run deadline is far away so a test moves only the clock it means to.
 * @param context - The test, whose end aborts the run.
 * @returns The run's control.
 * @example pagesControl(context).runId // => 'service-run-73'
 */
export function pagesControl(context: TestContext): RuntimeControl {
  const abort = new AbortController()
  context.after(() => abort.abort())
  return {
    signal: abort.signal,
    deadlineAt: Date.now() + 900_000,
    preparationDeadlineAt: Date.now() + 900_000,
    runId: 'service-run-73',
  }
}

/**
 * Opens the run of a Pages page whose `getServerSideProps` holds one entry-render server stop on its return line, with the page's server compile written, the browser module mapping only the component's lines, and a scripted server participant.
 *
 * Why it exists: every Pages server run test starts the same way (a version 3 configuration, an entry-render server stop, a `(pages-dir-node)` seal read from the written build, a scripted Next inspector); the options change what differs. The harness has no real HTTP and no real Next: the participant sends the recorded E0b stacks.
 * @param context - The test.
 * @param extra - Harness options that replace the defaults.
 * @returns The harness of {@link configuredRuntimeHarness}.
 * @example const harness = await pagesServerRun(context, { operations: { operations: [], stopOperations: [0], stopParticipants: ['server'] } })
 */
export async function pagesServerRun(
  context: TestContext,
  extra: PagesServerRunOptions = {},
) {
  const { control, additionalStops, ...options } = extra
  return configuredRuntimeHarness(
    context,
    control ?? pagesControl(context),
    additionalStops ?? [],
    {
      participant: 'server',
      // A nested app's page lies below its package folder.
      sourcePath: extra.packageRoot
        ? `${extra.packageRoot}/${PAGES_SERVER_PAGE_PATH}`
        : PAGES_SERVER_PAGE_PATH,
      fixture: {
        source: PAGES_SERVER_PAGE_SOURCE,
        citationEndLine: 7,
        declaredLine: PAGES_SERVER_RETURN_LINE,
      },
      nextPages: { mappedLines: 3, serverCompile: true },
      serverRuntime: { route: null },
      documentReadyState: 'loading',
      operations: {
        operations: [],
        stopOperations: [0],
        stopParticipants: ['server'],
      },
      inspections: [{ path: 'count', mode: 'value', required: true }],
      inspectionScope: { count: 3 },
      ...options,
    },
  )
}

/**
 * Hosts the run of {@link pagesServerRun} in a {@link StudyService}, as the editor does, and starts it without waiting for its preparation.
 *
 * Why it exists: the run resource, the error details, Save and Stop are service behaviours. The service's shutdown is registered before the harness exists: node:test runs after hooks in registration order, so the service drains its recording writes before the harness stops its run and removes its folder (removing it first raced those writes into ENOTEMPTY under load).
 * @param context - The test; its end shuts the service down first.
 * @param extra - Harness options handed to {@link pagesServerRun}.
 * @returns The harness, the service, the start receipt and `state()`, which reads the run resource as the agent does.
 * @example
 * const { harness, state } = await pagesServerService(context)
 * state().state // => 'preparing'
 */
export async function pagesServerService(
  context: TestContext,
  extra: PagesServerRunOptions = {},
) {
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await pagesServerRun(context, extra)
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
    key: ['pages', 'server', 'run'].join('-'),
    configuration: harness.definition.configuration,
  })
  return {
    service,
    receipt,
    harness,
    books,
    /** Stops the service's maintenance timer, which releases a completed run within 250 ms; a test that reads or captures the completed run calls it first. @example run.holdMaintenance() */
    holdMaintenance: (): void => clearInterval(service['maintenance']),
    /** Reads the run resource as the agent does. @example state().participants.server?.continueArguments */
    state: () => service.state(service.record(receipt)),
  }
}
