import assert from 'node:assert/strict'
import { mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as ReadWikiPublishTokenModule from '../utils/readWikiPublishToken'
import { readWikiPublishToken } from '../utils/readWikiPublishToken'
import type * as ReadWikiRegularFileModule from '../utils/readWikiRegularFile'

import { fileSystemWithLargeFileIds } from './utils/fileSystemWithLargeFileIds'
import { loadModule } from './utils/loadModule'
import { loadOpenWithoutFollowing } from './utils/loadOpenWithoutFollowing'

/** Makes an empty Wiki output folder and returns it with its cleanup. */
async function wikiFolder(): Promise<{
  output: string
  cleanup: () => Promise<void>
}> {
  const output = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-token-')),
  )
  return {
    output,
    cleanup: (): Promise<void> => rm(output, { recursive: true, force: true }),
  }
}

test('a publish that changes only what the manifest excludes still changes the publish token', async () => {
  // Arrange
  const wiki = await wikiFolder()
  const manifest = join(wiki.output, 'codebook-wiki.json')
  await writeFile(manifest, '{"includedSources":[],"excludedPaths":[]}')
  try {
    const before = await readWikiPublishToken(wiki.output)

    // Act
    await writeFile(manifest, '{"includedSources":[],"excludedPaths":["tmp"]}')
    const after = await readWikiPublishToken(wiki.output)

    // Assert
    assert.match(before ?? '', /^[0-9a-f]{64}@\d+$/)
    assert.match(after ?? '', /^[0-9a-f]{64}@\d+$/)
    assert.notEqual(after, before)
  } finally {
    await wiki.cleanup()
  }
})

test('a publish that writes the same manifest bytes into a new file still changes the publish token', async () => {
  // Arrange
  const wiki = await wikiFolder()
  const manifest = join(wiki.output, 'codebook-wiki.json')
  await writeFile(manifest, '{"includedSources":[]}')
  try {
    const before = await readWikiPublishToken(wiki.output)

    // Act: the publisher swaps in a freshly written file; the old one still exists under another name.
    await rename(manifest, join(wiki.output, 'previous.json'))
    await writeFile(manifest, '{"includedSources":[]}')
    const after = await readWikiPublishToken(wiki.output)

    // Assert
    assert.equal(before?.slice(0, 64), after?.slice(0, 64))
    assert.notEqual(after, before)
  } finally {
    await wiki.cleanup()
  }
})

test('an unchanged manifest keeps its publish token between two looks', async () => {
  // Arrange
  const wiki = await wikiFolder()
  await writeFile(join(wiki.output, 'codebook-wiki.json'), '{"pages":[]}')
  try {
    // Act
    const first = await readWikiPublishToken(wiki.output)
    const second = await readWikiPublishToken(wiki.output)

    // Assert
    assert.equal(
      first?.slice(0, 64),
      'c17412ca99e15f83b085916c9b4034a957c41f56ba565a072b1aac6d65edd1bd',
    )
    assert.equal(second, first)
  } finally {
    await wiki.cleanup()
  }
})

test('a folder without a Wiki manifest has no publish token', async () => {
  // Arrange
  const wiki = await wikiFolder()
  try {
    // Act
    const token = await readWikiPublishToken(wiki.output)

    // Assert
    assert.equal(token, undefined)
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the end of an update on an NTFS volume, which says "the site on disk was replaced" by a changed publish token; fails_when=the token names the manifest's inode as a JavaScript number, so a manifest written anew with the same bytes under a file id that differs only below the rounding has the token of the one before; why_new=Cycle 0046 row 79: a file id above 2^53 was observed on the development host; seam=node:fs/promises of the opener the loaded reader of Wiki metadata opens through, whose files have ids above 2^53
test('the publish token names a file id above 2^53 exactly, so a manifest written anew with the same bytes under an id that differs only where a number rounds has another token', async () => {
  // Arrange: the manifest is the first file a status is asked for (id 210824757556437109), the one written anew the second.
  const wiki = await wikiFolder()
  const manifest = join(wiki.output, 'codebook-wiki.json')
  await writeFile(manifest, '{"a":"12"}')
  const readerWithLargeIds = await loadModule<typeof ReadWikiRegularFileModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    {
      './openWithoutFollowing': await loadOpenWithoutFollowing({
        fileSystem: fileSystemWithLargeFileIds(),
      }),
    },
  )
  const { readWikiPublishToken: readTokenWithLargeIds } = await loadModule<
    typeof ReadWikiPublishTokenModule
  >(resolve(__dirname, '../utils/readWikiPublishToken.js'), {
    './readWikiRegularFile': readerWithLargeIds,
  })
  try {
    const before = await readTokenWithLargeIds(wiki.output)

    // Act: the publisher swaps in a freshly written file; the old one still exists under another name.
    await rename(manifest, join(wiki.output, 'previous.json'))
    await writeFile(manifest, '{"a":"12"}')
    const after = await readTokenWithLargeIds(wiki.output)

    // Assert
    assert.deepEqual(
      [before, after],
      [
        '80dab3b2f2faa6281f540e1919e61d24411ee53014f7b0292f2f5f2af134d73b@210824757556437109',
        '80dab3b2f2faa6281f540e1919e61d24411ee53014f7b0292f2f5f2af134d73b@210824757556437110',
      ],
    )
  } finally {
    await wiki.cleanup()
  }
})
