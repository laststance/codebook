import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  apiServerExitedRefusal,
  apiServerListenerNotOwnedRefusal,
  apiServerNotListeningRefusal,
  apiServerPortOwnerUnknownRefusal,
  apiServerPortUnavailableRefusal,
  apiServerRuntimeFailedRefusal,
  apiServerSourceRefusal,
} from '../apiServerRefusals'
import { EXPO_WEB_API_SERVER_MINIMUM_API } from '../constants'
import { EXPO_WEB_API_SERVER_CONFIGURATION, expoWebHelp } from '../expoWebHelp'
import { liveRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { readResource } from '../resources'

import { createHarness } from './helpers'

type ApiServerHelp = ReturnType<
  typeof expoWebHelp
>['expoWebQuickStart']['apiServer']

/**
 * Reads the served repository-browser help as an agent does and returns its `apiServer` section with the raw text.
 * @param context - Test context that closes the harness.
 * @returns The parsed `expoWebQuickStart.apiServer` section and the whole served text.
 * @example
 * const { section } = await readApiServerHelp(context) // => { section: { minimumApi: '1.37', … }, text: '{…}' }
 */
async function readApiServerHelp(context: TestContext) {
  const harness = await createHarness()
  context.after(() => harness.close())
  const resource = await readResource(
    harness.service,
    'codebook://help/repository-browser',
  )
  const text = 'text' in resource ? resource.text : '{}'
  const help = JSON.parse(text) as {
    expoWebQuickStart: { apiServer: ApiServerHelp }
  }
  return { section: help.expoWebQuickStart.apiServer, text }
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

// Value: protects=a chat that copies the apiServer example sends a configuration the live schema accepts; fails_when=the example drifts from the schema (a renamed apiServer field, a server stop outside the API folder, afterOperation 0); why_new=API 1.37 adds the declaration; seam=none; no_claim=that a run with it succeeds
test('the apiServer help example parses with the live configuration schema', () => {
  // Arrange
  const example = EXPO_WEB_API_SERVER_CONFIGURATION
  // Act
  const parsed = liveRepositoryConfigSchema.safeParse(example)
  // Assert
  assert.equal(parsed.success, true)
  assert.equal(example.apiServer.packageRoot, 'apps/my-api')
  assert.equal(example.participant, 'server')
  assert.equal(example.afterOperation, 1)
})

// Value: protects=the repository-browser help serves the apiServer section with minimumApi 1.37, the version check, the derivation rule and the limits a chat must relay; fails_when=the section is not spread into the help, or the derivation rule, the version check, the no-watcher, every-interface, entry-load, source-map or one-process limit disappears; why_new=API 1.37 adds the section; seam=none; no_claim=that the refusals fire
test('the repository-browser help serves the apiServer section with its version gate, derivation rule and limits', async (context) => {
  // Arrange
  const { section } = await readApiServerHelp(context)
  // Act
  const limitText = section.limits.join('\n')
  const derivationText = Object.values(section.derivation).join('\n')
  // Assert
  assert.equal(EXPO_WEB_API_SERVER_MINIMUM_API, '1.37')
  assert.equal(section.minimumApi, '1.37')
  assert.equal(section.anchor, 'codebook://help/repository-browser#api-server')
  assert.deepEqual(section.configuration, EXPO_WEB_API_SERVER_CONFIGURATION)
  assert.ok(
    section.versionCheck.includes(
      'only when codebook_status reports API 1.37 or later',
    ),
  )
  assert.ok(
    section.versionCheck.includes('refuses the key as an unknown field'),
  )
  for (const phrase of [
    "outside the app's folder",
    'prefer the TypeScript source the dev script runs through tsx',
    'source-unverifiable',
    'Codebook never sets PORT or any variable',
    'never from a guess',
  ])
    assert.ok(
      derivationText.toLowerCase().includes(phrase.toLowerCase()),
      phrase,
    )
  for (const phrase of [
    "without the script's watcher",
    'not reloaded',
    'the source that ran',
    'possibly on every network interface',
    'Entry-load API stops are not supported',
    'absolute path with no sourceRoot',
    'One API process per run',
    "its own .env plus Codebook's node-server allowlist",
    'never starts databases',
  ])
    assert.ok(limitText.includes(phrase), phrase)
  assert.ok(
    section.order
      .join('\n')
      .includes(
        'api-server-launch (the API starts with an inspector), api-server-attach',
      ),
  )
  assert.ok(section.order.join('\n').includes('api-server-listen'))
})

// Value: protects=the chat relays the attribution sentence and never names a request for an unattributed pause; the pause publication delay is stated; fails_when=the relay rule, the never-name rule or the one-second delay disappears; why_new=API 1.37 adds apiRequest; seam=none; no_claim=how a chat words the sentence
test('the apiServer help tells the chat to relay apiRequest.sentence and never name an unattributed request', async (context) => {
  // Arrange
  const { section } = await readApiServerHelp(context)
  // Act
  const attribution = section.attribution.join('\n')
  // Assert
  assert.ok(attribution.includes('Relay apiRequest.sentence as it is'))
  assert.ok(
    attribution.includes('Never name a request for an unattributed pause'),
  )
  assert.ok(attribution.includes('about 1 s after the debugger reports it'))
  assert.ok(
    attribution.includes(
      'do not continue before its state reads paused-server',
    ),
  )
  assert.ok(attribution.includes('the continueArguments it carries'))
  assert.ok(!attribution.includes('reads ready'))
  assert.ok(section.studies.includes('study format 19 (.study.v19.json)'))
  assert.ok(
    section.studies.includes(
      'An older Codebook lists a format 19 study as saved by a newer Codebook',
    ),
  )
})

// Value: protects=every reused node-server code the API path raises has an api-server-<CODE> anchor in the help, and the recovery of the real refusal points at that same anchor; fails_when=a factory points at an anchor the help does not serve, or the help lacks a code; why_new=DX-11 gives each reused code an anchor per participant; seam=none; no_claim=the factories' wording
test('every refusal the API path raises points at an api-server anchor that the help serves', async (context) => {
  // Arrange
  const { section } = await readApiServerHelp(context)
  const raised = [
    apiServerSourceRefusal("node-server's entry src/server.ts is missing."),
    apiServerPortUnavailableRefusal(4000),
    apiServerListenerNotOwnedRefusal('Another process holds it.', 4000),
    apiServerPortOwnerUnknownRefusal('lsof is missing.', 4000),
    apiServerNotListeningRefusal(4000, 'api-server-listen'),
    apiServerExitedRefusal({ exitCode: 1, signal: null }, ''),
    apiServerRuntimeFailedRefusal(
      'api-server-attach',
      'refused',
      'codebook://run/1/journal',
    ),
  ]
  // Act
  const pairs = raised.map((error) => ({
    code: error.code,
    anchor: section.refusals[error.code]?.anchor ?? '',
    recovery: error.describe().recovery,
  }))
  // Assert
  assert.deepEqual(
    pairs.map((pair) => pair.code),
    [
      'NODE_SERVER_SOURCE_REFUSED',
      'PORT_UNAVAILABLE',
      'LISTENER_NOT_OWNED',
      'PORT_OWNER_UNKNOWN',
      'SERVER_NOT_LISTENING',
      'SERVER_EXITED',
      'RUNTIME_FAILED',
    ],
  )
  for (const pair of pairs) {
    assert.equal(
      pair.anchor,
      `codebook://help/repository-browser#api-server-${pair.code}`,
    )
    assert.ok(pair.recovery.includes(pair.anchor), pair.code)
  }
  assert.deepEqual(
    Object.keys(section.refusals),
    pairs.map((pair) => pair.code),
  )
})

// Value: protects=the RUNTIME_FAILED help lists all five api steps and tells which of them started nothing; fails_when=a step (api-server-check, api-server-listen) is missing or the none/partial split disappears; why_new=review F8; seam=none; no_claim=that each step raises it
test('the RUNTIME_FAILED help lists every api-server step and what had started at each', async (context) => {
  // Arrange
  const { section } = await readApiServerHelp(context)
  // Act
  const meaning = section.refusals.RUNTIME_FAILED?.meaning ?? ''
  // Assert
  for (const step of [
    'api-server-check',
    'api-server-launch',
    'api-server-attach',
    'api-server-release',
    'api-server-listen',
  ])
    assert.ok(meaning.includes(step), step)
  assert.ok(
    meaning.includes(
      'At api-server-check nothing started (details.sideEffects: none)',
    ),
  )
  assert.ok(
    meaning.includes(
      'the API was stopped first (details.sideEffects: partial)',
    ),
  )
})

// Value: protects=the help words the three new Expo reasons with the fix and what started; fails_when=api-port-conflict, source-drift or source-unverifiable keeps a placeholder or loses its side-effect sentence; why_new=API 1.37 adds the reasons; seam=none; no_claim=that the refusals fire
test('the Expo help words api-port-conflict, source-drift and source-unverifiable with the fix and what started', () => {
  // Arrange
  const { refusals } = expoWebHelp().expoWebQuickStart
  // Act
  const reasonOf = (
    code: 'EXPO_WEB_UNSUPPORTED' | 'EXPO_WEB_SEAL_FAILED',
    name: string,
  ): string =>
    Object.entries(refusals[code]?.reasons ?? {}).find(
      ([reason]) => reason === name,
    )?.[1] ?? ''
  const conflict = reasonOf('EXPO_WEB_UNSUPPORTED', 'api-port-conflict')
  const drift = reasonOf('EXPO_WEB_SEAL_FAILED', 'source-drift')
  const unverifiable = reasonOf('EXPO_WEB_SEAL_FAILED', 'source-unverifiable')
  // Assert
  assert.ok(conflict.includes('Nothing started (details.sideEffects: none)'))
  assert.ok(conflict.includes('never guess'))
  assert.ok(drift.includes('publish the book again'))
  assert.ok(drift.includes('details.sideEffects: partial'))
  assert.ok(unverifiable.includes('a prebuilt entry (dist)'))
  assert.ok(unverifiable.includes('the TypeScript source'))
  assert.ok(unverifiable.includes('details.sideEffects: partial'))
})

// Value: protects=the skill sends a chat to expoWebQuickStart.apiServer behind the API 1.37 gate and forbids starting the API; the README states the learner-visible behavior and limits; fails_when=the skill sentence, the gate, the never-start rule or a README sentence disappears; why_new=AGENTS.md needs a README sentence per CHANGELOG behavior; seam=none; no_claim=how a chat follows the skill
test('the skill and the README describe the Expo apiServer run, its gate and its limits', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  const readme = await readPackaged('README.md')
  // Act
  const start = readme.indexOf('**Run the app with its own Node API')
  const section = readme.slice(
    start,
    readme.indexOf(' Codebook does not reload', start),
  )
  // Assert
  for (const phrase of [
    '`expoWebQuickStart.apiServer`',
    'declare `apiServer`',
    'only when `codebook_status` reports API 1.37 or later',
    'never start the API yourself',
    "Codebook starts the API's entry with the repository's own tsx",
    "uses the repository's configured services",
    'the declared operations can change its data',
  ])
    assert.ok(skill.includes(phrase), phrase)
  assert.ok(start > 0)
  for (const phrase of [
    'MCP API 1.37',
    'apiServer: { packageRoot, entry, loader?, port }',
    "pauses in the API's own source during the request the page sends",
    'study format 19',
    'matched by time and not read inside the API',
    'about one second',
    'without a file watcher',
    'possibly on every network interface',
    '(`afterOperation` 0) is not',
    '`source-unverifiable`',
    'never starts databases or other services',
    "The API's refusals reuse the node-server codes",
    '`RUNTIME_FAILED`) with `details.participant: "apiServer"`',
    'an anchor in `codebook://help/repository-browser`',
  ])
    assert.ok(section.includes(phrase), phrase)
  assert.ok(
    readme.includes(
      'with **MCP API 1.37** (`codebook_status` reports the installed build). API 1.37 is additive:',
    ),
  )
  assert.ok(readme.includes('format 19 (`.study.v19.json`)'))
})

// Value: protects=no value of the trial project that motivated the cycle appears in the help, the skill or the README (no answer key); fails_when=a project folder, file or port is copied into the docs; why_new=examples must stay neutral placeholders; seam=none; no_claim=that the placeholders match any repository
test('the help, skill and README contain no value of the validation project', async (context) => {
  // Arrange
  const { text } = await readApiServerHelp(context)
  const skill = await readPackaged('skills/codebook/SKILL.md')
  const readme = await readPackaged('README.md')
  const denylist = ['switch-time', 'switches.ts', '4100', '4101']
  // Act
  const bodies: Array<[string, string]> = [
    ['help', text],
    ['skill', skill],
    ['readme', readme],
  ]
  const hits = denylist.flatMap((value) =>
    bodies
      .filter(([, body]) => body.includes(value))
      .map(([name]) => `${name}:${value}`),
  )
  // Assert
  assert.deepEqual(hits, [])
})

// Value: protects=a chat asked about a signed-in screen of an Expo app below the repository root learns it can sign in within the run instead of concluding Codebook cannot record it; fails_when=the signInInRun steps, the limit sentences that point to them, the skill sentence or the README sentence disappear; why_new=Cycle 0099 native check found the chat refusing this question; seam=none; no_claim=that a real sign-in run succeeds
test('the Expo help, skill and README say a signed-in screen is reached by signing in within the run', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const resource = await readResource(
    harness.service,
    'codebook://help/repository-browser',
  )
  const help = JSON.parse('text' in resource ? resource.text : '{}') as {
    expoWebQuickStart: {
      limits: string[]
      apiServer: { signInInRun: string[] }
    }
  }
  const steps = help.expoWebQuickStart.apiServer.signInInRun.join('\n')
  const limits = help.expoWebQuickStart.limits.join('\n')
  const skill = await readPackaged('skills/codebook/SKILL.md')
  const readme = await readPackaged('README.md')
  // Act
  const hasEveryStep = [
    "Set entryPath to the app's sign-in page",
    'do not declare that page in signInPaths',
    'secret: "ask-learner"',
    'afterOperation is the index of that last click',
    'NAVIGATION_BEFORE_LAST_OPERATION',
  ].every((phrase) => steps.includes(phrase))
  // Assert
  assert.equal(hasEveryStep, true)
  assert.match(limits, /see apiServer\.signInInRun/)
  assert.match(limits, /sign in within the run \(apiServer\.signInInRun\)/)
  assert.match(skill, /sign in through the app's own form within the run/)
  assert.match(
    readme,
    /reached by signing in through the app's own form within the run, with no saved session/,
  )
})
