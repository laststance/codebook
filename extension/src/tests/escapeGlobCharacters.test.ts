import assert from 'node:assert/strict'
import { test } from 'node:test'

import { escapeGlobCharacters } from '../utils/escapeGlobCharacters'

// Value: protects=the watcher glob for folders with glob characters; fails_when=a character the editor's glob reads as syntax stays unescaped; no_claim=the editor's glob engine; seam=the pure function
test('glob characters of a folder name are put in brackets and plain names stay as they are', () => {
  // Arrange
  const names = ['docs/wiki', 'wiki[1]', '{draft}/a*b?']

  // Act
  const escaped = names.map(escapeGlobCharacters)

  // Assert
  assert.deepEqual(escaped, ['docs/wiki', 'wiki[[]1]', '[{]draft[}]/a[*]b[?]'])
})
