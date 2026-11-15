import assert from 'node:assert/strict'
import { test } from 'node:test'

import { presentedInHistoryGap } from '../utils/presentedInHistoryGap'

// Value: protects=the Study status naming an unrecorded end when Play or a seek lands exactly on the recording's end inside a gap that runs to the end; fails_when=the end instant is outside every half-open gap, so the status omits "Not recorded at this moment"; no_claim=how the status text is drawn
test('the recording end inside a gap that runs to the end is in the gap', () => {
  // Arrange
  const input = {
    presentedMs: 155_821.8,
    gaps: [{ startMs: 155_450, endMs: 155_821.8 }],
    recordedPoints: [100_000],
    recordingEndMs: 155_821.8,
  }

  // Act
  const isInGap = presentedInHistoryGap(input)

  // Assert
  assert.equal(isInGap, true)
})

// Value: protects=no false gap note at the end of a recording whose last stop's pause is sealed at the end; fails_when=the end counts as a gap although history is recorded there; no_claim=that the pause itself is shown correctly
test('the recording end with no gap running to it is not in a gap', () => {
  // Arrange
  const input = {
    presentedMs: 900,
    gaps: [{ startMs: 100, endMs: 400 }],
    recordedPoints: [],
    recordingEndMs: 900,
  }

  // Act
  const isInGap = presentedInHistoryGap(input)

  // Assert
  assert.equal(isInGap, false)
})

// Value: protects=a recorded stop reading as recorded when it starts where a gap ends; fails_when=the gap note shows at a recorded point; no_claim=which stop is selected
test('a stop start is not in the gap before it', () => {
  // Arrange
  const input = {
    presentedMs: 400,
    gaps: [{ startMs: 100, endMs: 400 }],
    recordedPoints: [400],
    recordingEndMs: 900,
  }

  // Act
  const isInGap = presentedInHistoryGap(input)

  // Assert
  assert.equal(isInGap, false)
})

// Value: protects=the gap note inside an unrecorded interval between stops; fails_when=a time strictly inside an inner gap reads as recorded; no_claim=gap edges other than the start
test('a time strictly inside an inner gap is in the gap', () => {
  // Arrange
  const input = {
    presentedMs: 250,
    gaps: [{ startMs: 100, endMs: 400 }],
    recordedPoints: [400],
    recordingEndMs: 900,
  }

  // Act
  const isInGap = presentedInHistoryGap(input)

  // Assert
  assert.equal(isInGap, true)
})
