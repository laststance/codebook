import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  apiServerHit,
  apiServerRunHarness,
  sendApiRequest,
} from './utils/apiServerRunHarness'
import {
  configuredRuntimeHarness,
  type ConfiguredRuntimeHarness,
} from './utils/configuredRuntimeHarness'
import { sendOperation } from './utils/routeHandlerRunHarness'

const OPERATION_ACTION = 'repository-operation'
const SUBMIT: RepositoryOperation = {
  kind: 'click',
  title: 'Create Invoice',
  selector: 'button[type=submit]',
}
const ENABLED_STOP = [
  { path: 'enabled', mode: 'value', required: true },
] as const

/** Copies a value out of the run module's realm so a strict deep comparison accepts it. @example plain(run.view().recordedStops) // [0] */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Opens a prepared version 3 browser run with one click operation and a stop per entry of `holds`, all declared after operation 1.
 * @param context - The test.
 * @param holds - The `hold` each stop declares, the first stop first.
 * @example const harness = await openRun(context, ['record', undefined])
 */
async function openRun(
  context: TestContext,
  holds: Array<'explain' | 'record' | undefined>,
) {
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    holds.slice(1).map(() => ({
      line: 1,
      column: 7,
      inspections: [...ENABLED_STOP],
    })),
    {
      operations: {
        operations: [SUBMIT],
        stopOperations: holds.map(() => 1),
        stopHolds: holds,
      },
    },
  )
  await harness.run.prepare()
  return harness
}

/**
 * Records every state the run publishes from now on: each `view()` call (the run's own persists included) and a poll between turns, so a paused state a reader could act on cannot slip by.
 * @param harness - The run's harness.
 * @returns The statuses seen, and whether any read offered a continuation (a snapshot of a participant that is paused).
 * @example const seen = watchPublishedStates(harness); … seen.statuses.has('paused-browser') // false
 */
function watchPublishedStates(harness: ConfiguredRuntimeHarness) {
  const seen = { statuses: new Set<string>(), offeredContinuation: false }
  const { run } = harness
  const view = run.view.bind(run)
  const note = (read: ReturnType<typeof view>): void => {
    seen.statuses.add(read.status)
    if (read.participants.browser.snapshot) seen.offeredContinuation = true
  }
  run.view = () => {
    const read = view()
    note(read)
    return read
  }
  return seen
}

/** Counts the `continue` requests the run sent to the debug adapter. @example continueCount(harness) // 1 */
function continueCount(harness: ConfiguredRuntimeHarness): number {
  return harness.commands.filter((command) => command === 'continue').length
}

// Value: protects=a browser stop declared hold "record" commits its observation, sends exactly one resume without a chat call, never publishes paused-browser, and the run reaches its after-condition; fails_when=the run waits for codebook_continue, resumes twice, offers a continuation to a reader, or never completes; no_claim=a real debugger or page: the configured runtime harness stands in for js-debug and the page
test('a recorded browser stop resumes once on its own and the run completes without ever publishing a paused state', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record'])
  const seen = watchPublishedStates(harness)
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the result after the recorded stop',
  )
  // Assert
  assert.equal(continueCount(harness), 1)
  assert.equal(seen.statuses.has('paused-browser'), false)
  assert.equal(seen.offeredContinuation, false)
  assert.deepEqual(plain(harness.run.view().recordedStops), [0])
  assert.equal(harness.run.view().snapshots.length, 1)
  assert.equal(harness.run.view().finalOutcome, 'pending-teardown')
  assert.equal(harness.run.view().operation?.afterVerified, true)
})

// Value: protects=a run that mixes a recorded stop and a held stop of one operation: the recorded one resumes alone and the held one still waits for codebook_continue; fails_when=the held stop is resumed without the chat, or the run stays paused at the recorded stop; no_claim=a real debugger
test('in a run that mixes modes the held stop still waits after the recorded stop resumed', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record', undefined])
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  const held = await waitUntil(
    () =>
      harness.run.view().snapshots[1] &&
      harness.run.view().participants.browser.snapshot,
    'the held stop after the recorded one',
  )
  // Assert: the recorded stop resumed once, the held one is paused and nothing resumed it.
  assert.equal(harness.run.view().status, 'paused-browser')
  assert.equal(continueCount(harness), 1)
  assert.deepEqual(plain(harness.run.view().recordedStops), [0])
  // Act
  await harness.run.continue('browser', held.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the result after the held stop',
  )
  // Assert
  assert.equal(continueCount(harness), 2)
  assert.deepEqual(plain(harness.run.view().recordedStops), [0])
})

// Value: protects=recordedStops lists the declared indexes recorded without a hold in recording order, skipping a held stop between them; fails_when=the list is empty, unordered, or counts the held stop; no_claim=a real debugger
test('recordedStops lists the declared stop indexes in recording order and skips a held stop between them', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record', undefined, 'record'])
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  const held = await waitUntil(
    () =>
      harness.run.view().snapshots[1] &&
      harness.run.view().participants.browser.snapshot,
    'the held stop',
  )
  // Assert: only the first stop is recorded while the second is held.
  assert.deepEqual(plain(harness.run.view().recordedStops), [0])
  // Act
  await harness.run.continue('browser', held.pause)
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the result after the last recorded stop',
  )
  // Assert
  assert.deepEqual(plain(harness.run.view().recordedStops), [0, 2])
  assert.equal(continueCount(harness), 3)
})

// Value: protects=a version 3 run without any recorded stop lists recordedStops as an empty array, and a held stop is never listed; fails_when=the field is absent or lists a held stop; no_claim=the service resource around it
test('a run with only held stops reports an empty recordedStops list', async (context) => {
  // Arrange
  const harness = await openRun(context, [undefined])
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  const held = await waitUntil(
    () => harness.run.view().participants.browser.snapshot,
    'the held stop',
  )
  // Assert
  assert.deepEqual(plain(harness.run.view().recordedStops), [])
  await harness.run.continue('browser', held.pause)
})

// Value: protects=the recorded observation carries the same inspections, scopes and frames as a held observation of the same line; fails_when=a recorded stop commits fewer or different values than a held one; no_claim=js-debug's real values: both runs read the harness page's one fake scope
test('a recorded observation equals the observation of a held stop on the same line', async (context) => {
  // Arrange
  const recorded = await openRun(context, ['record'])
  const held = await openRun(context, [undefined])
  // Act
  recorded.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => recorded.run.view().status === 'completed',
    'the recorded run',
  )
  held.run.action('op-1', OPERATION_ACTION)
  const heldSnapshot = await waitUntil(
    () => held.run.view().participants.browser.snapshot,
    'the held stop',
  )
  const comparable = (snapshot: typeof heldSnapshot) =>
    // The two runs seal their own temporary repositories, so the map hash differs by construction.
    plain({
      values: snapshot.values,
      unavailableValues: snapshot.unavailableValues,
      debugger: snapshot.debugger,
      source: { ...snapshot.source, mapHash: undefined },
      participant: snapshot.participant,
    })
  // Assert
  assert.deepEqual(
    comparable(recorded.run.view().snapshots[0]!),
    comparable(heldSnapshot),
  )
  assert.equal(comparable(heldSnapshot).values?.['value:nextTheme'], 'dark')
  await held.run.continue('browser', heldSnapshot.pause)
})

// Value: protects=codebook_continue with a recorded stop's arguments is refused as a stale pause while a later held stop is paused, and that stop stays paused; fails_when=the late call is accepted, resumes the held stop or ends the run; no_claim=the service tool wrapper around run.continue
test('a late continue naming a recorded stop is refused as stale and the later held stop stays paused', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record', undefined])
  harness.run.action('op-1', OPERATION_ACTION)
  const held = await waitUntil(
    () =>
      harness.run.view().snapshots[1] &&
      harness.run.view().participants.browser.snapshot,
    'the held stop',
  )
  const recordedPause = harness.run.view().snapshots[0]!.pause
  // Act / Assert
  await assert.rejects(
    harness.run.continue('browser', recordedPause),
    /conflict: stale, foreign or unverified pause/,
  )
  assert.equal(harness.run.view().status, 'paused-browser')
  assert.equal(continueCount(harness), 1)
  assert.deepEqual(
    plain(harness.run.view().participants.browser.snapshot?.pause),
    plain(held.pause),
  )
  await harness.run.continue('browser', held.pause)
})

// Value: protects=a recorded stop whose required inspection is unavailable ends the run as a held stop's failure does and sends no resume; fails_when=the run resumes the program or reports the stop as recorded; no_claim=a real debugger
test('a recorded stop whose inspection fails ends the run and sends no resume', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record'])
  harness.requireUnavailableValue()
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the failed inspection',
  )
  // Assert
  assert.equal(continueCount(harness), 0)
  assert.deepEqual(plain(harness.run.view().recordedStops), [])
  assert.equal(harness.run.view().snapshots.length, 1)
  await harness.run.stop()
})

// Value: protects=a recorded stop whose next stop cannot be armed ends the run with the not-armed reason, sends no resume and keeps the committed observation; fails_when=the program is resumed anyway, the reason differs or the observation is lost; no_claim=a real debugger: the arming failure is injected
test('a recorded stop whose next stop cannot be armed ends the run with that reason and keeps its observation', async (context) => {
  // Arrange
  const harness = await openRun(context, ['record', undefined])
  harness.run['armStopSet'] = async () => {
    throw new Error('adapter refused the next breakpoint')
  }
  // Act
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the arming failure',
  )
  // Assert
  assert.equal(continueCount(harness), 0)
  assert.equal(
    harness.run.view().failures[0],
    'Next declared stop was not armed and no resume was sent: adapter refused the next breakpoint',
  )
  assert.equal(harness.run.view().snapshots.length, 1)
  await harness.run.stop()
})

// Value: protects=a server (API) stop declared hold "record" commits its observation and resumes the handler once without a chat call, never publishing paused-server, with its request attribution kept; fails_when=the handler waits for codebook_continue, resumes twice or the pause is offered to a reader; no_claim=a real js-debug session or Node API: the fake debug session and the page's Network events stand in
test('a recorded API stop resumes the handler once on its own and never publishes paused-server', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    stopHolds: ['record'],
  })
  await harness.run.prepare()
  const view = harness.run.view.bind(harness.run)
  const statuses = new Set<string>()
  let didOfferContinuation = false
  harness.run.view = () => {
    const read = view()
    statuses.add(read.status)
    if (read.participants.server?.snapshot) didOfferContinuation = true
    return read
  }
  await sendOperation(harness, 1)
  sendApiRequest(harness, { id: '7', path: '/api/rpc/switches/switchTo' })
  const continuesBefore = harness.server!.continues.length
  // Act
  await apiServerHit(harness)
  await waitUntil(
    () => harness.server!.continues.length === continuesBefore + 1,
    'the handler resumed by the run',
  )
  await waitUntil(
    () => (harness.run.view().recordedStops ?? []).length === 1,
    'the recorded stop listed',
  )
  // Assert
  assert.equal(harness.server!.continues.length, continuesBefore + 1)
  assert.equal(statuses.has('paused-server'), false)
  assert.equal(didOfferContinuation, false)
  assert.deepEqual(plain(harness.run.view().recordedStops), [0])
  assert.equal(harness.run.view().snapshots[0]?.apiRequest?.state, 'attributed')
})
