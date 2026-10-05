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
    { outcome: 'unanswered', session: 'own', withdrawal: 'withdrawn' },
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
      'Codebook saw no sign of the update in the editor chat within 30 seconds and took its request back, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.',
    isFailureCodebookSentence: true,
  })
  assert.deepEqual(errorReply, {
    failure:
      'The editor chat answered the update request with an error and stopped (Quota exceeded.). Read its message in the Chat view, then press Update LLM Wiki again.',
    isFailureCodebookSentence: true,
  })
})
