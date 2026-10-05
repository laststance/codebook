import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeUnansweredWikiChat } from '../utils/describeUnansweredWikiChat'

test('an update without a sign whose request Codebook took back from its own chat session says what Codebook saw and did, that no update is running, and what to check before a retry', () => {
  // Act
  const sentence = describeUnansweredWikiChat('withdrawn', 'own', 30_000)

  // Assert
  assert.equal(
    sentence,
    'Codebook saw no sign of the update in the editor chat within 30 seconds and took its request back, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.',
  )
})

// Value: protects=the learner whose unanswered update request Codebook could not take back; fails_when=the sentence says that no update is running, or no longer ends with the step that makes a retry safe (stop the request in the Chat view); why_new=Cycle 0046 row 82; seam=none
test('an update without a sign whose request Codebook did not see leave the chat says that it may still be there and is stopped in the Chat view before a retry', () => {
  // Act
  const sentence = describeUnansweredWikiChat('left', 'own', 30_000)

  // Assert
  assert.equal(
    sentence,
    'Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry.',
  )
})

// Value: protects=the learner whose editor sent the update request into the chat they were using, where it waits behind a request in progress; fails_when=the sentence tells them only to check Copilot Chat, which is enabled and signed in, and not that the chat may be busy; why_new=Cycle 0046 row 129 (the shared session of an editor without the New Chat command); seam=none
test('an update without a sign in a chat session shared with the learner says that the chat may be working on another request, before the check of Copilot Chat', () => {
  // Act
  const withdrawn = describeUnansweredWikiChat('withdrawn', 'shared', 30_000)
  const left = describeUnansweredWikiChat('left', 'shared', 30_000)

  // Assert
  assert.equal(
    withdrawn,
    'Codebook saw no sign of the update in the editor chat within 30 seconds and took its request back, so no update is running. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.',
  )
  assert.equal(
    left,
    'Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.',
  )
})

// Value: protects=the truth of the sentence when the chat never held the request (its command returned with nothing); fails_when=the sentence says that Codebook took its request back although there was none to take back; why_new=Cycle 0046 rows 147 and 150; seam=none
test('an update without a sign whose request the chat never held says that the chat holds no request of it, in a session of its own and in a shared one', () => {
  // Act
  const own = describeUnansweredWikiChat('not-sent', 'own', 30_000)
  const shared = describeUnansweredWikiChat('not-sent', 'shared', 30_000)

  // Assert
  assert.equal(
    own,
    'Codebook saw no sign of the update in the editor chat within 30 seconds and the chat holds no request of it, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.',
  )
  assert.equal(
    shared,
    'Codebook saw no sign of the update in the editor chat within 30 seconds and the chat holds no request of it, so no update is running. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.',
  )
})
