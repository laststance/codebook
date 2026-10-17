import assert from 'node:assert/strict'
import { test } from 'node:test'

import type * as vscode from 'vscode'

import { StopKeyboardHandOver } from '../runtimeSupport/stopKeyboardHandOver'
import { heldStopSessionOf } from '../runtimeSupport/utils/heldStopSessionOf'

/** Stands for the learner's own debug session; only its identity is read. */
const learnerSession = { id: 'learner-node' } as unknown as vscode.DebugSession

// Value: protects=the learner's handed-over stop while a Codebook run's stop of another session is read; fails_when=the stop read last, and not the shown frame's own, decides whether the chat is owed a return and whether the shown file holds the keyboard; why_new=Cycle 0046 finding 605; seam=none
test('the shown frame’s session is named while it holds a stop, also after another session’s stop was read', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node')
  handOver.markDone('learner-node')
  handOver.arm('live-next-browser')

  // Act
  const held = heldStopSessionOf(
    { session: learnerSession, threadId: 1, frameId: 9 },
    handOver,
  )

  // Assert
  assert.equal(held, 'learner-node')
})

// Value: protects=the chat's return at a stop of a session that holds none while another session's stop is held; fails_when=another session's held stop counts for the shown frame, so the reader owes the chat nothing and settles the pause to the learner; why_new=Cycle 0046 finding 605; seam=none
test('a frame whose session holds no stop, a thread and no item name no session', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('live-next-browser')
  const items = [
    { session: learnerSession, threadId: 1, frameId: 9 },
    { session: learnerSession, threadId: 1 },
    undefined,
  ]

  // Act
  const held = items.map((item) => heldStopSessionOf(item, handOver))

  // Assert
  assert.deepEqual(held, [undefined, undefined, undefined])
})
