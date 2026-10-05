import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeUnansweredWikiChat } from '../utils/describeUnansweredWikiChat'

test('an unanswered update whose request left its own chat session says that the update was not started and what to check before a retry', () => {
  // Act
  const sentence = describeUnansweredWikiChat('withdrawn', 'own', 30_000)

  // Assert
  assert.equal(
    sentence,
    'The editor chat did not answer within 30 seconds, so the update was not started. Check that Copilot Chat is enabled and signed in, then retry.',
  )
})

// Value: protects=the learner whose unanswered update request Codebook could not take back; fails_when=the sentence still says "so the update was not started", or no longer ends with the step that makes a retry safe (stop the request in the Chat view); why_new=Cycle 0046 row 82; seam=none
test('an unanswered update whose request Codebook did not see leave the chat says that it may still be there and is stopped in the Chat view before a retry', () => {
  // Act
  const sentence = describeUnansweredWikiChat('left', 'own', 30_000)

  // Assert
  assert.equal(
    sentence,
    'The editor chat did not answer within 30 seconds, and Codebook could not withdraw its update request, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry.',
  )
})

// Value: protects=the learner whose editor sent the update request into the chat they were using, where it waits behind a request in progress; fails_when=the sentence tells them only to check Copilot Chat, which is enabled and signed in, and not that the chat may be busy; why_new=Cycle 0046 row 129 (the shared session of an editor without the New Chat command); seam=none
test('an unanswered update in a chat session shared with the learner says that the chat may be working on another request, before the check of Copilot Chat', () => {
  // Act
  const withdrawn = describeUnansweredWikiChat('withdrawn', 'shared', 30_000)
  const left = describeUnansweredWikiChat('left', 'shared', 30_000)

  // Assert
  assert.equal(
    withdrawn,
    'The editor chat did not answer within 30 seconds, so the update was not started. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.',
  )
  assert.equal(
    left,
    'The editor chat did not answer within 30 seconds, and Codebook could not withdraw its update request, so the request may still be in the chat. Stop or remove it in the Chat view. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.',
  )
})
