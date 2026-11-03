import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  API_VERSION,
  NEXT_APP_SELECTION_RULE,
  NEXT_PACKAGE_ROOT_ENVELOPE_SENTENCE,
} from '../constants'
import {
  NEXT_NESTED_BROWSER_STOP_CONFIGURATION,
  NEXT_NESTED_SERVER_STOP_CONFIGURATION,
  NEXT_QUICK_START_CONFIGURATION,
  REPOSITORY_BROWSER_START_HERE,
} from '../nextHelp'
import { liveRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { readResource } from '../resources'
import {
  SERVER_RENDER_ENTRY_CONFIGURATION,
  SERVER_RENDER_PAGES_ENTRY_CONFIGURATION,
  SERVER_RENDER_SEARCH_CONFIGURATION,
} from '../serverRenderHelp'

import { createHarness } from './helpers'

/** The refusal reasons the help must give a fix for, one anchor each. */
const REASONS = [
  'outside-repository',
  'link-leaves-repository',
  'not-a-folder',
  'missing',
  'unreadable',
  'not-a-next-app',
  'outside-package',
  'package-root-fresh-session',
]

type PackageRootHelp = {
  envelope: string
  selectionRule: string
  configurationNestedServerStop: unknown
  configurationNestedBrowserStop: unknown
  refusals: Record<string, { anchor: string; code: string; fix: string }>
  adapters: { table: Array<{ adapter: string; packageRoot: string }> }
  limits: string[]
  versionCheck: string
}

/**
 * Reads the served repository-browser help as an agent does.
 * @param context - Test context that closes the harness.
 * @returns The parsed help.
 */
async function readHelp(context: TestContext) {
  const harness = await createHarness()
  context.after(() => harness.close())
  const resource = await readResource(
    harness.service,
    'codebook://help/repository-browser',
  )
  return JSON.parse('text' in resource ? resource.text : '{}') as Record<
    string,
    unknown
  > & {
    startHere: string
    nextPackageRoot: PackageRootHelp
    nextQuickStart: { callOrder: string[] }
  }
}

/**
 * Reads a packaged file relative to the extension folder.
 * @param segments - Path segments below `extension/`.
 * @returns The file text.
 */
function readPackaged(...segments: string[]): Promise<string> {
  return readFile(join(__dirname, '..', '..', ...segments), 'utf8')
}

// protects=every configuration example of the help parses with the public start schema, so a chat that copies one is not refused for its shape; fails_when=an example drifts from liveRepositoryConfigSchema or the nested examples lose packageRoot; no_claim=that the placeholders name real files
test('every help configuration example parses with the live start schema and the nested ones declare packageRoot', () => {
  // Arrange
  const examples = {
    quick: NEXT_QUICK_START_CONFIGURATION,
    entry: SERVER_RENDER_ENTRY_CONFIGURATION,
    search: SERVER_RENDER_SEARCH_CONFIGURATION,
    pages: SERVER_RENDER_PAGES_ENTRY_CONFIGURATION,
    nestedServer: NEXT_NESTED_SERVER_STOP_CONFIGURATION,
    nestedBrowser: NEXT_NESTED_BROWSER_STOP_CONFIGURATION,
  }
  // Act
  const results = Object.entries(examples).map(([name, example]) => [
    name,
    liveRepositoryConfigSchema.safeParse(JSON.parse(JSON.stringify(example)))
      .success,
  ])
  // Assert
  assert.deepEqual(
    results.filter(([, ok]) => !ok),
    [],
  )
  assert.equal(
    NEXT_NESTED_SERVER_STOP_CONFIGURATION.source.path.startsWith(
      `${NEXT_NESTED_SERVER_STOP_CONFIGURATION.packageRoot}/`,
    ),
    true,
  )
  assert.equal(NEXT_NESTED_BROWSER_STOP_CONFIGURATION.afterOperation, 1)
})

// protects=the envelope sentence is defined once and the help, the README and the API constant agree on it; fails_when=the help or README words the envelope differently or drops it; no_claim=the CHANGELOG, which /ship writes
test('the envelope sentence is the same constant in the help and in the README', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const readme = await readPackaged('README.md')
  // Act / Assert
  assert.equal(
    help.nextPackageRoot.envelope,
    NEXT_PACKAGE_ROOT_ENVELOPE_SENTENCE,
  )
  assert.ok(
    help.nextPackageRoot.limits.includes(NEXT_PACKAGE_ROOT_ENVELOPE_SENTENCE),
  )
  assert.ok(readme.includes(NEXT_PACKAGE_ROOT_ENVELOPE_SENTENCE))
})

// protects=startHere, the quick start's call order, nextPackageRoot and the MCP instructions carry one selection rule (root only with rootIsApp, else the ready packages entry with its packageRoot); fails_when=a surface drops the rule or says a hoisted root Next makes the root the choice; no_claim=that a chat follows it
test('the help and the MCP instructions share one app selection rule', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const harness = await createHarness()
  context.after(() => harness.close())
  const protocol = await readFile(
    join(__dirname, '..', '..', 'src', 'protocol.ts'),
    'utf8',
  )
  // Act / Assert
  assert.ok(help.startHere.includes(NEXT_APP_SELECTION_RULE))
  assert.equal(help.startHere, REPOSITORY_BROWSER_START_HERE)
  assert.ok(help.nextQuickStart.callOrder[0]?.includes(NEXT_APP_SELECTION_RULE))
  assert.equal(help.nextPackageRoot.selectionRule, NEXT_APP_SELECTION_RULE)
  assert.ok(protocol.includes('${NEXT_APP_SELECTION_RULE}'))
  assert.ok(NEXT_APP_SELECTION_RULE.includes('rootIsApp'))
  assert.ok(NEXT_APP_SELECTION_RULE.includes('never makes the root the choice'))
  assert.ok(NEXT_APP_SELECTION_RULE.includes('packagesTruncated'))
})

// protects=the refusal-to-fix table has one anchor per new details.reason and the cross-adapter packageRoot table names all three adapters; fails_when=a reason or adapter row leaves the help; no_claim=that another lane's errors carry these reasons yet
test('the help has one fix anchor per packageRoot reason and a cross-adapter table', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const refusals = help.nextPackageRoot.refusals
  // Assert
  assert.deepEqual(Object.keys(refusals), REASONS)
  for (const reason of REASONS)
    assert.equal(
      refusals[reason]?.anchor,
      `codebook://help/repository-browser#${reason}`,
    )
  assert.deepEqual(
    help.nextPackageRoot.adapters.table.map((row) => row.adapter),
    ['node-server', 'next-dev-webpack', 'vite-dev'],
  )
  assert.ok(
    help.nextPackageRoot.adapters.table[0]?.packageRoot.includes(
      'NODE_SERVER_SOURCE_REFUSED',
    ),
  )
})

// protects=API 1.18 is served and its note names the packageRoot fields; fails_when=the version or a field of the note drifts; no_claim=the behavior of other lanes
test('API_VERSION is 1.18 and its note names the packageRoot fields', async () => {
  // Arrange
  const constants = await readPackaged('src/constants.ts')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.18 is additive')) ?? ''
  // Assert
  assert.equal(API_VERSION, '1.18')
  for (const phrase of [
    '`packageRoot`',
    '`rootIsApp`',
    '`packagesTruncatedReason`',
    '`savedSessionSkipped: "package-root"`',
    '`details.workerStartSends`',
    'study format 9',
  ])
    assert.ok(note.includes(phrase), phrase)
})

// protects=skill 1.0.67 gates packageRoot on API 1.18, chooses the app the question is about, never opens a nested folder and says which package runs; fails_when=a rule leaves the skill; no_claim=how a chat follows it
test('the bundled skill 1.0.67 gates packageRoot on API 1.18 and never opens a nested folder', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.67"\n'))
  for (const phrase of [
    'only when `codebook_status` reports API 1.18 or later',
    'refuses `packageRoot` as an unknown key',
    '`rootIsApp`',
    'never makes the root the choice',
    "Never ask the learner to open the app's folder",
    'say which package runs',
    '`packagesTruncated` is true',
    '`package-root-fresh-session`',
  ])
    assert.ok(skill.includes(phrase), phrase)
})

// protects=the README no longer says a nested Next app cannot run and leads with the root-open entry; fails_when=the old 0.2.74.0 bullet returns or the entry steps leave; no_claim=native behavior
test('the README replaces the nested-app limitation with the root-open entry', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act / Assert
  assert.equal(readme.includes('cannot run yet'), false)
  assert.ok(readme.includes('## Run a Next app below the repository root'))
  assert.ok(readme.includes('**MCP API 1.18**'))
  assert.ok(readme.includes('format 9 (`.study.v9.json`)'))
  assert.ok(
    readme.includes(
      'Codebook 0.2.74.0 lists a format 9 study as saved by a newer Codebook',
    ),
  )
  assert.ok(
    readme.indexOf('## Run a Next app below the repository root') <
      readme.indexOf('## Set up editor AI chat'),
  )
})
