import assert from 'node:assert/strict'
import { Dirent } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { fileSystemWhoseLinksResistRemoval } from './utils/fileSystemWhoseLinksResistRemoval'

/**
 * Describes a listing for the stand-in's options regression test, sorting names and entries because the file system chooses their order.
 * @param listing - What `readdir` answered.
 * @returns The items in words; one item that says so when the answer is no list or holds something else.
 * @example
 * itemsOf(['b.txt', 'a.txt']) // => ['name a.txt', 'name b.txt']
 */
function itemsOf(listing: unknown): string[] {
  // An unexpected result remains visible in the behavior assertion.
  if (!Array.isArray(listing)) return [`no list: ${String(listing)}`]
  return listing
    .map((item: unknown) => {
      // Names and entries must remain distinct when options are forwarded.
      if (typeof item === 'string') return `name ${item}`
      return item instanceof Dirent
        ? `entry ${item.name}`
        : `neither a name nor an entry: ${String(item)}`
    })
    .sort()
}

// Value: protects=every test that hands this stand-in to a loaded module as node:fs/promises (the removal walk, the listing of a folder tree, the Wiki update marker's claim, the stale storage claims, the start block's search); fails_when=the stand-in answers a listing that was asked with options (a whole tree, an encoding, `withFileTypes: false`) with entries instead of names, so a caller that asks for names is tested against a file system that does not exist, and passes or fails for the stand-in's reason; why_new=Cycle 0046 row 350; seam=none, the stand-in over a real temporary folder
test('a listing through the file system whose links resist removal answers what the caller asked for, as node:fs/promises does: names without options, with an encoding, for a whole tree and where no file types are asked for, entries only where the caller asks for them; and every listing is noted', async () => {
  // Arrange: a folder with a file and a folder that holds a file.
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-resisting-listing-')),
  )
  await writeFile(join(folder, 'a-file.txt'), 'a file\n')
  await mkdir(join(folder, 'a-folder'))
  await writeFile(join(folder, 'a-folder', 'inner.txt'), 'an inner file\n')
  const resisting = fileSystemWhoseLinksResistRemoval()
  const { readdir } = resisting.fileSystem

  try {
    // Act
    const listings = {
      withoutOptions: itemsOf(await readdir(folder)),
      withAnEncoding: itemsOf(await readdir(folder, 'utf8')),
      ofTheWholeTree: itemsOf(await readdir(folder, { recursive: true })),
      withoutFileTypes: itemsOf(
        await readdir(folder, { withFileTypes: false }),
      ),
      withFileTypes: itemsOf(await readdir(folder, { withFileTypes: true })),
    }

    // Assert
    assert.deepEqual(
      { listings, listed: resisting.listed },
      {
        listings: {
          withoutOptions: ['name a-file.txt', 'name a-folder'],
          withAnEncoding: ['name a-file.txt', 'name a-folder'],
          ofTheWholeTree: [
            'name a-file.txt',
            'name a-folder',
            `name ${join('a-folder', 'inner.txt')}`,
          ],
          withoutFileTypes: ['name a-file.txt', 'name a-folder'],
          withFileTypes: ['entry a-file.txt', 'entry a-folder'],
        },
        listed: [folder, folder, folder, folder, folder],
      },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
