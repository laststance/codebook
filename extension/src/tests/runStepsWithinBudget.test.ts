import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runStepsWithinBudget } from '../utils/runStepsWithinBudget'

import { defer } from './utils/defer'

/**
 * Lets the steps' promise turns run while `setTimeout` is faked: `setImmediate` stays real.
 * @example await nextTurn()
 */
function nextTurn(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

// Value: protects=a take-back whose storage never answers reports the pending step at the budget, once, and keeps running until the step settles (Cycle 0146 task 1a); fails_when=the lapse names a step that already settled, is reported again later, or the run gives up on the pending step and skips the steps after it; no_claim=the length of the real budget (a faked clock stands in for it)
test('a step still pending at the budget is named once and the steps after it still run once it settles', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const entryRemoval = defer<void>()
  const ran: string[] = []
  const lapses: string[] = []
  let runOutcome: 'pending' | 'resolved' = 'pending'
  void runStepsWithinBudget(
    [
      {
        name: 'saved setup',
        run: async (): Promise<void> => {
          ran.push('saved setup')
        },
      },
      {
        name: 'MCP entry',
        run: async (): Promise<void> => {
          ran.push('MCP entry')
          await entryRemoval.promise
        },
      },
      {
        name: 'descriptor',
        run: async (): Promise<void> => {
          ran.push('descriptor')
        },
      },
    ],
    10_000,
    (pendingStepName) => lapses.push(pendingStepName),
  ).then(() => {
    runOutcome = 'resolved'
  })
  await nextTurn()
  // Act
  context.mock.timers.tick(10_000)
  context.mock.timers.tick(60_000)
  await nextTurn()
  const outcomeAtLapse = runOutcome
  entryRemoval.resolve()
  await nextTurn()
  // Assert
  assert.deepEqual(lapses, ['MCP entry'])
  assert.equal(outcomeAtLapse, 'pending')
  assert.equal(runOutcome, 'resolved')
  assert.deepEqual(ran, ['saved setup', 'MCP entry', 'descriptor'])
})

// Value: protects=steps that end within the budget answer without a lapse, and the budget's timer ends with them; fails_when=the timer outlives the steps and reports a lapse for a run that already finished; no_claim=steps that overlap (they never do)
test('steps that finish within the budget run in order and never report a lapse', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const ran: string[] = []
  const lapses: string[] = []
  // Act
  await runStepsWithinBudget(
    [
      {
        name: 'skill',
        run: async (): Promise<void> => {
          ran.push('skill')
        },
      },
      {
        name: 'MCP entry',
        run: async (): Promise<void> => {
          ran.push('MCP entry')
        },
      },
    ],
    10_000,
    (pendingStepName) => lapses.push(pendingStepName),
  )
  context.mock.timers.tick(10_000)
  // Assert
  assert.deepEqual(ran, ['skill', 'MCP entry'])
  assert.deepEqual(lapses, [])
})

// Value: protects=a step that fails ends the run with its own error, so the caller can report it; fails_when=the failure is swallowed, the steps after it still run, or the budget reports a lapse after the run ended; no_claim=steps that catch their own failures
test('a step that fails ends the run with its error and the steps after it do not run', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const ran: string[] = []
  const lapses: string[] = []
  // Act
  const failure = await runStepsWithinBudget(
    [
      {
        name: 'skill',
        run: async (): Promise<void> => {
          ran.push('skill')
          throw new Error('Injected skill removal failure')
        },
      },
      {
        name: 'MCP entry',
        run: async (): Promise<void> => {
          ran.push('MCP entry')
        },
      },
    ],
    10_000,
    (pendingStepName) => lapses.push(pendingStepName),
  ).then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : 'other'),
  )
  context.mock.timers.tick(10_000)
  // Assert
  assert.equal(failure, 'Injected skill removal failure')
  assert.deepEqual(ran, ['skill'])
  assert.deepEqual(lapses, [])
})
