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

// Value: protects=the Wiki route tells the chat AI the depth floors the renderer enforces (child pages, pages per file, a diagram on every page, text per page and per file with CJK counted twice) and the learner's README says the generator refuses a thin Wiki; fails_when=the skill or the README loses the depth sentence and a flat 7-page Wiki with one diagram is published (C113-W3); why_new=the renderer gained the depth refusal in Cycle 0113; seam=none; no_claim=how deep a chat model's articles really are
test('the skill and the README say a Wiki too thin for its code is refused: no child pages, too few diagrams or too little explanation', async () => {
  // Arrange / Act
  const skill = await readBundledSkill()
  const readme = await readPackagedReadme()

  // Assert
  assert.ok(
    skill.includes(
      'at least 2 pages with a `parent`, at least one page per 8 explained code files, a diagram on every page and about three diagrams per two pages in total (architecture, flow or sequence, each with source-backed nodes and edges), and at least 1,200 characters of article text on every page and 500 per explained code file in total, CJK characters counted twice. These are floors, not targets: DeepWiki itself typically gives each page several diagrams and 2,500–7,000 characters, so aim above them.',
    ),
  )
  assert.ok(
    readme.includes(
      'It also refuses a Wiki whose chapters are too thin for the code it covers: no child pages, too few diagrams, or too little explanation.',
    ),
  )
})
