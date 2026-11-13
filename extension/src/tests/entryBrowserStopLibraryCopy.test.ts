import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import {
  journaled,
  THREE_LINE_MAP,
  THREE_LINE_SOURCE,
} from './utils/entryBrowserStopHarness'
import { entryControl } from './utils/entryRenderHarness'
import {
  compilerFolders,
  libraryDependencies,
  PACKAGE_ROOT,
  writeReport,
} from './utils/nextLibraryRunHarness'

/**
 * Opens a `next-dev-webpack` run that declares `library` (the pack route) with only a browser stop at the entry load, on line 1, and a scripted server session the route attaches although no server stop is declared; prepares it and waits until the browser stop is armed and the entry navigation started.
 * @param context - The test.
 * @returns The harness, the preparation promise and the id of the editor's breakpoint of the browser stop.
 * @example const { harness, prepared, browserStopBreakpointId } = await armedLibraryEntryRun(context)
 */
async function armedLibraryEntryRun(context: TestContext) {
  const library = await libraryDependencies(context)
  const harness = await configuredRuntimeHarness(
    context,
    entryControl(context),
    [],
    {
      participant: 'browser',
      packageRoot: PACKAGE_ROOT,
      serverRuntime: { route: '/dashboard' },
      entryPath: '/dashboard',
      documentReadyState: 'loading',
      mappings: THREE_LINE_MAP,
      fixture: { source: THREE_LINE_SOURCE, citationEndLine: 3 },
      operations: {
        operations: [],
        stopOperations: [0],
        stopParticipants: ['browser'],
      },
      libraryRoute: {
        declared: 'packages/widgets',
        dependencies: library.dependencies,
      },
    },
  )
  await writeReport(library, await compilerFolders(harness))
  // The test sends the browser stop's pause itself: the continuation must not send another.
  harness.suppressNextPause()
  const prepared = harness.run.prepare()
  prepared.catch(() => undefined)
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return harness.ownedBreakpointsRequested() >= 1
  }, 'the entry-load browser stop was requested')
  harness.acknowledgeOwnedBreakpointsInPage()
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
  // A run with one stop numbers its only owned breakpoint plainly.
  const browserStopBreakpointId = 'owned-breakpoint'
  return { harness, prepared, browserStopBreakpointId }
}

// Value: protects=in a library-declaring Next run with only browser stops, the server's render of a client component that holds a browser stop of the entry load pauses at the stop's file and line and is resumed, journaled and never recorded, while the browser pause is recorded as the entry-load stop; fails_when=the server pause skips the classification because no server stop is declared and fails the run as an unexpected server stop; no_claim=that Next renders the component on the server in this order, or a real js-debug attach (native H1)
test('a server pause at the line of an entry-load browser stop is resumed and journaled in a library run with only browser stops', async (context) => {
  // Arrange
  const { harness, prepared, browserStopBreakpointId } =
    await armedLibraryEntryRun(context)
  harness.commitMainFrame('/dashboard')
  const resumesBefore = harness.server!.continues.length
  // Act: the server renders the client component, and the editor's browser-stop breakpoint pauses there too
  harness.server!.hit({
    route: '/dashboard',
    generated: { line: 0, column: 0 },
    source: { line: 1, column: 1 },
    hitBreakpoints: [browserStopBreakpointId],
  })
  await waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return harness.server!.continues.length === resumesBefore + 1
  }, 'the server copy was resumed')
  harness.emitPause(1, 1)
  const browserPause = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the published entry-load browser pause',
  )
  harness.setDocumentReadyState('complete')
  await harness.run.continue('browser', browserPause.pause)
  await prepared
  // Assert
  assert.deepEqual(journaled(harness, 'breakpoint.server-copy-resumed'), [
    { file: 'examples/web/src/theme.ts', line: 1, count: 1 },
  ])
  assert.equal(browserPause.attribution, 'entry-load')
  assert.equal(harness.run.view().failures.length, 0)
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        harness.run.view().snapshots.map((snapshot) => snapshot.execution),
      ),
    ),
    ['browser'],
  )
})

// Value: protects=a server pause at another place than the entry-load browser stop's line is not taken for that stop's server copy in the same run, so it still fails the run as an unexpected server stop; fails_when=the classification resumes any server pause of a library run with a browser entry stop; no_claim=the wording of other failures (native H1)
test('a server pause away from the entry-load browser stop line still fails a library run with only browser stops', async (context) => {
  // Arrange
  const { harness, browserStopBreakpointId } =
    await armedLibraryEntryRun(context)
  harness.commitMainFrame('/dashboard')
  // Act: the server pauses on line 3 while the editor's breakpoint is on line 1
  harness.server!.hit({
    route: '/dashboard',
    generated: { line: 2, column: 0 },
    source: { line: 3, column: 1 },
    hitBreakpoints: [browserStopBreakpointId],
  })
  const failures = await waitUntil(() => {
    const view = harness.run.view()
    return view.failures.length ? view.failures : undefined
  }, 'the run failed')
  // Assert
  assert.deepEqual(JSON.parse(JSON.stringify(failures)), [
    'Unexpected or additional server stop invalidated the declared operation',
  ])
  assert.deepEqual(journaled(harness, 'breakpoint.server-copy-resumed'), [])
})
