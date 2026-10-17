import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type * as lookModule from '../utils/isFolderOfItsOwn'

import { loadModule } from './utils/loadModule'

/**
 * Makes a temporary folder that is removed with the test, holding the folder `wiki` of its own: the entry every test of this file looks at.
 * @example const wiki = await folderOfItsOwn(context) // => '/tmp/codebook-own-folder-x/wiki'
 */
async function folderOfItsOwn(context: TestContext): Promise<string> {
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-own-folder-')),
  )
  context.after(() => rm(folder, { recursive: true, force: true }))
  await mkdir(join(folder, 'wiki'))
  return join(folder, 'wiki')
}

/**
 * Loads {@link isFolderOfItsOwn} on a file system whose `realpath` refuses one path with the given code, as Windows refuses the real path of a junction whose volume it cannot name; every other call is the real one.
 * @param refusedPath - The path whose real path is refused.
 * @param code - The system's code of the refusal.
 * @example const look = await lookWhoseRealPathIsRefused('/tmp/x/wiki', 'EPERM')
 */
async function lookWhoseRealPathIsRefused(
  refusedPath: string,
  code: string,
): Promise<typeof lookModule.isFolderOfItsOwn> {
  const { isFolderOfItsOwn } = await loadModule<typeof lookModule>(
    resolve(__dirname, '../utils/isFolderOfItsOwn.js'),
    {
      'node:fs/promises': {
        ...fileSystem,
        realpath: async (path: string) => {
          if (path === refusedPath)
            throw Object.assign(new Error(`${code}: realpath '${path}'`), {
              code,
            })
          return fileSystem.realpath(path)
        },
      },
    },
  )
  return isFolderOfItsOwn
}

/** Says how a look ended, in words a test can compare: its answer, or the code it was refused with. @example await answerOrCode(isFolderOfItsOwn('/tmp/x/wiki')) // => 'ENOENT' */
function answerOrCode(look: Promise<boolean>): Promise<boolean | string> {
  return look.catch((error: unknown) =>
    error instanceof Error && 'code' in error ? String(error.code) : 'thrown',
  )
}

// Value: protects=every listing, read and removal below a folder of the learner's project whose real path the system cannot name (on Windows, a junction to a volume, which the look without following calls a directory); fails_when=a refused real path is taken for the folder's own, or the refusal ends the look, so a folder that may lead elsewhere is listed, read below or emptied, or every look there fails with the system's text; why_new=Cycle 0046 /ship review T10: no test made realpath fail, and 4 of 8 mutants of its two refusals survived; seam=node:fs/promises realpath of the loaded look, which refuses the folder's or its parent's path with EPERM
test('a folder whose real path, or whose parent’s real path, the system cannot name is answered as no folder of its own', async (context) => {
  // Arrange
  const wiki = await folderOfItsOwn(context)
  const lookAtNothingRefused = await lookWhoseRealPathIsRefused(
      join(wiki, 'never-looked-at'),
      'EPERM',
    ),
    lookWhoseFolderIsRefused = await lookWhoseRealPathIsRefused(wiki, 'EPERM'),
    lookWhoseParentIsRefused = await lookWhoseRealPathIsRefused(
      join(wiki, '..'),
      'EPERM',
    )

  // Act
  const answers = {
    nothingRefused: await answerOrCode(lookAtNothingRefused(wiki)),
    folderRefused: await answerOrCode(lookWhoseFolderIsRefused(wiki)),
    parentRefused: await answerOrCode(lookWhoseParentIsRefused(wiki)),
  }

  // Assert
  assert.deepEqual(answers, {
    nothingRefused: true,
    folderRefused: false,
    parentRefused: false,
  })
})

// Value: protects=a folder that a running program removes between the look and the reading of its real path; fails_when=the missing entry is answered as a folder that leads elsewhere ("no folder"), so a caller that removes what it finds goes on as if a link stood there, instead of meeting the path that is gone; why_new=Cycle 0046 /ship review T10: the ENOENT half of the refusal had no test; seam=node:fs/promises realpath of the loaded look, which answers ENOENT for the folder's or its parent's path
test('a folder that is gone when its real path, or its parent’s real path, is read is answered with ENOENT, not as no folder of its own', async (context) => {
  // Arrange
  const wiki = await folderOfItsOwn(context)
  const lookWhoseFolderIsGone = await lookWhoseRealPathIsRefused(
      wiki,
      'ENOENT',
    ),
    lookWhoseParentIsGone = await lookWhoseRealPathIsRefused(
      join(wiki, '..'),
      'ENOENT',
    )

  // Act
  const answers = {
    folderGone: await answerOrCode(lookWhoseFolderIsGone(wiki)),
    parentGone: await answerOrCode(lookWhoseParentIsGone(wiki)),
  }

  // Assert
  assert.deepEqual(answers, { folderGone: 'ENOENT', parentGone: 'ENOENT' })
})
