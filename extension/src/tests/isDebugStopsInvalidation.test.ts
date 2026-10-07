import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isDebugStopsInvalidation } from '../runtimeSupport/utils/isDebugStopsInvalidation'

// Value: protects=the reader knowing that the editor is about to handle a session's stops again, which opens the paused file with the keyboard without a new stopped event: an invalidated event for threads, stacks or everything says it, and one without areas stands for everything; fails_when=the event is not read (the frame that follows counts as one the learner selected, and a pane that covers the file comes without the keyboard), or an invalidated event for variables counts (a refresh of the Variables view would be noted as a stop, and the next frame the learner selects taken for it); why_new=Cycle 0046 row 273 (delegated review, finding 6, case c); seam=none
test("an adapter's invalidated event for threads, stacks or everything makes the editor handle the session's stops again: one for variables, other events, requests and what is no message do not", () => {
  // Arrange: what a tracker receives from an adapter.
  const messages: unknown[] = [
    { type: 'event', event: 'invalidated', body: { areas: ['stacks'] } },
    { type: 'event', event: 'invalidated', body: { areas: ['threads'] } },
    { type: 'event', event: 'invalidated', body: { areas: ['all'] } },
    { type: 'event', event: 'invalidated', body: {} },
    { type: 'event', event: 'invalidated' },
    {
      type: 'event',
      event: 'invalidated',
      body: { areas: ['variables', 'stacks'] },
    },
    { type: 'event', event: 'invalidated', body: { areas: ['variables'] } },
    { type: 'event', event: 'stopped', body: { reason: 'breakpoint' } },
    { type: 'request', command: 'stackTrace' },
    'invalidated',
    undefined,
  ]

  // Act
  const answers = messages.map((message) => isDebugStopsInvalidation(message))

  // Assert
  assert.deepEqual(answers, [
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
