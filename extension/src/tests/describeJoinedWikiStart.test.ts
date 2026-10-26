import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeJoinedWikiStart } from '../utils/describeJoinedWikiStart'

// Value: protects=Cycle 0056 task 2, the sentence of a press that joins a start under way; fails_when=it names the wrong run kind or loses the word that tells the press was joined; no_claim=when it is shown (host tests); seam=none
test('a press that joins a start under way is told which start it joined', () => {
  // Act
  const sentences = [
    describeJoinedWikiStart('generate'),
    describeJoinedWikiStart('update'),
  ]

  // Assert
  assert.deepEqual(sentences, [
    'Codebook is already starting an LLM Wiki generation in this window; this press joins it.',
    'Codebook is already starting an LLM Wiki update in this window; this press joins it.',
  ])
})
