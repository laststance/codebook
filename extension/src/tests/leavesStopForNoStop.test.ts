import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RecordingFrame } from '../recordingSchemas'
import { leavesStopForNoStop } from '../utils/leavesStopForNoStop'

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

// Value: protects=the recorded image staying on screen when Play reaches the end of a stop's pause, on the stop's own frame and on the newer frame the application sent right after it; fails_when=the end of a pause is not recognized, or only on an unchanged frame, so the Application pane blanks to its loading state (native checks F18 on candidates 19 and 20: 17 to 35 dark frames at 153.24 and 183.56 s); why_new=Cycle 0045 NF-13c, widened by NF-13d; seam=none
test('the end of a stop’s pause keeps the recorded image on the same frame and on a newer frame', () => {
  // Arrange
  const stopOnScreen = {
    frame: recordedFrame('frame-a'),
    observation: recordedStop('browser-session:1'),
  }

  // Act
  const keepsImage = [
    leavesStopForNoStop(stopOnScreen, {
      frame: recordedFrame('frame-a'),
      observation: undefined,
    }),
    leavesStopForNoStop(stopOnScreen, {
      frame: recordedFrame('frame-b'),
      observation: undefined,
    }),
  ]

  // Assert
  assert.deepEqual(keepsImage, [true, true])
})

// Value: protects=the previous image never kept beside a moment without a recorded frame, beside a stop that has not been presented yet, or before the first moment; fails_when=the kept image extends to a recorded gap, a stop entry, a change of stop or a first moment; why_new=Cycle 0045 NF-13c and NF-13d keep the image only where a stop ends with a recorded frame on both sides; seam=none
test('a recorded gap on either side, a stop entry, a change of stop or a first moment clear the recorded image', () => {
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
    leavesStopForNoStop(stopOnScreen, {
      frame: undefined,
      observation: undefined,
    }),
    leavesStopForNoStop(
      { frame: undefined, observation: recordedStop('browser-session:1') },
      noStopOnScreen,
    ),
    leavesStopForNoStop(noStopOnScreen, {
      frame: recordedFrame('frame-a'),
      observation: recordedStop('browser-session:1'),
    }),
    leavesStopForNoStop(stopOnScreen, {
      frame: recordedFrame('frame-b'),
      observation: recordedStop('browser-session:2'),
    }),
    leavesStopForNoStop(undefined, noStopOnScreen),
  ]

  // Assert
  assert.deepEqual(keepsImage, [false, false, false, false, false])
})
