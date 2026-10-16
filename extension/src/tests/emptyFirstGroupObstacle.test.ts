import assert from 'node:assert/strict'
import { test } from 'node:test'

import { emptyFirstGroupObstacle } from '../utils/emptyFirstGroupObstacle'

test('the refusal beside the chat names the empty first editor group and tells the learner to fill or close it', () => {
  // Arrange
  const expected =
    'The Codebook panes were not arranged: the first editor group (column 1) is empty, and beside the chat the editor reports no keyboard focus in an empty group. Open a file in that group or close it, then try again.'

  // Act
  const sentence = emptyFirstGroupObstacle()

  // Assert
  assert.equal(sentence, expected)
})
