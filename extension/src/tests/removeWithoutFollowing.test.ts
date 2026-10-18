import assert from 'node:assert/strict'
import * as realFileSystem from 'node:fs/promises'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { test, type TestContext } from 'node:test'

import type * as lookModule from '../utils/isFolderOfItsOwn'
import { isFolderOfItsOwn } from '../utils/isFolderOfItsOwn'
import type * as openModule from '../utils/openWithoutFollowing'
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

/**
 * Loads the walk on a file system of a test's own: its directory look ({@link lookModule.isFolderOfItsOwn}) and marker open ({@link openModule.openWithoutFollowing}) see the same file system.
 * @param fileSystem - The stand-in for `node:fs/promises`.
 * @returns The walk to call.
 * @example
 * const removeWhereLinksResist = await loadWalkOn(fileSystemWhoseLinksResistRemoval().fileSystem)
 */
async function loadWalkOn(
  fileSystem: Record<string, unknown>,
): Promise<typeof removeWithoutFollowing> {
  const look = await loadModule<typeof lookModule>(
    resolve(__dirname, '../utils/isFolderOfItsOwn.js'),
    { 'node:fs/promises': fileSystem },
  )
  const opener = await loadModule<typeof openModule>(
    resolve(__dirname, '../utils/openWithoutFollowing.js'),
    { 'node:fs/promises': fileSystem },
  )
  const walk = await loadModule<typeof removalModule>(
    resolve(__dirname, '../utils/removeWithoutFollowing.js'),
    {
      'node:fs/promises': fileSystem,
      './isFolderOfItsOwn': look,
      './openWithoutFollowing': opener,
    },
  )
  return walk.removeWithoutFollowing
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
  const removeWhereLinksResist = await loadWalkOn(resisting.fileSystem)

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
  const removeWhereLinksResist = await loadWalkOn(resisting.fileSystem)

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

// Value: protects=the folder behind an entry that the look without following calls a directory although it leads elsewhere (on Windows a junction whose target is a volume: the file system layer of Node.js reports only junctions to a drive path as links); fails_when=the walk lists what the look calls a directory before it asks the system to remove it, so every file of the folder behind the entry is unlinked (row 227); why_new=Cycle 0046 row 227: the removal of Node.js that the walk replaced asked `rmdir` first; seam=a file system whose lstat calls a link a directory and whose rmdir removes it as a name, as Windows removes a junction
test('an entry the look calls a directory although it leads elsewhere is removed as a name where the system removes it so: nothing is listed, and the folder it leads to keeps every file', async (context) => {
  // Arrange
  const folder = await folderWithKeptFiles(context)
  const linkPath = join(folder, 'a-link')
  await symlink(join(folder, 'kept'), linkPath, 'junction')
  const resisting = fileSystemWhoseLinksResistRemoval({
    lstatOfALink: 'a directory',
    rmdirOfALink: 'removes it',
  })
  const removeWhereTheLookIsWrong = await loadWalkOn(resisting.fileSystem)

  // Act
  const outcome = await removeWhereTheLookIsWrong(linkPath).then(
    () => 'removed',
    (error: Error) => error.message,
  )

  // Assert
  assert.deepEqual(
    { outcome, listed: resisting.listed, left: await entriesBelow(folder) },
    {
      outcome: 'removed',
      listed: [],
      left: [
        'kept',
        'kept/notes.txt',
        'kept/photos',
        'kept/photos/holiday.txt',
      ],
    },
  )
})

// Value: protects=the folder behind such an entry on a system that answers "not empty" when asked to remove it: that answer alone must not open the folder behind it; fails_when=the walk lists every entry whose removal answers "not empty", without asking whether the entry is its parent's own, so the folder it leads to is emptied (row 227); why_new=Cycle 0046 row 227: a directory is listed only as its parent's own entry; seam=a file system whose lstat calls a link a directory and whose rmdir of it answers ENOTEMPTY
test('an entry the look calls a directory although it leads elsewhere, and that the system calls not empty, fails the removal with that answer and its own name: nothing is listed, and the folder it leads to keeps every file', async (context) => {
  // Arrange
  const folder = await folderWithKeptFiles(context)
  const linkPath = join(folder, 'a-link')
  await symlink(join(folder, 'kept'), linkPath, 'junction')
  const resisting = fileSystemWhoseLinksResistRemoval({
    lstatOfALink: 'a directory',
  })
  const removeWhereTheLookIsWrong = await loadWalkOn(resisting.fileSystem)

  // Act
  const outcome = await removeWhereTheLookIsWrong(linkPath).then(
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
      outcome: `ENOTEMPTY: rmdir '${linkPath}'`,
      listed: [],
      isTheLinkStillThere: true,
      kept: ['notes.txt', 'photos', 'photos/holiday.txt'],
    },
  )
})

// Value: protects=the files of a folder a link leads to when a running program renames a folder the walk is emptying and puts that link at its path between the walk's look and its listing: the walk confirms that the path still names the directory it looked at (device and file id) before it removes anything below it, stops with an error that names the folder, and removes nothing through the link (CX6, /ship Codex adversarial review); fails_when=the walk lists the path through the link and removes the entries of the folder the link leads to by their names below the path; why_new=the walk's JSDoc named this race as a limit; seam=a file system stand-in whose listing of one folder first renames it and puts a link (a junction on Windows) to the kept folder in its place
test('a folder that a running program replaces by a link between the walk’s look and its listing stops the walk with an error that says so, and the folder the link leads to keeps every file', async (context) => {
  // Arrange: a folder with a file of the same name as one in `kept`; right before the walk lists it, a program renames it and puts a link to `kept` at its path.
  const folder = await folderWithKeptFiles(context)
  const swapped = join(folder, 'swapped')
  await mkdir(swapped)
  await writeFile(join(swapped, 'notes.txt'), 'own')
  const removeWhileSwapped = await loadWalkOn({
    ...realFileSystem,
    readdir: async (path: string) => {
      if (path === swapped) {
        await rename(swapped, join(folder, 'moved-away'))
        await symlink(join(folder, 'kept'), swapped, 'junction')
      }
      return readdir(path)
    },
  })

  // Act
  const outcome = await removeWhileSwapped(swapped).then(
    () => 'removed',
    (error: Error) => error.message,
  )

  // Assert
  assert.deepEqual(
    { outcome, kept: await entriesBelow(join(folder, 'kept')) },
    {
      outcome: `The folder ${swapped} was replaced by another entry while Codebook emptied it; nothing more in it was removed.`,
      kept: ['notes.txt', 'photos', 'photos/holiday.txt'],
    },
  )
})

// Value: protects=the files of another real folder that a running program renames into the path of a folder the walk is emptying, between the walk's look and its listing: the walk tells the folder by its device and file id, not by its type alone, so it stops with an error that names the path and removes none of the other folder's files (CX6; TT42, the third testing review); fails_when=the walk confirms only that a directory stands at the path, so it removes the other folder's entries by their names; why_new=the CX6 test swapped in a link, which the type check alone already refuses; seam=a file system stand-in whose listing of one folder first renames it away and renames another real folder into its place
test('a folder that a running program replaces by another real folder between the walk’s look and its listing stops the walk with an error that says so, and the other folder keeps every file', async (context) => {
  // Arrange: the folder to remove and another folder with a file of the same name; right before the walk lists the first, a program puts the second at its path.
  const folder = await folderWithKeptFiles(context)
  const swapped = join(folder, 'swapped')
  const other = join(folder, 'other')
  await mkdir(swapped)
  await writeFile(join(swapped, 'notes.txt'), 'own')
  await mkdir(other)
  await writeFile(join(other, 'notes.txt'), 'other')
  const removeWhileSwapped = await loadWalkOn({
    ...realFileSystem,
    readdir: async (path: string) => {
      if (path === swapped) {
        await rename(swapped, join(folder, 'moved-away'))
        await rename(other, swapped)
      }
      return readdir(path)
    },
  })

  // Act
  const outcome = await removeWhileSwapped(swapped).then(
    () => 'removed',
    (error: Error) => error.message,
  )

  // Assert
  assert.deepEqual(
    {
      outcome,
      otherAtThePath: await readFile(join(swapped, 'notes.txt'), 'utf8'),
    },
    {
      outcome: `The folder ${swapped} was replaced by another entry while Codebook emptied it; nothing more in it was removed.`,
      otherAtThePath: 'other',
    },
  )
})

// Value: protects=the folder a link leads to when a running program renames the folder the walk is emptying and puts the link at its path after the walk asked whether the folder is its parent's own and before it lists it: the walk looks at the path again before the listing, stops with an error that names the path, and never lists through the link (CX6; TT43, the third testing review); fails_when=the walk lists the path without that look, so it reads the folder the link leads to, and with an empty one there it ends with the system's ENOTDIR instead of saying what happened; why_new=the CX6 test swapped the folder inside the listing, where only the look before each removal could see it; seam=the walk's look whether a folder is its parent's own, which a running program follows at once with the swap, and a file system stand-in that counts the listings of the path
test('a folder that a running program replaces by a link right before the walk lists it stops the walk with an error that says so, and nothing is listed through the link', async (context) => {
  // Arrange: a folder with a file, and an empty folder the link will lead to; the program swaps them right after the walk's look whether the folder is its parent's own.
  const folder = await folderWithKeptFiles(context)
  const swapped = join(folder, 'swapped')
  const emptyTarget = join(folder, 'empty-target')
  await mkdir(swapped)
  await writeFile(join(swapped, 'notes.txt'), 'own')
  await mkdir(emptyTarget)
  let listingsOfThePath = 0
  let hasSwapped = false
  const walk = await loadModule<typeof removalModule>(
    resolve(__dirname, '../utils/removeWithoutFollowing.js'),
    {
      'node:fs/promises': {
        ...realFileSystem,
        readdir: async (path: string) => {
          if (path === swapped) listingsOfThePath += 1
          return readdir(path)
        },
      },
      './isFolderOfItsOwn': {
        isFolderOfItsOwn: async (path: string) => {
          const isOwn = await isFolderOfItsOwn(path)
          if (path === swapped && !hasSwapped) {
            hasSwapped = true
            await rename(swapped, join(folder, 'moved-away'))
            await symlink(emptyTarget, swapped, 'junction')
          }
          return isOwn
        },
      },
    },
  )

  // Act
  const outcome = await walk.removeWithoutFollowing(swapped).then(
    () => 'removed',
    (error: Error) => error.message,
  )

  // Assert
  assert.deepEqual(
    { outcome, listingsOfThePath },
    {
      outcome: `The folder ${swapped} was replaced by another entry while Codebook emptied it; nothing more in it was removed.`,
      listingsOfThePath: 0,
    },
  )
})

// Value: protects=the start of an update and the takeover of a lock when another window removes the same folder in the same moment (two windows that clear one killed window's prepared claim); fails_when=a directory that is gone when the walk comes to list it, or to remove it, fails the walk with ENOENT instead of counting as removed (row 229); why_new=Cycle 0046 row 229: the listing was the one step of the walk that did not pass over a missing entry; seam=a file system on which another window removes the folder right before the walk's listing, and one on which it does so right before the walk's first removal
test('a folder that another window removes while the walk is at it counts as removed: the walk ends without an error when the folder is gone at its listing, and when it is gone at its removal', async (context) => {
  // Arrange: two folders with a file each; the other window removes the first right before the walk lists it and the second right before the walk asks the system to remove it.
  const folder = await folderWithKeptFiles(context)
  const goneAtTheListing = join(folder, 'gone-at-the-listing')
  const goneAtTheRemoval = join(folder, 'gone-at-the-removal')
  for (const path of [goneAtTheListing, goneAtTheRemoval]) {
    await mkdir(path)
    await writeFile(join(path, 'a-file'), 'x')
  }
  const removeBesideAnotherWindow = await loadWalkOn({
    ...realFileSystem,
    readdir: async (path: string) => {
      if (path === goneAtTheListing) await rm(path, { recursive: true })
      return readdir(path)
    },
    rmdir: async (path: string) => {
      if (path === goneAtTheRemoval) await rm(path, { recursive: true })
      await realFileSystem.rmdir(path)
    },
  })

  // Act
  const outcomes = {
    goneAtTheListing: await removeBesideAnotherWindow(goneAtTheListing).then(
      () => 'removed',
      (error: Error) => error.message,
    ),
    goneAtTheRemoval: await removeBesideAnotherWindow(goneAtTheRemoval).then(
      () => 'removed',
      (error: Error) => error.message,
    ),
  }

  // Assert
  assert.deepEqual(
    { outcomes, left: await readdir(folder) },
    {
      outcomes: { goneAtTheListing: 'removed', goneAtTheRemoval: 'removed' },
      left: ['kept'],
    },
  )
})

// Value: protects=a profile folder that another program writes into after the walk listed it (Chrome writing a file as it ends, an antivirus scan): the walk lists the folder again before the entry that goes last, removes the new entry first, and removes the folder whole (R3, /ship third review, Codex B2); fails_when=the walk removes every listed entry, the marker among them, and the folder's own removal then fails with "not empty", so the new file stays in a folder without a marker, which every later sweep passes over for good; why_new=every walk test listed a folder that nothing wrote into meanwhile; seam=a file system stand-in whose first listing of the folder lets another program write a file into it right after the listing
test('a folder that gains a file after the walk listed it is removed whole: the new file goes before the entry that goes last', async (context) => {
  // Arrange: a profile folder with a browser file and its marker; another program writes a log file into it right after the walk's first listing.
  const parent = await folderWithKeptFiles(context)
  const folder = join(parent, 'codebook-browser-x')
  await mkdir(join(folder, 'Default'), { recursive: true })
  await writeFile(join(folder, 'Default', 'Preferences'), '{}')
  await writeFile(join(folder, 'codebook-owner.json'), '{"pid":4242}')
  let listingsOfTheFolder = 0
  const removeWhileWrittenInto = await loadWalkOn({
    ...realFileSystem,
    readdir: async (path: string) => {
      const names = await readdir(path)
      if (path === folder && (listingsOfTheFolder += 1) === 1)
        await writeFile(join(folder, 'chrome_debug.log'), 'late')
      return names
    },
  })

  // Act
  const outcome = await removeWhileWrittenInto(folder, {
    lastEntry: 'codebook-owner.json',
  }).then(
    () => 'removed',
    (error: Error) => error.message,
  )

  // Assert
  assert.deepEqual(
    { outcome, left: await readdir(parent) },
    { outcome: 'removed', left: ['kept'] },
  )
})

// Value: protects=the same folder when the other program writes into it after the walk removed the marker, right before the folder's own removal: the folder cannot go, and the marker is written back with its bytes, so a later sweep still knows the folder and tries again (R3, /ship third review, Codex B2); fails_when=the marker stays removed, so the folder with the new file is passed over by every later sweep; why_new=no walk test let a folder gain an entry after its marker went; seam=a file system stand-in whose removal of the marker lets another program write a file into the folder right after it
test('a folder that gains a file after its marker was removed keeps the marker, written back with its bytes, and the removal fails with the system’s answer', async (context) => {
  // Arrange
  const parent = await folderWithKeptFiles(context)
  const folder = join(parent, 'codebook-browser-x')
  const marker = join(folder, 'codebook-owner.json')
  await mkdir(join(folder, 'Default'), { recursive: true })
  await writeFile(marker, '{"pid":4242}')
  const removeWhileWrittenInto = await loadWalkOn({
    ...realFileSystem,
    unlink: async (path: string) => {
      await unlink(path)
      if (path === marker)
        await writeFile(join(folder, 'chrome_debug.log'), 'late')
    },
  })

  // Act
  const code = await removeWhileWrittenInto(folder, {
    lastEntry: 'codebook-owner.json',
  }).then(
    () => 'removed',
    (error: NodeJS.ErrnoException) => error.code,
  )

  // Assert
  assert.deepEqual(
    {
      code,
      left: (await readdir(folder)).toSorted(),
      marker: await readFile(marker, 'utf8'),
    },
    {
      code: 'ENOTEMPTY',
      left: ['chrome_debug.log', 'codebook-owner.json'],
      marker: '{"pid":4242}',
    },
  )
})

// Value: protects=the end of a removal while another program keeps writing into the folder: the walk lists it again only a bounded number of times, then stops with an error that names the new entries and leaves the marker in place for a later removal (R3, /ship third review, Codex B2); fails_when=the walk lists and removes without end, or removes the marker while entries are still being made; why_new=the walk lists a folder again since R3; seam=a file system stand-in whose every listing of the folder lets another program write a new file into it right after the listing
test('a folder that gains a file after every listing stops the walk with an error that names the new file, and keeps its marker', async (context) => {
  // Arrange
  const parent = await folderWithKeptFiles(context)
  const folder = join(parent, 'codebook-browser-x')
  await mkdir(folder)
  await writeFile(join(folder, 'codebook-owner.json'), '{"pid":4242}')
  await writeFile(join(folder, 'chrome_debug.log'), 'first')
  let listingsOfTheFolder = 0
  const removeWhileWrittenInto = await loadWalkOn({
    ...realFileSystem,
    readdir: async (path: string) => {
      const names = await readdir(path)
      if (path === folder)
        await writeFile(
          join(folder, `late-${(listingsOfTheFolder += 1)}.log`),
          'late',
        )
      return names
    },
  })

  // Act
  const outcome = await removeWhileWrittenInto(folder, {
    lastEntry: 'codebook-owner.json',
  }).then(
    () => 'removed',
    (error: Error) => error.message,
  )

  // Assert: each listing lets one file in after it; the walk removes what three more listings find, and the last listing before the marker still finds late-4.
  assert.deepEqual(
    { outcome, left: (await readdir(folder)).toSorted() },
    {
      outcome: `The folder ${folder} kept gaining entries while Codebook emptied it (late-4.log); its codebook-owner.json stays, so a later removal tries again.`,
      left: ['codebook-owner.json', 'late-4.log', 'late-5.log'],
    },
  )
})

// Value: protects=the last marker when the directory identity changes before or during the final listing; fails_when=the last-entry phase reads or removes a marker below a path that no longer reports the original directory; why_new=Cycle 0046 row 1051: ordinary-entry guards did not cover the last-entry phase; seam=owned folders with a synthetic inode change after a chosen listing
for (const { listing, stage } of [
  { listing: 1, stage: 'before the last listing' },
  { listing: 2, stage: 'during the last listing' },
]) {
  test(`a directory identity change ${stage} leaves its last marker unread and untouched`, async (context) => {
    // Arrange: only the reported identity changes; the owned folder stays in place.
    const parent = await folderWithKeptFiles(context)
    const folder = join(parent, 'codebook-browser-x')
    const marker = join(folder, 'codebook-owner.json')
    await mkdir(folder)
    await writeFile(marker, '{"pid":4242}')
    let listings = 0
    let hasChangedIdentity = false
    let markerOpens = 0
    const removeWithChangedIdentity = await loadWalkOn({
      ...realFileSystem,
      lstat: async (path: string) => {
        const entry = await lstat(path, { bigint: true })
        if (path === folder && hasChangedIdentity) entry.ino += 1n
        return entry
      },
      readdir: async (path: string) => {
        const names = await readdir(path)
        if (path === folder && (listings += 1) === listing)
          hasChangedIdentity = true
        return names
      },
      open: async (...args: Parameters<typeof realFileSystem.open>) => {
        if (args[0] === marker) markerOpens += 1
        return realFileSystem.open(...args)
      },
    })

    // Act
    const outcome = await removeWithChangedIdentity(folder, {
      lastEntry: 'codebook-owner.json',
    }).then(
      () => 'removed',
      (error: Error) => error.message,
    )

    // Assert
    assert.deepEqual(
      {
        outcome,
        markerOpens,
        marker: await readFile(marker, 'utf8').catch(() => undefined),
      },
      {
        outcome: `The folder ${folder} was replaced by another entry while Codebook emptied it; nothing more in it was removed.`,
        markerOpens: 0,
        marker: '{"pid":4242}',
      },
    )
  })
}

// Value: protects=the marker after its saved bytes were read but the parent directory no longer reports the original identity; fails_when=the walk unlinks the last entry without checking its parent again; why_new=Cycle 0046 row 1051: checking only before the marker read leaves this separate await uncovered; seam=the marker open changes only the folder's reported inode
test('a directory identity change while its last marker is read leaves that marker untouched', async (context) => {
  // Arrange
  const parent = await folderWithKeptFiles(context)
  const folder = join(parent, 'codebook-browser-x')
  const marker = join(folder, 'codebook-owner.json')
  await mkdir(folder)
  await writeFile(marker, '{"pid":4242}')
  let hasChangedIdentity = false
  const removeWithChangedIdentity = await loadWalkOn({
    ...realFileSystem,
    lstat: async (path: string) => {
      const entry = await lstat(path, { bigint: true })
      if (path === folder && hasChangedIdentity) entry.ino += 1n
      return entry
    },
    open: async (...args: Parameters<typeof realFileSystem.open>) => {
      const file = await realFileSystem.open(...args)
      if (args[0] === marker) hasChangedIdentity = true
      return file
    },
  })

  // Act
  const outcome = await removeWithChangedIdentity(folder, {
    lastEntry: 'codebook-owner.json',
  }).then(
    () => 'removed',
    (error: Error) => error.message,
  )

  // Assert
  assert.deepEqual(
    {
      outcome,
      marker: await readFile(marker, 'utf8').catch(() => undefined),
    },
    {
      outcome: `The folder ${folder} was replaced by another entry while Codebook emptied it; nothing more in it was removed.`,
      marker: '{"pid":4242}',
    },
  )
})

// Value: protects=the directory after the last marker's removal when its reported identity changes; fails_when=the walk removes the directory without confirming it still names the original folder; why_new=Cycle 0046 row 1051: the last unlink and directory removal are separate calls; seam=the marker unlink changes only the folder's reported inode
test('a directory identity change after its last marker was removed stops the final directory removal', async (context) => {
  // Arrange
  const parent = await folderWithKeptFiles(context)
  const folder = join(parent, 'codebook-browser-x')
  const marker = join(folder, 'codebook-owner.json')
  await mkdir(folder)
  await writeFile(marker, '{"pid":4242}')
  let hasChangedIdentity = false
  const removeWithChangedIdentity = await loadWalkOn({
    ...realFileSystem,
    lstat: async (path: string) => {
      const entry = await lstat(path, { bigint: true })
      if (path === folder && hasChangedIdentity) entry.ino += 1n
      return entry
    },
    unlink: async (path: string) => {
      await unlink(path)
      if (path === marker) hasChangedIdentity = true
    },
  })

  // Act
  const outcome = await removeWithChangedIdentity(folder, {
    lastEntry: 'codebook-owner.json',
  }).then(
    () => 'removed',
    (error: Error) => error.message,
  )

  // Assert
  assert.deepEqual(
    {
      outcome,
      entries: await readdir(folder).catch(() => undefined),
    },
    {
      outcome: `The folder ${folder} was replaced by another entry while Codebook emptied it; nothing more in it was removed.`,
      entries: [],
    },
  )
})

// Value: protects=the path whose directory identity changes during the failed final removal; fails_when=the old owner marker is restored into a directory that no longer reports the original identity; why_new=Cycle 0046 row 1051: restoration had no parent identity guard; seam=final rmdir reports ENOTEMPTY and changes only the folder's reported inode
test('a directory identity change at the failed final removal prevents marker restoration and keeps the original error', async (context) => {
  // Arrange
  const parent = await folderWithKeptFiles(context)
  const folder = join(parent, 'codebook-browser-x')
  const marker = join(folder, 'codebook-owner.json')
  await mkdir(folder)
  await writeFile(marker, '{"pid":4242}')
  const refusal = Object.assign(new Error('The folder is not empty.'), {
    code: 'ENOTEMPTY',
  })
  let wasMarkerRemoved = false
  let hasChangedIdentity = false
  const removeWithChangedIdentity = await loadWalkOn({
    ...realFileSystem,
    lstat: async (path: string) => {
      const entry = await lstat(path, { bigint: true })
      if (path === folder && hasChangedIdentity) entry.ino += 1n
      return entry
    },
    unlink: async (path: string) => {
      await unlink(path)
      if (path === marker) wasMarkerRemoved = true
    },
    rmdir: async (path: string) => {
      if (path === folder && wasMarkerRemoved) {
        hasChangedIdentity = true
        throw refusal
      }
      await realFileSystem.rmdir(path)
    },
  })

  // Act
  const failure = await removeWithChangedIdentity(folder, {
    lastEntry: 'codebook-owner.json',
  }).catch((error: unknown) => error)

  // Assert
  assert.equal(failure, refusal)
  assert.deepEqual(await readdir(folder), [])
})

// Value: protects=the existing missing-directory result during the last-entry phase; fails_when=a new identity guard treats a folder another cleanup removed as an error; why_new=Cycle 0046 row 1051 adds identity checks to this phase; seam=the final listing removes only its owned fixture folder after reading the names
test('a folder removed during the last listing still counts as removed', async (context) => {
  // Arrange
  const parent = await folderWithKeptFiles(context)
  const folder = join(parent, 'codebook-browser-x')
  await mkdir(folder)
  await writeFile(join(folder, 'codebook-owner.json'), '{"pid":4242}')
  let listings = 0
  const removeBesideAnotherCleanup = await loadWalkOn({
    ...realFileSystem,
    readdir: async (path: string) => {
      const names = await readdir(path)
      if (path === folder && (listings += 1) === 2)
        await rm(folder, { recursive: true })
      return names
    },
  })

  // Act
  await removeBesideAnotherCleanup(folder, {
    lastEntry: 'codebook-owner.json',
  })

  // Assert
  assert.deepEqual(await readdir(parent), ['kept'])
})
