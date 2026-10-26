import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { wikiFolderKindOf } from '../utils/wikiFolderKindOf'

// Value: protects=RT3-c (Reveal Wiki Folder tells a folder, a file, nothing and an unreadable path apart from one look); fails_when=a folder counts as a file, a file as a folder, a missing path as unreadable, or a path under a file reads as missing; why_new=replaces the isExistingFolder and isExistingFile tests with the one look that has all four answers; seam=a temporary folder with a folder, a file and a path below that file; no_claim=EACCES (the host test reaches the same branch with ENOTDIR on every OS)
test('the Wiki output path is told as a folder, a file, missing, or unreadable with its error code', async (context) => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-kind-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'wiki')
  await mkdir(folder)
  const file = join(root, 'wiki.txt')
  await writeFile(file, 'x')

  // Act
  const results = [
    await wikiFolderKindOf(folder),
    await wikiFolderKindOf(file),
    await wikiFolderKindOf(join(root, 'missing')),
    await wikiFolderKindOf(join(file, 'below')),
  ]

  // Assert
  assert.deepEqual(results, [
    { kind: 'folder' },
    { kind: 'file' },
    { kind: 'missing' },
    { kind: 'unreadable', code: 'ENOTDIR' },
  ])
})
