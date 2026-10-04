import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { readWikiWatchStamp } from '../utils/readWikiWatchStamp'

import { publishedWikiFixture } from './utils/publishedWikiFixture'

/** A file write right after another can land in the same tick of the file system's clock; the pause keeps the two apart. */
const afterAClockTick = (): Promise<void> =>
  new Promise((resolveWait) => setTimeout(resolveWait, 30))

test('a Wiki folder nobody wrote to keeps its stamp, also when the learner changes their own file', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  try {
    const first = await readWikiWatchStamp(wiki.outputDirectory)

    // Act
    await afterAClockTick()
    await writeFile(wiki.learnerFile, 'my notes, changed\n')
    const second = await readWikiWatchStamp(wiki.outputDirectory)

    // Assert
    assert.match(first, /^wiki=\d+:[\d.]+:\d+\/\d+:[\d.]+$/)
    assert.equal(second, first)
  } finally {
    await wiki.cleanup()
  }
})

test('the stamp changes when the agent prepares a candidate, when it writes the candidate’s manifest and when it publishes', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  try {
    const published = await readWikiWatchStamp(wiki.outputDirectory)

    // Act
    const stage = await wiki.prepare()
    const prepared = await readWikiWatchStamp(wiki.outputDirectory)
    await afterAClockTick()
    await wiki.writeCandidate(stage, { heading: 'Second' })
    const written = await readWikiWatchStamp(wiki.outputDirectory)
    await wiki.publish(stage)
    const republished = await readWikiWatchStamp(wiki.outputDirectory)

    // Assert
    assert.equal(
      new Set([published, prepared, written, republished]).size,
      4,
      'each of the four moments has its own stamp',
    )
  } finally {
    await wiki.cleanup()
  }
})

test('a project without a Wiki still has a stamp, so the watch can run until one appears', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  try {
    // Act
    const stamp = await readWikiWatchStamp(`${wiki.projectRoot}/no-wiki-here`)

    // Assert
    assert.equal(stamp, 'no-wiki-here=-/0:0')
  } finally {
    await wiki.cleanup()
  }
})

test('the stamp changes when a file is created in the Wiki folder', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  try {
    const before = await readWikiWatchStamp(wiki.outputDirectory)

    // Act
    await afterAClockTick()
    await writeFile(join(wiki.outputDirectory, 'notes', 'second.md'), 'more\n')
    const afterNewFile = await readWikiWatchStamp(wiki.outputDirectory)

    // Assert
    assert.notEqual(afterNewFile, before)
  } finally {
    await wiki.cleanup()
  }
})

test('the stamp does not grow with the backups the publisher keeps', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  try {
    // Two more publishes leave two backups beside the Wiki, each with its receipt.
    const second = await wiki.prepare()
    await wiki.writeCandidate(second, { heading: 'Second' })
    await wiki.publish(second)
    const third = await wiki.prepare()
    await wiki.writeCandidate(third, { heading: 'Third' })
    await wiki.publish(third)

    // Act
    const stamp = await readWikiWatchStamp(wiki.outputDirectory)

    // Assert
    assert.match(stamp, /^wiki=\d+:[\d.]+:\d+\/\d+:[\d.]+$/)
  } finally {
    await wiki.cleanup()
  }
})
