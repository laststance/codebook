import assert from 'node:assert/strict'
import { test } from 'node:test'

import { routeHandlerRunHarness } from './utils/routeHandlerRunHarness'

// Value: protects=native Q3 a server stop after an operation in a module the operation's own request compiles first (an auth library's callback behind a Server Action) is bound before that module runs; fails_when=the attach of a next-dev-webpack run with a server stop afterOperation 1 omits pauseForSourceMap; no_claim=js-debug's real binding timing
test('a server stop declared after an operation attaches the server debugger with pauseForSourceMap', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context, {
    stopOperations: [1],
    extra: { sourcePath: 'app/lib/auth.ts' },
  })
  // Act
  await harness.run.prepare()
  // Assert
  assert.deepEqual(
    harness.serverLaunches.map((config) => config.pauseForSourceMap),
    [true],
  )
})

// Value: protects=the cost of pauseForSourceMap is paid only when needed: a run whose only stop is in the browser attaches no pause before each mapped server script; fails_when=every next-dev-webpack run (or a run with only browser stops) attaches with pauseForSourceMap; no_claim=the run's timing
test('a run whose only stop is in the browser attaches the server debugger without pauseForSourceMap', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context, {
    stopOperations: [1],
    stopParticipants: ['browser'],
    extra: { participant: 'browser', sourcePath: 'app/lib/auth.ts' },
  })
  // Act
  await harness.run.prepare()
  // Assert
  assert.deepEqual(
    harness.serverLaunches.map((config) => config.pauseForSourceMap),
    [],
  )
})
