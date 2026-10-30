import assert from 'node:assert/strict'
import { test } from 'node:test'

import { maskKnownValues } from '../utils/maskKnownValues'

// Value: protects=a multi-line secret (PEM) is hidden from a single-line message; fails_when=only the whole multi-line value is a candidate; why_new=each line is a candidate; seam=none; no_claim=lines shorter than the minimum length
test('masks one line of a multi-line value quoted in a single-line message', () => {
  // Arrange
  const value = 'MIIEvQIBADANBgkqhkiG9w0BAQEF\nAASCBKcwggSjAgEAAoIBAQC7VJTUt9'
  // Act
  const masked = maskKnownValues(
    'bad key AASCBKcwggSjAgEAAoIBAQC7VJTUt9 near',
    [value],
  )
  // Assert
  assert.equal(masked, 'bad key [masked] near')
})

// Value: protects=a secret in a JSON-encoded log line is hidden; fails_when=the escaped form is not a candidate; why_new=JSON-escaped form is a candidate; seam=none; no_claim=other encodings
test('masks the JSON-escaped form of a multi-line value', () => {
  // Arrange
  const value = 'firstlinesecret\nsecondlinesecret'
  // Act
  const masked = maskKnownValues(
    '{"key":"firstlinesecret\\nsecondlinesecret"}',
    [value],
  )
  // Assert
  assert.equal(masked, '{"key":"[masked]"}')
})
