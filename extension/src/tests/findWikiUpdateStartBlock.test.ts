import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

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

test('a deleted generated page is reported as missing, not as edited by hand', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await rm(join(wiki.outputDirectory, 'index.html'))
  try {
    // Act
    const block = await findWikiUpdateStartBlock(wiki.outputDirectory)

    // Assert
    assert.deepEqual(block, { cause: 'missing-page', paths: ['index.html'] })
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

// Value: protects=the start check reads and names only files inside the Wiki folder; fails_when=an owned-file entry with `..` or an absolute path is hashed, so a file outside the Wiki is read and named to the learner as an edited page; why_new=the other start-block tests use manifests the real publisher wrote, which never list an outside path; seam=none
test('a manifest that lists files outside the Wiki folder among its owned files does not make the start check read or name them', async () => {
  // Arrange: a hand-written manifest whose owned files point beside the Wiki, once through `..` and once by an absolute path.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-outside-')),
  )
  const output = join(directory, 'wiki')
  const outsideFile = join(directory, 'private-notes.txt')
  await mkdir(output)
  await writeFile(outsideFile, 'not a Wiki page')
  await writeFile(
    join(output, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      pages: [],
      assets: [],
      ownedFiles: {
        '../private-notes.txt': '0'.repeat(64),
        [outsideFile]: '0'.repeat(64),
      },
    }),
  )
  try {
    // Act
    const block = await findWikiUpdateStartBlock(output)

    // Assert
    assert.equal(block, undefined)
  } finally {
    await rm(directory, { recursive: true, force: true })
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

test('a symbolic link under the Wiki folder refuses the update at its start and is named, as the real publisher refuses it', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await symlink(wiki.learnerFile, join(wiki.outputDirectory, 'shared-notes.md'))
  try {
    // Act
    const block = await findWikiUpdateStartBlock(wiki.outputDirectory)

    // Assert
    assert.deepEqual(block, {
      cause: 'special-file',
      paths: ['shared-notes.md'],
    })
    await assert.rejects(wiki.prepare(), /Wiki publication refuses a linked/)
  } finally {
    await wiki.cleanup()
  }
})

test('a generated page replaced by a link is named and is not read through the link', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  const indexPath = join(wiki.outputDirectory, 'index.html')
  // The link leads to a file with exactly the published bytes: reading through it would find nothing wrong.
  const sameBytesElsewhere = join(wiki.projectRoot, 'index-copy.html')
  await writeFile(sameBytesElsewhere, await readFile(indexPath))
  await rm(indexPath)
  await symlink(sameBytesElsewhere, indexPath)
  try {
    // Act
    const block = await findWikiUpdateStartBlock(wiki.outputDirectory)

    // Assert
    assert.deepEqual(block, { cause: 'special-file', paths: ['index.html'] })
  } finally {
    await wiki.cleanup()
  }
})

test(
  'a published page replaced by a link to a named pipe is reported at once instead of holding the start',
  { timeout: 2_000 },
  async (context) => {
    // Arrange
    const wiki = await publishedWikiFixture()
    const indexPath = join(wiki.outputDirectory, 'index.html')
    const pipePath = join(wiki.projectRoot, 'never-written.pipe')
    await promisify(execFile)('mkfifo', [pipePath])
    await rm(indexPath)
    await symlink(pipePath, indexPath)
    // A read that waits on the pipe would keep this process alive, and the test's body with it: the hook runs also when the body is stopped at its time bound.
    context.after(async () => {
      await open(pipePath, constants.O_WRONLY | constants.O_NONBLOCK).then(
        (writer) => writer.close(),
        () => undefined,
      )
      await wiki.cleanup()
    })

    // Act
    const block = await findWikiUpdateStartBlock(wiki.outputDirectory)

    // Assert
    assert.deepEqual(block, { cause: 'special-file', paths: ['index.html'] })
  },
)

test('a manifest that is no JSON blocks the start as a manifest Codebook cannot read, before anything else reads it', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  await writeFile(
    join(wiki.outputDirectory, 'codebook-wiki.json'),
    '{ "schemaVersion": 1, "pages": [',
  )
  try {
    // Act
    const block = await findWikiUpdateStartBlock(wiki.outputDirectory)

    // Assert
    assert.deepEqual(block, {
      cause: 'unreadable-manifest',
      paths: ['codebook-wiki.json'],
    })
  } finally {
    await wiki.cleanup()
  }
})

test('a publish that finishes while the start check looks does not block the start as an unfinished earlier publish', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  const journalPath = `${wiki.outputDirectory}.publish-journal.json`
  // The publisher wrote its journal a moment ago and is still swapping the folders.
  await writeFile(journalPath, '{}')
  const waits: number[] = []
  try {
    // Act
    const block = await findWikiUpdateStartBlock(wiki.outputDirectory, {
      wait: async (delayMs) => {
        waits.push(delayMs)
        // The publish ends while the check waits for its second look.
        await rm(journalPath)
      },
    })

    // Assert
    assert.equal(block, undefined)
    assert.deepEqual(waits, [2_000])
  } finally {
    await wiki.cleanup()
  }
})

test('a journal that is still there at the second look, and one written long ago, are reported as an unfinished publish', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  const journalPath = `${wiki.outputDirectory}.publish-journal.json`
  await writeFile(journalPath, '{}')
  const waits: number[] = []
  const wait = async (delayMs: number): Promise<void> => {
    waits.push(delayMs)
  }
  try {
    // Act
    const writtenJustNow = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      { wait },
    )
    const writtenAMinuteAgo = await findWikiUpdateStartBlock(
      wiki.outputDirectory,
      { wait, now: () => Date.now() + 60_000 },
    )

    // Assert
    assert.deepEqual(writtenJustNow, {
      cause: 'unfinished-publish',
      paths: ['wiki.publish-journal.json'],
    })
    assert.deepEqual(writtenAMinuteAgo, {
      cause: 'unfinished-publish',
      paths: ['wiki.publish-journal.json'],
    })
    // Only the fresh journal got a second look.
    assert.deepEqual(waits, [2_000])
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the learner who presses Update in a checkout whose repository carries the Wiki folder itself as a link (`.codebook/wiki` to another folder); fails_when=the start check lists through the link, so it walks the folder the link leads to before any timeout or cancel exists and tells the learner to move that folder's files out of the Wiki folder, or passes and asks an agent whose publisher refuses at its first step (row 185); why_new=Cycle 0046 row 185: the listings refused a link inside the Wiki folder and followed one at the folder's own path; seam=none (a junction on Windows, which needs no right)
test('a link at the Wiki folder’s own path refuses the update at its start with a cause of its own that names the folder, the folder it leads to is not listed, and the real publisher refuses it too', async () => {
  // Arrange: the published Wiki is moved aside and a link to it stands at the Wiki folder's path; the folder it leads to holds a link of its own, which a listing through the first link would report.
  const wiki = await publishedWikiFixture()
  const movedAside = join(wiki.projectRoot, 'wiki-moved-aside')
  try {
    await rename(wiki.outputDirectory, movedAside)
    await symlink(
      wiki.projectRoot,
      join(movedAside, 'a-link-inside'),
      'junction',
    )
    await symlink(movedAside, wiki.outputDirectory, 'junction')

    // Act
    const block = await findWikiUpdateStartBlock(wiki.outputDirectory)

    // Assert
    assert.deepEqual(block, { cause: 'not-a-folder', paths: ['wiki'] })
    await assert.rejects(wiki.prepare(), /The Wiki directory must be regular/)
  } finally {
    await wiki.cleanup()
  }
})

// Value: protects=the learner whose Wiki folder's path holds a file (a leftover of a tool, a checkout on a system without links, where Git writes a link as a small file); fails_when=the start check takes the path for a project without a Wiki and says "no LLM Wiki found", although the publisher refuses the entry and generating again would fail the same way (row 185); why_new=Cycle 0046 row 185: "a link, or anything else that is no folder"; seam=none
test('a file at the Wiki folder’s own path refuses the update at its start with the same cause', async () => {
  // Arrange
  const wiki = await publishedWikiFixture()
  try {
    await rm(wiki.outputDirectory, { recursive: true })
    await writeFile(wiki.outputDirectory, '../elsewhere/wiki')

    // Act
    const block = await findWikiUpdateStartBlock(wiki.outputDirectory)

    // Assert
    assert.deepEqual(block, { cause: 'not-a-folder', paths: ['wiki'] })
  } finally {
    await wiki.cleanup()
  }
})
