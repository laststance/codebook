import assert from 'node:assert/strict'
import { test } from 'node:test'

import { leavesStopOnSameFrame } from '../utils/leavesStopOnSameFrame'

// Value: protects=the recorded image staying on screen when Play reaches the end of a stop's pause and the frame is unchanged; fails_when=the end of a pause on the same frame is not recognized, so the Application pane blanks to its loading state (native check F18); why_new=Cycle 0045 NF-13c; seam=none
test('the end of a stop’s pause on the frame already on screen keeps the recorded image', () => {
  // Arrange
  const stopOnScreen = {
    frame: { hash: 'frame-a' },
    observation: { id: 'browser-session:1' },
  }
  const momentAfterThePause = { frame: { hash: 'frame-a' } }

  // Act
  const keepsImage = leavesStopOnSameFrame(stopOnScreen, momentAfterThePause)

  // Assert
  assert.equal(keepsImage, true)
})

// Value: protects=the previous image never shown beside a moment whose recording differs, nor beside a stop that has not been presented yet; fails_when=the kept image extends to a new frame, a recorded gap, a stop entry or a change of stop; why_new=Cycle 0045 NF-13c keeps the image only at the end of a stop on the same frame; seam=none
test('a new frame, a recorded gap, a stop entry, a change of stop or a first moment clear the recorded image', () => {
  // Arrange
  const stopOnScreen = {
    frame: { hash: 'frame-a' },
    observation: { id: 'browser-session:1' },
  }
  const noStopOnScreen = { frame: { hash: 'frame-a' } }

  // Act
  const keepsImage = [
    leavesStopOnSameFrame(stopOnScreen, { frame: { hash: 'frame-b' } }),
    leavesStopOnSameFrame(stopOnScreen, {}),
    leavesStopOnSameFrame(
      { observation: { id: 'browser-session:1' } },
      noStopOnScreen,
    ),
    leavesStopOnSameFrame(noStopOnScreen, {
      frame: { hash: 'frame-a' },
      observation: { id: 'browser-session:1' },
    }),
    leavesStopOnSameFrame(stopOnScreen, {
      frame: { hash: 'frame-a' },
      observation: { id: 'browser-session:2' },
    }),
    leavesStopOnSameFrame(undefined, noStopOnScreen),
  ]

  // Assert
  assert.deepEqual(keepsImage, [false, false, false, false, false, false])
})
