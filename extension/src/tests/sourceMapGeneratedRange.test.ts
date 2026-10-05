import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sourceMapGeneratedRange } from '../utils/sourceMapGeneratedRange'

// Cycle 0045 (SP-3, B-L6, PC-3.1): an `end` at the line's last generated position would make this range empty, because the debugger's `end` is exclusive.
test('a line with a single mapped position has a range that runs to the end of that position’s generated line', () => {
  // Arrange: generated line 0 maps to source line 1, generated line 1 to source line 2.
  const mappings = 'AAAA;AACA'
  // Act
  const range = sourceMapGeneratedRange(mappings, 0, 2)
  // Assert
  assert.deepEqual(range, {
    range: {
      start: { lineNumber: 1, columnNumber: 0 },
      end: { lineNumber: 2, columnNumber: 0 },
    },
    complete: true,
  })
})

test('a break location after the line’s last mapping lies inside its range, which ends at the next segment of that generated line', () => {
  // Arrange: on generated line 0, column 0 maps to source line 1, column 6 to source line 2 and column 14 starts generated code without an original.
  const mappings = 'AAAA,MACA,Q'
  // Act
  const firstLine = sourceMapGeneratedRange(mappings, 0, 1),
    secondLine = sourceMapGeneratedRange(mappings, 0, 2)
  // Assert: a break location at 0:10 belongs to source line 2 and lies before its exclusive end 0:14.
  assert.deepEqual(firstLine, {
    range: {
      start: { lineNumber: 0, columnNumber: 0 },
      end: { lineNumber: 0, columnNumber: 6 },
    },
    complete: true,
  })
  assert.deepEqual(secondLine, {
    range: {
      start: { lineNumber: 0, columnNumber: 6 },
      end: { lineNumber: 0, columnNumber: 14 },
    },
    complete: true,
  })
})

test('a line whose mappings lie before and after another line’s in the generated code has a range from its first place to the end of its last', () => {
  // Arrange: generated lines 0 and 2 map to source line 1, generated line 1 between them to source line 2.
  const mappings = 'AAAA;AACA;AADA'
  // Act
  const firstLine = sourceMapGeneratedRange(mappings, 0, 1),
    secondLine = sourceMapGeneratedRange(mappings, 0, 2)
  // Assert: the range of line 1 also holds generated line 1, so a caller maps every answered location back.
  assert.deepEqual(firstLine, {
    range: {
      start: { lineNumber: 0, columnNumber: 0 },
      end: { lineNumber: 3, columnNumber: 0 },
    },
    complete: true,
  })
  assert.deepEqual(secondLine, {
    range: {
      start: { lineNumber: 1, columnNumber: 0 },
      end: { lineNumber: 2, columnNumber: 0 },
    },
    complete: true,
  })
})

test('a mapping of another original ends the span of the line’s mapping before it', () => {
  // Arrange: on generated line 0, column 0 maps to line 1 of the cited source and column 6 to another original of the bundle.
  const mappings = 'AAAA,MCAA'
  // Act
  const range = sourceMapGeneratedRange(mappings, 0, 1)
  // Assert
  assert.deepEqual(range, {
    range: {
      start: { lineNumber: 0, columnNumber: 0 },
      end: { lineNumber: 0, columnNumber: 6 },
    },
    complete: true,
  })
})

test('a line the map has no position on has no range, and a scan that stopped at its size limit says that it proves nothing', () => {
  // Arrange: a small map without source line 2, and a map whose 100,000 empty generated lines end the scan before its only mapping.
  const withoutLine = 'AAAA',
    tooLarge = `${';'.repeat(100_000)}AAAA`
  // Act
  const absent = sourceMapGeneratedRange(withoutLine, 0, 2),
    partial = sourceMapGeneratedRange(tooLarge, 0, 1)
  // Assert
  assert.deepEqual(absent, { range: undefined, complete: true })
  assert.deepEqual(partial, { range: undefined, complete: false })
})
