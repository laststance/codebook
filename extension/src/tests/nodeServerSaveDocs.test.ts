import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { NODE_SERVER_HISTORY_REASON_CODES } from '../constants'
import { nodeServerSaveHelp } from '../nodeServerSaveHelp'

/** Reads a file of the extension package; tests run from `dist/tests`. */
const readPackageFile = (...path: string[]): Promise<string> =>
  readFile(join(__dirname, '..', '..', ...path), 'utf8')

// protects=the skill saves a server explanation only on API 1.9 or later (1.10 read as later than 1.9, CodeRabbit pt2 round 3), through codebook_explain_node_history, citing request, stops, output and response, claims saved only on complete coverage and an empty captureMissing, and links the canonical help; fails_when=any of those rules leaves the skill; no_claim=how a chat follows it
test('the bundled skill saves a server explanation only on API 1.9, claims saved on complete coverage, and links the canonical help', async () => {
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
    /check that `codebook_status` reports API 1\.9 or later \(compare the number after the dot as a whole number: 1\.10 is later than 1\.9\); on an older API tell the learner to update Codebook and do not try to save/,
  )
  assert.match(paragraph, /cite the request, every stop you explained/)
  assert.match(
    paragraph,
    /only when the run resource reads `nodeServer\.learningCoverage` `complete` and an empty `nodeServer\.captureMissing`/,
  )
  assert.match(paragraph, /codebook:\/\/help\/node-server/)
  assert.ok(skill.includes('metadata:\n  version: "1.0.60"\n'))
})

// protects=the canonical save help keeps the version check true at API 1.10: an agent comparing 1.10 and 1.9 as decimals would refuse every server save; fails_when=the help's requires line drops the whole-number comparison; no_claim=how a model compares versions
test('the node-server save help says that API 1.10 is later than 1.9', () => {
  // Arrange / Act
  const help = nodeServerSaveHelp()

  // Assert
  assert.equal(
    help.requires,
    'codebook_status reports API 1.9 or later (compare the number after the dot as a whole number: 1.10 is later than 1.9). On an older API, tell the learner to update Codebook and do not try to save a server explanation.',
  )
})

// protects=the skill tells the chat to save every deciding value it named and to save source-read claims as their own source-derived step, with an observed step stating only its cited entry, and to check its chat answer's deciding values against what it saves before saving; fails_when=any of those rules leaves the skill; no_claim=how a chat follows it
test('the bundled skill has saved steps keep every named deciding value and keep source-derived claims out of observed steps', async () => {
  // Arrange / Act
  const skill = await readPackageFile('skills', 'codebook', 'SKILL.md')
  const paragraph = skill
    .split('\n')
    .find((line) => line.startsWith('**Saved steps stand alone.**'))

  // Assert
  assert.ok(paragraph, 'the skill has a Saved steps stand alone paragraph')
  assert.match(
    paragraph,
    /Every value you named in chat as deciding the outcome \(a threshold, a code, an id, a limit\) appears in a saved step or the summary, with where it comes from/,
  )
  assert.match(
    paragraph,
    /rather than from a recorded entry is its own step with evidence `source-derived`/,
  )
  assert.match(
    paragraph,
    /never fold it into an `observed` step\. An `observed` step states only what its cited entry shows/,
  )
  assert.match(
    paragraph,
    /Before you call the save tool, reread your chat answer: each number, code or limit it used to explain why the outcome happened must already be in the summary or a step you are saving; add the missing ones first\./,
  )
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
