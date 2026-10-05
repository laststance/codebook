import assert from 'node:assert/strict'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { modifiedAtMsOf } from '../utils/modifiedAtMsOf'

// Value: protects=the age of a Wiki update marker and the stamp a publication identity is kept under, which are read from a status with exact numbers since the inode number must be exact; fails_when=the time is cut to whole milliseconds, or converted from nanoseconds in one step, which loses up to 128 ns of today's dates; why_new=Cycle 0046 row 79: the reader of Wiki metadata reads its status as bigint; seam=none
test('the modification time of a status read with exact numbers is given in milliseconds with the nanoseconds as its fraction', () => {
  // Arrange: 2026-09-21T14:13:20.123456789Z in nanoseconds.
  const status = { mtimeNs: 1_790_000_000_123_456_789n }

  // Act
  const modifiedAtMs = modifiedAtMsOf(status)

  // Assert
  assert.equal(modifiedAtMs, 1_790_000_000_123.4568)
})

// Value: protects=every caller that compares the time of a file read through the reader of Wiki metadata with the time of a status read without bigint (the candidate listing does); fails_when=the two differ in their last digits for a file written just now; why_new=Cycle 0046 row 79; seam=none
test('the modification time of a file written just now is the same number a status read without exact numbers holds', async () => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-modified-at-'))
  const filePath = join(folder, 'written-just-now')
  await writeFile(filePath, 'x')
  try {
    // Act
    const fromExactNumbers = modifiedAtMsOf(
      await stat(filePath, { bigint: true }),
    )

    // Assert
    assert.equal(fromExactNumbers, (await stat(filePath)).mtimeMs)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
