import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { detectWikiPublishConflicts } from '../utils/detectWikiPublishConflicts'

/** Builds `<project>/wiki` with one owned page and returns its paths. */
async function publishedWiki(): Promise<{
  parent: string
  output: string
  cleanup: () => Promise<void>
}> {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-conflict-')),
  )
  const output = join(parent, 'wiki')
  await mkdir(join(output, 'pages'), { recursive: true })
  await writeFile(join(output, 'index.html'), 'index')
  await writeFile(join(output, 'pages', 'owned.html'), 'owned')
  await writeFile(
    join(output, 'codebook-wiki.json'),
    JSON.stringify({ pages: [{ path: 'pages/owned.html' }], assets: [] }),
  )
  return {
    parent,
    output,
    cleanup: (): Promise<void> => rm(parent, { recursive: true, force: true }),
  }
}

/** Adds a sibling candidate folder that will own the given pages. */
async function candidate(
  output: string,
  pages: string[],
  modified: Date,
): Promise<void> {
  const stage = `${output}.stage-abc`
  await mkdir(stage)
  await writeFile(
    join(stage, 'codebook-wiki.json'),
    JSON.stringify({ pages: pages.map((path) => ({ path })), assets: [] }),
  )
  await utimes(stage, modified, modified)
}

const later = () => new Date(Date.now() + 60_000)

test('a learner file at a path the candidate would own is named as a conflict', async () => {
  // Arrange
  const wiki = await publishedWiki()
  await writeFile(join(wiki.output, 'pages', 'overview.html'), 'mine')
  await candidate(wiki.output, ['pages/overview.html'], later())
  try {
    // Act
    const conflicts = await detectWikiPublishConflicts(wiki.output, Date.now())

    // Assert
    assert.deepEqual(conflicts, ['pages/overview.html'])
  } finally {
    await wiki.cleanup()
  }
})

test('a learner file that sits where the candidate wants a folder is a conflict too', async () => {
  // Arrange
  const wiki = await publishedWiki()
  await writeFile(
    join(wiki.output, 'guides'),
    'a file named like a chapter folder',
  )
  await candidate(wiki.output, ['guides/intro.html'], later())
  try {
    // Act
    const conflicts = await detectWikiPublishConflicts(wiki.output, Date.now())

    // Assert
    assert.deepEqual(conflicts, ['guides'])
  } finally {
    await wiki.cleanup()
  }
})

test('learner files that no candidate page collides with are not conflicts', async () => {
  // Arrange
  const wiki = await publishedWiki()
  await writeFile(join(wiki.output, 'notes.md'), 'mine')
  await candidate(wiki.output, ['pages/overview.html'], later())
  try {
    // Act
    const conflicts = await detectWikiPublishConflicts(wiki.output, Date.now())

    // Assert
    assert.deepEqual(conflicts, [])
  } finally {
    await wiki.cleanup()
  }
})

test('an abandoned candidate from before the update started is not blamed', async () => {
  // Arrange
  const wiki = await publishedWiki()
  await writeFile(join(wiki.output, 'pages', 'overview.html'), 'mine')
  await candidate(
    wiki.output,
    ['pages/overview.html'],
    new Date(Date.now() - 3_600_000),
  )
  try {
    // Act
    const conflicts = await detectWikiPublishConflicts(wiki.output, Date.now())

    // Assert
    assert.deepEqual(conflicts, [])
  } finally {
    await wiki.cleanup()
  }
})

test('a published page the manifest owns is never reported as a learner file', async () => {
  // Arrange
  const wiki = await publishedWiki()
  await candidate(wiki.output, ['pages/owned.html'], later())
  try {
    // Act
    const conflicts = await detectWikiPublishConflicts(wiki.output, Date.now())

    // Assert
    assert.deepEqual(conflicts, [])
  } finally {
    await wiki.cleanup()
  }
})

test('a Wiki folder without a readable manifest reports no conflict', async () => {
  // Arrange
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-conflict-none-')),
  )
  try {
    // Act
    const conflicts = await detectWikiPublishConflicts(join(parent, 'wiki'), 0)

    // Assert
    assert.deepEqual(conflicts, [])
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
