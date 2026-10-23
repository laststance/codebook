import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  foreignPreviewObstacle,
  parseForeignPreviewObstacle,
} from '../utils/foreignPreviewObstacle'

// Value: protects=answering a foreign-preview refusal with the Keep/Close choice for a tab whose name holds a double quote; fails_when=the parser stops at the quote and returns undefined, so the learner sees only the refusal text; why_new=F375, no unit test existed and the pattern excluded quotes in the name; seam=none
test('reads back the tab name and group of an obstacle whose tab name contains a double quote', () => {
  // Arrange
  const text = `Error: ${foreignPreviewObstacle('say "hi".tsx', 2)}`

  // Act
  const parsed = parseForeignPreviewObstacle(text)

  // Assert
  assert.deepEqual(parsed, { tabName: 'say "hi".tsx', viewColumn: 2 })
})

// Value: protects=the ordinary tab name round trip; fails_when=the lazy match swallows part of the sentence or the group number is lost; why_new=F375, the fix changes the pattern so the plain case needs a pin; seam=none
test('reads back the tab name and group of an obstacle with a plain tab name', () => {
  // Arrange
  const text = foreignPreviewObstacle('login-form.tsx', 1)

  // Act
  const parsed = parseForeignPreviewObstacle(text)

  // Assert
  assert.deepEqual(parsed, { tabName: 'login-form.tsx', viewColumn: 1 })
})

// Value: protects=a refusal that is not a foreign-preview obstacle staying a plain failure; fails_when=an unrelated sentence is parsed as an obstacle; why_new=F375 guards the looser pattern; seam=none
test('returns nothing for text that holds no foreign-preview obstacle', () => {
  // Arrange
  const text = 'The debugger did not stop in editor group 1.'

  // Act
  const parsed = parseForeignPreviewObstacle(text)

  // Assert
  assert.equal(parsed, undefined)
})
