import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { z } from 'zod'

import { readRecordedOwner } from '../utils/readRecordedOwner'
import { withStorageLock } from '../utils/withStorageLock'

/** The owner record as 0.2.29.0 reads it: its schema, copied from that release (`utils/readRecordedOwner.ts`), which knows neither digests nor a process start. */
const ownerSchemaOfRelease0229 = z.object({
  pid: z.number().int().positive(),
  hostname: z.string().optional(),
  machineId: z.string().min(1).optional(),
  boot: z
    .union([
      z.object({ id: z.string().min(1) }),
      z.object({ startedAtMs: z.number() }),
    ])
    .optional(),
})

/** Creates an empty storage directory that is removed with the test. @example const directory = await storageDirectory(context) */
async function storageDirectory(context: TestContext): Promise<string> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-recorded-owner-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

// Value: protects=windows of 0.2.29.0 and of this build sharing one storage directory: the older window still reads who holds the lock and judges it by pid, machine and boot; fails_when=a field of the old shape is renamed, dropped or changes its type, so the older window cannot read the lock and never takes over a stale one, or takes a live one for another machine's; why_new=the compatibility had no test (Cycle 0046 row 9, ER-13); seam=none (the lock this build writes, read with the schema of the release)
test('a lock this build writes is read by the 0.2.29.0 schema without losing pid, host name, machine id or boot', async (context) => {
  // Arrange: this build takes the storage lock as a window on macOS or Windows does, with every field it records.
  const directory = await storageDirectory(context)
  let lockText = ''
  await withStorageLock(
    directory,
    async () => {
      lockText = await readFile(join(directory, 'writer.lock'), 'utf8')
    },
    {
      hostname: 'workstation',
      machineId: 'machine-a',
      machineKey: 'f9c8c7ddcf3d5f56',
      hostKey: 'd195d36bd79da7df',
      boot: { startedAtMs: 1_790_000_000_000 },
      processStart: 'win:2026-10-05T09:12:33.1234567Z',
    },
  )
  // Act
  const readByTheRelease = ownerSchemaOfRelease0229.safeParse(
    JSON.parse(lockText),
  )
  // Assert
  assert.equal(
    lockText,
    `{"pid":${process.pid},"hostname":"workstation","machineId":"machine-a","machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"startedAtMs":1790000000000},"processStart":"win:2026-10-05T09:12:33.1234567Z"}`,
  )
  assert.deepEqual(readByTheRelease, {
    success: true,
    data: {
      pid: process.pid,
      hostname: 'workstation',
      machineId: 'machine-a',
      boot: { startedAtMs: 1_790_000_000_000 },
    },
  })
})

// Value: protects=this build reading what a window of 0.2.29.0 and a window of this build left: the start and the digests when they are there, and a record without them as before; fails_when=the new fields are not read, so no lock is ever judged by its owner's start, or a record without them is refused; why_new=the record gained fields in Cycle 0046 (ER-2, ER-3); seam=none
test('a record with the process start and the digests is read with them, and a record of 0.2.29.0 is read without', async (context) => {
  // Arrange
  const directory = await storageDirectory(context)
  const ofThisBuild = join(directory, 'of-this-build.lock'),
    ofRelease0229 = join(directory, 'of-0.2.29.0.lock')
  await writeFile(
    ofThisBuild,
    '{"pid":4242,"hostname":"workstation","machineId":"machine-a","machineKey":"f9c8c7ddcf3d5f56","hostKey":"d195d36bd79da7df","boot":{"id":"boot-1"},"processStart":"linux:16362446"}',
  )
  await writeFile(
    ofRelease0229,
    '{"pid":4242,"hostname":"workstation","machineId":"machine-a","boot":{"id":"boot-1"}}',
  )
  // Act
  const ownerOfThisBuild = await readRecordedOwner(ofThisBuild),
    ownerOfRelease0229 = await readRecordedOwner(ofRelease0229)
  // Assert
  assert.deepEqual(ownerOfThisBuild, {
    pid: 4242,
    hostname: 'workstation',
    machineId: 'machine-a',
    machineKey: 'f9c8c7ddcf3d5f56',
    hostKey: 'd195d36bd79da7df',
    boot: { id: 'boot-1' },
    processStart: 'linux:16362446',
  })
  assert.deepEqual(ownerOfRelease0229, {
    pid: 4242,
    hostname: 'workstation',
    machineId: 'machine-a',
    boot: { id: 'boot-1' },
  })
})
