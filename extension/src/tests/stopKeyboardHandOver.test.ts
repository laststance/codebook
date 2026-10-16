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
    [handOver.armedSessionId(), handOver.heldSessionId()],
    ['live-next-browser', 'live-next-browser'],
  )
})

// Value: protects=one hand-over per stop and the captured source's hold after it; fails_when=a handed-over stop stays armed (a second hand-over) or stops being held (the captured source covers the file again); why_new=Cycle 0046 decision R7
test('a handed-over stop is done and still held', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('live-next-browser')

  // Act
  handOver.markDone()

  // Assert
  assert.deepEqual(
    [
      handOver.armedSessionId(),
      handOver.heldSessionId(),
      handOver.isDoneFor('live-next-browser'),
    ],
    [undefined, 'live-next-browser', true],
  )
})

// Value: protects=one hand-over per stop when the editor handles the same stop again; fails_when=an invalidation of a handed-over stop arms it again and the keyboard is handed over a second time; why_new=Cycle 0046 decision R7 (frames 1313, 1314 and 1372 of one stop in the C54 9f round)
test('the same session stopping again without going on stays done', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('live-next-browser')
  handOver.markDone()

  // Act
  handOver.arm('live-next-browser')

  // Assert
  assert.equal(handOver.isDoneFor('live-next-browser'), true)
})

// Value: protects=the hand-over of a stop of another session after a handed-over one; fails_when=the earlier session's done stop blocks the new session's hand-over; why_new=Cycle 0046 decision R7 (one hand-over per stop, not per reader)
test('another session’s stop after a handed-over one waits for its own hand-over', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('live-next-browser')
  handOver.markDone()

  // Act
  handOver.arm('live-next-server')

  // Assert
  assert.equal(handOver.armedSessionId(), 'live-next-server')
})

// Value: protects=the next stop's hand-over after the session went on; fails_when=a resumed session keeps its done stop, so a refresh or a learner's next step never gets the keyboard; why_new=Cycle 0046 finding 589, C54 round 9f (continued, then stopped)
test('a session that goes on ends its stop', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()
  handOver.arm('live-next-browser')
  handOver.markDone()

  // Act
  handOver.disarm('live-next-browser')

  // Assert
  assert.deepEqual(
    [handOver.heldSessionId(), handOver.isDoneFor('live-next-browser')],
    [undefined, false],
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
  assert.equal(handOver.armedSessionId(), 'live-next-browser')
})

// Value: protects=the reader before any stop; fails_when=marking with no stop armed invents a handed-over stop that the keyboard model then trusts; why_new=Cycle 0046 decision R7
test('marking with no stop armed hands nothing over', () => {
  // Arrange
  const handOver = new StopKeyboardHandOver()

  // Act
  handOver.markDone()

  // Assert
  assert.deepEqual(
    [handOver.heldSessionId(), handOver.isDoneFor('live-next-browser')],
    [undefined, false],
  )
})
