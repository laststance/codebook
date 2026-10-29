import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CHROME_EXTENSION_MIN_VERSION } from '../constants'
import { ERROR_RECOVERY } from '../errors'

// protects=the Chrome version in the recovery texts follows the one constant the launch checks; fails_when=a text keeps a hand-written number after the constant changes; no_claim=the rest of the sentence
for (const code of [
  'CHROME_VERSION_UNSUPPORTED',
  'CHROME_COMMAND_UNAVAILABLE',
] as const) {
  test(`${code} recovery text names the minimum Chrome version`, () => {
    // Arrange
    const minimum = String(CHROME_EXTENSION_MIN_VERSION)
    // Act
    const text = ERROR_RECOVERY[code]
    // Assert
    assert.equal(text.includes(`${minimum} or later`), true)
  })
}

// protects=the rendered text stays exactly what the help page documents; fails_when=the rewrite changes the sentence; no_claim=other codes
test('CHROME_VERSION_UNSUPPORTED recovery text keeps its exact rendered sentence', () => {
  // Arrange
  const expected =
    'Set codebook.chromeExecutable to Google Chrome or Chrome for Testing 149 or later, or update Chrome, then start again: an unpacked extension loads only from Chrome 149. Recovery: environment, then one new start. Nothing was launched. See codebook://help/chrome-extension#CHROME_VERSION_UNSUPPORTED.'
  // Act
  const text = ERROR_RECOVERY.CHROME_VERSION_UNSUPPORTED
  // Assert
  assert.equal(text, expected)
})
