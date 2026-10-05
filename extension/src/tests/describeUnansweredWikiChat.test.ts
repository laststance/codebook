import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeUnansweredWikiChat } from '../utils/describeUnansweredWikiChat'

test('an unanswered update whose request left the chat says that the update was not started and what to check before a retry', () => {
  // Act
  const sentence = describeUnansweredWikiChat('withdrawn', 30_000)

  // Assert
  assert.equal(
    sentence,
    'The editor chat did not answer within 30 seconds, so the update was not started. Check that Copilot Chat is enabled and signed in, then retry.',
  )
})

// Value: protects=the learner whose unanswered update request Codebook could not take back; fails_when=the sentence still says "so the update was not started", or no longer ends with the step that makes a retry safe (stop the request in the Chat view); why_new=Cycle 0046 row 82; seam=none
test('an unanswered update whose request Codebook did not see leave the chat says that it may still be there and is stopped in the Chat view before a retry', () => {
  // Act
  const sentence = describeUnansweredWikiChat('left', 30_000)

  // Assert
  assert.equal(
    sentence,
    'The editor chat did not answer within 30 seconds, and Codebook could not withdraw its update request, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry.',
  )
})
