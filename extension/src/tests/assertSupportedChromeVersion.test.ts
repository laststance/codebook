import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { assertSupportedChromeVersion } from '../runtimeSupport/utils/assertSupportedChromeVersion'

/** Returns the refusal a version text raises, or undefined when it is accepted. */
function refusalOf(versionText: string): StudyError | undefined {
  try {
    assertSupportedChromeVersion(versionText)
  } catch (error) {
    assert.ok(error instanceof StudyError, String(error))
    return error
  }
  return undefined
}

// Value: protects=acceptance 4; fails_when=Chrome 148 is accepted or the sentence changes; no_claim=the Chrome API of 148
test('Chrome 148 is refused with the sentence naming the found version', () => {
  // Arrange
  const printed = 'Google Chrome 148.0.7778.96'
  // Act
  const error = refusalOf(printed)
  // Assert
  assert.equal(error?.code, 'CHROME_VERSION_UNSUPPORTED')
  assert.equal(
    error?.message,
    'Chrome 149 or later is needed to load an unpacked extension; found 148.0.7778.96.',
  )
})

// Value: protects=the 149 boundary; fails_when=the lowest supported major is refused; no_claim=newer majors
test('Chrome 149 is accepted', () => {
  // Arrange
  const printed = 'Google Chrome 149.0.7800.1'
  // Act
  const error = refusalOf(printed)
  // Assert
  assert.equal(error, undefined)
})

// Value: protects=Chrome for Testing, Chromium and CDP product spellings; fails_when=a spelling is not read as its version; no_claim=other vendors
test('Chrome for Testing, Chromium and the CDP product spelling are read by their major', () => {
  // Arrange
  const spellings = [
    'Google Chrome for Testing 156.0.8078.74',
    'Chromium 156.0.8078.74',
    'Chrome/156.0.8078.74',
    'HeadlessChrome/156.0.8078.74',
  ]
  // Act
  const refusals = spellings.map(refusalOf)
  const oldRefusal = refusalOf('Google Chrome for Testing 120.0.6099.109')
  // Assert
  assert.deepEqual(refusals, [undefined, undefined, undefined, undefined])
  assert.equal(
    oldRefusal?.message,
    'Chrome 149 or later is needed to load an unpacked extension; found 120.0.6099.109.',
  )
})

// Value: protects=the unreadable-version decision; fails_when=an output without a version is accepted; no_claim=why nothing was printed
test('an unreadable version output is refused naming unknown', () => {
  // Arrange
  const outputs = ['', 'Segmentation fault', 'Google Chrome']
  // Act
  const messages = outputs.map((output) => refusalOf(output)?.message)
  // Assert
  assert.deepEqual(messages, [
    'Chrome 149 or later is needed to load an unpacked extension; found unknown.',
    'Chrome 149 or later is needed to load an unpacked extension; found unknown.',
    'Chrome 149 or later is needed to load an unpacked extension; found unknown.',
  ])
})
