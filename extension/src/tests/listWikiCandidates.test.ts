import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  mkdir,
  open,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

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

test('a backup the publisher kept is never read as a candidate, even when its receipt names the current generation', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  try {
    const stage = await wiki.prepare()
    await wiki.writeCandidate(stage, { heading: 'Second' })
    await wiki.publish(stage)
    const parent = dirname(wiki.outputDirectory)
    const backupName = (await readdir(parent)).find((name) =>
      name.startsWith('wiki.previous-'),
    )
    assert.ok(backupName, 'the publisher kept the first generation as a backup')
    // The backup's receipt is rewritten to look like a candidate prepared from the generation now published.
    const publishedManifest = await readFile(
      join(wiki.outputDirectory, 'codebook-wiki.json'),
    )
    await writeFile(
      join(parent, backupName, 'codebook-publication.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'candidate',
        output: wiki.outputDirectory,
        baseline: {
          manifestSha256: createHash('sha256')
            .update(publishedManifest)
            .digest('hex'),
        },
      }),
    )

    // Act
    const candidates = await listWikiCandidates(wiki.outputDirectory)

    // Assert
    assert.deepEqual(candidates, [])
  } finally {
    await wiki.cleanup()
  }
})

test(
  'a candidate folder whose receipt is a named pipe is skipped at once instead of holding the listing',
  { timeout: 2_000 },
  async (context) => {
    // Arrange
    const wiki = await publishedWikiFixture()
    const trap = `${wiki.outputDirectory}.stage-trap`
    const pipePath = join(trap, 'codebook-publication.json')
    await mkdir(trap)
    await promisify(execFile)('mkfifo', [pipePath])
    // A read that waits on the pipe would keep this process alive, and the test's body with it: the hook runs also when the body is stopped at its time bound.
    context.after(async () => {
      await open(pipePath, constants.O_WRONLY | constants.O_NONBLOCK).then(
        (writer) => writer.close(),
        () => undefined,
      )
      await wiki.cleanup()
    })

    // Act
    const candidates = await listWikiCandidates(wiki.outputDirectory)

    // Assert
    assert.deepEqual(candidates, [])
  },
)
