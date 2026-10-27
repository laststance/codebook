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
