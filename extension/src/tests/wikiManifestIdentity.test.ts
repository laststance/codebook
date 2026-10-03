import assert from 'node:assert/strict'
import { test } from 'node:test'

import { wikiManifestIdentity } from '../utils/wikiManifestIdentity'

const sourceA = { path: 'src/a.ts', sha256: 'a'.repeat(64) }
const sourceB = { path: 'src/b.ts', sha256: 'b'.repeat(64) }

test('a Wiki identity does not depend on the order the generator listed its sources in', () => {
  // Arrange
  const listedForward = [sourceA, sourceB]
  const listedBackward = [sourceB, sourceA]

  // Act
  const forward = wikiManifestIdentity(listedForward, 'a1b2c3d4e5f6a7b8')
  const backward = wikiManifestIdentity(listedBackward, 'a1b2c3d4e5f6a7b8')

  // Assert
  assert.equal(forward, backward)
  assert.match(forward, /^a1b2c3d4e5f6\+[0-9a-f]{8}$/)
})

test('an edited included source changes the Wiki identity even when the revision stays', () => {
  // Arrange
  const before = wikiManifestIdentity([sourceA], 'a1b2c3d4e5f6a7b8')

  // Act
  const after = wikiManifestIdentity(
    [{ path: 'src/a.ts', sha256: 'c'.repeat(64) }],
    'a1b2c3d4e5f6a7b8',
  )

  // Assert
  assert.notEqual(before, after)
})

test('a project without a git revision still gets an identity that names the missing revision', () => {
  // Arrange
  const sources = [sourceA]

  // Act
  const identity = wikiManifestIdentity(sources)

  // Assert
  assert.match(identity, /^no-revision\+[0-9a-f]{8}$/)
})
