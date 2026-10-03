import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { listWikiCandidates } from '../utils/listWikiCandidates'

import { publishedWikiFixture } from './utils/publishedWikiFixture'

test('a stage the publisher prepared under its default name and one under a name of the agent’s choosing are both candidates', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  try {
    const defaultStage = await wiki.prepare()
    const namedStage = await wiki.prepare(
      join(dirname(wiki.outputDirectory), 'next-wiki'),
    )
    await wiki.writeCandidate(namedStage, {
      heading: 'Second',
      extraPages: ['pages/overview.html'],
    })

    // Act
    const candidates = await listWikiCandidates(wiki.outputDirectory)

    // Assert
    assert.deepEqual(
      candidates.map((candidate) => candidate.name),
      ['next-wiki', defaultStage.slice(dirname(defaultStage).length + 1)],
    )
    assert.deepEqual(candidates[0]?.ownedPaths, [
      'index.html',
      'pages/overview.html',
    ])
    assert.equal(
      candidates[0]?.writtenAtMs,
      (await stat(join(namedStage, 'codebook-wiki.json'))).mtimeMs,
    )
  } finally {
    await wiki.cleanup()
  }
})

test('after a publish the generations the publisher keeps beside the Wiki are not candidates', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  try {
    const abandonedStage = await wiki.prepare()
    await wiki.writeCandidate(abandonedStage, { heading: 'Never published' })
    const stage = await wiki.prepare()
    await wiki.writeCandidate(stage, { heading: 'Second' })
    await wiki.publish(stage)

    // Act: the abandoned stage was prepared from the first generation, and the first generation itself is kept as `wiki.previous-…`.
    const candidates = await listWikiCandidates(wiki.outputDirectory)

    // Assert
    assert.deepEqual(candidates, [])
  } finally {
    await wiki.cleanup()
  }
})

test('a project without a Wiki has no candidates', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  try {
    // Act
    const candidates = await listWikiCandidates(
      join(wiki.projectRoot, 'no-wiki-here'),
    )

    // Assert
    assert.deepEqual(candidates, [])
  } finally {
    await wiki.cleanup()
  }
})
