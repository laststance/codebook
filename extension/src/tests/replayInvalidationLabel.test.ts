import assert from 'node:assert/strict'
import { test } from 'node:test'

import { replayInvalidationLabel } from '../studyWorkspace/replayInvalidationLabel'

// protects=Run and Debug saying that the recorded application is covered, also while the next moment has history; fails_when=a covered application reads as loading or as not recorded; no_claim=what the editor draws from the label
test('covered recorded application reads as covered even when the next moment loads history', () => {
  // Arrange
  const isApplicationCovered = true

  // Act
  const withHistory = replayInvalidationLabel(isApplicationCovered, true)
  const withoutHistory = replayInvalidationLabel(isApplicationCovered, false)

  // Assert
  assert.equal(withHistory, 'Recorded application is covered by another tab')
  assert.equal(withoutHistory, 'Recorded application is covered by another tab')
})

// protects=a recorded moment that only loads reading as loading; fails_when=it reads as not recorded; no_claim=what the editor draws from the label
test('a moment with recorded history reads as loading recorded values', () => {
  // Arrange
  const isApplicationCovered = false

  // Act
  const label = replayInvalidationLabel(isApplicationCovered, true)

  // Assert
  assert.equal(label, 'Loading recorded values…')
})

// protects=a gap keeping the session's own "Not recorded at this moment"; fails_when=a gap reads as loading or covered; no_claim=what the editor draws from the label
test('a moment without history leaves the default not-recorded description', () => {
  // Arrange
  const isApplicationCovered = false

  // Act
  const withoutHistory = replayInvalidationLabel(isApplicationCovered, false)
  const unknownHistory = replayInvalidationLabel(
    isApplicationCovered,
    undefined,
  )

  // Assert
  assert.equal(withoutHistory, undefined)
  assert.equal(unknownHistory, undefined)
})
