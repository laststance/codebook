import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { detectWikiPublishConflicts } from '../utils/detectWikiPublishConflicts'

import { publishedWikiFixture } from './utils/publishedWikiFixture'

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

/** Adds a sibling candidate folder that will own the given pages, bound to the output by a receipt the way the publisher's `--prepare` binds it. */
async function candidate(
  output: string,
  pages: string[],
  written: Date,
  binding: { folder?: string; output?: string; baselineSha256?: string } = {},
): Promise<string> {
  const stage = join(dirname(output), binding.folder ?? 'wiki.stage-abc')
  await mkdir(stage)
  const receipt = join(stage, 'codebook-publication.json')
  const manifest = join(stage, 'codebook-wiki.json')
  await writeFile(
    receipt,
    JSON.stringify({
      schemaVersion: 1,
      kind: 'candidate',
      output: binding.output ?? output,
      baseline: {
        manifestSha256:
          binding.baselineSha256 ??
          createHash('sha256')
            .update(await readFile(join(output, 'codebook-wiki.json')))
            .digest('hex'),
      },
    }),
  )
  await writeFile(
    manifest,
    JSON.stringify({ pages: pages.map((path) => ({ path })), assets: [] }),
  )
  await utimes(receipt, written, written)
  await utimes(manifest, written, written)
  return stage
}

const later = () => new Date(Date.now() + 60_000)
const anHourAgo = () => new Date(Date.now() - 3_600_000)

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

test('an abandoned candidate of an earlier run is not blamed, even when its folder was touched since', async () => {
  // Arrange
  const wiki = await publishedWiki()
  await writeFile(join(wiki.output, 'pages', 'overview.html'), 'mine')
  const stage = await candidate(
    wiki.output,
    ['pages/overview.html'],
    anHourAgo(),
  )
  // Something else changed the folder itself later (a listing tool, a backup); its manifest and receipt are still old.
  await utimes(stage, later(), later())
  try {
    // Act
    const conflicts = await detectWikiPublishConflicts(wiki.output, Date.now())

    // Assert
    assert.deepEqual(conflicts, [])
  } finally {
    await wiki.cleanup()
  }
})

test('a candidate whose folder is older than the update but whose manifest was written during it is blamed', async () => {
  // Arrange
  const wiki = await publishedWiki()
  await writeFile(join(wiki.output, 'pages', 'overview.html'), 'mine')
  const stage = await candidate(wiki.output, ['pages/overview.html'], later())
  await utimes(stage, anHourAgo(), anHourAgo())
  try {
    // Act
    const conflicts = await detectWikiPublishConflicts(wiki.output, Date.now())

    // Assert
    assert.deepEqual(conflicts, ['pages/overview.html'])
  } finally {
    await wiki.cleanup()
  }
})

test('a candidate prepared from an older generation of the Wiki is ignored without looking at any clock', async () => {
  // Arrange
  const wiki = await publishedWiki()
  await writeFile(join(wiki.output, 'pages', 'overview.html'), 'mine')
  await candidate(wiki.output, ['pages/overview.html'], later(), {
    baselineSha256: '0'.repeat(64),
  })
  try {
    // Act
    const conflicts = await detectWikiPublishConflicts(wiki.output, 0)

    // Assert
    assert.deepEqual(conflicts, [])
  } finally {
    await wiki.cleanup()
  }
})

test('a candidate that belongs to another Wiki folder beside this one is ignored', async () => {
  // Arrange
  const wiki = await publishedWiki()
  await writeFile(join(wiki.output, 'pages', 'overview.html'), 'mine')
  await candidate(wiki.output, ['pages/overview.html'], later(), {
    output: join(wiki.parent, 'other-wiki'),
  })
  try {
    // Act
    const conflicts = await detectWikiPublishConflicts(wiki.output, 0)

    // Assert
    assert.deepEqual(conflicts, [])
  } finally {
    await wiki.cleanup()
  }
})

test('a candidate the real publisher prepared in a folder of the agent’s own name is found, and the publisher refuses the same file', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await mkdir(join(wiki.outputDirectory, 'pages'))
  await writeFile(join(wiki.outputDirectory, 'pages', 'notes.html'), 'mine')
  try {
    const stage = await wiki.prepare(
      join(dirname(wiki.outputDirectory), 'wiki-next'),
    )
    await wiki.writeCandidate(stage, {
      heading: 'Second',
      extraPages: ['pages/notes.html'],
    })

    // Act
    const conflicts = await detectWikiPublishConflicts(wiki.outputDirectory, 0)

    // Assert
    assert.deepEqual(conflicts, ['pages/notes.html'])
    await assert.rejects(
      wiki.publish(stage),
      /A manual Wiki file conflicts with the update: pages\/notes\.html/,
    )
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

test('a candidate folder whose manifest vanished after its receipt was read is no finding, not an error', async () => {
  // Arrange
  const wiki = await publishedWiki()
  await writeFile(join(wiki.output, 'pages', 'overview.html'), 'mine')
  // A real folder, bound to the Wiki by its receipt, whose manifest is gone again: the state between two reads of a folder that is being removed.
  const stage = await candidate(
    wiki.output,
    ['pages/overview.html'],
    new Date(),
  )
  await rm(join(stage, 'codebook-wiki.json'))
  try {
    // Act
    const conflicts = await detectWikiPublishConflicts(wiki.output, 0)

    // Assert
    assert.deepEqual(conflicts, [])
  } finally {
    await wiki.cleanup()
  }
})

test('a learner file two folders deep is named with its /-separated path', async () => {
  // Arrange
  const wiki = await publishedWiki()
  await mkdir(join(wiki.output, 'pages', 'guides'), { recursive: true })
  await writeFile(join(wiki.output, 'pages', 'guides', 'setup.html'), 'mine')
  await candidate(wiki.output, ['pages/guides/setup.html'], new Date())
  try {
    // Act
    const conflicts = await detectWikiPublishConflicts(wiki.output, 0)

    // Assert
    assert.deepEqual(conflicts, ['pages/guides/setup.html'])
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the looks of a running update in a project whose Wiki folder's path came to hold a link; fails_when=the look for the learner's own files lists the folder the link leads to and names files of that folder as files the update would overwrite (row 185); why_new=Cycle 0046 row 185; seam=none (a junction on Windows, which needs no right)
test('a link at the Wiki folder’s own path is not listed through: a file of the folder it leads to is not named as a learner file the candidate would overwrite', async () => {
  // Arrange: the Wiki with a learner's file is moved aside, a link to it stands at the Wiki folder's path, and a candidate would own the learner's path.
  const wiki = await publishedWiki()
  const movedAside = join(wiki.parent, 'wiki-moved-aside')
  try {
    await mkdir(join(wiki.output, 'notes'))
    await writeFile(join(wiki.output, 'notes', 'mine.md'), 'my own notes')
    await rename(wiki.output, movedAside)
    await symlink(movedAside, wiki.output, 'junction')

    // Act
    const conflicts = await detectWikiPublishConflicts(wiki.output, 1_000, [
      {
        name: 'wiki.stage-1',
        writtenAtMs: 2_000,
        ownedPaths: ['notes/mine.md'],
      },
    ])

    // Assert
    assert.deepEqual(conflicts, [])
  } finally {
    await wiki.cleanup()
  }
})
