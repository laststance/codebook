import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isDebugResumeMessage } from '../runtimeSupport/utils/isDebugResumeMessage'

// Value: protects=the reader knowing that a debug session went on, so that a stop the editor never showed is not kept for a frame the learner selects later: the adapter's continued event says it, and so does the editor's own resume or step request, which an adapter need not answer with that event; fails_when=only the event is read (a stop the learner resumed stays noted), or every request counts (the stackTrace request the editor sends at each stop would put the stop itself in doubt); why_new=Cycle 0046 row 263 (a stop's note ends when its session goes on); seam=none
test("a debug session goes on with the adapter's continued event and with the editor's resume and step requests: other events, other requests, responses and what is no message say nothing", () => {
  // Arrange: what a tracker receives in both directions around a stop that is resumed.
  const messages: unknown[] = [
    { type: 'event', event: 'continued', body: { threadId: 1 } },
    { type: 'request', command: 'continue', arguments: { threadId: 1 } },
    { type: 'request', command: 'next', arguments: { threadId: 1 } },
    { type: 'request', command: 'stepIn', arguments: { threadId: 1 } },
    { type: 'request', command: 'stepOut', arguments: { threadId: 1 } },
    { type: 'request', command: 'restartFrame', arguments: { frameId: 4 } },
    { type: 'request', command: 'goto', arguments: { threadId: 1 } },
    { type: 'event', event: 'stopped', body: { reason: 'breakpoint' } },
    { type: 'request', command: 'stackTrace', arguments: { threadId: 1 } },
    { type: 'response', command: 'continue', success: true },
    'continued',
    undefined,
  ]

  // Act
  const answers = messages.map((message) => isDebugResumeMessage(message))

  // Assert
  assert.deepEqual(answers, [
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
  ])
})
