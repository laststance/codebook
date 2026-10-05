import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  readProcessStart,
  type ProcessStartReader,
} from '../utils/readProcessStart'
import { removeStaleStorageLock } from '../utils/removeStaleStorageLock'

/** Creates an empty storage directory that is removed with the test, and returns its canonical path. @example const directory = await storageDirectory(context) */
async function storageDirectory(context: TestContext): Promise<string> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-stale-lock-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

/** This window as both tests name it: a Linux process of the host "workstation" under the kernel boot "boot-1", in the pid namespace 4026531836, begun at clock tick 16362446. Its takeover claim records that start, so the start reader must answer it for this process. */
const THIS_WINDOW = {
  hostname: 'workstation',
  boot: { id: 'boot-1' },
  processStart: 'linux@4026531836:16362446',
}

/**
 * Reads process starts as Linux does, from stat files of the test's own: this process began at clock tick 16362446, and what `/proc/4242/stat` holds the test says at each read.
 * @param statOfProcess4242 - Gives the text of `/proc/4242/stat`; it runs at every read of that file.
 * @returns The reader to hand to the takeover. This process's own start is kept in a state of the test's own, not in the module's.
 * @example
 * const readStart = linuxStartReader(() => linuxStat(200))
 */
function linuxStartReader(statOfProcess4242: () => string): ProcessStartReader {
  const ownStart = {}
  return (pid, inputs) =>
    readProcessStart(pid, {
      ...inputs,
      platform: 'linux',
      readLink: () => 'pid:[4026531836]',
      ownStart,
      readFile: async (path) =>
        path === '/proc/4242/stat' ? statOfProcess4242() : linuxStat(16362446),
    })
}

/** The text of `/proc/4242/stat` for a process named "node" that began at the given clock tick. @example linuxStat(200) // => '4242 (node) S 1 4242 4242 0 -1 4194304 496 0 0 0 0 0 0 0 20 0 11 0 200 16637952 1813' */
function linuxStat(startTicks: number): string {
  return `4242 (node) S 1 4242 4242 0 -1 4194304 496 0 0 0 0 0 0 0 20 0 11 0 ${startTicks} 16637952 1813`
}

// Value: protects=the lock of a live window that got a recycled process id is never removed by a takeover that began before it; fails_when=the second look of the takeover judges the lock by the start it kept from the first look, which was the start of the process that had the id then, so the new window's lock is removed and two windows write (ER-12, decision D7); why_new=the two looks share a cache of starts since Cycle 0046; seam=the process probe and the file read of the start reader, at which the id changes hands
test('a lock that a new window with the same process id placed between the two looks of a takeover stays in place', async (context) => {
  // Arrange: the lock of a killed window, process 4242 begun at tick 100. At the first look another process has the id, begun at tick 200. Before the second look that process ends, a new editor window gets the id, begins at tick 300 and takes the lock.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  const lockOfTheNewWindow =
    '{"pid":4242,"hostname":"workstation","boot":{"id":"boot-1"},"processStart":"linux@4026531836:300"}'
  await writeFile(
    lockPath,
    '{"pid":4242,"hostname":"workstation","boot":{"id":"boot-1"},"processStart":"linux@4026531836:100"}',
  )
  context.mock.method(process, 'kill', (): true => true)
  let reads = 0
  const readStart = linuxStartReader(() => {
    reads += 1
    if (reads > 1) return linuxStat(300)
    writeFileSync(lockPath, lockOfTheNewWindow)
    return linuxStat(200)
  })
  // Act
  const didHoldTheClaim = await removeStaleStorageLock(
    lockPath,
    THIS_WINDOW,
    readStart,
  )
  const lockAfterTheTakeover = await readFile(lockPath, 'utf8').catch(
    () => 'no lock file',
  )
  // Assert
  assert.equal(didHoldTheClaim, true)
  assert.equal(lockAfterTheTakeover, lockOfTheNewWindow)
  assert.equal(reads, 2)
  assert.deepEqual(await readdir(directory), ['writer.lock'])
})

// Value: protects=the takeover itself with a start reader: a stale lock whose process id another process keeps is removed after both looks; fails_when=the second look trusts nothing and never calls the lock stale, so a lock with a recycled id is never taken over; why_new=the takeover takes a start reader since Cycle 0046 (ER-2); seam=the process probe and the file read of the start reader
test('a stale lock whose process id another process keeps through both looks of a takeover is removed', async (context) => {
  // Arrange: the lock of a killed window, process 4242 begun at tick 100; another process has the id, begun at tick 200, and keeps it.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  await writeFile(
    lockPath,
    '{"pid":4242,"hostname":"workstation","boot":{"id":"boot-1"},"processStart":"linux@4026531836:100"}',
  )
  context.mock.method(process, 'kill', (): true => true)
  const readStart = linuxStartReader(() => linuxStat(200))
  // Act
  const didHoldTheClaim = await removeStaleStorageLock(
    lockPath,
    THIS_WINDOW,
    readStart,
  )
  // Assert
  assert.equal(didHoldTheClaim, true)
  assert.deepEqual(await readdir(directory), [])
})

// Value: protects=the takeover of a storage lock a killed window left before its WSL distribution alone was restarted, and the lock of a live window whose record names the namespace number the distribution had; fails_when=a lock of another pid namespace under the same kernel boot is never judged (it refuses every write until it is removed by hand), or its start is compared with the namespace, so a live window's lock is removed and two windows write; why_new=row 65 named the pid namespace in the form; seam=the process probe and the file read of the start reader
test('a lock recorded in another pid namespace of this kernel boot is removed when the process with its id began at another tick, and stays when it began at the same tick', async (context) => {
  // Arrange: two storages with the lock of process 4242, recorded at clock tick 100 in the pid namespace 4026532214. This window reads starts in the namespace 4026531836. A process has the id 4242: in the first storage's case one begun at tick 200, in the second's the owner itself, begun at tick 100.
  const afterTheIdWasReused = await storageDirectory(context),
    whileTheOwnerRuns = await storageDirectory(context)
  const lock =
    '{"pid":4242,"hostname":"workstation","boot":{"id":"boot-1"},"processStart":"linux@4026532214:100"}'
  await writeFile(join(afterTheIdWasReused, 'writer.lock'), lock)
  await writeFile(join(whileTheOwnerRuns, 'writer.lock'), lock)
  context.mock.method(process, 'kill', (): true => true)
  // Act
  await removeStaleStorageLock(
    join(afterTheIdWasReused, 'writer.lock'),
    THIS_WINDOW,
    linuxStartReader(() => linuxStat(200)),
  )
  await removeStaleStorageLock(
    join(whileTheOwnerRuns, 'writer.lock'),
    THIS_WINDOW,
    linuxStartReader(() => linuxStat(100)),
  )
  // Assert
  assert.deepEqual(await readdir(afterTheIdWasReused), [])
  assert.deepEqual(await readdir(whileTheOwnerRuns), ['writer.lock'])
  assert.equal(
    await readFile(join(whileTheOwnerRuns, 'writer.lock'), 'utf8'),
    lock,
  )
})
