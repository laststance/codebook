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
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import * as constants from '../constants'
import {
  openWithoutFollowing,
  type NoFollowOpenConstants,
} from '../utils/openWithoutFollowing'
import type * as ReadWikiRegularFileModule from '../utils/readWikiRegularFile'
import { readWikiRegularFile } from '../utils/readWikiRegularFile'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { fileSystemWithLargeFileIds } from './utils/fileSystemWithLargeFileIds'
import { loadModule } from './utils/loadModule'
import { loadOpenWithoutFollowing } from './utils/loadOpenWithoutFollowing'

/** The open flags of a system whose open cannot refuse a link: Windows defines neither `O_NOFOLLOW` nor `O_NONBLOCK`. Handed to the reader, it takes the way it takes on Windows on every system. */
const OPEN_FLAGS_WITHOUT_NOFOLLOW = { O_RDONLY: openConstants.O_RDONLY }

/**
 * Loads the reader of Wiki metadata files with an `lstat` that answers the real look at the path and then lets the test replace what the path names, the moment between the look and the open on a system whose open cannot refuse a link.
 * @param replacePath - Replaces the entry at the path; runs once, right after the look.
 * @returns The loaded `readWikiRegularFile`.
 */
async function loadReaderWhosePathIsReplacedAfterTheLook(
  replacePath: () => Promise<void>,
): Promise<typeof ReadWikiRegularFileModule.readWikiRegularFile> {
  // The look and the open are the opener's, so the stand-in is the opener's `lstat`, and the reader opens through that opener.
  const openingAfterAReplacedLook = await loadOpenWithoutFollowing({
    fileSystem: {
      ...fileSystem,
      lstat: async (path: string, options: { bigint: true }) => {
        const lookBeforeTheReplacement = await fileSystem.lstat(path, options)
        await replacePath()
        return lookBeforeTheReplacement
      },
    },
  })
  const loaded = await loadModule<typeof ReadWikiRegularFileModule>(
    resolve(__dirname, '../utils/readWikiRegularFile.js'),
    { './openWithoutFollowing': openingAfterAReplacedLook },
  )
  return loaded.readWikiRegularFile
}

/**
 * Loads the reader of Wiki metadata files with a limit of 16 bytes and an opener whose file grows by `grownText` right after the reader took its `stat`, the moment between the size check and the read. The opener is the real one: where the open cannot refuse a link it has asked which file it opened before the reader gets the file, and the file does not grow at that question.
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
      './openWithoutFollowing': {
        openWithoutFollowing: async (
          path: string,
          flagsOfTheSystem?: NoFollowOpenConstants,
        ): Promise<fileSystem.FileHandle> => {
          const file = await openWithoutFollowing(path, flagsOfTheSystem)
          const statOfOpenedFile = file.stat.bind(file)
          file.stat = (async (options?: StatOptions) => {
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

// Value: protects=the size limit of a Wiki metadata read on Windows, where the opener asks which file it opened before the reader checks the size; fails_when=a file that grows after the size check is refused or cut where the path was looked at first, although it stays within the limit; why_new=Cycle 0046 row 71: the reader's tests never ran on a system without O_NOFOLLOW; seam=the open flags handed to the reader, and the opener of the loaded reader, whose file grows after the reader's stat
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
  const inodeOfTheManifest = (await stat(manifestPath, { bigint: true })).ino
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
        inode: inodeOfTheManifest.toString(),
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

// Value: protects=the publish token and the publication identity of a Wiki on an NTFS volume, which name a file by its id; fails_when=the reader takes the inode number as a JavaScript number, so an id above 2^53 is rounded (210824757556437109 becomes 210824757556437120) and two files share one value; why_new=Cycle 0046 row 79: a file id above 2^53 was observed on the development host; seam=node:fs/promises of the opener the loaded reader opens through, whose files have ids above 2^53
test('a manifest whose file id is above 2^53, as on an NTFS volume, is read with that id in exact decimal digits', async () => {
  // Arrange: the manifest is the first file a status is asked for, so its id is 210824757556437109.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
  const manifestPath = join(folder, 'codebook-wiki.json')
  await writeFile(manifestPath, '{"a":"12"}')
  const { readWikiRegularFile: readFileWithALargeId } = await loadModule<
    typeof ReadWikiRegularFileModule
  >(resolve(__dirname, '../utils/readWikiRegularFile.js'), {
    './openWithoutFollowing': await loadOpenWithoutFollowing({
      fileSystem: fileSystemWithLargeFileIds(),
    }),
  })
  try {
    // Act
    const read = await readFileWithALargeId(manifestPath)

    // Assert
    assert.deepEqual(
      { bytes: read?.bytes.toString('utf8'), inode: read?.inode },
      { bytes: '{"a":"12"}', inode: '210824757556437109' },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=the watch of a VS Code update and the end of every run, which read the Wiki's manifest and receipt through this reader and catch nothing below it; fails_when=a file handle whose close fails makes the read reject, so the watch breaks off or a run stays "running" with no end, or the bytes of such a handle are answered as if the read had been whole; why_new=Cycle 0046 row 344 (the close was awaited in a `finally` outside the reader's `catch`); seam=the opener, whose real handle is closed and then reports the close as failed
test('a manifest whose file handle cannot be closed is answered as a file that could not be read, without a rejection, and the same manifest is read whole by a handle that closes', async () => {
  // Arrange: a manifest of ten bytes, and an opener whose handle really closes and then rejects, as a file system error at close does.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-wiki-regular-file-'))
  const manifestPath = join(folder, 'codebook-wiki.json')
  await writeFile(manifestPath, '{"a":"12"}')
  const closes: string[] = []
  const { readWikiRegularFile: readWithAFailingClose } = await loadModule<
    typeof ReadWikiRegularFileModule
  >(resolve(__dirname, '../utils/readWikiRegularFile.js'), {
    './openWithoutFollowing': {
      openWithoutFollowing: async (
        path: string,
        flagsOfTheSystem?: NoFollowOpenConstants,
      ): Promise<fileSystem.FileHandle> => {
        const file = await openWithoutFollowing(path, flagsOfTheSystem)
        const closeOfOpenedFile = file.close.bind(file)
        file.close = async (): Promise<void> => {
          await closeOfOpenedFile()
          closes.push('closed, then reported as failed')
          throw new Error('EIO: i/o error, close')
        }
        return file
      },
    },
  })
  try {
    // Act
    const outcome = await readWithAFailingClose(manifestPath).then(
      (read) => (read === undefined ? 'not read' : 'read'),
      (error: unknown) => `rejected: ${String(error)}`,
    )
    const readByAHandleThatCloses = await readWikiRegularFile(manifestPath)

    // Assert
    assert.equal(outcome, 'not read')
    assert.deepEqual(closes, ['closed, then reported as failed'])
    assert.equal(readByAHandleThatCloses?.bytes.toString('utf8'), '{"a":"12"}')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
