import assert from 'node:assert/strict'
import * as fileSystem from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'

import type * as CreateLinkIfAllowedModule from './utils/createLinkIfAllowed'
import { LINK_NOT_ALLOWED } from './utils/createLinkIfAllowed'
import { loadModule } from './utils/loadModule'

/**
 * Loads the link helper of the tests with a `symlink` that the system refuses with one error code.
 * @param code - The code of the refusal, as Windows answers `EPERM` to a user without the right to create a link.
 * @returns The loaded `createLinkIfAllowed`.
 */
async function loadHelperWhoseLinkIsRefusedWith(
  code: string,
): Promise<typeof CreateLinkIfAllowedModule.createLinkIfAllowed> {
  const loaded = await loadModule<typeof CreateLinkIfAllowedModule>(
    resolve(__dirname, './utils/createLinkIfAllowed.js'),
    {
      'node:fs/promises': {
        ...fileSystem,
        symlink: async () => {
          throw Object.assign(new Error(`${code}: operation not permitted`), {
            code,
          })
        },
      },
    },
    // The helper tells the refusal by `instanceof Error`, in this realm.
    { Error },
  )
  return loaded.createLinkIfAllowed
}

// Value: protects=the link cases of the Windows job (the Wiki update marker, the reader of Wiki metadata, the opener, the file hash, the Cursor MCP catalog), which run where a link can be created and say so where it cannot; fails_when=a refused creation fails the test (a Windows user without the right sees red tests) or the case is skipped without a reason; why_new=Cycle 0046 row 80: the marker's link case skipped on every Windows; seam=node:fs/promises symlink of the loaded helper
test('a test of a link learns that this user may not create one when the system refuses the creation with EPERM, and skips with a reason that says so', async () => {
  // Arrange
  const createLinkRefusedForAMissingRight =
    await loadHelperWhoseLinkIsRefusedWith('EPERM')

  // Act
  const isLinkCreated = await createLinkRefusedForAMissingRight(
    'a-target',
    'a-link',
  )

  // Assert
  assert.deepEqual(
    { isLinkCreated, reasonOfTheSkip: LINK_NOT_ALLOWED },
    {
      isLinkCreated: false,
      reasonOfTheSkip:
        'creating a symbolic link was refused with EPERM: this user lacks the right (on Windows: no administrator and no developer mode)',
    },
  )
})

// Value: protects=the link cases from passing as skipped when the creation fails for a reason that is a defect of the test or the system; fails_when=every refusal of a creation counts as a missing right; why_new=Cycle 0046 row 80; seam=node:fs/promises symlink of the loaded helper
test('a test of a link fails with the system’s error when the creation is refused for another reason than a missing right', async () => {
  // Arrange
  const createLinkRefusedBecauseThePathIsTaken =
    await loadHelperWhoseLinkIsRefusedWith('EEXIST')

  // Act
  const creation = createLinkRefusedBecauseThePathIsTaken('a-target', 'a-link')

  // Assert
  await assert.rejects(creation, { code: 'EEXIST' })
})
