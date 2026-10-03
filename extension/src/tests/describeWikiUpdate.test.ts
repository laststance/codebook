import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeWikiUpdate } from '../utils/describeWikiUpdate'

const output = '.codebook/wiki'
const formatTime = () => '21:03'

test('a running Wiki update says where it runs, since when, and that the current site stays readable', () => {
  // Arrange
  const status = {
    state: 'running',
    host: 'cursor',
    startedAt: '2026-10-03T12:03:00.000Z',
    outputDirectory: output,
  } as const

  // Act
  const text = describeWikiUpdate(status, formatTime)

  // Assert
  assert.equal(
    text,
    'Updating LLM Wiki… started 21:03 in Cursor. The current site stays readable. Output: .codebook/wiki',
  )
})

test('a failed, cancelled or timed-out Wiki update each tell the learner the last usable site is kept', () => {
  // Arrange
  const finishedAt = '2026-10-03T12:10:00.000Z'

  // Act
  const failed = describeWikiUpdate({
    state: 'failed',
    finishedAt,
    reason: 'Cursor Agent exited with code 1.',
    outputDirectory: output,
  })
  const cancelled = describeWikiUpdate({
    state: 'cancelled',
    finishedAt,
    outputDirectory: output,
  })
  const timedOut = describeWikiUpdate({
    state: 'timed-out',
    finishedAt,
    outputDirectory: output,
  })

  // Assert
  assert.equal(
    failed,
    'Update failed: Cursor Agent exited with code 1. The last usable site is kept. Output: .codebook/wiki',
  )
  assert.equal(
    cancelled,
    'Update cancelled. The last usable site is kept. Output: .codebook/wiki',
  )
  assert.equal(
    timedOut,
    'Update not finished in time. The last usable site is kept; a later publish shows as current here. Output: .codebook/wiki',
  )
})

test('a published, already-current or conflicting Wiki update names its result and the output folder', () => {
  // Arrange
  const finishedAt = '2026-10-03T12:10:00.000Z'

  // Act
  const succeeded = describeWikiUpdate({
    state: 'succeeded',
    finishedAt,
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    outputDirectory: output,
  })
  const current = describeWikiUpdate({
    state: 'already-current',
    finishedAt,
    outputDirectory: output,
  })
  const conflict = describeWikiUpdate({
    state: 'conflict',
    finishedAt,
    paths: ['notes/mine.md', 'extra.html'],
    outputDirectory: output,
  })

  // Assert
  assert.equal(
    succeeded,
    'Updated to a1b2c3d4e5f6+0f9e8d7c. Reload this page to read the new pages. Output: .codebook/wiki',
  )
  assert.equal(
    current,
    'Already current. Nothing to update. Output: .codebook/wiki',
  )
  assert.equal(
    conflict,
    'Update stopped: your file would be overwritten (notes/mine.md, extra.html). Nothing was replaced. Output: .codebook/wiki',
  )
})

test('an idle Wiki shows no update sentence', () => {
  // Arrange
  const status = { state: 'idle' } as const

  // Act
  const text = describeWikiUpdate(status)

  // Assert
  assert.equal(text, '')
})
