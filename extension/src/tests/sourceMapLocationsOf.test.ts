import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sourceMapLocationsOf } from '../utils/sourceMapLocationsOf'

// Value: protects=OCR1-1 js-debug receives a forward-slash source map pattern on every host; fails_when=a Windows root keeps its backslashes or a POSIX root changes; no_claim=a real Windows run
test('a Windows repository root becomes a forward-slash source map pattern and a POSIX root stays as it is', () => {
  // Arrange
  const posixRoot = '/work/repo'
  const windowsRoot = 'C:\\work\\repo'
  // Act
  const posix = sourceMapLocationsOf(posixRoot, '/')
  const windows = sourceMapLocationsOf(windowsRoot, '\\')
  // Assert
  assert.deepEqual(posix, ['/work/repo/**', '!**/node_modules/**'])
  assert.deepEqual(windows, ['C:/work/repo/**', '!**/node_modules/**'])
})
