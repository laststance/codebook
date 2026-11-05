import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { API_VERSION, REACT_SCRIPTS_APP_SELECTION_RULE } from '../constants'
import { REACT_SCRIPTS_NESTED_CONFIGURATION } from '../reactScriptsHelp'
import { REACT_SCRIPTS_REFUSAL_CODES } from '../reactScriptsRefusals'
import { liveRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { readResource } from '../resources'

import { createHarness } from './helpers'

type ReactScriptsQuickStart = {
  selectionRule: string
  configurationNested: unknown
  limits: string[]
  studies: string
  refusals: Record<string, { anchor: string; reasons: Record<string, string> }>
}

/**
 * Reads the served repository-browser help as an agent does.
 * @param context - Test context that closes the harness.
 * @returns The parsed help with the `reactScriptsQuickStart` key and `startHere`.
 * @example
 * const help = await readHelp(context) // => { startHere: '…', reactScriptsQuickStart: {…} }
 */
async function readHelp(context: TestContext) {
  const harness = await createHarness()
  context.after(() => harness.close())
  const resource = await readResource(
    harness.service,
    'codebook://help/repository-browser',
  )
  return JSON.parse('text' in resource ? resource.text : '{}') as {
    startHere: string
    reactScriptsQuickStart: ReactScriptsQuickStart
  }
}

/**
 * Reads a packaged file relative to the extension folder.
 * @param relativePath - Path below the extension folder.
 * @returns The file text.
 * @example
 * await readPackaged('README.md') // => '# Codebook …'
 */
async function readPackaged(relativePath: string): Promise<string> {
  return readFile(join(__dirname, '../..', relativePath), 'utf8')
}

// Value: protects=the copyable react-scripts configuration in the help is a configuration the live schema accepts, so a chat that copies it does not start with a refused shape; fails_when=the example drifts from the schema (a renamed field, a removed adapter value); no_claim=that a run with it succeeds
test('the react-scripts help example configuration parses with the live configuration schema', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const parsed = liveRepositoryConfigSchema.safeParse(
    help.reactScriptsQuickStart.configurationNested,
  )
  // Assert
  assert.equal(parsed.success, true)
  assert.deepEqual(
    help.reactScriptsQuickStart.configurationNested,
    REACT_SCRIPTS_NESTED_CONFIGURATION,
  )
})

// Value: protects=the react-scripts help states the limits a chat must relay (react-scripts 4 refused, a node_modules stop refused as a published package, the start script forms, prestart refused) and one anchor per refusal code that the recoveries name; fails_when=a limit sentence or an anchor leaves the help; no_claim=that the run raises these refusals
test('the react-scripts help states its limits and has an anchor for each refusal code', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const section = help.reactScriptsQuickStart
  // Act
  const limitText = section.limits.join('\n')
  const sealReasons = Object.keys(
    section.refusals.REACT_SCRIPTS_SEAL_FAILED?.reasons ?? {},
  )
  // Assert
  assert.equal(section.selectionRule, REACT_SCRIPTS_APP_SELECTION_RULE)
  assert.ok(limitText.includes('react-scripts 4 is refused'))
  assert.ok(
    limitText.includes(
      'because a published package is not the checked-out library',
    ),
  )
  assert.ok(limitText.includes('exactly react-scripts start'))
  assert.ok(limitText.includes('A prestart script is refused'))
  assert.deepEqual(Object.keys(section.refusals), [
    ...REACT_SCRIPTS_REFUSAL_CODES,
  ])
  for (const code of REACT_SCRIPTS_REFUSAL_CODES)
    assert.equal(
      section.refusals[code]?.anchor,
      `codebook://help/repository-browser#${code}`,
    )
  assert.deepEqual(sealReasons, [
    'outside-package',
    'node-modules',
    'unmapped-line',
    'map-limit',
    'map-unreadable',
  ])
  assert.ok(section.studies.includes('study format 11 (.study.v11.json)'))
  assert.ok(help.startHere.includes('reactScriptsQuickStart'))
  assert.ok(help.startHere.includes(REACT_SCRIPTS_APP_SELECTION_RULE))
})

// Value: protects=the MCP instructions name the third adapter react-scripts-dev since API 1.25, quote its selection rule and gate it on the API with an update instruction for older ones; fails_when=the adapter, the rule or the gate sentence leaves the instructions; no_claim=how a chat follows them
test('the MCP instructions name react-scripts-dev, its selection rule and the API 1.25 gate', async () => {
  // Arrange
  const protocol = await readPackaged('src/protocol.ts')
  const constants = await readPackaged('src/constants.ts')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.25 is additive')) ?? ''
  // Assert
  assert.equal(API_VERSION, '1.25')
  assert.ok(protocol.includes('${REACT_SCRIPTS_APP_SELECTION_RULE}'))
  assert.ok(
    protocol.includes(
      'since API 1.25 its third adapter react-scripts-dev runs a Create React App app (react-scripts 5)',
    ),
  )
  assert.ok(
    protocol.includes(
      'use react-scripts-dev on API 1.25 or later, and on an older API tell the learner to update Codebook',
    ),
  )
  for (const phrase of [
    '`react-scripts-dev`',
    '`rootIsApp`',
    'startScript }',
    '`REACT_SCRIPTS_SEAL_FAILED`',
    '`map-limit`',
    'study format 11',
  ])
    assert.ok(note.includes(phrase), phrase)
})

// Value: protects=skill 1.0.74 routes a Create React App app to react-scripts-dev, points at reactScriptsQuickStart, gates it on API 1.25 and names no repository; fails_when=the routing or gate sentence or the version leaves the skill, or a repository name enters it; no_claim=how a chat follows it
test('the bundled skill 1.0.74 routes a Create React App app to react-scripts-dev behind the API 1.25 gate', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.74"\n'))
  for (const phrase of [
    'goes to the `react-scripts-dev` adapter of the `repository-browser` profile',
    '`reactScriptsQuickStart`',
    'only when `codebook_status` reports API 1.25 or later',
    'tell the learner to update Codebook',
  ])
    assert.ok(skill.includes(phrase), phrase)
  assert.equal(/redux/i.test(skill), false)
})

// Value: protects=the README tells a learner that a Create React App app (react-scripts 5) runs at or below the repository root, pauses in its own source, and that react-scripts 4 and node_modules stops are unsupported; fails_when=the sentence or the API 1.25 mention leaves the README; no_claim=native behavior
test('the README documents the react-scripts-dev adapter and its limits', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act / Assert
  for (const phrase of [
    'Codebook runs a Create React App app (react-scripts 5) at or below the repository root',
    "pauses at browser stops in the app's own source",
    'react-scripts 4 and a stop in `node_modules`',
    'with **MCP API 1.25**',
    'study format 11 (`.study.v11.json`)',
  ])
    assert.ok(readme.includes(phrase), phrase)
})
