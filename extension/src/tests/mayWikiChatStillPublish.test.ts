import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mayWikiChatStillPublish } from '../utils/mayWikiChatStillPublish'

test('only the chat of a VS Code watch that was cancelled or timed out in a window that stays open may still publish', () => {
  // Act
  const answers = {
    cancelledWatch: mayWikiChatStillPublish('vscode', 'cancelled', false),
    timedOutWatch: mayWikiChatStillPublish('vscode', 'timed-out', false),
    watchOfAClosingWindow: mayWikiChatStillPublish('vscode', 'cancelled', true),
    timedOutWatchOfAClosingWindow: mayWikiChatStillPublish(
      'vscode',
      'timed-out',
      true,
    ),
    failedWatch: mayWikiChatStillPublish('vscode', 'failed', false),
    succeededWatch: mayWikiChatStillPublish('vscode', 'succeeded', false),
    cancelledCursorAgent: mayWikiChatStillPublish('cursor', 'cancelled', false),
    timedOutCursorAgent: mayWikiChatStillPublish('cursor', 'timed-out', false),
  }

  // Assert
  assert.deepEqual(answers, {
    cancelledWatch: true,
    timedOutWatch: true,
    watchOfAClosingWindow: false,
    timedOutWatchOfAClosingWindow: false,
    failedWatch: false,
    succeededWatch: false,
    cancelledCursorAgent: false,
    timedOutCursorAgent: false,
  })
})
