import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isShownRefusal } from '../utils/isShownRefusal'

// Value: protects=the Study pane telling a refused Restore once when the status line shows that very sentence; fails_when=the sentence of the status line, without its error name, no longer counts as shown; why_new=F406
test('a refusal that is the whole sentence of the presentation reason counts as shown', () => {
  // Arrange
  const reason = 'Error: Close that tab, then try again.'

  // Act
  const shown = isShownRefusal(reason, 'Close that tab, then try again.')

  // Assert
  assert.equal(shown, true)
})

// Value: protects=a different refusal reaching the learner as an error row when the status line holds a longer sentence that merely contains its words; fails_when=a short cause that is only part of the reason is treated as shown and its row is left out; why_new=F406 (OCR L4: a substring test hid short refusals)
test('a refusal that is only a part of the presentation reason is not shown by it', () => {
  // Arrange
  const reason = 'Error: Close that tab, then try again.'

  // Act
  const shown = isShownRefusal(reason, 'try again')

  // Assert
  assert.equal(shown, false)
})

// Value: protects=an empty cause never hiding the error row of a refusal; fails_when=the empty string, which every text contains, suppresses the row; why_new=F406
test('an empty refusal cause is never shown by any presentation reason', () => {
  // Act
  const shown = isShownRefusal('Error: Close that tab.', '')

  // Assert
  assert.equal(shown, false)
})
