import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as ReadWikiWatchStampModule from '../utils/readWikiWatchStamp'
import { readWikiWatchStamp } from '../utils/readWikiWatchStamp'

import { fileSystemWithLargeFileIds } from './utils/fileSystemWithLargeFileIds'
import { loadModule } from './utils/loadModule'
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

// Value: protects=the watch of a Wiki update on an NTFS volume, which looks at the Wiki only when its stamp changed; fails_when=the stamp names the manifest's inode as a JavaScript number, so a manifest the publisher wrote anew with the same size and time under a file id that differs only below the rounding keeps the stamp, and the watch never looks at the publish; why_new=Cycle 0046 row 79: a file id above 2^53 was observed on the development host; seam=node:fs/promises of the loaded stamp reader, whose files have ids above 2^53
test('the stamp names a file id above 2^53 exactly, so a manifest written anew with the same size and time under an id that differs only where a number rounds changes the stamp', async () => {
  // Arrange: a Wiki folder with a manifest last written at 2026-09-21T14:13:20Z. The manifest is the first file a status is asked for (id 210824757556437109), the folder the second, the manifest written anew the third.
  const project = await mkdtemp(join(tmpdir(), 'codebook-wiki-watch-stamp-'))
  const outputDirectory = join(project, 'wiki')
  const manifestPath = join(outputDirectory, 'codebook-wiki.json')
  await mkdir(outputDirectory)
  await writeFile(manifestPath, '{"a":"12"}')
  await utimes(manifestPath, 1_790_000_000, 1_790_000_000)
  await utimes(outputDirectory, 1_790_000_000, 1_790_000_000)
  const { readWikiWatchStamp: readStampWithLargeIds } = await loadModule<
    typeof ReadWikiWatchStampModule
  >(resolve(__dirname, '../utils/readWikiWatchStamp.js'), {
    'node:fs/promises': fileSystemWithLargeFileIds(),
  })
  try {
    const published = await readStampWithLargeIds(outputDirectory)

    // Act: the publisher swaps in a freshly written manifest (the old one still exists, outside the Wiki folder), and the folder's time is set back, so that only the file id tells the two apart.
    await rename(manifestPath, join(project, 'previous.json'))
    await writeFile(manifestPath, '{"b":"34"}')
    await utimes(manifestPath, 1_790_000_000, 1_790_000_000)
    await utimes(outputDirectory, 1_790_000_000, 1_790_000_000)
    const publishedAgain = await readStampWithLargeIds(outputDirectory)

    // Assert
    assert.deepEqual(
      [published, publishedAgain],
      [
        'wiki=210824757556437109:1790000000000000000:10/1:1790000000000',
        'wiki=210824757556437111:1790000000000000000:10/1:1790000000000',
      ],
    )
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})

// Value: protects=the looks of an update's watch, one every two seconds for fifteen minutes, in a project whose Wiki folder's path holds a link; fails_when=each look lists the folder the link leads to with all its subfolders (2.2 s a look for a link to /usr), row 185; why_new=Cycle 0046 row 185; seam=none (a junction on Windows, which needs no right)
test('the stamp of a Wiki folder whose own path holds a link counts no folder of the folder the link leads to', async () => {
  // Arrange: a folder with two subfolders and no manifest, and a link to it where the Wiki folder would be.
  const project = await mkdtemp(join(tmpdir(), 'codebook-wiki-stamp-'))
  try {
    await mkdir(join(project, 'elsewhere', 'pages', 'deep'), {
      recursive: true,
    })
    await symlink(join(project, 'elsewhere'), join(project, 'wiki'), 'junction')

    // Act
    const stamp = await readWikiWatchStamp(join(project, 'wiki'))

    // Assert: no manifest ("-"), no folder counted and no folder time ("0:0"); through the link the folders would be 3.
    assert.equal(stamp, 'wiki=-/0:0')
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})
