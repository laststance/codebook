import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
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
import { removeStaleStorageClaims } from '../utils/removeStaleStorageClaims'

/** Creates an empty storage directory that is removed with the test, and returns its canonical path. @example const directory = await storageDirectory(context) */
async function storageDirectory(context: TestContext): Promise<string> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-stale-claims-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

/**
 * Reads process starts as Linux does, from a `/proc/4242/stat` of the test's own: process 4242 is named "node" and began at clock tick 200.
 * @param onRead - Runs at every read of the file, so a test can count the reads.
 * @returns The reader to hand to the sweep.
 * @example
 * const readStart = startReaderOfProcess4242(() => { reads += 1 })
 */
function startReaderOfProcess4242(onRead: () => void): ProcessStartReader {
  return (pid, inputs) =>
    readProcessStart(pid, {
      ...inputs,
      platform: 'linux',
      readFile: async () => {
        onRead()
        return '4242 (node) S 1 4242 4242 0 -1 4194304 496 0 0 0 0 0 0 0 20 0 11 0 200 16637952 1813'
      },
    })
}

// Value: protects=a sweep over what one running window has beside the lock costs one read of its start (one spawned ps or PowerShell on macOS and Windows), not one per leftover; fails_when=the sweep reads the start again for every claim and prepared file (ER-12, decision D7); why_new=the leftovers carry their owner's start since Cycle 0046; seam=the process probe and the file read of the start reader, which counts
test('a placed claim, a prepared claim and a prepared lock of one running window are judged with one read of its start, and all stay', async (context) => {
  // Arrange: running process 4242, begun at clock tick 200, holds the takeover claim and is preparing a second claim and a lock.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  const ofTheRunningWindow =
    '{"pid":4242,"hostname":"workstation","processStart":"linux:200"}'
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
    { hostname: 'workstation' },
    startReaderOfProcess4242(() => {
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
  // Arrange: a window with process id 4242 began at clock tick 100 and was killed while it prepared a lock; the window that has the id now began at tick 200 and is preparing one.
  const directory = await storageDirectory(context)
  await writeFile(
    join(directory, 'writer.lock.pending-a-of-running-window'),
    '{"pid":4242,"hostname":"workstation","processStart":"linux:200"}',
  )
  await writeFile(
    join(directory, 'writer.lock.pending-b-of-killed-window'),
    '{"pid":4242,"hostname":"workstation","processStart":"linux:100"}',
  )
  context.mock.method(process, 'kill', (): true => true)
  // Act
  await removeStaleStorageClaims(
    join(directory, 'writer.lock'),
    { hostname: 'workstation' },
    startReaderOfProcess4242(() => {}),
  )
  // Assert: in whichever order the directory listed the two, each was judged by its own start.
  assert.deepEqual(await readdir(directory), [
    'writer.lock.pending-a-of-running-window',
  ])
})
