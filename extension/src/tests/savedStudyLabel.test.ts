import assert from 'node:assert/strict'
import { test } from 'node:test'

import { savedStudyLabel } from '../utils/savedStudyLabel'

// Value: protects=a test replay's Saved studies row reads in the String catalog's words (DS14) and no learner string says "Node"; fails_when=the row is led by a kind such as "Node test history" before the catalog's `Test replay · …`; why_new=F157 had no pin for the row; seam=none
test('a test replay row in Saved studies starts with the catalog sentence, not with a Node kind', () => {
  // Arrange
  const savedAt = '2026-10-02T01:00:00.000Z'
  const entry = {
    id: 'window_run-node00509f3c2d1e',
    format: 'node-test-history' as const,
    savedAt,
    outcome:
      'Test replay · Test passed · exit code 0 · capture complete · 0 of 2 stops explained',
  }
  // Act
  const row = savedStudyLabel(entry, 'ignored kind')
  // Assert
  assert.equal(
    row,
    `Test replay · Test passed · exit code 0 · capture complete · 0 of 2 stops explained · ${new Date(savedAt).toLocaleString()} · 9f3c2d1e`,
  )
  assert.doesNotMatch(row, /Node/)
})

// Value: protects=a browser study's row keeps its kind first; fails_when=the test replay rule leaks to other formats; why_new=F157's rule must not change the other rows; seam=none
test('a browser study row keeps its kind, date, outcome and id', () => {
  // Arrange
  const savedAt = '2026-10-02T01:00:00.000Z'
  // Act
  const row = savedStudyLabel(
    {
      id: 'a_b9f3c2d1e',
      format: 'v4',
      savedAt,
      outcome: 'not-demonstrated',
    },
    'Repository browser study',
  )
  // Assert
  assert.equal(
    row,
    `Repository browser study · ${new Date(savedAt).toLocaleString()} · not-demonstrated · 9f3c2d1e`,
  )
})
