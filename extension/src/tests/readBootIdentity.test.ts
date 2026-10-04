import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readBootIdentity } from '../utils/readBootIdentity'

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
