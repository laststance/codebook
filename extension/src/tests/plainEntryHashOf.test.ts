import assert from 'node:assert/strict'
import { test } from 'node:test'

import { plainEntryHashOf } from '../utils/plainEntryHashOf'

// Value: protects=a first setup's pending record, whose entry hash carries the first-setup prefix, is still compared with the entry that stands and gives its receipt the plain hash; fails_when=the prefix stays on the hash (no entry ever matches it, so a cut-short first setup is never taken back) or a plain hash loses characters; no_claim=which records carry the prefix (the publish writes it) or how a mismatch is settled
test('a first setup’s prefixed entry hash compares as the plain hash, and a plain hash stays as it is', () => {
  // Arrange: the SHA-256 of "test" with and without the first-setup prefix, and a removal's record, which has no hash.
  const recordedHashes = [
    'first-setup:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    undefined,
  ]

  // Act
  const plainHashes = recordedHashes.map((hash) => plainEntryHashOf(hash))

  // Assert
  assert.deepEqual(plainHashes, [
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    undefined,
  ])
})

// Value: protects=only the exact prefix at the start of the hash is stripped, so a hash that merely contains the text keeps every character; fails_when=the prefix is removed from the middle of a value or a near-miss prefix ("first-setup" without its colon) is stripped; no_claim=the hash is valid hex
test('an entry hash that does not start with the exact first-setup prefix keeps every character', () => {
  // Arrange
  const recordedHashes = [
    'abc first-setup:9f86d081',
    'first-setup9f86d081',
    'FIRST-SETUP:9f86d081',
  ]

  // Act
  const plainHashes = recordedHashes.map((hash) => plainEntryHashOf(hash))

  // Assert
  assert.deepEqual(plainHashes, [
    'abc first-setup:9f86d081',
    'first-setup9f86d081',
    'FIRST-SETUP:9f86d081',
  ])
})
