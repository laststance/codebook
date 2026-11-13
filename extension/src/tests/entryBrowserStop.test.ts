import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { ACTIVE_TIMEOUT_MS } from '../constants'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  configuredRuntimeHarness,
  type ConfiguredRuntimeHarness,
} from './utils/configuredRuntimeHarness'
import { entryControl } from './utils/entryRenderHarness'

/** A source of three statements, so a server stop and a browser stop can sit on different lines of one file. */
const THREE_LINE_SOURCE =
  'var nextTheme = "dark";\nvar between = 1;\nvar enabled = false;\n'
/** The map of {@link THREE_LINE_SOURCE}: generated line n is source line n + 1. */
const THREE_LINE_MAP = 'AAAA;AACA;AACA'
/** A required value of the harness page at the browser stop on line 3. */
const ENABLED_STOP = [
  { path: 'enabled', mode: 'value', required: true },
] as const
/** A click that the page answers. */
const OPEN: RepositoryOperation = {
  kind: 'click',
  title: 'Open',
  selector: '#open',
}

/** Reads the details of every journal entry of one type as plain data. @example journaled(harness, 'breakpoint.server-copy-resumed') */
function journaled(harness: ConfiguredRuntimeHarness, type: string): unknown[] {
  return harness.run
    .view()
    .events.filter((event) => event.type === type)
    .map((event) => JSON.parse(JSON.stringify(event.detail)))
}

/**
 * Opens a `next-dev-webpack` run whose only stop is a browser stop at the entry load (`afterOperation: 0`), the page that has not finished loading.
 * @param context - The test.
 * @param extra - Harness options that replace the defaults.
 * @returns The configured runtime harness.
 * @example const harness = await entryBrowserHarness(context)
 */
async function entryBrowserHarness(
  context: TestContext,
  extra: Partial<Parameters<typeof configuredRuntimeHarness>[3]> = {},
): Promise<ConfiguredRuntimeHarness> {
  return configuredRuntimeHarness(context, entryControl(context), [], {
    participant: 'browser',
    entryPath: '/dashboard',
    documentReadyState: 'loading',
    operations: {
      operations: [],
      stopOperations: [0],
      stopParticipants: ['browser'],
    },
    ...extra,
  })
}

/**
 * Waits until the browser-only run requested its stop, acknowledges it in the page's session and waits for the entry navigation.
 * @param harness - The entry-browser harness whose run is preparing.
 * @example await armedBrowserEntry(harness)
 */
async function armedBrowserEntry(
  harness: ConfiguredRuntimeHarness,
): Promise<void> {
  await waitUntil(
    () => harness.ownedBreakpointsRequested() >= 1,
    'the entry-load browser stop was requested',
  )
  // The adapter acknowledges the registration while the page's module is not parsed yet (pending is accepted).
  harness.acknowledgeOwnedBreakpointsInPage()
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
}

/**
 * Opens a `next-dev-webpack` run with a server stop on line 1 and a browser stop on line 3, both at the entry load, the server stop first.
 * @param context - The test.
 * @returns The configured runtime harness with a scripted server participant.
 * @example const harness = await serverThenBrowserHarness(context)
 */
async function serverThenBrowserHarness(
  context: TestContext,
): Promise<ConfiguredRuntimeHarness> {
  return configuredRuntimeHarness(
    context,
    entryControl(context),
    [{ line: 3, column: 1, inspections: [...ENABLED_STOP] }],
    {
      participant: 'server',
      serverSeal: 'rsc',
      serverRuntime: { route: '/dashboard' },
      entryPath: '/dashboard',
      documentReadyState: 'loading',
      mappings: THREE_LINE_MAP,
      fixture: { source: THREE_LINE_SOURCE, citationEndLine: 3 },
      operations: {
        operations: [],
        stopOperations: [0, 0],
        stopParticipants: ['server', 'browser'],
      },
    },
  )
}

/**
 * Waits until both entry-load stops were requested, acknowledges them in the page's session and waits for the entry navigation.
 * @param harness - The server-then-browser harness whose run is preparing.
 * @example await armedServerThenBrowser(harness)
 */
async function armedServerThenBrowser(
  harness: ConfiguredRuntimeHarness,
): Promise<void> {
  await waitUntil(
    () =>
      harness.breakpoints.filter((breakpoint) =>
        breakpoint.id.startsWith('owned-breakpoint'),
      ).length >= 2,
    'both entry-load stops were requested',
  )
  harness.acknowledgeOwnedBreakpointsInPage()
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
}

// Value: protects=client code that runs while the entry page loads pauses in a browser stop declared afterOperation 0, armed before the first navigation and accepted with no input sent, labelled entry-load; fails_when=the stop is armed only after its module loaded (the code already ran), the pause before input fails the run, or the label lacks entry-load or carries an operationIndex; no_claim=a real js-debug binding before the module runs (native H1)
test('a browser stop at the entry load is armed before the first navigation, pauses with no input sent and is labelled entry-load', async (context) => {
  // Arrange
  const harness = await entryBrowserHarness(context)
  const prepared = harness.run.prepare()
  await armedBrowserEntry(harness)
  const requestedBeforeLoad = harness.ownedBreakpointsRequested()
  // The browser commits the entry document, whose scripts then run.
  harness.commitMainFrame('/dashboard')
  // Act: the page's code that runs on mount reaches the stop while the document loads
  harness.emitPause(1, 1)
  const pause = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the published entry-load browser pause',
  )
  harness.setDocumentReadyState('complete')
  await harness.run.continue('browser', pause.pause)
  await prepared
  // Assert
  const view = harness.run.view()
  assert.equal(requestedBeforeLoad, 1)
  assert.deepEqual(
    {
      execution: pause.execution,
      attribution: pause.attribution,
      hasOperationIndex: 'operationIndex' in pause,
      inputsSeen: harness.inputsSeen(),
    },
    {
      execution: 'browser',
      attribution: 'entry-load',
      hasOperationIndex: false,
      inputsSeen: 0,
    },
  )
  assert.equal(view.failures.length, 0)
  assert.equal(view.snapshots.length, 1)
  // js-debug pauses before each mapped script, so the stop is bound before its module's first statement runs.
  assert.deepEqual(
    harness.launchConfigurations.map(
      (configuration) => configuration.pauseForSourceMap,
    ),
    [true],
  )
})

// Value: protects=in one entry load the server stops pause before the browser stops, and the pre-armed browser stop is neither armed a second time nor mistaken for a server pause; fails_when=the browser stop is requested again after the server stop's continue, pauses first, or the run records them out of order; no_claim=a real render, where the client code runs after the server response (native H1)
test('a server stop and a browser stop at the entry load pause in that order, and the browser stop is armed once', async (context) => {
  // Arrange
  const harness = await serverThenBrowserHarness(context)
  // The test sends the browser stop's pause itself: the continuation of the browser stop must not send another.
  harness.suppressNextPause()
  const prepared = harness.run.prepare()
  await armedServerThenBrowser(harness)
  harness.commitMainFrame('/dashboard')
  // Act: the server render pauses, then the page's client code reaches the browser stop
  harness.server!.hit({ route: '/dashboard' })
  const serverPause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published server pause',
  )
  await harness.run.continue('server', serverPause.pause)
  harness.emitPause(1, 3)
  const browserPause = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the published entry-load browser pause',
  )
  harness.setDocumentReadyState('complete')
  await harness.run.continue('browser', browserPause.pause)
  await prepared
  // Assert
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        harness.run
          .view()
          .snapshots.map((snapshot) => [
            snapshot.execution,
            snapshot.attribution,
            snapshot.declaredIndex,
            snapshot.executionIndex,
          ]),
      ),
    ),
    [
      ['server-render', 'entry-load', 0, 0],
      ['browser', 'entry-load', 1, 1],
    ],
  )
  assert.equal(journaled(harness, 'breakpoint.registered').length, 2)
})

// Value: protects=a browser stop at the entry load that the page never reaches is not failed when the document completes: the run waits 20 s from then and ends with an uncoded sentence that names the stop and the recovery, never SERVER_STOP_NOT_REACHED; fails_when=the run fails at readyState complete, ends before the 20 s, carries the public server code or an operationFailure, or names no stop; no_claim=real time (the harness clock stands for it) or a real page whose code runs later
test('a browser stop at the entry load that the page never reaches fails 20 s after the page loaded with an uncoded sentence naming the stop', async (context) => {
  // Arrange
  const harness = await entryBrowserHarness(context)
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedBrowserEntry(harness)
  harness.commitMainFrame('/dashboard')
  // Act: the document completes and the page's code never runs the stop's line
  harness.setDocumentReadyState('complete')
  await waitUntil(
    () => harness.readyStateReads() >= 2,
    'the page was read as loaded',
  )
  const failuresWhileLoaded = harness.run.view().failures.length
  // The 20 s count starts when the poll saw the page loaded, so the manual clock moves in steps until the bound ends the run.
  await waitUntil(() => {
    harness.advance(ACTIVE_TIMEOUT_MS / 20)
    return harness.run.view().failures.length > 0
  }, 'the run failed after the wait')
  await prepared
  // Assert
  const view = harness.run.view()
  assert.equal(failuresWhileLoaded, 0)
  assert.match(
    view.failures[0]!,
    /^The entry load reached no verified pause at the declared browser stop src\/theme\.ts:1 within 20 s after the page finished loading\. Move the stop to a line that runs while the page loads/,
  )
  assert.doesNotMatch(view.failures[0]!, /SERVER_STOP_NOT_REACHED/)
  assert.equal(view.operationFailure, undefined)
})

// Value: protects=the server's own render of a client component, which pauses at the browser stop's file and line in the server session, is resumed and journaled and never recorded as a stop; fails_when=the server-session pause fails the run as an unexpected stop, is published as a pause, or is left paused; no_claim=that Next renders the component on the server in this order (native H1)
test('a server-session pause at the line of a browser stop of the entry load is resumed, journaled and never recorded', async (context) => {
  // Arrange
  const harness = await serverThenBrowserHarness(context)
  // The test sends the browser stop's pause itself: the continuation of the browser stop must not send another.
  harness.suppressNextPause()
  const prepared = harness.run.prepare()
  await armedServerThenBrowser(harness)
  harness.commitMainFrame('/dashboard')
  harness.server!.hit({ route: '/dashboard' })
  const serverPause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published server pause',
  )
  await harness.run.continue('server', serverPause.pause)
  const resumesBefore = harness.server!.continues.length
  // The editor's breakpoint of the later stop, the browser stop's.
  const browserStopBreakpointId = harness.breakpoints.find((breakpoint) =>
    breakpoint.id.startsWith('owned-breakpoint-'),
  )!.id
  // Act: the server renders the client component, and the editor's browser-stop breakpoint pauses there too
  harness.server!.hit({
    route: '/dashboard',
    generated: { line: 2, column: 0 },
    source: { line: 3, column: 1 },
    hitBreakpoints: [browserStopBreakpointId],
  })
  await waitUntil(
    () => harness.server!.continues.length === resumesBefore + 1,
    'the server copy was resumed',
  )
  harness.emitPause(1, 3)
  const browserPause = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the published entry-load browser pause',
  )
  harness.setDocumentReadyState('complete')
  await harness.run.continue('browser', browserPause.pause)
  await prepared
  // Assert
  assert.deepEqual(journaled(harness, 'breakpoint.server-copy-resumed'), [
    { file: 'src/theme.ts', line: 3, count: 1 },
  ])
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        harness.run.view().snapshots.map((snapshot) => snapshot.execution),
      ),
    ),
    ['server-render', 'browser'],
  )
})

// Value: protects=a page script that is not the sealed one never pauses an entry-load browser stop: the bytes the page parsed are compared with the sealed ones as soon as the module is parsed, before any pause; fails_when=the changed module reaches a pause and its values are recorded, or the check waits until the old before-input phase; no_claim=a real rebuild between sealing and the load
test('a browser stop at the entry load whose parsed module differs from the sealed bundle fails the run at the load, before any pause', async (context) => {
  // Arrange
  const harness = await entryBrowserHarness(context)
  harness.replaceExecutedModule('rebuilt()')
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await waitUntil(
    () => harness.ownedBreakpointsRequested() >= 1,
    'the entry-load browser stop was requested',
  )
  harness.acknowledgeOwnedBreakpointsInPage()
  // Act
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed at the parsed module',
  )
  await prepared
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Error: Executed module of declared stop src/theme.ts:1 differs from its sealed bundle (checked entry load)',
  )
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Value: protects=a browser stop declared after an operation that pauses before its operation's input still fails the run, and its failure names the entry-load option; fails_when=the pause is resumed or recorded, the run does not fail, or the recovery lacks afterOperation 0; no_claim=a real page whose line runs while the page loads
test('a browser stop declared after operation 1 that pauses before the input fails the run and names the entry-load option', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    operations: { operations: [OPEN], stopOperations: [1] },
  })
  await harness.run.prepare()
  // Act: the page's load-time code runs the stop's line before any input was sent
  harness.emitPause(1, 1)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the pre-input pause failed the run',
  )
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    "Unexpected or additional browser stop invalidated the declared operation. The declared browser stop ran before its operation's input: a line that runs while the page loads takes afterOperation 0 in a next-dev-webpack run (a browser stop at the entry load, declared after every server stop of it); otherwise declare the stop after an operation whose input comes first.",
  )
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Value: protects=a module the page parses again after the seal never pauses an entry-load browser stop: the run fails at the second parse as a changed build; fails_when=the second script is ignored or adopted as the stop's module and a pause in it is recorded; no_claim=a real hot update of the module
test('a browser stop at the entry load whose module the page parses again fails the run as changed after sealing', async (context) => {
  // Arrange
  const harness = await entryBrowserHarness(context)
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedBrowserEntry(harness)
  const parsed = await waitUntil(
    () => journaled(harness, 'stop.module-parsed')[0] as { scriptUrl: string },
    'the stop module was parsed',
  )
  // Act: the page announces the sealed module's address again under another script id
  harness.announceScript('reparsed', parsed.scriptUrl)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed at the second parse',
  )
  await prepared
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Selected module changed after sealing',
  )
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Value: protects=a learner's own breakpoint at another column of the declared line is never committed as the entry-load browser stop when the editor names no binding and nothing confirms the run's own breakpoint paused; fails_when=the paused frame is adopted as the stop's binding and the pause is recorded as the declared stop; no_claim=a real js-debug answer for the learner's breakpoint (native H1)
test('a pause at another column of the declared line is not recorded as the entry-load browser stop when the editor names no binding', async (context) => {
  // Arrange
  // The map has a second segment on line 1 (generated column 4 is source column 5), where the learner's breakpoint pauses.
  const harness = await entryBrowserHarness(context, {
    mappings: 'AAAA,IAAI',
  })
  harness.rejectBreakpointBinding()
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedBrowserEntry(harness)
  harness.commitMainFrame('/dashboard')
  // Act: a pause on line 1 at column 5, not where the run's own breakpoint was verified
  harness.emitPause(5, 1)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the pause that is not the stop failed the run',
  )
  await prepared
  // Assert
  const view = harness.run.view()
  assert.equal(view.snapshots.length, 0)
  assert.equal(
    view.failures[0],
    'Error: DAP frame differs from the bound configured source position',
  )
})
