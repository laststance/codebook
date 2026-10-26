import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fullCommitHash } from '../utils/fullCommitHash'

// Value: protects=the revision handed to Git: only a SHA-1 (40) or SHA-256 (64) object name passes; fails_when=a length between the two (41 to 63 digits) or a non-hex text is taken as a full hash; no_claim=that the hash names a commit that exists; seam=the pure function
test('a revision is a full commit hash only at 40 or 64 hexadecimal digits', () => {
  // Arrange
  const lengths = [39, 40, 41, 63, 64, 65]

  // Act
  const accepted = lengths.map(
    (length) => fullCommitHash('a'.repeat(length)) !== undefined,
  )

  // Assert
  assert.deepEqual(accepted, [false, true, false, false, true, false])
})

// Value: protects=the revision handed to Git against branch names and option-like text; fails_when=a non-hex text, an empty text or no revision is returned as a hash; no_claim=the case rule beyond what the function already keeps (upper case digits are accepted); seam=the pure function
test('a branch name, a text with a non-hex digit, an empty text and no revision are no full hash, while upper case digits keep counting', () => {
  // Arrange
  const nonHex = `${'a'.repeat(39)}g`
  const upperCase = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'

  // Act
  const results = [
    fullCommitHash('main'),
    fullCommitHash(nonHex),
    fullCommitHash(''),
    fullCommitHash(undefined),
    fullCommitHash(upperCase),
  ]

  // Assert
  assert.deepEqual(results, [
    undefined,
    undefined,
    undefined,
    undefined,
    upperCase,
  ])
})
