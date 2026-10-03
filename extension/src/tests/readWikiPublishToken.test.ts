import assert from 'node:assert/strict'
import { mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readWikiPublishToken } from '../utils/readWikiPublishToken'

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
