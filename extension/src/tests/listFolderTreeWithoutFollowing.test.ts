import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { test, type TestContext } from 'node:test'

import { listFolderTreeWithoutFollowing } from '../utils/listFolderTreeWithoutFollowing'

/**
 * Makes a temporary folder that is removed with the test, holding a folder `elsewhere` with two files: what a link of a test leads to.
 * @example const folder = await folderWithFilesElsewhere(context) // => '/tmp/codebook-list-x', with elsewhere/notes.txt and elsewhere/photos/holiday.txt
 */
async function folderWithFilesElsewhere(context: TestContext): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'codebook-list-')))
  context.after(() => rm(folder, { recursive: true, force: true }))
  await mkdir(join(folder, 'elsewhere', 'photos'), { recursive: true })
  await writeFile(join(folder, 'elsewhere', 'notes.txt'), 'kept')
  await writeFile(join(folder, 'elsewhere', 'photos', 'holiday.txt'), 'kept')
  return folder
}

/**
 * Names what a listing answered as `/`-separated paths below the listed folder, sorted, or says that nothing was listed.
 * @example await namesListedBelow('/tmp/x/wiki') // => ['index.html', 'pages', 'pages/overview.html']
 */
async function namesListedBelow(
  directory: string,
): Promise<string[] | 'not listed'> {
  const entries = await listFolderTreeWithoutFollowing(directory)
  if (entries === undefined) return 'not listed'
  return entries
    .map((entry) =>
      relative(directory, join(entry.parentPath, entry.name))
        .split(sep)
        .join('/'),
    )
    .toSorted()
}

// Value: protects=the looks at a Wiki's output folder in a cloned repository (the start check, the watch's stamp, the conflict listing); fails_when=a link at the folder's own path, a junction on Windows, is listed through, so each look walks the folder the link leads to and reports its files as the Wiki's; why_new=Cycle 0046 row 185: the three looks listed the output folder by name, which follows a link at that path; this file runs in the Windows job, where the link is a junction; seam=none, the real file system
test('a link at the folder’s own path is not listed: nothing of the folder it leads to is named', async (context) => {
  // Arrange: a link (a junction on Windows) where the Wiki folder would be, leading to a folder with files.
  const folder = await folderWithFilesElsewhere(context)
  await symlink(join(folder, 'elsewhere'), join(folder, 'wiki'), 'junction')

  // Act
  const listed = await namesListedBelow(join(folder, 'wiki'))

  // Assert
  assert.equal(listed, 'not listed')
})

// Value: protects=the same looks at a Wiki folder that is a real folder; fails_when=the look that refuses a link also refuses a folder of its own, or a link below the folder is entered; why_new=Cycle 0046 row 185: the listing has a look in front of it; seam=none, the real file system
test('a folder of its own is listed with everything below it, and a link below it is named and not entered', async (context) => {
  // Arrange: a Wiki folder with a page in a subfolder and a link to a folder elsewhere.
  const folder = await folderWithFilesElsewhere(context)
  const wiki = join(folder, 'wiki')
  await mkdir(join(wiki, 'pages'), { recursive: true })
  await writeFile(join(wiki, 'index.html'), '<p>Overview</p>')
  await writeFile(join(wiki, 'pages', 'overview.html'), '<p>Overview</p>')
  await symlink(join(folder, 'elsewhere'), join(wiki, 'linked'), 'junction')

  // Act
  const listed = await namesListedBelow(wiki)

  // Assert
  assert.deepEqual(listed, [
    'index.html',
    'linked',
    'pages',
    'pages/overview.html',
  ])
})

// Value: protects=the callers' own answers for a file where the Wiki folder would be and for no Wiki at all; fails_when=a file at the path is listed as if it were a folder (the file system's ENOTDIR instead of "not a folder"), or a missing folder is answered as "not a folder"; why_new=Cycle 0046 row 185: the start check tells a file at the path by this answer and a missing Wiki by the file system's error; seam=none, the real file system
test('a file at the folder’s own path is not listed, and a path that holds nothing is the file system’s own error', async (context) => {
  // Arrange
  const folder = await folderWithFilesElsewhere(context)
  await writeFile(join(folder, 'wiki'), 'a file where the folder would be')

  // Act
  const fileAtThePath = await namesListedBelow(join(folder, 'wiki'))
  const nothingAtThePath = await namesListedBelow(
    join(folder, 'no-wiki'),
  ).catch((error: unknown) =>
    error instanceof Error && 'code' in error ? String(error.code) : 'thrown',
  )

  // Assert
  assert.deepEqual(
    { fileAtThePath, nothingAtThePath },
    { fileAtThePath: 'not listed', nothingAtThePath: 'ENOENT' },
  )
})
