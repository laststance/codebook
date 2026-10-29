import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { test } from 'node:test'

import { chromeExtensionConfigSchema } from '../chromeExtensionConfigSchemas'
import {
  CHROME_EXTENSION_HELP_EVENTS,
  chromeExtensionHelp,
} from '../chromeExtensionHelp'
import { CHROME_EXTENSION_SAVE_REFUSAL } from '../constants'
import { ERROR_RECOVERY, StudyError } from '../errors'
import { readResource } from '../resources'
import { CHROME_EXTENSION_EVENT_TYPES } from '../utils/chromeExtensionEventDetail'

import { createHarness } from './helpers'

/** The book selection a real start copies from `codebook_publish_book`, replacing the help's placeholders. */
const REAL_BOOK = {
  bookId: 'interface',
  revision: 1,
  nodeId: 'theme',
  anchorIndex: 0,
}

/** Every code whose recovery in errors.ts names this help's anchor, as the profile's own codes. */
const OWN_CODES = Object.entries(ERROR_RECOVERY)
  .filter(([code, recovery]) =>
    recovery.includes(`codebook://help/chrome-extension#${code}`),
  )
  .map(([code]) => code)

// protects=DXR2: the help opens with the quick start before any reference section; fails_when=the schema or a table comes before the quick start; no_claim=the wording of the sections
test('the help puts the quick start before the configuration schema and the reference sections', () => {
  // Arrange, Act
  const sections = Object.keys(chromeExtensionHelp())
  // Assert
  assert.deepEqual(sections.slice(0, 4), [
    'profile',
    'quickStart',
    'configurationSchema',
    'vocabulary',
  ])
  assert.equal(sections.includes('workedExample'), true)
})

// protects=DXR2: the minimal declaration of the quick start parses with the final schema once its placeholders are replaced; fails_when=the example drifts from chromeExtensionConfigSchema; no_claim=that the extension exists
test('the quick start declaration parses with the final configuration schema', () => {
  // Arrange
  const { example } = chromeExtensionHelp().quickStart
  // Act
  const parsed = chromeExtensionConfigSchema.parse({
    ...example.configuration,
    book: REAL_BOOK,
  })
  // Assert
  assert.equal(example.profile, 'chrome-extension')
  assert.equal(parsed.surface.kind, 'popup')
  assert.deepEqual(parsed.observe, { kind: 'popup' })
  assert.equal(parsed.clicks.length, 1)
  assert.equal(parsed.stops.length, 1)
})

// protects=SR27: the worked example is a generic ping extension whose declaration parses and whose stop lines point at the marked lines of its listing; fails_when=the lines drift from the listing or the example names a real repository's code; no_claim=Chrome's behaviour
test('the worked example parses and its stops point at the lines of its listing', () => {
  // Arrange
  const { workedExample } = chromeExtensionHelp()
  // Act
  const parsed = chromeExtensionConfigSchema.parse({
    ...workedExample.start.configuration,
    book: REAL_BOOK,
  })
  // Assert
  assert.deepEqual(parsed.stops, [
    { path: 'popup.js', line: 2, context: 'page' },
    { path: 'background.js', line: 3, context: 'service-worker' },
  ])
  assert.match(workedExample.files['popup.js'][1], /STOP page/)
  assert.match(workedExample.files['background.js'][2], /STOP worker/)
})

// protects=DXR2 and ER24: the code table has one anchor per registered chrome-extension code with its recovery text, plus the shared codes the profile answers; fails_when=a registered code is missing, an anchor is wrong or a recovery drifts from errors.ts; no_claim=the per-code sentences, tested where each code is raised
test('the refusal table has one anchor and the registered recovery for every chrome-extension code', () => {
  // Arrange
  const { codes } = chromeExtensionHelp()
  // Act
  const listed = codes.map((entry) => entry.code)
  // Assert
  assert.equal(OWN_CODES.length >= 30, true)
  for (const code of OWN_CODES) {
    const entry = codes.find((candidate) => candidate.code === code)
    assert.equal(entry?.anchor, `codebook://help/chrome-extension#${code}`)
    assert.equal(
      entry?.recovery,
      ERROR_RECOVERY[code as keyof typeof ERROR_RECOVERY],
    )
  }
  for (const shared of [
    'LEARNER_PAUSED',
    'IDEMPOTENCY_CONFLICT',
    'BUSY',
    'STALE_PAUSE',
    'NO_PAUSE',
    'RUN_NOT_READY',
  ])
    assert.equal(listed.includes(shared), true)
  assert.equal(new Set(listed).size, listed.length)
})

// protects=DXR6: an error of the profile reaches an agent with its registered recovery text and a bearer token and the home path masked; fails_when=a code loses its recovery, the token survives or the home path is named; no_claim=the code's own sentence
test('every chrome-extension code reaches the agent with its recovery and a masked cause', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const cause = `Authorization: Bearer abcdefghijklmnop1234567890 at ${homedir()}/secret-folder/extension.js`
  // Act, Assert
  for (const code of OWN_CODES) {
    const described = harness.service
      .unexpectedFailure(
        new StudyError(
          code as keyof typeof ERROR_RECOVERY,
          'It failed.',
          cause,
        ),
      )
      .describe()
    assert.equal(described.code, code)
    assert.equal(
      described.recovery,
      ERROR_RECOVERY[code as keyof typeof ERROR_RECOVERY],
    )
    assert.equal(described.cause.includes('abcdefghijklmnop1234567890'), false)
    assert.equal(described.cause.includes(homedir()), false)
  }
})

// protects=SR21: the help says the profile is a fresh one with seeded test data and that the learner's own Chrome data is never used, and that the extension's own code runs as in any local run; fails_when=either D5 sentence is missing or reworded; no_claim=how the profile is created
test('the help states both D5 sentences', () => {
  // Arrange, Act
  const { disclosures } = chromeExtensionHelp()
  // Assert
  assert.equal(
    disclosures.testProfile,
    "The run's browser profile is a fresh one with seeded test data; the learner's own Chrome data (bookmarks, cookies, passwords, extensions) is never used.",
  )
  assert.equal(
    disclosures.extensionCode,
    "The extension's own code, including its network requests, runs as it would in any local run, with the permissions its manifest declares; codebook_start answers the manifest's name, permissions and host_permissions so the learner can be told.",
  )
})

// protects=CR10 and the contract note: the help discloses the worker restarts and that the debugging port is reachable by any local process while the run lives; fails_when=either disclosure is missing; no_claim=the interventions the run makes
test('the help discloses the worker restarts and the reachable debugging port', () => {
  // Arrange, Act
  const { disclosures } = chromeExtensionHelp()
  // Assert
  assert.match(
    disclosures.workerRestart,
    /^Codebook restarts the extension's service worker before the clicks/,
  )
  assert.match(
    disclosures.debuggingPort,
    /any local process of the same user can reach it while the run lives/,
  )
})

// protects=CR2: the help names codebook.chromeExecutable with Chrome for Testing 149 or later; fails_when=the setting or the version is missing; no_claim=the setting's effect
test('the help names codebook.chromeExecutable with Chrome 149', () => {
  // Arrange, Act
  const { disclosures } = chromeExtensionHelp()
  // Assert
  assert.equal(
    disclosures.chromeExecutable,
    'Chrome 149 or later is needed. Set the VS Code setting codebook.chromeExecutable to Google Chrome or to Chrome for Testing 149 or later when the default Chrome is older or missing (CHROME_VERSION_UNSUPPORTED, CHROME_COMMAND_UNAVAILABLE).',
  )
})

// protects=DXR8: the vocabulary names the profile, action, participant, contexts, adapter and the 1-based index rule, and a phase table relates each phase to the click outcome; fails_when=a term or the phase table is missing; no_claim=the run's phases
test('the help states the vocabulary, the one-based index rule and the phase to click outcome table', () => {
  // Arrange, Act
  const help = chromeExtensionHelp()
  // Assert
  assert.deepEqual(
    help.vocabulary.map((entry) => entry.term),
    [
      'profile',
      'action',
      'participant',
      'contexts',
      'adapter',
      'surface',
      'index base',
    ],
  )
  assert.match(
    help.vocabulary[6]?.meaning ?? '',
    /^Every index in answers, the run resource and sentences is 1-based/,
  )
  assert.deepEqual(
    help.phases.map((entry) => entry.phase.split(',')[0]),
    ['starting', 'ready', 'paused', 'observing', 'completed', 'failed'],
  )
})

// protects=DXR14: three failure examples each show what was sent, the answer and the corrected declaration; fails_when=an example is missing or names no code or correction; no_claim=that the refusal is raised for the example
test('the help shows three failure examples with the refusal and the correction', () => {
  // Arrange, Act
  const { failureExamples } = chromeExtensionHelp()
  // Assert
  assert.deepEqual(
    failureExamples.map((example) => example.name),
    [
      'A stop in a bundled file',
      'A worker stop on startup code',
      'A popup surface in a manifest without action.default_popup',
    ],
  )
  assert.equal(failureExamples[0]?.answer.code, 'BUNDLED_EXTENSION_UNSUPPORTED')
  assert.equal(
    failureExamples[2]?.answer.message,
    'The manifest declares no popup.',
  )
  assert.match(
    failureExamples[1]?.answer.message ?? '',
    /stopsNotReached: \[1\]/,
  )
})

// protects=ER24: the help's event list is the run's journal whitelist, each type with the fields it publishes and when it is written; fails_when=an event reaches the journal without a help line, the help lists an event the journal never writes, or a row's fields drift from what the journal publishes; no_claim=the wording of each line
test('the help lists every journal event the run writes, with its published fields and when it is written', () => {
  // Arrange, Act
  const { events } = chromeExtensionHelp()
  // Assert
  assert.deepEqual(
    events.map((event) => [event.type, event.fields]),
    [
      ['chrome-extension.click', 'clickIndex, selector'],
      ['chrome-extension.output', 'context, text'],
      ['chrome-extension.output-dropped', 'count'],
      ['chrome-extension.prepare-pause', 'path, line, context'],
      ['chrome-extension.repeat-hit', 'stopIndex, path, line'],
      ['chrome-extension.surface-lost', 'surface'],
      ['chrome-extension.context-mismatch', 'stopIndex, context'],
      ['chrome-extension.intervention', 'kind, time'],
      ['chrome-extension.phase', 'name, elapsedMs'],
      ['chrome-extension.dialog', 'type, answer, message'],
      ['chrome-extension.debugger-error', 'message'],
      ['chrome-extension.view-unavailable', 'message'],
    ],
  )
  assert.deepEqual(
    events.map((event) => event.type),
    CHROME_EXTENSION_EVENT_TYPES,
  )
  assert.deepEqual(
    events.filter((event) => event.when === '').map((event) => event.type),
    [],
  )
  assert.equal(events, CHROME_EXTENSION_HELP_EVENTS)
})

// protects=the help resource is readable at codebook://help/chrome-extension as JSON with the same sections; fails_when=the URI is not routed; no_claim=the MCP transport
test('codebook://help/chrome-extension reads as the help JSON', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  // Act
  const resource = await readResource(
    harness.service,
    'codebook://help/chrome-extension',
  )
  // Assert
  if (!('text' in resource)) throw new Error('The help is text.')
  const help = JSON.parse(resource.text)
  assert.equal(help.profile, 'chrome-extension')
  assert.equal(resource.mimeType, 'application/json')
  assert.equal(help.quickStart.callOrder.length, 8)
})

// protects=B1: the help's limits line quotes the save refusal from its constant; fails_when=the help retypes a sentence that drifts from the answer the tools give; no_claim=the rest of the limits
test('the help limits quote the save refusal sentence exactly', () => {
  // Arrange, Act
  const help = JSON.stringify(chromeExtensionHelp())
  // Assert
  assert.equal(help.includes(CHROME_EXTENSION_SAVE_REFUSAL), true)
  assert.equal(
    CHROME_EXTENSION_SAVE_REFUSAL,
    'Saving an extension run is not available in this version; the live explanation stays in the chat.',
  )
})
