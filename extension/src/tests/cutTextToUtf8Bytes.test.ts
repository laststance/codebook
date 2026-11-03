import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cutTextToUtf8Bytes } from '../utils/cutTextToUtf8Bytes'

// protects=a text within the byte limit is stored as it is; fails_when=the cut touches a text that fits, or changes a text of exactly the limit; no_claim=text over the limit
test('a text that fits the byte limit is returned unchanged', () => {
  // Arrange
  const text = 'abc é'

  // Act
  const cut = cutTextToUtf8Bytes(text, 6)

  // Assert
  assert.equal(cut, 'abc é')
})

// protects=a text over the byte limit keeps its beginning of exactly the limit when the cut falls between characters; fails_when=the cut counts UTF-16 units instead of bytes, or drops more than it must; no_claim=multi-byte characters at the cut
test('an ASCII text over the byte limit is cut to exactly the limit', () => {
  // Arrange
  const text = 'abcdef'

  // Act
  const cut = cutTextToUtf8Bytes(text, 3)

  // Assert
  assert.equal(cut, 'abc')
})

// protects=a cut that falls inside a two-byte or a four-byte character drops that character whole, so the stored text holds no replacement character and stays within the limit; fails_when=the cut slices the bytes of a character and the text decodes to U+FFFD; no_claim=a lone surrogate, which decodes to U+FFFD before the cut
test('a byte limit inside a multi-byte character cuts before that character', () => {
  // Arrange
  const twoBytes = 'aé'
  const fourBytes = 'a\u{1F600}'

  // Act
  const cutTwoBytes = cutTextToUtf8Bytes(twoBytes, 2)
  const cutFourBytes = cutTextToUtf8Bytes(fourBytes, 4)

  // Assert
  assert.equal(cutTwoBytes, 'a')
  assert.equal(cutFourBytes, 'a')
})

// protects=a limit of zero bytes yields an empty text rather than looping or throwing; fails_when=the continuation-byte walk runs past the start; no_claim=a real caller, which never passes zero
test('a limit of zero bytes cuts to an empty text', () => {
  // Arrange
  const text = 'é'

  // Act
  const cut = cutTextToUtf8Bytes(text, 0)

  // Assert
  assert.equal(cut, '')
})
