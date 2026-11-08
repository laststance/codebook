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

// Value: protects=L2 a POSIX root holding glob metacharacters stays a literal folder in js-debug's pattern; fails_when=a bracketed or parenthesised folder name reaches the glob unescaped, an ordinary root changes, or the Windows root changes; no_claim=a real Windows run or js-debug's matcher itself
test('a POSIX root with glob metacharacters is escaped while an ordinary root and a Windows root stay as they are', () => {
  // Arrange
  const bracketedRoot = '/work/[app]/repo'
  const mixedRoot = '/work/a*b?c{d}(e)!f+g@h/repo'
  const ordinaryRoot = '/work/my-app_1/repo'
  const windowsRoot = 'C:\\work\\[app]\\repo'
  // Act
  const bracketed = sourceMapLocationsOf(bracketedRoot, '/')
  const mixed = sourceMapLocationsOf(mixedRoot, '/')
  const ordinary = sourceMapLocationsOf(ordinaryRoot, '/')
  const windows = sourceMapLocationsOf(windowsRoot, '\\')
  // Assert
  assert.deepEqual(bracketed, [
    '/work/\\[app\\]/repo/**',
    '!**/node_modules/**',
  ])
  assert.deepEqual(mixed, [
    '/work/a\\*b\\?c\\{d\\}\\(e\\)\\!f\\+g\\@h/repo/**',
    '!**/node_modules/**',
  ])
  assert.deepEqual(ordinary, ['/work/my-app_1/repo/**', '!**/node_modules/**'])
  assert.deepEqual(windows, ['C:/work/[app]/repo/**', '!**/node_modules/**'])
})
