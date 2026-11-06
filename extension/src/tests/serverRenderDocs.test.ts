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
    'routeHandlerStops',
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

// protects=AC 11 (the packaged skill carries the server-render rules); fails_when=a rule leaves the skill or its version is not 1.0.68; no_claim=how a chat follows the rules
test('the bundled skill declares the stop in code that runs on every render, uses afterOperation 0, checks API 1.16 and never claims a render the run did not pause in', async () => {
  // Arrange
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  // Act
  const paragraph =
    skill.split('\n\n').find((part) => part.startsWith('**Server renders')) ??
    ''
  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.79"\n'))
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

// protects=the help tells the chat what a module-evaluation pause is (scope, preparation, not-yet-available image, absent bindings, not-reached candidates, placeholder example, API 1.27); fails_when=a moduleScope sentence leaves the help or the run-once limit returns; no_claim=the runtime behavior
test('the packaged help explains module-evaluation pauses: scope module, preparation attribution, absent bindings and the not-reached candidates', async (context) => {
  // Arrange
  const help = await readHelpText(context)
  // Act / Assert
  for (const phrase of [
    '"moduleScope"',
    'API 1.27 or later',
    'pauses at that evaluation',
    'scope \\"module\\"',
    'attribution \\"preparation\\"',
    'preparationRequest readiness or warm-load',
    'Preparation · Module evaluation · <path:line>',
    'Page load · Module evaluation · <path:line>',
    'Never call a preparation pause the page load',
    'no browser is open yet and no input has been sent',
    'the application image reads as not yet available',
    'In a warm-load pause the warm-up page is still loading',
    'Such a pause owes no image (capture status absent), so the run can still complete',
    'simply absent from the values',
    "they are saved with the pause, masked like any value, so the replay's native debugger shows them",
    'Declare an imported name as the source writes it',
    'Codebook reads it from the module object webpack bound the import to',
    'the entry route does not import the module',
    'Next evaluated it before the stop could be armed',
    'after a statement that did not run',
    'Placeholder only, not a project file',
    'lib/db.ts',
    'Module evaluation is observed only in App Router runs without a Pages folder',
    'format 12 (.study.v12.json)',
    'Codebook 0.2.85 and older list it as saved by a newer Codebook',
  ])
    assert.ok(help.includes(phrase), phrase)
  assert.equal(help.includes('The first execution of a run-once module'), false)
  assert.equal(help.includes('never at module scope'), false)
})

// protects=the not-reached error text names the module-evaluation candidates as possibilities, adds no safety claim and says module evaluation is observed only in App Router runs; fails_when=the old module-scope-before-armed cause returns or the Pages sentence leaves; no_claim=the wording is helpful
test('SERVER_STOP_NOT_REACHED lists the module-evaluation candidates as possibilities and limits module evaluation to App Router runs', () => {
  // Arrange
  const recovery = ERROR_RECOVERY.SERVER_STOP_NOT_REACHED
  // Act / Assert
  for (const phrase of [
    'The page finished without reaching a declared server stop',
    'the entry route does not import the module',
    "Next evaluated the module before the stop could be armed (another route's module, a hot reload)",
    'after a statement that did not run',
    'Never present any cause as established',
    'For a stop at module scope, check that the entry route imports the module and that the line runs when the module loads',
    'then start one new run',
    'module evaluation is observed only in App Router runs without a Pages folder',
  ])
    assert.ok(recovery.includes(phrase), phrase)
  assert.equal(
    recovery.includes('code at module scope, which Next evaluated'),
    false,
  )
  assert.doesNotMatch(recovery, /safe to (retry|run)/i)
})

// protects=the bundled skill gates the module-scope stop by API 1.27 and tells the chat how to read a Preparation pause; fails_when=the old "never at module scope" rule returns or the preparation sentence leaves; no_claim=how a chat follows the rules
test('the bundled skill allows a top-level App Router stop only on API 1.27 and explains a Preparation pause', async () => {
  // Arrange
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  const paragraph =
    skill.split('\n\n').find((part) => part.startsWith('**Server renders')) ??
    ''
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.79"\n'))
  for (const phrase of [
    'a top-level line (module scope) is allowed only when `codebook_status` reports API 1.27 or later',
    'in a workspace without a Pages folder',
    'pauses at the module\'s first evaluation (`scope: "module"`)',
    'the stop has `afterOperation: 0`',
    'on older APIs, in Pages runs, in workspaces with a Pages folder and after an operation the stop stays inside a function',
    'A pause with `attribution` `preparation`',
    '`preparationRequest` `readiness` or `warm-load`',
    'never by the page load',
    'no browser is open yet and nothing was sent',
    'a module-level binding not initialized yet is absent from the values',
  ])
    assert.ok(paragraph.includes(phrase), phrase)
  assert.equal(paragraph.includes('never at module scope'), false)
})

// protects=the README documents module evaluation (Codebook 0.2.86, API 1.27), the rewritten stop placement, the not-reached candidates and format 12; fails_when=a sentence leaves the README; no_claim=the behavior itself
test('the README describes module-evaluation pauses, preparation labels, the not-reached candidates and format 12', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  const start = readme.indexOf('## Server renders in a Next.js app')
  const section = readme.slice(start, readme.indexOf('\n## ', start + 1))
  // Act / Assert
  for (const phrase of [
    '**Module evaluation (Codebook 0.2.86, MCP API 1.27).**',
    '`scope: "module"`',
    '`attribution: "preparation"`',
    '`preparationRequest` set to `readiness` or `warm-load`',
    '`Preparation · Module evaluation · <path:line>`',
    '`Page load · Module evaluation · <path:line>`',
    'no browser is open yet and no input has been sent',
    'the application image reads as not yet available',
    'in a warm-load pause the warm-up page is still loading',
    'Such a pause owes no image, so the run can still complete and its replay shows no frame for that moment',
    'is absent from the values',
    "are saved with the pause, masked like any value, so its replay's native debugger shows them",
    'declare an imported name as the source writes it',
    'Codebook reads it from the module object webpack bound the import to',
    '`lib/db.ts`',
    'Module evaluation is observed only in App Router runs without a Pages folder',
    'the entry route does not import the module',
    'after a statement that did not run',
    'format 12 (`.study.v12.json`)',
    'Codebook 0.2.85 and older list it as saved by a newer Codebook',
    'declared with `afterOperation: 0`',
    'on an older API, in a Pages run, in a workspace with a Pages folder and after an operation, keep the stop inside a function',
    'A Pages run, and any run in a workspace with a Pages folder, does not observe module evaluation',
  ])
    assert.ok(section.includes(phrase), phrase)
  // The compatibility paragraph above the Next sections names API 1.27 and what it adds.
  assert.ok(
    readme.includes(
      'API 1.27 is additive: it adds module-evaluation server stops',
    ),
  )
  assert.equal(section.includes('Module-scope code runs once'), false)
  assert.equal(section.includes('never at module scope'), false)
})
