import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cursorCatalogCleanupNotice } from '../utils/cursorCatalogCleanupNotice'

// Value: protects=the learner who removed the Cursor skill while Codebook could not retire its empty Cursor MCP config; fails_when=the warning hides the refusal's own next step behind advice that is no longer true ("inspect the private recovery record, restore setup, then retry removal": restoring setup installs again the skill that was just removed); why_new=Cycle 0046 row 213: since rows 188 and 212 the catalog's refusals say what to do themselves; seam=none
test('the warning after a removal whose Cursor MCP config cleanup was refused leads with the refusal’s own sentence and then says only what is true: the skill is removed, the config stays, nothing unverified was deleted', () => {
  // Arrange: the refusal of a record that is kept, as the catalog words it.
  const refusal = new Error(
    'Cursor MCP catalog changed during interrupted cleanup; Codebook preserved the config and recovery record. The file Codebook had moved away is kept as /storage/cursor-mcp-catalog/retired-1.mcp.json. To start over, delete /storage/cursor-mcp-catalog/pending-removal.json, then run Codebook: Set Up AI Chat again.',
  )

  // Act
  const notice = cursorCatalogCleanupNotice(refusal)

  // Assert
  assert.equal(
    notice,
    'Cursor MCP catalog changed during interrupted cleanup; Codebook preserved the config and recovery record. The file Codebook had moved away is kept as /storage/cursor-mcp-catalog/retired-1.mcp.json. To start over, delete /storage/cursor-mcp-catalog/pending-removal.json, then run Codebook: Set Up AI Chat again. The managed Cursor skill itself was removed; Codebook left the Cursor MCP config in place and deleted no unverified file.',
  )
})

// Value: protects=the same warning for a refusal that is a file system error, which ends without a full stop; fails_when=the two sentences run into each other, or the error is shown with the prefix "Error:"; why_new=Cycle 0046 row 213; seam=none
test('the warning after a removal whose Cursor MCP config cleanup failed with a file system error ends that error with a full stop before it goes on', () => {
  // Arrange
  const refusal = Object.assign(
    new Error(
      "EACCES: permission denied, rename '/home/user/.cursor/mcp.json'",
    ),
    { code: 'EACCES' },
  )

  // Act
  const notice = cursorCatalogCleanupNotice(refusal)

  // Assert
  assert.equal(
    notice,
    "EACCES: permission denied, rename '/home/user/.cursor/mcp.json'. The managed Cursor skill itself was removed; Codebook left the Cursor MCP config in place and deleted no unverified file.",
  )
})
