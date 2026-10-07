import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'

import * as constants from '../constants'
import { describeWikiChatHandOver } from '../utils/describeWikiChatHandOver'
import type * as DescribeWikiChatWatchModule from '../utils/describeWikiChatWatch'
import { describeWikiChatWatch } from '../utils/describeWikiChatWatch'

import { loadModule } from './utils/loadModule'

// Value: protects=what the learner reads in the notification that watches an update; fails_when=the title no longer says where the request is, or says it for the wrong session; why_new=Cycle 0046 row 216; seam=none
test('the watch’s notification names a new chat and the kept place of the open chat for a session of its own, and the open chat for a shared one', () => {
  // Act
  const own = describeWikiChatWatch('own', 900_000)
  const shared = describeWikiChatWatch('shared', 900_000)

  // Assert
  assert.equal(
    own,
    'Watching for the LLM Wiki update in a new chat (in the chat the Chat view restored, if it opened only now); the chat you had open keeps its place in the chat list. The watch ends when the new Wiki is published, after 15 minutes, or with Cancel, which stops watching, not the chat. If you refuse a step of the chat, press Cancel.',
  )
  assert.equal(
    shared,
    'Watching for the LLM Wiki update in the chat that is open. The watch ends when the new Wiki is published, after 15 minutes, or with Cancel, which stops watching, not the chat. If you refuse a step of the chat, press Cancel.',
  )
})

// Value: protects=the learner who reads the confirmation before the press and the notification after it: both name the request's place with the same words; fails_when=one of the two texts is reworded alone, so "a new chat" of the confirmation becomes something else in the notification; why_new=Cycle 0046 row 216; seam=none
test('the confirmation and the watch’s notification name the place of the request with the same words', () => {
  // Arrange
  const places = [
    'in a new chat',
    'keeps its place in the chat list',
    'in the chat that is open',
  ]

  // Act
  const confirmations =
    describeWikiChatHandOver(['workbench.action.chat.newChat']) +
    describeWikiChatHandOver([])
  const notifications =
    describeWikiChatWatch('own', 900_000) +
    describeWikiChatWatch('shared', 900_000)

  // Assert
  assert.deepEqual(
    places.map((place) => confirmations.includes(place)),
    [true, true, true],
  )
  assert.deepEqual(
    places.map((place) => notifications.includes(place)),
    [true, true, true],
  )
})

// Value: protects=the bound the notification names; fails_when=the title names 15 minutes whatever the watch's bound is, or writes "1 minutes"; why_new=Cycle 0046 row 217; seam=none
test('the watch’s notification names the bound of the watch in whole minutes, one minute in the singular', () => {
  // Act
  const oneMinute = describeWikiChatWatch('shared', 60_000)

  // Assert
  assert.equal(
    oneMinute,
    'Watching for the LLM Wiki update in the chat that is open. The watch ends when the new Wiki is published, after 1 minute, or with Cancel, which stops watching, not the chat. If you refuse a step of the chat, press Cancel.',
  )
})

// Value: protects=the advice after a refused step, which the notification and the page's running line give in the same words; fails_when=the notification writes its own copy of the advice, so the page's line, which is handed the constant, and the notification drift apart; why_new=Cycle 0046 row 223; seam=the constants of the notification's module, of which the advice is reworded
test('the watch’s notification ends with the advice after a refused step that the page’s running line is handed, also after the advice is reworded', async () => {
  // Arrange
  const reworded = await loadModule<typeof DescribeWikiChatWatchModule>(
    resolve(__dirname, '../utils/describeWikiChatWatch.js'),
    {
      '../constants': {
        ...constants,
        WIKI_REFUSED_STEP_ADVICE:
          'After you refused a step of the chat, choose Cancel',
      },
    },
  )

  // Act
  const title = reworded.describeWikiChatWatch('shared', 900_000)

  // Assert
  assert.equal(
    title,
    'Watching for the LLM Wiki update in the chat that is open. The watch ends when the new Wiki is published, after 15 minutes, or with Cancel, which stops watching, not the chat. After you refused a step of the chat, choose Cancel.',
  )
})
