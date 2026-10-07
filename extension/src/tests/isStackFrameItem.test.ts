import assert from 'node:assert/strict'
import { test } from 'node:test'

import type * as vscode from 'vscode'

import { isStackFrameItem } from '../runtimeSupport/utils/isStackFrameItem'

/** Stands for a debug session of the editor's API; only its identity is read. */
const session = { id: 'live-next-server' } as unknown as vscode.DebugSession

// Value: protects=the reader and the Application pane telling a pause from a running session: only a stack frame is a pause; fails_when=the thread the editors report from about 200 ms after a session went on running is taken for a pause, so the keyboard is moved and the notice told while the program runs; why_new=Cycle 0046 row 165 (delegated review, finding 1, read in both editors' workbench bundles); seam=none
test('only a stack frame among the three stack items an editor reports is a pause: a thread and no item are not', () => {
  // Arrange: what the editor reports at a pause, after a continue, and before a first stop.
  const items = [
    { session, threadId: 1, frameId: 7 },
    { session, threadId: 1 },
    undefined,
  ]

  // Act
  const paused = items.map((item) => isStackFrameItem(item))

  // Assert
  assert.deepEqual(paused, [true, false, false])
})
