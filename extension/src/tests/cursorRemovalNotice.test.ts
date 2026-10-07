import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cursorRemovalNotice } from '../utils/cursorRemovalNotice'

// Value: protects=the learner reading what Remove Managed Cursor Skill did; fails_when=a second removal, which only went on to the Cursor MCP config, says "Managed Cursor skill removed" as if it had removed the skill, or a notice does not say what became of the config and why; why_new=Cycle 0046 row 222; seam=none
test('the notice of a finished Cursor removal says whether the skill was removed now or already, and that the config Codebook created was retired or that an existing or changed config was preserved', () => {
  // Arrange: this removal took the skill away, or an earlier one had; the config was Codebook's empty one, was changed, or was never Codebook's.
  const outcomes = [
    [false, 'removed'],
    [false, 'preserved'],
    [true, 'removed'],
    [true, 'not-owned'],
  ] as const

  // Act
  const notices = outcomes.map(([wasSkillAlreadyRemoved, catalogCleanup]) =>
    cursorRemovalNotice(wasSkillAlreadyRemoved, catalogCleanup),
  )

  // Assert
  assert.deepEqual(notices, [
    'Managed Cursor skill removed; Codebook-owned empty MCP catalog config retired. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
    'Managed Cursor skill removed. Existing or changed Cursor MCP config preserved. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
    'The managed Cursor skill was already removed; Codebook-owned empty MCP catalog config retired. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
    'The managed Cursor skill was already removed. Existing or changed Cursor MCP config preserved. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
  ])
})
