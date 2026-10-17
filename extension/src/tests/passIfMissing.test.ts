import assert from 'node:assert/strict'
import { lstat, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { passIfMissing } from '../utils/passIfMissing'

// Value: protects=every look of the Cursor setup, the catalog, the recovery of a moved file and the removal walk that answers a path holding nothing as an answer of its own; fails_when=a missing path ends the look with the system's text ("ENOENT: no such file or directory, lstat …"), or an entry that stands there is answered as missing; why_new=Cycle 0046 /ship review S3: four modules had a helper of their own for this, now one; seam=none, the real file system
test('a look at a path that holds nothing answers undefined, and a look at an entry answers what stands there', async (context) => {
  // Arrange
  const folder = await mkdtemp(join(tmpdir(), 'codebook-pass-if-missing-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  await writeFile(join(folder, 'present.txt'), 'x')

  // Act
  const missing = await lstat(join(folder, 'missing.txt')).catch(passIfMissing)
  const present = await lstat(join(folder, 'present.txt')).catch(passIfMissing)

  // Assert
  assert.deepEqual(
    { missing, isPresentAFile: present?.isFile() },
    { missing: undefined, isPresentAFile: true },
  )
})

// Value: protects=a look that this user may not make, or that the system refuses for another reason, is reported as it is and not taken for a path that holds nothing (where a setup would then create a file, or a removal call a file gone); fails_when=every failure of the look is answered as missing; why_new=Cycle 0046 /ship review S3; seam=none, the system's errors as the file system throws them
test('every failure of a look but a missing path is passed on as the system’s own error', () => {
  // Arrange
  const refusedLook = Object.assign(
    new Error("EACCES: permission denied, lstat '/root/secret'"),
    { code: 'EACCES' },
  )
  const failureWithoutCode = new Error('the disk failed')

  // Act
  const thrownForRefusedLook = (() => {
    try {
      return passIfMissing(refusedLook)
    } catch (error) {
      return error
    }
  })()
  const thrownForFailureWithoutCode = (() => {
    try {
      return passIfMissing(failureWithoutCode)
    } catch (error) {
      return error
    }
  })()

  // Assert
  assert.equal(thrownForRefusedLook, refusedLook)
  assert.equal(thrownForFailureWithoutCode, failureWithoutCode)
})
