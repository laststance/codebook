import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sanitizeRunCause } from '../utils/describeNodeServerRunFailure'

// protects=repository-relative paths stay readable after <workspace> while private paths outside it go; fails_when=<workspace><path> or a leaked home segment; no_claim=every possible path form
test('a cause keeps repository-relative paths readable and hides every other private path', () => {
  // Arrange
  const cause = new Error(
    'ENOENT /work/repo/src/routes/users.ts and /Users/村上/x/y and /Users/John Smith/proj/a.ts',
  )
  // Act
  const text = sanitizeRunCause(cause, '/work/repo', '/Users/John Smith')
  // Assert
  assert.equal(
    text,
    'ENOENT <workspace>/src/routes/users.ts and <path> and ~/proj/a.ts',
  )
})
