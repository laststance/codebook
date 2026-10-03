import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isRefreshedFrameAtStop } from '../utils/isRefreshedFrameAtStop'

const frame = {
  id: 1,
  name: 'authorize',
  source: { path: '/app/auth.ts' },
  line: 41,
  column: 24,
}

test('before a stop’s binding is known, a refreshed frame in its file on the declared line is accepted at any column', () => {
  // Arrange
  const stop = {
    sourcePath: '/app/auth.ts',
    declaredLine: 41,
    acceptsBoundLine: (line: number) => line === 41,
  }
  // Act
  const atOneColumn = isRefreshedFrameAtStop(frame, stop),
    atAnotherColumn = isRefreshedFrameAtStop({ ...frame, column: 11 }, stop)
  // Assert
  assert.equal(atOneColumn, true)
  assert.equal(atAnotherColumn, true)
})

test('before a stop’s binding is known, a refreshed frame on another line, in another file or without a source is refused', () => {
  // Arrange
  const stop = {
    sourcePath: '/app/auth.ts',
    declaredLine: 41,
    acceptsBoundLine: (line: number) => line === 41,
  }
  // Act
  const onAnotherLine = isRefreshedFrameAtStop({ ...frame, line: 42 }, stop),
    inAnotherFile = isRefreshedFrameAtStop(frame, {
      ...stop,
      sourcePath: '/app/actions.ts',
    }),
    missingFrame = isRefreshedFrameAtStop(undefined, stop),
    frameWithoutSource = isRefreshedFrameAtStop(
      { id: 1, name: 'anonymous', line: 41, column: 24 },
      stop,
    )
  // Assert
  assert.equal(onAnotherLine, false)
  assert.equal(inAnotherFile, false)
  assert.equal(missingFrame, false)
  assert.equal(frameWithoutSource, false)
})

test('once a stop’s binding is known, a refreshed frame is accepted only at the bound position', () => {
  // Arrange: declared on line 41 and bound at 41:24.
  const stop = {
    sourcePath: '/app/auth.ts',
    declaredLine: 41,
    bound: { line: 41, column: 24 },
    acceptsBoundLine: (line: number) => line === 41,
  }
  // Act
  const atBoundPosition = isRefreshedFrameAtStop(frame, stop),
    atAnotherColumn = isRefreshedFrameAtStop({ ...frame, column: 11 }, stop)
  // Assert
  assert.equal(atBoundPosition, true)
  assert.equal(atAnotherColumn, false)
})

// Value: protects=a paused stop the debugger moved to a later line surviving a stack refresh that arrives before its binding is read; fails_when=before the binding is known only the declared line is a place the refreshed frame may be on; why_new=a binding can now sit on a later line than declared (Cycle 0043, ER6); seam=none
test('before a stop’s binding is known, a refreshed frame on a later line the stop accepts as its binding is accepted, and one it refuses is not', () => {
  // Arrange: declared on line 41; the stop's rule accepts line 42 only.
  const stop = {
    sourcePath: '/app/auth.ts',
    declaredLine: 41,
    acceptsBoundLine: (line: number) => line === 42,
  }
  // Act
  const onAcceptedLine = isRefreshedFrameAtStop({ ...frame, line: 42 }, stop),
    onDeclaredLine = isRefreshedFrameAtStop(frame, stop),
    onRefusedLine = isRefreshedFrameAtStop({ ...frame, line: 43 }, stop)
  // Assert
  assert.equal(onAcceptedLine, true)
  assert.equal(onDeclaredLine, true)
  assert.equal(onRefusedLine, false)
})

// Value: protects=a known binding staying exact when the stop also has a rule; fails_when=the rule widens the check after the binding is known, so a refreshed frame on another accepted line reuses the pause; why_new=the rule is new (Cycle 0043, ER6); seam=none
test('once a stop’s binding is known, a refreshed frame must sit at the bound position even on a line the stop’s rule accepts', () => {
  // Arrange: bound at 42:5.
  const stop = {
    sourcePath: '/app/auth.ts',
    declaredLine: 41,
    bound: { line: 42, column: 5 },
    acceptsBoundLine: () => true,
  }
  // Act
  const atBoundPosition = isRefreshedFrameAtStop(
      { ...frame, line: 42, column: 5 },
      stop,
    ),
    onDeclaredLine = isRefreshedFrameAtStop(frame, stop),
    atAnotherColumn = isRefreshedFrameAtStop({ ...frame, line: 42 }, stop)
  // Assert
  assert.equal(atBoundPosition, true)
  assert.equal(onDeclaredLine, false)
  assert.equal(atAnotherColumn, false)
})
