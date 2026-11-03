import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { ERROR_RECOVERY } from '../errors'
import { operationsRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { readResource } from '../resources'
import {
  SERVER_RENDER_ENTRY_CONFIGURATION,
  SERVER_RENDER_SEARCH_CONFIGURATION,
} from '../serverRenderHelp'

import { createHarness } from './helpers'

/**
 * Reads the packaged repository-browser help as an agent reads it, as text.
 * @param context - The test context, which closes the harness after the test.
 * @returns The help JSON text.
 * @example await readHelpText(context) // => '{"startHere":"Read codebook_status first…'
 */
async function readHelpText(context: TestContext): Promise<string> {
  const harness = await createHarness()
  context.after(() => harness.close())
  const resource = await readResource(
    harness.service,
    'codebook://help/repository-browser',
  )
  return 'text' in resource ? resource.text : ''
}

/**
 * Reads a packaged file relative to the extension folder.
 * @param segments - Path segments below the extension folder.
 * @returns The file's text.
 * @example await readPackaged('skills', 'codebook', 'SKILL.md')
 */
function readPackaged(...segments: string[]): Promise<string> {
  return readFile(join(__dirname, '..', '..', ...segments), 'utf8')
}

// protects=AC 11 (packaged help states the server-render rules, wording and limits); fails_when=a rule or limit leaves the help, or a sentence says an operation caused a render; no_claim=wording quality
test('the packaged help states afterOperation 0, omitted operations, not-needed confirmation, the client-component refusal, the unsupported server code and "observed after"', async (context) => {
  // Arrange
  const help = await readHelpText(context)
  // Act / Assert
  for (const phrase of [
    'afterOperation: 0',
    'omit operations',
    'operations array [] is refused with INVALID_CONFIGURATION',
    'confirmation: \\"not-needed\\"',
    'client-component',
    'server-side code of other routes than the entry route',
    'A Pages server stop does not pause, in this version',
    'route handlers',
    'Turbopack',
    'observed after',
    '#SERVER_STOP_NOT_REACHED',
    '#ENTRY_LOAD_TIMEOUT',
    '#NEXT_STOP_NOT_SEALED',
    'API 1.16',
    'never fall back to configuration version 2',
    '0.2.73.0',
    'format 8',
  ])
    assert.ok(help.includes(phrase), phrase)
  assert.doesNotMatch(help, /caused by operation/i)
})

// protects=D13 (no packaged text says an operation caused a render); fails_when=any ERROR_RECOVERY text says an operation was observed to cause, or caused, a render; no_claim=wording quality
test('no error recovery text says an operation caused a render', () => {
  // Arrange
  const recoveryTexts = Object.values(ERROR_RECOVERY)
  // Act / Assert
  for (const recoveryText of recoveryTexts) {
    assert.doesNotMatch(recoveryText, /observed to cause/i)
    assert.doesNotMatch(recoveryText, /caused by operation/i)
    assert.doesNotMatch(recoveryText, /the operation caused/i)
  }
  assert.ok(
    ERROR_RECOVERY.SERVER_STOP_NOT_REACHED.includes(
      'a render observed after operation details.operationIndex',
    ),
  )
})

// protects=AC 11 (the packaged skill carries the server-render rules); fails_when=a rule leaves the skill or its version is not 1.0.66; no_claim=how a chat follows the rules
test('the bundled skill declares the stop in code that runs on every render, uses afterOperation 0, checks API 1.16 and never claims a render the run did not pause in', async () => {
  // Arrange
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  // Act
  const paragraph =
    skill.split('\n\n').find((part) => part.startsWith('**Server renders')) ??
    ''
  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.66"\n'))
  for (const phrase of [
    'afterOperation: 0',
    'omitted',
    'confirmation: "not-needed"',
    'client-component',
    'API 1.16',
    'never fall back to version 2',
    'observed after',
    'inside the component or function that runs on every render',
    'Never describe a render the run did not pause in',
    'Turbopack',
  ])
    assert.ok(paragraph.includes(phrase), phrase)
  assert.doesNotMatch(skill, /caused by operation/i)
})

// protects=AC 11a (both quick-start configurations are valid version 3 configurations); fails_when=the schema changes a field and a quick start keeps the old one; no_claim=that the placeholders name real sources. Expected to fail until lane L3 lands the schema that accepts afterOperation 0 and omitted operations.
test('both server-render quick-start configurations parse with the public version 3 schema', () => {
  // Arrange
  const entryRender = JSON.parse(
    JSON.stringify(SERVER_RENDER_ENTRY_CONFIGURATION),
  )
  const searchRerender = JSON.parse(
    JSON.stringify(SERVER_RENDER_SEARCH_CONFIGURATION),
  )
  // Act
  const entryResult = operationsRepositoryConfigSchema.safeParse(entryRender)
  const searchResult =
    operationsRepositoryConfigSchema.safeParse(searchRerender)
  // Assert
  assert.equal(entryResult.success, true)
  assert.equal(searchResult.success, true)
  assert.equal('operations' in entryRender, false)
  assert.equal(searchRerender.operations.length, 1)
})

// protects=AC 11 (README names each server-render behavior); fails_when=a sentence leaves the README; no_claim=the behavior itself
test('the README describes server-render pauses, the client-component refusal, not-needed confirmation, the first-execution boundary, format 8 and the limits', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act
  const start = readme.indexOf('## Server renders in a Next.js app')
  const section = readme.slice(start, readme.indexOf('\n## ', start + 1))
  // Assert
  assert.ok(start > -1)
  for (const phrase of [
    'Page load · Server render',
    'observed after operation k',
    '`confirmation: "not-needed"`',
    '`client-component`',
    '`firstExecutionObserved: false`',
    'format 8',
    '0.2.73.0',
    'Turbopack',
    '`SERVER_STOP_NOT_REACHED`',
    '`ENTRY_LOAD_TIMEOUT`',
  ])
    assert.ok(section.includes(phrase), phrase)
  assert.doesNotMatch(section, /caused by operation/i)
})
