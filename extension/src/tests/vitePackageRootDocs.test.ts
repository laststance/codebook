import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { API_VERSION, VITE_APP_SELECTION_RULE } from '../constants'
import { liveRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { readResource } from '../resources'
import { VITE_NESTED_CONFIGURATION } from '../viteHelp'

import { createHarness } from './helpers'

/** The refusal reasons of a Vite `packageRoot` the help must give a fix for, one anchor each. */
const VITE_REASONS = [
  'outside-repository',
  'link-leaves-repository',
  'not-a-folder',
  'missing',
  'unreadable',
  'not-a-vite-app',
  'outside-package',
]

type VitePackageRootHelp = {
  selectionRule: string
  configurationNested: unknown
  refusals: Record<string, { anchor: string; code: string; fix: string }>
  studies: string
  savedSession: string
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
  return JSON.parse('text' in resource ? resource.text : '{}') as {
    startHere: string
    vitePackageRoot: VitePackageRootHelp
    nextPackageRoot: {
      adapters: { table: Array<{ adapter: string; packageRoot: string }> }
    }
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

// protects=the version 3 vite-dev example of the help parses with the live start schema and declares packageRoot, so a chat that copies it is not refused for its shape; fails_when=the example drifts from liveRepositoryConfigSchema or loses packageRoot or its repository-relative source path; no_claim=that the placeholders name real files; passes only once the schema accepts packageRoot under vite-dev version 3
test('the Vite packageRoot help example parses with the live start schema and keeps its source inside the app folder', () => {
  // Arrange
  const example = JSON.parse(JSON.stringify(VITE_NESTED_CONFIGURATION))
  // Act
  const result = liveRepositoryConfigSchema.safeParse(example)
  // Assert
  assert.equal(result.success, true)
  assert.equal(VITE_NESTED_CONFIGURATION.adapter, 'vite-dev')
  assert.equal(VITE_NESTED_CONFIGURATION.version, 3)
  assert.equal(
    VITE_NESTED_CONFIGURATION.source.path.startsWith(
      `${VITE_NESTED_CONFIGURATION.packageRoot}/`,
    ),
    true,
  )
})

// protects=the Vite refusal table has one anchor per details.reason, including not-a-vite-app and outside-package under VITE_SEAL_FAILED, and the cross-adapter table names Vite as version 3; fails_when=a reason leaves the table or the table still says Vite refuses packageRoot; no_claim=that the errors of other lanes carry these reasons yet
test('the help has one fix anchor per Vite packageRoot reason and the adapter table names Vite as version 3', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const refusals = help.vitePackageRoot.refusals
  const viteRow = help.nextPackageRoot.adapters.table.find(
    (row) => row.adapter === 'vite-dev',
  )
  // Assert
  assert.deepEqual(Object.keys(refusals), VITE_REASONS)
  for (const reason of VITE_REASONS)
    assert.equal(
      refusals[reason]?.anchor,
      `codebook://help/repository-browser#${reason}`,
    )
  assert.equal(refusals['not-a-vite-app']?.code, 'INVALID_CONFIGURATION')
  assert.equal(refusals['outside-package']?.code, 'VITE_SEAL_FAILED')
  assert.ok(viteRow?.packageRoot.startsWith('Version 3 only'))
})

// protects=the Vite section states the selection rule, the fresh-profile rule and the format 10 note, and startHere sends a Vite question to it; fails_when=one of them leaves the help; no_claim=that a chat follows them
test('the Vite help section carries the selection rule, the saved-session rule and the format 10 note', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const section = help.vitePackageRoot
  // Assert
  assert.equal(section.selectionRule, VITE_APP_SELECTION_RULE)
  assert.ok(section.savedSession.includes('savedSessionSkipped "package-root"'))
  assert.ok(section.studies.includes('study format 10 (.study.v10.json)'))
  assert.ok(
    section.studies.includes(
      'Codebook 0.2.77.0 lists a format 10 study as saved by a newer Codebook',
    ),
  )
  assert.ok(help.startHere.includes('vitePackageRoot'))
})

// protects=API 1.20 is served with a note naming the Vite packageRoot fields, and the MCP instructions carry the Vite selection rule; fails_when=the version or a field of the note drifts or the instructions drop the rule; no_claim=the behavior of other lanes
test('API_VERSION is 1.20 and its note and the MCP instructions name the Vite packageRoot', async () => {
  // Arrange
  const constants = await readPackaged('src/constants.ts')
  const protocol = await readPackaged('src/protocol.ts')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.20 is additive')) ?? ''
  // Assert
  assert.equal(API_VERSION, '1.20')
  for (const phrase of [
    '`packageRoot`',
    '`rootIsApp`',
    '`packagesTruncatedReason`',
    '`not-a-vite-app`',
    '`outside-package`',
    '`savedSessionSkipped: "package-root"`',
    'study format 10',
  ])
    assert.ok(note.includes(phrase), phrase)
  assert.ok(protocol.includes('${VITE_APP_SELECTION_RULE}'))
})

// protects=skill 1.0.69 carries one rule that chooses an app below the root from the readiness packages of its adapter and declares it as packageRoot, without repository-specific content; fails_when=the rule or the version leaves the skill or a repository name enters it; no_claim=how a chat follows it
test('the bundled skill 1.0.69 chooses an app below the root from the readiness packages and declares packageRoot', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.69"\n'))
  for (const phrase of [
    'choose the app from the readiness `packages` of the adapter that lists it',
    'declare it as `packageRoot`',
    'API 1.20 or later',
    '`vitePackageRoot`',
  ])
    assert.ok(skill.includes(phrase), phrase)
  assert.equal(/tanstack/i.test(skill), false)
})

// protects=the README states the Vite app below the repository root behaviors (selection, refusals, fresh profile, format 10); fails_when=a sentence leaves the README; no_claim=native behavior
test('the README documents running a Vite app below the repository root', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act / Assert
  for (const phrase of [
    '## Run a Vite app below the repository root',
    'a version 1 or 2 configuration with `packageRoot` is still refused',
    '`not-a-vite-app`',
    '`VITE_SEAL_FAILED` and the reason `outside-package`',
    '`savedSessionSkipped: "package-root"`',
    'study format 10 (`.study.v10.json`)',
    'Codebook 0.2.77.0 lists a format 10 study as saved by a newer Codebook',
  ])
    assert.ok(readme.includes(phrase), phrase)
})
