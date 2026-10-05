import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RecordingFrame } from '../recordingSchemas'
import { leavesStopOnSameFrame } from '../utils/leavesStopOnSameFrame'

import { createConfiguredStudy } from './utils/createConfiguredStudy'

/** Builds a recorded stream frame with the given hash, as {@link projectRecording} selects it. @example recordedFrame('frame-a').hash // => 'frame-a' */
function recordedFrame(hash: string): RecordingFrame {
  return {
    type: 'frame',
    sequence: 1,
    elapsedMs: 100,
    hash,
    byteLength: 10,
    width: 1,
    height: 1,
    kind: 'stream',
  }
}

/** Builds a projected stop with the given id and no explanation shown, as {@link projectRecording} selects it. @example recordedStop('browser-session:1').id // => 'browser-session:1' */
function recordedStop(id: string) {
  return {
    ...createConfiguredStudy().observations[0]!,
    id,
    snapshotUri: `codebook://instance/runs/run/snapshots/${encodeURIComponent(id)}`,
    elapsedMs: 100,
    interpretations: [],
  }
}

// Value: protects=the recorded image staying on screen when Play reaches the end of a stop's pause and the frame is unchanged; fails_when=the end of a pause on the same frame is not recognized, so the Application pane blanks to its loading state (native check F18); why_new=Cycle 0045 NF-13c; seam=none
test('the end of a stop’s pause on the frame already on screen keeps the recorded image', () => {
  // Arrange
  const stopOnScreen = {
    frame: recordedFrame('frame-a'),
    observation: recordedStop('browser-session:1'),
  }
  const momentAfterThePause = {
    frame: recordedFrame('frame-a'),
    observation: undefined,
  }

  // Act
  const keepsImage = leavesStopOnSameFrame(stopOnScreen, momentAfterThePause)

  // Assert
  assert.equal(keepsImage, true)
})

// Value: protects=the previous image never shown beside a moment whose recording differs, nor beside a stop that has not been presented yet; fails_when=the kept image extends to a new frame, a recorded gap, a stop entry or a change of stop; why_new=Cycle 0045 NF-13c keeps the image only at the end of a stop on the same frame; seam=none
test('a new frame, a recorded gap, a stop entry, a change of stop or a first moment clear the recorded image', () => {
  // Arrange
  const stopOnScreen = {
    frame: recordedFrame('frame-a'),
    observation: recordedStop('browser-session:1'),
  }
  const noStopOnScreen = {
    frame: recordedFrame('frame-a'),
    observation: undefined,
  }

  // Act
  const keepsImage = [
    leavesStopOnSameFrame(stopOnScreen, {
      frame: recordedFrame('frame-b'),
      observation: undefined,
    }),
    leavesStopOnSameFrame(stopOnScreen, {
      frame: undefined,
      observation: undefined,
    }),
    leavesStopOnSameFrame(
      { frame: undefined, observation: recordedStop('browser-session:1') },
      noStopOnScreen,
    ),
    leavesStopOnSameFrame(noStopOnScreen, {
      frame: recordedFrame('frame-a'),
      observation: recordedStop('browser-session:1'),
    }),
    leavesStopOnSameFrame(stopOnScreen, {
      frame: recordedFrame('frame-a'),
      observation: recordedStop('browser-session:2'),
    }),
    leavesStopOnSameFrame(undefined, noStopOnScreen),
  ]

  // Assert
  assert.deepEqual(keepsImage, [false, false, false, false, false, false])
})
