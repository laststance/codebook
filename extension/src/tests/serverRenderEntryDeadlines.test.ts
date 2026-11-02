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
  const harness = await entryRenderHarness(context, {}, entryControl(context, 200_000))
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
