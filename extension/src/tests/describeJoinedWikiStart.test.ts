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

// Value: protects=Cycle 0056 pass 3 A2, the sentence of a press that carries a choice into a start under way; fails_when=the press with a choice is told "this press joins it" although the start does not apply its choice, or the sentence names the wrong run kind or loses the instruction to choose again; no_claim=when it is shown (host tests); seam=none
test('a press that carries a choice into a start under way is told the choice was not applied and to choose again', () => {
  // Act
  const sentences = [
    describeJoinedWikiStart('generate', true),
    describeJoinedWikiStart('update', true),
  ]

  // Assert
  assert.deepEqual(sentences, [
    'Codebook is already starting an LLM Wiki generation in this window, so this choice was not applied. If that start stops for the same reason, choose it again.',
    'Codebook is already starting an LLM Wiki update in this window, so this choice was not applied. If that start stops for the same reason, choose it again.',
  ])
})
