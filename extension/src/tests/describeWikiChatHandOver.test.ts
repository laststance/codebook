import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeWikiChatHandOver } from '../utils/describeWikiChatHandOver'

// Value: protects=what the learner reads before they confirm an update in an editor with New Chat; fails_when=the sentences no longer say that a new chat starts, where the open chat goes, or what becomes of a draft; why_new=Cycle 0046 rows 197 and 198; seam=none
test('with the New Chat command the confirmation says that the request goes into a new chat, that the open chat keeps its place, and which draft is replaced', () => {
  // Act
  const sentences = describeWikiChatHandOver([
    'workbench.action.chat.open',
    'workbench.action.chat.newChat',
  ])

  // Assert
  assert.equal(
    sentences,
    'Copilot Chat receives the update request for this project in a new chat; the chat you have open keeps its place in the chat list. A draft you typed into an empty chat is replaced by the request; a draft in a chat with messages stays with that chat.',
  )
})

// Value: protects=what the learner reads before they confirm an update in an editor without New Chat; fails_when=the confirmation promises a new chat, or no longer names what the request does to a busy chat; why_new=Cycle 0046 row 198; seam=none
test('without the New Chat command the confirmation says that the request goes into the open chat and what it does to a busy chat and to a draft', () => {
  // Act
  const sentences = describeWikiChatHandOver(['workbench.action.chat.open'])

  // Assert
  assert.equal(
    sentences,
    'Copilot Chat receives the update request for this project in the chat that is open, like a message you typed: it waits behind a request in progress, a request that waits for your confirmation is cancelled, and a draft in the chat’s input is replaced by the request.',
  )
})
