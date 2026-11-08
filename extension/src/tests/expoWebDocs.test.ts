import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  API_VERSION,
  EXPO_WEB_APP_SELECTION_RULE,
  EXPO_WEB_MINIMUM_API,
} from '../constants'
import { EXPO_WEB_NESTED_CONFIGURATION, expoWebHelp } from '../expoWebHelp'
import {
  EXPO_WEB_REFUSAL_CODES,
  EXPO_WEB_REFUSAL_REASONS,
} from '../expoWebRefusals'
import { reactScriptsHelp } from '../reactScriptsHelp'
import { readResource } from '../resources'

import { createHarness } from './helpers'

type ExpoWebQuickStart = ReturnType<typeof expoWebHelp>['expoWebQuickStart']

/**
 * Reads the served repository-browser help as an agent does.
 * @param context - Test context that closes the harness.
 * @returns The parsed help with the `expoWebQuickStart` key and `startHere`.
 * @example
 * const help = await readHelp(context) // => { startHere: '…', expoWebQuickStart: {…} }
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
    expoWebQuickStart: ExpoWebQuickStart
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

// Value: protects=DX-9 the served help carries expoWebQuickStart with its anchor, minimum API, the shared selection rule, the nested example and the status fields, and startHere sends a chat to it; fails_when=the section is not spread into the help, the rule drifts from the constant, or startHere forgets it; why_new=a new help section; seam=none; no_claim=that a run with the example succeeds
test('the repository-browser help serves expoWebQuickStart with its rule, example and status fields', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const section = help.expoWebQuickStart
  // Assert
  assert.equal(EXPO_WEB_MINIMUM_API, '1.30')
  assert.equal(section.minimumApi, '1.30')
  assert.equal(
    section.anchor,
    'codebook://help/repository-browser#expo-web-quick-start',
  )
  assert.equal(section.selectionRule, EXPO_WEB_APP_SELECTION_RULE)
  assert.deepEqual(section.configurationNested, EXPO_WEB_NESTED_CONFIGURATION)
  assert.equal(EXPO_WEB_NESTED_CONFIGURATION.adapter, 'expo-web-dev')
  assert.equal(
    EXPO_WEB_NESTED_CONFIGURATION.source.path,
    'apps/my-app/src/app/index.tsx',
  )
  for (const missing of [
    'expo-installed',
    'expo-sdk',
    'web-dependencies',
    'web-platform',
    'dynamic-config',
    'server-output',
    'web-script',
    'pre-script',
    'not-an-expo-app',
  ])
    assert.ok(section.status.packages.includes(missing), missing)
  assert.ok(
    section.status.packages.includes(
      '{ packageRoot, installed, ready, version?, missing[], webScript?, port? }',
    ),
  )
  assert.ok(help.startHere.includes('expoWebQuickStart'))
  assert.ok(help.startHere.includes(EXPO_WEB_APP_SELECTION_RULE))
})

// Value: protects=DX-3 the help has one anchor per Expo refusal code and one reason text per factory reason, each saying what started; fails_when=a code or reason lacks its text, or a text drops the side-effect sentence; why_new=Expo's refusal table is new; seam=none; no_claim=the factories' own wording
test('the Expo help lists every refusal code and reason with what started', () => {
  // Arrange
  const { refusals } = expoWebHelp().expoWebQuickStart
  // Act
  const codes = Object.keys(refusals)
  // Assert
  assert.deepEqual(codes, [...EXPO_WEB_REFUSAL_CODES])
  for (const code of EXPO_WEB_REFUSAL_CODES) {
    const entry = refusals[code]
    assert.ok(entry, code)
    assert.equal(entry.anchor, `codebook://help/repository-browser#${code}`)
    assert.deepEqual(Object.keys(entry.reasons), [
      ...EXPO_WEB_REFUSAL_REASONS[code],
    ])
    for (const [reason, text] of Object.entries(entry.reasons))
      assert.ok(
        text.includes('Nothing started') ||
          text.includes('The owned server was stopped') ||
          text.includes('details.sideEffects'),
        `${code} ${reason}`,
      )
  }
})

// Value: protects=DX-6 DX-7 E-5 E-13 the help states the limits a chat must relay (browser stops only, SDK 57, app.json only, the script grammar, what Codebook sets, the handler-body line rule with React Compiler names, sign-in needs the app's own API) and the study format 15 sentence; fails_when=a limit or the line rule disappears; why_new=Expo's limits are new; seam=none; no_claim=that the refusals fire
test('the Expo help states its limits, the line rule, the sign-in note and the format 15 study', () => {
  // Arrange
  const section = expoWebHelp().expoWebQuickStart
  // Act
  const limitText = section.limits.join('\n')
  // Assert
  for (const phrase of [
    'Browser stops only unless apiServer is declared (API 1.37, see apiServer): participant "server" without it and a stop in an Expo Router API route (`+api.*`, such as `+api.ts`) are refused',
    'Only Expo SDK 57 is supported',
    'Only app.json is read',
    'exactly expo start --web, optionally with --port N or -p N and NAME=value assignments',
    'a preweb or prestart script',
    'CI=1, BROWSER=none and EXPO_NO_TELEMETRY=1',
    'It does not reload the app during a run',
    "declare it on a statement inside the handler's body",
    'React Compiler names such as t6',
    "A screen behind sign-in needs the app's own API: declare apiServer when the API is a Node server in the repository; otherwise tell the learner to start it",
    "never as Codebook's failure",
    'not-in-entry-bundle',
    'binds Metro to the loopback address only (--localhost)',
    'a bundle over 16 MiB cannot be read in Cursor',
    'A saved-session setup does not start Expo',
    'SIGN_IN_REQUIRED',
    'initialStorage or explain from the source',
  ])
    assert.ok(limitText.includes(phrase), phrase)
  assert.ok(
    section.studies.includes(
      'study format 15 (.study.v15.json) with its retained configuration and expoVersion',
    ),
  )
  assert.ok(
    section.studies.includes(
      'An older Codebook lists a format 15 study as saved by a newer Codebook',
    ),
  )
  assert.ok(
    section.summary.includes('Never start Metro or expo start yourself'),
  )
  // The nested packages entry also makes the adapter usable
  assert.ok(section.summary.includes('or the packages entry of the app'))
  assert.equal(limitText.includes('P08'), false)
  assert.equal(limitText.includes('7.5 MB'), false)
})

// Value: protects=the refusal reason texts state the fast refusals (an entry page that answers an error or names no or several web bundles, and a source map reference outside the app's server) so a chat does not wait for the setup deadline; fails_when=either sentence disappears; why_new=fixer F-A refuses these at once; seam=none; no_claim=that the refusal fires
test('the Expo help words the at-once bundle refusal and the foreign map reference', () => {
  // Arrange
  const { refusals } = expoWebHelp().expoWebQuickStart
  // Act
  const reasonOf = (
    code: 'EXPO_WEB_LAUNCHER_FAILED' | 'EXPO_WEB_SEAL_FAILED',
    name: string,
  ): string =>
    Object.entries(refusals[code]?.reasons ?? {}).find(
      ([reason]) => reason === name,
    )?.[1] ?? ''
  const bundle = reasonOf('EXPO_WEB_LAUNCHER_FAILED', 'bundle-failed')
  const map = reasonOf('EXPO_WEB_SEAL_FAILED', 'map-unreadable')
  // Assert
  assert.ok(
    bundle.includes(
      'entry page answers an error, or names no web bundle or several: the run is refused at once, not at the setup deadline',
    ),
  )
  assert.ok(map.includes("a source map reference outside the app's own server"))
})

// Value: protects=the MCP instructions name the fourth adapter expo-web-dev since API 1.30, quote its selection rule, forbid starting Metro and gate it on the API; the API note names the adapter, its codes and format 15; fails_when=the adapter, the rule, the gate or the API note text is dropped; why_new=API 1.30 is new; seam=none; no_claim=the rest of the instructions
test('the MCP instructions and the API note name expo-web-dev, its selection rule and the API 1.30 gate', async () => {
  // Arrange
  const protocol = await readPackaged('src/protocol.ts')
  const constants = await readPackaged('src/constants.ts')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.30 is additive')) ?? ''
  // Assert
  assert.equal(API_VERSION, '1.38')
  assert.ok(protocol.includes('${EXPO_WEB_APP_SELECTION_RULE}'))
  assert.ok(
    protocol.includes(
      'since API 1.30 its fourth adapter expo-web-dev runs an Expo SDK 57 web app (Metro)',
    ),
  )
  assert.ok(
    protocol.includes(
      'use expo-web-dev on API 1.30 or later, and on an older API tell the learner to update Codebook',
    ),
  )
  assert.ok(protocol.includes('never start Metro or expo start yourself'))
  for (const phrase of [
    '`expo-web-dev`',
    '`EXPO_WEB_UNSUPPORTED`',
    '`EXPO_WEB_SEAL_FAILED`',
    '`expoWebQuickStart`',
    'format 15 (`.study.v15.json`)',
    '`expoVersion`',
  ])
    assert.ok(note.includes(phrase), phrase)
})

// Value: protects=the README tells a learner how an Expo web app runs (adapter, readiness, port, refusals, browser-only limits, the line rule, sign-in), where its study format is announced and that API 1.30 is the current preview; fails_when=a sentence the CHANGELOG will name is missing from the packaged README; why_new=Expo's user-visible behavior is new; seam=none; no_claim=the CHANGELOG text
test('the README documents the Expo web adapter, its limits, format 15 and the API 1.30 note', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act
  const start = readme.indexOf('**Expo web apps (MCP API 1.30).**')
  const section = readme.slice(start, readme.indexOf('\n\n', start))
  // Assert
  assert.ok(start > 0)
  for (const phrase of [
    'Codebook runs an Expo app (SDK 57, served by Metro) at or below the repository root with the `expo-web-dev` adapter, in a version 3 configuration only',
    "starts the app's own Expo CLI (`expo start --web`) on the port the app's `web` script declares",
    'treats the app as ready when Metro has served the entry bundle and its source map',
    '`profiles[].prerequisites.adapters["expo-web-dev"]`',
    '`expo-installed`, `expo-sdk`, `web-dependencies`, `web-platform`, `dynamic-config`, `server-output`, `web-script`, `pre-script` and `not-an-expo-app`',
    'Codebook sets `CI=1`, `BROWSER=none` and `EXPO_NO_TELEMETRY=1`',
    'a busy port is refused as `EXPO_WEB_PORT_UNAVAILABLE`',
    'an app configured by `app.config.js` or `app.config.ts`',
    '`EXPO_WEB_SEAL_FAILED`',
    'Only browser stops are supported',
    "Declare a stop on a statement inside a handler's body",
    'React Compiler names such as `t6`',
    "a screen behind sign-in needs the app's own API running, which Codebook does not start",
    'Codebook does not reload the app during a run',
  ])
    assert.ok(section.includes(phrase), phrase)
  assert.ok(
    readme.includes('API 1.30 is additive: it adds the `expo-web-dev` adapter'),
  )
  assert.ok(
    readme.includes(
      'saves its run as study format 15 (`.study.v15.json`), which Codebook 0.2.88 and older list as saved by a newer Codebook. API 1.29 is additive:',
    ),
  )
  assert.ok(readme.includes('has four adapters'))
  assert.ok(
    readme.includes('below), `react-scripts-dev` for a Create React App'),
  )
  assert.ok(
    readme.includes('binds Metro to the loopback address only (`--localhost`)'),
  )
  assert.ok(readme.includes('a bundle over 16 MiB cannot be read in Cursor'))
  assert.equal(readme.includes('7.5 MB'), false)
  assert.equal(readme.includes('P08'), false)
  assert.ok(
    readme.includes(
      'A study of an Expo run (`expo-web-dev`) is saved as format 15 (`.study.v15.json`) with its `expoVersion`; Codebook 0.2.88 and older list it as saved by a newer Codebook, so update Codebook to open it.',
    ),
  )
  assert.ok(readme.includes("so Cursor's managed skill updates to **1.0.82**"))
})

// Value: protects=skill 1.0.82 routes an Expo app to expo-web-dev behind the API 1.30 gate, paraphrases the selection rule, forbids starting Metro or expo start and repeats the handler-body line rule; fails_when=the routing, the gate, the never-start rule or the line rule is dropped; why_new=the skill's Expo paragraph is new; seam=none; no_claim=how a chat follows the skill
test('the bundled skill 1.0.82 routes an Expo web app to expo-web-dev behind the API 1.30 gate', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act
  const start = skill.indexOf('**An Expo web app (API 1.30).**')
  const paragraph = skill.slice(start, skill.indexOf('\n\n', start))
  // Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.82"\n'))
  assert.ok(start > 0)
  for (const phrase of [
    'goes to the `expo-web-dev` adapter of the `repository-browser` profile',
    '`expoWebQuickStart`',
    'only when `codebook_status` reports API 1.30 or later and the `expo-web-dev` readiness is `ready`',
    'the repository root only when the readiness reports `rootIsApp` true',
    'a `node_modules/expo` at the root alone (a hoisted install) never makes the root the choice',
    'declare its repository-relative folder as `packageRoot`',
    'tell the learner to update Codebook and do not run the app by another route',
    'Never start Metro or `expo start` yourself',
    "Put each stop on a statement inside the handler's body",
    'React Compiler names such as `t6`',
    "report a failed request as the observed outcome, never as Codebook's failure",
  ])
    assert.ok(paragraph.includes(phrase), phrase)
  assert.ok(skill.includes('`expo-web-dev` for an Expo SDK 57 web app'))
})

// Value: protects=a chat that follows the Expo or react-scripts quick start sends the one action a version 3 run accepts; fails_when=a quick start call order names repository-click, which a version 3 run refuses with BUSY; why_new=ship review found both steps naming the version 2 action; seam=none; no_claim=the run's nextActions content
test('the Expo and react-scripts quick starts tell the chat to send repository-operation, never repository-click', () => {
  // Arrange
  const stepLists = [
    expoWebHelp().expoWebQuickStart.callOrder.join('\n'),
    reactScriptsHelp().reactScriptsQuickStart.callOrder.join('\n'),
  ]
  // Act
  const names = stepLists.map((steps) => ({
    operation: steps.includes('codebook_action repository-operation'),
    nextActions: steps.includes('nextActions'),
    click: steps.includes('repository-click'),
  }))
  // Assert
  assert.deepEqual(names, [
    { operation: true, nextActions: true, click: false },
    { operation: true, nextActions: true, click: false },
  ])
})
