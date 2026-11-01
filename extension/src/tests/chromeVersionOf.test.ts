import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chromeVersionOf } from '../runtimeSupport/utils/chromeVersionOf'

// protects=one parse for the major the owned launch compares and the version its CHROME_VERSION_UNSUPPORTED refusal names (OCR 43); fails_when=a spelling reads as another version text or major, or text and major come from different matches; no_claim=the minimum version (assertSupportedChromeVersion tests)
test('every Chrome version spelling reads as its printed four-part version with that version major', () => {
  // Arrange
  const spellings = [
    'Google Chrome 156.0.8078.74',
    'Chromium 148.0.7778.96',
    'Google Chrome for Testing 120.0.6099.109',
    'Chrome/156.0.8078.74',
  ]
  // Act
  const versions = spellings.map((spelling) => chromeVersionOf(spelling))
  // Assert
  assert.deepEqual(versions, [
    { text: '156.0.8078.74', major: 156 },
    { text: '148.0.7778.96', major: 148 },
    { text: '120.0.6099.109', major: 120 },
    { text: '156.0.8078.74', major: 156 },
  ])
})

// protects=an unreadable Chrome version is never guessed, so the refusal names unknown; fails_when=text without a four-part version yields a version; no_claim=none beyond protects
test('text without a four-part version reads as no Chrome version', () => {
  // Arrange
  const texts = ['', 'Segmentation fault', 'Google Chrome', '156.0']
  // Act
  const versions = texts.map((text) => chromeVersionOf(text))
  // Assert
  assert.deepEqual(versions, [undefined, undefined, undefined, undefined])
})
