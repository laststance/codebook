import assert from 'node:assert/strict'
import { constants as fileSystemConstants, type StatOptions } from 'node:fs'
import * as fileSystem from 'node:fs/promises'
import {
  link,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as DropSecondNameModule from '../utils/dropSecondNameOfMovedFile'
import { dropSecondNameOfMovedFile } from '../utils/dropSecondNameOfMovedFile'
import type * as DropNameOfOneFileModule from '../utils/dropSecondNameOfOneFile'
import { dropSecondNameOfOneFile } from '../utils/dropSecondNameOfOneFile'
import {
  openWithoutFollowing,
  type NoFollowOpenConstants,
} from '../utils/openWithoutFollowing'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { loadDropSecondNameWhoseLinkIsRefused } from './utils/loadDropSecondNameWhoseLinkIsRefused'
import { loadModule } from './utils/loadModule'
import { loadOpenWithoutFollowing } from './utils/loadOpenWithoutFollowing'

/** What a caller words a refused link back with; the tests of the moves that need no such sentence hand it too. */
const sentenceOfARefusedLinkBack = (code: string): string =>
  `The file could not be put back (${code}).`

// Value: protects=a file of the learner that a setup or removal of Codebook moved away and found changed (the Cursor skill, the Cursor MCP config); fails_when=the file is not put back at its own path, keeps a second name for good, or a file that stands at its path meanwhile is replaced or the moved one removed; why_new=Cycle 0046 row 188: the recoveries undo such a move by one rule; seam=none, real files
test('a moved file gets its own path back where nothing stands there and loses its second name once it stands at its path, and where another file took the path both files stay', async () => {
  // Arrange: four moves. The first file was linked back already; the second was only moved away; the third never moved; at the fourth another file took the path.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-second-name-'))
  const own = (name: string): string => join(folder, `${name}.json`)
  const second = (name: string): string => join(folder, `${name}.moved`)
  await writeFile(own('linked-back'), 'first')
  await link(own('linked-back'), second('linked-back'))
  await writeFile(own('moved-away'), 'second')
  await rename(own('moved-away'), second('moved-away'))
  await writeFile(own('never-moved'), 'third')
  await writeFile(own('path-taken'), 'fourth')
  await rename(own('path-taken'), second('path-taken'))
  await writeFile(own('path-taken'), 'another file')
  try {
    // Act
    const outcomes = {
      linkedBack: await dropSecondNameOfMovedFile(
        own('linked-back'),
        second('linked-back'),
        sentenceOfARefusedLinkBack,
      ),
      movedAway: await dropSecondNameOfMovedFile(
        own('moved-away'),
        second('moved-away'),
        sentenceOfARefusedLinkBack,
      ),
      neverMoved: await dropSecondNameOfMovedFile(
        own('never-moved'),
        second('never-moved'),
        sentenceOfARefusedLinkBack,
      ),
      pathTaken: await dropSecondNameOfMovedFile(
        own('path-taken'),
        second('path-taken'),
        sentenceOfARefusedLinkBack,
      ),
    }

    // Assert
    assert.deepEqual(
      {
        outcomes,
        entries: (await readdir(folder)).sort(),
        movedAway: await readFile(own('moved-away'), 'utf8'),
        pathTaken: await readFile(own('path-taken'), 'utf8'),
        keptSecondName: await readFile(second('path-taken'), 'utf8'),
        linksOfTheFirst: (await lstat(own('linked-back'))).nlink,
      },
      {
        outcomes: {
          linkedBack: 'dropped',
          movedAway: 'dropped',
          neverMoved: 'dropped',
          pathTaken: 'kept',
        },
        entries: [
          'linked-back.json',
          'moved-away.json',
          'never-moved.json',
          'path-taken.json',
          'path-taken.moved',
        ],
        movedAway: 'second',
        pathTaken: 'another file',
        keptSecondName: 'fourth',
        linksOfTheFirst: 1,
      },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=the rule that Codebook removes a second name only of the file that also stands at its own path; fails_when=two files with the same bytes, or a path and a missing name, count as one file, so a name of another file is removed; or a second name of the file itself stays; why_new=Cycle 0046 row 188, and row 307: the comparison and the removal are one step; seam=none, real files
test('a second name is removed only of the file that also stands at its own path: a hard link of it goes and the file keeps its own name, a copy with the same bytes stays, and a missing name removes nothing', async () => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-second-name-'))
  const filePath = join(folder, 'a-file')
  const linkedPath = join(folder, 'its-second-name')
  const copyPath = join(folder, 'a-copy')
  await writeFile(filePath, 'bytes')
  await link(filePath, linkedPath)
  await writeFile(copyPath, 'bytes')
  try {
    // Act
    const answers = {
      itsSecondName: await dropSecondNameOfOneFile(filePath, linkedPath),
      aCopy: await dropSecondNameOfOneFile(filePath, copyPath),
      aMissingSecondName: await dropSecondNameOfOneFile(
        filePath,
        join(folder, 'missing'),
      ),
      aMissingOwnPath: await dropSecondNameOfOneFile(
        join(folder, 'missing'),
        copyPath,
      ),
    }

    // Assert
    assert.deepEqual(
      {
        answers,
        entries: (await readdir(folder)).sort(),
        linksOfTheFile: (await lstat(filePath)).nlink,
      },
      {
        answers: {
          itsSecondName: 'dropped',
          aCopy: 'not-one-file',
          aMissingSecondName: 'not-one-file',
          aMissingOwnPath: 'not-one-file',
        },
        entries: ['a-copy', 'a-file'],
        linksOfTheFile: 1,
      },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=a file of the learner that Codebook moved away and found changed, on a file system that refuses hard links (exFAT, some network shares); fails_when=the refused link back reaches the learner as the file system's own text ("EPERM: operation not permitted, link …"), which names neither where their file is nor what to do; why_new=Cycle 0046 row 243: the caller's sentence answers every code but the two that mean nothing is to put back; seam=node:fs/promises link of the loaded utility, which refuses with EPERM
test('a moved file that the file system refuses to link back stays under its second name, and the refusal is the caller’s sentence for that code with the file system’s error as its cause', async () => {
  // Arrange: a file that was moved away, with nothing at its own path.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-second-name-'))
  const ownPath = join(folder, 'moved-away.json'),
    secondPath = join(folder, 'moved-away.moved')
  await writeFile(secondPath, 'the learner’s file')
  const onAFileSystemWithoutLinks =
    await loadDropSecondNameWhoseLinkIsRefused('EPERM')
  try {
    // Act
    const refusal = await onAFileSystemWithoutLinks
      .dropSecondNameOfMovedFile(
        ownPath,
        secondPath,
        sentenceOfARefusedLinkBack,
      )
      .then(
        () => ({ message: 'no refusal', causeCode: undefined }),
        (error: Error & { cause?: { code?: string } }) => ({
          message: error.message,
          causeCode: error.cause?.code,
        }),
      )

    // Assert
    assert.deepEqual(
      {
        refusal,
        names: (await readdir(folder)).sort(),
        keptFile: await readFile(secondPath, 'utf8'),
      },
      {
        refusal: {
          message: 'The file could not be put back (EPERM).',
          causeCode: 'EPERM',
        },
        names: ['moved-away.moved'],
        keptFile: 'the learner’s file',
      },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

/**
 * Loads the rule over a file system on which the first file is gone by the time the second name is looked at: right after the first look at one of the two names, or the first open of one, the file at the own path is deleted and a new file is created under the second name, and every look at that name reports the new file under the deleted file's inode number, as a file system does that gives a freed number to the next file it creates (ext4). The numbers of open files are left as this system gives them: a file that is open keeps its number.
 * @param paths - `ownPath` holds the first file; `secondPath` holds nothing yet.
 * @param openConstants - The flags of the opener; without `O_NOFOLLOW` it looks at a path before it opens it, as on Windows.
 * @returns `dropSecondNameOfOneFile` and `dropSecondNameOfMovedFile` over that file system.
 */
async function loadRuleWhereTheFirstFileIsGoneByTheSecondLook(
  paths: { ownPath: string; secondPath: string },
  openConstants?: NoFollowOpenConstants,
): Promise<{
  dropSecondNameOfOneFile: typeof DropNameOfOneFileModule.dropSecondNameOfOneFile
  dropSecondNameOfMovedFile: typeof DropSecondNameModule.dropSecondNameOfMovedFile
}> {
  const freedNumber = (await lstat(paths.ownPath, { bigint: true })).ino
  const namesOfTheRule = [paths.ownPath, paths.secondPath]
  let isFirstFileGone = false
  const loseTheFirstFileOnce = async (): Promise<void> => {
    if (isFirstFileGone) return
    isFirstFileGone = true
    await rm(paths.ownPath)
    await writeFile(paths.secondPath, 'A new file under the second name.')
  }
  const fileSystemOfTheRule = {
    ...fileSystem,
    lstat: async (path: string, options?: StatOptions) => {
      const look = await fileSystem
        .lstat(path, options)
        .finally(() =>
          namesOfTheRule.includes(path) ? loseTheFirstFileOnce() : undefined,
        )
      // The new file got the freed number: a look at its name reports it, as a number or as a bigint.
      return path === paths.secondPath && isFirstFileGone
        ? Object.assign(Object.create(Object.getPrototypeOf(look)), look, {
            ino:
              typeof look.ino === 'bigint' ? freedNumber : Number(freedNumber),
          })
        : look
    },
    open: async (
      path: string,
      ...flagsAndMode: [flags?: string | number, mode?: number]
    ) =>
      fileSystem
        .open(path, ...flagsAndMode)
        .finally(() =>
          namesOfTheRule.includes(path) ? loseTheFirstFileOnce() : undefined,
        ),
  }
  const namesRule = await loadModule<typeof DropNameOfOneFileModule>(
    resolve(__dirname, '../utils/dropSecondNameOfOneFile.js'),
    {
      'node:fs/promises': fileSystemOfTheRule,
      './openWithoutFollowing': await loadOpenWithoutFollowing({
        fileSystem: fileSystemOfTheRule,
        openConstants,
      }),
    },
    { Error },
  )
  const dropRule = await loadModule<typeof DropSecondNameModule>(
    resolve(__dirname, '../utils/dropSecondNameOfMovedFile.js'),
    {
      'node:fs/promises': fileSystemOfTheRule,
      './dropSecondNameOfOneFile': namesRule,
    },
    { Error },
  )
  return {
    dropSecondNameOfOneFile: namesRule.dropSecondNameOfOneFile,
    dropSecondNameOfMovedFile: dropRule.dropSecondNameOfMovedFile,
  }
}

// Value: protects=a file that is created under the name Codebook gave a moved file, after that moved file was deleted, on a file system that gives the new file the deleted file's inode number; fails_when=the rule looks at the two names one after the other and compares the numbers of the two looks, so the new file counts as a second name of the first and its name is removed: the file is lost; why_new=Cycle 0046 row 304: both names are opened and the numbers of the two open files are compared, so that both files exist at the moment they are compared; seam=node:fs/promises lstat and open of the loaded rule and of its opener: the first file is gone after the first look at a name or open of one, and a look at the second name reports the freed number
test('a file that is created under the second name after the first file was deleted, and that has the first file’s inode number by the time the second name is looked at, is not a name of the first file: its name is not removed, with the system’s flags and where the system’s open cannot refuse a link', async () => {
  // Arrange: four folders, each with a file at its own path and nothing under the second name; two rules are asked to remove the second name, two undo a move.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-second-name-'))
  const pathsOf = async (
    name: string,
  ): Promise<{ ownPath: string; secondPath: string }> => {
    const paths = {
      ownPath: join(folder, `${name}.json`),
      secondPath: join(folder, `${name}.moved`),
    }
    await writeFile(paths.ownPath, 'The first file.')
    return paths
  }
  const asked = await pathsOf('asked'),
    askedAsOnWindows = await pathsOf('asked-as-on-windows'),
    undone = await pathsOf('undone'),
    undoneAsOnWindows = await pathsOf('undone-as-on-windows')
  const flagsWithoutNoFollow = { O_RDONLY: fileSystemConstants.O_RDONLY }
  try {
    // Act
    const answers = {
      asked: await (
        await loadRuleWhereTheFirstFileIsGoneByTheSecondLook(asked)
      ).dropSecondNameOfOneFile(asked.ownPath, asked.secondPath),
      askedAsOnWindows: await (
        await loadRuleWhereTheFirstFileIsGoneByTheSecondLook(
          askedAsOnWindows,
          flagsWithoutNoFollow,
        )
      ).dropSecondNameOfOneFile(
        askedAsOnWindows.ownPath,
        askedAsOnWindows.secondPath,
      ),
      undone: await (
        await loadRuleWhereTheFirstFileIsGoneByTheSecondLook(undone)
      ).dropSecondNameOfMovedFile(
        undone.ownPath,
        undone.secondPath,
        sentenceOfARefusedLinkBack,
      ),
      undoneAsOnWindows: await (
        await loadRuleWhereTheFirstFileIsGoneByTheSecondLook(
          undoneAsOnWindows,
          flagsWithoutNoFollow,
        )
      ).dropSecondNameOfMovedFile(
        undoneAsOnWindows.ownPath,
        undoneAsOnWindows.secondPath,
        sentenceOfARefusedLinkBack,
      ),
    }

    // Assert: no name of the new files is removed.
    assert.deepEqual(
      {
        answers,
        entries: (await readdir(folder)).sort(),
        newFiles: [
          await readFile(asked.secondPath, 'utf8'),
          await readFile(askedAsOnWindows.secondPath, 'utf8'),
          await readFile(undone.secondPath, 'utf8'),
          await readFile(undoneAsOnWindows.secondPath, 'utf8'),
        ],
      },
      {
        answers: {
          asked: 'not-one-file',
          askedAsOnWindows: 'not-one-file',
          undone: 'kept',
          undoneAsOnWindows: 'kept',
        },
        entries: [
          'asked-as-on-windows.moved',
          'asked.moved',
          'undone-as-on-windows.moved',
          'undone.moved',
        ],
        newFiles: [
          'A new file under the second name.',
          'A new file under the second name.',
          'A new file under the second name.',
          'A new file under the second name.',
        ],
      },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=a file a link under the second name points to; fails_when=the rule opens the second name through the link and finds the file itself, so the link counts as a second name and is removed as one; why_new=Cycle 0046 row 304: the names are opened, and a link is not opened; seam=none, the real link
test('a link to a file is not a second name of that file: the name is not opened through the link, and the link stays', async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-second-name-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const filePath = join(folder, 'a-file'),
    linkPath = join(folder, 'a-link-to-it')
  await writeFile(filePath, 'bytes')
  if (!(await createLinkIfAllowed(filePath, linkPath)))
    return context.skip(LINK_NOT_ALLOWED)

  // Act
  const answers = {
    linkAsTheSecondName: await dropSecondNameOfOneFile(filePath, linkPath),
    linkAtTheOwnPath: await dropSecondNameOfOneFile(linkPath, filePath),
  }

  // Assert
  assert.deepEqual(
    { answers, entries: (await readdir(folder)).sort() },
    {
      answers: {
        linkAsTheSecondName: 'not-one-file',
        linkAtTheOwnPath: 'not-one-file',
      },
      entries: ['a-file', 'a-link-to-it'],
    },
  )
})

/**
 * Loads the rule with an opener and a removal a test watches, over the real files: every removal of a name and every close of a file the rule opened is written down in the order it happens, and a test may refuse an open, refuse a removal or act at a close.
 * @param standIns - `refusedOpen`: the code the opener refuses a path with (asked for every open). `refusedUnlink`: the code a removal is refused with, asked with the number of files the rule holds open at that moment. `atAClose`: runs before a file is closed, with the number of that close (from 1).
 * @returns The rule, and what it did: `unlink` or `unlink refused with <code>`, and `close`.
 */
async function loadRuleWatched(
  standIns: {
    refusedOpen?: (path: string) => string | undefined
    refusedUnlink?: (openFiles: number) => string | undefined
    atAClose?: (closeNumber: number) => Promise<void>
  } = {},
): Promise<{
  dropSecondNameOfOneFile: typeof DropNameOfOneFileModule.dropSecondNameOfOneFile
  events: string[]
  openFiles: () => number
}> {
  const events: string[] = []
  let openFiles = 0
  let closes = 0
  const rule = await loadModule<typeof DropNameOfOneFileModule>(
    resolve(__dirname, '../utils/dropSecondNameOfOneFile.js'),
    {
      'node:fs/promises': {
        ...fileSystem,
        unlink: async (path: string): Promise<void> => {
          const code = standIns.refusedUnlink?.(openFiles)
          if (code !== undefined) {
            events.push(`unlink refused with ${code}`)
            throw Object.assign(new Error(`${code}: refused, unlink`), { code })
          }
          await fileSystem.unlink(path)
          events.push('unlink')
        },
      },
      './openWithoutFollowing': {
        openWithoutFollowing: async (path: string) => {
          const code = standIns.refusedOpen?.(path)
          if (code !== undefined)
            throw Object.assign(new Error(`${code}: refused, open`), { code })
          const file = await openWithoutFollowing(path)
          openFiles += 1
          const close = file.close.bind(file)
          let isClosed = false
          return Object.assign(file, {
            close: async (): Promise<void> => {
              // A second close of a closed file does nothing, as the real one.
              if (isClosed) return
              isClosed = true
              closes += 1
              await standIns.atAClose?.(closes)
              openFiles -= 1
              events.push('close')
              return close()
            },
          })
        },
      },
    },
    { Error },
  )
  return {
    dropSecondNameOfOneFile: rule.dropSecondNameOfOneFile,
    events,
    openFiles: () => openFiles,
  }
}

// Value: protects=the answer for a name the system does not open; fails_when=a name this user may not read counts as one file with another (a name is removed on no evidence), or a failure that says nothing of the name (too many open files) is answered "two files", so a recovery goes on as if it knew; or a file is left open; why_new=Cycle 0046 row 304: a name that cannot be opened is not "one file"; seam=the opener of the loaded rule, which refuses the second name with a code
test('a second name of a file is not removed while this user may not open one of the two names, and a failure of the open that says nothing of the name is thrown as it is; no file is left open', async () => {
  // Arrange: a file with two names, and rules whose opener refuses the second name with a code.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-second-name-'))
  const filePath = join(folder, 'a-file'),
    linkedPath = join(folder, 'its-second-name')
  await writeFile(filePath, 'bytes')
  await link(filePath, linkedPath)
  const ruleWhoseSecondNameIsRefusedWith = (
    code: string,
  ): ReturnType<typeof loadRuleWatched> =>
    loadRuleWatched({
      refusedOpen: (path) => (path === linkedPath ? code : undefined),
    })
  const withoutTheRight = await ruleWhoseSecondNameIsRefusedWith('EACCES'),
    heldByAnotherProgram = await ruleWhoseSecondNameIsRefusedWith('EBUSY'),
    withTooManyOpenFiles = await ruleWhoseSecondNameIsRefusedWith('EMFILE'),
    whoseOwnPathIsHeld = await loadRuleWatched({
      refusedOpen: (path) => (path === filePath ? 'EBUSY' : undefined),
    })
  try {
    // Act
    const answers = {
      noRightToRead: await withoutTheRight.dropSecondNameOfOneFile(
        filePath,
        linkedPath,
      ),
      heldByAnotherProgram: await heldByAnotherProgram.dropSecondNameOfOneFile(
        filePath,
        linkedPath,
      ),
      tooManyOpenFiles: await withTooManyOpenFiles
        .dropSecondNameOfOneFile(filePath, linkedPath)
        .then(
          (answer) => `answered ${answer}`,
          (error: Error & { code?: string }) => `thrown with ${error.code}`,
        ),
      ownPathHeldByAnotherProgram:
        await whoseOwnPathIsHeld.dropSecondNameOfOneFile(filePath, linkedPath),
    }

    // Assert
    assert.deepEqual(
      {
        answers,
        entries: (await readdir(folder)).sort(),
        filesLeftOpen: [
          withoutTheRight.openFiles(),
          heldByAnotherProgram.openFiles(),
          withTooManyOpenFiles.openFiles(),
          whoseOwnPathIsHeld.openFiles(),
        ],
        closesWhereTheOwnPathWasHeld: whoseOwnPathIsHeld.events,
      },
      {
        answers: {
          noRightToRead: 'not-one-file',
          heldByAnotherProgram: 'not-one-file',
          tooManyOpenFiles: 'thrown with EMFILE',
          ownPathHeldByAnotherProgram: 'not-one-file',
        },
        entries: ['a-file', 'its-second-name'],
        filesLeftOpen: [0, 0, 0, 0],
        closesWhereTheOwnPathWasHeld: ['close'],
      },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=a file that another writer puts under the second name right after Codebook compared the two names; fails_when=the rule closes the two files before it removes the name, so a file that took the name at the closes is removed as "the second name"; why_new=Cycle 0046 row 307: the name is removed right after the comparison, with both files still open; seam=the closes of the files the loaded rule opened: at the first of them another writer replaces the second name
test('a file that takes the second name while Codebook closes the two files it compared is not removed: the second name was removed before the closes, with both files open', async () => {
  // Arrange: a file with two names, and a rule at whose first close another writer puts a new file under the second name.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-second-name-'))
  const filePath = join(folder, 'a-file'),
    linkedPath = join(folder, 'its-second-name')
  await writeFile(filePath, 'bytes')
  await link(filePath, linkedPath)
  const rule = await loadRuleWatched({
    atAClose: async (closeNumber) => {
      if (closeNumber !== 1) return
      await rm(linkedPath, { force: true })
      await writeFile(linkedPath, 'A file of another writer.')
    },
  })
  try {
    // Act
    const answer = await rule.dropSecondNameOfOneFile(filePath, linkedPath)

    // Assert
    assert.deepEqual(
      {
        answer,
        events: rule.events,
        file: await readFile(filePath, 'utf8'),
        fileOfTheOtherWriter: await readFile(linkedPath, 'utf8'),
      },
      {
        answer: 'dropped',
        events: ['unlink', 'close', 'close'],
        file: 'bytes',
        fileOfTheOtherWriter: 'A file of another writer.',
      },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=the removal of a second name on a system that does not let a name of an open file go (Windows may refuse it); fails_when=the refusal ends the recovery with the file system's text and the second name stays for good, or the order is chosen by the system's name instead of its answer; why_new=Cycle 0046 row 307: with the files open where the system allows it, after the closes where it refuses; seam=node:fs/promises unlink of the loaded rule, which refuses a removal while a file is open
test('where the system refuses to remove a name of an open file, the second name is removed after both files were closed, for each code such a refusal carries, and a removal that is refused for another reason is thrown as it is', async () => {
  // Arrange: four files with two names each, and rules whose removal is refused while a file is open.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-second-name-'))
  const outcomes: Record<string, { answer: string; events: string[] }> = {}
  try {
    // Act
    for (const code of ['EPERM', 'EBUSY', 'EACCES', 'EIO']) {
      const filePath = join(folder, `a-file-${code}`),
        linkedPath = join(folder, `its-second-name-${code}`)
      await writeFile(filePath, 'bytes')
      await link(filePath, linkedPath)
      const rule = await loadRuleWatched({
        refusedUnlink: (openFiles) => (openFiles > 0 ? code : undefined),
      })
      outcomes[code] = {
        answer: await rule.dropSecondNameOfOneFile(filePath, linkedPath).then(
          (answer) => answer,
          (error: Error & { code?: string }) => `thrown with ${error.code}`,
        ),
        events: rule.events,
      }
    }

    // Assert
    assert.deepEqual(
      { outcomes, entries: (await readdir(folder)).sort() },
      {
        outcomes: {
          EPERM: {
            answer: 'dropped',
            events: ['unlink refused with EPERM', 'close', 'close', 'unlink'],
          },
          EBUSY: {
            answer: 'dropped',
            events: ['unlink refused with EBUSY', 'close', 'close', 'unlink'],
          },
          EACCES: {
            answer: 'dropped',
            events: ['unlink refused with EACCES', 'close', 'close', 'unlink'],
          },
          EIO: {
            answer: 'thrown with EIO',
            events: ['unlink refused with EIO', 'close', 'close'],
          },
        },
        entries: [
          'a-file-EACCES',
          'a-file-EBUSY',
          'a-file-EIO',
          'a-file-EPERM',
          'its-second-name-EIO',
        ],
      },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=the knowledge of which order a system takes, which the Windows job reports; fails_when=on this system the second name of one file is not removed in one of the two orders the rule knows (with both files open, or after both closes), or the file loses its own name; why_new=Cycle 0046 row 307: the Windows job shows which order Windows takes; seam=none on the file system's answers: the real removal and the real closes are only written down
test('on this system the second name of one file is removed in one of the two orders the rule knows, and the run says which: with both files still open, or after both were closed', async (context) => {
  // Arrange: a file with two names, and the rule over the real files with its removals and closes written down.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-second-name-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const filePath = join(folder, 'a-file'),
    linkedPath = join(folder, 'its-second-name')
  await writeFile(filePath, 'bytes')
  await link(filePath, linkedPath)
  const rule = await loadRuleWatched()

  // Act
  const answer = await rule.dropSecondNameOfOneFile(filePath, linkedPath)
  const order = rule.events.join(', ')
  context.diagnostic(`order of the removal on ${process.platform}: ${order}`)

  // Assert
  assert.deepEqual(
    {
      answer,
      isAKnownOrder: [
        'unlink, close, close',
        'unlink refused with EPERM, close, close, unlink',
        'unlink refused with EBUSY, close, close, unlink',
        'unlink refused with EACCES, close, close, unlink',
      ].includes(order),
      entries: await readdir(folder),
      file: await readFile(filePath, 'utf8'),
    },
    {
      answer: 'dropped',
      isAKnownOrder: true,
      entries: ['a-file'],
      file: 'bytes',
    },
  )
})
