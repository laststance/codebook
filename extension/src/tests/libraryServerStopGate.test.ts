import assert from 'node:assert/strict'
import { test } from 'node:test'

import { armedEntry } from './utils/entryRenderHarness'
import {
  libraryRunOptions,
  stageLibrary,
} from './utils/libraryServerRunHarness'
import { pagesServerRun } from './utils/pagesServerRunHarness'

// protects=a library stop's freeze charges the run-level discovery budget, so several library stops cannot multiply the bounds; fails_when=each freeze gets a fresh budget object (the run's shared one stays at zero); no_claim=the sum over two stops (one stop is staged here)
test('a library stop freeze charges the run-level discovery budget', async (context) => {
  // Arrange
  const staged = stageLibrary()
  const harness = await pagesServerRun(context, libraryRunOptions(staged))
  // Act
  // The run stays prepared-in-flight; the harness closes it with the test context.
  void harness.run.prepare().catch(() => undefined)
  await armedEntry(harness)
  // Assert
  const budget = Reflect.get(Object(harness.run), 'libraryBudget') as {
    readBytes: number
    spentMs: number
  }
  assert.ok(budget.readBytes > 0)
})
