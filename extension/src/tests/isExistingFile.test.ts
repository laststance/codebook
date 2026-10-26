import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { isExistingFile } from '../utils/isExistingFile'

// Value: protects=RT2-B (2) (Reveal Wiki Folder tells a file from nothing); fails_when=a folder or a missing path counts as a file, or a real file does not; why_new=no other test reaches the real stat of this helper; seam=none; no_claim=symlink handling on every OS
test('a file counts as an existing file while a folder and a missing path do not', async (context) => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-file-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'wiki.txt')
  await writeFile(file, 'x')

  // Act
  const results = [
    await isExistingFile(file),
    await isExistingFile(root),
    await isExistingFile(join(root, 'missing')),
  ]

  // Assert
  assert.deepEqual(results, [true, false, false])
})
