import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chromeExtensionPrerequisiteGaps } from '../utils/chromeExtensionPrerequisiteGaps'

// Value: protects=DXR16, ER7: Chrome 148 makes the profile unavailable with the fix sentence of CHROME_VERSION_UNSUPPORTED, and Chrome 156 does not; fails_when=148 reads ready or the sentence differs; no_claim=the real lookup
test('names the Chrome 149 fix for Chrome 148 and reports no gap for Chrome 156', () => {
  // Act
  const old = chromeExtensionPrerequisiteGaps({
    platform: 'linux',
    chromeMissing: [],
    chromeVersion: 'Google Chrome 148.0.7778.96',
  })
  const current = chromeExtensionPrerequisiteGaps({
    platform: 'darwin',
    chromeMissing: [],
    chromeVersion: 'Google Chrome 156.0.8078.74',
  })
  // Assert
  assert.deepEqual(old, [
    'Chrome 149 or later is needed to load an unpacked extension; found 148.0.7778.96. Set codebook.chromeExecutable to Google Chrome or Chrome for Testing 149 or later, or update Chrome.',
  ])
  assert.deepEqual(current, [])
})

// Value: protects=ER7: the profile is unavailable on Windows whatever Chrome is installed; fails_when=Windows reads ready; no_claim=the Windows path rule
test('reports the profile unavailable on Windows', () => {
  // Act
  const gaps = chromeExtensionPrerequisiteGaps({
    platform: 'win32',
    chromeMissing: [],
    chromeVersion: 'Google Chrome 156.0.8078.74',
  })
  // Assert
  assert.deepEqual(gaps, [
    'The chrome-extension profile is not available on Windows in this version.',
  ])
})

// Value: protects=DXR16: a missing Chrome keeps the lookup's own sentence; fails_when=the version message replaces it; no_claim=the lookup
test('keeps the Chrome lookup’s own sentence when no Chrome was found', () => {
  // Act
  const gaps = chromeExtensionPrerequisiteGaps({
    platform: 'linux',
    chromeMissing: [
      'codebook.chromeExecutable: configure an installed executable Chrome.',
    ],
    chromeVersion: undefined,
  })
  // Assert
  assert.deepEqual(gaps, [
    'codebook.chromeExecutable: configure an installed executable Chrome.',
  ])
})
