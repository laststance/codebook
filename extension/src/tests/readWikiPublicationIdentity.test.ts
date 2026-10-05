import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  appendFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as ReadWikiPublicationIdentityModule from '../utils/readWikiPublicationIdentity'
import { readWikiPublicationIdentity } from '../utils/readWikiPublicationIdentity'
import type * as ReadWikiRegularFileModule from '../utils/readWikiRegularFile'

import { fileSystemWithLargeFileIds } from './utils/fileSystemWithLargeFileIds'
import { loadModule } from './utils/loadModule'
import { loadOpenWithoutFollowing } from './utils/loadOpenWithoutFollowing'

const MANIFEST_TEXT = '{"schemaVersion":1,"pages":[]}'

/** Creates a Wiki folder that holds a manifest and the publisher's receipt for it. */
async function publishedFolder(): Promise<{
  outputDirectory: string
  manifestPath: string
  receiptPath: string
}> {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-identity-'),
  )
  const manifestPath = join(outputDirectory, 'codebook-wiki.json')
  const receiptPath = join(outputDirectory, 'codebook-publication.json')
  await writeFile(manifestPath, MANIFEST_TEXT)
  await writeFile(
    receiptPath,
    JSON.stringify({
      kind: 'published',
      manifestSha256: createHash('sha256').update(MANIFEST_TEXT).digest('hex'),
    }),
  )
  return { outputDirectory, manifestPath, receiptPath }
}

test('a manifest edited in place after an identity was read has no publication identity at the next read', async () => {
  // Arrange: the identity of the published folder was read once.
  const wiki = await publishedFolder()
  try {
    const published = await readWikiPublicationIdentity(wiki.outputDirectory)

    // Act: an editor appends to the manifest, so the receipt no longer names its hash.
    await appendFile(wiki.manifestPath, '\n')
    const afterTheEdit = await readWikiPublicationIdentity(wiki.outputDirectory)

    // Assert
    assert.match(
      published ?? '',
      /^aab3d0f0977fa7d353133838d8f1ffe55f18a9ca68862e8c75a5092cbc829961@\d+$/,
    )
    assert.equal(afterTheEdit, undefined)
  } finally {
    await rm(wiki.outputDirectory, { recursive: true, force: true })
  }
})

test('a manifest a checkout puts back with the same bytes as a new file keeps the publication identity', async () => {
  // Arrange
  const wiki = await publishedFolder()
  try {
    const published = await readWikiPublicationIdentity(wiki.outputDirectory)

    // Act: the same bytes arrive under a new inode, as `git checkout` writes them.
    await writeFile(
      `${wiki.manifestPath}.next`,
      await readFile(wiki.manifestPath),
    )
    await rename(`${wiki.manifestPath}.next`, wiki.manifestPath)
    const afterTheCheckout = await readWikiPublicationIdentity(
      wiki.outputDirectory,
    )

    // Assert
    assert.equal(typeof published, 'string')
    assert.equal(afterTheCheckout, published)
  } finally {
    await rm(wiki.outputDirectory, { recursive: true, force: true })
  }
})

test('a folder whose receipt was removed after an identity was read has no publication identity', async () => {
  // Arrange
  const wiki = await publishedFolder()
  try {
    const published = await readWikiPublicationIdentity(wiki.outputDirectory)

    // Act
    await rm(wiki.receiptPath)
    const withoutReceipt = await readWikiPublicationIdentity(
      wiki.outputDirectory,
    )

    // Assert
    assert.equal(typeof published, 'string')
    assert.equal(withoutReceipt, undefined)
  } finally {
    await rm(wiki.outputDirectory, { recursive: true, force: true })
  }
})

// Value: protects=the end of an update on an NTFS volume, which counts a publish only when the publication identity changed; fails_when=the identity or the stamp it is kept under names the receipt's inode as a JavaScript number, so a receipt the publisher wrote anew with the same bytes, time and size under a file id that differs only below the rounding keeps the identity of the one before, and the publish is not seen; why_new=Cycle 0046 row 79: a file id above 2^53 was observed on the development host; seam=node:fs/promises of the loaded identity reader and of the opener its reader of Wiki metadata opens through, whose files have ids above 2^53
test('the publication identity names a file id above 2^53 exactly, so a receipt written anew with the same bytes, time and size under an id that differs only where a number rounds is another publication', async () => {
  // Arrange: the receipt is the first file a status is asked for (id 210824757556437109), the manifest the second, the receipt written anew the third.
  const wiki = await publishedFolder()
  const largeIds = fileSystemWithLargeFileIds()
  const readerWithLargeIds = await loadModule<typeof ReadWikiRegularFileModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    {
      './openWithoutFollowing': await loadOpenWithoutFollowing({
        fileSystem: largeIds,
      }),
    },
  )
  const { readWikiPublicationIdentity: readIdentityWithLargeIds } =
    await loadModule<typeof ReadWikiPublicationIdentityModule>(
      resolve(__dirname, '../utils/readWikiPublicationIdentity.js'),
      {
        'node:fs/promises': largeIds,
        './readWikiRegularFile': readerWithLargeIds,
      },
    )
  await utimes(wiki.receiptPath, 1_790_000_000, 1_790_000_000)
  try {
    const published = await readIdentityWithLargeIds(wiki.outputDirectory)

    // Act: the publisher swaps in a freshly written receipt; the old one still exists under another name.
    const receiptText = await readFile(wiki.receiptPath)
    await rename(wiki.receiptPath, `${wiki.receiptPath}.previous`)
    await writeFile(wiki.receiptPath, receiptText)
    await utimes(wiki.receiptPath, 1_790_000_000, 1_790_000_000)
    const publishedAgain = await readIdentityWithLargeIds(wiki.outputDirectory)

    // Assert
    assert.deepEqual(
      [published, publishedAgain],
      [
        'aab3d0f0977fa7d353133838d8f1ffe55f18a9ca68862e8c75a5092cbc829961@210824757556437109',
        'aab3d0f0977fa7d353133838d8f1ffe55f18a9ca68862e8c75a5092cbc829961@210824757556437111',
      ],
    )
  } finally {
    await rm(wiki.outputDirectory, { recursive: true, force: true })
  }
})

// Value: protects=the cost of every `api/update-status` answer and every served Wiki page on an NTFS volume, which reads and hashes the manifest (it carries every page's text) only after a file changed; fails_when=the stamp of the files on disk and the stamp of the files that were read name the inode or the time differently for a file id above 2^53 (one rounded, one exact), so the kept identity never counts and both files are read and hashed at every look; why_new=Cycle 0046 row 79: both stamps are built from a status with exact numbers; seam=node:fs/promises of the loaded identity reader and of the opener its reader of Wiki metadata opens through, whose files have ids above 2^53, and that reader, which counts its reads
test('the publication identity of files whose ids are above 2^53 is read once and kept while neither file changes', async () => {
  // Arrange
  const wiki = await publishedFolder()
  const largeIds = fileSystemWithLargeFileIds()
  const readerWithLargeIds = await loadModule<typeof ReadWikiRegularFileModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    {
      './openWithoutFollowing': await loadOpenWithoutFollowing({
        fileSystem: largeIds,
      }),
    },
  )
  const readPaths: string[] = []
  const { readWikiPublicationIdentity: readIdentityWithLargeIds } =
    await loadModule<typeof ReadWikiPublicationIdentityModule>(
      resolve(__dirname, '../utils/readWikiPublicationIdentity.js'),
      {
        'node:fs/promises': largeIds,
        './readWikiRegularFile': {
          readWikiRegularFile: (path: string) => {
            readPaths.push(path)
            return readerWithLargeIds.readWikiRegularFile(path)
          },
        },
      },
    )
  try {
    // Act
    const first = await readIdentityWithLargeIds(wiki.outputDirectory)
    const second = await readIdentityWithLargeIds(wiki.outputDirectory)

    // Assert: the receipt and the manifest were each read once, at the first look.
    assert.deepEqual(
      { first, second, readPaths },
      {
        first:
          'aab3d0f0977fa7d353133838d8f1ffe55f18a9ca68862e8c75a5092cbc829961@210824757556437109',
        second:
          'aab3d0f0977fa7d353133838d8f1ffe55f18a9ca68862e8c75a5092cbc829961@210824757556437109',
        readPaths: [wiki.receiptPath, wiki.manifestPath],
      },
    )
  } finally {
    await rm(wiki.outputDirectory, { recursive: true, force: true })
  }
})
