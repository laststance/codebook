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

// Value: protects=L2 js-debug rewrites every backslash to a slash, so a POSIX root with glob characters must reach it unescaped; fails_when=any glob character of the root is backslash-escaped, an ordinary root changes, or the Windows root changes; no_claim=a real Windows run or js-debug's matcher itself
test('a POSIX root with glob metacharacters is passed unescaped because js-debug rewrites backslashes to slashes', () => {
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
  assert.deepEqual(bracketed, ['/work/[app]/repo/**', '!**/node_modules/**'])
  assert.deepEqual(mixed, [
    '/work/a*b?c{d}(e)!f+g@h/repo/**',
    '!**/node_modules/**',
  ])
  assert.deepEqual(ordinary, ['/work/my-app_1/repo/**', '!**/node_modules/**'])
  assert.deepEqual(windows, ['C:/work/[app]/repo/**', '!**/node_modules/**'])
})
