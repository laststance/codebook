import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StopKeyboardHandOver } from '../runtimeSupport/stopKeyboardHandOver'

// Value: protects=the paused file's hand-over right after the adapter reports a stop; fails_when=a reported stop is not armed, so the file the editor opens next never gets the keyboard; why_new=Cycle 0046 finding 589
test('a reported stop waits for its hand-over', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()

  // Act
  handOver.arm('live-next-browser')

  // Assert
  assert.deepEqual(
    [
      handOver.isArmedFor('live-next-browser'),
      handOver.isHeldFor('live-next-browser'),
    ],
    [true, true],
  )
})

// Value: protects=one hand-over per stop and the captured source's hold after it; fails_when=a handed-over stop stays armed (a second hand-over) or stops being held (the captured source covers the file again); why_new=Cycle 0046 decision R7
test('a handed-over stop is done and still held', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('live-next-browser')

  // Act
  handOver.markDone('live-next-browser')

  // Assert
  assert.deepEqual(
    [
      handOver.isArmedFor('live-next-browser'),
      handOver.isHeldFor('live-next-browser'),
      handOver.isDoneFor('live-next-browser'),
    ],
    [false, true, true],
  )
})

// Value: protects=one hand-over per stop when the editor handles the same stop again; fails_when=an invalidation of a handed-over stop arms it again and the keyboard is handed over a second time; why_new=Cycle 0046 decision R7 (frames 1313, 1314 and 1372 of one stop in the C54 9f round)
test('the same session stopping again without going on stays done', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('live-next-browser')
  handOver.markDone('live-next-browser')

  // Act
  handOver.arm('live-next-browser')

  // Assert
  assert.equal(handOver.isDoneFor('live-next-browser'), true)
})

// Value: protects=the hand-over of a stop of another session after a handed-over one; fails_when=the earlier session's done stop blocks the new session's hand-over; why_new=Cycle 0046 decision R7 (one hand-over per stop, not per reader)
test('another session’s stop after a handed-over one waits for its own hand-over', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node')
  handOver.markDone('learner-node')

  // Act
  handOver.arm('live-next-browser')

  // Assert
  assert.equal(handOver.isArmedFor('live-next-browser'), true)
})

// Value: protects=the keyboard of a learner's handed-over file while a Codebook run's stop of another session is read; fails_when=the record keeps one stop for the reader, so the other session's stop replaces the handed-over one and the keyboard model forgets that the learner's file holds the keyboard; why_new=Cycle 0046 finding 605
test('another session’s stop leaves a handed-over stop done', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node')
  handOver.markDone('learner-node')

  // Act
  handOver.arm('live-next-browser')

  // Assert
  assert.deepEqual(
    [handOver.isDoneFor('learner-node'), handOver.isHeldFor('learner-node')],
    [true, true],
  )
})

// Value: protects=the hand-over of a stop that waits while another session's stop is read and handed over; fails_when=handing over one session's stop ends the waiting of another session's stop, so the editor's later report of that stop's frame gives its paused file no keyboard; why_new=Cycle 0046 finding 605
test('a stop waits for its own hand-over while another session’s stop is handed over', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node')
  handOver.arm('live-next-browser')

  // Act
  handOver.markDone('live-next-browser')

  // Assert
  assert.deepEqual(
    [
      handOver.isArmedFor('learner-node'),
      handOver.isDoneFor('live-next-browser'),
    ],
    [true, true],
  )
})

// Value: protects=the next stop's hand-over after the session went on; fails_when=a resumed session keeps its done stop, so a refresh or a learner's next step never gets the keyboard; why_new=Cycle 0046 finding 589, C54 round 9f (continued, then stopped)
test('a session that goes on ends its stop', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('live-next-browser')
  handOver.markDone('live-next-browser')

  // Act
  handOver.disarm('live-next-browser')

  // Assert
  assert.deepEqual(
    [
      handOver.isHeldFor('live-next-browser'),
      handOver.isDoneFor('live-next-browser'),
    ],
    [false, false],
  )
})

// Value: protects=the stop the reader holds while another session runs; fails_when=another session going on ends the held stop, so its file loses the captured source's hold; why_new=Cycle 0046 decision R7 (browser and server sessions of one run)
test('another session going on leaves the held stop', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('live-next-browser')

  // Act
  handOver.disarm('live-next-server')

  // Assert
  assert.equal(handOver.isArmedFor('live-next-browser'), true)
})

// Value: protects=the keyboard at a stop whose adapter asked the editor to keep the focus where it is, which neither editor focuses; fails_when=such a stop waits for a hand-over, so the frame the editor's pass of the focus or the learner's click brings within half a second gives the file it opened preserving the focus the keyboard; why_new=Cycle 0046 finding 604
test('a stop whose adapter asked to keep the focus does not wait for a hand-over', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()

  // Act
  handOver.arm('learner-node', { keepsFocus: true })

  // Assert
  assert.deepEqual(
    [handOver.isArmedFor('learner-node'), handOver.isHeldFor('learner-node')],
    [false, false],
  )
})

// Value: protects=the hand-over state of a session's earlier stop when another thread of it stops with the adapter's preserveFocusHint; fails_when=that stop ends the earlier stop's waiting or handed-over state, so its file loses the keyboard model's hold or its hand-over; why_new=Cycle 0046 finding 604 (such a stop leaves the record as it was)
test('a stop whose adapter asked to keep the focus leaves the session’s handed-over stop as it was', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node')
  handOver.markDone('learner-node')

  // Act
  handOver.arm('learner-node', { keepsFocus: true })

  // Assert
  assert.equal(handOver.isDoneFor('learner-node'), true)
})

// Value: protects=the keyboard at the frame of one session while another session's stop waits for its hand-over; fails_when=the frame of a session whose stop does not wait is taken for the waiting stop's frame, and its active text editor gets the keyboard; why_new=Cycle 0046 finding 603 (the hand-over is resolved at the stop's own frame)
test('a waiting stop is waiting only for the frame of its own session', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()

  // Act
  handOver.arm('learner-node')

  // Assert
  assert.equal(handOver.isArmedFor('live-next-browser'), false)
})

// Value: protects=the reader before any stop; fails_when=marking with no stop armed invents a handed-over stop that the keyboard model then trusts; why_new=Cycle 0046 decision R7
test('marking with no stop armed hands nothing over', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()

  // Act
  handOver.markDone('live-next-browser')

  // Assert
  assert.deepEqual(
    [
      handOver.isHeldFor('live-next-browser'),
      handOver.isDoneFor('live-next-browser'),
    ],
    [false, false],
  )
})

// Value: protects=the hand-over at the frame the editor focuses for a stop whose top frame it skips: the editor loads the top frame first and the next 19 later, and focuses the first that its rule lets it, so the reader must place the later page below the top frame; fails_when=an answer is placed at the wrong index or a later page is dropped, so the editor's report of that frame gets no keyboard; why_new=Cycle 0046, the limit left by finding 603 (refreshTopOfCallstack: fetchCallStack(1), then fetchCallStack(19) 420 ms later)
test('the frame the editor focuses is read from the answers to its stackTrace requests, a later page below the top frame', () => {
  // Arrange: an exception whose top frame is in skipped code.
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node', { threadId: 1, reason: 'exception' })
  handOver.readEditorsMessage('learner-node', {
    type: 'request',
    seq: 21,
    command: 'stackTrace',
    arguments: { threadId: 1, startFrame: 0, levels: 1 },
  })
  handOver.readAdaptersMessage('learner-node', {
    type: 'response',
    request_seq: 21,
    success: true,
    command: 'stackTrace',
    body: {
      stackFrames: [
        {
          id: 1,
          presentationHint: 'deemphasize',
          source: { path: '<node_internals>/fs', sourceReference: 5 },
        },
      ],
    },
  })
  const beforeTheRest = handOver.pausedFrameIdOf('learner-node')

  // Act: the editor asks for the next 19 frames, and the adapter answers the learner's caller.
  handOver.readEditorsMessage('learner-node', {
    type: 'request',
    seq: 22,
    command: 'stackTrace',
    arguments: { threadId: 1, startFrame: 1, levels: 19 },
  })
  handOver.readAdaptersMessage('learner-node', {
    type: 'response',
    request_seq: 22,
    success: true,
    command: 'stackTrace',
    body: {
      stackFrames: [
        {
          id: 2,
          presentationHint: 'normal',
          source: { path: '/app/actions.ts' },
        },
      ],
    },
  })

  // Assert: no frame qualified before the rest of the stack; then the caller does.
  assert.deepEqual(
    [beforeTheRest, handOver.pausedFrameIdOf('learner-node')],
    [undefined, 2],
  )
})

// Value: protects=the frame the editor focuses for a stop: only the editor's answered requests for the stopped thread tell it; fails_when=an answer for another thread, or one the reader saw no request for, is read as the stopped thread's frames, so the reader picks a frame the editor never focuses for the stop; why_new=Cycle 0046, the limit left by finding 603
test('answers for another thread or for an unknown request do not name the frame the editor focuses', () => {
  // Arrange: a stop of thread 1.
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node', { threadId: 1, reason: 'breakpoint' })

  // Act: the editor asks for thread 2's frames and the adapter answers it, and an answer comes for a request the reader never saw.
  handOver.readEditorsMessage('learner-node', {
    type: 'request',
    seq: 31,
    command: 'stackTrace',
    arguments: { threadId: 2, startFrame: 0, levels: 1 },
  })
  for (const requestSeq of [31, 32])
    handOver.readAdaptersMessage('learner-node', {
      type: 'response',
      request_seq: requestSeq,
      success: true,
      command: 'stackTrace',
      body: {
        stackFrames: [{ id: requestSeq, source: { path: '/app/a.ts' } }],
      },
    })

  // Assert
  assert.equal(handOver.pausedFrameIdOf('learner-node'), undefined)
})

// Value: protects=the keyboard later in a pause whose frame the editor reported without a hand-over, and the hand-over of a stop that was given; fails_when=a reported frame leaves a waiting stop armed, so a file the learner opens later in that pause is handed the keyboard, or it ends a handed-over stop, so its file loses the keyboard model's hold; why_new=Cycle 0046 finding 603 (the stop's hand-over is resolved at its frame in every case)
test('a reported frame settles a waiting stop and leaves a handed-over stop done', () => {
  // Arrange: a waiting stop of one session, and a handed-over stop of another.
  const handOver = new StopKeyboardHandOver()
  handOver.arm('learner-node')
  handOver.arm('live-next-browser')
  handOver.markDone('live-next-browser')

  // Act
  handOver.settle('learner-node')
  handOver.settle('live-next-browser')
  handOver.settle(undefined)

  // Assert
  assert.deepEqual(
    [
      handOver.isHeldFor('learner-node'),
      handOver.isDoneFor('live-next-browser'),
    ],
    [false, true],
  )
})
