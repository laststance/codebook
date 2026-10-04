import assert from 'node:assert/strict'
import { utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { readWikiPublishedAt } from '../utils/readWikiPublishedAt'

import { publishedWikiFixture } from './utils/publishedWikiFixture'

test('a publish is dated by the move of its folder into place, not by its manifest, which the publisher writes before its last checks', async () => {
  // Arrange
  const startedAtMs = Date.now()
  const wiki = await publishedWikiFixture()
  try {
    const stage = await wiki.prepare()
    await wiki.writeCandidate(stage, { heading: 'Second' })
    await wiki.publish(stage)
    // The manifest was written ten minutes before the publish completed: a watch cancelled in between ended after that time.
    const manifestWrittenAt = new Date(startedAtMs - 600_000)
    await utimes(
      join(wiki.outputDirectory, 'codebook-wiki.json'),
      manifestWrittenAt,
      manifestWrittenAt,
    )
    // The folder's content last changed with that manifest. Setting the time by hand keeps the test off the filesystem's clock: it stamps the publisher's last write and the move alike when both fall into one of its ticks, and the helper then cannot tell the move from a change.
    await utimes(wiki.outputDirectory, manifestWrittenAt, manifestWrittenAt)

    // Act
    const publishedAt = await readWikiPublishedAt(wiki.outputDirectory)

    // Assert
    assert.ok(
      publishedAt !== undefined && Date.parse(publishedAt) >= startedAtMs,
      `the publish is dated ${publishedAt}, before the test began at ${new Date(startedAtMs).toISOString()}`,
    )
  } finally {
    await wiki.cleanup()
  }
})

test('a Wiki folder a file was added to since its publish is dated by its manifest', async () => {
  // Arrange: the fixture adds the learner's file after its publish, so the folder's last change is no longer the move.
  const wiki = await publishedWikiFixture()
  try {
    const manifestWrittenAt = new Date('2026-10-03T11:50:00.000Z')
    await utimes(
      join(wiki.outputDirectory, 'codebook-wiki.json'),
      manifestWrittenAt,
      manifestWrittenAt,
    )

    // Act
    const publishedAt = await readWikiPublishedAt(wiki.outputDirectory)

    // Assert
    assert.equal(publishedAt, '2026-10-03T11:50:00.000Z')
  } finally {
    await wiki.cleanup()
  }
})
