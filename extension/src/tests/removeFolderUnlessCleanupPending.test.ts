import assert from 'node:assert/strict'
import { access, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { LibraryPackageCancelled } from '../libraryPackage'
import { createLibraryBuildError } from '../utils/createLibraryBuildError'
import { removeFolderUnlessCleanupPending } from '../utils/removeFolderUnlessCleanupPending'

/** Makes an empty private folder. */
async function makeFolder(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'codebook-pending-')))
}

/** Tells whether a path still exists. */
async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

// protects=a build error that reports its folder removal pending leaves the folder to that removal; fails_when=the dependencies remove the folder a second time and make the pending report false; no_claim=the build's own removal
test('leaves the folder when the build reported its removal pending', async () => {
  // Arrange
  const stopped = await makeFolder()
  const failed = await makeFolder()
  try {
    // Act
    await removeFolderUnlessCleanupPending(
      stopped,
      new LibraryPackageCancelled('pending'),
    )
    await removeFolderUnlessCleanupPending(
      failed,
      createLibraryBuildError(
        'LIBRARY_BUILD_FAILED',
        'tracked-files-unverified',
        'unverified',
        { cleanup: 'pending' },
      ),
    )

    // Assert
    assert.equal(await exists(stopped), true)
    assert.equal(await exists(failed), true)
  } finally {
    await rm(stopped, { recursive: true, force: true })
    await rm(failed, { recursive: true, force: true })
  }
})

// protects=a refusal before anything was made, or a removed report, still ends with the folder removed; fails_when=the folder of a refused run stays in the temporary folder; no_claim=symlink handling (removeWithoutFollowing tests)
test('removes the folder for a refusal and for a removed report', async () => {
  // Arrange
  const refused = await makeFolder()
  const removed = await makeFolder()

  // Act
  await removeFolderUnlessCleanupPending(
    refused,
    new StudyError('LIBRARY_BUILD_UNSUPPORTED', 'refused'),
  )
  await removeFolderUnlessCleanupPending(
    removed,
    new LibraryPackageCancelled('removed'),
  )

  // Assert
  assert.equal(await exists(refused), false)
  assert.equal(await exists(removed), false)
})
