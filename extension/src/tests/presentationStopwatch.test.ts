import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PresentationStopwatch } from '../studyWorkspace/presentationStopwatch'

// protects=Cycle 0137 C1-E: each presentation step is timed from the end of the step before it, in whole milliseconds, and the total counts from the stopwatch's start, so the playback timing journal can say which step holds the playhead; fails_when=a lap counts from the start instead of the previous lap, keeps fractions, or the total misses the steps before the last lap; no_claim=performance.now() itself (a test clock stands in for it)
test('a presentation stopwatch times each step from the end of the previous one and its total from its start', () => {
  // Arrange
  const readings = [1000, 1003.4, 1064.6, 1365.2]
  const watch = new PresentationStopwatch(() => readings.shift()!)

  // Act
  watch.lap('retire')
  watch.lap('source')
  const totalMs = watch.totalMs()

  // Assert
  assert.deepEqual(watch.laps, { retire: 3, source: 61 })
  assert.equal(totalMs, 365)
})
