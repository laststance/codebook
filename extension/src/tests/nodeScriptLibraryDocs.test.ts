import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  LIBRARY_BUILD_FAILED_REASONS,
  LIBRARY_BUILD_UNSUPPORTED_REASONS,
} from '../constants'
import { nodeScriptConfigSchema } from '../nodeScriptConfigSchemas'
import { nodeScriptHelp } from '../nodeScriptHelp'

/**
 * Reads a file of the extension package by its path below the extension folder.
 * @param relativePath - Path below the extension folder.
 * @returns The file text.
 * @example await readPackaged('README.md') // => '# codebook …'
 */
function readPackaged(relativePath: string): Promise<string> {
  return readFile(join(__dirname, '../..', relativePath), 'utf8')
}

// protects=the library help sample is a declaration the live schema accepts once its placeholders are filled, with generic names; fails_when=the sample drifts from nodeScriptConfigSchema or copies a project's names; no_claim=that a run with it succeeds
test('the library help sample parses with the live node-script schema', () => {
  // Arrange
  const { sample } = nodeScriptHelp().library
  // Act
  const parsed = nodeScriptConfigSchema.parse({
    ...sample.configuration,
    book: { bookId: 'widgets', revision: 1, nodeId: 'widgets', anchorIndex: 0 },
    source: {
      path: 'examples/publish-ci/node/checks.cjs',
      hash: 'a'.repeat(64),
      line: 20,
      column: 3,
    },
  })
  // Assert
  assert.deepEqual(parsed.library, { packageRoot: 'packages/widgets' })
  assert.equal(/redux|toolkit/i.test(JSON.stringify(sample)), false)
})

// protects=the help's library section states when to use it, the confirmation, the build and pack with what they write, the building phase, the observation states, the refusals, every limit and the API 1.33 gate; fails_when=any of those leaves the section or a refusal reason is not listed; no_claim=the behavior itself, which the library tests cover
test('the library help section states the route, its observation states, refusals and limits', () => {
  // Arrange
  const { library } = nodeScriptHelp()
  const text = JSON.stringify(library)
  // Act / Assert
  for (const phrase of [
    'codebook_status reports API 1.33 or later',
    'depends on that library by a published version',
    'repositoryPackageCopies',
    'correspondence unverified',
    'confirmation comes first',
    "runs the project's own build scripts",
    "library's ignored build output",
    'Building <name> for the Example',
    'publishedCopyLoaded',
    'built but not loaded by this script',
    'not fully observed',
    'never retry tracked-file-changed',
    'Ignored inputs',
    'repository lockfile',
    '5.1.1 against 5.2.0',
    'Overlapping builds',
    'Content scripts do not apply',
    'Yarn and Bun',
  ])
    assert.ok(text.includes(phrase), phrase)
  for (const reason of [
    ...LIBRARY_BUILD_UNSUPPORTED_REASONS,
    ...LIBRARY_BUILD_FAILED_REASONS,
  ])
    assert.ok(text.includes(reason), reason)
})

// protects=the bundled skill 1.0.82 tells the chat to declare library.packageRoot behind the API 1.33 gate, to say the build runs the project's own scripts, and to call a copy without library unverified; fails_when=a sentence or the version leaves the skill or a project name enters it; no_claim=how a chat follows it
test('the bundled skill 1.0.82 routes a library Example to library.packageRoot behind the API 1.33 gate', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.82"\n'))
  for (const phrase of [
    'declare `library.packageRoot` so the Example runs the checked-out library',
    'only when `codebook_status` reports API 1.33 or later',
    "the build runs the project's own build scripts",
    '`library.loaded` true and `library.publishedCopyLoaded` false',
    'an installed copy whose correspondence to the checked-out source is unverified',
    '`repositoryPackageCopies`',
  ])
    assert.ok(skill.includes(phrase), phrase)
})

// protects=the README carries a sentence for each behavior the library change names: the field, build and pack, confirmation, building phase, facts and states, refusals, limits, repositoryPackageCopies, the replay correspondence line and the Cursor skill update; fails_when=a sentence leaves the README; no_claim=native behavior
test('the README documents the library route, its facts, refusals, limits and disclosure', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act / Assert
  for (const phrase of [
    '**Run on the checked-out library (MCP API 1.33).**',
    '`library: { packageRoot }`',
    'Codebook builds and packs the library before the script starts',
    '`Building <name> for the Example…`',
    '`publishedCopyLoaded`',
    'built but not loaded by this script',
    '`LIBRARY_BUILD_UNSUPPORTED`',
    '`LIBRARY_BUILD_FAILED`',
    'two windows building the same library at once are not prevented',
    'Yarn and Bun are not supported',
    '`repositoryPackageCopies`',
    '`Ran on the checked-out <name> <version> built from <revision>',
    'Since skill 1.0.82',
    "so Cursor's managed skill updates to **1.0.82**",
  ])
    assert.ok(readme.includes(phrase), phrase)
})
