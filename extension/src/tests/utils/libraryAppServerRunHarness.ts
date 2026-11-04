import type { TestContext } from 'node:test'

import { waitUntil } from '../../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './configuredRuntimeHarness'
import { armedEntry, entryControl } from './entryRenderHarness'
import type { LibraryBrowserRunOptions } from './libraryBrowserRunHarness'
import {
  LIBRARY_APP_FOLDER,
  LIBRARY_RETURN_LINE,
  LIBRARY_SOURCE,
  LIBRARY_SOURCE_PATH,
  type LibraryFixtureSpec,
} from './libraryBuildHarness'
import { stageLibrary, type StagedLibrary } from './libraryServerRunHarness'

/**
 * Stages a nested App Router app whose entry route's server compile holds the library's `(rsc)` and `(ssr)` modules as Next writes them, and whose client chunks hold the `(app-pages-browser)` one.
 *
 * Why it exists: every server library stop test of an App Router app starts from the same fixture; the spec changes what differs.
 * @param server - The server compile's knobs ({@link LibraryFixtureSpec}); a compile with the default `(rsc)` and `(ssr)` modules when empty.
 * @param extra - Further fixture knobs.
 * @returns The staged library for {@link libraryAppServerOptions}.
 * @example const staged = stageAppServer({ differingRscCopy: true })
 */
export function stageAppServer(
  server: NonNullable<LibraryFixtureSpec['appRouter']>['server'] = {},
  extra: LibraryFixtureSpec = {},
): StagedLibrary {
  return stageLibrary({
    inBrowser: ['modern'],
    inCompile: [],
    appRouter: { server },
    ...extra,
  })
}

/**
 * Gives the harness options of a server stop on the library's `return doubled` line, declared for the entry render, in a nested App Router app that links the library.
 * @param staged - The staged library fixture.
 * @param extra - Options that replace these.
 * @returns Options for {@link configuredRuntimeHarness}.
 * @example await configuredRuntimeHarness(context, entryControl(context), [], libraryAppServerOptions(staged))
 */
export function libraryAppServerOptions(
  staged: StagedLibrary,
  extra: LibraryBrowserRunOptions = {},
): LibraryBrowserRunOptions {
  return {
    participant: 'server',
    serverSeal: 'rsc',
    serverRuntime: { route: '/' },
    documentReadyState: 'loading',
    packageRoot: LIBRARY_APP_FOLDER,
    packageApp: { stopsOutside: true },
    sourcePath: LIBRARY_SOURCE_PATH,
    fixture: {
      source: LIBRARY_SOURCE,
      citationEndLine: 4,
      declaredLine: LIBRARY_RETURN_LINE,
    },
    libraryStop: staged.stop,
    inspections: [{ path: 'doubled', mode: 'value', required: true }],
    inspectionScope: { doubled: 6 },
    operations: {
      operations: [],
      stopOperations: [0],
      stopParticipants: ['server'],
    },
    ...extra,
  }
}

/**
 * Opens the server library stop's run without preparing it.
 * @param context - The running test.
 * @param staged - The staged library fixture.
 * @param extra - Options that replace the defaults of {@link libraryAppServerOptions}.
 * @returns The harness of {@link configuredRuntimeHarness}.
 * @example const harness = await openAppServerRun(context, stageAppServer())
 */
export function openAppServerRun(
  context: TestContext,
  staged: StagedLibrary,
  extra: LibraryBrowserRunOptions = {},
) {
  return configuredRuntimeHarness(
    context,
    entryControl(context),
    [],
    libraryAppServerOptions(staged, extra),
  )
}

/**
 * Announces the library module the way js-debug's CDP channel does for a server participant: the address with its dot segments resolved, which loses the webpack layer, and the script's own text with its layered `sourceURL`.
 * @param harness - The opened run.
 * @param scriptId - The new script's id.
 * @param javascript - The script's text.
 * @param address - The layered address the text ends with.
 * @example announceResolved(harness, 'rsc-1', files.appRouterServer!.rscJavascript, files.appRouterServer!.rscAddress)
 */
export function announceResolved(
  harness: Awaited<ReturnType<typeof openAppServerRun>>,
  scriptId: string,
  javascript: string,
  address: string,
): void {
  harness.server!.setScriptText(scriptId, javascript)
  harness.server!.announceScript(scriptId, new URL(address).href)
}

/**
 * Opens the run, prepares it and waits until the entry-render stop is armed.
 * @param context - The running test.
 * @param staged - The staged library fixture.
 * @param extra - Options that replace the defaults.
 * @returns The harness and the preparation promise.
 * @example const { harness, prepared } = await armedAppServerRun(context, stageAppServer())
 */
export async function armedAppServerRun(
  context: TestContext,
  staged: StagedLibrary,
  extra: LibraryBrowserRunOptions = {},
) {
  const harness = await openAppServerRun(context, staged, extra)
  const prepared = harness.run.prepare()
  // A preparation that fails before the stop is armed ends the wait at once.
  prepared.catch(() => undefined)
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return harness.server!.breakpointsAcknowledged() > 0
  }, 'the server stop was registered')
  await armedEntry(harness)
  return { harness, prepared }
}
