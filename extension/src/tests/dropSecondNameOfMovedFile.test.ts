import assert from 'node:assert/strict'
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
import { join } from 'node:path'
import { test } from 'node:test'

import { areNamesOfOneFile } from '../utils/areNamesOfOneFile'
import { dropSecondNameOfMovedFile } from '../utils/dropSecondNameOfMovedFile'

import { loadDropSecondNameWhoseLinkIsRefused } from './utils/loadDropSecondNameWhoseLinkIsRefused'

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
