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
    lastRun: undefined,
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
    lastRun: undefined,
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
    // This window's run of this output lasted from 990,000 to 1,030,000 and its agent has stopped.
    lastRun: {
      outputDirectory: '/repo/wiki',
      startedAtMs: 990_000,
      endedAtMs: 1_030_000,
      mayAgentStillWork: false,
    },
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
    // This window's run of this output lasted from 990,000 to 1,030,000 and its agent has stopped.
    lastRun: {
      outputDirectory: '/repo/wiki',
      startedAtMs: 990_000,
      endedAtMs: 1_030_000,
      mayAgentStillWork: false,
    },
  })

  // Assert
  assert.equal(active?.name, 'wiki.stage-live')
})

test('a candidate the chat staged before a cancelled or timed-out VS Code watch refuses the next start until the watch bound has passed', () => {
  // Arrange
  const candidates = [
    { name: 'wiki.stage-1', writtenAtMs: 1_000_000, ownedPaths: [] },
  ]
  // The watch of this run was stopped at 1,030,000; the chat it asked may still be working.
  const stoppedWatch = {
    outputDirectory: '/repo/wiki',
    startedAtMs: 990_000,
    endedAtMs: 1_030_000,
    mayAgentStillWork: true,
  }

  // Act
  const insideTheBound = selectActiveWikiCandidate(candidates, {
    nowMs: 1_060_000,
    activeWithinMs: FIFTEEN_MINUTES_MS,
    lastRun: stoppedWatch,
  })
  const pastTheBound = selectActiveWikiCandidate(candidates, {
    nowMs: 1_000_000 + FIFTEEN_MINUTES_MS + 1,
    activeWithinMs: FIFTEEN_MINUTES_MS,
    lastRun: stoppedWatch,
  })

  // Assert
  assert.equal(insideTheBound?.name, 'wiki.stage-1')
  assert.equal(pastTheBound, undefined)
})

test('a candidate written before this window’s last run began has no known owner and blocks the start as another window’s', () => {
  // Arrange
  const candidates = [
    { name: 'wiki.stage-1', writtenAtMs: 980_000, ownedPaths: [] },
  ]

  // Act
  const active = selectActiveWikiCandidate(candidates, {
    nowMs: 1_060_000,
    activeWithinMs: FIFTEEN_MINUTES_MS,
    lastRun: {
      outputDirectory: '/repo/wiki',
      startedAtMs: 990_000,
      endedAtMs: 1_030_000,
      mayAgentStillWork: false,
    },
  })

  // Assert
  assert.equal(active?.name, 'wiki.stage-1')
})

// Value: protects=the learner who presses at the moment a candidate's wait ends; fails_when=a candidate written exactly the watch bound ago still counts as work in progress, so its wait ends one millisecond later than a stopped watch's, and a press at the time the refusal names is refused again; why_new=Cycle 0047 row 90 (SM-4, the candidate's bound); seam=none; no_claim=the time the refusal names
test('a candidate stops blocking the start at the very moment the watch bound has passed since it was written, as a stopped watch’s chat does', () => {
  // Arrange
  const candidates = [
    { name: 'wiki.stage-1', writtenAtMs: 1_000_000, ownedPaths: [] },
  ]

  // Act
  const justBeforeTheBound = selectActiveWikiCandidate(candidates, {
    nowMs: 1_000_000 + FIFTEEN_MINUTES_MS - 1,
    activeWithinMs: FIFTEEN_MINUTES_MS,
    lastRun: undefined,
  })
  const atTheBound = selectActiveWikiCandidate(candidates, {
    nowMs: 1_000_000 + FIFTEEN_MINUTES_MS,
    activeWithinMs: FIFTEEN_MINUTES_MS,
    lastRun: undefined,
  })

  // Assert
  assert.equal(justBeforeTheBound?.name, 'wiki.stage-1')
  assert.equal(atTheBound, undefined)
})
