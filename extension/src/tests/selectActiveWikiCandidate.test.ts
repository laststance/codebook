import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectActiveWikiCandidate } from '../utils/selectActiveWikiCandidate'

const FIFTEEN_MINUTES_MS = 900_000

test('a candidate written a minute ago in a window that has had no run is somebody else’s update in progress', () => {
  // Arrange
  const candidates = [
    { name: 'wiki.stage-1', writtenAtMs: 1_000_000, ownedPaths: [] },
  ]

  // Act
  const active = selectActiveWikiCandidate(candidates, {
    nowMs: 1_060_000,
    activeWithinMs: FIFTEEN_MINUTES_MS,
    lastRunEndedAtMs: undefined,
  })

  // Assert
  assert.deepEqual(active, {
    name: 'wiki.stage-1',
    writtenAtMs: 1_000_000,
    ownedPaths: [],
  })
})

test('a candidate nobody wrote to for longer than the watch bound is abandoned and does not block the start', () => {
  // Arrange
  const candidates = [
    { name: 'wiki.stage-1', writtenAtMs: 1_000_000, ownedPaths: [] },
  ]

  // Act
  const active = selectActiveWikiCandidate(candidates, {
    nowMs: 1_000_000 + FIFTEEN_MINUTES_MS + 1,
    activeWithinMs: FIFTEEN_MINUTES_MS,
    lastRunEndedAtMs: undefined,
  })

  // Assert
  assert.equal(active, undefined)
})

test('a candidate this window’s own finished run left behind does not block a retry', () => {
  // Arrange
  const candidates = [
    { name: 'wiki.stage-1', writtenAtMs: 1_000_000, ownedPaths: [] },
  ]

  // Act
  const active = selectActiveWikiCandidate(candidates, {
    nowMs: 1_060_000,
    activeWithinMs: FIFTEEN_MINUTES_MS,
    lastRunEndedAtMs: 1_030_000,
  })

  // Assert
  assert.equal(active, undefined)
})

test('a candidate that changed after this window’s run ended blocks the retry: the earlier chat is still working', () => {
  // Arrange
  const candidates = [
    { name: 'wiki.stage-old', writtenAtMs: 1_000_000, ownedPaths: [] },
    { name: 'wiki.stage-live', writtenAtMs: 1_050_000, ownedPaths: [] },
    { name: 'wiki.stage-mid', writtenAtMs: 1_040_000, ownedPaths: [] },
  ]

  // Act
  const active = selectActiveWikiCandidate(candidates, {
    nowMs: 1_060_000,
    activeWithinMs: FIFTEEN_MINUTES_MS,
    lastRunEndedAtMs: 1_030_000,
  })

  // Assert
  assert.equal(active?.name, 'wiki.stage-live')
})
