import assert from 'node:assert/strict'
import { constants as flagsOfThisSystem } from 'node:fs'
import * as fileSystem from 'node:fs/promises'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { openWithoutFollowing } from '../utils/openWithoutFollowing'
import { systemErrorCode } from '../utils/systemErrorCode'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { loadOpenWithoutFollowing } from './utils/loadOpenWithoutFollowing'

/** The open flags of a system whose open cannot refuse a link: Windows defines neither `O_NOFOLLOW` nor `O_NONBLOCK`. Handed to the opener, it takes the way it takes on Windows on every system. */
const OPEN_FLAGS_WITHOUT_NOFOLLOW = { O_RDONLY: flagsOfThisSystem.O_RDONLY }

/**
 * Says in one text what an open ended with, so a test compares one value: the text of the file that was opened and read, or the code the open was refused with.
 * @param opening - The open under test.
 * @returns `opened and read: <text>` or `refused with <code>`.
 */
async function outcomeOf(
  opening: Promise<fileSystem.FileHandle>,
): Promise<string> {
  let file: fileSystem.FileHandle
  try {
    file = await opening
  } catch (error) {
    return `refused with ${systemErrorCode(error)}`
  }
  try {
    return `opened and read: ${await file.readFile('utf8')}`
  } finally {
    await file.close()
  }
}

// Value: protects=every file Codebook must not read through a link in a Windows editor (Wiki metadata, the generated Wiki files it hashes, the Cursor MCP config and its records); fails_when=the opener relies on O_NOFOLLOW, which Windows does not define, so the open follows the link and the target is read; why_new=Cycle 0046 row 78: the look and the comparison of row 71 became one opener for every such place; seam=the open flags handed to the opener
test('a link at a path is refused with ELOOP where the system’s open cannot refuse a link, as on Windows, and the file it points to is not read', async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-open-no-follow-'))
  const targetPath = join(folder, 'elsewhere.json')
  const linkPath = join(folder, 'codebook-wiki.json')
  await writeFile(targetPath, '{"elsewhere":1}')
  try {
    if (!(await createLinkIfAllowed(targetPath, linkPath)))
      return context.skip(LINK_NOT_ALLOWED)

    // Act
    const outcome = await outcomeOf(
      openWithoutFollowing(linkPath, OPEN_FLAGS_WITHOUT_NOFOLLOW),
    )

    // Assert
    assert.equal(outcome, 'refused with ELOOP')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=the refusal of a link where the system has the flag (Linux, macOS), which every caller's contract names by its code; fails_when=the opener drops O_NOFOLLOW from the open, so a link is followed on every system; why_new=Cycle 0046 row 78: the open with the flag moved into the opener, and where the platform has the flag nothing may change; seam=none
test(
  'a link at a path is refused by the open itself with ELOOP where the system has O_NOFOLLOW',
  {
    skip:
      flagsOfThisSystem.O_NOFOLLOW === undefined
        ? 'this system has no O_NOFOLLOW (Windows): the case above is its way'
        : false,
  },
  async (context) => {
    // Arrange
    const folder = await mkdtemp(join(tmpdir(), 'codebook-open-no-follow-'))
    const targetPath = join(folder, 'elsewhere.json')
    const linkPath = join(folder, 'codebook-wiki.json')
    await writeFile(targetPath, '{"elsewhere":1}')
    try {
      if (!(await createLinkIfAllowed(targetPath, linkPath)))
        return context.skip(LINK_NOT_ALLOWED)

      // Act
      const outcome = await outcomeOf(openWithoutFollowing(linkPath))

      // Assert
      assert.equal(outcome, 'refused with ELOOP')
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  },
)

// Value: protects=every read through the opener in a Windows editor; fails_when=the look at the path and the opened file disagree on the device or the inode number of one file, so every regular file is refused as replaced; why_new=Cycle 0046 row 78: on a Windows runner this case shows that lstat and the opened file name one file alike; seam=the open flags handed to the opener
test('a regular file is opened and read where the system’s open cannot refuse a link, as on Windows', async () => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-open-no-follow-'))
  const filePath = join(folder, 'codebook-wiki.json')
  await writeFile(filePath, '{"a":"12"}')
  try {
    // Act
    const outcome = await outcomeOf(
      openWithoutFollowing(filePath, OPEN_FLAGS_WITHOUT_NOFOLLOW),
    )

    // Assert
    assert.equal(outcome, 'opened and read: {"a":"12"}')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=the rule that a reader on Windows reads only the file it looked at, on a runner where no link can be created; fails_when=the opened file is not compared with the look (or by the device alone), so a file moved over the path after the look is read as the one that was looked at; why_new=Cycle 0046 row 78: the comparison moved into the opener and got a code of its own; seam=node:fs/promises lstat of the loaded opener, which replaces the path after the real look
test('a path that another file takes between the look at it and its open is refused with EREPLACED where the system’s open cannot refuse a link', async () => {
  // Arrange: a regular file, and another regular file that is moved over it right after the look.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-open-no-follow-'))
  const otherPath = join(folder, 'another.json')
  const filePath = join(folder, 'codebook-wiki.json')
  await writeFile(otherPath, '{"another":1}')
  await writeFile(filePath, '{"a":"12"}')
  const openingAfterAReplacedLook = await loadOpenWithoutFollowing({
    fileSystem: {
      ...fileSystem,
      lstat: async (path: string, options: { bigint: true }) => {
        const lookBeforeTheReplacement = await fileSystem.lstat(path, options)
        await rename(otherPath, filePath)
        return lookBeforeTheReplacement
      },
    },
  })
  try {
    // Act
    const outcome = await outcomeOf(
      openingAfterAReplacedLook.openWithoutFollowing(
        filePath,
        OPEN_FLAGS_WITHOUT_NOFOLLOW,
      ),
    )

    // Assert
    assert.equal(outcome, 'refused with EREPLACED')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=the callers' own answers for a path that holds no file (the Cursor MCP catalog treats ENOTREG as a file it does not own, the hash names it in its contract); fails_when=the look lets a folder through to the open, or refuses it with another code; why_new=Cycle 0046 row 78: without the flag the look is all that keeps a pipe from being opened, and its refusal needs a code; seam=the open flags handed to the opener
test('a folder at a path is refused with ENOTREG before anything is opened where the system’s open cannot refuse a link', async () => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-open-no-follow-'))
  const folderPath = join(folder, 'codebook-wiki.json')
  await mkdir(folderPath)
  try {
    // Act
    const outcome = await outcomeOf(
      openWithoutFollowing(folderPath, OPEN_FLAGS_WITHOUT_NOFOLLOW),
    )

    // Assert
    assert.equal(outcome, 'refused with ENOTREG')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=every caller that tells a missing file from a refused one by ENOENT (the Cursor MCP catalog creates its config only then, the start block names a missing page); fails_when=the look turns the file system's error for a missing path into a refusal of its own; why_new=Cycle 0046 row 78: the look is a second call that can fail before the open; seam=the open flags handed to the opener
test('a path that holds nothing is reported as missing, with ENOENT, with the system’s flags and where its open cannot refuse a link', async () => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-open-no-follow-'))
  const missingPath = join(folder, 'codebook-wiki.json')
  try {
    // Act
    const outcomes = {
      withTheFlagsOfThisSystem: await outcomeOf(
        openWithoutFollowing(missingPath),
      ),
      whereTheOpenCannotRefuseALink: await outcomeOf(
        openWithoutFollowing(missingPath, OPEN_FLAGS_WITHOUT_NOFOLLOW),
      ),
    }

    // Assert
    assert.deepEqual(outcomes, {
      withTheFlagsOfThisSystem: 'refused with ENOENT',
      whereTheOpenCannotRefuseALink: 'refused with ENOENT',
    })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
