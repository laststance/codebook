import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mayWikiChatStillPublish } from '../utils/mayWikiChatStillPublish'

test('only the chat of a VS Code watch that was cancelled or timed out in a window that stays open may still publish', () => {
  // Act
  const answers = {
    cancelledWatch: mayWikiChatStillPublish(
      'vscode',
      'cancelled',
      false,
      false,
    ),
    timedOutWatch: mayWikiChatStillPublish('vscode', 'timed-out', false, false),
    watchOfAClosingWindow: mayWikiChatStillPublish(
      'vscode',
      'cancelled',
      true,
      false,
    ),
    timedOutWatchOfAClosingWindow: mayWikiChatStillPublish(
      'vscode',
      'timed-out',
      true,
      false,
    ),
    failedWatch: mayWikiChatStillPublish('vscode', 'failed', false, false),
    succeededWatch: mayWikiChatStillPublish(
      'vscode',
      'succeeded',
      false,
      false,
    ),
    cancelledCursorAgent: mayWikiChatStillPublish(
      'cursor',
      'cancelled',
      false,
      false,
    ),
    timedOutCursorAgent: mayWikiChatStillPublish(
      'cursor',
      'timed-out',
      false,
      false,
    ),
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

// Value: protects=the learner and every other window after the watch of a VS Code update broke off with an error while its chat worked: the chat was not stopped; fails_when=such a run counts as one whose chat is gone, so the next press starts a second chat beside the first and no reservation tells other windows, or a broken watch whose run still ended with the chat's publish, a closing window or a Cursor run is held back; why_new=Cycle 0046 row 341 (the watch's catch ended the run as failed with no reservation); seam=none
test('the chat of a VS Code watch that broke off may still publish when its run ended as failed in a window that stays open, and not when the run ended with the publish, the window closes or the host is Cursor', () => {
  // Act
  const answers = {
    brokenWatch: mayWikiChatStillPublish('vscode', 'failed', false, true),
    brokenWatchWhoseRunSucceeded: mayWikiChatStillPublish(
      'vscode',
      'succeeded',
      false,
      true,
    ),
    brokenWatchOfAClosingWindow: mayWikiChatStillPublish(
      'vscode',
      'failed',
      true,
      true,
    ),
    brokenCursorRun: mayWikiChatStillPublish('cursor', 'failed', false, true),
  }

  // Assert
  assert.deepEqual(answers, {
    brokenWatch: true,
    brokenWatchWhoseRunSucceeded: false,
    brokenWatchOfAClosingWindow: false,
    brokenCursorRun: false,
  })
})
