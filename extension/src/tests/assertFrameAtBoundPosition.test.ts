import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assertFrameAtBoundPosition } from '../utils/assertFrameAtBoundPosition'

const frame = {
  id: 1,
  name: 'Page',
  source: { path: '/app/page.tsx' },
  line: 25,
  column: 28,
}

// protects=a refused frame check names the frame's and the bound place for an ordinary stop, so a mismatch is readable from the run's failure; fails_when=the failure text carries only the bare sentence; no_claim=the check's decision (covered by isFrameAtPosition tests)
test('a frame at another column than the bound place of an ordinary stop fails naming both places', () => {
  // Arrange
  const bound = { line: 25, column: 46 }
  // Act
  const check = (): void =>
    assertFrameAtBoundPosition(frame, '/app/page.tsx', bound, false)
  // Assert
  assert.throws(
    check,
    new Error(
      'DAP frame differs from the bound configured source position (frame /app/page.tsx:25:28, bound /app/page.tsx:25:46)',
    ),
  )
})

// protects=a missing frame is named as no path and an unknown place in the failure text; fails_when=the text throws on a missing frame, names nothing or prints undefined numbers; no_claim=none beyond protects
test('a missing frame fails naming no path and the bound place', () => {
  // Arrange / Act
  const check = (): void =>
    assertFrameAtBoundPosition(
      undefined,
      '/app/page.tsx',
      { line: 25, column: 46 },
      false,
    )
  // Assert
  assert.throws(
    check,
    new Error(
      'DAP frame differs from the bound configured source position (frame no path:unknown, bound /app/page.tsx:25:46)',
    ),
  )
})
