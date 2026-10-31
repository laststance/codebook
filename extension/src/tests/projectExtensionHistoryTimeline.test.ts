import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  ExtensionReplayEvent,
  ExtensionReplayModel,
  ExtensionReplayPause,
} from '../utils/buildExtensionReplayModel'
import { projectExtensionHistoryTimeline } from '../utils/projectExtensionHistoryTimeline'

/** A recorded pause that opened at `openMs`; `closeMs` is left out for a pause the history never saw close. */
function pause(
  pauseId: string,
  openMs: number,
  closeMs: number | undefined,
  hasSource = true,
): ExtensionReplayPause {
  return {
    pauseId,
    stopIndex: 1,
    context: 'page',
    openSequence: 1,
    openMs,
    ...(closeMs === undefined ? {} : { closeSequence: 2, closeMs }),
    path: 'popup.js',
    line: 2,
    hasSnapshot: hasSource,
    hasSource,
  }
}

/** The part of a replay model the timeline reads: a run from 0 to `endedAtMs` with the given pauses. */
function modelOf(
  endedAtMs: number,
  pauses: ExtensionReplayPause[],
): Pick<ExtensionReplayModel, 'events' | 'pauses' | 'endedAtMs'> {
  const first: ExtensionReplayEvent = {
    sequence: 1,
    timeMs: 0,
    type: 'frame',
  }
  return {
    events: [first],
    pauses: new Map(pauses.map((entry) => [entry.pauseId, entry])),
    endedAtMs,
  }
}

// protects=a pause from 100 ms to 200 ms in a run to 400 ms leaves exactly the spans before and after it unrecorded and ticks its open; fails_when=the whole range is one gap or the pause's span is not recorded; no_claim=the slider's drawing
test('a recorded pause marks only its own span as recorded on the timeline', () => {
  // Arrange
  const model = modelOf(400, [pause('a', 100, 200)])

  // Act
  const timeline = projectExtensionHistoryTimeline(model)

  // Assert
  assert.deepEqual(timeline, {
    startMs: 0,
    endMs: 400,
    gaps: [
      { startMs: 0, endMs: 100 },
      { startMs: 200, endMs: 400 },
    ],
    recordedPoints: [100],
  })
})

// protects=a pause opened inside another is one recorded span, a pause the history never saw close stays recorded to the end, and a stop whose source is not recorded stays unrecorded and unticked; fails_when=a nested pause splits the outer span, an unclosed pause ends at its open, or an unverified stop counts as recorded; no_claim=the slider's drawing
test('nested pauses merge, an unclosed pause lasts to the end and a stop without source stays a gap', () => {
  // Arrange
  const model = modelOf(1_000, [
    pause('outer', 100, 500),
    pause('inner', 200, 300),
    pause('unclosed', 800, undefined),
    pause('no-source', 600, 700, false),
  ])

  // Act
  const timeline = projectExtensionHistoryTimeline(model)

  // Assert
  assert.deepEqual(timeline, {
    startMs: 0,
    endMs: 1_000,
    gaps: [
      { startMs: 0, endMs: 100 },
      { startMs: 500, endMs: 800 },
    ],
    recordedPoints: [100, 200, 800],
  })
})
