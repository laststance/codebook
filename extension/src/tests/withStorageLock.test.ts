import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { withStorageLock } from '../utils/withStorageLock'

/** Creates an empty storage directory that is removed with the test. @example const directory = await storageDirectory(context) */
async function storageDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-storage-lock-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

/**
 * Answers the liveness probe (`process.kill(pid, 0)`) for editor processes that never ran: the listed ids have exited, every other id is running.
 * @param exitedProcessIds - The process ids of editors that were killed.
 * @param onProbeOfExited - Runs at each probe of an exited id, which is after the lock file was read and before it is judged: the moment at which a second window can act unseen.
 * @example answerProcessProbes(context, [4242])
 */
function answerProcessProbes(
  context: TestContext,
  exitedProcessIds: number[],
  onProbeOfExited: () => void = () => {},
): void {
  context.mock.method(process, 'kill', (pid: number): true => {
    if (!exitedProcessIds.includes(pid)) return true
    onProbeOfExited()
    throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
  })
}

/** Runs one write under the storage lock and says how it ended, in words a test can compare. @example await writeUnderLock(directory, async () => {}) // => 'written' */
function writeUnderLock(
  directory: string,
  write: () => Promise<void>,
): Promise<string> {
  return withStorageLock(directory, write).then(
    () => 'written',
    (error: unknown) => String(error),
  )
}

// Value: protects=two windows that meet one stale storage lock never both hold it; fails_when=the takeover removes whatever is at the lock path after judging an earlier file, so the fresh lock of a second window is removed and both write (Cycle 0044 review C-H1, order B.read < A.unlink < A.open < B.unlink); why_new=the takeover tests had one contender; seam=the process probe, at which the second window completes its takeover
test('a stale storage lock that a second window takes over while this window is judging it stays the second window’s, and this window’s write is refused', async (context) => {
  // Arrange: the lock of exited process 4242; while this window probes that process, the window of running process 4343 takes the lock over.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  await writeFile(lockPath, JSON.stringify({ pid: 4242, hostname: hostname() }))
  let hasSecondWindowTakenOver = false
  answerProcessProbes(context, [4242], () => {
    if (hasSecondWindowTakenOver) return
    hasSecondWindowTakenOver = true
    writeFileSync(lockPath, JSON.stringify({ pid: 4343, hostname: hostname() }))
  })
  let writes = 0
  // Act
  const outcome = await writeUnderLock(directory, async () => {
    writes += 1
  })
  // Assert
  assert.equal(
    outcome,
    'Error: Learning storage is locked by another writer or an interrupted session. No data changed; retry after resolving the lock.',
  )
  assert.equal(writes, 0)
  assert.deepEqual(JSON.parse(await readFile(lockPath, 'utf8')), {
    pid: 4343,
    hostname: hostname(),
  })
  assert.deepEqual(await readdir(directory), ['writer.lock'])
})

// Value: protects=a storage lock written on another machine is never taken over; fails_when=the takeover judges a lock by its process id alone, so a writer on another machine that shares the storage loses its lock to this window and both write; why_new=every other takeover test writes its lock with this machine’s host name or with none; seam=none
test('a storage lock that names another machine stays in place although no process of its id runs here, and this window’s write is refused', async (context) => {
  // Arrange: the lock of process 4242 on another machine; no process 4242 runs on this one.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  await writeFile(lockPath, '{"pid":4242,"hostname":"another-machine"}')
  answerProcessProbes(context, [4242])
  let writes = 0
  // Act
  const outcome = await writeUnderLock(directory, async () => {
    writes += 1
  })
  // Assert
  assert.equal(
    outcome,
    'Error: Learning storage is locked by another writer or an interrupted session. No data changed; retry after resolving the lock.',
  )
  assert.equal(writes, 0)
  assert.equal(
    await readFile(lockPath, 'utf8'),
    '{"pid":4242,"hostname":"another-machine"}',
  )
  assert.deepEqual(await readdir(directory), ['writer.lock'])
})

// Value: protects=the release never removes a lock that another window holds; fails_when=the release unlinks whatever is at the lock path, so a window whose lock replaced this one loses it and a third writer gets in (Cycle 0044 review C-H1, the release); why_new=the release tests removed the lock file or put a directory in its place; seam=the held write, during which the lock file comes to name another writer
test('releasing the storage lock leaves a lock that names another window by then in place', async (context) => {
  // Arrange
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  // Act: while this window writes, the lock file comes to name a window of another machine.
  const outcome = await writeUnderLock(directory, () =>
    writeFile(lockPath, '{"pid":4343,"hostname":"another-machine"}'),
  )
  const lockAfterRelease = await readFile(lockPath, 'utf8').catch(
    () => 'no lock file',
  )
  // Assert
  assert.equal(outcome, 'written')
  assert.equal(lockAfterRelease, '{"pid":4343,"hostname":"another-machine"}')
})

// Value: protects=only one window at a time takes a stale storage lock over; fails_when=a window removes the stale lock although another running window holds the takeover claim (Cycle 0044 review C-H1); why_new=the claim is new; seam=the process probe
test('while another running window is taking a stale storage lock over, this window leaves the lock and that window’s claim in place and its write is refused', async (context) => {
  // Arrange: the lock of exited process 4242 and the takeover claim of running process 4343.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock'),
    claimDirectory = join(directory, 'writer.lock.takeover')
  await writeFile(lockPath, JSON.stringify({ pid: 4242, hostname: hostname() }))
  await mkdir(claimDirectory)
  await writeFile(
    join(claimDirectory, 'claim-of-4343'),
    JSON.stringify({ pid: 4343, hostname: hostname() }),
  )
  answerProcessProbes(context, [4242])
  let writes = 0
  // Act
  const outcome = await writeUnderLock(directory, async () => {
    writes += 1
  })
  // Assert
  assert.equal(
    outcome,
    'Error: Learning storage is locked by another writer or an interrupted session. No data changed; retry after resolving the lock.',
  )
  assert.equal(writes, 0)
  assert.deepEqual(JSON.parse(await readFile(lockPath, 'utf8')), {
    pid: 4242,
    hostname: hostname(),
  })
  assert.deepEqual((await readdir(directory)).sort(), [
    'writer.lock',
    'writer.lock.takeover',
  ])
  assert.deepEqual(await readdir(claimDirectory), ['claim-of-4343'])
})

// Value: protects=a window that was killed in the middle of a takeover does not bring back a stale lock that refuses every write until it is removed by hand (0038-F13); fails_when=the claim such a window left is treated like a running window's claim; why_new=the claim is new (Cycle 0044 review C-H1); seam=the process probe
test('a takeover claim left by a window that was killed in the middle of a takeover does not keep a stale storage lock in place', async (context) => {
  // Arrange: the lock of exited process 4242 and the takeover claim of exited process 4243.
  const directory = await storageDirectory(context)
  const claimDirectory = join(directory, 'writer.lock.takeover')
  await writeFile(
    join(directory, 'writer.lock'),
    JSON.stringify({ pid: 4242, hostname: hostname() }),
  )
  await mkdir(claimDirectory)
  await writeFile(
    join(claimDirectory, 'claim-of-4243'),
    JSON.stringify({ pid: 4243, hostname: hostname() }),
  )
  answerProcessProbes(context, [4242, 4243])
  let writes = 0
  // Act
  const outcome = await writeUnderLock(directory, async () => {
    writes += 1
  })
  // Assert
  assert.equal(outcome, 'written')
  assert.equal(writes, 1)
  assert.deepEqual(await readdir(directory), [])
})
