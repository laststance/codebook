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

// Value: protects=the keyboard at a stop of a learner's own debug session when the editor reports the frame its stop handling focuses, also when the paused file was in front already (a step within the file); fails_when=that frame names no editor, so the paused file never gets the keyboard the editor's default gives it; why_new=Cycle 0046 finding 603; seam=none
test('the frame the editor focuses for a stop that waits for its hand-over names the active text editor as its paused file', () => {
  // Arrange: the learner's stop, whose top frame 4 the adapter answered for the editor.
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node', { threadId: 1, reason: 'step' })
  handOver.readEditorsMessage('learner-node', {
    type: 'request',
    seq: 11,
    command: 'stackTrace',
    arguments: { threadId: 1, startFrame: 0, levels: 1 },
  })
  handOver.readAdaptersMessage('learner-node', {
    type: 'response',
    request_seq: 11,
    success: true,
    command: 'stackTrace',
    body: {
      stackFrames: [
        {
          id: 4,
          presentationHint: 'normal',
          source: { path: '/work/app/actions.ts' },
        },
      ],
    },
  })

  // Act
  const paused = pausedEditorOfStop({
    activeStackItem: { session: learnerSession, threadId: 1, frameId: 4 },
    activeTextEditor: actionsEditor,
    handOver,
  })

  // Assert
  assert.deepEqual(paused, { sessionId: 'learner-node', editor: actionsEditor })
})

// Value: protects=the keyboard of a learner who selects a frame of a stop for which the editor focused no frame: no frame qualified for its rule, so a selected frame is none of the stop's; fails_when=any frame of the session counts as the stop's, and the file a click opened preserving the focus gets the keyboard; why_new=Cycle 0046, the limit left by finding 603 (a pause in Node's own code with every frame deemphasized); seam=none
test('a frame of a stop for which no frame qualifies names no paused file', () => {
  // Arrange: the learner's pause, whose only answered frame 4 is deemphasized.
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node', { threadId: 1, reason: 'pause' })
  handOver.readEditorsMessage('learner-node', {
    type: 'request',
    seq: 12,
    command: 'stackTrace',
    arguments: { threadId: 1, startFrame: 0, levels: 1 },
  })
  handOver.readAdaptersMessage('learner-node', {
    type: 'response',
    request_seq: 12,
    success: true,
    command: 'stackTrace',
    body: {
      stackFrames: [
        {
          id: 4,
          presentationHint: 'deemphasize',
          source: { path: '<node_internals>/timers', sourceReference: 9 },
        },
      ],
    },
  })

  // Act
  const paused = pausedEditorOfStop({
    activeStackItem: { session: learnerSession, threadId: 1, frameId: 4 },
    activeTextEditor: actionsEditor,
    handOver,
  })

  // Assert
  assert.equal(paused, undefined)
})

// Value: protects=one hand-over per stop and the keyboard of a learner who selects another frame; fails_when=a frame of a stop that was handed over already, or a frame other than the one the editor focuses for the stop, names the active text editor and takes the keyboard from wherever the learner has it; why_new=Cycle 0046 findings 602 and 603 (decision R7: once per stop, only where the editor showed the stop); seam=none
test('a frame of a handed-over stop and a selected frame name no paused file', () => {
  // Arrange: two stops whose top frames 4 and 6 the adapter answered; the first one was handed over.
  const handOver = new StopKeyboardHandOver()
  for (const [sessionId, seq, frameId] of [
    ['learner-node', 13, 4],
    ['learner-worker', 14, 6],
  ] as const) {
    handOver.arm(sessionId, { threadId: 1, reason: 'breakpoint' })
    handOver.readEditorsMessage(sessionId, {
      type: 'request',
      seq,
      command: 'stackTrace',
      arguments: { threadId: 1, startFrame: 0, levels: 1 },
    })
    handOver.readAdaptersMessage(sessionId, {
      type: 'response',
      request_seq: seq,
      success: true,
      command: 'stackTrace',
      body: {
        stackFrames: [{ id: frameId, source: { path: '/work/app/a.ts' } }],
      },
    })
  }
  handOver.markDone('learner-node')
  const workerSession = {
    id: 'learner-worker',
  } as unknown as vscode.DebugSession

  // Act
  const paused = [
    pausedEditorOfStop({
      activeStackItem: { session: learnerSession, threadId: 1, frameId: 4 },
      activeTextEditor: actionsEditor,
      handOver,
    }),
    pausedEditorOfStop({
      activeStackItem: { session: workerSession, threadId: 1, frameId: 7 },
      activeTextEditor: actionsEditor,
      handOver,
    }),
  ]

  // Assert
  assert.deepEqual(paused, [undefined, undefined])
})

// Value: protects=the reader's captured source and a session that runs again; fails_when=the captured source is taken for the paused file, or a running thread for a stop's frame, and Codebook moves the keyboard; why_new=Cycle 0046 finding 603; seam=none
test('a thread, the captured source and no text editor name no paused file', () => {
  // Arrange: the learner's stop, whose top frame 4 the adapter answered for the editor.
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node', { threadId: 1, reason: 'breakpoint' })
  handOver.readEditorsMessage('learner-node', {
    type: 'request',
    seq: 15,
    command: 'stackTrace',
    arguments: { threadId: 1 },
  })
  handOver.readAdaptersMessage('learner-node', {
    type: 'response',
    request_seq: 15,
    success: true,
    command: 'stackTrace',
    body: {
      stackFrames: [{ id: 4, source: { path: '/work/app/actions.ts' } }],
    },
  })
  const states = [
    {
      activeStackItem: { session: learnerSession, threadId: 1 },
      activeTextEditor: actionsEditor,
    },
    {
      activeStackItem: { session: learnerSession, threadId: 1, frameId: 4 },
      activeTextEditor: capturedSourceEditor,
    },
    {
      activeStackItem: { session: learnerSession, threadId: 1, frameId: 4 },
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
