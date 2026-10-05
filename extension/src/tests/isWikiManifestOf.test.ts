import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isWikiManifestOf } from '../utils/isWikiManifestOf'

test('a Wiki manifest of this schema that names the opened project is this project’s Wiki', () => {
  // Arrange
  const manifest = { schemaVersion: 1, repositoryRoot: '/repo', pages: [] }

  // Act
  const isOwn = isWikiManifestOf(manifest, '/repo')

  // Assert
  assert.equal(isOwn, true)
})

test('a Wiki manifest of another checkout, of another schema or of no object at all is not this project’s Wiki', () => {
  // Arrange
  const manifests: unknown[] = [
    { schemaVersion: 1, repositoryRoot: '/other' },
    { schemaVersion: 2, repositoryRoot: '/repo' },
    { repositoryRoot: '/repo' },
    { schemaVersion: 1 },
    null,
    'codebook-wiki',
    [],
  ]

  // Act
  const answers = manifests.map((manifest) =>
    isWikiManifestOf(manifest, '/repo'),
  )

  // Assert
  assert.deepEqual(answers, [false, false, false, false, false, false, false])
})
