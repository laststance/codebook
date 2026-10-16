import assert from 'node:assert/strict'
import { test } from 'node:test'

import type * as vscode from 'vscode'

import { StopKeyboardHandOver } from '../runtimeSupport/stopKeyboardHandOver'
import { pausedEditorOfStop } from '../runtimeSupport/utils/pausedEditorOfStop'

/** Stands for the learner's own debug session; only its identity is read. */
const learnerSession = { id: 'learner-node' } as unknown as vscode.DebugSession
/** Stands for the learner's file the editor's debugger opened at the stop; only its document's scheme is read. */
const actionsEditor = {
  document: { uri: { scheme: 'file', path: '/work/app/actions.ts' } },
} as unknown as vscode.TextEditor
/** Stands for the reader's captured source; only its document's scheme is read. */
const capturedSourceEditor = {
  document: {
    uri: { scheme: 'codebook-source', path: '/Captured-actions.ts' },
  },
} as unknown as vscode.TextEditor

// Value: protects=the keyboard at a stop of a learner's own debug session when the editor reports its frame, also when the paused file was in front already (a step within the file); fails_when=the frame of a waiting stop names no editor, so the paused file never gets the keyboard the editor's default gives it; why_new=Cycle 0046 finding 603; seam=none
test('the frame of a stop that waits for its hand-over names the active text editor as its paused file', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node')

  // Act
  const paused = pausedEditorOfStop({
    activeStackItem: { session: learnerSession, threadId: 1, frameId: 4 },
    activeTextEditor: actionsEditor,
    handOver,
  })

  // Assert
  assert.deepEqual(paused, { sessionId: 'learner-node', editor: actionsEditor })
})

// Value: protects=one hand-over per stop; fails_when=a later frame of a stop that was handed over already names the active text editor again and takes the keyboard from wherever the learner moved it; why_new=Cycle 0046 finding 603 (decision R7: once per stop); seam=none
test('the frame of a stop that was handed over already names no paused file', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node')
  handOver.markDone('learner-node')

  // Act
  const paused = pausedEditorOfStop({
    activeStackItem: { session: learnerSession, threadId: 1, frameId: 5 },
    activeTextEditor: actionsEditor,
    handOver,
  })

  // Assert
  assert.equal(paused, undefined)
})

// Value: protects=the reader's captured source and a session that runs again; fails_when=the captured source is taken for the paused file, or a running thread for a stop's frame, and Codebook moves the keyboard; why_new=Cycle 0046 finding 603; seam=none
test('a thread and the captured source name no paused file', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node')
  const states = [
    {
      activeStackItem: { session: learnerSession, threadId: 1 },
      activeTextEditor: actionsEditor,
    },
    {
      activeStackItem: { session: learnerSession, threadId: 1, frameId: 6 },
      activeTextEditor: capturedSourceEditor,
    },
    {
      activeStackItem: { session: learnerSession, threadId: 1, frameId: 7 },
      activeTextEditor: undefined,
    },
  ]

  // Act
  const paused = states.map((state) =>
    pausedEditorOfStop({ ...state, handOver }),
  )

  // Assert
  assert.deepEqual(paused, [undefined, undefined, undefined])
})
