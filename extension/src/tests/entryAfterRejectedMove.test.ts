import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { entryAfterRejectedMove } from '../utils/entryAfterRejectedMove'

// Value: protects=a removal whose look at a path before its move failed, and whose mover then rejected while an entry stands at the path: whether that entry is the one that was to move is not known, so the removal says so instead of claiming the Trash's refusal or a move; fails_when=an entry at the path without a look before the move counts as the same entry still in place (the Trash's refusal, "Nothing was deleted") or as gone (TT44, AD10); why_new=Cycle 0046 third testing review TT44: entryAfterRejectedMove had no unit test, and no test made the look before the move fail; seam=none (a real file, and no look before the move)
test('an entry at the path after a rejected move whose look before the move failed is of unknown state, and names why', async (context) => {
  // Arrange: a file stands at the path; the look before the move gave nothing.
  const folder = await mkdtemp(join(tmpdir(), 'codebook-rejected-move-'))
  context.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'study.v3.json')
  await writeFile(path, '{}')

  // Act
  const entry = await entryAfterRejectedMove(path, undefined)

  // Assert
  assert.deepEqual(entry, {
    kind: 'unknown',
    cause: 'the look before the move failed',
  })
})
