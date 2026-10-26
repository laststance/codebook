import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { findNearestExistingAncestor } from '../utils/findNearestExistingAncestor'

// Value: protects=Eng decision 78, the watcher of a fresh project; fails_when=a path whose parents are missing is returned as it is, so the watcher stands on a folder that does not exist; no_claim=the watcher; seam=a temporary folder
test('findNearestExistingAncestor returns the folder itself when it exists and the nearest existing parent when it does not', async (context) => {
  // Arrange
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-ancestor-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.codebook'))

  // Act
  const found = [
    await findNearestExistingAncestor(join(root, '.codebook')),
    await findNearestExistingAncestor(join(root, '.codebook', 'wiki', 'deep')),
    await findNearestExistingAncestor(join(root, 'docs', 'wiki')),
  ]

  // Assert
  assert.deepEqual(found, [
    join(root, '.codebook'),
    join(root, '.codebook'),
    root,
  ])
})
