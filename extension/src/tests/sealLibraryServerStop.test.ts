import assert from 'node:assert/strict'
import { test } from 'node:test'

import { builtEntryOfMap } from '../utils/builtEntryOfMap'

// protects=a map that names the built file by file:// or a relative spelling still yields the retained text, so the seal compares it instead of reporting library-build-changed; fails_when=only the exact path is matched and the entry reads undefined; no_claim=the module selection, which still needs the exact path
test('a map naming the built file through a file URL or a relative path still gives the retained built text', () => {
  // Arrange
  const builtFile = '/repo/packages/lib/build/modern/core.js'
  const text = 'export const a = 1'
  // Act
  const viaUrl = builtEntryOfMap(
    {
      sources: ['file:///repo/packages/lib/build/modern/core.js'],
      sourcesContent: [text],
    },
    builtFile,
    '/repo',
  )
  const viaRelative = builtEntryOfMap(
    {
      sources: ['./packages/lib/build/../build/modern/core.js'],
      sourcesContent: [text],
    },
    builtFile,
    '/repo',
  )
  // Assert
  assert.equal(viaUrl, 'export const a = 1')
  assert.equal(viaRelative, 'export const a = 1')
})

// protects=a missing entry reads as not found (undefined), which the seal refuses as library-not-in-build, never as changed text; fails_when=a missing entry or a null sourcesContent slot yields text or an empty string; no_claim=the refusal wording
test('a map without an entry for the built file, or with a missing slot, gives no text', () => {
  // Arrange
  const builtFile = '/repo/packages/lib/build/modern/core.js'
  // Act
  const other = builtEntryOfMap(
    { sources: ['/repo/other.js'], sourcesContent: ['x'] },
    builtFile,
    '/repo',
  )
  const shortContent = builtEntryOfMap(
    { sources: [builtFile], sourcesContent: [] },
    builtFile,
    '/repo',
  )
  const nullSlot = builtEntryOfMap(
    { sources: [builtFile], sourcesContent: [null] },
    builtFile,
    '/repo',
  )
  // Assert
  assert.equal(other, undefined)
  assert.equal(shortContent, undefined)
  assert.equal(nullSlot, undefined)
})
