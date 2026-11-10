import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectedLearningStep } from '../utils/selectedLearningStep'

const steps = [
  { id: 'open', snapshotUri: 'codebook://run/events/1' },
  { id: 'click', snapshotUri: 'codebook://run/events/2' },
  { id: 'result' },
  { id: 'also-click', snapshotUri: 'codebook://run/events/2' },
  { id: 'unrecorded', snapshotUri: 'codebook://run/events/9' },
]
const positions = [
  { stepId: 'open', elapsedMs: 100 },
  { stepId: 'click', elapsedMs: 500 },
  { stepId: 'result', elapsedMs: 900 },
  { stepId: 'also-click', elapsedMs: 500 },
]
const tolerance = 1

// Value: protects=the block describing the step whose evidence is on screen when the learner has not chosen one; fails_when=the block shows the last step of the observation or no step at all; no_claim=how the webview draws the block
test('selects the first recorded step that matches the presented observation', () => {
  // Arrange
  const input = {
    steps,
    positions,
    presentedSnapshotUri: 'codebook://run/events/2',
    presentedMs: 500,
    chosen: undefined,
    toleranceMs: tolerance,
  }

  // Act
  const selected = selectedLearningStep(input)

  // Assert
  assert.equal(selected, 'click')
})

// Value: protects=the learner's pick among steps that share one observation; fails_when=activating the second step still shows the first step's block; no_claim=that the webview records the pick
test('selects the chosen step among steps sharing an observation once its position is presented', () => {
  // Arrange
  const input = {
    steps,
    positions,
    presentedSnapshotUri: 'codebook://run/events/2',
    presentedMs: 500,
    chosen: { stepId: 'also-click', positionMs: 500 },
    toleranceMs: tolerance,
  }

  // Act
  const selected = selectedLearningStep(input)

  // Assert
  assert.equal(selected, 'also-click')
})

// Value: protects=no premature block while an activated step's seek has not landed; fails_when=the chosen step is selected while the old position is still presented; no_claim=the seek itself
test('does not count the chosen step while the old position is still presented', () => {
  // Arrange
  const input = {
    steps,
    positions,
    presentedSnapshotUri: 'codebook://run/events/1',
    presentedMs: 100,
    chosen: { stepId: 'also-click', positionMs: 500 },
    toleranceMs: tolerance,
  }

  // Act
  const selected = selectedLearningStep(input)

  // Assert
  assert.equal(selected, 'open')
})

// Value: protects=the terminal-result step (no snapshot) being selectable at its own position only; fails_when=the result step stays selected after another position is presented, or is not selected while its position is shown; no_claim=playback
test('selects the terminal step while its position is presented and the matching step once another is', () => {
  // Arrange
  const chosen = { stepId: 'result', positionMs: 900 }
  const atResult = {
    steps,
    positions,
    presentedSnapshotUri: undefined,
    presentedMs: 900,
    chosen,
    toleranceMs: tolerance,
  }
  const elsewhere = {
    ...atResult,
    presentedSnapshotUri: 'codebook://run/events/1',
    presentedMs: 100,
  }
  const elsewhereWithoutMatch = {
    ...atResult,
    presentedSnapshotUri: 'codebook://run/events/77',
    presentedMs: 100,
  }

  // Act
  const atResultStep = selectedLearningStep(atResult)
  const elsewhereStep = selectedLearningStep(elsewhere)
  const noMatchStep = selectedLearningStep(elsewhereWithoutMatch)

  // Assert
  assert.equal(atResultStep, 'result')
  assert.equal(elsewhereStep, 'open')
  assert.equal(noMatchStep, undefined)
})

// Value: protects=steps without a recorded position having no check; fails_when=such a step is selected by observation match or by being chosen; no_claim=the list's "no recorded evidence" text
test('never selects a step without a recorded position, also when chosen', () => {
  // Arrange
  const matching = {
    steps,
    positions,
    presentedSnapshotUri: 'codebook://run/events/9',
    presentedMs: 700,
    chosen: undefined,
    toleranceMs: tolerance,
  }
  const chosen = {
    ...matching,
    chosen: { stepId: 'unrecorded', positionMs: 700 },
  }

  // Act
  const byMatch = selectedLearningStep(matching)
  const byChoice = selectedLearningStep(chosen)

  // Assert
  assert.equal(byMatch, undefined)
  assert.equal(byChoice, undefined)
})

// Value: protects=the 1 ms presented-position tolerance of the chosen step; fails_when=a position 1 ms away keeps the chosen step or one 0.5 ms away drops it; no_claim=fractional seeks in a real replay
test('keeps the chosen step at 0.5 ms from its position and drops it at 1 ms', () => {
  // Arrange
  const base = {
    steps,
    positions,
    presentedSnapshotUri: 'codebook://run/events/1',
    chosen: { stepId: 'result', positionMs: 900 },
    toleranceMs: tolerance,
  }

  // Act
  const near = selectedLearningStep({ ...base, presentedMs: 899.5 })
  const far = selectedLearningStep({ ...base, presentedMs: 899 })

  // Assert
  assert.equal(near, 'result')
  assert.equal(far, 'open')
})

// Value: protects=hiding the block when nothing matches; fails_when=an unrelated step is selected; no_claim=none beyond protects
test('selects nothing when no step matches and none is chosen', () => {
  // Arrange
  const input = {
    steps,
    positions,
    presentedSnapshotUri: 'codebook://run/events/77',
    presentedMs: 300,
    chosen: undefined,
    toleranceMs: tolerance,
  }

  // Act
  const selected = selectedLearningStep(input)

  // Assert
  assert.equal(selected, undefined)
})
