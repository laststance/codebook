import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createOutputRedactor } from '../utils/createOutputRedactor'
import { maskNextServerOutput } from '../utils/maskNextServerOutput'

// The scripted secrets are made-up opaque strings; they are split so no scanner reads them as a real credential.
const COOKIE_VALUE = ['SESSION', 'COOKIE', 'VALUE', 'opaque', '8f3a91c2'].join(
  '-',
)
const BASIC_CREDENTIAL = ['dXNlcjpT', 'M2NyZXRQ', 'YXNz'].join('')

// protects=the development-server output a Pages refusal quotes and the journal keeps, when a data function logs the request; fails_when=a logged Cookie header, an Authorization value or the elements after Cookie and Authorization in a logged rawHeaders list (with its "... more items" end) are printed, or the harmless lines around them are blanked; no_claim=a credential with none of these shapes
test('development-server output masks a logged Cookie header, Authorization header and rawHeaders list and keeps the other lines', () => {
  // Arrange
  const output = [
    `sid=${COOKIE_VALUE}; theme=dark`,
    `Basic ${BASIC_CREDENTIAL}`,
    '[',
    "  'Host',",
    "  'localhost:3000',",
    "  'Cookie',",
    `  'sid=${COOKIE_VALUE}; theme=dark',`,
    "  'Authorization',",
    `  'Negotiate ${BASIC_CREDENTIAL}',`,
    '  ... 4 more items',
    ']',
    'GET /items 200',
    '',
  ].join('\n')

  // Act
  const masked = maskNextServerOutput(output)

  // Assert
  assert.equal(
    masked,
    [
      '<redacted>',
      '<redacted>',
      '[',
      "  'Host',",
      "  'localhost:3000',",
      "  'Cookie',",
      '  <redacted>,',
      "  'Authorization',",
      '  <redacted>,',
      '  ... 4 more items',
      ']',
      'GET /items 200',
      '',
    ].join('\n'),
  )
})

// protects=a Cookie pair and a printed header list that arrive split over several writes; fails_when=the first half of the pair, or the element a write boundary cut after 'Cookie', is released before the rest arrives; no_claim=a line that never ends within the 8 KiB hold limit, which fails closed as before
test('the output redactor masks a Cookie pair split over two chunks and a rawHeaders element cut by a chunk boundary', () => {
  // Arrange
  const redactor = createOutputRedactor()
  const chunks = [
    `sid=${COOKIE_VALUE.slice(0, 12)}`,
    `${COOKIE_VALUE.slice(12)}; theme=dark\n`,
    "[\n  'Host',\n  'x',\n  'Cookie',\n",
    `  'sid=${COOKIE_VALUE.slice(0, 9)}`,
    `${COOKIE_VALUE.slice(9)}',\n  ... 1 more item\n]\n`,
  ]

  // Act
  const released =
    chunks.map((chunk) => redactor.write(chunk)).join('') + redactor.end()

  // Assert
  assert.equal(
    released,
    "[masked]\n[\n  'Host',\n  'x',\n  'Cookie',\n  [masked],\n  ... 1 more item\n]\n",
  )
})
