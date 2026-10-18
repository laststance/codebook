import assert from 'node:assert/strict'
import { test } from 'node:test'

import { unmatchedByKey } from '../utils/unmatchedByKey'

// Value: protects=the count of leftover tabs that closed after Cursor built every tab object anew: a tab is found again by its key, not its object; fails_when=an item is compared by identity, so every rebuilt tab reads as gone; why_new=Cycle 0046 OCR1-1; seam=none
test('an item whose key is among the counterparts is matched although it is another object', () => {
  // Arrange
  const before = [{ key: 'webview:codebook · Application' }],
    after = [{ key: 'webview:codebook · Application' }]

  // Act
  const unmatched = unmatchedByKey(before, after, (item) => item.key)

  // Assert
  assert.deepEqual(unmatched, [])
})

// Value: protects=the count of two dead panes of one kind when the editor keeps only one of them; fails_when=one counterpart answers for every item of its key, so the closed pane reads as kept; why_new=Cycle 0046 OCR1-1; seam=none
test('one counterpart answers for one item of its key only, and the others of that key stay unmatched in their order', () => {
  // Arrange
  const before = ['file:///notes.ts', 'webview:Study', 'webview:Study'],
    after = ['webview:Study']

  // Act
  const unmatched = unmatchedByKey(before, after, (item) => item)

  // Assert
  assert.deepEqual(unmatched, ['file:///notes.ts', 'webview:Study'])
})
