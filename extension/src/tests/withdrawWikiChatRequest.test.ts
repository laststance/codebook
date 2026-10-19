import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withdrawWikiChatRequest } from '../utils/withdrawWikiChatRequest'

// Value: protects=the chat after a chat command that returned without a reply (the chat made no response, so it holds no request); fails_when=the withdrawal reports a request as possibly still in the chat that was never there; why_new=Cycle 0046 rows 82 and 150; seam=none
test('a hand-over command that has already returned without a reply is reported as a request the chat never held', async () => {
  // Arrange
  const handOver = Promise.resolve(undefined)

  // Act
  const withdrawal = await withdrawWikiChatRequest({ handOver })

  // Assert
  assert.equal(withdrawal, 'not-sent')
})

// Value: protects=the chat after a chat command that threw (no request was made); fails_when=only a hand-over command that resolved counts as returned, so a request that does not exist is reported as possibly still in the chat; why_new=Cycle 0046 row 82; seam=none
test('a hand-over command that threw before the withdrawal is reported as a request the chat never held', async () => {
  // Arrange
  const handOver = Promise.reject(new Error('Chat is unavailable'))

  // Act
  const withdrawal = await withdrawWikiChatRequest({ handOver })

  // Assert
  assert.equal(withdrawal, 'not-sent')
})

// Value: protects=the truth of the end's sentence when Codebook's request ended with a complete reply in the moment between the bound of the first answer and the withdrawal; fails_when=the request that ended by itself is reported as one that may still be in the chat (`left`) or that the chat never held (`not-sent`); why_new=Cycle 0046 second ship, OCR batch 8 finding 2, and state-machine review P2SM3 (its own outcome); seam=none
test('a hand-over command that has already returned a complete reply is reported as a request that ended by itself with a reply', async () => {
  // Arrange: the chat's response is complete ({} is a reply that waits for nothing).
  const handOver = Promise.resolve({})

  // Act
  const withdrawal = await withdrawWikiChatRequest({ handOver })

  // Assert
  assert.equal(withdrawal, 'replied')
})

// Value: protects=the chat that asks for its first approval in the moment between the bound of the first answer and the withdrawal; fails_when=a hand-over command that has already returned a reply that waits for a confirmation is taken for a request still pending and reported as left, although the same reply within the bound counts as the chat at work; why_new=Cycle 0047 row 24 (P3RT2); seam=none
test('a hand-over command that has already returned a reply that waits for a confirmation is reported as a request the chat answered', async () => {
  // Arrange: the chat asks to approve a tool call; its response is not complete.
  const handOver = Promise.resolve({
    type: 'confirmation',
    kind: 'toolInvocation',
  })

  // Act
  const withdrawal = await withdrawWikiChatRequest({ handOver })

  // Assert
  assert.equal(withdrawal, 'replied')
})

// Value: protects=the learner's chats when an update ends without a sign: the request is left to the learner at once; fails_when=the withdrawal waits for a command of the chat or for a settle time before it answers, so it runs the chat's Cancel or "Remove All Queued" on the chat the learner focused last, or holds the end of the update; why_new=Cycle 0047 row 6 (S11-X2); seam=none
test('a hand-over command that is still pending is reported at once as a request that may still be in the chat', async () => {
  // Arrange: the chat holds the request and never answers.
  const handOver = new Promise<unknown>(() => {})

  // Act
  const withdrawal = await withdrawWikiChatRequest({ handOver })

  // Assert
  assert.equal(withdrawal, 'left')
})
