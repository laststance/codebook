import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hasPrefixWithSha256 } from '../utils/hasPrefixWithSha256'

/** The SHA-256 of `{}` and a line break, the bytes a published config would hold. */
const PUBLISHED_SHA256 =
  'ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356'

// Value: protects=a published config with text appended in place after its last line break is still recognised by its published bytes at the start, and so is the unchanged file; fails_when=only the whole bytes are hashed (an appended line hides the published file) or the last line break is not a candidate (the unchanged file is missed); no_claim=which files Codebook publishes end in a line break
test('bytes that start with the published bytes up to a line break are recognised, also when they are exactly those bytes', () => {
  // Arrange
  const candidates = [
    Buffer.from('{}\n'),
    Buffer.from('{}\n\n'),
    Buffer.from('{}\n{"appended":true}\n'),
  ]

  // Act
  const answers = candidates.map((bytes) =>
    hasPrefixWithSha256(bytes, PUBLISHED_SHA256),
  )

  // Assert
  assert.deepEqual(answers, [true, true, true])
})

// Value: protects=a file whose bytes merely contain the published bytes, or start with them but not at a line end, is not taken for the published file; fails_when=a prefix that does not end in a line break counts, a later line counts on its own, or bytes with no line break at all count; no_claim=a second file whose bytes really start with the published ones (a hash cannot tell it from an append)
test('bytes that do not start with the published bytes ending in a line break are not recognised', () => {
  // Arrange
  const candidates = [
    Buffer.from('{"beta":true}\n{}\n'),
    Buffer.from('{}'),
    Buffer.from('{} \n'),
    Buffer.from(''),
  ]

  // Act
  const answers = candidates.map((bytes) =>
    hasPrefixWithSha256(bytes, PUBLISHED_SHA256),
  )

  // Assert
  assert.deepEqual(answers, [false, false, false, false])
})
