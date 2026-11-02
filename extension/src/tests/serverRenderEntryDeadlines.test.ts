import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  armedEntry,
  entryControl,
  entryRenderHarness,
  heldEntryPause,
  type EntryRenderHarness,
} from './utils/entryRenderHarness'

/** Opens a run with two entry-render stops, the second at column 7 of the same module. @example const harness = await twoStopHarness(context) */
function twoStopHarness(
  context: Parameters<typeof entryRenderHarness>[0],
): Promise<EntryRenderHarness> {
  return entryRenderHarness(
    context,
    {
      operations: {
        operations: [],
        stopOperations: [0, 0],
        stopParticipants: ['server', 'server'],
      },
    },
    undefined,
    [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
      },
    ],
  )
}

/** The hit of the second stop of {@link twoStopHarness}. @example harness.server!.hit(SECOND_STOP_HIT) */
const SECOND_STOP_HIT = {
  generated: { line: 0, column: 6 },
  source: { line: 1, column: 7 },
  route: '/dashboard',
} as const

// Value: protects=AC 6 (a): a pause held past 20 s fails nothing, the next stop is measured from the continue (20 s) and the page load is measured from the last continue (20 s); fails_when=a held pause fails at 20 s, the next stop's bound counts from the arming instead of the continue, or the load bound counts from an earlier time; no_claim=real time (the run's manual clock moves; production bounds stay 20 s, 300 s and 600 s)
test('a held entry pause fails nothing, and the next stop and the page load are measured from the continue', async (context) => {
  // Arrange
  const harness = await twoStopHarness(context)
  const prepared = harness.run.prepare()
  const first = await heldEntryPause(harness)
  // Act: the first pause is held for 25 s
  harness.advance(25_000)
  assert.deepEqual([...harness.run.view().failures], [])
  await harness.run.continue('server', first.pause)
  // 19 s after the continue the second stop is hit: inside its own 20 s
  harness.advance(19_000)
  assert.deepEqual([...harness.run.view().failures], [])
  harness.server!.hit(SECOND_STOP_HIT)
  const second = await waitUntil(
    () => harness.run.view().snapshots[1],
    'the second entry pause',
  )
  harness.advance(25_000)
  await harness.run.continue('server', second.pause)
  // 19 s after the last continue the page loads: inside its own 20 s
  harness.advance(19_000)
  harness.setDocumentReadyState('complete')
  await prepared
  // Assert
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed',
  )
  assert.deepEqual([...harness.run.view().failures], [])
})

// Value: protects=AC 6 (a) and AC 5: a stop of the entry render that is not hit within 20 s of the previous continue fails the run as SERVER_STOP_NOT_REACHED (entry-render) naming the paused and the missing stop; fails_when=the bound is missing, counts from the arming, or the lists are wrong; no_claim=why the stop was not reached
test('the second entry stop not hit within 20 s of the first continue fails as SERVER_STOP_NOT_REACHED', async (context) => {
  // Arrange
  const harness = await twoStopHarness(context)
  const prepared = harness.run.prepare()
  const first = await heldEntryPause(harness)
  harness.advance(25_000)
  await harness.run.continue('server', first.pause)
  // Act
  harness.advance(20_000)
  // Assert
  await assert.rejects(prepared)
  const failure = harness.run.view().operationFailure
  assert.match(harness.run.view().failures[0]!, /^SERVER_STOP_NOT_REACHED: /)
  assert.deepEqual(
    JSON.parse(
      JSON.stringify({
        phase: failure?.serverRender?.phase,
        pausedStops: failure?.serverRender?.pausedStops,
        notReachedStops: failure?.serverRender?.notReachedStops,
      }),
    ),
    {
      phase: 'entry-render',
      pausedStops: ['src/theme.ts:1 (stop 1 of 2)'],
      notReachedStops: ['src/theme.ts:1 (stop 2 of 2)'],
    },
  )
})

// Value: protects=AC 6 (b): an entry pause held past the pause hold (300 s) fails with today's hold reason and releases the server; fails_when=the hold is paused, extended or renamed for entry pauses; no_claim=the replay of the failed run
test('an entry pause held past the 300 s pause hold fails with the pause hold reason and releases the server', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context)
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await heldEntryPause(harness)
  // Act
  harness.advance(300_000)
  // Assert
  await prepared
  assert.match(
    harness.run.view().failures[0]!,
    /^Repository pause hold deadline exceeded/,
  )
  await waitUntil(() => harness.server!.isClosed(), 'the server was released')
})

// Value: protects=AC 6 (c): the whole-run deadline reached during an entry pause fails with today's wall-deadline reason, and the server and the page are released; fails_when=the entry pause extends or suspends the whole-run deadline; no_claim=the 600 s production length (the control's deadline is 200 s from the start)
test('the whole-run deadline reached during an entry pause fails with the wall-deadline reason and releases the server and the page', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(
    context,
    {},
    entryControl(context, 200_000),
  )
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await heldEntryPause(harness)
  // Act
  harness.advance(200_000)
  // Assert
  await prepared
  assert.match(
    harness.run.view().failures[0]!,
    /^Repository whole-run deadline exceeded/,
  )
  await waitUntil(() => harness.server!.isClosed(), 'the server was released')
  await waitUntil(
    () => harness.releases.includes('cdp'),
    'the page channel was released',
  )
})

// Value: protects=AC 6 and AC 18: the entry navigation is armed after the stop is registered and the held run never fails at the first 20 s of the preparation; fails_when=the navigation starts before the registration was acknowledged; no_claim=none beyond protects
test('the entry navigation starts only after the entry-render stop was registered', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context)
  // Act
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  // Assert
  assert.ok(harness.server!.breakpointsAcknowledged() > 0)
  assert.equal(harness.navigations.length, 1)
  void prepared.catch(() => undefined)
})

// Value: protects=a readyState read that rejects during the entry load (context gone in a commit, request timeout) is "not loaded yet", so the entry page still loads and the run proceeds; fails_when=the rejection reaches the run's tracker and fails it with an uncoded transport error; no_claim=the real error text Chrome gives
test('a readyState read that rejects during the entry load does not fail the run', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context)
  harness.rejectNextReadyStateRead()
  const prepared = harness.run.prepare()
  // Act
  const pause = await heldEntryPause(harness)
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  // Assert
  await prepared
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed',
  )
  assert.deepEqual([...harness.run.view().failures], [])
  assert.ok(harness.readyStateReads() >= 2)
})

// Value: protects=the entry-load poll starts no second readyState read while one is pending (a paused page answers none), so reads do not queue; fails_when=every 100 ms tick starts another read; no_claim=Chrome's own request queue
test('no second readyState read starts while one is pending during the entry load', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context)
  const release = harness.holdReadyStateReads()
  context.after(release)
  const prepared = harness.run.prepare()
  void prepared.catch(() => undefined)
  await armedEntry(harness)
  await waitUntil(() => harness.readyStateReads() >= 1, 'the first read')
  // Act: five poll ticks pass while the read is unanswered
  await new Promise<void>((resolve) => setTimeout(resolve, 550))
  // Assert
  assert.equal(harness.readyStateReads(), 1)
  release()
  await waitUntil(
    () => harness.readyStateReads() >= 2,
    'a read after the pending one was answered',
  )
})

// Value: protects=AC 6 (a, b): the entry pause that arrives before the answer to the resume of another route's hit keeps the 300 s pause hold when that answer comes; fails_when=the late answer re-arms the 20 s active bound over the held pause and fails the run at 20 s; why_new=no deadline test combines a resumed hit with a pause held meanwhile; seam=none; no_claim=the adapter's real event order
test('an entry pause held while the resume of another route is unanswered keeps the pause hold', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context)
  const prepared = harness.run.prepare().catch((error: unknown) => error)
  await armedEntry(harness)
  const answer = harness.server!.holdNextContinueAnswer()
  harness.server!.hit({ route: '/dashboard/invoices' })
  await waitUntil(
    () => harness.server!.continues.length >= 1,
    'the resume of the other route',
  )
  harness.server!.hit({ route: '/dashboard' })
  // Act: the resume is answered late, while the entry hit is still being classified, then the learner holds the pause for 25 s
  answer()
  await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published entry pause',
  )
  harness.advance(25_000)
  // Assert
  assert.deepEqual([...harness.run.view().failures], [])
  harness.advance(275_000)
  await prepared
  assert.match(
    harness.run.view().failures[0]!,
    /^Repository pause hold deadline exceeded/,
  )
})
