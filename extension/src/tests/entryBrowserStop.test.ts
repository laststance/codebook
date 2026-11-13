import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { ACTIVE_TIMEOUT_MS } from '../constants'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import {
  armedBrowserEntry,
  armedServerThenBrowser,
  entryBrowserHarness,
  journaled,
  serverStopContinued,
  serverThenBrowserHarness,
} from './utils/entryBrowserStopHarness'
import { entryControl } from './utils/entryRenderHarness'

/** The setup budget of the held-pause test, in real milliseconds. */
const SETUP_BUDGET_MS = 3000
/** How long that test holds the server pause: longer than the whole budget. */
const HELD_MS = 3500

/** A click that the page answers. */
const OPEN: RepositoryOperation = {
  kind: 'click',
  title: 'Open',
  selector: '#open',
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
  const readsBeforeLoaded = harness.readyStateReads()
  harness.setDocumentReadyState('complete')
  await waitUntil(
    () => harness.readyStateReads() > readsBeforeLoaded,
    'the page was read as loaded',
  )
  // The manual clock stands at the moment the poll saw the page loaded (the 20 s count starts there): one millisecond short of the bound the run is still waiting.
  harness.advance(19_999)
  const failuresBeforeBound = harness.run.view().failures.length
  harness.advance(1)
  const failuresAtBound = harness.run.view().failures.length
  await prepared
  // Assert
  const view = harness.run.view()
  assert.deepEqual(
    { failuresBeforeBound, failuresAtBound },
    { failuresBeforeBound: 0, failuresAtBound: 1 },
  )
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

// Value: protects=a stack answer that arrives after the held server copy pause was resumed by the adapter and another pause is held resumes nothing: only the pause that is held decides; fails_when=the stale answer resumes the thread again, so the later pause is resumed twice or a pause the learner should see is resumed for a verdict about another one; no_claim=a real adapter's resume timing (native H1)
test('a stale stack answer for an earlier server copy pause does not resume the pause held after it', async (context) => {
  // Arrange
  const { harness, prepared, browserStopBreakpointId } =
    await serverStopContinued(context)
  const resumesBefore = harness.server!.continues.length
  const copyHit = {
    route: '/dashboard',
    generated: { line: 2, column: 0 },
    source: { line: 3, column: 1 },
    hitBreakpoints: [browserStopBreakpointId],
  }
  const releaseFirstStack = harness.server!.holdNextStackTrace()
  // Act: the first copy pause waits for its stack, the adapter resumes it, and a second copy pause is held and resumed on its own stack
  harness.server!.hit(copyHit)
  harness.server!.emitResumed()
  harness.server!.hit(copyHit)
  await waitUntil(
    () => harness.server!.continues.length === resumesBefore + 1,
    'the second server copy was resumed',
  )
  releaseFirstStack()
  // The stale answer is processed before the run goes on.
  await waitUntil(
    () =>
      harness.server!.commands.filter((command) => command === 'stackTrace')
        .length >= 2,
    'both stacks were read',
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
  assert.equal(harness.server!.continues.length, resumesBefore + 1)
  assert.equal(harness.run.view().failures.length, 0)
})

// Value: protects=once every browser stop of the entry load is continued, a held server pause takes the path it had before the feature: no stack is read to look for a browser stop's server copy and nothing is journaled as one; fails_when=the pause is classified as an entry-browser copy after its stops are behind the run; no_claim=a pause in a run that declares no entry browser stop at all (the same guard)
test('a held server pause after the entry browser stop was continued is not classified as its server copy', async (context) => {
  // Arrange
  const { harness, prepared, browserStopBreakpointId } =
    await serverStopContinued(context)
  harness.emitPause(1, 3)
  const browserPause = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the published entry-load browser pause',
  )
  // The page is still loading: the run has not finished preparing, so the browser stop's breakpoint is still the run's own.
  await harness.run.continue('browser', browserPause.pause)
  const stackReadsBefore = harness.server!.commands.filter(
    (command) => command === 'stackTrace',
  ).length
  // Act: a repeat hit of the server stop's place (held by the run) that also names the browser stop's breakpoint, after every entry stop is behind the run
  harness.server!.hit({
    route: '/dashboard',
    source: { line: 1, column: 1 },
    hitBreakpoints: [browserStopBreakpointId],
  })
  await waitUntil(
    () => harness.server!.continues.length >= 2,
    'the repeat hit was resumed',
  )
  harness.setDocumentReadyState('complete')
  await prepared
  // Assert
  assert.equal(
    harness.server!.commands.filter((command) => command === 'stackTrace')
      .length,
    stackReadsBefore,
  )
  assert.deepEqual(journaled(harness, 'breakpoint.server-copy-resumed'), [])
})

// Value: protects=the time a learner holds the server pause of the entry load is given back to the setup budget that the rest of the preparation (a later preparation window, the stable-page wait) runs under, and the browser stop that follows is still reached; fails_when=the budget is not moved by the hold (it would run out while the learner reads) or the hold's credit differs from its length; no_claim=how long the browser stop may take after the continue (that is the 20 s wait, tested in entryBrowserStopDeadlines)
test('a server pause of the entry load held for 3.5 s moves the setup budget by about 3.5 s and the browser stop that follows is still reached', async (context) => {
  // Arrange
  const budgetEndsAtMs = Date.now() + SETUP_BUDGET_MS
  const harness = await serverThenBrowserHarness(context, {
    ...entryControl(context),
    preparationDeadlineAt: budgetEndsAtMs,
  })
  // The test sends the browser stop's pause itself: the continuation of the browser stop must not send another.
  harness.suppressNextPause()
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedServerThenBrowser(harness)
  harness.commitMainFrame('/dashboard')
  harness.server!.hit({ route: '/dashboard' })
  const serverPause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published server pause',
  )
  // Act: the learner holds the pause past the whole budget, continues, and the page's client code reaches the browser stop a moment later
  // gstack-timing-ok: the setup budget reads the run's wall clock (the run's module does not see a mocked Date), so the hold is real
  await sleep(HELD_MS)
  await harness.run.continue('server', serverPause.pause)
  const creditedBudgetEndsAtMs: unknown = Reflect.get(
    harness.run,
    'preparationDeadlineAt',
  )
  harness.advance(100)
  harness.emitPause(1, 3)
  const browserPause = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the published entry-load browser pause',
  )
  harness.setDocumentReadyState('complete')
  await harness.run.continue('browser', browserPause.pause)
  await prepared
  // Assert
  const creditedMs = Number(creditedBudgetEndsAtMs) - budgetEndsAtMs
  // The credit also holds the pause's publication and the continue around the sleep, which a loaded runner stretches; a hold counted twice would reach twice its length.
  assert.ok(
    creditedMs >= HELD_MS && creditedMs < HELD_MS * 2,
    `the hold of ${HELD_MS} ms was credited as ${creditedMs} ms`,
  )
  assert.equal(harness.run.view().failures.length, 0)
  assert.equal(harness.run.view().snapshots.length, 2)
})

// Value: protects=a second browser stop that arrives while the entry load's last browser stop is being continued fails the run with the recovery that names the entry-load option, not the bare sentence; fails_when=the queued-stop failure of a continuation keeps the plain "Unexpected or additional" sentence; no_claim=a real page whose client code pauses again during the continue
test('a second browser pause during the continuation of the last entry browser stop fails the run and names the entry-load option', async (context) => {
  // Arrange
  const harness = await entryBrowserHarness(context)
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedBrowserEntry(harness)
  harness.commitMainFrame('/dashboard')
  harness.emitPause(1, 1)
  const pause = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the published entry-load browser pause',
  )
  // Act: the debugger announces another stop while the first one is being continued
  const continued = harness.run
    .continue('browser', pause.pause)
    .catch((error: unknown) => error)
  harness.emitStopped()
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the extra pause failed the run',
  )
  await continued
  await prepared
  // Assert
  assert.match(
    harness.run.view().failures[0]!,
    /^Unexpected or additional browser stop invalidated the declared operation\. The declared browser stop ran before its operation's input: a line that runs while the page loads takes afterOperation 0/,
  )
})

// Value: protects=the timeout of an entry page that does not finish loading after its last entry browser stop was continued names that pause as an entry-load pause, not a server-render pause that never happened; fails_when=the sentence says server-render for a run whose last entry stop is a browser stop; no_claim=a real page that hangs after the continue
test('an entry page that does not load after the last entry browser stop was continued names an entry-load pause in its timeout', async (context) => {
  // Arrange
  const harness = await entryBrowserHarness(context)
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedBrowserEntry(harness)
  harness.commitMainFrame('/dashboard')
  harness.emitPause(1, 1)
  const pause = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the published entry-load browser pause',
  )
  // Act: the page stays loading after the continue until the 20 s bound ends the run
  await harness.run.continue('browser', pause.pause)
  await waitUntil(() => {
    harness.advance(ACTIVE_TIMEOUT_MS / 20)
    return harness.run.view().failures.length > 0
  }, 'the run failed after the wait')
  await prepared
  // Assert
  assert.match(
    harness.run.view().failures[0]!,
    /^ENTRY_LOAD_TIMEOUT: The entry page did not finish loading within 20 s after its last entry-load pause\./,
  )
})
