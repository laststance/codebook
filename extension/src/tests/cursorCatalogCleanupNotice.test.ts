import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cursorCatalogCleanupNotice } from '../utils/cursorCatalogCleanupNotice'

// Value: protects=the learner who removed the Cursor skill while Codebook could not retire its empty Cursor MCP config; fails_when=the warning hides the refusal's own next step behind advice that is no longer true ("inspect the private recovery record, restore setup, then retry removal": restoring setup installs again the skill that was just removed); why_new=Cycle 0046 row 213: since rows 188 and 212 the catalog's refusals say what to do themselves; seam=none
test('the warning after a removal whose Cursor MCP config cleanup was refused leads with the refusal’s own sentence and then says only what is true: the skill is removed, the config stays, nothing unverified was deleted, and the same command goes on with the config', () => {
  // Arrange: the refusal of a record that is kept, as the catalog words it.
  const refusal = new Error(
    'Cursor MCP catalog changed during interrupted cleanup; Codebook preserved the config and recovery record. The file Codebook had moved away is kept as /storage/cursor-mcp-catalog/retired-1.mcp.json. To start over, delete /storage/cursor-mcp-catalog/pending-removal.json, then run Codebook: Set Up AI Chat again.',
  )

  // Act
  const notice = cursorCatalogCleanupNotice(refusal, 'removed')

  // Assert
  assert.equal(
    notice,
    'Cursor MCP catalog changed during interrupted cleanup; Codebook preserved the config and recovery record. The file Codebook had moved away is kept as /storage/cursor-mcp-catalog/retired-1.mcp.json. To start over, delete /storage/cursor-mcp-catalog/pending-removal.json, then run Codebook: Set Up AI Chat again. The managed Cursor skill itself was removed; Codebook left the Cursor MCP config in place and deleted no unverified file. When the cause above is resolved, run Codebook: Remove Managed Cursor Skill again: it goes on with the config.',
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
  const notice = cursorCatalogCleanupNotice(refusal, 'removed')

  // Assert
  assert.equal(
    notice,
    "EACCES: permission denied, rename '/home/user/.cursor/mcp.json'. The managed Cursor skill itself was removed; Codebook left the Cursor MCP config in place and deleted no unverified file. When the cause above is resolved, run Codebook: Remove Managed Cursor Skill again: it goes on with the config.",
  )
})

// Value: protects=the learner whose second removal, which only went on to the Cursor MCP config, is refused again; fails_when=the warning says the skill "itself was removed" by this removal, although an earlier one had taken it away; why_new=Cycle 0046 row 222: a second removal goes on to the config; seam=none
test('the warning after a second removal whose Cursor MCP config cleanup was refused again says that the skill was already removed', () => {
  // Arrange
  const refusal = new Error(
    'Learning storage is locked by another writer or an interrupted session (lock file: /storage/cursor-mcp-catalog/writer.lock). No data changed; retry after resolving the lock.',
  )

  // Act
  const notice = cursorCatalogCleanupNotice(refusal, 'already-removed')

  // Assert
  assert.equal(
    notice,
    'Learning storage is locked by another writer or an interrupted session (lock file: /storage/cursor-mcp-catalog/writer.lock). No data changed; retry after resolving the lock. The managed Cursor skill was already removed; Codebook left the Cursor MCP config in place and deleted no unverified file. When the cause above is resolved, run Codebook: Remove Managed Cursor Skill again: it goes on with the config.',
  )
})

// Value: protects=the learner whose removal found no skill of Codebook's (the receipt was deleted as an invalid record's sentence says) and whose Cursor MCP config cleanup was then refused; fails_when=the warning says a skill was removed that this removal never found; why_new=Cycle 0046 row 244: a removal without a receipt goes on to the config; seam=none
test('the warning after a removal that found no Codebook-owned skill and whose Cursor MCP config cleanup was refused says that no skill was found', () => {
  // Arrange
  const refusal = new Error(
    'Cursor MCP directory is not a regular directory; Codebook left its settings unchanged.',
  )

  // Act
  const notice = cursorCatalogCleanupNotice(refusal, 'not-installed')

  // Assert
  assert.equal(
    notice,
    'Cursor MCP directory is not a regular directory; Codebook left its settings unchanged. No Codebook-owned Cursor skill was found; Codebook left the Cursor MCP config in place and deleted no unverified file. When the cause above is resolved, run Codebook: Remove Managed Cursor Skill again: it goes on with the config.',
  )
})
