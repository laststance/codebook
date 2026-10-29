import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readScreencastFrame } from '../runtimeSupport/utils/readScreencastFrame'

// protects=SR6 (Cycle 0062 task 7): an event without a string image is dropped; fails_when=the data guard is removed and a malformed frame reaches the viewport; no_claim=what Chrome sends in practice
test('a screencast event whose image is missing or not a string is dropped', () => {
  // Arrange
  const missing = { sessionId: 3, metadata: { timestamp: 1 } }
  const numeric = { data: 42, sessionId: 3, metadata: { timestamp: 1 } }
  // Act
  const results = [readScreencastFrame(missing), readScreencastFrame(numeric)]
  // Assert
  assert.deepEqual(results, [undefined, undefined])
})

// protects=SR6 (Cycle 0062 task 7): an event whose acknowledgement number is not a number is dropped; fails_when=the sessionId guard is removed so a frame cannot be acknowledged; no_claim=the acknowledgement round trip
test('a screencast event whose acknowledgement number is not numeric is dropped', () => {
  // Arrange
  const stringId = { data: 'cGl4ZWxz', sessionId: '3' }
  const absentId = { data: 'cGl4ZWxz' }
  // Act
  const results = [readScreencastFrame(stringId), readScreencastFrame(absentId)]
  // Assert
  assert.deepEqual(results, [undefined, undefined])
})

// protects=SR6 (Cycle 0062 task 7): only the numeric timestamp and CSS size are kept from the metadata, extra fields are not passed on; fails_when=the metadata is copied whole or a non-numeric size is kept; no_claim=the viewport's use of the size
test('a screencast frame keeps only the numeric timestamp and CSS size of its metadata', () => {
  // Arrange
  const params = {
    data: 'cGl4ZWxz',
    sessionId: 3,
    metadata: {
      timestamp: 1,
      deviceWidth: 400,
      deviceHeight: '300',
      offsetTop: 0,
      pageScaleFactor: 1,
    },
  }
  // Act
  const frame = readScreencastFrame(params)
  // Assert
  assert.deepEqual(frame, {
    data: 'cGl4ZWxz',
    sessionId: 3,
    metadata: { timestamp: 1, deviceWidth: 400 },
  })
})
