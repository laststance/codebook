import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { NODE_SERVER_HISTORY_REASON_CODES } from '../constants'

/** Reads a file of the extension package; tests run from `dist/tests`. */
const readPackageFile = (...path: string[]): Promise<string> =>
  readFile(join(__dirname, '..', '..', ...path), 'utf8')

// protects=the skill saves a server explanation only on API 1.9 or later, through codebook_explain_node_history, citing request, stops, output and response, claims saved only on complete coverage and an empty captureMissing, and links the canonical help; fails_when=any of those rules leaves the skill; no_claim=how a chat follows it
test('the bundled skill 1.0.53 saves a server explanation only on API 1.9, claims saved on complete coverage, and links the canonical help', async () => {
  // Arrange / Act
  const skill = await readPackageFile('skills', 'codebook', 'SKILL.md')
  const paragraph = skill
    .split('\n')
    .find((line) => line.startsWith('**Saving a server run.**'))

  // Assert
  assert.ok(paragraph, 'the skill has a Saving a server run paragraph')
  assert.match(paragraph, /codebook_explain_node_history/)
  assert.match(
    paragraph,
    /check that `codebook_status` reports API 1\.9 or later; on an older API tell the learner to update Codebook and do not try to save/,
  )
  assert.match(paragraph, /cite the request, every stop you explained/)
  assert.match(
    paragraph,
    /only when the run resource reads `nodeServer\.learningCoverage` `complete` and an empty `nodeServer\.captureMissing`/,
  )
  assert.match(paragraph, /codebook:\/\/help\/node-server/)
  assert.ok(skill.includes('metadata:\n  version: "1.0.53"\n'))
})

// protects=the packaged README states what a Server replay is, that it stores the executed source as it ran (private, secret-named values masked, source literals unchanged), the Save texts, and a troubleshooting row for every captureMissing code; fails_when=a sentence or a code is missing; no_claim=the table's wording
test('the packaged README documents the Server replay, the stored source and every captureMissing code', async () => {
  // Arrange / Act
  const readme = await readPackageFile('README.md')

  // Assert
  assert.match(
    readme,
    /- \*\*Server replay\*\*: the learning replay of a server run/,
  )
  assert.match(
    readme,
    /the executed source text is stored as it ran, privately in the workspace's learning storage; secret-named values and secret-shaped text are masked and a secret written as a literal in your source is not rewritten/,
  )
  assert.match(readme, /`codebook:\/\/help\/node-server` \(section `save`\)/)
  assert.match(
    readme,
    /Saving stops the server run \(<n> of <m> stops recorded; no response recorded yet/,
  )
  for (const code of Object.values(NODE_SERVER_HISTORY_REASON_CODES))
    assert.ok(readme.includes(`| \`${code}\` |`), `README row for ${code}`)
})
