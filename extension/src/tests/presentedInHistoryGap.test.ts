import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

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

// Value: protects=no false gap note at the end of a recording whose last stop's pause is sealed at the end; fails_when=the end counts as a gap although a recorded point sits at the end where the last gap ends; no_claim=that the pause itself is shown correctly
test('a recorded point at the end where a gap ends is not in a gap', () => {
  // Arrange
  const input = {
    presentedMs: 900,
    gaps: [{ startMs: 500, endMs: 900 }],
    recordedPoints: [900],
    recordingEndMs: 900,
  }

  // Act
  const isInGap = presentedInHistoryGap(input)

  // Assert
  assert.equal(isInGap, false)
})

// Value: protects=no presented position reading as inside a gap; fails_when=an undefined presented time is in a gap; no_claim=what the status shows instead
test('no presented position is not in a gap', () => {
  // Arrange
  const input = {
    presentedMs: undefined,
    gaps: [{ startMs: 0, endMs: 900 }],
    recordedPoints: [],
    recordingEndMs: 900,
  }

  // Act
  const isInGap = presentedInHistoryGap(input)

  // Assert
  assert.equal(isInGap, false)
})

// Value: protects=the half-open rule while the recording's end is unknown; fails_when=a gap's end instant reads as inside it when no end is known; no_claim=behaviour at a known end
test('a gap end instant is outside the gap when the recording end is unknown', () => {
  // Arrange
  const input = {
    presentedMs: 400,
    gaps: [{ startMs: 100, endMs: 400 }],
    recordedPoints: [],
    recordingEndMs: undefined,
  }

  // Act
  const isInGap = presentedInHistoryGap(input)

  // Assert
  assert.equal(isInGap, false)
})

// Value: protects=the gap note at the exact start of an unrecorded interval; fails_when=the start instant reads as recorded; no_claim=the end edge
test('a gap start instant is in the gap', () => {
  // Arrange
  const input = {
    presentedMs: 100,
    gaps: [{ startMs: 100, endMs: 400 }],
    recordedPoints: [],
    recordingEndMs: 900,
  }

  // Act
  const isInGap = presentedInHistoryGap(input)

  // Assert
  assert.equal(isInGap, true)
})

// Value: protects=the Study webview still evaluating the helper after it is sent as source text; fails_when=the helper gains an import or closure that breaks once serialized through toString(); no_claim=the webview's message wiring
test('the helper gives the same answers after serialization as the Study webview receives it', () => {
  // Arrange
  // An empty context has no imports or closure variables, like the webview
  const rebuilt = runInNewContext(
    `(${presentedInHistoryGap.toString()})`,
    {},
  ) as typeof presentedInHistoryGap
  const gaps = [{ startMs: 500, endMs: 900 }]

  // Act
  const atEnd = rebuilt({
    presentedMs: 900,
    gaps,
    recordedPoints: [],
    recordingEndMs: 900,
  })
  const insideGap = rebuilt({
    presentedMs: 700,
    gaps,
    recordedPoints: [],
    recordingEndMs: 900,
  })
  const atRecordedPoint = rebuilt({
    presentedMs: 700,
    gaps,
    recordedPoints: [700],
    recordingEndMs: 900,
  })

  // Assert
  assert.deepEqual([atEnd, insideGap, atRecordedPoint], [true, true, false])
})

// Value: protects=no false gap note at the end when no gap runs to it; fails_when=the end counts as a gap although the only gap ended earlier; no_claim=that the end is recorded
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
