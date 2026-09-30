import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { resolveDeepWikiSource } from '../utils/resolveDeepWikiSource'

test('browser citations open only a source in the selected checkout and flag changed content', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-source-'),
  )
  const otherDirectory = await mkdtemp(join(tmpdir(), 'codebook-wiki-other-'))
  try {
    await mkdir(join(projectDirectory, 'src'))
    await writeFile(
      join(projectDirectory, 'src', 'entry.ts'),
      'export const entry = true;\n',
    )
    await writeFile(
      join(otherDirectory, 'private.ts'),
      'export const secret = true;\n',
    )
    await symlink(
      join(otherDirectory, 'private.ts'),
      join(projectDirectory, 'src', 'outside.ts'),
    )
    const projectRoot = await realpath(projectDirectory)
    const sourceHash = createHash('sha256')
      .update('export const entry = true;\n')
      .digest('hex')

    // Act / Assert
    assert.deepEqual(
      await resolveDeepWikiSource(
        projectRoot,
        projectRoot,
        'src/entry.ts',
        sourceHash,
      ),
      {
        filePath: join(projectRoot, 'src', 'entry.ts'),
        changed: false,
      },
    )
    assert.equal(
      (
        await resolveDeepWikiSource(
          projectRoot,
          projectRoot,
          'src/entry.ts',
          '0'.repeat(64),
        )
      ).changed,
      true,
    )
    await assert.rejects(
      resolveDeepWikiSource(
        projectRoot,
        otherDirectory,
        'src/entry.ts',
        sourceHash,
      ),
      /another checkout/,
    )
    await assert.rejects(
      resolveDeepWikiSource(
        projectRoot,
        projectRoot,
        'src/outside.ts',
        sourceHash,
      ),
      /outside the opened project/,
    )
    await assert.rejects(
      resolveDeepWikiSource(
        projectRoot,
        projectRoot,
        '../private.ts',
        sourceHash,
      ),
    )
  } finally {
    await rm(projectDirectory, { recursive: true, force: true })
    await rm(otherDirectory, { recursive: true, force: true })
  }
})
