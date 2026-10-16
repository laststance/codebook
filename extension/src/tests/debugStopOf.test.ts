import assert from 'node:assert/strict'
import { test } from 'node:test'

import { debugStopOf } from '../runtimeSupport/utils/debugStopOf'

// Value: protects=the reader telling a stop of the debugger from a frame the learner selects, and a stop the learner started from one that happened by itself: only the adapter's stopped event is a stop, and it carries the adapter's reason; fails_when=another event, a response or a request is taken for a stop, so a selected frame that follows it is settled like a stop and the keyboard leaves the Call Stack view, or the reason is lost, so a step is judged like a breakpoint; why_new=Cycle 0046 rows 225 and 250, and row 263 for a stop the adapter asks not to bring to the front (its wish must not be lost, or the frame the learner selects later is taken for that stop); seam=none
test("only the debug adapter's stopped event is read as a stop, with the reason it gives and its wish to keep the focus: other events, responses, requests and what is no message are none", () => {
  // Arrange: what a tracker receives around a stop and around a selected frame.
  const messages: unknown[] = [
    { type: 'event', event: 'stopped', body: { reason: 'step', threadId: 1 } },
    { type: 'event', event: 'stopped', body: { threadId: 1 } },
    { type: 'event', event: 'stopped' },
    {
      type: 'event',
      event: 'stopped',
      body: { reason: 'breakpoint', preserveFocusHint: true },
    },
    { type: 'event', event: 'continued', body: { threadId: 1 } },
    { type: 'response', command: 'stackTrace', success: true },
    { type: 'request', command: 'scopes' },
    'stopped',
    undefined,
  ]

  // Act
  const stops = messages.map((message) => debugStopOf(message))

  // Assert
  assert.deepEqual(stops, [
    { reason: 'step', keepsFocus: false, threadId: 1 },
    { reason: undefined, keepsFocus: false, threadId: 1 },
    { reason: undefined, keepsFocus: false, threadId: undefined },
    { reason: 'breakpoint', keepsFocus: true, threadId: undefined },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ])
})
