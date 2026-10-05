import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import { appendFile, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import * as constants from '../constants'
import type * as ReadWikiRegularFileModule from '../utils/readWikiRegularFile'
import { readWikiRegularFile } from '../utils/readWikiRegularFile'

import { loadModule } from './utils/loadModule'

/**
 * Loads the reader of Wiki metadata files with a limit of 16 bytes and an `open` whose file grows by `grownText` right after its `stat` was taken, the moment between the size check and the read.
 * @param grownText - What another process appends to the file after the reader looked at its size.
 * @returns The loaded `readWikiRegularFile`.
 */
async function loadReaderWhoseFileGrowsAfterStat(
  grownText: string,
): Promise<typeof ReadWikiRegularFileModule.readWikiRegularFile> {
  const loaded = await loadModule<typeof ReadWikiRegularFileModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    {
      '../constants': { ...constants, WIKI_METADATA_FILE_LIMIT_BYTES: 16 },
      'node:fs/promises': {
        ...fileSystem,
        open: async (
          path: string,
          flags: number,
        ): Promise<fileSystem.FileHandle> => {
          const file = await fileSystem.open(path, flags)
          const statOfOpenedFile = file.stat.bind(file)
          // The size the reader checks is taken first; the file grows before the reader reads it.
          file.stat = (async () => {
            const statBeforeGrowth = await statOfOpenedFile()
            await appendFile(path, grownText)
            return statBeforeGrowth
          }) as typeof file.stat
          return file
        },
      },
    },
  )
  return loaded.readWikiRegularFile
}

// Value: protects=the bound on the memory a Wiki manifest, receipt or marker read can take; fails_when=the size is checked at stat only and the read goes to the end of the file, so a file that grows after the check is read past WIKI_METADATA_FILE_LIMIT_BYTES; why_new=Cycle 0045 pre-landing review PL-12 (row 20 of Cycle 0046); seam=node:fs/promises open of the loaded reader, whose file grows after its stat
test('a manifest that grows past the limit while it is read is refused', async () => {
  // Arrange: a manifest of 10 bytes, within the limit of 16 when its size is checked, grows to 30 bytes before it is read.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
  const manifestPath = join(folder, 'codebook-wiki.json')
  await writeFile(manifestPath, '{"a":"12"}')
  const readGrowingFile = await loadReaderWhoseFileGrowsAfterStat(
    ' '.repeat(20),
  )
  try {
    // Act
    const read = await readGrowingFile(manifestPath)

    // Assert
    assert.equal(read, undefined)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('a manifest that grows while it is read but stays within the limit is read whole', async () => {
  // Arrange: a manifest of 10 bytes grows by 6 bytes to exactly the limit of 16 before it is read.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
  const manifestPath = join(folder, 'codebook-wiki.json')
  await writeFile(manifestPath, '{"a":"12"}')
  const readGrowingFile = await loadReaderWhoseFileGrowsAfterStat(' '.repeat(6))
  try {
    // Act
    const read = await readGrowingFile(manifestPath)

    // Assert
    assert.equal(read?.bytes.toString('utf8'), '{"a":"12"}      ')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('a manifest that is a symbolic link is not read, also when the file it points to is small', async () => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
  const targetPath = join(folder, 'elsewhere.json')
  const manifestPath = join(folder, 'codebook-wiki.json')
  await writeFile(targetPath, '{"a":"12"}')
  await symlink(targetPath, manifestPath)
  try {
    // Act
    const read = await readWikiRegularFile(manifestPath)

    // Assert
    assert.equal(read, undefined)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
