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
  const stop = { sourcePath: '/app/auth.ts', declaredLine: 41 }
  // Act
  const atOneColumn = isRefreshedFrameAtStop(frame, stop),
    atAnotherColumn = isRefreshedFrameAtStop({ ...frame, column: 11 }, stop)
  // Assert
  assert.equal(atOneColumn, true)
  assert.equal(atAnotherColumn, true)
})

test('before a stop’s binding is known, a refreshed frame on another line, in another file or without a source is refused', () => {
  // Arrange
  const stop = { sourcePath: '/app/auth.ts', declaredLine: 41 }
  // Act
  const onAnotherLine = isRefreshedFrameAtStop({ ...frame, line: 42 }, stop),
    inAnotherFile = isRefreshedFrameAtStop(frame, {
      sourcePath: '/app/actions.ts',
      declaredLine: 41,
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
  }
  // Act
  const atBoundPosition = isRefreshedFrameAtStop(frame, stop),
    atAnotherColumn = isRefreshedFrameAtStop({ ...frame, column: 11 }, stop)
  // Assert
  assert.equal(atBoundPosition, true)
  assert.equal(atAnotherColumn, false)
})
