import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isFrameAtPosition } from '../utils/isFrameAtPosition'

const frame = {
  id: 1,
  name: 'authorize',
  source: { path: '/app/auth.ts' },
  line: 41,
  column: 24,
}

// Value: protects=a stop committing only when the debugger's top frame is the position its breakpoint bound; fails_when=the frame is compared with the requested column, or a frame beside the binding is accepted; why_new=Cycle 0036 L2 (the bound position replaces the declared column in the frame checks); seam=none
test('a top frame in the stop’s file at the bound line and column is the bound position', () => {
  // Arrange / Act
  const atBound = isFrameAtPosition(frame, '/app/auth.ts', {
    line: 41,
    column: 24,
  })
  // Assert
  assert.equal(atBound, true)
})

test('a top frame at another column, another line or in another file is not the bound position', () => {
  // Arrange / Act / Assert: the request was 41:11 and the binding 41:24; a frame at 41:11 is beside the binding.
  assert.equal(
    isFrameAtPosition({ ...frame, column: 11 }, '/app/auth.ts', {
      line: 41,
      column: 24,
    }),
    false,
  )
  assert.equal(
    isFrameAtPosition({ ...frame, line: 42 }, '/app/auth.ts', {
      line: 41,
      column: 24,
    }),
    false,
  )
  assert.equal(
    isFrameAtPosition(frame, '/app/actions.ts', { line: 41, column: 24 }),
    false,
  )
})

test('a missing frame, a frame without a source path and a stop that has not bound yet are never the bound position', () => {
  // Arrange / Act / Assert
  assert.equal(
    isFrameAtPosition(undefined, '/app/auth.ts', { line: 41, column: 24 }),
    false,
  )
  assert.equal(
    isFrameAtPosition({ ...frame, source: {} }, '/app/auth.ts', {
      line: 41,
      column: 24,
    }),
    false,
  )
  assert.equal(isFrameAtPosition(frame, '/app/auth.ts', undefined), false)
})
