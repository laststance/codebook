import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  appendFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readWikiPublicationIdentity } from '../utils/readWikiPublicationIdentity'

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
