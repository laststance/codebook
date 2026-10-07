import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeSecondWikiUpdateStart } from '../utils/describeSecondWikiUpdateStart'

// Value: protects=a learner whose second press of Update LLM Wiki is refused reading where the running update's progress is; fails_when=the sentence names a notification where none is shown (a VS Code update before the chat's first sign, an editor without the progress API), or no longer names it where one is; why_new=Cycle 0046 row 316: one sentence named "the notification here" in every state; seam=none
test('the refusal of a second Wiki update start names the notification only where one is shown, says when one follows while the chat has given no sign, and names the browser reader alone where none will be shown', () => {
  // Arrange and Act
  const sentences = {
    notification: describeSecondWikiUpdateStart('notification'),
    awaitedChat: describeSecondWikiUpdateStart('awaited-chat'),
    readerOnly: describeSecondWikiUpdateStart('reader-only'),
  }

  // Assert
  assert.deepEqual(sentences, {
    notification:
      'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader and in the notification here.',
    awaitedChat:
      'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader. Codebook is waiting for the editor chat to take up the request; once it has, a notification here watches the update.',
    readerOnly:
      'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader.',
  })
})
