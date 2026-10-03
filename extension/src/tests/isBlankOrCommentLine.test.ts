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
