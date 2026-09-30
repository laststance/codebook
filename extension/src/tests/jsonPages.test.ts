import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readJsonPage } from '../utils/readJsonPage'

const baseUri = 'codebook://instance/evidence/inspection'

test('paged evidence preserves every Unicode and escaped JSON byte within a bounded response', () => {
  // Arrange
  const value = {
    text: '😀日本語\\"\n'.repeat(2000),
    state: { type: 'undefined' },
    empty: null,
  }
  let suffix: string | undefined,
    restored = '',
    pages = 0
  // Act
  do {
    const resource = readJsonPage(baseUri, value, suffix)
    assert.ok('text' in resource)
    const page = JSON.parse(resource.text)
    assert.ok(Buffer.byteLength(page.content) <= 4096)
    assert.ok(Buffer.byteLength(resource.text) < 9000)
    assert.equal(page.offset, Buffer.byteLength(restored))
    restored += page.content
    pages++
    suffix = page.nextUri?.slice(baseUri.length + 1)
    assert.equal(page.complete, !suffix)
  } while (suffix)
  // Assert
  assert.ok(pages > 1)
  assert.deepEqual(JSON.parse(restored), value)
})

test('changed evidence and invalid byte cursors cannot silently mix or omit saved content', () => {
  // Arrange
  const resource = readJsonPage(baseUri, { text: '😀'.repeat(2000) })
  assert.ok('text' in resource)
  const first = JSON.parse(resource.text),
    suffix = first.nextUri.slice(baseUri.length + 1)
  // Act / Assert
  assert.throws(() => readJsonPage(baseUri, { text: 'changed' }, suffix), {
    code: 'EVIDENCE_UNAVAILABLE',
  })
  for (const offset of [
    '-1',
    '01',
    '9007199254740992',
    String(first.totalBytes),
    '10',
  ]) {
    assert.throws(
      () =>
        readJsonPage(
          baseUri,
          { text: '😀'.repeat(2000) },
          `pages/${first.contentHash}/${offset}`,
        ),
      { code: 'INVALID_REFERENCE' },
    )
  }
})
