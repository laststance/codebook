import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cutTextToTail } from '../utils/cutTextToTail'

// Value: protects=a long recorded output line keeps its end, cut between characters so an emoji or another astral character is never split into a broken half; fails_when=the cut keeps the line's start, counts UTF-16 units instead of characters, or leaves half a surrogate pair; why_new=the Application pane keeps the last 65,536 characters of output (EN10), and the existing cutTextToFit keeps the start; seam=none; no_claim=grapheme clusters made of several code points
test('a recorded line is cut to its last characters without splitting a character', () => {
  // Arrange
  const line = 'job 👍 done'

  // Act
  const tails = [
    cutTextToTail(line, 4),
    cutTextToTail(line, 6),
    cutTextToTail(line, 7),
    cutTextToTail(line, 20),
    cutTextToTail(line, 0),
  ]

  // Assert
  assert.deepEqual(tails, ['done', '👍 done', ' 👍 done', 'job 👍 done', ''])
})
