import assert from 'node:assert/strict'
import { test } from 'node:test'

import { maskSourceMapText } from '../utils/maskSourceMapText'

const maskSecret = (value: string): string =>
  value.replaceAll('hunter2hunter2', '[masked]')

// Value: protects=a kept source map stays valid JSON after a value is masked inside a string field; fails_when=masking runs on the raw text and a quote or escape in the value breaks the JSON; why_new=no test owns maskSourceMapText directly; seam=none; no_claim=what the debugger shows (no browser)
test('masks a secret inside a source map field and keeps the map valid JSON', () => {
  // Arrange
  const text = JSON.stringify({
    version: 3,
    sources: ['a.ts'],
    sourcesContent: ['const k = "hunter2hunter2"\n'],
    mappings: 'AAAA',
  })
  // Act
  const masked = maskSourceMapText(text, maskSecret)
  // Assert
  assert.equal(
    masked,
    '{"version":3,"sources":["a.ts"],"sourcesContent":["const k = \\"[masked]\\"\\n"],"mappings":"AAAA"}',
  )
})

// Value: protects=a map with nothing to mask is returned byte for byte; fails_when=the map is re-serialized and its spacing or escapes change the sealed bytes; why_new=sealed-hash identity needs unchanged text; seam=none; no_claim=none beyond protects
test('returns an unchanged source map as the identical text', () => {
  // Arrange
  const text = '{ "version": 3,  "mappings": "AAAA" }'
  // Act
  const masked = maskSourceMapText(text, maskSecret)
  // Assert
  assert.equal(masked, text)
})

// Value: protects=text that is not JSON is still masked as plain text; fails_when=the JSON parse failure throws or returns the secret; why_new=the catch branch is untested; seam=none; no_claim=none beyond protects
test('masks a secret in a source map that is not valid JSON', () => {
  // Arrange
  const text = 'not json hunter2hunter2'
  // Act
  const masked = maskSourceMapText(text, maskSecret)
  // Assert
  assert.equal(masked, 'not json [masked]')
})
