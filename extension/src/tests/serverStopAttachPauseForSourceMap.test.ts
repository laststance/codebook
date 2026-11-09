import assert from 'node:assert/strict'
import { test } from 'node:test'

import { armedEntry } from './utils/entryRenderHarness'
import { pagesServerRun } from './utils/pagesServerRunHarness'
import { ADD, routeHandlerRunHarness } from './utils/routeHandlerRunHarness'

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

// Value: protects=the pause is paid only for a server stop that happens after an operation: a next-dev-webpack run whose server stop is declared before any operation attaches the server without pauseForSourceMap; fails_when=the default turns true for a server stop at afterOperation 0; no_claim=js-debug's real binding timing
test('a server stop declared before any operation attaches the server debugger without pauseForSourceMap', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context)
  const prepared = harness.run.prepare().catch(() => undefined)
  // Act
  await armedEntry(harness)
  // Assert
  assert.deepEqual(
    harness.serverLaunches.map((config) => config.pauseForSourceMap),
    [undefined],
  )
  void prepared
})

// Value: protects=the boundary of the default: a server stop after the second of two operations is still bound before its module's first compile; fails_when=the default tests afterOperation equal to 1 instead of 1 or more; no_claim=js-debug's real binding timing
test('a server stop declared after the second operation attaches the server debugger with pauseForSourceMap', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context, {
    stopOperations: [2],
    operations: [ADD, { ...ADD, title: 'Add again' }],
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
