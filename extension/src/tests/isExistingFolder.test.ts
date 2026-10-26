import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { isExistingFolder } from '../utils/isExistingFolder'

// Value: protects=Reveal Wiki Folder reveals only a real folder; fails_when=a file or a missing path counts as a folder, so the editor's reveal opens nothing without a sentence; why_new=no test reaches the real stat; seam=none; no_claim=symlink handling on every OS
test('a folder counts as an existing folder while a file and a missing path do not', async (context) => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-folder-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'wiki.txt')
  await writeFile(file, 'x')

  // Act
  const results = [
    await isExistingFolder(root),
    await isExistingFolder(file),
    await isExistingFolder(join(root, 'missing')),
  ]

  // Assert
  assert.deepEqual(results, [true, false, false])
})
