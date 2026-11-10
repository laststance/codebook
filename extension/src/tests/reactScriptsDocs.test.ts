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

// Value: protects=the react-scripts help states the limits a chat must relay (react-scripts 4 and 5 supported, 3 or older refused, a node_modules stop refused as a published package, the start script forms, prestart refused) and one anchor per refusal code that the recoveries name; fails_when=a limit sentence or an anchor leaves the help; no_claim=that the run raises these refusals
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
  assert.ok(limitText.includes('react-scripts 4 and 5 are supported'))
  assert.ok(limitText.includes('react-scripts 3 or older is refused'))
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
    'ambiguous-source',
    'node-modules',
    'unmapped-line',
    'map-limit',
    'script-off-origin',
    'too-many-scripts',
    'script-too-large',
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
  assert.equal(API_VERSION, '1.44')
  assert.ok(protocol.includes('${REACT_SCRIPTS_APP_SELECTION_RULE}'))
  assert.ok(
    protocol.includes(
      // pregate-literal: API_VERSION=1.41 react-scripts 4 arrived in API 1.41, and the protocol names that minimum
      'since API 1.25 its third adapter react-scripts-dev runs a Create React App app (react-scripts 4 or 5; react-scripts 4 needs API 1.41 or later)',
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

// Value: protects=the bundled skill routes a Create React App app to react-scripts-dev, points at reactScriptsQuickStart, gates it on API 1.25 and names no repository; fails_when=the routing or gate sentence or the version leaves the skill, or a repository name enters it; no_claim=how a chat follows it
test('the bundled skill routes a Create React App app to react-scripts-dev behind the API 1.25 gate', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.91"\n'))
  for (const phrase of [
    'goes to the `react-scripts-dev` adapter of the `repository-browser` profile',
    '`reactScriptsQuickStart`',
    'only when `codebook_status` reports API 1.25 or later',
    'tell the learner to update Codebook',
  ])
    assert.ok(skill.includes(phrase), phrase)
  assert.equal(/redux/i.test(skill), false)
})

// Value: protects=the README tells a learner that a Create React App app (react-scripts 4 or 5) runs at or below the repository root, pauses in its own source, and that react-scripts 3 or older and node_modules stops are unsupported; fails_when=the sentence or the API 1.25 mention leaves the README; no_claim=native behavior
test('the README documents the react-scripts-dev adapter and its limits', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act / Assert
  for (const phrase of [
    'Codebook runs a Create React App app (react-scripts 4 or 5) at or below the repository root',
    "pauses at browser stops in the app's own source",
    'A stop in `node_modules` (a published package is not the checked-out library) and react-scripts 3 or older (refused as `react-scripts-version`) are not supported',
    'with **MCP API 1.44**',
    'study format 11 (`.study.v11.json`)',
  ])
    assert.ok(readme.includes(phrase), phrase)
})

// Value: protects=the help, the README and the API note tell the chat that Codebook sets CI=true, HOST, PORT and BROWSER over the start script; fails_when=the sentence leaves one of the three places; no_claim=that the launcher applies it (launcher tests pin that)
test('the help, README and API note state the environment Codebook sets for a react-scripts start', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const readme = await readPackaged('README.md')
  const constants = await readPackaged('src/constants.ts')
  // Act
  const limitText = help.reactScriptsQuickStart.limits.join('\n')
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.25 is additive')) ?? ''
  // Assert
  assert.ok(limitText.includes('Codebook sets CI=true, HOST, PORT and BROWSER'))
  assert.ok(
    readme.includes(
      'Codebook sets `CI=true`, `HOST`, `PORT` and `BROWSER` itself',
    ),
  )
  assert.ok(
    note.includes('it sets `CI=true`, `HOST`, `PORT` and `BROWSER` itself'),
  )
  assert.ok(
    readme.includes(
      'listed by its structure (command words and assignment names, never values)',
    ),
  )
  assert.ok(readme.includes('`Host=` or `port=`'))
  assert.ok(readme.includes('Saved sessions cover Next.js and Vite apps only'))
})

// Value: protects=the bundled skill paraphrases the selection rule (root only with rootIsApp, ready packages entry with its packageRoot, hoisted install never the root, truncated list declared from the repository files); fails_when=a key phrase leaves the skill; no_claim=how a chat follows it
test('the bundled skill paraphrases the react-scripts selection rule', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  const paragraph =
    skill
      .split('\n')
      .find((line) => line.startsWith('**A Create React App app')) ?? ''
  // Act / Assert
  for (const phrase of [
    '`rootIsApp` true',
    'the `packages` entry the question is about',
    'its exact `packageRoot`',
    '`node_modules/react-scripts` at the root alone (a hoisted install) never makes the root the choice',
    '`packagesTruncated` is true',
    "declare its repository-relative folder as `packageRoot` from the repository's files",
  ])
    assert.ok(paragraph.includes(phrase), phrase)
  for (const phrase of ['rootIsApp', 'hoisted install', 'packagesTruncated'])
    assert.ok(REACT_SCRIPTS_APP_SELECTION_RULE.includes(phrase), phrase)
})

// Value: protects=the map-limit, port and exited help texts match the builders (whole bundle too large; PORT= assignment lever; the run journal named in words, no journalPath field); fails_when=the help sends the learner to a smaller module or to the app's own configuration; no_claim=the run
test('the react-scripts help words map-limit, port and exited as the builders do', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const refusals = help.reactScriptsQuickStart.refusals
  // Act
  const mapLimit =
    refusals.REACT_SCRIPTS_SEAL_FAILED?.reasons['map-limit'] ?? ''
  const port =
    refusals.REACT_SCRIPTS_PORT_UNAVAILABLE?.reasons['port-in-use'] ?? ''
  const exited = refusals.REACT_SCRIPTS_LAUNCHER_FAILED?.reasons.exited ?? ''
  // Assert
  assert.ok(mapLimit.includes('bundle is too large'))
  assert.equal(mapLimit.includes('smaller module'), false)
  assert.ok(port.includes('PORT= assignment in the'))
  assert.ok(exited.includes('Read the run journal for its output'))
  assert.equal(exited.includes('journalPath'), false)
})

// Value: protects=the help tells a chat that react-scripts 4 is supported from API 1.41, that Codebook adds the OpenSSL legacy provider to the app's own process only and never changes the app's dependencies, and that react-scripts 3 or older is the refused case; fails_when=a sentence returns to "only react-scripts 5" or drops the Node option or the API gate; no_claim=that a react-scripts 4 app runs
test('the react-scripts help says react-scripts 4 is supported from API 1.41 with the legacy provider in the app process only', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const section = help.reactScriptsQuickStart as ReactScriptsQuickStart & {
    summary: string
    library: { limits: string[] }
  }
  // Act
  const limitText = section.limits.join('\n')
  const versionReason =
    section.refusals.REACT_SCRIPTS_UNSUPPORTED?.reasons[
      'react-scripts-version'
    ] ?? ''
  const unreadable =
    section.refusals.REACT_SCRIPTS_UNSUPPORTED?.reasons[
      'node-version-unreadable'
    ] ?? ''
  // Assert
  assert.ok(section.summary.includes('(react-scripts 4 or 5)'))
  assert.ok(
    section.summary.includes(
      'A react-scripts 4 app needs codebook_status to report API 1.41 or later',
    ),
  )
  assert.ok(
    section.summary.includes(
      "on Node 17 or later Codebook adds --openssl-legacy-provider to the NODE_OPTIONS of the app's own process only, after the learner's own value",
    ),
  )
  assert.ok(
    limitText.includes(
      'react-scripts 4 and 5 are supported (react-scripts 4 from API 1.41)',
    ),
  )
  assert.ok(limitText.includes('so the learner installs them with the'))
  assert.equal(limitText.includes('Only react-scripts 5'), false)
  assert.ok(versionReason.includes('react-scripts 3 or older'))
  assert.ok(unreadable.includes('point codebook.nodeExecutable'))
  assert.ok(
    section.library.limits.some((limit) =>
      limit.includes('the Example must use react-scripts 4 or 5'),
    ),
  )
})

// Value: protects=the help words the three multi-script seal reasons (script-off-origin, too-many-scripts, script-too-large) each with its recovery and its no-click state, and the limit says the app's own source and its libraries may be in different scripts; fails_when=a reason or its recovery sentence leaves the help; no_claim=that the reader raises them
test('the react-scripts help explains the multi-script seal reasons and their recovery', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const section = help.reactScriptsQuickStart
  // Act
  const reasons = section.refusals.REACT_SCRIPTS_SEAL_FAILED?.reasons ?? {}
  const limitText = section.limits.join('\n')
  // Assert
  assert.ok(
    reasons['script-off-origin']?.includes(
      'redirected off the owned loopback origin',
    ),
  )
  assert.ok(reasons['too-many-scripts']?.includes('the limit is 8'))
  assert.ok(
    reasons['script-too-large']?.includes("is over Codebook's reading limit"),
  )
  for (const reason of [
    'script-off-origin',
    'too-many-scripts',
    'script-too-large',
  ]) {
    assert.ok(reasons[reason]?.includes('never edit the project'), reason)
    assert.ok(reasons[reason]?.includes('no click was sent'), reason)
  }
  assert.ok(
    limitText.includes(
      "the app's own source and its libraries may be in different scripts",
    ),
  )
})

// Value: protects=the API note, the skill and the README all state the react-scripts 4 contract of API 1.41 (ready under react-scripts-dev, legacy provider in the app process only, the learner's own NODE_OPTIONS kept, the multi-script reader, the three new seal reasons, the pack route, no new study field) and the skill gates it on API 1.41; fails_when=any of the three places drops a sentence; no_claim=native behavior
test('the API note, skill and README state the react-scripts 4 support of API 1.41', async () => {
  // Arrange
  const constants = await readPackaged('src/constants.ts')
  const skill = await readPackaged('skills/codebook/SKILL.md')
  const readme = await readPackaged('README.md')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.41 is additive')) ?? ''
  const skillParagraph =
    skill
      .split('\n')
      .find((line) => line.startsWith('**A Create React App app')) ?? ''
  // Assert
  assert.equal(API_VERSION, '1.44')
  for (const phrase of [
    'a Create React App app on react-scripts 4 is ready under `react-scripts-dev`',
    "adds `--openssl-legacy-provider` to the `NODE_OPTIONS` of the app's own process only, after the learner's own value",
    '`node-version-unreadable`',
    '`script-off-origin`, `too-many-scripts` and `script-too-large`',
    'works on react-scripts 4 as well',
    'A saved study gains no field',
    "a file named by two served scripts' maps is refused `ambiguous-source`",
    'otherwise the start stops with `library-redirect-not-applied` before the browser opens',
    "the start script's `NODE_OPTIONS=` assignment, else the editor's environment",
  ])
    assert.ok(note.includes(phrase), phrase)
  for (const phrase of [
    'react-scripts 4 or 5; react-scripts 3 or older is refused',
    'A Create React App app on react-scripts 4 goes to `react-scripts-dev` only when `codebook_status` reports API 1.41 or later (otherwise tell the learner to update Codebook)',
    "so never change the app's dependencies or Node options",
  ])
    assert.ok(skillParagraph.includes(phrase), phrase)
  for (const phrase of [
    '**react-scripts 4 (MCP API 1.41).**',
    "Codebook adds `--openssl-legacy-provider` to the `NODE_OPTIONS` of the app's own process only, after your own `NODE_OPTIONS` value, which is kept",
    "Codebook never installs or changes the app's dependencies",
    "an app's own source and its libraries may be in different served scripts",
    '`script-off-origin`',
    '`too-many-scripts`',
    '`script-too-large`',
    '`node-version-unreadable`',
    'works on react-scripts 4 too',
    "a stop in the library's checked-out source pauses there as on react-scripts 5",
    "extends `ambiguous-source` to a file named by two served scripts' maps",
    'API 1.41 is additive:',
  ])
    assert.ok(readme.includes(phrase), phrase)
})

// Value: protects=the README and the help tell the learner which scripts the reader counts, where the learner's NODE_OPTIONS comes from, that an unapplied redirect stops before the browser opens, and that a new run without library uses the installed copy; fails_when=any of these sentences leaves the README or the help, or the README says the installed copy ran; no_claim=that the reader or the run behaves so
test('the README and help state the script scope, the NODE_OPTIONS source and the stop on an unapplied redirect', async (context) => {
  // Arrange
  const readme = await readPackaged('README.md')
  const help = await readHelp(context)
  const section = help.reactScriptsQuickStart as ReactScriptsQuickStart & {
    library: { limits: string[] }
  }
  // Act
  const limitText = section.limits.join('\n')
  const libraryLimitText = section.library.limits.join('\n')
  // Assert
  for (const phrase of [
    "under the page's webpack output folder (`static/js/`)",
    'an `env-config.js` in `public/`, are ignored',
    'counts only those same-origin scripts',
    "that value is the start script's `NODE_OPTIONS=` assignment, else the editor's environment",
    'a react-scripts 5 run keeps its environment as before',
    'the start stops with `library-redirect-not-applied` before the browser opens',
    'nothing ran on the installed copy',
    'a new run without `library` uses the installed copy',
    'A file named by the source maps of two different served scripts is refused `ambiguous-source`',
  ])
    assert.ok(readme.includes(phrase), phrase)
  assert.equal(
    readme.includes('says the Example ran its installed copy'),
    false,
  )
  for (const phrase of [
    "under the page's webpack output folder (static/js/)",
    'ignores other scripts such as an env-config.js in public/',
    "the NODE_OPTIONS= assignment of the start script, else the editor's environment",
  ])
    assert.ok(limitText.includes(phrase), phrase)
  assert.ok(libraryLimitText.includes('nothing ran on the installed copy'))
  assert.ok(
    libraryLimitText.includes(
      "Codebook hands webpack the packed library's own source maps and a stop in its checked-out source seals as on react-scripts 5",
    ),
  )
})

// Value: protects=the ambiguous-source help and the react-scripts-version help name both maps case and the requiredMajor / supportedMajors meaning, and the start guide names API 1.41 for react-scripts 4; fails_when=a sentence leaves the help; no_claim=that the reader raises the reason
test('the help words ambiguous-source for two maps, requiredMajor as the newest major and API 1.41 in the start guide', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const section = help.reactScriptsQuickStart
  // Act
  const ambiguous =
    section.refusals.REACT_SCRIPTS_SEAL_FAILED?.reasons['ambiguous-source'] ??
    ''
  const versionReason =
    section.refusals.REACT_SCRIPTS_UNSUPPORTED?.reasons[
      'react-scripts-version'
    ] ?? ''
  // Assert
  assert.ok(ambiguous.includes('one map lists it twice'))
  assert.ok(
    ambiguous.includes("two different served scripts' maps both name it"),
  )
  assert.ok(
    versionReason.includes('details.requiredMajor names the newest one'),
  )
  assert.ok(
    versionReason.includes(
      'details.supportedMajors lists the supported majors',
    ),
  )
  assert.ok(
    String(help.startHere).includes('react-scripts 4 needs API 1.41 or later'),
  )
})
