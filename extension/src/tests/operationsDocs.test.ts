import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { ERROR_RECOVERY } from '../errors'
import {
  OPERATIONS_ERROR_CODES,
  OPERATIONS_QUICK_START_CONFIGURATION,
} from '../operationsHelp'
import {
  operationsRepositoryConfigSchema,
  retainedRepositoryConfigSchema,
} from '../repositoryConfigSchemas'
import { readResource } from '../resources'

import { createHarness } from './helpers'

/** The parts of the repository-browser help these tests read. */
type OperationsHelp = {
  operationsQuickStart: {
    configuration: unknown
    decision: { need: string; use: string }[]
    callOrder: string[]
    receipt: { meaning: string }
    progress: Record<string, string>
    firstSuccess: string
  }
  operationsDeclare: Record<string, unknown>
  operationsSecrets: Record<string, unknown>
  operationsErrorCodes: {
    codes: Record<
      string,
      { anchor: string; audience: string; recovery: string }
    >
  }
}

/**
 * Reads `codebook://help/repository-browser` from a fresh service, as an agent reads it.
 * @param context - The test context, which closes the harness after the test.
 * @returns The parsed help object.
 * @example const help = await readHelp(context) // => { operationsQuickStart: {…}, … }
 */
async function readHelp(context: TestContext): Promise<OperationsHelp> {
  const harness = await createHarness()
  context.after(() => harness.close())
  const resource = await readResource(
    harness.service,
    'codebook://help/repository-browser',
  )
  return JSON.parse('text' in resource ? resource.text : '{}')
}

/**
 * Reads a packaged file relative to the extension folder.
 * @param segments - Path segments below the extension folder.
 * @returns The file's text.
 * @example await readPackaged('README.md')
 */
function readPackaged(...segments: string[]): Promise<string> {
  return readFile(join(__dirname, '..', '..', ...segments), 'utf8')
}

// protects=an agent that copies the version 3 quick start is not refused for its shape; fails_when=the schema changes a field and the example keeps the old one, or the example loses a kind or its ask-learner operation; no_claim=that the placeholders name real sources
test('the version 3 quick start configuration parses with the public schema and declares all three kinds with one ask-learner secret', () => {
  // Arrange
  const configuration = JSON.parse(
    JSON.stringify(OPERATIONS_QUICK_START_CONFIGURATION),
  )
  // Act
  const parsed = operationsRepositoryConfigSchema.safeParse(configuration)
  const retained = retainedRepositoryConfigSchema.safeParse(configuration)
  // Assert
  assert.equal(parsed.success, true)
  assert.equal(retained.success, true)
  assert.deepEqual(
    configuration.operations.map(
      (operation: { kind: string }) => operation.kind,
    ),
    ['text', 'text', 'choose', 'click'],
  )
  assert.equal(
    configuration.operations.filter(
      (operation: { secret?: string }) => operation.secret === 'ask-learner',
    ).length,
    1,
  )
})

// protects=an agent reading the help learns the decision table, the tool order, that a receipt is acceptance only and where progress lives; fails_when=any of them leaves operationsQuickStart; no_claim=that the agent follows it
test('the version 3 quick start gives the decision table, the call order, the acceptance-only receipt and the progress fields', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const quickStart = help.operationsQuickStart
  const order = quickStart.callOrder.join('\n')
  // Assert
  assert.equal(quickStart.decision.length, 3)
  assert.ok(quickStart.decision[0]?.use.includes('version 1'))
  assert.ok(quickStart.decision[1]?.use.includes('version 3'))
  for (const tool of [
    'codebook_status',
    'codebook_start',
    'nextActions',
    'codebook_action repository-operation',
    'new key',
    'codebook_continue',
  ])
    assert.ok(order.includes(tool), tool)
  assert.ok(quickStart.receipt.meaning.startsWith('An acceptance receipt only'))
  assert.ok(quickStart.progress.where?.includes('operations[]'))
  assert.ok(quickStart.firstSuccess.includes('operations[0].state done'))
})

// protects=the help names every operation rule an agent otherwise learns by failing: the 8 limit, afterOperation, native select only, the 500 ms and 10 s settle wait with the warm-in-before workaround, and navigation; fails_when=a rule leaves its section; no_claim=the wording
test('the Declare operations section names the limit, afterOperation, native selects, the settle bound and the navigation rule', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const text = JSON.stringify(help.operationsDeclare)
  // Assert
  assert.ok(text.includes('Up to 8 operations'))
  assert.ok(text.includes('afterOperation'))
  assert.ok(text.includes('native single <select>'))
  assert.ok(text.includes('custom select'))
  assert.ok(text.includes('500 ms'))
  assert.ok(text.includes('bounded at 10 s'))
  assert.ok(text.includes('warm it in the run-level before conditions'))
  assert.ok(text.includes('NAVIGATION_BEFORE_LAST_OPERATION'))
})

// protects=the help tells ask-learner, the refusal of chat text into a secret, the dots-and-dropped-frames honesty and the name-and-format limit with the local test account advice; fails_when=any of them leaves the section; no_claim=the masking itself
test('the Secrets and masking section names ask-learner, the chat refusal, the frame gate honesty and the limit of name-based masking', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const text = JSON.stringify(help.operationsSecrets)
  // Assert
  assert.ok(text.includes('ask-learner'))
  assert.ok(text.includes('SECRET_INPUT_FROM_CHAT'))
  assert.ok(text.includes('OPERATIONS_NOT_CONFIRMED'))
  assert.ok(text.includes('relies on the browser drawing a password as dots'))
  assert.ok(text.includes('SECRET_BECAME_VISIBLE'))
  assert.ok(text.includes('masked by name and by format only'))
  assert.ok(text.includes('local test account'))
  assert.ok(text.includes('[pending]'))
})

// protects=the frames help tells a chat the same short-secret refusal as the ask-learner and prepared-text sentences; fails_when=the help says a secret shorter than 4 characters is sent and the run goes on with every later image dropped; no_claim=the refusals themselves (operationErrors.test.ts covers the box; armPreparedSecretGate is not exercised here)
test('the frames help says a secret shorter than 4 characters never reaches the frame check, refused by the ask-learner box or with SECRET_INPUT_VISIBLE', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const frames = String(help.operationsSecrets.frames)
  // Assert
  assert.ok(
    frames.endsWith(
      'A secret shorter than 4 characters cannot be told from ordinary page text, so none reaches this check: the ask-learner box refuses it and stays open, and a version 1 or 2 prepared one for an input of type password fails with SECRET_INPUT_VISIBLE before it is typed.',
    ),
  )
  assert.equal(frames.includes('the run itself goes on'), false)
})

// protects=every code version 3 adds has an anchored row with the audience and recovery of the error itself; fails_when=a code lacks a row or an audience, or the help's recovery drifts from ERROR_RECOVERY; no_claim=the wording of a recovery
test('the Error codes table has one anchored row per version 3 code with the audience and recovery of the error', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const rows = help.operationsErrorCodes.codes
  // Assert
  assert.deepEqual(Object.keys(rows), [...OPERATIONS_ERROR_CODES])
  for (const code of OPERATIONS_ERROR_CODES) {
    assert.equal(
      rows[code]?.anchor,
      `codebook://help/repository-browser#${code}`,
    )
    assert.equal(rows[code]?.recovery, ERROR_RECOVERY[code])
    assert.ok(['chat', 'learner'].includes(rows[code]?.audience ?? ''), code)
  }
  assert.equal(rows.OPERATIONS_NOT_CONFIRMED?.audience, 'learner')
  assert.equal(rows.OPTION_NOT_AVAILABLE?.audience, 'chat')
})

// protects=DX-11: the packaged skill carries each pt1 safety rule; fails_when=a sentence leaves the skill or its version is not 1.0.63; no_claim=how a chat follows the rules
test('the bundled skill declares flows as operations, keeps secrets with the learner, claims only shown progress and never repeats unasked', async () => {
  // Arrange
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  // Act
  const paragraph =
    skill
      .split('\n\n')
      .find((part) =>
        part.startsWith('**Operations (configuration version 3).**'),
      ) ?? ''
  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.63"\n'))
  assert.ok(paragraph.includes('ordered v3 `operations`'))
  assert.ok(paragraph.includes('`afterOperation`'))
  assert.ok(paragraph.includes('always `secret: "ask-learner"`'))
  assert.ok(paragraph.includes('never type a secret yourself'))
  assert.ok(paragraph.includes('a receipt is acceptance only'))
  assert.ok(
    paragraph.includes('do not repeat the flow unless the learner asks'),
  )
  assert.ok(
    paragraph.includes('Relay `OPERATIONS_NOT_CONFIRMED` to the learner'),
  )
  assert.ok(paragraph.includes('warm a slow route in `before`'))
})

// protects=the packaged README tells learners about operations, ask-learner, the version 1 and 2 masking change and isError for a failed run; fails_when=a sentence leaves the README; no_claim=the behavior itself
test('the README names operations, ask-learner, the masking behavior change and isError for a failed browser run', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act
  const start = readme.indexOf('## Declare a web flow as operations')
  const section = readme.slice(start, readme.indexOf('\n## ', start + 1))
  // Assert
  assert.ok(start > -1)
  assert.ok(section.includes('`secret: "ask-learner"`'))
  assert.ok(section.includes('a behavior change in version 1 and 2'))
  assert.ok(section.includes('`[pending]`'))
  assert.ok(section.includes('`isError: true`'))
  assert.ok(section.includes('`NAVIGATION_NOT_SETTLED`'))
  assert.ok(readme.includes('**MCP API 1.15**'))
})
