import assert from 'node:assert/strict'
import { test } from 'node:test'

import { STUDY_SHORTCUTS, STUDY_UI_OPTIONS } from '../ui/constants'

// protects=the Keyboard shortcuts list names an Extension replay's timeline keys under their own context, agreeing with the slider's tooltip (D035); fails_when=the Extension replay shares the test replay's list entries or the tooltip and list name different contexts; no_claim=the page's DOM matching
test('the shortcut list gives an Extension replay its own six timeline entries, named as its tooltip names them', () => {
  // Arrange
  const extensionEntries = STUDY_SHORTCUTS.filter(
    (entry) => entry.context === 'Focused Extension replay timeline',
  )
  const testEntries = STUDY_SHORTCUTS.filter(
    (entry) => entry.context === 'Focused test replay timeline',
  )

  // Act
  const tooltip = STUDY_UI_OPTIONS.extensionReplayTimelineTitle

  // Assert
  assert.equal(extensionEntries.length, 6)
  assert.deepEqual(
    extensionEntries.map((entry) => entry.selector),
    Array(6).fill(
      '#playhead[data-replay-family="test"][data-replay-profile="chrome-extension"]',
    ),
  )
  assert.deepEqual(
    testEntries.map((entry) => entry.selector),
    Array(6).fill(
      '#playhead[data-replay-family="test"]:not([data-replay-profile])',
    ),
  )
  assert.match(tooltip, /\(Focused Extension replay timeline\)/)
})
