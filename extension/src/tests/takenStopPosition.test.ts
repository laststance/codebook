import assert from 'node:assert/strict'
import { test } from 'node:test'

import { takenStopPosition } from '../utils/takenStopPosition'

const THEME_SOURCE = {
  path: 'src/theme.ts',
  hash: 'a'.repeat(64),
  text: 'const theme = read()\n    \n\t\napply(theme)',
  lineCount: 4,
}

// Value: protects=a stop declared with a column on a line that holds only indentation being taken at the line's start, as the help ("A blank line has no column to choose") and isBlankOrCommentLine treat that line; fails_when=only a line of length 0 counts as blank, so a column declared on an indentation-only line is kept and refused against the line's length; why_new=Cycle 0045 PL-16 (row 24 of Cycle 0046); seam=none
test('a column declared on a line of only indentation is taken at column 1, like a column on an empty line, and a line with code keeps its column', () => {
  // Arrange: line 2 is four spaces, line 3 is one tab, line 1 has code.
  const declared = {
    spacesOnly: { path: 'src/theme.ts', line: 2, column: 3 },
    tabOnly: { path: 'src/theme.ts', line: 3, column: 9 },
    code: { path: 'src/theme.ts', line: 1, column: 7 },
  }

  // Act
  const taken = {
    spacesOnly: takenStopPosition(declared.spacesOnly, [THEME_SOURCE]),
    tabOnly: takenStopPosition(declared.tabOnly, [THEME_SOURCE]),
    code: takenStopPosition(declared.code, [THEME_SOURCE]),
  }

  // Assert
  assert.deepEqual(taken, {
    spacesOnly: { path: 'src/theme.ts', line: 2, column: 1 },
    tabOnly: { path: 'src/theme.ts', line: 3, column: 1 },
    code: { path: 'src/theme.ts', line: 1, column: 7 },
  })
})
