import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { test } from 'node:test'

import { causeRootsFor } from '../utils/causeRootsFor'
import { sanitizeCause } from '../utils/sanitizeCause'

// Value: protects=a path under any opened workspace folder, not only the first, reading <workspace> in a cause; fails_when=causeRootsFor names only one folder, so a failure under the second folder of a multi-root window shows its real path in Output (/ship pass 3 MR, Cycle 0056 pt3); why_new=the Wiki failure recorder passed only workspaceFolders[0]; seam=two real temporary folders; no_claim=the editor's folder order
test('a cause names no path under any opened workspace folder', async () => {
  // Arrange
  const first = await mkdtemp(join(tmpdir(), 'codebook-root-a-'))
  const second = await mkdtemp(join(tmpdir(), 'codebook-root-b-'))

  // Act
  const cause = sanitizeCause(
    `Failed at ${join(second, 'src', 'a.ts')} and ${join(first, 'b.ts')}`,
    causeRootsFor([], [first, second]),
  )

  // Assert
  assert.equal(
    cause,
    `Failed at <workspace>${sep}src${sep}a.ts and <workspace>${sep}b.ts`,
  )
})
