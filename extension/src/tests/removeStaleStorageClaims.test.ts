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
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  readProcessStart,
  type ProcessStartReader,
} from '../utils/readProcessStart'
import { removeStaleStorageClaims } from '../utils/removeStaleStorageClaims'

import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'

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
