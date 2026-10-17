import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stackTraceRequestOf } from '../runtimeSupport/utils/stackTraceRequestOf'
import { stackTraceResponseOf } from '../runtimeSupport/utils/stackTraceResponseOf'

// Value: protects=the reader's knowledge of which frames the editor asked for at a stop; fails_when=another request is taken for a stackTrace request, or the start of a later page is lost, so an answer is placed at the wrong frames and the reader picks another frame than the editor focuses; why_new=Cycle 0046, the limit left by finding 603 (the editor asks for the top frame, then for 19 more from frame 1); seam=none
test('only the editor’s stackTrace request is read, with its thread and the frame it starts at', () => {
  // Arrange
  const messages: unknown[] = [
    {
      type: 'request',
      seq: 7,
      command: 'stackTrace',
      arguments: { threadId: 1, startFrame: 0, levels: 1 },
    },
    {
      type: 'request',
      seq: 9,
      command: 'stackTrace',
      arguments: { threadId: 1, startFrame: 1, levels: 19 },
    },
    {
      type: 'request',
      seq: 10,
      command: 'stackTrace',
      arguments: { threadId: 2 },
    },
    { type: 'request', seq: 11, command: 'scopes', arguments: { frameId: 3 } },
    { type: 'event', event: 'stopped', body: { threadId: 1 } },
    undefined,
  ]

  // Act
  const requests = messages.map((message) => stackTraceRequestOf(message))

  // Assert
  assert.deepEqual(requests, [
    { seq: 7, threadId: 1, startFrame: 0 },
    { seq: 9, threadId: 1, startFrame: 1 },
    { seq: 10, threadId: 2, startFrame: 0 },
    undefined,
    undefined,
    undefined,
  ])
})

// Value: protects=the reader's knowledge of the frames the adapter answered at a stop; fails_when=a failed answer or another response is read as frames, or a frame's id, hint or source is lost, so the reader picks another frame than the editor focuses; why_new=Cycle 0046, the limit left by finding 603; seam=none
test('only a successful stackTrace answer is read, with its request and the id, hint and source of each frame', () => {
  // Arrange
  const messages: unknown[] = [
    {
      type: 'response',
      seq: 8,
      request_seq: 7,
      success: true,
      command: 'stackTrace',
      body: {
        stackFrames: [
          {
            id: 1000,
            name: 'handler',
            line: 4,
            column: 3,
            presentationHint: 'normal',
            source: { name: 'actions.ts', path: '/app/actions.ts' },
          },
          {
            id: 1001,
            name: 'await',
            line: 0,
            column: 0,
            presentationHint: 'label',
          },
        ],
        totalFrames: 2,
      },
    },
    {
      type: 'response',
      seq: 12,
      request_seq: 9,
      success: false,
      command: 'stackTrace',
      message: 'Thread is not paused',
    },
    {
      type: 'response',
      seq: 13,
      request_seq: 11,
      success: true,
      command: 'scopes',
      body: { scopes: [] },
    },
    'stackTrace',
  ]

  // Act
  const responses = messages.map((message) => stackTraceResponseOf(message))

  // Assert
  assert.deepEqual(responses, [
    {
      requestSeq: 7,
      frames: [
        {
          id: 1000,
          presentationHint: 'normal',
          source: { name: 'actions.ts', path: '/app/actions.ts' },
        },
        { id: 1001, presentationHint: 'label' },
      ],
    },
    undefined,
    undefined,
    undefined,
  ])
})
