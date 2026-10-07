import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'

import type * as lookModule from '../utils/isFolderOfItsOwn'
import type * as placedClaimsModule from '../utils/listPlacedClaims'
import {
  readProcessStart,
  type ProcessStartReader,
} from '../utils/readProcessStart'
import type * as sweepModule from '../utils/removeStaleStorageClaims'
import { removeStaleStorageClaims } from '../utils/removeStaleStorageClaims'
import type * as removalModule from '../utils/removeWithoutFollowing'

import { fileSystemWhoseLinksResistRemoval } from './utils/fileSystemWhoseLinksResistRemoval'
import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'
import { loadModule } from './utils/loadModule'

/** Creates an empty storage directory that is removed with the test, and returns its canonical path. @example const directory = await storageDirectory(context) */
async function storageDirectory(context: TestContext): Promise<string> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-stale-claims-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

/**
 * Reads process starts as Linux does, from a stat file of the test's own for the other window's process: it is named "node" and began at clock tick 200. Its id is {@link ID_OF_NO_PROCESS}, which this test process never has, so the read is never answered with this process's own start.
 * @param onRead - Runs at every read of the file, so a test can count the reads.
 * @returns The reader to hand to the sweep.
 * @example
 * const readStart = startReaderOfTheOtherWindow(() => { reads += 1 })
 */
function startReaderOfTheOtherWindow(onRead: () => void): ProcessStartReader {
  return (pid, inputs) =>
    readProcessStart(pid, {
      ...inputs,
      platform: 'linux',
      readLink: () => 'pid:[4026531836]',
      readFile: async () => {
        onRead()
        return `${ID_OF_NO_PROCESS} (node) S 1 ${ID_OF_NO_PROCESS} ${ID_OF_NO_PROCESS} 0 -1 4194304 496 0 0 0 0 0 0 0 20 0 11 0 200 16637952 1813`
      },
    })
}

// Value: protects=a sweep over what one running window has beside the lock costs one read of its start (one spawned ps or PowerShell on macOS and Windows), not one per leftover; fails_when=the sweep reads the start again for every claim and prepared file (ER-12, decision D7); why_new=the leftovers carry their owner's start since Cycle 0046; seam=the process probe and the file read of the start reader, which counts
test('a placed claim, a prepared claim and a prepared lock of one running window are judged with one read of its start, and all stay', async (context) => {
  // Arrange: this window is a Linux process of the pid namespace 4026531836, begun at tick 16362446. Another running process, begun at clock tick 200, holds the takeover claim and is preparing a second claim and a lock.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  const ofTheRunningWindow = `{"pid":${ID_OF_NO_PROCESS},"hostname":"workstation","processStart":"linux@4026531836:200"}`
  await mkdir(join(directory, 'writer.lock.takeover'))
  await writeFile(
    join(directory, 'writer.lock.takeover', 'placed'),
    ofTheRunningWindow,
  )
  await mkdir(join(directory, 'writer.lock.takeover-prepared'))
  await writeFile(
    join(directory, 'writer.lock.takeover-prepared', 'prepared'),
    ofTheRunningWindow,
  )
  await writeFile(
    join(directory, 'writer.lock.pending-prepared'),
    ofTheRunningWindow,
  )
  context.mock.method(process, 'kill', (): true => true)
  let startReads = 0
  // Act
  await removeStaleStorageClaims(
    lockPath,
    { hostname: 'workstation', processStart: 'linux@4026531836:16362446' },
    startReaderOfTheOtherWindow(() => {
      startReads += 1
    }),
  )
  // Assert
  assert.equal(startReads, 1)
  assert.deepEqual((await readdir(directory)).sort(), [
    'writer.lock.pending-prepared',
    'writer.lock.takeover',
    'writer.lock.takeover-prepared',
  ])
  assert.deepEqual(await readdir(join(directory, 'writer.lock.takeover')), [
    'placed',
  ])
})

// Value: protects=a leftover of a killed window is removed in the sweep that has just confirmed a running window with the same process id; fails_when=the start kept for the running window's record is trusted for a record of another start, or a kept start that differs keeps the leftover in place (ER-12: a kept start may only confirm, and gone needs a read); why_new=the sweep keeps starts since Cycle 0046; seam=the process probe and the file read of the start reader
test('a prepared lock of a killed window is removed in the same sweep that keeps the prepared lock of the running window that has its process id now', async (context) => {
  // Arrange: this window is a Linux process of the pid namespace 4026531836, begun at tick 16362446. Another window began at clock tick 100 and was killed while it prepared a lock; the window that has its process id now began at tick 200 and is preparing one.
  const directory = await storageDirectory(context)
  await writeFile(
    join(directory, 'writer.lock.pending-a-of-running-window'),
    `{"pid":${ID_OF_NO_PROCESS},"hostname":"workstation","processStart":"linux@4026531836:200"}`,
  )
  await writeFile(
    join(directory, 'writer.lock.pending-b-of-killed-window'),
    `{"pid":${ID_OF_NO_PROCESS},"hostname":"workstation","processStart":"linux@4026531836:100"}`,
  )
  context.mock.method(process, 'kill', (): true => true)
  // Act
  await removeStaleStorageClaims(
    join(directory, 'writer.lock'),
    { hostname: 'workstation', processStart: 'linux@4026531836:16362446' },
    startReaderOfTheOtherWindow(() => {}),
  )
  // Assert: in whichever order the directory listed the two, each was judged by its own start.
  assert.deepEqual(await readdir(directory), [
    'writer.lock.pending-a-of-running-window',
  ])
})

// Value: protects=the files of a folder that a link at the claim folder's path leads to, when the takeover claim's sweep runs for a Wiki update's marker in a project folder (row 109); fails_when=the sweep lists `<lock>.takeover` through the link and unlinks, in the link's target, every file without content and every file that reads as the owner record of a gone process; why_new=Cycle 0046 row 109: no test put a link at the claim folder's path; seam=none (a junction on Windows, which needs no right)
test('a link at the claim folder’s path is removed as a link by the takeover claim’s sweep: the file without content and the record of a gone process in the folder it leads to stay', async (context) => {
  // Arrange: a folder with a file that has had no content for two minutes and a file that names a process of this machine that is gone, and a link to it where the claim folder would be.
  const directory = await storageDirectory(context)
  const linkedFolder = join(directory, 'a-folder-of-the-project')
  await mkdir(linkedFolder)
  await writeFile(join(linkedFolder, '.gitkeep'), '')
  const twoMinutesAgo = new Date(Date.now() - 2 * 60_000)
  await utimes(join(linkedFolder, '.gitkeep'), twoMinutesAgo, twoMinutesAgo)
  await writeFile(
    join(linkedFolder, 'record.json'),
    `{"pid":${ID_OF_NO_PROCESS},"hostname":"workstation"}`,
  )
  await symlink(
    linkedFolder,
    join(directory, 'wiki.update-run.json.takeover'),
    'junction',
  )

  // Act
  await removeStaleStorageClaims(join(directory, 'wiki.update-run.json'), {
    hostname: 'workstation',
  })

  // Assert
  assert.deepEqual(
    {
      besideTheMarker: await readdir(directory),
      linkedFolder: (await readdir(linkedFolder)).sort(),
    },
    {
      besideTheMarker: ['a-folder-of-the-project'],
      linkedFolder: ['.gitkeep', 'record.json'],
    },
  )
})

// Value: protects=the folder behind a link where a prepared claim folder would lie, when the takeover claim's sweep runs for a marker in a project folder on a system that refuses to unlink the link; fails_when=the sweep removes the entry with the recursive removal of Node.js, which after the refused unlink follows the link and empties the folder behind it (row 187); why_new=Cycle 0046 row 187; seam=a file system whose unlink of a link answers EPERM, with the removal of Node.js as it runs on Windows for a caller that still uses it
test('a link where a prepared claim folder would lie, which the system refuses to unlink, is left in place by the sweep: the folder it leads to keeps every file, also the one that reads as the record of a gone process', async (context) => {
  // Arrange: a folder with a record of a process of this machine that is gone, named as the prepared claim's owner file would be, and another file; and a link to that folder at the prepared claim's name.
  const directory = await storageDirectory(context)
  const linkedFolder = join(directory, 'a-folder-of-the-project')
  await mkdir(linkedFolder)
  await writeFile(
    join(linkedFolder, 'left'),
    `{"pid":${ID_OF_NO_PROCESS},"hostname":"workstation"}`,
  )
  await writeFile(join(linkedFolder, 'notes.txt'), 'kept')
  await symlink(
    linkedFolder,
    join(directory, 'wiki.update-run.json.takeover-left'),
    'junction',
  )
  const resisting = fileSystemWhoseLinksResistRemoval()
  const walkWhereLinksResist = await loadModule<typeof removalModule>(
    resolve(__dirname, '../utils/removeWithoutFollowing.js'),
    { 'node:fs/promises': resisting.fileSystem },
  )
  const { removeStaleStorageClaims: sweepWhereLinksResist } = await loadModule<
    typeof sweepModule
  >(resolve(__dirname, '../utils/removeStaleStorageClaims.js'), {
    'node:fs/promises': resisting.fileSystem,
    './removeWithoutFollowing': walkWhereLinksResist,
  })

  // Act
  await sweepWhereLinksResist(join(directory, 'wiki.update-run.json'), {
    hostname: 'workstation',
  })

  // Assert
  assert.deepEqual(
    {
      besideTheMarker: (await readdir(directory)).sort(),
      linkedFolder: (await readdir(linkedFolder)).sort(),
      listedBelowTheLink: resisting.listed.filter(
        (path) => path === linkedFolder,
      ),
    },
    {
      besideTheMarker: [
        'a-folder-of-the-project',
        'wiki.update-run.json.takeover-left',
      ],
      linkedFolder: ['left', 'notes.txt'],
      listedBelowTheLink: [],
    },
  )
})

// Value: protects=the files behind an entry at the claim folder's path that the look without following calls a directory although it leads elsewhere (on Windows a junction whose target is a volume); fails_when=the sweep lists whatever that look calls a directory and judges the files of the folder behind it as claims: a file without content and a record of a gone process are unlinked there (row 227); why_new=Cycle 0046 row 227: the claim folder is listed only as its parent's own entry; seam=a file system whose lstat calls a link a directory
test('an entry at the claim folder’s path that the look calls a directory although it leads elsewhere is not listed by the sweep: the file without content and the record of a gone process behind it stay', async (context) => {
  // Arrange: as in the test of a link at the claim folder's path, on a file system whose look is wrong about the link.
  const directory = await storageDirectory(context)
  const linkedFolder = join(directory, 'a-folder-of-the-project')
  await mkdir(linkedFolder)
  await writeFile(join(linkedFolder, '.gitkeep'), '')
  const twoMinutesAgo = new Date(Date.now() - 2 * 60_000)
  await utimes(join(linkedFolder, '.gitkeep'), twoMinutesAgo, twoMinutesAgo)
  await writeFile(
    join(linkedFolder, 'record.json'),
    `{"pid":${ID_OF_NO_PROCESS},"hostname":"workstation"}`,
  )
  await symlink(
    linkedFolder,
    join(directory, 'wiki.update-run.json.takeover'),
    'junction',
  )
  const wrongLook = fileSystemWhoseLinksResistRemoval({
    lstatOfALink: 'a directory',
  })
  const look = await loadModule<typeof lookModule>(
    resolve(__dirname, '../utils/isFolderOfItsOwn.js'),
    { 'node:fs/promises': wrongLook.fileSystem },
  )
  const placedClaims = await loadModule<typeof placedClaimsModule>(
    resolve(__dirname, '../utils/listPlacedClaims.js'),
    { 'node:fs/promises': wrongLook.fileSystem, './isFolderOfItsOwn': look },
  )
  const { removeStaleStorageClaims: sweepWhereTheLookIsWrong } =
    await loadModule<typeof sweepModule>(
      resolve(__dirname, '../utils/removeStaleStorageClaims.js'),
      {
        'node:fs/promises': wrongLook.fileSystem,
        './listPlacedClaims': placedClaims,
        './isFolderOfItsOwn': look,
      },
    )

  // Act
  await sweepWhereTheLookIsWrong(join(directory, 'wiki.update-run.json'), {
    hostname: 'workstation',
  })

  // Assert
  assert.deepEqual(
    {
      linkedFolder: (await readdir(linkedFolder)).sort(),
      listedBelowTheLink: wrongLook.listed.filter((path) => path !== directory),
    },
    { linkedFolder: ['.gitkeep', 'record.json'], listedBelowTheLink: [] },
  )
})
