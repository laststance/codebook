import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeSecondWikiUpdateStart } from '../utils/describeSecondWikiUpdateStart'

// Value: protects=a learner whose second press of Update LLM Wiki is refused reading where the running update's progress is; fails_when=the sentence names a place where nothing is shown (a VS Code update before the chat's first sign, an editor that cannot show the run), names a notification for a VS Code watch, which is shown in the status bar, or no longer names the status bar or the notification where one is shown; why_new=Cycle 0046 row 316: one sentence named "the notification here" in every state; row 592 moved the VS Code watch into the status bar; seam=none
test('the refusal of a second Wiki update start names the status bar for a VS Code watch and the notification for a Cursor run where one is shown, says that the status bar follows while the chat has given no sign, and names the browser reader alone where nothing will be shown', () => {
  // Arrange and Act
  const sentences = {
    statusBar: describeSecondWikiUpdateStart('status-bar'),
    notification: describeSecondWikiUpdateStart('notification'),
    awaitedChat: describeSecondWikiUpdateStart('awaited-chat'),
    readerOnly: describeSecondWikiUpdateStart('reader-only'),
  }

  // Assert
  assert.deepEqual(sentences, {
    statusBar:
      'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader and in the status bar here.',
    notification:
      'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader and in the notification here.',
    awaitedChat:
      'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader. Codebook is waiting for the editor chat to take up the request; once it has, the status bar here shows the watch and its Cancel.',
    readerOnly:
      'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader.',
  })
})
