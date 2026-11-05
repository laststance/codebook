import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  publishedPause,
  routeHandlerHit,
  routeHandlerRunHarness,
  sendOperation,
  sendRequest,
} from './utils/routeHandlerRunHarness'

/** A required value of the harness page at a stop. */
const ENABLED_STOP = [
  { path: 'enabled', mode: 'value', required: true },
] as const
/** A source with code on lines 1 and 3 and the map that sends generated lines 0 and 2 to them. */
const TWO_STOP_SOURCE =
  'var nextTheme = "dark";\nvar between = 1;\nvar enabled = false;\n'
const TWO_STOP_MAP = 'AAAA;AACA;AACA'
/** The same map for the paused script, whose first line is the `"use strict";` the instance text starts with. */
const INSTANCE_MAP = ';AAAA;AACA;AACA'

/**
 * Opens a prepared run with two route-handler stops of operation 1 in one route file (lines 1 and 3).
 * @param context - The test.
 * @example const harness = await twoStopsOfOneOperation(context)
 */
function twoStopsOfOneOperation(
  context: Parameters<typeof routeHandlerRunHarness>[0],
) {
  return routeHandlerRunHarness(context, {
    stopOperations: [1, 1],
    additionalStops: [{ line: 3, column: 1, inspections: [...ENABLED_STOP] }],
    extra: {
      mappings: TWO_STOP_MAP,
      fixture: { source: TWO_STOP_SOURCE, citationEndLine: 3 },
    },
  })
}

// Value: protects=OV-E1 claims are per stop: two stops of one operation set both pause in the one POST, in order, each published with the same browser request; fails_when=the first stop's claim hides the request from the second so it is resumed and the run ends not reached; no_claim=a real handler running both lines
test('two route-handler stops of one operation both pause in the one POST the page sent', async (context) => {
  // Arrange
  const harness = await twoStopsOfOneOperation(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '9', 'POST', '/api/todos')
  routeHandlerHit(
    harness,
    { hitBreakpoints: ['owned-breakpoint'] },
    undefined,
    INSTANCE_MAP,
  )
  const first = await publishedPause(harness)
  // Act
  await harness.run.continue('server', first.pause)
  routeHandlerHit(
    harness,
    {
      hitBreakpoints: ['owned-breakpoint-2'],
      generated: { line: 3, column: 0 },
      source: { line: 3, column: 1 },
    },
    undefined,
    INSTANCE_MAP,
  )
  await waitUntil(
    () => harness.run.view().snapshots.length === 2,
    'the second stop paused',
  )
  // Assert
  assert.deepEqual(
    [...harness.run.view().snapshots].map((snapshot) => ({
      declaredIndex: snapshot.declaredIndex,
      executionIndex: snapshot.executionIndex,
      routeHandler: { ...snapshot.routeHandler },
    })),
    [
      {
        declaredIndex: 0,
        executionIndex: 0,
        routeHandler: {
          method: 'POST',
          route: '/api/todos',
          path: '/api/todos',
        },
      },
      {
        declaredIndex: 1,
        executionIndex: 1,
        routeHandler: {
          method: 'POST',
          route: '/api/todos',
          path: '/api/todos',
        },
      },
    ],
  )
})

// Value: protects=OV-3 identity contract: with two qualifying requests the first to reach the line is published once and the stop is retired, so the second request runs through; fails_when=both requests pause the one stop or the stop stays armed after its pause; no_claim=which request entered the handler first (the pause is attributed by start order, a documented limit)
test('with two qualifying requests the stop pauses once and is retired', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendRequest(harness, '8', 'POST', '/api/todos')
  sendRequest(harness, '9', 'POST', '/api/todos')
  routeHandlerHit(harness)
  const first = await publishedPause(harness)
  // Act
  await harness.run.continue('server', first.pause)
  await waitUntil(
    () => harness.run.view().status !== 'paused-server',
    'the run went on after the continue',
  )
  // Assert
  assert.deepEqual(
    {
      snapshots: harness.run.view().snapshots.length,
      continues: harness.server!.continues.length,
      editorBreakpoints: harness.breakpoints.map((breakpoint) => breakpoint.id),
    },
    { snapshots: 1, continues: 1, editorBreakpoints: ['learner-owned'] },
  )
})
