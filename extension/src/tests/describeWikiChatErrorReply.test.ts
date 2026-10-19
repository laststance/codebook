import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeWikiChatErrorReply } from '../utils/describeWikiChatErrorReply'

// Value: protects=the learner whose chat answered an update request with an error; fails_when=the chat's own message is dropped, or the sentence no longer ends with the next step; why_new=Cycle 0046 row 148; seam=none
test('the failure of a chat that replied with an error quotes the chat’s message and ends with the next step', () => {
  // Act
  const sentence = describeWikiChatErrorReply(
    'You have exceeded your premium request allowance.',
  )

  // Assert
  assert.equal(
    sentence,
    'The editor chat answered the update request with an error and stopped (You have exceeded your premium request allowance.). Read its message in the Chat view, then press Update LLM Wiki again.',
  )
})

// Value: protects=the next step on the Wiki page when the chat's error message is long; fails_when=the message is quoted without a bound, so the sentence is as long as the chat's text; why_new=Cycle 0046 row 148; seam=none
test('a long message of the chat is cut inside the sentence, and an error without a message is named as one', () => {
  // Arrange: a message of 160 characters; the sentence quotes its first 120.
  const longMessage = 'The model is overloaded. '.repeat(6) + 'Retry.....'

  // Act
  const cut = describeWikiChatErrorReply(longMessage)
  const unnamed = describeWikiChatErrorReply(undefined)

  // Assert
  assert.equal(longMessage.length, 160)
  assert.equal(
    cut,
    'The editor chat answered the update request with an error and stopped (The model is overloaded. The model is overloaded. The model is overloaded. The model is overloaded. The model is overloa…). Read its message in the Chat view, then press Update LLM Wiki again.',
  )
  assert.equal(
    unnamed,
    'The editor chat answered the update request with an error and stopped (no message). Read its message in the Chat view, then press Update LLM Wiki again.',
  )
})
