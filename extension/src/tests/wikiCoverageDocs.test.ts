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

/** The packaged README, the learner's documentation; tests run from `dist/tests`. */
const readPackagedReadme = (): Promise<string> =>
  readFile(join(__dirname, '..', '..', 'README.md'), 'utf8')

// Value: protects=the Wiki route tells the chat AI that every included code file needs a citation or a coverageExceptions entry with its reason, before the renderer refuses it; fails_when=skill 1.0.88 loses the coverage sentence and the chat learns of the rule only from a refusal it may answer by excepting application modules (C113-W1); why_new=skill 1.0.87 never asked for coverage, and a 6-page Wiki citing 32 of 71 sources published; seam=none; no_claim=how thoroughly a chat model explains each file
test('the bundled skill 1.0.88 asks the Wiki generator to cite every included code file or name it as an exception with a reason', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()

  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.88"\n'))
  assert.ok(
    skill.includes(
      'Every included code file must be cited by a page `sources` list, a diagram node or edge, or an inline editor source link, or be listed under optional `coverageExceptions`',
    ),
  )
  assert.ok(
    skill.includes('never for an application module a learner would read.'),
  )
})

// Value: protects=the learner's README names the coverage rule the generator enforces; fails_when=the README says nothing about a refused Wiki that leaves code unexplained (C113-W1); why_new=the renderer gained the refusal in Cycle 0113; seam=none; no_claim=the refusal's exact wording
test('the README says the generator refuses a Wiki that leaves an included code file unexplained', async () => {
  // Arrange / Act
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    readme.includes(
      'The generator refuses to publish a Wiki that leaves an included code file unexplained, unless that file is listed as needing no explanation, with the reason.',
    ),
  )
})
