import assert from 'node:assert/strict'
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { test, type TestContext } from 'node:test'

import type * as removalModule from '../utils/removeWithoutFollowing'
import { removeWithoutFollowing } from '../utils/removeWithoutFollowing'

import { fileSystemWhoseLinksResistRemoval } from './utils/fileSystemWhoseLinksResistRemoval'
import { loadModule } from './utils/loadModule'

/**
 * Makes a temporary folder that is removed with the test, holding a folder `kept` with a file and a subfolder with a file: what a link of a test leads to.
 * @example const folder = await folderWithKeptFiles(context) // => '/tmp/codebook-remove-x', with kept/notes.txt and kept/photos/holiday.txt
 */
async function folderWithKeptFiles(context: TestContext): Promise<string> {
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-remove-')),
  )
  context.after(() => rm(folder, { recursive: true, force: true }))
  await mkdir(join(folder, 'kept', 'photos'), { recursive: true })
  await writeFile(join(folder, 'kept', 'notes.txt'), 'kept')
  await writeFile(join(folder, 'kept', 'photos', 'holiday.txt'), 'kept')
  return folder
}

/** Lists every file, folder and link below a folder as `/`-separated paths, sorted; a link is named and not followed. @example await entriesBelow('/tmp/x') // => ['kept', 'kept/notes.txt'] */
async function entriesBelow(folder: string): Promise<string[]> {
  return (await readdir(folder, { recursive: true, withFileTypes: true }))
    .map((entry) =>
      relative(folder, join(entry.parentPath, entry.name)).split(sep).join('/'),
    )
    .toSorted()
}

// Value: protects=the learner's files behind a link that a repository puts at a path Codebook removes (the Wiki update marker's paths); fails_when=the removal looks at an entry through a link, or lists below one, so the folder a link leads to is emptied; why_new=Cycle 0046 row 187: the removal is a walk of Codebook's own instead of the recursive removal of Node.js; seam=none (a junction on Windows, which needs no right)
test('a link is removed as a name, at the path itself and inside a folder that is removed with its content, and the folder it leads to keeps every file', async (context) => {
  // Arrange: a link to the kept folder, and a folder that holds a file, a subfolder and another link to the kept folder.
  const folder = await folderWithKeptFiles(context)
  await symlink(join(folder, 'kept'), join(folder, 'a-link'), 'junction')
  await mkdir(join(folder, 'removed', 'deeper'), { recursive: true })
  await writeFile(join(folder, 'removed', 'deeper', 'a-file'), 'x')
  await symlink(
    join(folder, 'kept'),
    join(folder, 'removed', 'a-link-inside'),
    'junction',
  )

  // Act
  await removeWithoutFollowing(join(folder, 'a-link'))
  await removeWithoutFollowing(join(folder, 'removed'))

  // Assert
  assert.deepEqual(await entriesBelow(folder), [
    'kept',
    'kept/notes.txt',
    'kept/photos',
    'kept/photos/holiday.txt',
  ])
})

// Value: protects=the callers that remove an entry which another window may remove in the same moment (a claim, a prepared file); fails_when=a path that holds nothing, or a single file, is an error or is left; why_new=Cycle 0046 row 187: the walk replaces `rm` with `force`; seam=none
test('a file is removed, and a path that holds nothing is no error', async (context) => {
  // Arrange
  const folder = await folderWithKeptFiles(context)
  await writeFile(join(folder, 'a-file'), 'x')

  // Act
  await removeWithoutFollowing(join(folder, 'a-file'))
  await removeWithoutFollowing(join(folder, 'nothing-here'))

  // Assert
  assert.deepEqual(await readdir(folder), ['kept'])
})

// Value: protects=the folder a link leads to when the system refuses to remove the link (on Windows `EPERM` for a link this user may not delete): the recursive removal of Node.js then looks again with `stat`, which follows the link, and can empty the folder behind it; fails_when=the removal tries another way after a refused unlink, or lists below a link at all; why_new=Cycle 0046 row 187; seam=a file system whose unlink of a link answers EPERM
test('a link the system refuses to unlink fails the removal with that error and the link’s own name: nothing is listed, and the folder it leads to keeps every file', async (context) => {
  // Arrange
  const folder = await folderWithKeptFiles(context)
  const linkPath = join(folder, 'a-link')
  await symlink(join(folder, 'kept'), linkPath, 'junction')
  const resisting = fileSystemWhoseLinksResistRemoval()
  const { removeWithoutFollowing: removeWhereLinksResist } = await loadModule<
    typeof removalModule
  >(resolve(__dirname, '../utils/removeWithoutFollowing.js'), {
    'node:fs/promises': resisting.fileSystem,
  })

  // Act
  const outcome = await removeWhereLinksResist(linkPath).then(
    () => 'removed',
    (error: Error) => error.message,
  )

  // Assert
  assert.deepEqual(
    {
      outcome,
      listed: resisting.listed,
      isTheLinkStillThere: (await lstat(linkPath)).isSymbolicLink(),
      kept: await entriesBelow(join(folder, 'kept')),
    },
    {
      outcome: `EPERM: unlink '${linkPath}'`,
      listed: [],
      isTheLinkStillThere: true,
      kept: ['notes.txt', 'photos', 'photos/holiday.txt'],
    },
  )
})

// Value: protects=the folder behind a link that lies inside a folder Codebook removes with its content (a prepared claim folder a repository supplies); fails_when=after the refused unlink of the link the walk goes on, lists below the link or removes the folder another way; why_new=Cycle 0046 row 187; seam=a file system whose unlink of a link answers EPERM
test('a folder that holds a link the system refuses to unlink is listed itself and never below the link: the removal fails with the link’s error, and the folder the link leads to keeps every file', async (context) => {
  // Arrange
  const folder = await folderWithKeptFiles(context)
  const removedPath = join(folder, 'removed')
  await mkdir(removedPath)
  await symlink(
    join(folder, 'kept'),
    join(removedPath, 'a-link-inside'),
    'junction',
  )
  const resisting = fileSystemWhoseLinksResistRemoval()
  const { removeWithoutFollowing: removeWhereLinksResist } = await loadModule<
    typeof removalModule
  >(resolve(__dirname, '../utils/removeWithoutFollowing.js'), {
    'node:fs/promises': resisting.fileSystem,
  })

  // Act
  const outcome = await removeWhereLinksResist(removedPath).then(
    () => 'removed',
    (error: Error) => error.message,
  )

  // Assert
  assert.deepEqual(
    {
      outcome,
      listed: resisting.listed,
      kept: await entriesBelow(join(folder, 'kept')),
    },
    {
      outcome: `EPERM: unlink '${join(removedPath, 'a-link-inside')}'`,
      listed: [removedPath],
      kept: ['notes.txt', 'photos', 'photos/holiday.txt'],
    },
  )
})
