import assert from 'node:assert/strict'
import { test } from 'node:test'

import { devinRollbackLeftoverLine } from '../utils/devinRollbackLeftoverLine'
import { effectiveDevinSetupOf } from '../utils/effectiveDevinSetup'

// protects=a rollback that finds the Devin MCP entry edited after setup, or a removal that left files, tells the learner the take-back is incomplete with the path or sentence; fails_when=a changed entry or a removal with cleanupFailure yields no line, so the Output claims a clean take-back; why_new=the window-level rollback test covers only a removal with cleanupFailure, not a changed entry, a file-removed removal or a clean removal; seam=none; no_claim=rollbacks of removals without leftovers beyond returning no line
test('a Devin rollback line names the edited entry or the files a removal left, and stays silent for a clean removal', () => {
  // Arrange
  const changed = {
    status: 'changed',
    path: '/config/mcp_config.json',
  } as const
  const leftover = {
    status: 'file-removed',
    path: '/config/mcp_config.json',
    cleanupFailure: 'delete /storage/devin-mcp/receipt.json by hand.',
  } as const
  const clean = { status: 'removed', path: '/config/mcp_config.json' } as const
  // Act
  const lines = [changed, leftover, clean].map(devinRollbackLeftoverLine)
  // Assert
  assert.deepEqual(lines, [
    'Codebook left the Devin Desktop MCP entry this setup wrote in /config/mcp_config.json: it was edited after setup.',
    'Codebook took back the Devin Desktop MCP entry this setup wrote, but files stayed: delete /storage/devin-mcp/receipt.json by hand.',
    undefined,
  ])
})

// protects=the saved Devin setup a window trusts ignores a provisional value left by a failed run and falls back to the setup before it; fails_when=a provisional workspace counts as the setup outside a running setup, so a crashed setup marks a descriptor; why_new=the provisional fallback was covered only through the window harness, not the nested previous value or an unreadable saved value; seam=none; no_claim=how the run saves values
test('a provisional Devin setup counts only during its own run and otherwise reads as the setup before it', () => {
  // Arrange
  const provisional = {
    workspace: '/new',
    provisional: true,
    previous: { workspace: '/old' },
  }
  const provisionalWithoutPrevious = { workspace: '/new', provisional: true }
  // Act
  const settled = effectiveDevinSetupOf(provisional)
  const during = effectiveDevinSetupOf(provisional, true)
  const orphan = effectiveDevinSetupOf(provisionalWithoutPrevious)
  const garbage = effectiveDevinSetupOf('nope')
  // Assert
  assert.deepEqual(settled, { workspace: '/old' })
  assert.deepEqual(during, { workspace: '/new' })
  assert.equal(orphan, undefined)
  assert.equal(garbage, undefined)
})
