import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readBootIdentity } from '../utils/readBootIdentity'
import type { BoundedQueryRunner } from '../utils/runBoundedQuery'

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
  // Arrange: no boot id file; the clock reads 1 790 000 600 000 ms and the machine has been up for 600 s.
  context.mock.method(Date, 'now', () => 1_790_000_600_000)
  context.mock.method(os, 'uptime', () => 600)
  // Act
  const boot = await readBootIdentity(
    join(tmpdir(), 'codebook-no-such-boot-id'),
  )
  // Assert
  assert.deepEqual(boot, { startedAtMs: 1_790_000_000_000 })
})

// Value: protects=on macOS a storage owner's boot is named by the boot session's id, which no clock moves and which tells two computers apart, so only an exact boot proves one machine and a Mac's host-name change within one boot keeps its locks, markers and recordings judged by process; fails_when=macOS records only the computed boot time, which two computers that started within one minute share (S4), the query runs by a bare name or unbounded, or it runs again for every owner a window records or judges; why_new=Cycle 0046 third review S4; seam=the system and the runner of the query, with the clock and the uptime
test('on macOS the boot is the boot session’s id beside the computed boot time, asked once of sysctl by its full path within the bounds of a process start query', async (context) => {
  // Arrange: no kernel boot id; the clock reads 1 790 000 600 000 ms, the machine has been up for 600 s, and sysctl prints a session id.
  context.mock.method(Date, 'now', () => 1_790_000_600_000)
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
        startedAtMs: 1_790_000_000_000,
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
