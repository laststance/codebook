import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import fsPromises, {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import os, { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { before, test, type TestContext } from 'node:test'

import { WIKI_METADATA_FILE_LIMIT_BYTES } from '../constants'
import { currentStorageOwner } from '../utils/currentStorageOwner'
import type * as placementModule from '../utils/placeStorageLock'
import {
  readRecordedOwner,
  type StorageOwnerIdentity,
} from '../utils/readRecordedOwner'
import type * as catalogModule from '../utils/refreshCursorMcpCatalog'
import type * as lockModule from '../utils/withStorageLock'
import { withStorageLock } from '../utils/withStorageLock'

import { answerKernelBootId } from './utils/answerKernelBootId'
import { idleChild } from './utils/idleChild'
import {
  ANOTHER_ID_OF_NO_PROCESS,
  ID_OF_NO_PROCESS,
} from './utils/idOfNoProcess'
import { loadModule } from './utils/loadModule'
import { realProcessStart } from './utils/realProcessStart'
import { startOfKilledWindow } from './utils/startOfKilledWindow'

// Every write of these tests names this process's own start, which the product reads once, keeps, and keeps as failed for a minute; on Windows that read is a PowerShell that starts cold. It is made here first, with the tests' own bound, and names its query when it fails.
before(async () => {
  await realProcessStart(process.pid)
})

/** Creates an empty storage directory that is removed with the test, and returns its canonical path, which is the one the lock file is named by. @example const directory = await storageDirectory(context) */
async function storageDirectory(context: TestContext): Promise<string> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-storage-lock-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

/** Makes a file or folder look as if it was last changed that long ago, as one is that a killed window left behind. @example await leaveUntouchedFor(lockPath, 60_000) */
async function leaveUntouchedFor(path: string, ageMs: number): Promise<void> {
  const lastChanged = new Date(Date.now() - ageMs)
  await utimes(path, lastChanged, lastChanged)
}

/**
 * Answers the liveness probe (`process.kill(pid, 0)`) for editor processes that never ran: the listed ids have exited, every other id is running.
 * @param exitedProcessIds - The process ids of editors that were killed: {@link ID_OF_NO_PROCESS} and {@link ANOTHER_ID_OF_NO_PROCESS}, which this test process cannot have. A fixed small id can be this process's own (in a pid namespace, on a busy runner), and a lock of "an exited process" with this window's own id is judged as this window's.
 * @param onProbeOfExited - Runs at each probe of an exited id, which is after the lock file was read and before it is judged: the moment at which a second window can act unseen.
 * @example answerProcessProbes(context, [ID_OF_NO_PROCESS])
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

/** Runs one write under the storage lock and says how it ended, in words a test can compare; `identity` is the machine and boot of the window that writes, this process's own when left out. @example await writeUnderLock(directory, async () => {}) // => 'written' */
function writeUnderLock(
  directory: string,
  write: () => Promise<void>,
  identity?: StorageOwnerIdentity,
): Promise<string> {
  return withStorageLock(directory, write, identity).then(
    () => 'written',
    (error: unknown) => String(error),
  )
}

// Value: protects=two windows that meet one stale storage lock never both hold it; fails_when=the takeover removes whatever is at the lock path after judging an earlier file, so the fresh lock of a second window is removed and both write (Cycle 0044 review C-H1, order B.read < A.unlink < A.open < B.unlink); why_new=the takeover tests had one contender; seam=the process probe, at which the second window completes its takeover
test('a stale storage lock that a second window takes over while this window is judging it stays the second window’s, and this window’s write is refused', async (context) => {
  // Arrange: the lock of exited process 4194305; while this window probes that process, the window of running process 4343 takes the lock over.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  await writeFile(
    lockPath,
    JSON.stringify({ pid: 4194305, hostname: hostname() }),
  )
  let hasSecondWindowTakenOver = false
  answerProcessProbes(context, [ID_OF_NO_PROCESS], () => {
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
    `Error: Learning storage is locked by another writer or an interrupted session (lock file: ${lockPath}). No data changed; retry after resolving the lock.`,
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
  // Arrange: the lock of process 4194305 on another machine; no process 4194305 runs on this one.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  await writeFile(lockPath, '{"pid":4194305,"hostname":"another-machine"}')
  answerProcessProbes(context, [ID_OF_NO_PROCESS])
  let writes = 0
  // Act
  const outcome = await writeUnderLock(directory, async () => {
    writes += 1
  })
  // Assert
  assert.equal(
    outcome,
    `Error: Learning storage is locked by another writer or an interrupted session (lock file: ${lockPath}). No data changed; retry after resolving the lock.`,
  )
  assert.equal(writes, 0)
  assert.equal(
    await readFile(lockPath, 'utf8'),
    '{"pid":4194305,"hostname":"another-machine"}',
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
  // Arrange: the lock of exited process 4194305 and the takeover claim of running process 4343.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock'),
    claimDirectory = join(directory, 'writer.lock.takeover')
  await writeFile(
    lockPath,
    JSON.stringify({ pid: 4194305, hostname: hostname() }),
  )
  await mkdir(claimDirectory)
  await writeFile(
    join(claimDirectory, 'claim-of-4343'),
    JSON.stringify({ pid: 4343, hostname: hostname() }),
  )
  answerProcessProbes(context, [ID_OF_NO_PROCESS])
  let writes = 0
  // Act
  const outcome = await writeUnderLock(directory, async () => {
    writes += 1
  })
  // Assert
  assert.equal(
    outcome,
    `Error: Learning storage is locked by another writer or an interrupted session (lock file: ${lockPath}). No data changed; retry after resolving the lock.`,
  )
  assert.equal(writes, 0)
  assert.deepEqual(JSON.parse(await readFile(lockPath, 'utf8')), {
    pid: 4194305,
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
  // Arrange: the lock of exited process 4194305 and the takeover claim of exited process 4194307.
  const directory = await storageDirectory(context)
  const claimDirectory = join(directory, 'writer.lock.takeover')
  await writeFile(
    join(directory, 'writer.lock'),
    JSON.stringify({ pid: 4194305, hostname: hostname() }),
  )
  await mkdir(claimDirectory)
  await writeFile(
    join(claimDirectory, 'claim-of-4194307'),
    JSON.stringify({ pid: 4194307, hostname: hostname() }),
  )
  answerProcessProbes(context, [ID_OF_NO_PROCESS, ANOTHER_ID_OF_NO_PROCESS])
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

// Value: protects=a lock a writer left when the machine restarted is taken over although another process got its id, also the new extension host itself; fails_when=the lock is judged by its process id alone, so every later write is refused until the file is removed by hand (Cycle 0044 row RT-11); why_new=every takeover test used a process id that no longer exists; seam=the injected boot identity and the process probe
test('a lock left before the last restart is taken over although its process id is in use again', async (context) => {
  // Arrange: the lock of process 4242, written under the boot before the restart; a process with id 4242 runs again.
  const directory = await storageDirectory(context)
  await writeFile(
    join(directory, 'writer.lock'),
    '{"pid":4242,"hostname":"workstation","boot":{"id":"boot-before-the-restart"}}',
  )
  answerProcessProbes(context, [])
  let writes = 0
  // Act
  const outcome = await writeUnderLock(
    directory,
    async () => {
      writes += 1
    },
    { hostname: 'workstation', boot: { id: 'boot-after-the-restart' } },
  )
  // Assert
  assert.equal(outcome, 'written')
  assert.equal(writes, 1)
  assert.deepEqual(await readdir(directory), [])
})

// Value: protects=a boot time that two clocks moved by seconds never makes a running writer's lock stale; fails_when=any difference between the recorded and the current boot time counts as a restart, so a clock correction lets a second window write beside the first (engineering review ER-20); why_new=the boot identity is new; seam=the injected boot identity and the process probe
test('a lock whose boot time differs by less than the tolerance is not stale', async (context) => {
  // Arrange: the lock of running process 4242, whose recorded boot time is 59 s before the one this window computes.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  await writeFile(
    lockPath,
    '{"pid":4242,"hostname":"workstation","boot":{"startedAtMs":1790000000000}}',
  )
  answerProcessProbes(context, [])
  let writes = 0
  // Act
  const outcome = await writeUnderLock(
    directory,
    async () => {
      writes += 1
    },
    { hostname: 'workstation', boot: { startedAtMs: 1_790_000_059_000 } },
  )
  // Assert
  assert.equal(
    outcome,
    `Error: Learning storage is locked by another writer or an interrupted session (lock file: ${lockPath}). No data changed; retry after resolving the lock.`,
  )
  assert.equal(writes, 0)
  assert.equal(
    await readFile(lockPath, 'utf8'),
    '{"pid":4242,"hostname":"workstation","boot":{"startedAtMs":1790000000000}}',
  )
})

// Value: protects=two running windows of one machine without a kernel boot id never take each other's locks after the clock was corrected; fails_when=a window judges by the boot time it computed at its first write, so a lock placed after a correction of more than the tolerance looks like one of an earlier boot and is taken from its running writer; why_new=the boot identity is new (engineering review ER-20); seam=the kernel boot id file, the clock, the uptime and the process probe
test('a clock corrected since this window first wrote does not make a running window’s lock one of an earlier boot', async (context) => {
  // Arrange: no kernel boot id; the machine has been up for 600 s. This window writes once, then the clock is set back by 90 s, and running process 4242 takes the lock, recording the boot time the corrected clock gives.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  answerKernelBootId(context, undefined)
  answerProcessProbes(context, [])
  let clockMs = 1_790_000_600_000
  context.mock.method(Date, 'now', () => clockMs)
  context.mock.method(os, 'uptime', () => 600)
  const firstWrite = await writeUnderLock(directory, async () => {})
  clockMs -= 90_000
  await writeFile(
    lockPath,
    `{"pid":4242,"hostname":${JSON.stringify(hostname())},"boot":{"startedAtMs":1789999910000}}`,
  )
  let writes = 0
  // Act
  const outcome = await writeUnderLock(directory, async () => {
    writes += 1
  })
  // Assert
  assert.equal(firstWrite, 'written')
  assert.equal(
    outcome,
    `Error: Learning storage is locked by another writer or an interrupted session (lock file: ${lockPath}). No data changed; retry after resolving the lock.`,
  )
  assert.equal(writes, 0)
  assert.equal(
    await readFile(lockPath, 'utf8'),
    `{"pid":4242,"hostname":${JSON.stringify(hostname())},"boot":{"startedAtMs":1789999910000}}`,
  )
})

// Value: protects=on a system without a kernel boot id a lock from before the restart is still taken over; fails_when=boot times are never compared, so there a reused process id keeps the lock for good; why_new=the boot identity is new; seam=the injected boot identity and the process probe
test('a lock whose boot time lies before this boot by more than the tolerance is taken over although its process id is in use again', async (context) => {
  // Arrange: the lock of process 4242, whose recorded boot time is 61 s before the one this window computes; a process with id 4242 runs.
  const directory = await storageDirectory(context)
  await writeFile(
    join(directory, 'writer.lock'),
    '{"pid":4242,"hostname":"workstation","boot":{"startedAtMs":1790000000000}}',
  )
  answerProcessProbes(context, [])
  let writes = 0
  // Act
  const outcome = await writeUnderLock(
    directory,
    async () => {
      writes += 1
    },
    { hostname: 'workstation', boot: { startedAtMs: 1_790_000_061_000 } },
  )
  // Assert
  assert.equal(outcome, 'written')
  assert.equal(writes, 1)
  assert.deepEqual(await readdir(directory), [])
})

// Value: protects=a lock file a killed writer created and never wrote does not refuse every later write; fails_when=a lock without a readable owner is never stale (Cycle 0044 row RT-11); why_new=no test arranged an empty lock; seam=the lock file's modification time
test('an empty lock file left by a killed writer is taken over', async (context) => {
  // Arrange: a lock file of zero bytes that nothing has touched for a minute.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  await writeFile(lockPath, '')
  await leaveUntouchedFor(lockPath, 60_000)
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

// Value: protects=a lock file that a writer of an earlier build created an instant ago and is about to write is never taken from it; fails_when=every empty lock counts as abandoned, whatever its age; why_new=the takeover of an empty lock is new; seam=none
test('an empty lock file created a moment ago stays in place, and this window’s write is refused', async (context) => {
  // Arrange: a lock file of zero bytes created just now.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  await writeFile(lockPath, '')
  let writes = 0
  // Act
  const outcome = await writeUnderLock(directory, async () => {
    writes += 1
  })
  // Assert
  assert.equal(
    outcome,
    `Error: Learning storage is locked by another writer or an interrupted session (lock file: ${lockPath}). No data changed; retry after resolving the lock.`,
  )
  assert.equal(writes, 0)
  assert.equal(await readFile(lockPath, 'utf8'), '')
  assert.deepEqual(await readdir(directory), ['writer.lock'])
})

// Value: protects=a learner or an agent who is refused by a storage lock learns which file holds it, and a caller that waits for another window still recognises the refusal; fails_when=the sentence names no file (Cycle 0044 row RT-11) or the refusal loses its EEXIST cause, which the Cursor catalog retry reads; why_new=the sentence named no file; seam=the process probe
test('the refusal of a locked storage names the lock file', async (context) => {
  // Arrange: the lock of running process 4242 of this machine.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  await writeFile(lockPath, JSON.stringify({ pid: 4242, hostname: hostname() }))
  answerProcessProbes(context, [])
  // Act
  const refusal: unknown = await withStorageLock(
    directory,
    async () => {},
  ).catch((error: unknown) => error)
  // Assert
  assert.ok(refusal instanceof Error)
  assert.equal(
    refusal.message,
    `Learning storage is locked by another writer or an interrupted session (lock file: ${lockPath}). No data changed; retry after resolving the lock.`,
  )
  assert.ok(refusal.cause instanceof Error && 'code' in refusal.cause)
  assert.equal(refusal.cause.code, 'EEXIST')
})

// Value: protects=a storage lock never exists without its owner, so a writer killed at any moment leaves a lock that can be judged; fails_when=the lock file is created first and written afterwards (Cycle 0044 row RT-11), or its record lacks the machine or the boot; why_new=the lock was created empty; seam=the hard link that gives the prepared file the lock's name
test('a storage lock is placed with its owner already written, naming the process, the machine and the boot of its writer', async (context) => {
  // Arrange: every placement of a lock is observed at the moment the prepared file gets the lock's name.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  const linkBefore = fsPromises.link
  const placements: { prepared: string; wasLockPresent: boolean }[] = []
  context.mock.method(
    fsPromises,
    'link',
    async (...input: Parameters<typeof linkBefore>) => {
      placements.push({
        prepared: readFileSync(input[0], 'utf8'),
        wasLockPresent: existsSync(lockPath),
      })
      return linkBefore(...input)
    },
  )
  let lockDuringWrite = ''
  // Act
  const outcome = await writeUnderLock(
    directory,
    async () => {
      lockDuringWrite = await readFile(lockPath, 'utf8')
    },
    { hostname: 'workstation', machineId: 'machine-a', boot: { id: 'boot-1' } },
  )
  // Assert
  assert.equal(outcome, 'written')
  assert.deepEqual(placements, [
    {
      prepared: `{"pid":${process.pid},"hostname":"workstation","machineId":"machine-a","boot":{"id":"boot-1"}}`,
      wasLockPresent: false,
    },
  ])
  assert.equal(
    lockDuringWrite,
    `{"pid":${process.pid},"hostname":"workstation","machineId":"machine-a","boot":{"id":"boot-1"}}`,
  )
  assert.deepEqual(await readdir(directory), [])
})

// Value: protects=learning storage on a file system without hard links can still be written; fails_when=a refused hard link fails every write instead of creating the lock in place; why_new=the lock is placed with a hard link since Cycle 0045; seam=the hard link, which the file system refuses
test('storage on a file system that refuses hard links still takes its lock, writes and releases it', async (context) => {
  // Arrange
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  context.mock.method(fsPromises, 'link', async () => {
    throw Object.assign(new Error('EPERM: operation not permitted, link'), {
      code: 'EPERM',
    })
  })
  let lockDuringWrite = ''
  // Act
  const outcome = await writeUnderLock(
    directory,
    async () => {
      lockDuringWrite = await readFile(lockPath, 'utf8')
    },
    { hostname: 'workstation', boot: { id: 'boot-1' } },
  )
  // Assert
  assert.equal(outcome, 'written')
  assert.equal(
    lockDuringWrite,
    `{"pid":${process.pid},"hostname":"workstation","boot":{"id":"boot-1"}}`,
  )
  assert.deepEqual(await readdir(directory), [])
})

// Value: protects=a lock a killed editor left is taken over although the machine's host name changed since, as it does on macOS with the network; fails_when=the machine is identified by its host name alone (Cycle 0044 row AD-6); why_new=every takeover test wrote its lock with the current host name; seam=the injected machine identity and the process probe
test('a lock written under another host name by the same machine is taken over when its process is gone', async (context) => {
  // Arrange: the lock of exited process 4194305, written by this machine while it had another host name.
  const directory = await storageDirectory(context)
  await writeFile(
    join(directory, 'writer.lock'),
    '{"pid":4194305,"hostname":"laptop.home-network","machineId":"machine-a","boot":{"id":"boot-1"}}',
  )
  answerProcessProbes(context, [ID_OF_NO_PROCESS])
  let writes = 0
  // Act
  const outcome = await writeUnderLock(
    directory,
    async () => {
      writes += 1
    },
    {
      hostname: 'laptop.office-network',
      machineId: 'machine-a',
      boot: { id: 'boot-1' },
    },
  )
  // Assert
  assert.equal(outcome, 'written')
  assert.equal(writes, 1)
  assert.deepEqual(await readdir(directory), [])
})

// Value: protects=two machines that share storage and happen to have one host name never take each other's lock; fails_when=an equal host name counts as the same machine although the machine ids differ; why_new=the machine id is new; seam=the injected machine identity and the process probe
test('a lock of another machine that has the same host name stays in place, and this window’s write is refused', async (context) => {
  // Arrange: the lock of process 4194305 on another machine named like this one; no process 4194305 runs here, and the boots differ.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  await writeFile(
    lockPath,
    '{"pid":4194305,"hostname":"workstation","machineId":"machine-b","boot":{"id":"boot-of-machine-b"}}',
  )
  answerProcessProbes(context, [ID_OF_NO_PROCESS])
  let writes = 0
  // Act
  const outcome = await writeUnderLock(
    directory,
    async () => {
      writes += 1
    },
    {
      hostname: 'workstation',
      machineId: 'machine-a',
      boot: { id: 'boot-of-machine-a' },
    },
  )
  // Assert
  assert.equal(
    outcome,
    `Error: Learning storage is locked by another writer or an interrupted session (lock file: ${lockPath}). No data changed; retry after resolving the lock.`,
  )
  assert.equal(writes, 0)
  assert.equal(
    await readFile(lockPath, 'utf8'),
    '{"pid":4194305,"hostname":"workstation","machineId":"machine-b","boot":{"id":"boot-of-machine-b"}}',
  )
})

// Value: protects=the release never removes the lock a window of an earlier build has just created and not yet written; fails_when=the release unlinks whatever it cannot read at the lock path (Cycle 0044 row AD-6), so that window's lock is gone and a third writer gets in; why_new=the release tests put a readable lock or a directory in the lock's place; seam=the held write, during which the lock file is replaced by an empty one
test("releasing leaves another window's lock whose owner is not written yet", async (context) => {
  // Arrange
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  // Act: while this window writes, its lock is replaced by a lock another window has created and not yet written.
  const outcome = await writeUnderLock(directory, async () => {
    await rm(lockPath)
    await writeFile(lockPath, '')
  })
  const lockAfterRelease = await readFile(lockPath, 'utf8').catch(
    () => 'no lock file',
  )
  // Assert
  assert.equal(outcome, 'written')
  assert.equal(lockAfterRelease, '')
})

// Value: protects=the folder a window prepared for its takeover claim and never renamed, because it was killed, does not stay in the storage for good; fails_when=only claims inside the claim directory are swept (Cycle 0044 row AD-6); why_new=the takeover tests arranged placed claims only; seam=the process probe
test('a prepared takeover claim left by a killed window is removed by the next takeover', async (context) => {
  // Arrange: the lock of exited process 4194305, and the claim exited process 4194307 prepared beside it and never placed.
  const directory = await storageDirectory(context)
  const preparedClaim = join(directory, 'writer.lock.takeover-claim-of-4194307')
  await writeFile(
    join(directory, 'writer.lock'),
    JSON.stringify({ pid: 4194305, hostname: hostname() }),
  )
  await mkdir(preparedClaim)
  await writeFile(
    join(preparedClaim, 'claim-of-4194307'),
    JSON.stringify({ pid: 4194307, hostname: hostname() }),
  )
  answerProcessProbes(context, [ID_OF_NO_PROCESS, ANOTHER_ID_OF_NO_PROCESS])
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

// Value: protects=the empty folder of a window that was killed between creating its claim folder and writing its owner is removed too; fails_when=a prepared claim without an owner file is never swept (Cycle 0044 row RF-1); why_new=nothing removed a prepared claim; seam=the folder's modification time and the process probe
test('a claim a killed window prepared but never placed is removed by the next takeover', async (context) => {
  // Arrange: the lock of exited process 4194305, and an empty prepared claim folder that nothing has touched for a minute.
  const directory = await storageDirectory(context)
  const preparedClaim = join(directory, 'writer.lock.takeover-never-written')
  await writeFile(
    join(directory, 'writer.lock'),
    JSON.stringify({ pid: 4194305, hostname: hostname() }),
  )
  await mkdir(preparedClaim)
  await leaveUntouchedFor(preparedClaim, 60_000)
  answerProcessProbes(context, [ID_OF_NO_PROCESS])
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

// Value: protects=the sweep of prepared claims never removes the folder a running window is filling right now; fails_when=every prepared claim without an owner file is removed, whatever its age or its owner; why_new=the sweep is new; seam=the process probe
test('the prepared takeover claims of windows that are still running stay in place while this window takes a stale lock over', async (context) => {
  // Arrange: the lock of exited process 4194305, a claim folder created just now, and the prepared claim of running process 4343.
  const directory = await storageDirectory(context)
  const claimOfRunningWindow = join(
    directory,
    'writer.lock.takeover-claim-of-4343',
  )
  await writeFile(
    join(directory, 'writer.lock'),
    JSON.stringify({ pid: 4194305, hostname: hostname() }),
  )
  await mkdir(join(directory, 'writer.lock.takeover-created-just-now'))
  await mkdir(claimOfRunningWindow)
  await writeFile(
    join(claimOfRunningWindow, 'claim-of-4343'),
    JSON.stringify({ pid: 4343, hostname: hostname() }),
  )
  answerProcessProbes(context, [ID_OF_NO_PROCESS])
  // Act
  const outcome = await writeUnderLock(directory, async () => {})
  // Assert
  assert.equal(outcome, 'written')
  assert.deepEqual((await readdir(directory)).sort(), [
    'writer.lock.takeover-claim-of-4343',
    'writer.lock.takeover-created-just-now',
  ])
  assert.deepEqual(await readdir(claimOfRunningWindow), ['claim-of-4343'])
})

// Value: protects=the file a window wrote for its lock and never gave the lock's name, because it was killed, does not stay in the storage for good; fails_when=prepared lock files are never swept, or only when a stale lock happens to be taken over; why_new=the lock is prepared in a file of its own since Cycle 0045; seam=the process probe
test('a lock file a killed window prepared but never placed is removed by the next write, and one of a running window stays', async (context) => {
  // Arrange: no lock; the prepared lock of exited process 4194307 and the prepared lock of running process 4343.
  const directory = await storageDirectory(context)
  await writeFile(
    join(directory, 'writer.lock.pending-of-4194307'),
    JSON.stringify({ pid: 4194307, hostname: hostname() }),
  )
  await writeFile(
    join(directory, 'writer.lock.pending-of-4343'),
    JSON.stringify({ pid: 4343, hostname: hostname() }),
  )
  answerProcessProbes(context, [ANOTHER_ID_OF_NO_PROCESS])
  // Act
  const outcome = await writeUnderLock(directory, async () => {})
  // Assert
  assert.equal(outcome, 'written')
  assert.deepEqual(await readdir(directory), ['writer.lock.pending-of-4343'])
})

// Value: protects=the file the lock's own placement prepares stays one the sweep finds, when its window is killed before the link gives it the lock's name; fails_when=the placement names its prepared file differently from what the sweep looks for (the two spell the name each on their own), so every killed window leaves a file in the storage for good; why_new=Cycle 0046 /ship review T12: every sweep test wrote the prepared file by hand, so a drift of the writer's name survived them; seam=node:fs/promises link of a loaded placeStorageLock, at which its window is killed (the link never returns and nothing after it runs) and the process probe
test('the file a window’s real lock placement prepared is removed by the next write when that window was killed at its link', async (context) => {
  // Arrange: a window of exited process 4194305 prepares its lock with the real placement and is killed at the link.
  const directory = await storageDirectory(context)
  let reportKillAtTheLink!: () => void
  const killedAtTheLink = new Promise<void>((resolveKill) => {
    reportKillAtTheLink = resolveKill
  })
  const { placeStorageLock: placeLockOfTheKilledWindow } = await loadModule<
    typeof placementModule
  >(resolve(__dirname, '../utils/placeStorageLock.js'), {
    'node:fs/promises': {
      ...fsPromises,
      link: (): Promise<never> => {
        reportKillAtTheLink()
        return new Promise<never>(() => {})
      },
    },
  })
  void placeLockOfTheKilledWindow(join(directory, 'writer.lock'), {
    pid: ID_OF_NO_PROCESS,
    hostname: hostname(),
  })
  await killedAtTheLink
  const leftByTheKill = (await readdir(directory)).map((name) =>
    name.replace(/[0-9a-f-]{36}$/, '<uuid>'),
  )
  answerProcessProbes(context, [ID_OF_NO_PROCESS])

  // Act
  const outcome = await writeUnderLock(directory, async () => {})

  // Assert
  assert.deepEqual(
    { leftByTheKill, outcome, entriesAfterTheWrite: await readdir(directory) },
    {
      leftByTheKill: ['writer.lock.pending-<uuid>'],
      outcome: 'written',
      entriesAfterTheWrite: [],
    },
  )
})

// Value: protects=an ordinary write does not list the whole private storage directory (every study archive, sidecar and recording) for leftovers that exist only after a killed window (Cycle 0045 review PL-3); fails_when=every hold of the storage lock sweeps; why_new=no test counted the sweep's listings; seam=the directory listing of node:fs/promises
test('ten uncontended writes to the storage list the storage directory for leftovers at most once', async (context) => {
  // Arrange
  const directory = await storageDirectory(context)
  let listingsOfStorageDirectory = 0
  const readdirBefore = fsPromises.readdir
  context.mock.method(
    fsPromises,
    'readdir',
    (...input: Parameters<typeof readdirBefore>) => {
      if (input[0] === directory) listingsOfStorageDirectory += 1
      return readdirBefore(...input)
    },
  )
  // Act
  const outcomes: string[] = []
  for (let write = 0; write < 10; write += 1)
    outcomes.push(await writeUnderLock(directory, async () => {}))
  // Assert
  assert.deepEqual(outcomes, Array(10).fill('written'))
  assert.equal(listingsOfStorageDirectory, 1)
})

// Value: protects=the leftover of a killed window is still removed by a window that already swept once, when its write takes a stale lock over, and that write lists the private storage directory (every study archive, sidecar and recording) once, not twice; fails_when=the takeover's claim no longer sweeps, so a window that swept at its first hold never removes what a later kill left, or the holder sweeps again after the claim's sweep (Cycle 0045 review PL-3, Cycle 0046 row 104); why_new=the earlier test of this case stayed green without the condition it named; seam=the directory listing of node:fs/promises and the process probe
test('a write that takes a stale lock over after the first write of this window lists the storage directory for leftovers once, through its takeover claim, which removes the lock file a killed window prepared and never placed', async (context) => {
  // Arrange: one write has swept the storage already; then exited process 4194305 leaves its lock and exited process 4194307 its prepared lock.
  const directory = await storageDirectory(context)
  await writeUnderLock(directory, async () => {})
  await writeFile(
    join(directory, 'writer.lock'),
    JSON.stringify({ pid: 4194305, hostname: hostname() }),
  )
  await writeFile(
    join(directory, 'writer.lock.pending-of-4194307'),
    JSON.stringify({ pid: 4194307, hostname: hostname() }),
  )
  answerProcessProbes(context, [ID_OF_NO_PROCESS, ANOTHER_ID_OF_NO_PROCESS])
  let listingsOfStorageDirectory = 0
  const readdirBefore = fsPromises.readdir
  context.mock.method(
    fsPromises,
    'readdir',
    (...input: Parameters<typeof readdirBefore>) => {
      if (input[0] === directory) listingsOfStorageDirectory += 1
      return readdirBefore(...input)
    },
  )
  // Act
  const outcome = await writeUnderLock(directory, async () => {})
  // Assert
  assert.equal(outcome, 'written')
  assert.equal(listingsOfStorageDirectory, 1)
  assert.deepEqual(await readdirBefore(directory), [])
})

// Value: protects=a storage lock a killed window left is taken over in the same boot although another process has its process id; fails_when=the lock is judged by process id and boot alone, so it refuses every write until the machine restarts or the file is removed by hand (Cycle 0046 row 2, LK-F1, and row 9); why_new=withStorageLock.test.ts had no case with a process start; seam=none (the lock names this running test process with another start)
test('a lock whose owner’s process id is in use by another process is taken over', async (context) => {
  // Arrange: the lock of a window that was killed; this test process has its process id now, and it began at another time.
  const directory = await storageDirectory(context)
  await writeFile(
    join(directory, 'writer.lock'),
    JSON.stringify({
      pid: process.pid,
      hostname: hostname(),
      processStart: startOfKilledWindow(),
    }),
  )
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

// Value: protects=two windows never write the saved data at once because the clock was set forward while one held the lock, on a system without a kernel boot id (macOS, Windows); fails_when=a lock that carries its owner's start is still judged by the boot time, which a forward step of more than 60 s moves past the recorded one (Cycle 0046 row 9, PL-1); why_new=every boot time test wrote a lock without a start; seam=the injected boot identity (the lock names this running test process with its real start)
test('a live window’s lock stays in place after the clock moves forward by 90 s, and this window’s write is refused', async (context) => {
  // Arrange: this running process holds the lock, recorded with its start and the boot time it computed; a second window computes its boot time after the clock was set forward by 90 s.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  const startOfTheHolder = await realProcessStart(process.pid)
  const lockOfTheHolder = JSON.stringify({
    pid: process.pid,
    hostname: 'workstation',
    boot: { startedAtMs: 1_790_000_000_000 },
    processStart: startOfTheHolder,
  })
  await writeFile(lockPath, lockOfTheHolder)
  let writes = 0
  // Act
  const outcome = await writeUnderLock(
    directory,
    async () => {
      writes += 1
    },
    { hostname: 'workstation', boot: { startedAtMs: 1_790_000_090_000 } },
  )
  // Assert
  assert.equal(typeof startOfTheHolder, 'string')
  assert.equal(
    outcome,
    `Error: Learning storage is locked by another writer or an interrupted session (lock file: ${lockPath}). No data changed; retry after resolving the lock.`,
  )
  assert.equal(writes, 0)
  assert.equal(await readFile(lockPath, 'utf8'), lockOfTheHolder)
  assert.deepEqual(await readdir(directory), ['writer.lock'])
})

// Value: protects=a window killed while it held the takeover claim does not block every takeover of a stale lock until the next restart; fails_when=the claim is judged by process id and boot alone, so it stays for as long as any process has its owner's id, and no window can take the stale lock over (Cycle 0046 row 2, LK-F1, identity half: storage claims); why_new=every claim test named a process id that no longer exists or a running window; seam=the process probe (the claim names this running test process with another start)
test('a takeover claim of a killed window whose process id is in use again does not keep a stale storage lock in place', async (context) => {
  // Arrange: the lock of exited process 4194305, and the takeover claim of a window that was killed in the middle of a takeover; this test process has that window's process id now.
  const directory = await storageDirectory(context)
  const claimDirectory = join(directory, 'writer.lock.takeover')
  await writeFile(
    join(directory, 'writer.lock'),
    JSON.stringify({ pid: 4194305, hostname: hostname() }),
  )
  await mkdir(claimDirectory)
  await writeFile(
    join(claimDirectory, 'claim-of-a-killed-window'),
    JSON.stringify({
      pid: process.pid,
      hostname: hostname(),
      processStart: startOfKilledWindow(),
    }),
  )
  answerProcessProbes(context, [ID_OF_NO_PROCESS])
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

// Value: protects=what a killed window prepared for a lock or a takeover and never placed does not stay in the storage for good because another process has its process id, and what a running window prepares is never removed; fails_when=a prepared claim or a prepared lock is judged by process id and boot alone (Cycle 0046 row 2, identity half: storage claims), or a leftover with a start is removed whatever that start is; why_new=every prepared leftover test named a process id that no longer exists; seam=none (the leftovers name this running test process, with another start and with its real one)
test('a prepared takeover claim and a prepared lock of a killed window whose process id is in use again are removed by the next write, and those of a running window stay', async (context) => {
  // Arrange: no lock. A killed window left a prepared claim and a prepared lock; this test process has its process id now. A running window, recorded with the real start of this process, is preparing the same two.
  const directory = await storageDirectory(context)
  const ofTheKilledWindow = JSON.stringify({
      pid: process.pid,
      hostname: hostname(),
      processStart: startOfKilledWindow(),
    }),
    ofTheRunningWindow = JSON.stringify({
      pid: process.pid,
      hostname: hostname(),
      processStart: await realProcessStart(process.pid),
    })
  await mkdir(join(directory, 'writer.lock.takeover-killed'))
  await writeFile(
    join(directory, 'writer.lock.takeover-killed', 'killed'),
    ofTheKilledWindow,
  )
  await writeFile(
    join(directory, 'writer.lock.pending-killed'),
    ofTheKilledWindow,
  )
  await mkdir(join(directory, 'writer.lock.takeover-running'))
  await writeFile(
    join(directory, 'writer.lock.takeover-running', 'running'),
    ofTheRunningWindow,
  )
  await writeFile(
    join(directory, 'writer.lock.pending-running'),
    ofTheRunningWindow,
  )
  // Act
  const outcome = await writeUnderLock(directory, async () => {})
  // Assert
  assert.equal(outcome, 'written')
  assert.deepEqual((await readdir(directory)).sort(), [
    'writer.lock.pending-running',
    'writer.lock.takeover-running',
  ])
})

// Value: protects=the learner's writes when a lock file records a process id no system can have (a damaged or copied file); fails_when=the id counts as a process that may still run, because the system's probe refuses the number itself, so every write is refused with "Learning storage is locked ..." until the file is removed by hand (Cycle 0046 row 180); why_new=every lock test named an id a system can have; seam=none (the system's own probe)
test('a storage lock of this machine that names the process id 4294967295, which no system can have, is taken over by the next write', async (context) => {
  // Arrange
  const directory = await storageDirectory(context)
  await writeFile(
    join(directory, 'writer.lock'),
    JSON.stringify({ pid: 4_294_967_295, hostname: hostname() }),
  )
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

// Value: protects=the learner's next write after an editor window was killed and its WSL distribution alone was restarted (`wsl --terminate` while the WSL virtual machine keeps running): the lock the killed window left is taken over, as in 0.2.29.0; fails_when=a storage lock that names another pid namespace of this kernel boot is never judged, so every write is refused with "Learning storage is locked ..." until the file is removed by hand or the virtual machine restarts (a regression of row 65); why_new=row 65 named the pid namespace in the form; seam=the process probe. Linux only: no other system has pid namespaces, and a Linux start is never judged on another system.
test(
  'a storage lock a killed window left in another pid namespace of this kernel boot is taken over by the next write',
  {
    skip: process.platform !== 'linux' && 'pid namespaces exist on Linux only',
  },
  async (context) => {
    // Arrange: the lock of exited process 4194305 of this machine, written under this kernel boot in a pid namespace that has ended since (its number, 1, is none a running system gives).
    const directory = await storageDirectory(context)
    await writeFile(
      join(directory, 'writer.lock'),
      JSON.stringify({
        pid: 4194305,
        hostname: hostname(),
        boot: (await currentStorageOwner()).boot,
        processStart: 'linux@1:100',
      }),
    )
    answerProcessProbes(context, [ID_OF_NO_PROCESS])
    let writes = 0
    // Act
    const outcome = await writeUnderLock(directory, async () => {
      writes += 1
    })
    // Assert
    assert.equal(outcome, 'written')
    assert.equal(writes, 1)
    assert.deepEqual(await readdir(directory), [])
  },
)

// Value: protects=a learner at whose private storage folder a link or a file stands (a storage folder kept elsewhere behind a link; a file of that name), at every write of Codebook, also the Cursor setup's; fails_when=the refusal reads "Learning storage is not a regular directory." and names neither the folder nor what to do, or, for a file or a link that leads nowhere, is the system's text of the folder's creation ("EEXIST: file already exists, mkdir …"); or a step it names does not end in a write; why_new=Cycle 0046 row 311; seam=none, the real entries (the link is a junction on Windows, which every user may create)
test('a link or a file where a private storage folder should be is refused with the folder’s path, what stands there and what to do, and nothing is written through the link: after the learner puts the folder in the link’s place, removes the link, or renames the file, the write runs', async (context) => {
  // Arrange: three storage paths: two links to a folder kept elsewhere, and a file.
  const root = await storageDirectory(context)
  const linkToReplace = join(root, 'link-to-replace'),
    linkToRemove = join(root, 'link-to-remove'),
    file = join(root, 'a-file')
  await mkdir(join(root, 'kept-for-the-first'))
  await mkdir(join(root, 'kept-for-the-second'))
  await symlink(join(root, 'kept-for-the-first'), linkToReplace, 'junction')
  await symlink(join(root, 'kept-for-the-second'), linkToRemove, 'junction')
  await writeFile(file, 'A file of that name.')
  const write = (directory: string): Promise<string> =>
    withStorageLock(directory, async () => {
      await writeFile(join(directory, 'written'), 'x')
      return 'written'
    }).catch((error: Error) => error.message)

  // Act
  const refusals = {
    linkToReplace: await write(linkToReplace),
    linkToRemove: await write(linkToRemove),
    file: await write(file),
  }
  const entriesBehindTheLinks = [
    await readdir(join(root, 'kept-for-the-first')),
    await readdir(join(root, 'kept-for-the-second')),
  ]
  // The sentences are followed to the letter, each way once.
  await unlink(linkToReplace)
  await rename(join(root, 'kept-for-the-first'), linkToReplace)
  await unlink(linkToRemove)
  await rename(file, join(root, 'a-file-renamed'))
  const writesAfterwards = {
    linkToReplace: await write(linkToReplace),
    linkToRemove: await write(linkToRemove),
    file: await write(file),
  }

  // Assert
  assert.deepEqual(
    {
      refusals,
      entriesBehindTheLinks,
      writesAfterwards,
      folderTheRemovedLinkPointedTo: await readdir(
        join(root, 'kept-for-the-second'),
      ),
      renamedFile: await readFile(join(root, 'a-file-renamed'), 'utf8'),
    },
    {
      refusals: {
        linkToReplace: `Learning storage is not a regular directory: ${linkToReplace}. That path is a link, and Codebook writes through no link. Put the folder it points to in the link's place, or remove the link (Codebook then makes an empty folder there), then try again.`,
        linkToRemove: `Learning storage is not a regular directory: ${linkToRemove}. That path is a link, and Codebook writes through no link. Put the folder it points to in the link's place, or remove the link (Codebook then makes an empty folder there), then try again.`,
        file: `Learning storage is not a regular directory: ${file}. What stands at that path is not a folder. Rename it or move it elsewhere, then try again.`,
      },
      entriesBehindTheLinks: [[], []],
      writesAfterwards: {
        linkToReplace: 'written',
        linkToRemove: 'written',
        file: 'written',
      },
      folderTheRemovedLinkPointedTo: [],
      renamedFile: 'A file of that name.',
    },
  )
})

// Value: protects=a learner at whose private storage folder a link stands that leads nowhere (the folder it pointed to was moved or deleted); fails_when=the folder's creation fails with ENOENT through the link and that failure is thrown before the path is looked at, so the learner reads the system's text ("ENOENT: no such file or directory, mkdir …"), which names no step; or the write does not run once the link is removed; why_new=Cycle 0046 /ship review T3: row 311's test had no link that leads nowhere, and an early throw of the creation's failure survived every test; seam=none, the real entries (the link is a junction on Windows, which every user may create)
test('a link that leads nowhere where a private storage folder should be is refused with the folder’s path, that it is a link and what to do, and after the learner removes the link the write runs', async (context) => {
  // Arrange: a link at the storage path to a folder that does not exist.
  const root = await storageDirectory(context)
  const linkToNowhere = join(root, 'link-to-nowhere')
  await symlink(join(root, 'moved-away'), linkToNowhere, 'junction')
  let writes = 0
  const write = (): Promise<string> =>
    withStorageLock(linkToNowhere, async () => {
      writes += 1
      return 'written'
    }).catch((error: Error) => error.message)

  // Act
  const refusal = await write()
  const writesAtTheRefusal = writes
  // The sentence is followed to the letter: the link is removed.
  await unlink(linkToNowhere)
  const writeAfterwards = await write()

  // Assert
  assert.deepEqual(
    {
      refusal,
      writesAtTheRefusal,
      writeAfterwards,
      entriesOfTheRoot: await readdir(root),
    },
    {
      refusal: `Learning storage is not a regular directory: ${linkToNowhere}. That path is a link, and Codebook writes through no link. Put the folder it points to in the link's place, or remove the link (Codebook then makes an empty folder there), then try again.`,
      writesAtTheRefusal: 0,
      writeAfterwards: 'written',
      entriesOfTheRoot: ['link-to-nowhere'],
    },
  )
})

/**
 * Loads {@link withStorageLock} as one window that has its own queue, whose read of its lock's owner and whose removal of its lock fail while a test says so, as on Windows while a scanner or an indexer holds the file (`EBUSY`) or the system refuses the removal (`EPERM`).
 * @param lockPath - The `writer.lock` file whose read and removal may be refused.
 * @returns The loaded write and the switches: `readsToRefuse` counts the reads of the lock's owner that answer nothing, `isRemovalRefused` refuses every removal of the lock while it is set.
 * @example const window = await windowWithRefusedRelease(lockPath); window.readsToRefuse = 1
 */
async function windowWithRefusedRelease(lockPath: string): Promise<{
  withStorageLock: typeof withStorageLock
  readsToRefuse: number
  isRemovalRefused: boolean
}> {
  const switches = {
    readsToRefuse: 0,
    isRemovalRefused: false,
  }
  const loaded = await loadModule<typeof lockModule>(
    resolve(__dirname, '../utils/withStorageLock.js'),
    {
      './readRecordedOwner': {
        readRecordedOwner: async (path: string) => {
          if (path === lockPath && switches.readsToRefuse > 0) {
            switches.readsToRefuse -= 1
            return undefined
          }
          return readRecordedOwner(path)
        },
      },
      'node:fs/promises': {
        ...fsPromises,
        unlink: async (path: string) => {
          if (path === lockPath && switches.isRemovalRefused)
            throw Object.assign(
              new Error('EPERM: operation not permitted, unlink'),
              { code: 'EPERM' },
            )
          return fsPromises.unlink(path)
        },
      },
    },
  )
  return Object.assign(switches, { withStorageLock: loaded.withStorageLock })
}

// Value: protects=the learner's writes when the read of this window's own lock fails once at its release (on Windows a scanner or an indexer holds the file: EBUSY); fails_when=one failed read leaves the lock that names this window in place, so every later write of this window and of every other window is refused with "Learning storage is locked …" until this window closes; why_new=Cycle 0047 row 31 (P3RT9); seam=the read of the lock's owner in a loaded withStorageLock, which answers nothing once
test('a release whose first read of the lock fails reads it again and removes the lock', async (context) => {
  // Arrange: a window whose next read of its lock's owner answers nothing.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  const window = await windowWithRefusedRelease(lockPath)

  // Act
  const outcome = await window
    .withStorageLock(directory, async () => {
      window.readsToRefuse = 1
      return 'written'
    })
    .catch((error: unknown) => String(error))

  // Assert
  assert.deepEqual(
    { outcome, entriesAfterTheWrite: await readdir(directory) },
    { outcome: 'written', entriesAfterTheWrite: [] },
  )
})

// Value: protects=the learner's later writes in a window whose lock could not be read at all while it was released; fails_when=the lock that names this window stays, and this window refuses its own next write with "Learning storage is locked …" until it closes; why_new=Cycle 0047 row 31 (P3RT9); seam=the read of the lock's owner in a loaded withStorageLock, which answers nothing for the whole first release
test('a lock this window could not read while it released it is taken back by this window’s next write, which goes ahead and leaves no lock', async (context) => {
  // Arrange: a window whose reads of its lock's owner answer nothing for the whole first release.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  const window = await windowWithRefusedRelease(lockPath)
  const firstOutcome = await window
    .withStorageLock(directory, async () => {
      window.readsToRefuse = 1_000
      return 'written'
    })
    .catch((error: unknown) => String(error))
  const entriesAfterTheFirstWrite = await readdir(directory)
  window.readsToRefuse = 0

  // Act
  const nextOutcome = await window
    .withStorageLock(directory, async () => 'written')
    .catch((error: unknown) => String(error))

  // Assert
  assert.deepEqual(
    {
      firstOutcome,
      entriesAfterTheFirstWrite,
      nextOutcome,
      entriesAfterTheNextWrite: await readdir(directory),
    },
    {
      firstOutcome: 'written',
      entriesAfterTheFirstWrite: ['writer.lock'],
      nextOutcome: 'written',
      entriesAfterTheNextWrite: [],
    },
  )
})

// Value: protects=the learner's later writes in a window whose lock the system refused to remove after a write (on Windows EPERM or EBUSY while another program holds the file); fails_when=the lock that names this window stays, and this window refuses its own next write with "Learning storage is locked …" until it closes; why_new=Cycle 0047 row 31 (P3RT9); seam=the removal of the lock in a loaded withStorageLock, which fails with EPERM for the whole first release; no_claim=the refusal of the first release is still reported to its caller, as a study removal names it (studyRemoval.test.ts)
test('a write whose lock the system refuses to remove is made and reports the refusal, and this window’s next write takes the lock back, goes ahead and leaves no lock', async (context) => {
  // Arrange: a window that may not remove its lock during its first release.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  const window = await windowWithRefusedRelease(lockPath)
  let writesMade = 0
  const firstOutcome = await window
    .withStorageLock(directory, async () => {
      writesMade += 1
      window.isRemovalRefused = true
      return 'written'
    })
    .catch((error: unknown) => String(error))
  const entriesAfterTheFirstWrite = await readdir(directory)
  window.isRemovalRefused = false

  // Act
  const nextOutcome = await window
    .withStorageLock(directory, async () => {
      writesMade += 1
      return 'written'
    })
    .catch((error: unknown) => String(error))

  // Assert
  assert.deepEqual(
    {
      firstOutcome,
      entriesAfterTheFirstWrite,
      nextOutcome,
      writesMade,
      entriesAfterTheNextWrite: await readdir(directory),
    },
    {
      firstOutcome: 'Error: EPERM: operation not permitted, unlink',
      entriesAfterTheFirstWrite: ['writer.lock'],
      nextOutcome: 'written',
      writesMade: 2,
      entriesAfterTheNextWrite: [],
    },
  )
})

// Value: protects=another window's writes after this window's leftover lock was replaced by that window's own lock (the learner removed the leftover by hand, as the refusal says, and the other window then took the storage); fails_when=this window's next write takes back whatever stands at the path it noted, so it removes the other window's lock and both write; why_new=Cycle 0047 row 92 (TEST-3): the take-back of row 31 had no test where the noted path names another writer by the next hold; seam=the removal of the lock in a loaded withStorageLock, which fails with EPERM for the whole first release; no_claim=a lock that still names this window (the test before this one)
test('a window whose leftover lock another live window has replaced by its own refuses its next write and leaves that window’s lock byte for byte', async (context) => {
  // Arrange: this window's first release may not remove its lock, so the lock is left and noted; then the learner removes it by hand and another live window of this machine places its own lock.
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  const window = await windowWithRefusedRelease(lockPath)
  let writesMade = 0
  const firstOutcome = await window
    .withStorageLock(directory, async () => {
      writesMade += 1
      window.isRemovalRefused = true
      return 'written'
    })
    .catch((error: unknown) => String(error))
  window.isRemovalRefused = false
  const otherWindow = await idleChild(context)
  const lockOfTheOtherWindow = JSON.stringify({
    pid: otherWindow.pid,
    hostname: hostname(),
    processStart: await realProcessStart(otherWindow.pid!),
  })
  await unlink(lockPath)
  await writeFile(lockPath, lockOfTheOtherWindow)

  // Act
  const nextOutcome = await window
    .withStorageLock(directory, async () => {
      writesMade += 1
      return 'written'
    })
    .catch((error: unknown) => String(error))

  // Assert
  assert.deepEqual(
    {
      firstOutcome,
      nextOutcome,
      writesMade,
      lockAfterTheNextWrite: await readFile(lockPath, 'utf8').catch(
        () => 'no lock file',
      ),
      entriesAfterTheNextWrite: await readdir(directory),
    },
    {
      firstOutcome: 'Error: EPERM: operation not permitted, unlink',
      nextOutcome: `Error: Learning storage is locked by another writer or an interrupted session (lock file: ${lockPath}). No data changed; retry after resolving the lock.`,
      writesMade: 1,
      lockAfterTheNextWrite: lockOfTheOtherWindow,
      entriesAfterTheNextWrite: ['writer.lock'],
    },
  )
})

/**
 * Loads {@link withStorageLock} as one window with its own queue, whose reads of its lock's owner are counted while a test says so, and answer nothing while it says so, as on Windows while a scanner or an indexer holds the file.
 * @param lockPath - The `writer.lock` file whose reads are counted.
 * @returns The loaded write and the switches: `isCounting` counts each read of the lock's owner into `ownerReads`; `isOwnerUnread` makes each read answer nothing.
 * @example const window = await windowThatCountsOwnerReads(lockPath); window.isCounting = true
 */
async function windowThatCountsOwnerReads(lockPath: string): Promise<{
  withStorageLock: typeof withStorageLock
  ownerReads: number
  isCounting: boolean
  isOwnerUnread: boolean
}> {
  const switches = { ownerReads: 0, isCounting: false, isOwnerUnread: false }
  const loaded = await loadModule<typeof lockModule>(
    resolve(__dirname, '../utils/withStorageLock.js'),
    {
      './readRecordedOwner': {
        readRecordedOwner: async (path: string) => {
          if (path === lockPath && switches.isCounting) switches.ownerReads += 1
          return path === lockPath && switches.isOwnerUnread
            ? undefined
            : readRecordedOwner(path)
        },
      },
    },
  )
  return Object.assign(switches, { withStorageLock: loaded.withStorageLock })
}

/**
 * Puts an entry that cannot be this window's lock in the lock's place, as another window or a program may leave one there.
 * @param kind - What is put there: an empty file (the lock of an earlier build, created and not yet written), a folder, a file larger than any owner record ({@link WIKI_METADATA_FILE_LIMIT_BYTES} and one byte, sparse) or a link to a folder (a junction on Windows, which every user may create).
 * @example await putInTheLocksPlace(lockPath, 'folder')
 */
async function putInTheLocksPlace(
  lockPath: string,
  kind: 'empty file' | 'folder' | 'oversized file' | 'link',
): Promise<void> {
  await rm(lockPath, { recursive: true, force: true })
  if (kind === 'empty file') await writeFile(lockPath, '')
  if (kind === 'folder') await mkdir(lockPath)
  if (kind === 'oversized file') {
    await writeFile(lockPath, '')
    await truncate(lockPath, WIKI_METADATA_FILE_LIMIT_BYTES + 1)
  }
  if (kind === 'link') {
    const elsewhere = `${lockPath}-elsewhere`
    await mkdir(elsewhere)
    await symlink(elsewhere, lockPath, 'junction')
  }
}

/** Says in a few words what stands at a path, without following a link. @example await entryAt(lockPath) // => 'file of 0 bytes' */
async function entryAt(path: string): Promise<string> {
  const entry = await lstat(path).catch(() => undefined)
  if (!entry) return 'nothing'
  if (entry.isSymbolicLink()) return 'link'
  if (entry.isDirectory()) return 'folder'
  return `file of ${entry.size} bytes`
}

// Value: protects=the release of this window's lock when an entry that cannot be this window's lock stands in its place (another window's lock of an earlier build not written yet, a folder, a file larger than any owner record, a link): it reads the entry once, leaves it as it is and notes nothing for a take-back; fails_when=the release answers 'kept' for such an entry (withStorageLock.ts releaseOfUnreadOwner), so it reads it 20 times over about half a second and notes the path, which every later hold of this window then tries to take back (Cycle 0047 row 199); why_new=Cycle 0047 row 199 (S2TEST-2, S2SM-U37): no test failed when that branch answered 'kept'; seam=the read of the lock's owner in a loaded withStorageLock, counted from the end of the write; the entries are real
test('a release that finds an empty file, a folder, a file larger than any owner record or a link in its lock’s place reads it once and leaves it as it is', async (context) => {
  // Arrange
  const kinds = ['empty file', 'folder', 'oversized file', 'link'] as const
  const releases: Record<string, unknown> = {}
  for (const kind of kinds) {
    const directory = await storageDirectory(context)
    const lockPath = join(directory, 'writer.lock')
    const window = await windowThatCountsOwnerReads(lockPath)

    // Act: while the window writes, the entry takes its lock's place; the reads of the release are counted.
    const outcome = await window
      .withStorageLock(directory, async () => {
        await putInTheLocksPlace(lockPath, kind)
        window.isCounting = true
        return 'written'
      })
      .catch((error: unknown) => String(error))
    releases[kind] = {
      outcome,
      ownerReads: window.ownerReads,
      entry: await entryAt(lockPath),
    }
  }

  // Assert
  assert.deepEqual(releases, {
    'empty file': {
      outcome: 'written',
      ownerReads: 1,
      entry: 'file of 0 bytes',
    },
    folder: { outcome: 'written', ownerReads: 1, entry: 'folder' },
    'oversized file': {
      outcome: 'written',
      ownerReads: 1,
      entry: 'file of 67108865 bytes',
    },
    link: { outcome: 'written', ownerReads: 1, entry: 'link' },
  })
})

// Value: protects=a write whose lock was removed while it ran (by the learner, as a refusal tells, or by a program): the write ends without an error after one look at the lock's path, and the next write places its lock and runs; fails_when=the release takes a lock that is gone for one whose owner could not be read (withStorageLock.ts releaseOfUnreadOwner, ENOENT), so it looks for it 20 times over about half a second and notes the path for a take-back, or fails the write; why_new=Cycle 0047 row 199 (S2SM-U38): no test removed the lock during the write; seam=the read of the lock's owner in a loaded withStorageLock, counted from the end of the first write
test('a write whose lock was removed while it ran ends without an error after one look at its lock, and the next write places its lock and runs', async (context) => {
  // Arrange
  const directory = await storageDirectory(context)
  const lockPath = join(directory, 'writer.lock')
  const window = await windowThatCountsOwnerReads(lockPath)

  // Act
  const firstOutcome = await window
    .withStorageLock(directory, async () => {
      await rm(lockPath)
      window.isCounting = true
      return 'written'
    })
    .catch((error: unknown) => String(error))
  const ownerReadsOfTheRelease = window.ownerReads
  window.isCounting = false
  const nextOutcome = await window
    .withStorageLock(directory, async () => 'written again')
    .catch((error: unknown) => String(error))

  // Assert
  assert.deepEqual(
    {
      firstOutcome,
      ownerReadsOfTheRelease,
      nextOutcome,
      entriesAfterTheNextWrite: await readdir(directory),
    },
    {
      firstOutcome: 'written',
      ownerReadsOfTheRelease: 1,
      nextOutcome: 'written again',
      entriesAfterTheNextWrite: [],
    },
  )
})

// Value: protects=a folder or a link that took the lock's place during a write (no lock of this window's): it stays, and the next write of this window is refused by it as a lock it cannot judge, without trying to take it back; fails_when=the release notes such an entry as this window's leftover (withStorageLock.ts releaseOfUnreadOwner answers 'kept'), so the next write runs the release's 20 attempts on it again before it is refused (Cycle 0047 row 199); why_new=Cycle 0047 row 199 (S2SM-U37): no test wrote again after such an entry; seam=the read of the lock's owner in a loaded withStorageLock, counted during the next write; the entries are real
test('a folder or a link that took the lock’s place during a write stays, and the next write is refused without trying to take it back', async (context) => {
  // Arrange: a write during which the entry takes its lock's place.
  const kinds = ['folder', 'link'] as const
  const nextWrites: Record<string, unknown> = {}
  for (const kind of kinds) {
    const directory = await storageDirectory(context)
    const lockPath = join(directory, 'writer.lock')
    const window = await windowThatCountsOwnerReads(lockPath)
    await window.withStorageLock(directory, () =>
      putInTheLocksPlace(lockPath, kind),
    )
    window.isCounting = true

    // Act
    const nextOutcome = await window
      .withStorageLock(directory, async () => 'written')
      .catch((error: unknown) => String(error))
    nextWrites[kind] = {
      nextOutcome: nextOutcome.replace(lockPath, '<lock file>'),
      ownerReadsOfTheNextWrite: window.ownerReads,
      entry: await entryAt(lockPath),
    }
  }

  // Assert
  const refusal =
    'Error: Learning storage is locked by another writer or an interrupted session (lock file: <lock file>). No data changed; retry after resolving the lock.'
  assert.deepEqual(nextWrites, {
    folder: {
      nextOutcome: refusal,
      ownerReadsOfTheNextWrite: 0,
      entry: 'folder',
    },
    link: { nextOutcome: refusal, ownerReadsOfTheNextWrite: 0, entry: 'link' },
  })
})

// Value: protects=a Cursor setup in a window whose own leftover catalog lock stays unreadable (a scanner holds it): the catalog's tries of one setup take back that leftover once, and the setup is refused within the catalog's one to three seconds of pauses and that one take-back of about half a second; fails_when=every try of the hold runs the release's 20 attempts again (withStorageLock.ts takeBackOwnLeftover), about half a second each, so the catalog's 21 tries keep the setup waiting about 12 s before it is refused (Cycle 0047 row 199); why_new=Cycle 0047 row 199 (S2PERF-3): no test measured a take-back that keeps failing; seam=the read of the lock's owner in a loaded withStorageLock, which answers nothing, given to a loaded Cursor MCP catalog; no_claim=the length of each pause (a random draw)
test('a Cursor setup whose own leftover catalog lock stays unreadable takes it back once and is refused within a few seconds, not after every try’s half second', async (context) => {
  // Arrange: a first hold of the catalog's storage whose release cannot read its lock, so the lock is left and noted; it stays unreadable.
  const cursorDirectory = await storageDirectory(context)
  const storageRoot = join(cursorDirectory, 'storage'),
    catalogStorage = join(storageRoot, 'cursor-mcp-catalog')
  await mkdir(catalogStorage, { recursive: true })
  const lockPath = join(await realpath(catalogStorage), 'writer.lock')
  const window = await windowThatCountsOwnerReads(lockPath)
  await window.withStorageLock(catalogStorage, async () => {
    window.isOwnerUnread = true
  })
  const catalog = await loadModule<typeof catalogModule>(
    resolve(__dirname, '../utils/refreshCursorMcpCatalog.js'),
    { './withStorageLock': { withStorageLock: window.withStorageLock } },
    // The catalog tells a missing file by `instanceof Error`; the file system's errors belong to this realm.
    { Error },
  )
  window.isCounting = true
  const startedAt = performance.now()

  // Act
  const setup = await catalog
    .refreshCursorMcpCatalog(storageRoot, cursorDirectory)
    .then(
      () => 'answered',
      (error: unknown) => String(error),
    )
  const elapsedMs = performance.now() - startedAt

  // Assert: the pauses take one to three seconds and the one take-back half a second; the bound, half the 12 s of a take-back at every try, leaves room for a loaded machine.
  assert.deepEqual(
    {
      setup,
      ownerReadsOfTheSetup: window.ownerReads,
      isRefusedWithinSixSeconds: elapsedMs < 6_000,
    },
    {
      setup: `Error: Learning storage is locked by another writer or an interrupted session (lock file: ${lockPath}). No data changed; retry after resolving the lock.`,
      ownerReadsOfTheSetup: 20,
      isRefusedWithinSixSeconds: true,
    },
  )
})
