import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cursorRemovalNotice } from '../utils/cursorRemovalNotice'

// Value: protects=the learner reading what Remove Managed Cursor Skill did; fails_when=a second removal, which only went on to the Cursor MCP config, says "Managed Cursor skill removed" as if it had removed the skill, or a notice calls a config preserved where none stands (it was already retired, or Codebook owns none); why_new=Cycle 0046 rows 222 and 246; seam=none
test('the notice of a finished Cursor removal says whether the skill was removed now or already, and of the config that it was retired, was preserved, was already retired or was never Codebook’s', () => {
  // Arrange: this removal took the skill away, or an earlier one had; the config was Codebook's empty one, was changed, had been retired before, or was never Codebook's.
  const outcomes = [
    [false, 'removed'],
    [false, 'preserved'],
    [true, 'removed'],
    [true, 'preserved'],
    [true, 'already-retired'],
    [false, 'not-owned'],
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
    "The managed Cursor skill was already removed. Codebook's empty Cursor MCP config was already retired; no config was changed. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.",
    'Managed Cursor skill removed. Codebook owns no Cursor MCP config; none was changed. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
  ])
})
