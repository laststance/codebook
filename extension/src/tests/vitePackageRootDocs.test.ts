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
  // Library reasons (API 1.21); library-place-ambiguous does not occur under vite-dev
  'library-build-stale',
  'library-build-unmapped',
  'library-not-in-build',
  'library-build-changed',
]

type VitePackageRootHelp = {
  selectionRule: string
  libraryStops: {
    anchor: string
    minimumApi: string
    rule: string
    reasons: string[]
  }
  limits: string[]
  configurationNested: unknown
  refusals: Record<
    string,
    { anchor: string; code: string; meaning: string; fix: string }
  >
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

// protects=the Vite refusal table has one anchor per details.reason, including not-a-vite-app, outside-package and the four library reasons, and the cross-adapter table names Vite as version 3; fails_when=a reason leaves the table or the table still says Vite refuses packageRoot; no_claim=that the errors of other lanes carry these reasons yet
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

// protects=API 1.21 is served with a note naming the Vite packageRoot fields, and the MCP instructions carry the Vite selection rule; fails_when=the version or a field of the note drifts or the instructions drop the rule; no_claim=the behavior of other lanes
test('API_VERSION is 1.21 and its note and the MCP instructions name the Vite packageRoot', async () => {
  // Arrange
  const constants = await readPackaged('src/constants.ts')
  const protocol = await readPackaged('src/protocol.ts')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.20 is additive')) ?? ''
  // Assert
  assert.equal(API_VERSION, '1.21')
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

// protects=skill 1.0.70 carries one rule that chooses an app below the root from the readiness packages of its adapter and declares it as packageRoot, without repository-specific content; fails_when=the rule or the version leaves the skill or a repository name enters it; no_claim=how a chat follows it
test('the bundled skill 1.0.70 chooses an app below the root from the readiness packages and declares packageRoot', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.70"\n'))
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

// protects=the Vite help's library rule says what reaches a library, that Codebook never builds it and that a root run stays refused, and lists the four reasons that occur under vite-dev; fails_when=the rule drops a statement, a reason loses its list entry, or library-place-ambiguous (which D14 removes under vite-dev) returns; no_claim=that a run emits these reasons (Lane B tests) or that a chat follows the sentences
test('the Vite help states the library-stop rule and lists the four library reasons without library-place-ambiguous', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const { libraryStops, limits } = help.vitePackageRoot
  // Act
  const limitText = limits.join('\n')
  // Assert
  assert.equal(
    libraryStops.anchor,
    'codebook://help/repository-browser#vite-library-stops',
  )
  assert.equal(libraryStops.minimumApi, '1.21')
  for (const phrase of [
    'checked-out source of a workspace library the app reaches through links inside the repository',
    'directly or through other workspace libraries',
    'Codebook never builds the library and you never run its build',
    'sourcesContent',
    'a root run (packageRoot absent or ".") stays refused as outside-package',
    'study format 10 with no new field',
  ])
    assert.ok(libraryStops.rule.includes(phrase), phrase)
  assert.deepEqual(libraryStops.reasons, [
    'library-build-stale',
    'library-build-unmapped',
    'library-not-in-build',
    'library-build-changed',
  ])
  assert.equal(limitText.includes('since API 1.21'), true)
})

// protects=each library reason under vite-dev has its own help anchor and a fix that says what the chat does (stale: the learner rebuilds, never the chat; prebundled: offer an Example-side stop; lazy-import: choose an already loaded module); fails_when=an anchor or one of these instructions leaves the table, or the Vite rows copy Next's server wording; no_claim=that the chat obeys, or that the run raises the causes
test('every Vite library refusal has an anchor and a fix naming what the chat does', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const { refusals } = help.vitePackageRoot
  // Act
  const stale = refusals['library-build-stale']
  const unmapped = refusals['library-build-unmapped']
  const notInBuild = refusals['library-not-in-build']
  const changed = refusals['library-build-changed']
  // Assert
  for (const reason of [
    'library-build-stale',
    'library-build-unmapped',
    'library-not-in-build',
    'library-build-changed',
  ])
    assert.equal(
      refusals[reason]?.anchor,
      `codebook://help/repository-browser#${reason}`,
      reason,
    )
  assert.equal(refusals['library-place-ambiguous'], undefined)
  assert.equal(stale?.code, 'VITE_SEAL_FAILED')
  assert.ok(stale?.fix.includes('only the learner runs it'))
  assert.ok(stale?.fix.includes('you never run it'))
  assert.ok(stale?.fix.includes('Do not move the stop to another file'))
  for (const cause of [
    'no-map',
    'malformed',
    'no-content',
    'no-line',
    'prebundled',
    'bound',
    'deadline',
    'lazy-import',
  ])
    assert.ok(unmapped?.meaning.includes(cause), cause)
  assert.ok(unmapped?.meaning.includes('details.sideEffects is none'))
  assert.ok(unmapped?.fix.includes('serves the library pre-bundled'))
  assert.ok(unmapped?.fix.includes('an Example-side stop'))
  assert.ok(unmapped?.fix.includes('a module the page has already loaded'))
  assert.ok(
    unmapped?.fix.includes('Codebook never builds and you never run the build'),
  )
  assert.ok(notInBuild?.meaning.includes('details.candidates'))
  assert.ok(
    notInBuild?.fix.includes('Do not start another run with the same stop'),
  )
  assert.equal(
    changed?.meaning.includes('details.sideEffects is unknown'),
    true,
  )
  assert.ok(changed?.fix.includes('Do not run the build yourself'))
})

// protects=API 1.21 is served and its note names the browser library stops, the library reasons, the prebundled and lazy-import causes and the unchanged study format; fails_when=the version or a named part of the note drifts; no_claim=the behavior behind the reasons
test('API_VERSION is 1.21 and its note names the Vite library stops, reasons and new causes', async () => {
  // Arrange
  const constants = await readPackaged('src/constants.ts')
  const protocol = await readPackaged('src/protocol.ts')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.21 is additive')) ?? ''
  // Assert
  assert.equal(API_VERSION, '1.21')
  for (const phrase of [
    '`vite-dev`',
    'nested `packageRoot`',
    '`library-build-stale`',
    '`library-build-unmapped`',
    '`library-not-in-build`',
    '`library-build-changed`',
    '`prebundled`',
    '`lazy-import`',
    '`VITE_SEAL_FAILED`',
    'study format 10 with no new field',
    '`library-place-ambiguous` does not occur under `vite-dev`',
  ])
    assert.ok(note.includes(phrase), phrase)
  assert.ok(protocol.includes('since API 1.21 a browser stop in that Vite run'))
})

// protects=skill 1.0.70 tells the chat that a browser stop under a nested Vite app may lie in a workspace library, to have the learner build a stale library and never build it, and names no repository; fails_when=the sentence or version leaves the skill or a repository name enters it; no_claim=how a chat follows it
test('the bundled skill 1.0.70 allows a library browser stop under a nested Vite app and never builds the library', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.70"\n'))
  for (const phrase of [
    'Under `vite-dev` with a nested `packageRoot` (API 1.21 or later), a browser stop may lie in a workspace library the app imports',
    'when the run is refused as `library-build-stale`, tell the learner to build the library themselves and never build it yourself',
  ])
    assert.ok(skill.includes(phrase), phrase)
  assert.equal(/tanstack|query-core/i.test(skill), false)
})

// protects=the README states the three Vite library behaviors (browser stop in a workspace library, the stale / pre-bundled / lazy refusals, the replay) and the API 1.21 and skill 1.0.70 mentions; fails_when=a sentence or version leaves the README; no_claim=native behavior
test('the README documents Vite library stops, their refusals and replay with API 1.21 and skill 1.0.70', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  const start = readme.indexOf('## Run a Vite app below the repository root')
  const section = readme.slice(
    start,
    readme.indexOf('## Set up editor AI chat'),
  )
  // Act / Assert
  for (const phrase of [
    'A browser stop may lie in the checked-out source of a workspace library the app imports through links inside the repository',
    'Codebook never builds the library: you build it, with source maps that include `sourcesContent`',
    '`library-build-stale`',
    '`library-not-in-build`',
    '`prebundled` means Vite serves the library as an optimized dependency',
    '`lazy-import`',
    '`library-build-changed`',
    'saved as study format 10 with no new field',
    "also after the library's build is removed",
  ])
    assert.ok(section.includes(phrase), phrase)
  assert.ok(readme.includes('with **MCP API 1.21**'))
  assert.ok(readme.includes('API 1.21 is additive: it adds browser stops'))
  assert.ok(readme.includes('(1.0.70).**'))
  assert.ok(readme.includes('updates to **1.0.70**'))
})
