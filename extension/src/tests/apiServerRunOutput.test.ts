import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { apiServerRunHarness } from './utils/apiServerRunHarness'

/** Counts the run's journal events of one type. */
function countEvents(
  harness: Awaited<ReturnType<typeof apiServerRunHarness>>,
  type: string,
): number {
  return harness.run.view().events.filter((event) => event.type === type).length
}

// Value: protects=resource bound of the run's shared evidence (10,000 events / 4 MiB): an API that prints in a loop is journaled up to a fixed cap and one truncation marker, and the run keeps working; fails_when=every chunk becomes an event (the journal fills, the run or the study save fails) or the marker is missing; no_claim=the journal's own limits (createBoundedEventJournal tests)
test('a burst of API output is journaled up to a cap with one truncation marker and leaves the evidence below its limits', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  const chunk = 'x'.repeat(1_000)
  // Act
  for (let index = 0; index < 2_000; index += 1)
    await harness.fake.emitOutput(chunk, 'stdout')
  // Assert
  const events = harness.run.view().events
  assert.deepEqual(
    {
      outputEvents: countEvents(harness, 'api-server.output'),
      markers: countEvents(harness, 'api-server.output-truncated'),
      totalBelowLimit: events.length < 10_000,
      bytesBelowLimit:
        Buffer.byteLength(JSON.stringify(events)) < 4 * 1024 * 1024,
    },
    {
      outputEvents: 262,
      markers: 1,
      totalBelowLimit: true,
      bytesBelowLimit: true,
    },
  )
})

// Value: protects=private-path hiding of streamed API output: the run gives the API launcher the repository and home roots, so output and the exit tail hide them; fails_when=the launch input carries no roots and a path in the API's output reaches the journal; no_claim=the hiding stage itself (captureProcessOutput tests, ownedApiServer.test.ts)
test('the run gives the API launcher the repository and home paths to hide', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  // Act
  await harness.run.prepare()
  // Assert
  const input = harness.fake.checkInputs[0]!
  assert.deepEqual(
    {
      hidesWorkspace: input.privateRoots?.workspace?.includes(input.workspace),
      hidesHome: (input.privateRoots?.home?.length ?? 0) > 0,
    },
    { hidesWorkspace: true, hidesHome: true },
  )
})

// Value: protects=journal of the API output stays readable when the notice path is separate: output chunks are journaled, the notice itself is not read from them; fails_when=the journal drops ordinary output; no_claim=notice detection (ownedApiServer.test.ts)
test('ordinary API output is journaled in order below the cap', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  // Act
  await harness.fake.emitOutput('listening on 4100\n', 'stdout')
  await waitUntil(
    () => (countEvents(harness, 'api-server.output') === 1 ? true : undefined),
    'the journaled chunk',
    2_000,
  )
  // Assert
  assert.deepEqual(
    harness.run
      .view()
      .events.filter((event) => event.type === 'api-server.output')
      .map((event) => (event.detail as { text: string }).text),
    ['listening on 4100\n'],
  )
})
