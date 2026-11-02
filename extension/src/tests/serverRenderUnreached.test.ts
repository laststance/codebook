import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import {
  ACTIVE_TIMEOUT_MS,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  REPOSITORY_RUN_TIMEOUT_MS,
} from '../constants'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import type { RuntimeControl } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

const submit: RepositoryOperation = {
  kind: 'click',
  title: 'Create Invoice',
  selector: 'button[type=submit]',
}
/** A required value of the harness page at a stop, as the single-action tests declare it. */
const ENABLED_STOP = [
  { path: 'enabled', mode: 'value', required: true },
] as const
const TWO_STOP_SOURCE =
  'var nextTheme = "dark";\nvar between = 1;\nvar enabled = false;\n'
const TWO_STOP_MAP = 'AAAA;AACA;AACA'
const STOP_B_PLACE = { line: 2, column: 0 }
const STOP_B_SOURCE = { line: 3, column: 1 }

/** Builds the control the service gives a run. @example controlOf(context) */
function controlOf(context: TestContext): RuntimeControl {
  const abort = new AbortController()
  context.after(() => abort.abort())
  return {
    signal: abort.signal,
    deadlineAt: Date.now() + REPOSITORY_RUN_TIMEOUT_MS,
    preparationDeadlineAt: Date.now() + 300_000,
    runId: 'service-run-71',
  }
}

/**
 * Opens a prepared version 3 run with two render stops declared after operation 1 (a set), the operation sent and no hit yet; the run's timers follow the harness clock.
 * @example const harness = await renderSetAfterOperation(context)
 */
async function renderSetAfterOperation(context: TestContext) {
  const harness = await configuredRuntimeHarness(
    context,
    controlOf(context),
    [{ line: 3, column: 1, inspections: [...ENABLED_STOP] }],
    {
      participant: 'server',
      serverSeal: 'rsc',
      serverRuntime: { route: '/dashboard/invoices' },
      entryPath: '/dashboard/invoices',
      mappings: TWO_STOP_MAP,
      fixture: { source: TWO_STOP_SOURCE, citationEndLine: 3 },
      operations: {
        operations: [submit],
        stopOperations: [1, 1],
        stopParticipants: ['server', 'server'],
      },
    },
  )
  await harness.run.prepare()
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(() => harness.inputsSeen() === 1, 'the input was sent')
  return harness
}

/** Reads the run's failure record as plain data. @example failureOf(harness) */
function failureOf(
  harness: Awaited<ReturnType<typeof renderSetAfterOperation>>,
) {
  return JSON.parse(JSON.stringify(harness.run.view().operationFailure))
}

// Value: protects=AC 5 and X1/X9: a render stop that the entry route never reaches after its operation fails the run with SERVER_STOP_NOT_REACHED, phase after-operation, naming the stop, the paused and not-reached stops and that inputs were sent, and its sentence offers the run-once causes as possibilities ("may"); fails_when=the failure keeps the generic operation sentence, loses its fields, states a run-once cause as established, or the bound is not 20 s; no_claim=the learner-facing wording of the service answer (service tests)
test('a render stop not reached after its operation fails with SERVER_STOP_NOT_REACHED and the run-once causes as possibilities', async (context) => {
  // Arrange
  const harness = await renderSetAfterOperation(context)
  // Act: no hit within the active bound after the operation
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  assert.match(
    harness.run.view().failures[0]!,
    /^SERVER_STOP_NOT_REACHED: Declared stop src\/theme\.ts:1 was not reached within 20 s after operation 1\. It may have run only while Codebook prepared the page/,
  )
  assert.deepEqual(failureOf(harness), {
    code: 'SERVER_STOP_NOT_REACHED',
    operationIndex: 1,
    sent: 'sent',
    sideEffects: 'unknown',
    logId: 'service-run-71#1',
    serverRender: {
      phase: 'after-operation',
      stop: 'src/theme.ts:1',
      pausedStops: [],
      notReachedStops: ['src/theme.ts:1', 'src/theme.ts:3'],
    },
  })
})

// Value: protects=AC 6 and D15: a pause held longer than 20 s fails nothing, and the next stop of the set is measured from the continue (20 s); the not-reached failure then names the stop that paused and the one that did not; fails_when=the held pause consumes the bound of the next stop, or the bound is measured from the arming; no_claim=real time (the harness clock stands for it)
test('the next stop of a set is measured from the continue, not from the arming', async (context) => {
  // Arrange
  const harness = await renderSetAfterOperation(context)
  harness.server!.hit({})
  const first = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the first stop',
  )
  // Act: the learner holds the pause for longer than the active bound
  harness.advance(ACTIVE_TIMEOUT_MS + 5_000)
  // Assert
  assert.equal(harness.run.view().failures.length, 0)
  // Act: after the continue the second stop has its own 20 s
  await harness.run.continue('server', first.pause)
  harness.advance(ACTIVE_TIMEOUT_MS - 1)
  assert.equal(harness.run.view().failures.length, 0)
  harness.advance(1)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  assert.equal(failureOf(harness).serverRender.stop, 'src/theme.ts:3')
  assert.deepEqual(failureOf(harness).serverRender.pausedStops, [
    'src/theme.ts:1',
  ])
})

// Value: protects=AC 6 and X12: a server-render pause held past the pause hold fails with today's hold reason and no deadline is extended for it; fails_when=the hold is longer or shorter, or the reason differs from the server-action pause's; no_claim=the whole-run deadline (its own test)
test('a render pause held past the pause hold fails with the pause-hold reason', async (context) => {
  // Arrange
  const harness = await renderSetAfterOperation(context)
  harness.server!.hit({ generated: STOP_B_PLACE, source: STOP_B_SOURCE })
  await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the stop',
  )
  // Act
  harness.advance(REPOSITORY_PAUSE_HOLD_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  assert.match(
    harness.run.view().failures[0]!,
    /^Repository pause hold deadline exceeded/,
  )
})

// Value: protects=AC 5: an entry-render stop that is not hit when the entry page has loaded fails the run with SERVER_STOP_NOT_REACHED, phase entry-render, no input sent, and the "may" sentence; fails_when=the run completes, the phase is another, or the cause is stated as established; no_claim=the entry-load poll's timing (entry-load tests)
test('an entry-render stop not hit before the page loads fails with phase entry-render', async (context) => {
  // Arrange: the page reports a loaded document at once and no hit is sent
  const harness = await configuredRuntimeHarness(
    context,
    controlOf(context),
    [],
    {
      participant: 'server',
      serverSeal: 'rsc',
      serverRuntime: { route: '/dashboard' },
      entryPath: '/dashboard',
      operations: {
        operations: [],
        stopOperations: [0],
        stopParticipants: ['server'],
      },
    },
  )
  const prepared = harness.run.prepare()
  prepared.catch(() => undefined)
  // Act
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  assert.match(
    harness.run.view().failures[0]!,
    /^SERVER_STOP_NOT_REACHED: The page finished without reaching declared stop src\/theme\.ts:1\. It may have run only while Codebook prepared the page/,
  )
  assert.equal(failureOf(harness as never).serverRender.phase, 'entry-render')
  assert.equal(failureOf(harness as never).sent, 'not-sent')
})
