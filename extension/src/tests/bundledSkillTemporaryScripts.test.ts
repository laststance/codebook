import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

/** The skill the extension ships and Cursor's setup copies; tests run from `dist/tests`. */
const readBundledSkill = (): Promise<string> =>
  readFile(
    join(__dirname, '..', '..', 'skills', 'codebook', 'SKILL.md'),
    'utf8',
  )

test('the bundled skill puts a Wiki run’s temporary scripts into the hidden .codebook/scratch folder inside the workspace, so the editor chat asks for no approval of a path outside it', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.ok(
    skill.includes(
      "write a temporary script into the project's hidden `.codebook/scratch/` folder (inside the workspace, never indexed by the Wiki, so the editor asks for no approval of a path outside it), invoke its interpreter explicitly, including read-only scans, and remove that folder once the Wiki is published. Never write a temporary script into project source or outside the workspace.",
    ),
  )
})

test('the bundled skill no longer sends temporary scripts outside project source, which made the editor chat ask for an approval at every edit and read of one', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.equal(
    skill.includes('write a temporary script outside project source'),
    false,
  )
})
