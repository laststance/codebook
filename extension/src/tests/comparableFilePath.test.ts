import assert from 'node:assert/strict'
import { test } from 'node:test'

import { comparableFilePath } from '../utils/comparableFilePath'

// Value: protects=the LLM Wiki view's watcher filter on Windows, where Uri.fsPath lowercases the drive letter; fails_when=the two spellings of one file compare differently, so every watcher event is dropped; no_claim=the editor's own spelling; seam=the pure function with an explicit platform
test('on Windows a lowercase drive letter and a backslash path name the same file as the uppercase one', () => {
  // Arrange
  const computed = 'C:\\Repo\\.codebook\\wiki.update-run.json'
  const reported = 'c:/Repo/.codebook/wiki.update-run.json'

  // Act
  const result = [
    comparableFilePath(computed, 'win32'),
    comparableFilePath(reported, 'win32'),
  ]

  // Assert
  assert.deepEqual(result, [
    'c:/repo/.codebook/wiki.update-run.json',
    'c:/repo/.codebook/wiki.update-run.json',
  ])
})

// Value: protects=case-sensitive systems; fails_when=Linux paths that differ in case compare equal; no_claim=macOS volumes formatted case-sensitive; seam=the pure function with an explicit platform
test('on Linux paths that differ in case stay different, on macOS they match', () => {
  // Arrange
  const path = '/Repo/a.json'

  // Act
  const result = [
    comparableFilePath(path, 'linux'),
    comparableFilePath(path, 'darwin'),
  ]

  // Assert
  assert.deepEqual(result, ['/Repo/a.json', '/repo/a.json'])
})
