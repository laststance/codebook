import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isAcknowledgedWikiLeftover } from '../utils/isAcknowledgedWikiLeftover'

test('Update anyway covers the candidate, the stopped watch and the other window’s reservation its refusal named', () => {
  // Arrange: what the refusal named when the button was offered.
  const named = [
    {
      kind: 'reservation',
      windowId: '3f6c2a1e',
      startedAtMs: 1_790_000_000_000,
    },
    { kind: 'candidate', name: 'wiki.stage-1' },
    { kind: 'last-run', endedAtMs: 1_790_000_060_000 },
  ] as const

  // Act
  const answers = [
    isAcknowledgedWikiLeftover(
      {
        kind: 'reservation',
        windowId: '3f6c2a1e',
        startedAtMs: 1_790_000_000_000,
      },
      named,
    ),
    isAcknowledgedWikiLeftover(
      { kind: 'candidate', name: 'wiki.stage-1' },
      named,
    ),
    isAcknowledgedWikiLeftover(
      { kind: 'last-run', endedAtMs: 1_790_000_060_000 },
      named,
    ),
  ]

  // Assert
  assert.deepEqual(answers, [true, true, true])
})

test('Update anyway does not cover a leftover that appeared after its refusal: a new candidate, a later stopped watch, another window or another run of the same window', () => {
  // Arrange
  const named = [
    {
      kind: 'reservation',
      windowId: '3f6c2a1e',
      startedAtMs: 1_790_000_000_000,
    },
    { kind: 'candidate', name: 'wiki.stage-1' },
    { kind: 'last-run', endedAtMs: 1_790_000_060_000 },
  ] as const

  // Act
  const answers = [
    isAcknowledgedWikiLeftover(
      { kind: 'candidate', name: 'wiki.stage-2' },
      named,
    ),
    isAcknowledgedWikiLeftover(
      { kind: 'last-run', endedAtMs: 1_790_000_120_000 },
      named,
    ),
    isAcknowledgedWikiLeftover(
      {
        kind: 'reservation',
        windowId: '9b1d7c40',
        startedAtMs: 1_790_000_000_000,
      },
      named,
    ),
    isAcknowledgedWikiLeftover(
      {
        kind: 'reservation',
        windowId: '3f6c2a1e',
        startedAtMs: 1_790_000_300_000,
      },
      named,
    ),
  ]

  // Assert
  assert.deepEqual(answers, [false, false, false, false])
})

test('an ordinary press, which names no leftover, covers none', () => {
  // Act
  const isCovered = isAcknowledgedWikiLeftover(
    { kind: 'candidate', name: 'wiki.stage-1' },
    [],
  )

  // Assert
  assert.equal(isCovered, false)
})
