import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeRedirectLocation } from '../utils/describeRedirectLocation'
import { shapeResponseBody } from '../utils/shapeResponseBody'

// protects=text bodies reach the chat as text; fails_when=a text/JSON/+json type is shown as binary; no_claim=charset handling beyond UTF-8
test('text, JSON and +json bodies are shown as their text', () => {
  // Arrange
  const body = Buffer.from('{"ok":true}')
  // Act
  const shown = [
    shapeResponseBody(body, 'text/plain; charset=utf-8'),
    shapeResponseBody(body, 'application/json'),
    shapeResponseBody(body, 'application/problem+json; charset=utf-8'),
  ]
  // Assert
  assert.deepEqual(shown, ['{"ok":true}', '{"ok":true}', '{"ok":true}'])
})

// protects=a binary answer never prints bytes; fails_when=a non-text body is decoded; no_claim=image formats
test('a body of another media type is shown as a binary note with its size', () => {
  // Arrange
  const body = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  // Act
  const shown = shapeResponseBody(body, 'image/png')
  // Assert
  assert.equal(shown, '(binary, 4 bytes)')
})

// protects=the shown body is bounded and never splits a character; fails_when=the cut leaves half a code point or the count is wrong; no_claim=the 1 MiB read limit
test('a text body longer than 8192 bytes is cut at a code point with the number of bytes left', () => {
  // Arrange: 8191 ASCII bytes then a 3-byte character straddling the 8192 limit
  const body = Buffer.from(`${'a'.repeat(8_191)}あ${'b'.repeat(10)}`)
  // Act
  const shown = shapeResponseBody(body, 'text/plain')
  // Assert
  assert.equal(shown, `${'a'.repeat(8_191)} … 13 more bytes`)
})

// protects=invalid UTF-8 is visible as such; fails_when=replacement characters appear without the note; no_claim=which bytes were invalid
test('invalid UTF-8 is shown with U+FFFD and a note', () => {
  // Arrange
  const body = Buffer.from([0x41, 0xff, 0x42])
  // Act
  const shown = shapeResponseBody(body, 'text/plain')
  // Assert
  assert.equal(shown, 'A�B (not valid UTF-8)')
})

// protects=the redaction contract for response previews; fails_when=a credential in a body reaches the chat; no_claim=secrets of unknown shape
test('a credential in a text body is masked', () => {
  // Arrange
  const body = Buffer.from('token ghp_0123456789abcdefghijKLMNOP here')
  // Act
  const shown = shapeResponseBody(body, 'text/plain')
  // Assert
  assert.equal(shown, 'token [masked] here')
})

// protects=redirects show a path or no address; fails_when=another origin's address is relayed or a same-origin path is hidden; no_claim=following redirects (never done)
test('a same-origin redirect shows its path and another origin shows a note', () => {
  // Arrange / Act
  const relative = describeRedirectLocation('/login?next=%2Fhome', 4100)
  const absolute = describeRedirectLocation('http://localhost:4100/login', 4100)
  const loopback = describeRedirectLocation('http://127.0.0.1:4100/a', 4100)
  const other = describeRedirectLocation('https://example.com/x?y=1', 4100)
  const otherPort = describeRedirectLocation('http://localhost:5000/x', 4100)
  // Assert
  assert.deepEqual(
    [relative, absolute, loopback, other, otherPort],
    [
      '/login?next=%2Fhome',
      '/login',
      '/a',
      '(another origin)',
      '(another origin)',
    ],
  )
})

// protects=redaction happens before the cut (task 8 contract); fails_when=a credential starting before byte 8192 shows any of its prefix; no_claim=secrets of unknown shape
test('a credential starting just before the 8192-byte cut shows none of its prefix', () => {
  // Arrange
  const body = Buffer.from(
    `${'a'.repeat(8_189)} ghp_0123456789abcdefghijKLMNOP`,
  )
  // Act
  const shown = shapeResponseBody(body, 'text/plain')
  // Assert
  assert.equal(shown, `${'a'.repeat(8_189)} [m … 28 more bytes`)
})

// protects=a run of invalid bytes at the cut does not erase the shown text; fails_when=the back-off walks past 3 bytes; no_claim=valid text
test('a long run of invalid continuation bytes keeps the shown text near 8192 bytes', () => {
  // Arrange
  const body = Buffer.concat([
    Buffer.from('a'.repeat(10)),
    Buffer.alloc(9_000, 0x80),
  ])
  // Act
  const shown = shapeResponseBody(body, 'text/plain')
  // Assert
  assert.equal(
    shown,
    `${'a'.repeat(10)}${'\uFFFD'.repeat(2_727)} … 819 more bytes (not valid UTF-8)`,
  )
})

// protects=a read cut is never presented as an exact remainder; fails_when=the suffix claims an exact count; no_claim=the 1 MiB limit itself
test('a cut read words the remainder as a lower bound and says it was cut at 1 MiB', () => {
  // Arrange
  const body = Buffer.from('b'.repeat(10_000))
  // Act
  const shown = shapeResponseBody(body, 'text/plain', true)
  const binary = shapeResponseBody(Buffer.from([1, 2, 3]), 'image/png', true)
  // Assert
  assert.equal(
    shown,
    `${'b'.repeat(8_192)} … at least 1808 more bytes (cut at 1 MiB)`,
  )
  assert.equal(binary, '(binary, at least 3 bytes, cut at 1 MiB)')
})

// protects=an uncut body that ends in an incomplete UTF-8 sequence is flagged; fails_when=the truncated last character is shown as U+FFFD without the note; no_claim=which bytes were invalid
test('an uncut body ending in an incomplete UTF-8 sequence is shown with the note', () => {
  // Arrange: "A" then the first two bytes of the three-byte あ
  const body = Buffer.from([0x41, 0xe3, 0x81])
  // Act
  const shown = shapeResponseBody(body, 'text/plain')
  // Assert
  assert.equal(shown, 'A� (not valid UTF-8)')
})

// protects=a body cut at 1 MiB inside its last character is flagged when invalid bytes precede the cut; fails_when=the earlier invalid byte is hidden behind the cut character; no_claim=the 1 MiB size itself
test('a read cut inside its last character still shows the note when invalid bytes precede it', () => {
  // Arrange: "A", an invalid byte, then the first two bytes of あ
  const body = Buffer.from([0x41, 0xff, 0xe3, 0x81])
  // Act
  const shown = shapeResponseBody(body, 'text/plain', true)
  // Assert
  assert.equal(shown, 'A�� (cut at 1 MiB) (not valid UTF-8)')
})

// protects=a read cut inside a character is not called invalid by itself; fails_when=the cut character alone adds the invalid note; no_claim=how the cut character is drawn
test('a read cut inside its last character without other invalid bytes has no invalid note', () => {
  // Arrange
  const body = Buffer.from([0x41, 0xe3, 0x81])
  // Act
  const shown = shapeResponseBody(body, 'text/plain', true)
  // Assert
  assert.equal(shown, 'A� (cut at 1 MiB)')
})

// protects=a private path straddling the 8192-byte cut shows none of its prefix; fails_when=private roots are hidden after the cut so the cut leaves the root's first characters; no_claim=which roots the real sanitizer hides
test('a private path straddling the shown cut is hidden before the cut', () => {
  // Arrange: "/Users/ada/private" starts 12 bytes before the 8192 limit
  const body = Buffer.from(`${'a'.repeat(8_180)}/Users/ada/private/file.ts`)
  const hideRoot = (text: string): string =>
    text.replaceAll('/Users/ada/private', '<workspace>')
  // Act
  const shown = shapeResponseBody(body, 'text/plain', false, hideRoot)
  // Assert
  assert.equal(shown, `${'a'.repeat(8_180)}<workspace>/ … 14 more bytes`)
})
