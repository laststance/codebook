import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cursorRemovalNotice } from '../utils/cursorRemovalNotice'

// Value: protects=the learner reading what Remove Managed Cursor Skill did; fails_when=a second removal, which only went on to the Cursor MCP config, says "Managed Cursor skill removed" as if it had removed the skill, a notice calls a config preserved where none stands (it was already retired, or Codebook owns none), or a removal without a receipt of the skill says that a skill was removed; why_new=Cycle 0046 rows 222, 244 and 246; seam=none
test('the notice of a finished Cursor removal says whether the skill was removed now, already, or never found as Codebook’s, and of the config that it was retired, was preserved, was already retired or was never Codebook’s', () => {
  // Arrange: this removal took the skill away, an earlier one had, or no receipt names a skill; the config was Codebook's empty one, was changed, had been retired before, or was never Codebook's.
  const outcomes = [
    ['removed', 'removed'],
    ['removed', 'preserved'],
    ['already-removed', 'removed'],
    ['already-removed', 'preserved'],
    ['already-removed', 'already-retired'],
    ['removed', 'not-owned'],
    ['not-installed', 'removed'],
    ['not-installed', 'preserved'],
  ] as const

  // Act
  const notices = outcomes.map(([skillRemoval, catalogCleanup]) =>
    cursorRemovalNotice(skillRemoval, catalogCleanup),
  )

  // Assert
  assert.deepEqual(notices, [
    'Managed Cursor skill removed; Codebook-owned empty MCP catalog config retired. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
    'Managed Cursor skill removed. Existing or changed Cursor MCP config preserved. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
    'The managed Cursor skill was already removed; Codebook-owned empty MCP catalog config retired. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
    'The managed Cursor skill was already removed. Existing or changed Cursor MCP config preserved. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
    "The managed Cursor skill was already removed. Codebook's empty Cursor MCP config was already retired; no config was changed. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.",
    'Managed Cursor skill removed. Codebook owns no Cursor MCP config; none was changed. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
    'No Codebook-owned Cursor skill was found; Codebook-owned empty MCP catalog config retired. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
    'No Codebook-owned Cursor skill was found. Existing or changed Cursor MCP config preserved. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
  ])
})

// Value: protects=a learner who runs Remove Managed Cursor Skill where Cursor chat was never set up; fails_when=the notice speaks of a skill or a config as if one had been there, or points to a restore of something that was never installed; why_new=Cycle 0046 row 244: a removal without a receipt is no error any more; seam=none
test('the notice of a Cursor removal that found neither a skill nor a config of Codebook’s says that nothing was there to remove and that no file was changed', () => {
  // Arrange
  const skillRemoval = 'not-installed',
    catalogCleanup = 'not-owned'

  // Act
  const notice = cursorRemovalNotice(skillRemoval, catalogCleanup)

  // Assert
  assert.equal(
    notice,
    'Nothing to remove: no Codebook-owned Cursor skill was found and Codebook owns no Cursor MCP config. No file was changed.',
  )
})
