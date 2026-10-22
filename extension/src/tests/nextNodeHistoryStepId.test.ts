import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextNodeHistoryStepId } from '../utils/nextNodeHistoryStepId'

// Value: protects=the rule of which learning step a committed test replay selection shows (DS21): a step action's own step, the first step for Next and Previous, and a learner's chosen step only while a selection without a choice stays on its moment; fails_when=a seek, Play or Inspect that lands on another event keeps the chosen step (it returns when the selection comes back), or a step action's choice is ignored; why_new=Step 9's state-machines review found the chosen step outliving moves that made no choice; seam=none; no_claim=when the workspace commits a selection
test('a committed selection shows its own step choice, else keeps the chosen step only on its moment', () => {
  // Arrange
  const chosenOnStop = { sequence: 2, stepId: 'keep' }

  // Act
  const steps = [
    nextNodeHistoryStepId(
      { stepId: 'keep' },
      { sequence: 4, stepId: undefined },
      2,
    ),
    nextNodeHistoryStepId({ stepId: undefined }, chosenOnStop, 2),
    nextNodeHistoryStepId(undefined, chosenOnStop, 2),
    nextNodeHistoryStepId(undefined, chosenOnStop, 4),
  ]

  // Assert
  assert.deepEqual(steps, ['keep', undefined, 'keep', undefined])
})
