import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chromeMajorOf } from '../runtimeSupport/utils/chromeMajorOf'

// protects=the saved-session store and the owned launch read one major from every spelling Chrome prints; fails_when=a spelling reads as another major or as undefined; no_claim=the minimum version (assertSupportedChromeVersion tests)
test('chromeMajorOf reads the major of every Chrome version spelling', () => {
  // Arrange
  const spellings = [
    'Google Chrome 156.0.8078.74',
    'Chromium 156.0.8078.74',
    'Chrome/156.0.8078.74',
    'HeadlessChrome/156.0.8078.74',
  ]
  // Act
  const majors = spellings.map((spelling) => chromeMajorOf(spelling))
  // Assert
  assert.deepEqual(majors, [156, 156, 156, 156])
})

// protects=an unreadable Chrome version is never guessed; fails_when=text without a four-part version yields a number; no_claim=none beyond protects
test('chromeMajorOf answers undefined for text without a four-part version', () => {
  // Arrange
  const texts = ['', 'Google Chrome', '156.0']
  // Act
  const majors = texts.map((text) => chromeMajorOf(text))
  // Assert
  assert.deepEqual(majors, [undefined, undefined, undefined])
})
