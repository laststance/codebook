import type { TestContext } from 'node:test'

import { waitUntil } from '../../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './configuredRuntimeHarness'
import {
  LIBRARY_APP_FOLDER,
  LIBRARY_RETURN_LINE,
  LIBRARY_SOURCE,
  LIBRARY_SOURCE_PATH,
} from './libraryBuildHarness'
import type { StagedLibrary } from './libraryServerRunHarness'

/** The operation id the harness gives the first operation of a version 3 run. */
export const LIBRARY_BROWSER_OPERATION = 'repository-operation'

/** Options of {@link configuredRuntimeHarness}. */
export type LibraryBrowserRunOptions = Parameters<
  typeof configuredRuntimeHarness
>[3]

/**
 * Gives the harness options of a browser stop on the library's `return doubled` line, reached from a nested Pages app that links the library: the stop file lies outside the app, one click on the page triggers the stop, and the required inspection is `value:doubled`.
 *
 * Why it exists: every browser library stop test starts the same way (a version 3 configuration with one browser stop, the library's `(pages-dir-browser)` module in the page's entry chunk); the staged fixture and `extra` change what differs.
 * @param extra - Options that replace these.
 * @returns Options for {@link configuredRuntimeHarness}.
 * @example await configuredRuntimeHarness(context, undefined, [], libraryBrowserOptions(staged))
 */
export function libraryBrowserOptions(
  staged: StagedLibrary,
  extra: LibraryBrowserRunOptions = {},
): LibraryBrowserRunOptions {
  return {
    participant: 'browser',
    packageRoot: LIBRARY_APP_FOLDER,
    packageApp: { stopsOutside: true },
    sourcePath: LIBRARY_SOURCE_PATH,
    fixture: {
      source: LIBRARY_SOURCE,
      citationEndLine: 4,
      declaredLine: LIBRARY_RETURN_LINE,
    },
    nextPages: { mappedLines: 3 },
    libraryStop: staged.stop,
    inspections: [{ path: 'doubled', mode: 'value', required: true }],
    inspectionScope: { doubled: 6 },
    operations: {
      operations: [{ kind: 'click', title: 'Next page', selector: 'a' }],
      stopOperations: [1],
      stopParticipants: ['browser'],
    },
    ...extra,
  }
}

/**
 * Opens a browser library stop's run, prepares it and sends its click, then waits for the stop's pause.
 * @param context - The running test.
 * @param staged - The staged library fixture.
 * @param extra - Options that replace the defaults of {@link libraryBrowserOptions}.
 * @returns The harness and the paused browser snapshot.
 * @example const { harness, stop } = await pausedLibraryBrowserRun(context, stageLibrary({ inBrowser: ['modern'] }))
 */
export async function pausedLibraryBrowserRun(
  context: TestContext,
  staged: StagedLibrary,
  extra: LibraryBrowserRunOptions = {},
) {
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    libraryBrowserOptions(staged, extra),
  )
  await harness.run.prepare()
  harness.run.action('op-1', LIBRARY_BROWSER_OPERATION)
  const stop = await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.browser.snapshot
  }, 'the browser stop in the library')
  return { harness, stop }
}
