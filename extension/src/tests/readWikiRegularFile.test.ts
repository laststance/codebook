import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { constants as openConstants, type StatOptions } from 'node:fs'
import * as fileSystem from 'node:fs/promises'
import {
  appendFile,
  lstat,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import * as constants from '../constants'
import type * as ReadWikiRegularFileModule from '../utils/readWikiRegularFile'
import { readWikiRegularFile } from '../utils/readWikiRegularFile'

import { loadModule } from './utils/loadModule'

/** The open flags of a system whose open cannot refuse a link: Windows defines neither `O_NOFOLLOW` nor `O_NONBLOCK`. Handed to the reader, it takes the way it takes on Windows on every system. */
const OPEN_FLAGS_WITHOUT_NOFOLLOW = { O_RDONLY: openConstants.O_RDONLY }

/** Why a test of a link was skipped; printed in the test run's output. */
const LINK_NOT_ALLOWED =
  'creating a symbolic link was refused with EPERM: this user lacks the right (on Windows: no administrator and no developer mode)'

/**
 * Creates a symbolic link for a test, and says so when this user may not: Windows refuses the creation with `EPERM` for a user without the privilege (an administrator and a user in developer mode have it).
 * @param targetPath - The file the link points to.
 * @param linkPath - Where the link is created.
 * @returns `true` when the link exists; `false` when the system refused it for a missing right, so the test skips with that reason instead of failing.
 * @throws Every other error of the creation.
 * @example
 * if (!(await createLinkIfAllowed(targetPath, linkPath))) return context.skip(LINK_NOT_ALLOWED)
 */
async function createLinkIfAllowed(
  targetPath: string,
  linkPath: string,
): Promise<boolean> {
  try {
    await symlink(targetPath, linkPath)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EPERM')
      return false
    throw error
  }
}

/**
 * Loads the reader of Wiki metadata files with an `lstat` that answers the real look at the path and then lets the test replace what the path names, the moment between the look and the open on a system whose open cannot refuse a link.
 * @param replacePath - Replaces the entry at the path; runs once, right after the look.
 * @returns The loaded `readWikiRegularFile`.
 */
async function loadReaderWhosePathIsReplacedAfterTheLook(
  replacePath: () => Promise<void>,
): Promise<typeof ReadWikiRegularFileModule.readWikiRegularFile> {
  const loaded = await loadModule<typeof ReadWikiRegularFileModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    {
      'node:fs/promises': {
        ...fileSystem,
        lstat: async (path: string, options: { bigint: true }) => {
          const lookBeforeTheReplacement = await fileSystem.lstat(path, options)
          await replacePath()
          return lookBeforeTheReplacement
        },
      },
    },
  )
  return loaded.readWikiRegularFile
}

/**
 * Loads the reader of Wiki metadata files with a limit of 16 bytes and an `open` whose file grows by `grownText` right after its `stat` was taken, the moment between the size check and the read.
 * @param grownText - What another process appends to the file after the reader looked at its size.
 * @returns The loaded `readWikiRegularFile`.
 */
async function loadReaderWhoseFileGrowsAfterStat(
  grownText: string,
): Promise<typeof ReadWikiRegularFileModule.readWikiRegularFile> {
  const loaded = await loadModule<typeof ReadWikiRegularFileModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    {
      '../constants': { ...constants, WIKI_METADATA_FILE_LIMIT_BYTES: 16 },
      'node:fs/promises': {
        ...fileSystem,
        open: async (
          path: string,
          flags: number,
        ): Promise<fileSystem.FileHandle> => {
          const file = await fileSystem.open(path, flags)
          const statOfOpenedFile = file.stat.bind(file)
          file.stat = (async (options?: StatOptions) => {
            // Where the open cannot refuse a link the reader first asks, with exact numbers, which file it opened; the file does not grow at that question.
            if (options?.bigint) return statOfOpenedFile(options)
            // The size the reader checks is taken first; the file grows before the reader reads it.
            const statBeforeGrowth = await statOfOpenedFile(options)
            await appendFile(path, grownText)
            return statBeforeGrowth
          }) as typeof file.stat
          return file
        },
      },
    },
  )
  return loaded.readWikiRegularFile
}

// Value: protects=the bound on the memory a Wiki manifest, receipt or marker read can take; fails_when=the size is checked at stat only and the read goes to the end of the file, so a file that grows after the check is read past WIKI_METADATA_FILE_LIMIT_BYTES; why_new=Cycle 0045 pre-landing review PL-12 (row 20 of Cycle 0046); seam=node:fs/promises open of the loaded reader, whose file grows after its stat
test('a manifest that grows past the limit while it is read is refused', async () => {
  // Arrange: a manifest of 10 bytes, within the limit of 16 when its size is checked, grows to 30 bytes before it is read.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
  const manifestPath = join(folder, 'codebook-wiki.json')
  await writeFile(manifestPath, '{"a":"12"}')
  const readGrowingFile = await loadReaderWhoseFileGrowsAfterStat(
    ' '.repeat(20),
  )
  try {
    // Act
    const read = await readGrowingFile(manifestPath)

    // Assert
    assert.equal(read, undefined)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('a manifest that grows while it is read but stays within the limit is read whole', async () => {
  // Arrange: a manifest of 10 bytes grows by 6 bytes to exactly the limit of 16 before it is read.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
  const manifestPath = join(folder, 'codebook-wiki.json')
  await writeFile(manifestPath, '{"a":"12"}')
  const readGrowingFile = await loadReaderWhoseFileGrowsAfterStat(' '.repeat(6))
  try {
    // Act
    const read = await readGrowingFile(manifestPath)

    // Assert
    assert.equal(read?.bytes.toString('utf8'), '{"a":"12"}      ')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=the size limit of a Wiki metadata read on Windows, where the reader asks twice about the opened file; fails_when=the question which file was opened counts as the size check, so the file of this test grows twice and the bytes differ, or the growth stand-in answers numbers that are not exact and every file is refused; why_new=Cycle 0046 row 71: the reader's tests never ran on a system without O_NOFOLLOW; seam=the open flags handed to the reader, and node:fs/promises open of the loaded reader
test('a manifest that grows while it is read but stays within the limit is read whole where the system’s open cannot refuse a link, as on Windows', async () => {
  // Arrange: a manifest of 10 bytes grows by 6 bytes to exactly the limit of 16 before it is read.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
  const manifestPath = join(folder, 'codebook-wiki.json')
  await writeFile(manifestPath, '{"a":"12"}')
  const readGrowingFile = await loadReaderWhoseFileGrowsAfterStat(' '.repeat(6))
  try {
    // Act
    const read = await readGrowingFile(
      manifestPath,
      OPEN_FLAGS_WITHOUT_NOFOLLOW,
    )

    // Assert
    assert.equal(read?.bytes.toString('utf8'), '{"a":"12"}      ')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

test('a manifest that is a symbolic link is not read, also when the file it points to is small', async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
  const targetPath = join(folder, 'elsewhere.json')
  const manifestPath = join(folder, 'codebook-wiki.json')
  await writeFile(targetPath, '{"a":"12"}')
  try {
    if (!(await createLinkIfAllowed(targetPath, manifestPath)))
      return context.skip(LINK_NOT_ALLOWED)

    // Act
    const read = await readWikiRegularFile(manifestPath)

    // Assert
    assert.equal(read?.bytes.toString('utf8'), undefined)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=a Wiki manifest, receipt or update marker of a repository that is a link to a file outside the Wiki folder not being read in a Windows editor; fails_when=the reader relies on O_NOFOLLOW, which Windows does not define, so the open follows the link and the target's bytes are read; why_new=Cycle 0046 row 71: the link test ran with the flag only; seam=the open flags handed to the reader
test('a manifest that is a symbolic link is not read where the system’s open cannot refuse a link, as on Windows', async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
  const targetPath = join(folder, 'elsewhere.json')
  const manifestPath = join(folder, 'codebook-wiki.json')
  await writeFile(targetPath, '{"a":"12"}')
  try {
    if (!(await createLinkIfAllowed(targetPath, manifestPath)))
      return context.skip(LINK_NOT_ALLOWED)

    // Act
    const read = await readWikiRegularFile(
      manifestPath,
      OPEN_FLAGS_WITHOUT_NOFOLLOW,
    )

    // Assert
    assert.equal(read?.bytes.toString('utf8'), undefined)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=the start of an update not being held by a named pipe at a Wiki metadata path on a system whose open cannot refuse a link; fails_when=the look at the path does not refuse what is no regular file, so the pipe is opened without O_NONBLOCK and the open waits for a writer that never comes; why_new=Cycle 0046 row 71: without O_NOFOLLOW the reader has no O_NONBLOCK either, and the look is all that keeps a pipe from being opened; seam=the open flags handed to the reader
test(
  'a manifest that is a named pipe is refused at once where the system’s open cannot refuse a link, instead of holding the read',
  {
    timeout: 2_000,
    skip:
      process.platform === 'win32'
        ? 'Windows has no named pipe in a folder, and no mkfifo to create one'
        : false,
  },
  async (context) => {
    // Arrange
    const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
    const pipePath = join(folder, 'codebook-wiki.json')
    await promisify(execFile)('mkfifo', [pipePath])
    // A read that waits on the pipe would keep this process alive, and the test's body with it: the hook runs also when the body is stopped at its time bound.
    context.after(async () => {
      await open(
        pipePath,
        openConstants.O_WRONLY | openConstants.O_NONBLOCK,
      ).then(
        (writer) => writer.close(),
        () => undefined,
      )
      await rm(folder, { recursive: true, force: true })
    })

    // Act
    const read = await readWikiRegularFile(
      pipePath,
      OPEN_FLAGS_WITHOUT_NOFOLLOW,
    )

    // Assert
    assert.equal(read, undefined)
  },
)

// Value: protects=every read of a Wiki manifest, receipt or update marker in a Windows editor (the Update button, the candidate listing, the publish token); fails_when=the look at the path and the opened file disagree on the device or the inode number of one file, so every regular file is refused as replaced and no Wiki can be updated; why_new=Cycle 0046 row 71: this is the case that shows on a Windows runner whether lstat and the opened file name one file alike; seam=the open flags handed to the reader
test('a manifest that is a regular file is read with its bytes, inode and modification time where the system’s open cannot refuse a link, as on Windows', async () => {
  // Arrange: a manifest last written at 2026-09-21T14:13:20Z.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
  const manifestPath = join(folder, 'codebook-wiki.json')
  await writeFile(manifestPath, '{"a":"12"}')
  await utimes(manifestPath, 1_790_000_000, 1_790_000_000)
  const inodeOfTheManifest = (await stat(manifestPath)).ino
  try {
    // Act
    const read = await readWikiRegularFile(
      manifestPath,
      OPEN_FLAGS_WITHOUT_NOFOLLOW,
    )

    // Assert
    assert.deepEqual(
      read === undefined
        ? 'refused: the opened file did not count as the file at the path'
        : {
            bytes: read.bytes.toString('utf8'),
            inode: read.inode,
            modifiedAtMs: read.modifiedAtMs,
          },
      {
        bytes: '{"a":"12"}',
        inode: inodeOfTheManifest,
        modifiedAtMs: 1_790_000_000_000,
      },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=a Wiki metadata path that a repository's process turns into a link right after Codebook looked at it not being read through that link on Windows; fails_when=the reader opens the path after its look without asking whether the opened file is the one it looked at, so the bytes of the link's target are read; why_new=Cycle 0046 row 71: a look followed by an open has a moment in between that an open with O_NOFOLLOW has not; seam=node:fs/promises lstat of the loaded reader, which replaces the path after the real look
test('a manifest that becomes a link to another file between the look at its path and its open is not read where the system’s open cannot refuse a link', async (context) => {
  // Arrange: a regular manifest, and a link to another file that is moved over it right after the look.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
  const targetPath = join(folder, 'elsewhere.json')
  const preparedLinkPath = join(folder, 'prepared-link')
  const manifestPath = join(folder, 'codebook-wiki.json')
  await writeFile(targetPath, '{"elsewhere":1}')
  await writeFile(manifestPath, '{"a":"12"}')
  try {
    if (!(await createLinkIfAllowed(targetPath, preparedLinkPath)))
      return context.skip(LINK_NOT_ALLOWED)
    const readReplacedPath = await loadReaderWhosePathIsReplacedAfterTheLook(
      () => rename(preparedLinkPath, manifestPath),
    )

    // Act
    const read = await readReplacedPath(
      manifestPath,
      OPEN_FLAGS_WITHOUT_NOFOLLOW,
    )

    // Assert: the path was replaced, and nothing was read through the link.
    assert.deepEqual(
      {
        read: read?.bytes.toString('utf8'),
        pathHoldsALink: (await lstat(manifestPath)).isSymbolicLink(),
      },
      { read: undefined, pathHoldsALink: true },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=the rule that the reader on Windows reads only the file it looked at, on a runner where no link can be created; fails_when=the device and the inode number do not tell two files of one folder apart (or are not compared), so a file moved over the path after the look is read as the one that was looked at; why_new=Cycle 0046 row 71: this case needs no right to create a link, so it runs on every Windows runner; seam=node:fs/promises lstat of the loaded reader, which replaces the path after the real look
test('a manifest that another file replaces between the look at its path and its open is not read where the system’s open cannot refuse a link', async () => {
  // Arrange: a regular manifest, and another regular file that is moved over it right after the look.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
  const otherPath = join(folder, 'another.json')
  const manifestPath = join(folder, 'codebook-wiki.json')
  await writeFile(otherPath, '{"another":1}')
  await writeFile(manifestPath, '{"a":"12"}')
  const readReplacedPath = await loadReaderWhosePathIsReplacedAfterTheLook(() =>
    rename(otherPath, manifestPath),
  )
  try {
    // Act
    const read = await readReplacedPath(
      manifestPath,
      OPEN_FLAGS_WITHOUT_NOFOLLOW,
    )

    // Assert: the path was replaced, and the file that came to it was not read as the one that was looked at.
    assert.deepEqual(
      {
        read: read?.bytes.toString('utf8'),
        pathHolds: await readFile(manifestPath, 'utf8'),
      },
      { read: undefined, pathHolds: '{"another":1}' },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
