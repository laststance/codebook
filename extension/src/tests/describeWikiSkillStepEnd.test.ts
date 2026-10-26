import assert from 'node:assert/strict'
import { test } from 'node:test'

import { WIKI_SKILL_STEP_TIMEOUT_MS } from '../constants'
import { describeWikiSkillStepEnd } from '../utils/describeWikiSkillStepEnd'

// Value: protects=Cycle 0056 task 13, the sentences a start ends with while Codebook readies the Cursor skill; fails_when=a sentence names the wrong run kind, names no bound or no next step, or the bound is not 30 seconds; no_claim=when the step is stopped (host tests); seam=none
test('a start ended while the Cursor skill was readied says who ended it and when, that no agent started and what to press next', () => {
  // Act
  const sentences = [
    describeWikiSkillStepEnd(
      'stopped',
      'generate',
      WIKI_SKILL_STEP_TIMEOUT_MS,
      '21:10',
    ),
    describeWikiSkillStepEnd(
      'stopped',
      'update',
      WIKI_SKILL_STEP_TIMEOUT_MS,
      '21:10',
    ),
    describeWikiSkillStepEnd(
      'bound',
      'generate',
      WIKI_SKILL_STEP_TIMEOUT_MS,
      '21:10',
    ),
    describeWikiSkillStepEnd(
      'bound',
      'update',
      WIKI_SKILL_STEP_TIMEOUT_MS,
      '21:10',
    ),
  ]

  // Assert
  assert.deepEqual(sentences, [
    'The LLM Wiki generation was cancelled at 21:10 while Codebook readied the Cursor skill; no agent was started.',
    'The LLM Wiki update was cancelled at 21:10 while Codebook readied the Cursor skill; no agent was started.',
    'Codebook stopped readying the Cursor skill after 30 seconds; no agent was started. Press Generate LLM Wiki again, or run Codebook: Set Up AI Chat.',
    'Codebook stopped readying the Cursor skill after 30 seconds; no agent was started. Press Update LLM Wiki again, or run Codebook: Set Up AI Chat.',
  ])
})
