import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  WIKI_CHAT_WATCH_TITLE,
  WIKI_CHAT_WATCH_TITLE_LIMIT_CHARS,
} from '../constants'

// Value: protects=the learner who answers the chat's approvals while Codebook watches a VS Code update; fails_when=the title of the watch's notification is reworded past two lines of the editor's toast (about 100 characters), so the toast lies over the Allow and Skip buttons of a pending approval again, or it names a place of the request that is untrue for a chat the Chat view restored or for the chat that was open; why_new=Cycle 0046 row 336 (measured natively: the title of 330 characters made a toast of 450 by 178 px that answered `document.elementFromPoint` at Allow, Skip, the chat's input and its Stop); seam=none
test('the title of the notification that watches a VS Code update says what is watched and that Cancel stops watching, not the chat, in at most 100 characters, and names no place of the request', () => {
  // Act
  const title = WIKI_CHAT_WATCH_TITLE

  // Assert
  assert.equal(
    title,
    'Watching the editor chat for the LLM Wiki update. Cancel stops watching, not the chat.',
  )
  assert.equal(WIKI_CHAT_WATCH_TITLE_LIMIT_CHARS, 100)
  assert.equal(title.length <= WIKI_CHAT_WATCH_TITLE_LIMIT_CHARS, true)
  assert.equal(title.length, 86)
  assert.deepEqual(
    ['new chat', 'chat that is open', 'restored'].filter((place) =>
      title.includes(place),
    ),
    [],
  )
})
