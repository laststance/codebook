import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StoredDebugStops } from '../runtimeSupport/storedDebugStops'

const thread1Stop = { reason: 'breakpoint', keepsFocus: true, threadId: 1 }
const thread2Stop = { reason: 'step', keepsFocus: false, threadId: 2 }

// Value: protects=the stop an invalidated stack makes the editor handle again: the latest stop a session's adapter reported among those still stored; fails_when=the store keeps the first stop of a thread, or of the session, so an invalidation is noted with an older stop's hint and reason; why_new=Cycle 0046 AD12 (the editors keep a stop's details per thread); seam=none, the store alone
test('the latest stored stop of a session is the one its adapter reported last', () => {
  // Arrange
  const stops = new StoredDebugStops()

  // Act
  stops.noteStop('learner-node', thread1Stop)
  stops.noteStop('learner-node', thread2Stop)
  stops.noteStop('learner-node', { ...thread1Stop, reason: 'step' })

  // Assert
  assert.deepEqual(stops.lastStopOf('learner-node'), {
    reason: 'step',
    keepsFocus: true,
    threadId: 1,
  })
})

// Value: protects=the stored stop of a thread that is still stopped when the adapter says that another thread goes on by itself (allThreadsContinued false); fails_when=a continued event for one thread drops every stop of the session, so a later invalidation is noted without the stopped thread's hint; why_new=Cycle 0046 AD12 (VS Code 1.142.0 and Cursor 3.23.23 onDidContinued filter only that thread's details); seam=none
test('a continued event for one thread drops only that thread’s stop when the adapter says not all threads go on', () => {
  // Arrange
  const stops = new StoredDebugStops()
  stops.noteStop('learner-node', thread1Stop)
  stops.noteStop('learner-node', thread2Stop)

  // Act
  stops.readAdaptersMessage('learner-node', {
    type: 'event',
    event: 'continued',
    body: { threadId: 2, allThreadsContinued: false },
  })

  // Assert
  assert.deepEqual(stops.lastStopOf('learner-node'), thread1Stop)
})

// Value: protects=the rule that a continued event without allThreadsContinued false ends every stop of the session, as both editors read it; fails_when=the store reads a continued event without that word as one thread's only, and keeps the other threads' stops the editor dropped; why_new=Cycle 0046 AD12 (the editors' `allThreadsContinued !== false`); seam=none
test('a continued event that does not say not all threads go on drops every stop of the session', () => {
  // Arrange
  const stops = new StoredDebugStops()
  stops.noteStop('learner-node', thread1Stop)
  stops.noteStop('learner-node', thread2Stop)

  // Act
  stops.readAdaptersMessage('learner-node', {
    type: 'event',
    event: 'continued',
    body: { threadId: 2 },
  })

  // Assert
  assert.equal(stops.lastStopOf('learner-node'), undefined)
})

// Value: protects=the stop of a thread whose step the adapter refused: the editors simulate no continued then and keep its details; fails_when=the store drops a stop at the editor's request, before the adapter's answer, so a refused step loses the stopped thread's hint; why_new=Cycle 0046 AD12 (RawDebugSession fires its simulated continued only after a granted request); seam=none
test('a step the adapter refuses drops no stop, and a granted one drops its thread’s', () => {
  // Arrange: thread 2 stopped, then thread 1; the editor asks thread 1 to step over, and later to step in.
  const stops = new StoredDebugStops()
  stops.noteStop('learner-node', thread2Stop)
  stops.noteStop('learner-node', thread1Stop)
  stops.readEditorsMessage('learner-node', {
    type: 'request',
    seq: 5,
    command: 'next',
    arguments: { threadId: 1 },
  })

  // Act: the adapter refuses the next; then the editor's stepIn of the same thread is granted.
  stops.readAdaptersMessage('learner-node', {
    type: 'response',
    seq: 6,
    request_seq: 5,
    success: false,
    command: 'next',
    message: 'Cannot step.',
  })
  const afterRefusal = stops.lastStopOf('learner-node')
  stops.readEditorsMessage('learner-node', {
    type: 'request',
    seq: 7,
    command: 'stepIn',
    arguments: { threadId: 1 },
  })
  stops.readAdaptersMessage('learner-node', {
    type: 'response',
    seq: 8,
    request_seq: 7,
    success: true,
    command: 'stepIn',
  })

  // Assert: the refusal kept thread 1's stop; the granted step dropped it and kept thread 2's.
  assert.deepEqual(
    { afterRefusal, afterGrant: stops.lastStopOf('learner-node') },
    { afterRefusal: thread1Stop, afterGrant: thread2Stop },
  )
})

// Value: protects=the editors' remembered word on all threads at a granted continue: every stop of the session ends at first, and only one thread's once the adapter said that not all threads go on; fails_when=the store reads every granted continue as all threads', or as one thread's, against what the adapter said; why_new=Cycle 0046 AD12 (RawDebugSession's allThreadsContinued, true at first, set by the continue answer and the continued event); seam=none
test('a granted continue drops every stop of the session until the adapter says not all threads go on', () => {
  // Arrange
  const stops = new StoredDebugStops()
  const continueThread = (seq: number, body: object): void => {
    stops.readEditorsMessage('learner-node', {
      type: 'request',
      seq,
      command: 'continue',
      arguments: { threadId: 2 },
    })
    stops.readAdaptersMessage('learner-node', {
      type: 'response',
      seq: seq + 1,
      request_seq: seq,
      success: true,
      command: 'continue',
      body,
    })
  }
  stops.noteStop('learner-node', thread1Stop)
  stops.noteStop('learner-node', thread2Stop)

  // Act: a continue whose answer says nothing, then, after the threads stopped again, one whose answer says not all threads go on, then one whose answer says nothing again.
  continueThread(1, {})
  const afterFirst = stops.lastStopOf('learner-node')
  stops.noteStop('learner-node', thread1Stop)
  stops.noteStop('learner-node', thread2Stop)
  continueThread(3, { allThreadsContinued: false })
  const afterSecond = stops.lastStopOf('learner-node')
  stops.noteStop('learner-node', thread2Stop)
  continueThread(5, {})

  // Assert
  assert.deepEqual(
    { afterFirst, afterSecond, afterThird: stops.lastStopOf('learner-node') },
    {
      afterFirst: undefined,
      afterSecond: thread1Stop,
      afterThird: thread1Stop,
    },
  )
})

// Value: protects=a stop that came after the editor's step request and before the adapter's answer: the editors simulate no continued for that answer, so the new stop stays stored; fails_when=the late answer drops the new stop, and an invalidation of it is noted without its hint; why_new=Cycle 0046 AD12 (RawDebugSession's stoppedSinceLastStep); seam=none
test('an answer to a step that comes after a new stop of the session drops nothing', () => {
  // Arrange
  const stops = new StoredDebugStops()
  stops.noteStop('learner-node', thread1Stop)
  stops.readEditorsMessage('learner-node', {
    type: 'request',
    seq: 9,
    command: 'next',
    arguments: { threadId: 1 },
  })
  stops.noteStop('learner-node', { ...thread1Stop, reason: 'step' })

  // Act
  stops.readAdaptersMessage('learner-node', {
    type: 'response',
    seq: 10,
    request_seq: 9,
    success: true,
    command: 'next',
  })

  // Assert
  assert.deepEqual(stops.lastStopOf('learner-node'), {
    ...thread1Stop,
    reason: 'step',
  })
})

// Value: protects=the store's size and the next session of the same id: a session that ended keeps nothing, and other sessions keep theirs; fails_when=forget leaves a session's stops or pending requests behind, so a new session of that id finds an old stop; why_new=Cycle 0046 AD12; seam=none
test('a forgotten session keeps no stop, and another session keeps its own', () => {
  // Arrange
  const stops = new StoredDebugStops()
  stops.noteStop('learner-node', thread1Stop)
  stops.noteStop('live-next-browser', thread2Stop)

  // Act
  stops.forget('learner-node')

  // Assert
  assert.deepEqual(
    {
      forgotten: stops.lastStopOf('learner-node'),
      other: stops.lastStopOf('live-next-browser'),
    },
    { forgotten: undefined, other: thread2Stop },
  )
})
