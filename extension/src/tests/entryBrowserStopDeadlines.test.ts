import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { ACTIVE_TIMEOUT_MS, ENTRY_LOAD_POLL_MS } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  configuredRuntimeHarness,
  type ConfiguredRuntimeHarness,
} from './utils/configuredRuntimeHarness'
import {
  armedBrowserEntry,
  armedServerThenBrowser,
  ENABLED_STOP,
  entryBrowserHarness,
  serverThenBrowserHarness,
  THREE_LINE_MAP,
  THREE_LINE_SOURCE,
} from './utils/entryBrowserStopHarness'
import { entryControl } from './utils/entryRenderHarness'

/** A setup budget that the compile time before the first pause spends in the tests below. */
const SMALL_SETUP_BUDGET_MS = 2000
/** The time between an automatically resumed hit and the learner's hit, with nothing held: long enough that a credit counting it stands well above the learner's hold on a loaded runner. */
const UNHELD_MS = 4000
/** How long the learner holds the pause in the credit test. */
const LEARNER_HOLD_MS = 500
/** The compile time the tests let pass before the first entry-load pause (more than {@link SMALL_SETUP_BUDGET_MS}). */
const COMPILE_MS = 2500

/**
 * Opens a `next-dev-webpack` run whose two stops are browser stops at the entry load (lines 1 and 3 of one file), with the setup budget {@link SMALL_SETUP_BUDGET_MS}.
 * @param context - The test.
 * @returns The configured runtime harness.
 * @example const harness = await twoBrowserStopsHarness(context)
 */
async function twoBrowserStopsHarness(
  context: TestContext,
): Promise<ConfiguredRuntimeHarness> {
  return configuredRuntimeHarness(
    context,
    {
      ...entryControl(context),
      preparationDeadlineAt: Date.now() + SMALL_SETUP_BUDGET_MS,
    },
    [{ line: 3, column: 1, inspections: [...ENABLED_STOP] }],
    {
      participant: 'browser',
      entryPath: '/dashboard',
      documentReadyState: 'loading',
      mappings: THREE_LINE_MAP,
      fixture: { source: THREE_LINE_SOURCE, citationEndLine: 3 },
      operations: {
        operations: [],
        stopOperations: [0, 0],
        stopParticipants: ['browser', 'browser'],
      },
    },
  )
}

/**
 * Accepts an entry-load browser stop while its inspection is held and the page already completes, then lets the poll read, and returns once the pause is published.
 * @param context - The test.
 * @param howRead - `during` lets the poll start its read after the acceptance; `before` starts the read first and answers it after the acceptance.
 * @returns The harness, the prepare promise and the published pause.
 * @example const { harness, prepared, pause } = await pausedWhilePageCompletes('during', context)
 */
async function pausedWhilePageCompletes(
  howRead: 'during' | 'before',
  context: TestContext,
) {
  const harness = await entryBrowserHarness(context)
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedBrowserEntry(harness)
  harness.commitMainFrame('/dashboard')
  // A read that is in flight before the acceptance is answered only after it, as a paused page's is.
  const releaseRead = harness.holdReadyStateReads()
  if (howRead === 'before')
    await waitUntil(
      () => harness.readyStateReads() >= 1,
      'the poll started its read',
    )
  else releaseRead()
  // The stop is accepted, but its inspection (the paused-frame reads) is not answered yet.
  const releaseInspection = harness.holdCallFrameEvaluations()
  harness.setDocumentReadyState('complete')
  harness.emitPause(1, 1)
  await waitUntil(
    () => harness.callFrameEvaluations() >= 1,
    'the pause inspection started',
  )
  // gstack-timing-ok: the poll must do nothing here, so no event marks the end of the wait; ten poll intervals give it every chance to act, also on a loaded runner
  await sleep(ENTRY_LOAD_POLL_MS * 10)
  releaseRead()
  // gstack-timing-ok: the late answer of the read has no observable event either when the poll ignores it
  await sleep(ENTRY_LOAD_POLL_MS * 3)
  releaseInspection()
  const pause = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the published entry-load browser pause',
  )
  return { harness, prepared, pause }
}

for (const howRead of ['during', 'before'] as const) {
  // Value: protects=an entry-load browser pause that was accepted while its inspection is still running keeps the pause hold when the page-completion poll reads `complete` in that window (Chrome answers while paused); fails_when=the poll arms the 20 s not-reached wait over the hold and the run fails 20 s into a pause the learner is reading; no_claim=a real Chrome nested message loop (native)
  test(`an entry-load browser pause accepted while the page completes keeps its hold deadline and does not fail 20 s into the pause (read ${howRead} the acceptance)`, async (context) => {
    // Arrange, Act
    const { harness, prepared, pause } = await pausedWhilePageCompletes(
      howRead,
      context,
    )
    harness.advance(ACTIVE_TIMEOUT_MS + 1000)
    // Assert
    const view = harness.run.view()
    assert.deepEqual(
      { failures: view.failures.length, status: view.status },
      { failures: 0, status: 'paused-browser' },
    )
    await harness.run.continue('browser', pause.pause)
    await prepared
    assert.equal(harness.run.view().failures.length, 0)
  })
}

// Value: protects=after a server entry stop continues, the browser entry stop that follows gets its own 20 s from that continue even when the setup budget was spent by the compile before the first pause; fails_when=the browser stop is bounded by the spent setup budget (1 ms) and the run fails with the setup-budget sentence before the stop pauses; no_claim=a real compile time (the budget reads a mocked Date)
test('a browser entry stop after a server entry stop still pauses within 20 s of the continue when the setup budget was spent before the first pause', async (context) => {
  // Arrange
  const harness = await serverThenBrowserHarness(context, {
    ...entryControl(context),
    preparationDeadlineAt: Date.now() + SMALL_SETUP_BUDGET_MS,
  })
  // The test sends the browser stop's pause itself: the continuation of the browser stop must not send another.
  harness.suppressNextPause()
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedServerThenBrowser(harness)
  harness.commitMainFrame('/dashboard')
  // The server compiles the page: the budget is spent with no pause held, so nothing is credited back.
  // gstack-timing-ok: the setup budget reads the run's wall clock (the run's module does not see a mocked Date), so the spent budget is real
  await sleep(COMPILE_MS)
  harness.server!.hit({ route: '/dashboard' })
  const serverPause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published server pause',
  )
  // Act: the learner continues at once, and the page's client code reaches the browser stop 19.1 s later
  await harness.run.continue('server', serverPause.pause)
  harness.advance(100)
  const failuresAfterContinue = harness.run.view().failures.length
  harness.advance(19_000)
  harness.emitPause(1, 3)
  const browserPause = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the published entry-load browser pause',
  )
  harness.setDocumentReadyState('complete')
  await harness.run.continue('browser', browserPause.pause)
  await prepared
  // Assert
  assert.equal(failuresAfterContinue, 0)
  assert.equal(harness.run.view().failures.length, 0)
  assert.equal(harness.run.view().snapshots.length, 2)
})

// Value: protects=with two browser entry stops and the page complete before the first, the second stop is not reached 20 s after the first continue (not 1 ms after it from a spent setup budget, not 20 s after the earlier completion); fails_when=the second wait ends at 1 ms with the setup-budget sentence or counts from the page's earlier completion; no_claim=a real page whose code reaches the second stop later
test('with two browser entry stops and the page complete before the first, the second stop fails only 20 s after the first stop was continued', async (context) => {
  // Arrange
  const harness = await twoBrowserStopsHarness(context)
  // The test sends the second stop's pause itself: the continuation of the first stop must not send another.
  harness.suppressNextPause()
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  // The run arms the stops one after the other: each is acknowledged before the next is requested.
  for (const requested of [1, 2]) {
    await waitUntil(
      () => harness.ownedBreakpointsRequested() >= requested,
      `entry-load browser stop ${requested} was requested`,
    )
    harness.acknowledgeOwnedBreakpointsInPage()
  }
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
  harness.commitMainFrame('/dashboard')
  // The page completes before the first stop pauses, and the poll sees it (clock 0).
  const readsBeforeLoaded = harness.readyStateReads()
  harness.setDocumentReadyState('complete')
  await waitUntil(
    () => harness.readyStateReads() >= readsBeforeLoaded + 2,
    'the page was read as loaded',
  )
  // gstack-timing-ok: the setup budget reads the run's wall clock (the run's module does not see a mocked Date), so the spent budget is real
  await sleep(COMPILE_MS)
  harness.advance(10_000)
  harness.emitPause(1, 1)
  const firstPause = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the published first entry-load browser pause',
  )
  // The learner reads the first pause for 5 s of the run's clock, which no wait counts.
  harness.advance(5000)
  // Act: the continue is at clock 15 s; the second stop is never reached
  await harness.run.continue('browser', firstPause.pause)
  harness.advance(19_999)
  // One millisecond before the bound the run still waits (a spent setup budget would have ended it 1 ms after the continue).
  assert.equal(harness.run.view().failures.length, 0)
  // The poll sees the completed page again after the continue; it must not move the wait that the continue started.
  const readsAfterContinue = harness.readyStateReads()
  await waitUntil(
    () => harness.readyStateReads() >= readsAfterContinue + 2,
    'the poll read the page after the continue',
  )
  harness.advance(1)
  await prepared
  // Assert
  assert.equal(harness.run.view().failures.length, 1)
  assert.match(
    harness.run.view().failures[0]!,
    /^The entry load reached no verified pause at the declared browser stop src\/theme\.ts:3 within 20 s after the page finished loading\./,
  )
})

// Value: protects=a server pause that the run resumes by itself during the entry load (another route's hit) does not make the learner's later pause credit the setup budget for the time between them; fails_when=the credit at the learner's continue also counts the time since the automatically resumed hit; no_claim=what the rest of the preparation does with the budget (other tests)
test('an automatically resumed server hit during the entry load does not add its time to the credit of the learner pause that follows', async (context) => {
  // Arrange
  const budgetEndsAtMs = Date.now() + 60_000
  const harness = await serverThenBrowserHarness(context, {
    ...entryControl(context),
    preparationDeadlineAt: budgetEndsAtMs,
  })
  harness.suppressNextPause()
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedServerThenBrowser(harness)
  harness.commitMainFrame('/dashboard')
  // Act: another route's render hits the stop and is resumed, 4 s pass with nothing held, then the entry route's hit pauses for the learner for 0.5 s
  harness.server!.hit({ route: '/dashboard/invoices' })
  await waitUntil(
    () => harness.server!.continues.length >= 1,
    'the other route hit was resumed',
  )
  // gstack-timing-ok: the setup budget reads the run's wall clock (the run's module does not see a mocked Date), so the time between the hits is real
  await sleep(UNHELD_MS)
  harness.server!.hit({ route: '/dashboard' })
  const serverPause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published server pause',
  )
  // gstack-timing-ok: same wall clock as above, the learner's hold is real
  await sleep(LEARNER_HOLD_MS)
  await harness.run.continue('server', serverPause.pause)
  const creditedBudgetEndsAtMs: unknown = Reflect.get(
    harness.run,
    'preparationDeadlineAt',
  )
  harness.emitPause(1, 3)
  const browserPause = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the published entry-load browser pause',
  )
  harness.setDocumentReadyState('complete')
  await harness.run.continue('browser', browserPause.pause)
  await prepared
  // Assert: the budget moved by the learner's hold only, not by the unheld 4 s before it
  const creditedMs = Number(creditedBudgetEndsAtMs) - budgetEndsAtMs
  assert.ok(
    creditedMs >= LEARNER_HOLD_MS && creditedMs < UNHELD_MS,
    `the learner's hold of ${LEARNER_HOLD_MS} ms was credited as ${creditedMs} ms`,
  )
})
