import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readBootIdentity } from '../utils/readBootIdentity'
import type { BoundedQueryRunner } from '../utils/runBoundedQuery'

import { answerKernelBootId } from './utils/answerKernelBootId'

// Value: protects=on Linux a storage owner's boot is the kernel's boot id, which no clock can move; fails_when=the boot id file is not read, or its line break is recorded with it; why_new=the boot identity is new (engineering review ER-20); seam=the path of the boot id file
test('the boot is the kernel’s boot id where the system publishes one', async (context) => {
  // Arrange: a boot id file as the Linux kernel writes it, one line.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-boot-identity-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const bootIdPath = join(directory, 'boot_id')
  await writeFile(bootIdPath, '0c1d7a52-6f0e-4d3b-9a57-3f6f0a1b2c3d\n')
  // Act
  const boot = await readBootIdentity(bootIdPath)
  // Assert
  assert.deepEqual(boot, { id: '0c1d7a52-6f0e-4d3b-9a57-3f6f0a1b2c3d' })
})

// Value: protects=on a system without a kernel boot id (macOS, Windows) a storage owner still records which boot it ran under; fails_when=no boot is recorded there, so a lock from before a restart is judged by its reused process id; why_new=the boot identity is new; seam=the clock and the uptime
test('without a kernel boot id the boot is the time the machine started: the clock minus the uptime', async (context) => {
  // Arrange: no boot id file on a system that names its boot by no id (Windows; macOS is the next test); the clock reads 1 790 000 600 000 ms and the machine has been up for 600 s.
  context.mock.method(Date, 'now', () => 1_790_000_600_000)
  context.mock.method(os, 'uptime', () => 600)
  // Act
  const boot = await readBootIdentity(
    join(tmpdir(), 'codebook-no-such-boot-id'),
    { platform: 'win32' },
  )
  // Assert
  assert.deepEqual(boot, { startedAtMs: 1_790_000_000_000 })
})

// Value: protects=on macOS a storage owner's boot is named by the boot session's id, which no clock moves and which tells two computers apart, so only an exact boot proves one machine and a Mac's host-name change within one boot keeps its locks, markers and recordings judged by process; fails_when=macOS records only the computed boot time, which two computers that started within one minute share (S4), the query runs by a bare name or unbounded, or it runs again for every owner a window records or judges; why_new=Cycle 0046 third review S4; seam=the system and the runner of the query, with the clock and the uptime
test('on macOS the boot is the boot session’s id beside the computed boot time, asked once of sysctl by its full path within the bounds of a process start query', async (context) => {
  // Arrange: no kernel boot id; the clock reads 1 790 000 600 000 ms, the machine has been up for 600 s, and sysctl prints a session id.
  let wallClockMs = 1_790_000_600_000
  let elapsedMs = 0
  context.mock.method(Date, 'now', () => wallClockMs)
  context.mock.method(performance, 'now', () => elapsedMs)
  context.mock.method(os, 'uptime', () => 600)
  const queries: unknown[] = []
  const run: BoundedQueryRunner = async (file, queryArguments, options) => {
    queries.push({ file, queryArguments, options })
    return { stdout: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14\n' }
  }
  const noBootIdFile = join(tmpdir(), 'codebook-no-such-boot-id')
  // Act
  const first = await readBootIdentity(noBootIdFile, {
    platform: 'darwin',
    run,
  })
  // A later clock correction refreshes the estimate without expiring the exact id.
  wallClockMs = 1_790_004_200_000
  elapsedMs = 120_000
  const second = await readBootIdentity(noBootIdFile, {
    platform: 'darwin',
    run,
  })
  // Assert
  assert.deepEqual(
    { first, second, queries },
    {
      first: {
        id: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14',
        startedAtMs: 1_790_000_000_000,
      },
      second: {
        id: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14',
        startedAtMs: 1_790_003_600_000,
      },
      queries: [
        {
          file: '/usr/sbin/sysctl',
          queryArguments: ['-n', 'kern.bootsessionuuid'],
          options: {
            timeout: 3_000,
            maxBuffer: 1_024,
            killSignal: 'SIGKILL',
            windowsHide: true,
          },
        },
      ],
    },
  )
})

// Value: protects=a Mac whose boot session cannot be read still records the boot it can compute, and is judged by no session it does not have; fails_when=a failed or odd answer of sysctl is taken for a session id, or makes the boot unknown; why_new=Cycle 0046 third review S4; seam=the system and the runner of the query, with the clock and the uptime
test('on macOS a sysctl that fails or prints no session id leaves the computed boot time alone', async (context) => {
  // Arrange
  context.mock.method(Date, 'now', () => 1_790_000_600_000)
  context.mock.method(os, 'uptime', () => 600)
  const noBootIdFile = join(tmpdir(), 'codebook-no-such-boot-id')
  // Act
  const boots = {
    failed: await readBootIdentity(noBootIdFile, {
      platform: 'darwin',
      run: async () => {
        throw new Error('spawn /usr/sbin/sysctl ENOENT')
      },
    }),
    noSessionId: await readBootIdentity(noBootIdFile, {
      platform: 'darwin',
      run: async () => ({ stdout: 'unknown oid\n' }),
    }),
  }
  // Assert
  assert.deepEqual(boots, {
    failed: { startedAtMs: 1_790_000_000_000 },
    noSessionId: { startedAtMs: 1_790_000_000_000 },
  })
})

// Each failed query form must recover without reopening the editor window.
for (const firstQuery of [
  {
    name: 'a failed query',
    run: async () => {
      throw new Error('spawn /usr/sbin/sysctl ENOENT')
    },
  },
  {
    name: 'an invalid session answer',
    run: async () => ({ stdout: 'unknown oid\n' }),
  },
]) {
  // Value: protects=macOS storage owners regain an exact boot id after a transient query failure; fails_when=an undefined session stays cached for the window or retries before one minute; why_new=Cycle 0046 row 1050; seam=platform, runner and monotonic clock
  test(`on macOS ${firstQuery.name} recovers after one minute and keeps the recovered session`, async (context) => {
    // Arrange
    context.mock.method(Date, 'now', () => 1_790_000_600_000)
    context.mock.method(os, 'uptime', () => 600)
    let elapsedMs = 0
    context.mock.method(performance, 'now', () => elapsedMs)
    let queries = 0
    const run: BoundedQueryRunner = async () => {
      queries += 1
      // Only the first query fails; later queries can identify the boot.
      if (queries === 1) return firstQuery.run()
      return { stdout: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14\n' }
    }
    const noBootIdFile = join(tmpdir(), 'codebook-no-such-boot-id')

    // Act
    const first = await readBootIdentity(noBootIdFile, {
      platform: 'darwin',
      run,
    })
    elapsedMs = 59_999
    const beforeRetry = await readBootIdentity(noBootIdFile, {
      platform: 'darwin',
      run,
    })
    const queriesBeforeRetry = queries
    elapsedMs = 60_000
    const recovered = await readBootIdentity(noBootIdFile, {
      platform: 'darwin',
      run,
    })
    elapsedMs = 120_000
    const kept = await readBootIdentity(noBootIdFile, {
      platform: 'darwin',
      run,
    })

    // Assert
    assert.deepEqual(
      { first, beforeRetry, queriesBeforeRetry, recovered, kept, queries },
      {
        first: { startedAtMs: 1_790_000_000_000 },
        beforeRetry: { startedAtMs: 1_790_000_000_000 },
        queriesBeforeRetry: 1,
        recovered: {
          id: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14',
          startedAtMs: 1_790_000_000_000,
        },
        kept: {
          id: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14',
          startedAtMs: 1_790_000_000_000,
        },
        queries: 2,
      },
    )
  })
}

// Value: protects=concurrent macOS owner reads share the pending system query; fails_when=the cache keeps only completed reads and starts one sysctl per caller; why_new=Cycle 0046 row 1050; seam=runner held until both readers reach it and the existing kernel-file seam
test('on macOS concurrent owner reads share one pending boot-session query', async (context) => {
  // Arrange: the kernel-file read settles immediately, so both callers reach the query before it is released.
  answerKernelBootId(context, undefined)
  context.mock.method(Date, 'now', () => 1_790_000_600_000)
  context.mock.method(os, 'uptime', () => 600)
  let signalQueryStarted: () => void = () => {}
  const queryStarted = new Promise<void>((resolve) => {
    signalQueryStarted = resolve
  })
  let finishQuery: (answer: { stdout: string }) => void = () => {}
  const queryAnswer = new Promise<{ stdout: string }>((resolve) => {
    finishQuery = resolve
  })
  let queries = 0
  const run: BoundedQueryRunner = () => {
    queries += 1
    signalQueryStarted()
    return queryAnswer
  }

  // Act
  const boots = Promise.all([
    readBootIdentity(undefined, { platform: 'darwin', run }),
    readBootIdentity(undefined, { platform: 'darwin', run }),
  ])
  await queryStarted
  finishQuery({ stdout: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14\n' })

  // Assert
  assert.deepEqual(await boots, [
    {
      id: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14',
      startedAtMs: 1_790_000_000_000,
    },
    {
      id: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14',
      startedAtMs: 1_790_000_000_000,
    },
  ])
  assert.equal(queries, 1)
})

// Value: protects=failed queries stay throttled for a full minute after each failure, despite clock corrections or repeated storage reads; fails_when=the delay starts before the query ends, a cached read extends it, wall time controls it or only the first failure can retry; why_new=Cycle 0046 row 1050; seam=runner and clocks
test('on macOS each failed query waits one minute from its end before retrying, regardless of wall-clock corrections', async (context) => {
  // Arrange: each of the first two queries takes three seconds and then fails.
  let elapsedMs = 0
  let wallClockMs = 1_790_000_600_000
  context.mock.method(performance, 'now', () => elapsedMs)
  context.mock.method(Date, 'now', () => wallClockMs)
  context.mock.method(os, 'uptime', () => 600)
  let queries = 0
  const run: BoundedQueryRunner = async () => {
    queries += 1
    // Two failures must each wait the full retry interval.
    if (queries <= 2) {
      elapsedMs += 3_000
      throw new Error('sysctl timed out')
    }
    return { stdout: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14\n' }
  }
  const noBootIdFile = join(tmpdir(), 'codebook-no-such-boot-id')

  // Act
  await readBootIdentity(noBootIdFile, { platform: 'darwin', run })
  wallClockMs = 1_790_004_200_000
  await readBootIdentity(noBootIdFile, { platform: 'darwin', run })
  const afterForwardCorrection = queries
  elapsedMs = 60_000
  await readBootIdentity(noBootIdFile, { platform: 'darwin', run })
  const oneMinuteFromStart = queries
  elapsedMs = 62_999
  await readBootIdentity(noBootIdFile, { platform: 'darwin', run })
  const beforeFirstRetry = queries
  wallClockMs = 1_789_997_000_000
  elapsedMs = 63_000
  await readBootIdentity(noBootIdFile, { platform: 'darwin', run })
  const firstRetry = queries
  elapsedMs = 125_999
  await readBootIdentity(noBootIdFile, { platform: 'darwin', run })
  const beforeSecondRetry = queries
  elapsedMs = 126_000
  const recovered = await readBootIdentity(noBootIdFile, {
    platform: 'darwin',
    run,
  })

  // Assert
  assert.deepEqual(
    {
      afterForwardCorrection,
      oneMinuteFromStart,
      beforeFirstRetry,
      firstRetry,
      beforeSecondRetry,
      queries,
      recovered,
    },
    {
      afterForwardCorrection: 1,
      oneMinuteFromStart: 1,
      beforeFirstRetry: 1,
      firstRetry: 2,
      beforeSecondRetry: 2,
      queries: 3,
      recovered: {
        id: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14',
        startedAtMs: 1_789_996_400_000,
      },
    },
  )
})
