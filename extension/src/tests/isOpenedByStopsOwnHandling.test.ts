import assert from 'node:assert/strict'
import { test } from 'node:test'

import type * as vscode from 'vscode'

import { isOpenedByStopsOwnHandling } from '../runtimeSupport/utils/isOpenedByStopsOwnHandling'

/** Stands for the debug session of a Codebook run's browser; only its identity is read. */
const browserSession = {
  id: 'live-next-browser',
} as unknown as vscode.DebugSession
/** Stands for the learner's own debug session; only its identity is read. */
const learnerSession = { id: 'learner-node' } as unknown as vscode.DebugSession

// Value: protects=the keyboard at a learner's stop that the editor's own handling shows, the order both editors report it in (the paused file's opening, then the frame); fails_when=the hand-over waits for a frame that has not come yet and the paused file stays without the keyboard (BODY); why_new=Cycle 0046 finding 602; seam=none
test('a paused file that becomes active before the frame of a stop its own handling shows is that stop’s file', () => {
  // Arrange: the browser's frame is still the active item, and the learner's stop is judged shown now.
  const state = {
    stopSessionId: 'learner-node',
    unreportedStopShown: true,
    activeStackItem: { session: browserSession, threadId: 1, frameId: 3 },
    frameCameWithStop: true,
  }

  // Act
  const opened = isOpenedByStopsOwnHandling(state)

  // Assert
  assert.equal(opened, true)
})

// Value: protects=the Call Stack list's keyboard at a single click on the frame of a learner's stop the editor kept behind a paused Codebook run's frame; fails_when=the file that click opens preserving the focus is taken for that stop's paused file and given the keyboard; why_new=Cycle 0046 finding 602; seam=none
test('a file that becomes active before the frame of a stop kept in the background is not that stop’s file', () => {
  // Arrange: the browser's frame came with its own stop, and the learner's stop is judged kept behind it.
  const state = {
    stopSessionId: 'learner-node',
    unreportedStopShown: false,
    activeStackItem: { session: browserSession, threadId: 1, frameId: 3 },
    frameCameWithStop: true,
  }

  // Act
  const opened = isOpenedByStopsOwnHandling(state)

  // Assert
  assert.equal(opened, false)
})

// Value: protects=the keyboard at a learner's stop the editor shows when the extension host receives the frame before the paused file's opening; fails_when=the hand-over only accepts the file-then-frame order and the paused file stays without the keyboard; why_new=Cycle 0046 finding 602 (the hand-over must not depend on the order of the two reports); seam=none
test('a paused file that becomes active after the frame its stop brought is that stop’s file', () => {
  // Arrange: the learner's stop frame was reported first and came with its stop.
  const state = {
    stopSessionId: 'learner-node',
    unreportedStopShown: undefined,
    activeStackItem: { session: learnerSession, threadId: 1, frameId: 8 },
    frameCameWithStop: true,
  }

  // Act
  const opened = isOpenedByStopsOwnHandling(state)

  // Assert
  assert.equal(opened, true)
})

// Value: protects=the Call Stack list's keyboard when the frame of a learner's click arrives before the file it opens; fails_when=the hand-over takes a frame the learner selected for one its stop brought and gives the file the keyboard; why_new=Cycle 0046 finding 602; seam=none
test('a file that becomes active after a frame the learner selected is not the stop’s file', () => {
  // Arrange: the learner's frame was reported first, without its stop.
  const state = {
    stopSessionId: 'learner-node',
    unreportedStopShown: undefined,
    activeStackItem: { session: learnerSession, threadId: 1, frameId: 8 },
    frameCameWithStop: false,
  }

  // Act
  const opened = isOpenedByStopsOwnHandling(state)

  // Assert
  assert.equal(opened, false)
})

// Value: protects=the keyboard while another session's frame or a running thread is shown; fails_when=a frame that came with another session's stop, or a thread, lets the waiting stop's hand-over take a file that its own handling never opened; why_new=Cycle 0046 finding 602; seam=none
test('a file that becomes active while another session’s frame or a thread is shown is not the stop’s file', () => {
  // Arrange: the waiting stop's frame was reported already; the editor now shows the browser's frame, then the browser's running thread.
  const items = [
    { session: browserSession, threadId: 1, frameId: 3 },
    { session: learnerSession, threadId: 1 },
  ]

  // Act
  const opened = items.map((activeStackItem) =>
    isOpenedByStopsOwnHandling({
      stopSessionId: 'learner-node',
      unreportedStopShown: undefined,
      activeStackItem,
      frameCameWithStop: true,
    }),
  )

  // Assert
  assert.deepEqual(opened, [false, false])
})
