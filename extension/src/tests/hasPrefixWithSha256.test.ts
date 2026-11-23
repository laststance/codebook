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

/** The SHA-256 of a published config written over three lines (`{`, `  "a": 1`, `}`), each ending in a line break. */
const MULTI_LINE_PUBLISHED_SHA256 =
  '5e36b6560513586ced65eca0e8b025fe88edbcab82ba2cb67a5fcb2d7b202383'

/** The SHA-256 of `{}` without a line break. */
const BARE_OBJECT_SHA256 =
  '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'

// Value: protects=a published config that spans several lines is still recognised after text was appended, so the search goes on past a first line break that does not match; fails_when=only the first line break is a candidate, or the running hash restarts at each line; no_claim=which line ends a real published config has
test('bytes that start with multi-line published bytes and have text appended are recognised at the last published line break', () => {
  // Arrange
  const appended = Buffer.from('{\n  "a": 1\n}\n{"appended":true}\n')

  // Act
  const answer = hasPrefixWithSha256(appended, MULTI_LINE_PUBLISHED_SHA256)

  // Assert
  assert.equal(answer, true)
})

// Value: protects=a prefix counts only when it ends right after a line break, so bytes that start with the hashed bytes at a boundary that is no line end are not taken for the published file; fails_when=the whole bytes are hashed whatever their end, or a boundary that is no line break is a candidate; no_claim=a published file that does not end in a line break (Codebook never writes one)
test('bytes that start with the hashed bytes at a boundary that is no line break are not recognised', () => {
  // Arrange
  const candidates = [
    Buffer.from('{}'),
    Buffer.from('{} \n'),
    Buffer.from('{}{"appended":true}\n'),
  ]

  // Act
  const answers = candidates.map((bytes) =>
    hasPrefixWithSha256(bytes, BARE_OBJECT_SHA256),
  )

  // Assert
  assert.deepEqual(answers, [false, false, false])
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
