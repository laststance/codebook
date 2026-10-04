import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isBlankOrCommentLine } from '../utils/isBlankOrCommentLine'

// Value: protects=a stop declared on a line that cannot run being refused before input when the sealed map is too large to scan; fails_when=a blank or comment-only line is read as code, or a line with code as a comment; why_new=Cycle 0043 R3; seam=none
test('a blank line and a comment-only line hold nothing that could run, and a line with code before or after a comment does', () => {
  // Arrange
  const source = [
    'const user = await getUser(email)',
    '',
    '  // Auth.js error messages',
    '  /* kept */',
    '  /* kept */ return user',
    '  return user // why',
  ].join('\n')
  // Act
  const answers = [1, 2, 3, 4, 5, 6, 7].map((line) =>
    isBlankOrCommentLine(source, line),
  )
  // Assert: line 7 does not exist.
  assert.deepEqual(answers, [false, true, true, true, false, false, false])
})

// Cycle 0045 (ST-6): the two branches of isCommentAt behind a block comment had no test; green on 6a7a0b8, its controls are those branches.
test('a line that opens a block comment it does not close, and a line of several comments, hold nothing that could run; code after the last comment does', () => {
  // Arrange
  const source = [
    '  /* starts',
    '/* a */ /* b */ // c',
    '/* a */ /* b */ run()',
  ].join('\n')
  // Act
  const answers = [1, 2, 3].map((line) => isBlankOrCommentLine(source, line))
  // Assert
  assert.deepEqual(answers, [true, true, false])
})
