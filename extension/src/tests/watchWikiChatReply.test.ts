import assert from 'node:assert/strict'
import { test } from 'node:test'

import { watchWikiChatReply } from '../utils/watchWikiChatReply'

/** Lets the watch see a hand-over command that has settled. */
const untilSeen = (): Promise<void> =>
  new Promise((resolveWait) => setImmediate(resolveWait))

// Value: protects=the end of a watched update when the chat's reply is complete; fails_when=the reply's end is not reported, so the update is watched for its whole bound, or it is reported before the reply ended; why_new=Cycle 0046 row 196; seam=none
test('the reply’s end is reported when the chat command returns a complete response, and not before', async () => {
  // Arrange
  let endRequest: (reply: unknown) => void = () => {}
  const reply = watchWikiChatReply(
    new Promise((resolveReply) => {
      endRequest = resolveReply
    }),
  )

  // Act
  await untilSeen()
  const beforeTheReply = { ended: reply.ended.aborted, end: reply.end() }
  endRequest({})
  await untilSeen()

  // Assert
  assert.deepEqual(beforeTheReply, { ended: false, end: undefined })
  assert.equal(reply.ended.aborted, true)
  assert.deepEqual(reply.end(), { outcome: 'replied' })
})

test('a reply that ends with an error is reported as the reply’s end with the chat’s message', async () => {
  // Arrange
  const reply = watchWikiChatReply(
    Promise.resolve({ errorDetails: { message: 'Quota exceeded.' } }),
  )

  // Act
  await untilSeen()

  // Assert
  assert.equal(reply.ended.aborted, true)
  assert.deepEqual(reply.end(), {
    outcome: 'error-reply',
    message: 'Quota exceeded.',
  })
})

// Value: protects=the watch of a chat that waits for the learner, and of a run whose chat command says nothing; fails_when=a wait for a confirmation, a command that returned without a response or a command that threw is taken for the reply's end, so a working chat's update is ended; why_new=Cycle 0046 row 196; seam=none
test('a reply that waits for a confirmation, a command that returns nothing and a command that throws are not the reply’s end', async () => {
  // Arrange
  const waiting = watchWikiChatReply(
    Promise.resolve({ type: 'confirmation', kind: 'toolInvocation' }),
  )
  const empty = watchWikiChatReply(Promise.resolve(undefined))
  const thrown = watchWikiChatReply(Promise.reject(new Error('Canceled')))

  // Act
  await untilSeen()

  // Assert
  assert.deepEqual(
    [waiting, empty, thrown].map((reply) => ({
      ended: reply.ended.aborted,
      end: reply.end(),
    })),
    [
      { ended: false, end: undefined },
      { ended: false, end: undefined },
      { ended: false, end: undefined },
    ],
  )
})
