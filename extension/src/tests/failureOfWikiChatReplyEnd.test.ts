import assert from 'node:assert/strict'
import { test } from 'node:test'

import { failureOfWikiChatReplyEnd } from '../utils/failureOfWikiChatReplyEnd'

// Value: protects=the sentence of a watched update whose chat stopped with an error; fails_when=the chat's message is dropped and the run ends as "finished its reply without publishing"; why_new=Cycle 0046 row 196; seam=none
test('a watch that ended at a reply with an error names the failure with the chat’s message, marked as Codebook’s sentence', () => {
  // Act
  const facts = failureOfWikiChatReplyEnd('reply-ended', {
    outcome: 'error-reply',
    message: 'Quota exceeded.',
  })

  // Assert
  assert.deepEqual(facts, {
    failure:
      'The editor chat answered the update request with an error and stopped (Quota exceeded.). Read its message in the Chat view, then press Update LLM Wiki again.',
    isFailureCodebookSentence: true,
  })
})

// Value: protects=the result of a watch that found a publish, a refusal, a cancel or the bound although the chat's reply ended with an error just then; fails_when=the error sentence is added to every end once the reply has ended, so a cancelled watch or a blocked publish is reported as the chat's error; why_new=Cycle 0046 row 196; seam=none
test('a complete reply names no failure, and a reply with an error names none when the watch ended otherwise', () => {
  // Act
  const complete = failureOfWikiChatReplyEnd('reply-ended', {
    outcome: 'replied',
  })
  const cancelled = failureOfWikiChatReplyEnd('cancelled', {
    outcome: 'error-reply',
    message: 'Quota exceeded.',
  })
  const stillOpen = failureOfWikiChatReplyEnd('timed-out', undefined)

  // Assert
  assert.deepEqual([complete, cancelled, stillOpen], [{}, {}, {}])
})

// Value: protects=the run kind reaching the sentence of a watched generation whose chat stopped with an error; fails_when=failureOfWikiChatReplyEnd stops passing runKind on, so the generation is told to answer the update request and press Update LLM Wiki; why_new=the sentence builder is tested with 'generate' but not this wiring; no_claim=the update's sentence (tests above); seam=none
test('a watched generation whose chat ended at a reply with an error names the generate request and Generate LLM Wiki', () => {
  // Act
  const facts = failureOfWikiChatReplyEnd(
    'reply-ended',
    { outcome: 'error-reply', message: 'Quota exceeded.' },
    'generate',
  )

  // Assert
  assert.deepEqual(facts, {
    failure:
      'The editor chat answered the generate request with an error and stopped (Quota exceeded.). Read its message in the Chat view, then press Generate LLM Wiki again.',
    isFailureCodebookSentence: true,
  })
})
