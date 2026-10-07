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

import type * as AreNamesOfOneFileModule from '../utils/areNamesOfOneFile'
import { areNamesOfOneFile } from '../utils/areNamesOfOneFile'
import type * as DropSecondNameModule from '../utils/dropSecondNameOfMovedFile'
import { dropSecondNameOfMovedFile } from '../utils/dropSecondNameOfMovedFile'
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

// Value: protects=the rule that Codebook removes a second name only of the file that also stands at its own path; fails_when=two files with the same bytes, or a path and a missing name, count as one file, so a name of another file is removed; why_new=Cycle 0046 row 188; seam=none, real files
test('two paths are names of one file only when they are hard links of it: a copy with the same bytes and a missing path are not', async () => {
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
      itsSecondName: await areNamesOfOneFile(filePath, linkedPath),
      aCopy: await areNamesOfOneFile(filePath, copyPath),
      aMissingPath: await areNamesOfOneFile(filePath, join(folder, 'missing')),
      twoMissingPaths: await areNamesOfOneFile(
        join(folder, 'missing'),
        join(folder, 'missing-too'),
      ),
    }

    // Assert
    assert.deepEqual(answers, {
      itsSecondName: true,
      aCopy: false,
      aMissingPath: false,
      twoMissingPaths: false,
    })
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
 * Loads the rule over a file system on which the first file is gone by the time the second name is looked at: right after the first look at the own path, or the first open of it, the file there is deleted and a new file is created under the second name, and every look at that name reports the new file under the deleted file's inode number, as a file system does that gives a freed number to the next file it creates (ext4). The numbers of open files are left as this system gives them: a file that is open keeps its number.
 * @param paths - `ownPath` holds the first file; `secondPath` holds nothing yet.
 * @param openConstants - The flags of the opener; without `O_NOFOLLOW` it looks at a path before it opens it, as on Windows.
 * @returns `areNamesOfOneFile` and `dropSecondNameOfMovedFile` over that file system.
 */
async function loadRuleWhereTheFirstFileIsGoneByTheSecondLook(
  paths: { ownPath: string; secondPath: string },
  openConstants?: NoFollowOpenConstants,
): Promise<{
  areNamesOfOneFile: typeof AreNamesOfOneFileModule.areNamesOfOneFile
  dropSecondNameOfMovedFile: typeof DropSecondNameModule.dropSecondNameOfMovedFile
}> {
  const freedNumber = (await lstat(paths.ownPath, { bigint: true })).ino
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
      const look = await fileSystem.lstat(path, options)
      if (path === paths.ownPath) await loseTheFirstFileOnce()
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
    ) => {
      const file = await fileSystem.open(path, ...flagsAndMode)
      if (path === paths.ownPath) await loseTheFirstFileOnce()
      return file
    },
  }
  const namesRule = await loadModule<typeof AreNamesOfOneFileModule>(
    resolve(__dirname, '../utils/areNamesOfOneFile.js'),
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
      './areNamesOfOneFile': namesRule,
    },
    { Error },
  )
  return {
    areNamesOfOneFile: namesRule.areNamesOfOneFile,
    dropSecondNameOfMovedFile: dropRule.dropSecondNameOfMovedFile,
  }
}

// Value: protects=a file that is created under the name Codebook gave a moved file, after that moved file was deleted, on a file system that gives the new file the deleted file's inode number; fails_when=the rule looks at the two names one after the other and compares the numbers of the two looks, so the new file counts as a second name of the first and its name is removed: the file is lost; why_new=Cycle 0046 row 304: both names are opened and the numbers of the two open files are compared, so that both files exist at the moment they are compared; seam=node:fs/promises lstat and open of the loaded rule and of its opener: the first file is gone after the first look at it or open of it, and a look at the second name reports the freed number
test('a file that is created under the second name after the first file was deleted, and that has the first file’s inode number by the time the second name is looked at, is not a name of the first file: its name is not removed, with the system’s flags and where the system’s open cannot refuse a link', async () => {
  // Arrange: four folders, each with a file at its own path and nothing under the second name; two rules ask whether the names are one file, two undo a move.
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
      ).areNamesOfOneFile(asked.ownPath, asked.secondPath),
      askedAsOnWindows: await (
        await loadRuleWhereTheFirstFileIsGoneByTheSecondLook(
          askedAsOnWindows,
          flagsWithoutNoFollow,
        )
      ).areNamesOfOneFile(
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
          await readFile(undone.secondPath, 'utf8'),
          await readFile(undoneAsOnWindows.secondPath, 'utf8'),
        ],
      },
      {
        answers: {
          asked: false,
          askedAsOnWindows: false,
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
        ],
      },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

// Value: protects=a file a link under the second name points to; fails_when=the rule opens the second name through the link and finds the file itself, so the link counts as a second name and the caller removes it as one; why_new=Cycle 0046 row 304: the names are opened, and a link is not opened; seam=none, the real link
test('a link to a file is not a second name of that file: the name is not opened through the link', async (context) => {
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
    fileAndLink: await areNamesOfOneFile(filePath, linkPath),
    linkAndFile: await areNamesOfOneFile(linkPath, filePath),
  }

  // Assert
  assert.deepEqual(answers, { fileAndLink: false, linkAndFile: false })
})

// Value: protects=the answer for a name the system does not open; fails_when=a name this user may not read counts as one file with another (a name is removed on no evidence), or a failure that says nothing of the name (too many open files) is answered "two files", so a recovery goes on as if it knew; why_new=Cycle 0046 row 304: a name that cannot be opened is not "one file"; seam=the opener of the loaded rule, which refuses one name with a code
test('two hard links of one file are not counted as one file while this user may not open one of them, and a failure of the open that says nothing of the name is thrown as it is; both files are closed before the answer', async () => {
  // Arrange: a file with two names, and a rule whose opener refuses the second name with the code a test hands in.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-second-name-'))
  const filePath = join(folder, 'a-file'),
    linkedPath = join(folder, 'its-second-name')
  await writeFile(filePath, 'bytes')
  await link(filePath, linkedPath)
  let openFiles = 0
  const ruleWhoseSecondNameIsRefusedWith = async (
    code?: string,
  ): Promise<typeof AreNamesOfOneFileModule.areNamesOfOneFile> =>
    (
      await loadModule<typeof AreNamesOfOneFileModule>(
        resolve(__dirname, '../utils/areNamesOfOneFile.js'),
        {
          './openWithoutFollowing': {
            openWithoutFollowing: async (path: string) => {
              if (code !== undefined && path === linkedPath)
                throw Object.assign(new Error(`${code}: refused, open`), {
                  code,
                })
              const file = await openWithoutFollowing(path)
              openFiles += 1
              const close = file.close.bind(file)
              return Object.assign(file, {
                close: async (): Promise<void> => {
                  openFiles -= 1
                  return close()
                },
              })
            },
          },
        },
        { Error },
      )
    ).areNamesOfOneFile
  try {
    // Act
    const answers = {
      bothOpened: await (
        await ruleWhoseSecondNameIsRefusedWith()
      )(filePath, linkedPath),
      noRightToRead: await (
        await ruleWhoseSecondNameIsRefusedWith('EACCES')
      )(filePath, linkedPath),
      heldByAnotherProgram: await (
        await ruleWhoseSecondNameIsRefusedWith('EBUSY')
      )(filePath, linkedPath),
      tooManyOpenFiles: await (
        await ruleWhoseSecondNameIsRefusedWith('EMFILE')
      )(filePath, linkedPath).then(
        (answer) => `answered ${String(answer)}`,
        (error: Error & { code?: string }) => `thrown with ${error.code}`,
      ),
    }

    // Assert
    assert.deepEqual(
      { answers, filesLeftOpen: openFiles },
      {
        answers: {
          bothOpened: true,
          noRightToRead: false,
          heldByAnotherProgram: false,
          tooManyOpenFiles: 'thrown with EMFILE',
        },
        filesLeftOpen: 0,
      },
    )
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
