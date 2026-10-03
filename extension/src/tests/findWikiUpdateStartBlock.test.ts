import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { findWikiUpdateStartBlock } from '../utils/findWikiUpdateStartBlock'

import { publishedWikiFixture } from './utils/publishedWikiFixture'

test('a generated page the learner edited by hand blocks the start and is named, as the real publisher refuses it too', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await writeFile(
    join(wiki.outputDirectory, 'index.html'),
    '<h1>My own wording</h1>',
  )
  try {
    // Act
    const block = await findWikiUpdateStartBlock(wiki.outputDirectory)

    // Assert
    assert.deepEqual(block, { cause: 'edited-page', paths: ['index.html'] })
    await assert.rejects(
      wiki.prepare(),
      /A published Wiki file changed after generation: index\.html/,
    )
  } finally {
    await wiki.cleanup()
  }
})

test('a generated page the learner deleted blocks the start like an edited one', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await rm(join(wiki.outputDirectory, 'index.html'))
  try {
    // Act
    const block = await findWikiUpdateStartBlock(wiki.outputDirectory)

    // Assert
    assert.deepEqual(block, { cause: 'edited-page', paths: ['index.html'] })
  } finally {
    await wiki.cleanup()
  }
})

test('a manifest changed after its publish blocks the start and is named, as the real publisher refuses it too', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  const manifestPath = join(wiki.outputDirectory, 'codebook-wiki.json')
  await writeFile(manifestPath, `${await readFile(manifestPath, 'utf8')}\n`)
  try {
    // Act
    const block = await findWikiUpdateStartBlock(wiki.outputDirectory)

    // Assert
    assert.deepEqual(block, {
      cause: 'edited-manifest',
      paths: ['codebook-wiki.json'],
    })
    await assert.rejects(
      wiki.prepare(),
      /The published Wiki manifest changed after generation/,
    )
  } finally {
    await wiki.cleanup()
  }
})

test('an earlier publish that left its journal behind blocks the start and names the journal', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await writeFile(
    `${wiki.outputDirectory}.publish-journal.json`,
    JSON.stringify({ operation: 'publish', pid: 99_999_999 }),
  )
  try {
    // Act
    const block = await findWikiUpdateStartBlock(wiki.outputDirectory)

    // Assert
    assert.deepEqual(block, {
      cause: 'unfinished-publish',
      paths: ['wiki.publish-journal.json'],
    })
    await assert.rejects(
      wiki.prepare(),
      /An earlier Wiki publication needs inspection/,
    )
  } finally {
    await wiki.cleanup()
  }
})

test('a published Wiki nobody touched does not block the start, and the learner’s own file is not mistaken for an edit', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await writeFile(wiki.learnerFile, 'my notes, changed again\n')
  try {
    // Act
    const block = await findWikiUpdateStartBlock(wiki.outputDirectory)

    // Assert
    assert.equal(block, undefined)
  } finally {
    await wiki.cleanup()
  }
})

test('a Wiki published before file hashes were recorded does not block the start', async () => {
  // Arrange
  const output = join(
    await realpath(await mkdtemp(join(tmpdir(), 'codebook-wiki-legacy-'))),
    'wiki',
  )
  await mkdir(output)
  await writeFile(join(output, 'index.html'), 'index')
  await writeFile(
    join(output, 'codebook-wiki.json'),
    JSON.stringify({ schemaVersion: 1, pages: [], assets: [] }),
  )
  try {
    // Act
    const block = await findWikiUpdateStartBlock(output)

    // Assert
    assert.equal(block, undefined)
  } finally {
    await rm(join(output, '..'), { recursive: true, force: true })
  }
})
