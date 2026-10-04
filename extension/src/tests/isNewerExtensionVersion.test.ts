import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isNewerExtensionVersion } from '../utils/isNewerExtensionVersion'

test('a later extension version is newer, also when only its last number is higher', () => {
  // Act
  const isPatchNewer = isNewerExtensionVersion('0.2.29', '0.2.28')
  const isMinorNewer = isNewerExtensionVersion('0.3.0', '0.2.28')

  // Assert
  assert.equal(isPatchNewer, true)
  assert.equal(isMinorNewer, true)
})

test('version numbers are compared as numbers, so 0.2.9 is not newer than 0.2.28', () => {
  // Act
  const isNewer = isNewerExtensionVersion('0.2.9', '0.2.28')

  // Assert
  assert.equal(isNewer, false)
})

test('the same version is not newer, with or without a fourth number of zero', () => {
  // Act
  const isSameNewer = isNewerExtensionVersion('0.2.28', '0.2.28')
  const isThreePartNewer = isNewerExtensionVersion('0.2.28', '0.2.28.0')
  const isFourPartNewer = isNewerExtensionVersion('0.2.28.1', '0.2.28')

  // Assert
  assert.equal(isSameNewer, false)
  assert.equal(isThreePartNewer, false)
  assert.equal(isFourPartNewer, true)
})

test('a version that is not dotted numbers never counts as newer, so it cannot block an update', () => {
  // Act
  const isTextNewer = isNewerExtensionVersion('next', '0.2.28')
  const isEmptyNewer = isNewerExtensionVersion('', '0.2.28')
  const isAgainstTextNewer = isNewerExtensionVersion('0.2.29', 'unknown')

  // Assert
  assert.equal(isTextNewer, false)
  assert.equal(isEmptyNewer, false)
  assert.equal(isAgainstTextNewer, false)
})
