import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  LIBRARY_BUILD_FAILED_REASONS,
  NODE_SCRIPT_LIBRARY_UNSUPPORTED_REASONS,
  LIBRARY_PACK_ERROR_STEPS,
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

// pregate-literal: API_VERSION=1.33 the node-script library route's minimum API, which stays 1.33 after the current API moved on
// protects=the help's library section states when to use it, the confirmation, the build and pack with what they write, the building phase, the observation states, the refusals, every limit and the API 1.33 gate; fails_when=any of those leaves the section or a refusal reason is not listed; no_claim=the behavior itself, which the library tests cover
test('the library help section states the route, its observation states, refusals and limits', () => {
  // Arrange
  const { library } = nodeScriptHelp()
  const text = JSON.stringify(library)
  // Act / Assert
  for (const phrase of [
    // pregate-literal: API_VERSION=1.33 the node-script library route's minimum API, not the current API
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
    'details.packageManager and details.nodeVersion when they are known',
  ])
    assert.ok(text.includes(phrase), phrase)
  // The reason lists the help names are read back from its sentences and compared with the product lists, in order.
  const listAfter = (sentence: string, marker: RegExp): string[] =>
    (marker.exec(sentence)?.[1] ?? '').split(', ')
  assert.deepEqual(
    listAfter(
      library.refusals.unsupportedNothingStarted,
      /details\.reason one of ([a-z, -]+):/,
    ),
    [...NODE_SCRIPT_LIBRARY_UNSUPPORTED_REASONS],
  )
  assert.deepEqual(
    listAfter(
      library.refusals.failedAfterStart,
      /details\.reason one of ([a-z, -]+):/,
    ),
    [...LIBRARY_BUILD_FAILED_REASONS],
  )
  const codeWhen = (code: string): string =>
    nodeScriptHelp().codes.find((entry) => entry.code === code)?.when ?? ''
  assert.deepEqual(
    listAfter(
      codeWhen('LIBRARY_BUILD_UNSUPPORTED'),
      /details\.reason is one of ([a-z, -]+);/,
    ),
    [...NODE_SCRIPT_LIBRARY_UNSUPPORTED_REASONS],
  )
  assert.deepEqual(
    listAfter(
      codeWhen('LIBRARY_BUILD_FAILED'),
      /details\.reason is one of ([a-z, -]+);/,
    ),
    [...LIBRARY_BUILD_FAILED_REASONS],
  )
  // The pack-error steps are named in the section, in order.
  assert.deepEqual(
    listAfter(
      library.refusals.failedAfterStart,
      /pack-error details\.step is one of ([a-z, -]+)\./,
    ),
    [...LIBRARY_PACK_ERROR_STEPS],
  )
})

// protects=the help and the README say the installed-copy disclosure compares the package's repository URL with the origin remote, so a repository with no origin or a fork whose origin differs lists nothing; fails_when=either drops the origin comparison or the no-disclosure cases; no_claim=how the comparison normalizes URLs
test('the help and the README state that the installed-copy disclosure needs a matching origin remote', async () => {
  // Arrange
  const text = JSON.stringify(nodeScriptHelp().library)
  const readme = await readPackaged('README.md')
  // Act / Assert
  for (const phrase of [
    'compared with the origin remote',
    'lists nothing without an origin remote or for a fork whose origin differs',
  ]) {
    assert.ok(text.includes(phrase), `help: ${phrase}`)
    assert.ok(readme.includes(phrase), `README: ${phrase}`)
  }
})

// pregate-literal: API_VERSION=1.33 the node-script library route's minimum API in the bundled skill, not the current API
// protects=the bundled skill 1.0.82 tells the chat to declare library.packageRoot behind the API 1.33 gate, to say the build runs the project's own scripts, and to call a copy without library unverified; fails_when=a sentence or the version leaves the skill or a project name enters it; no_claim=how a chat follows it
// pregate-literal: API_VERSION=1.33 the node-script library route's minimum API named in the test title, not the current API
test('the bundled skill 1.0.82 routes a library Example to library.packageRoot behind the API 1.33 gate', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.86"\n'))
  for (const phrase of [
    'declare `library.packageRoot` so the Example runs the checked-out library',
    'only when `codebook_status` reports API 1.33 or later',
    "the build runs the project's own build scripts",
    '`nodeScript.library.loaded` true, `nodeScript.library.publishedCopyLoaded` false and `nodeScript.library.observation` `complete`',
    'no other copy was loaded',
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
    'package manager and Node version when they are known',
    '`details.step` is build, pack, tarball, unpack, metadata or link',
    'two windows building the same library at once are not prevented',
    'Yarn and Bun are not supported',
    '`repositoryPackageCopies`',
    '`Ran on the checked-out <name> <version> built from <revision>',
    'Since skill 1.0.82',
    "so Cursor's managed skill updates to **1.0.86**",
  ])
    assert.ok(readme.includes(phrase), phrase)
})
