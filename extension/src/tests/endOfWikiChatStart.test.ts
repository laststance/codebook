import assert from 'node:assert/strict'
import { test } from 'node:test'

import { endOfWikiChatStart } from '../utils/endOfWikiChatStart'

// Value: protects=the watch for the publish, which only a chat that works on the request gets; fails_when=a start that failed, showed no sign, was answered with an error or with a complete response still starts the 15-minute watch, or a working chat is ended; why_new=Cycle 0046 rows 147 to 149; seam=none
test('only a chat that works on the request in a window that stays leaves the run to the watch; a complete response ends it with a look at the disk', () => {
  // Act
  const working = endOfWikiChatStart({ outcome: 'working' }, 30_000, false)
  const replied = endOfWikiChatStart({ outcome: 'replied' }, 30_000, false)

  // Assert
  assert.equal(working, undefined)
  assert.deepEqual(replied, {})
})

test('a start in a window that closes, and a start that was aborted, end the run as cancelled', () => {
  // Act
  const closing = endOfWikiChatStart({ outcome: 'working' }, 30_000, true)
  const aborted = endOfWikiChatStart({ outcome: 'cancelled' }, 30_000, false)

  // Assert
  assert.deepEqual(closing, { cancelled: true })
  assert.deepEqual(aborted, { cancelled: true })
})

// Value: protects=the sentence each failed start ends with; fails_when=the three failures share one sentence again (a chat that answered with an error is told it showed no sign within 30 seconds), or one is no longer marked as Codebook's own, so the page cuts its next step; why_new=Cycle 0046 rows 147 and 148; seam=none
test('a chat command that threw, a start without a sign and a reply with an error each end the run as failed with their own sentence, marked as Codebook’s', () => {
  // Act
  const thrown = endOfWikiChatStart(
    { outcome: 'failed', error: new Error('Chat is unavailable') },
    30_000,
    false,
  )
  const withoutSign = endOfWikiChatStart(
    { outcome: 'unanswered', session: 'own', request: 'not-sent' },
    30_000,
    false,
  )
  const errorReply = endOfWikiChatStart(
    { outcome: 'error-reply', message: 'Quota exceeded.' },
    30_000,
    false,
  )

  // Assert
  assert.deepEqual(thrown, {
    failure:
      'The editor chat could not be opened (Chat is unavailable). Install or enable GitHub Copilot Chat, then press Update LLM Wiki again.',
    isFailureCodebookSentence: true,
  })
  assert.deepEqual(withoutSign, {
    failure:
      'Codebook saw no sign of the update in the editor chat within 30 seconds and the chat holds no request of it, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.',
    isFailureCodebookSentence: true,
  })
  assert.deepEqual(errorReply, {
    failure:
      'The editor chat answered the update request with an error and stopped (Quota exceeded.). Read its message in the Chat view, then press Update LLM Wiki again.',
    isFailureCodebookSentence: true,
  })
})

// Value: protects=the learner who reads the notice of a start whose request Codebook could not take back: the chat may still hold the request and publish under that notice; fails_when=that end is no longer marked as one the site may be replaced after, so the notice says "The last usable site is kept." and a later publish makes it untrue, or an end after which the chat holds no request (never held) is marked too; why_new=Cycle 0046 row 341; Cycle 0047 row 6 (S11-X2): no start ends with a request taken back any more; seam=none
test('a start without a sign whose request could not be taken back ends the run as failed and marked as an end the site may be replaced after, in a session of its own and in a shared one; a request never held is not marked', () => {
  // Act
  const leftInOwnSession = endOfWikiChatStart(
    { outcome: 'unanswered', session: 'own', request: 'left' },
    30_000,
    false,
  )
  const leftInSharedSession = endOfWikiChatStart(
    { outcome: 'unanswered', session: 'shared', request: 'left' },
    30_000,
    false,
  )
  const neverHeld = endOfWikiChatStart(
    { outcome: 'unanswered', session: 'own', request: 'not-sent' },
    30_000,
    false,
  )
  const neverHeldInSharedSession = endOfWikiChatStart(
    { outcome: 'unanswered', session: 'shared', request: 'not-sent' },
    30_000,
    false,
  )

  // Assert
  assert.deepEqual(leftInOwnSession, {
    failure:
      'Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.',
    isFailureCodebookSentence: true,
    mayBeReplacedLater: true,
  })
  assert.deepEqual(leftInSharedSession, {
    failure:
      'Codebook saw no sign of the update in the editor chat within 30 seconds and could not take its request back, so the request may still be in the chat. Stop or remove it in the Chat view. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.',
    isFailureCodebookSentence: true,
    mayBeReplacedLater: true,
  })
  assert.deepEqual(neverHeld, {
    failure:
      'Codebook saw no sign of the update in the editor chat within 30 seconds and the chat holds no request of it, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.',
    isFailureCodebookSentence: true,
  })
  assert.deepEqual(neverHeldInSharedSession, {
    failure:
      'Codebook saw no sign of the update in the editor chat within 30 seconds and the chat holds no request of it, so no update is running. The chat may be working on another request: wait until it has finished, or check that Copilot Chat is enabled and signed in, then retry.',
    isFailureCodebookSentence: true,
  })
})
