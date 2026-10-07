import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isDebugStoppedEvent } from '../runtimeSupport/utils/isDebugStoppedEvent'

// Value: protects=the reader telling a stop of the debugger from a frame the learner selects: only the adapter's stopped event counts as a stop; fails_when=another event, a response or a request is taken for a stop, so a selected frame that follows it is settled like a stop and the keyboard leaves the Call Stack view; why_new=Cycle 0046 row 225; seam=none
test("only the debug adapter's stopped event is taken for a stop: other events, responses, requests and what is no message are not", () => {
  // Arrange: what a tracker receives around a stop and around a selected frame.
  const messages: unknown[] = [
    { type: 'event', event: 'stopped', body: { reason: 'step', threadId: 1 } },
    { type: 'event', event: 'continued', body: { threadId: 1 } },
    { type: 'response', command: 'stackTrace', success: true },
    { type: 'request', command: 'scopes' },
    'stopped',
    undefined,
  ]

  // Act
  const stops = messages.map((message) => isDebugStoppedEvent(message))

  // Assert
  assert.deepEqual(stops, [true, false, false, false, false, false])
})
