import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { API_VERSION } from '../constants'
import { ERROR_RECOVERY } from '../errors'
import { nextHelp } from '../nextHelp'
import { operationsRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { readResource } from '../resources'
import {
  SERVER_RENDER_PAGES_ENTRY_CONFIGURATION,
  serverRenderHelp,
} from '../serverRenderHelp'
import { pagesServerStopRefusal } from '../utils/pagesServerStopRefusal'

import { createHarness } from './helpers'

/**
 * Reads a packaged file relative to the extension folder.
 * @param segments - Path segments below the extension folder.
 * @returns The file's text.
 * @example await readPackaged('skills', 'codebook', 'SKILL.md')
 */
function readPackaged(...segments: string[]): Promise<string> {
  return readFile(join(__dirname, '..', '..', ...segments), 'utf8')
}

/**
 * Reads the packaged README's "Server renders in a Next.js app" section, from its heading to the next second-level heading.
 * @returns The section text, or an empty text when the heading is missing.
 * @example await readServerRendersReadmeSection() // => '## Server renders in a Next.js app\n\nMinimum: **Codebook 0.2.73.0 …'
 */
async function readServerRendersReadmeSection(): Promise<string> {
  const readme = await readPackaged('README.md')
  const start = readme.indexOf('\n## Server renders in a Next.js app\n')
  if (start === -1) return ''
  const end = readme.indexOf('\n## ', start + 1)
  return readme.slice(start + 1, end === -1 ? undefined : end)
}

/**
 * Reads the bundled skill's "Server renders" paragraph.
 * @returns The paragraph, or an empty text when it is missing.
 * @example await readServerRendersSkillParagraph() // => '**Server renders (API 1.16; Pages Router data functions API 1.17).** A question …'
 */
async function readServerRendersSkillParagraph(): Promise<string> {
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  return (
    skill.split('\n\n').find((part) => part.startsWith('**Server renders')) ??
    ''
  )
}

/**
 * Reads the repository-browser help the way an agent reads it, as the served resource.
 * @param context - The test context, which closes the harness after the test.
 * @returns The parsed help object.
 * @example const help = await readServedHelp(context) // => { startHere: '…', serverRenderQuickStart: {…}, … }
 */
async function readServedHelp(context: TestContext) {
  const harness = await createHarness()
  context.after(() => harness.close())
  const resource = await readResource(
    harness.service,
    'codebook://help/repository-browser',
  )
  return JSON.parse('text' in resource ? resource.text : '{}')
}

// Value: protects=the Pages quick start's configuration is a valid version 3 configuration (an agent that copies it and fills the placeholders is not refused for its shape), uses a neutral dynamic-route placeholder with a concrete entryPath and omits operations; fails_when=the schema changes a field and the quick start keeps the old one, the example names a required project's file (it would be an answer key), or operations [] appears; no_claim=that the placeholders name real sources
test('the Pages quick-start configuration parses with the public version 3 schema and names a neutral dynamic-route placeholder', () => {
  // Arrange
  const configuration = JSON.parse(
    JSON.stringify(SERVER_RENDER_PAGES_ENTRY_CONFIGURATION),
  )
  // Act
  const result = operationsRepositoryConfigSchema.safeParse(configuration)
  // Assert
  assert.equal(result.success, true)
  assert.equal(configuration.version, 3)
  assert.equal(configuration.participant, 'server')
  assert.equal(configuration.afterOperation, 0)
  assert.equal('operations' in configuration, false)
  assert.equal(configuration.source.path, 'pages/products/[id].tsx')
  assert.equal(configuration.entryPath, '/products/1')
  assert.notEqual(configuration.source.path, 'src/pages/index.tsx')
  assert.notEqual(configuration.source.path, 'pages/index.tsx')
})

// Value: protects=the key a version 2 Pages refusal names (serverRenderQuickStart.configurationPagesEntryRender) exists in the served help with that exact path and holds the configuration the schema test parses; fails_when=the key is renamed or moved, or the refusal's message names another key; no_claim=that an agent follows the pointer
test('the served help holds serverRenderQuickStart.configurationPagesEntryRender, the key a version 2 Pages refusal names', async (context) => {
  // Arrange
  const help = await readServedHelp(context)
  const refusal = pagesServerStopRefusal({
    kind: 'version-2',
    place: 'pages/products/[id].tsx:14',
  })
  // Act
  const served = help.serverRenderQuickStart?.configurationPagesEntryRender
  // Assert
  assert.deepEqual(
    served,
    JSON.parse(JSON.stringify(SERVER_RENDER_PAGES_ENTRY_CONFIGURATION)),
  )
  assert.ok(
    refusal.message.includes(
      'serverRenderQuickStart.configurationPagesEntryRender',
    ),
  )
})

// Value: protects=the quick start opens with the router choice, read from codebook_status's routerKind, and leads to each router's own minimums, so a Pages run is never checked against API 1.16 alone; fails_when=the choice is not the first key after the anchor, the Pages entry names 0.2.73.0 or 1.16, the App Router entry loses them, or the status field path is renamed; no_claim=that codebook_status reports these values (the readiness tests pin routerKind)
test('the server-render quick start opens with a router choice that names each router its own minimums', () => {
  // Arrange
  const { serverRenderQuickStart } = serverRenderHelp()
  // Act
  const keys = Object.keys(serverRenderQuickStart)
  const { routerChoice } = serverRenderQuickStart
  // Assert
  assert.deepEqual(keys.slice(0, 3), ['anchor', 'routerChoice', 'summary'])
  assert.deepEqual(Object.keys(routerChoice), [
    'read',
    'app',
    'pages',
    'both',
    'none',
  ])
  assert.ok(
    routerChoice.read.includes(
      'profiles[].prerequisites.adapters["next-dev-webpack"].routerKind',
    ),
  )
  assert.equal(routerChoice.app.minimumExtension, '0.2.73.0')
  assert.equal(routerChoice.app.minimumApi, '1.16')
  assert.equal(routerChoice.pages.minimumExtension, '0.2.74.0')
  assert.equal(routerChoice.pages.minimumApi, '1.17')
  assert.deepEqual(routerChoice.pages.configurations, [
    'configurationPagesEntryRender',
  ])
  assert.deepEqual(routerChoice.app.configurations, [
    'configurationEntryRender',
    'configurationSearchRerender',
  ])
})

// Value: protects=the shared summary and call order check the API against the chosen router's minimum (1.16 for App Router, 1.17 for Pages Router) and the extension minimum (0.2.73.0, 0.2.74.0), and never allow a version 2 fallback; fails_when=the summary or the first call-order step names only the App Router minimum; no_claim=how an agent compares the numbers
test('the shared summary and call order name API 1.17 and Codebook 0.2.74.0 for a Pages page beside the App Router minimums', () => {
  // Arrange
  const { serverRenderQuickStart } = serverRenderHelp()
  // Act
  const { summary } = serverRenderQuickStart
  const firstStep = serverRenderQuickStart.callOrder[0] ?? ''
  // Assert
  assert.ok(
    summary.includes(
      'Codebook 0.2.73.0 or later, API 1.16 or later); for a Pages Router page',
    ),
  )
  assert.ok(summary.includes('Codebook 0.2.74.0 or later, API 1.17 or later)'))
  assert.ok(
    summary.includes('(1.17 is later than 1.9, and 1.10 is later than 1.9)'),
  )
  assert.ok(summary.includes('never fall back to configuration version 2'))
  assert.ok(
    firstStep.includes(
      '(1.16 for an App Router page, 1.17 for a Pages Router page)',
    ),
  )
})

// Value: protects=the Pages quick start tells the chat which line is a server line (a line of the entry page's getServerSideProps or getStaticProps, or a module they call), that a page component or getInitialProps line is a browser stop, and where the afterOperation rules are; fails_when=the line-choice sentence, the browser-stop rule or the pointer to configurationSearchRerender leaves the help; no_claim=that Codebook seals the line (the run tests)
test('the Pages quick start says how to choose the line and points to configurationSearchRerender for afterOperation rules', () => {
  // Arrange
  const { serverRenderQuickStart } = serverRenderHelp()
  // Act
  const lineChoice = serverRenderQuickStart.pagesLineChoice
  const afterOperation = serverRenderQuickStart.pagesAfterOperation
  // Assert
  assert.ok(
    lineChoice.includes(
      "choose a line inside the entry page's getServerSideProps or getStaticProps, or in a module they call",
    ),
  )
  assert.ok(
    lineChoice.includes(
      'A line of the page component or of getInitialProps is a browser stop: declare it with participant "browser"',
    ),
  )
  assert.ok(lineChoice.includes('never at the entry load'))
  assert.ok(afterOperation.includes('follow configurationSearchRerender'))
  assert.ok(
    afterOperation.includes(
      'under next dev that request runs getServerSideProps and also getStaticProps again',
    ),
  )
})

// Value: protects=the help states that Codebook's readiness request runs the entry page's data function once unobserved, how it is recorded, when to mention it, and the consent rule before start when the data function writes or sends; fails_when=a sentence of the readiness, side-effect or consent rule leaves the help, or the help promises a safe retry; no_claim=that the chat asks (the skill sentence is pinned apart) or that the run journals the entry (the run tests)
test('the Pages quick start states the unobserved readiness request, its journal entry and the consent rule before start', () => {
  // Arrange
  const { serverRenderQuickStart } = serverRenderHelp()
  // Act
  const readiness = serverRenderQuickStart.pagesReadinessRequest
  const sideEffects = serverRenderQuickStart.pagesSideEffects
  // Assert
  assert.ok(readiness.includes('That run is not observed and not counted'))
  assert.ok(readiness.includes('readiness.entry-request'))
  assert.ok(
    readiness.includes('timeout, aborted or connection-lost when none came'),
  )
  assert.ok(readiness.includes('a cache, a counter, a one-time initialisation'))
  assert.ok(
    readiness.includes(
      "A data function with side effects runs once more than the learner's own request.",
    ),
  )
  assert.ok(
    sideEffects.includes(
      'writes or sends (a database write, a counter, an email, a payment call), tell the learner that the run executes it at least twice',
    ),
  )
  assert.ok(
    sideEffects.includes('and ask first. Not running is the only escape'),
  )
  assert.ok(
    sideEffects.includes('reports details.sideEffects unknown, never none'),
  )
  assert.ok(sideEffects.includes('never start again unasked'))
})

// Value: protects=the chat learns what an unconfirmed pause means (the pause may come from the page's render, the attribution is said to be unconfirmed, it is never proof, and an all-unconfirmed run is stopped), and that a confirmed pause names its data function; fails_when=the unconfirmed sentence leaves the help or turns into a claim that the data function paused; no_claim=that the run labels the pause (the run tests)
test('the Pages quick start explains an unconfirmed pause and names the data function of a confirmed one', () => {
  // Arrange
  const { serverRenderQuickStart } = serverRenderHelp()
  // Act
  const unconfirmed = serverRenderQuickStart.pagesUnconfirmed
  const attribution = serverRenderQuickStart.pagesAttribution
  // Assert
  assert.ok(
    unconfirmed.includes(
      "may come from the page's render rather than its data function",
    ),
  )
  assert.ok(unconfirmed.includes('never count it as proof'))
  assert.ok(
    unconfirmed.includes(
      'When every pause of a run is unconfirmed, stop and tell the learner.',
    ),
  )
  assert.ok(
    attribution.includes('dataFunction: getServerSideProps or getStaticProps'),
  )
  assert.ok(attribution.includes('the Next version and an attribution summary'))
  assert.ok(
    attribution.includes(
      "say that a line may have run outside the entry page's data function, never that it did",
    ),
  )
})

// Value: protects=the chat never presents next dev's behaviour of getStaticProps (it runs on each request) as production behaviour; fails_when=the development-versus-production sentence leaves the help or the README; no_claim=Next's behaviour itself (E0 observed it on the development server)
test('the help and the README say next dev runs getStaticProps on each request while a production build runs it at build or revalidation time', async () => {
  // Arrange
  const { serverRenderQuickStart } = serverRenderHelp()
  const section = await readServerRendersReadmeSection()
  // Act
  const helpSentence = serverRenderQuickStart.pagesStaticProps
  // Assert
  assert.ok(
    helpSentence.includes(
      'getStaticProps runs on each request of the page, including the /_next/data request of a client navigation to the same route; a production build runs it at build or revalidation time',
    ),
  )
  assert.ok(
    section.includes(
      '`next dev`, which Codebook starts, runs `getStaticProps` on each request of the page; a production build runs it at build or revalidation time',
    ),
  )
})

// Value: protects=the help names the code a Pages server stop does not pause in this version (getStaticPaths, an experimental-edge page, _app, API routes, _document) and promises no confirmed pause for it; fails_when=one of them leaves the limits or the help claims such a stop pauses as data; no_claim=that the run ends such a stop not reached (the run tests)
test('the server-render limits name the Pages code a server stop does not pause in this version', () => {
  // Arrange
  const { limits } = serverRenderHelp().serverRenderQuickStart
  // Act
  const pagesLimit = limits.find((limit) =>
    limit.startsWith('A Pages server stop does not pause'),
  )
  // Assert
  assert.ok(pagesLimit)
  assert.ok(
    pagesLimit.includes(
      'getStaticPaths (Next runs it apart from the page render)',
    ),
  )
  assert.ok(pagesLimit.includes("runtime: 'experimental-edge'"))
  assert.ok(pagesLimit.includes('and _app'))
  assert.ok(
    pagesLimit.includes(
      'A server stop in an API route (pages/api) or in _document is refused with NEXT_SERVER_ONLY_STOP before the development server starts',
    ),
  )
  assert.ok(pagesLimit.includes('never as a confirmed data-function pause'))
  assert.ok(limits[0]?.includes('route handlers (route.ts)'))
  assert.ok(limits[0]?.includes('Turbopack'))
})

// Value: protects=every new reason and journal event of a Pages server run has a help anchor named exactly as the journal and the run's details name it, with a meaning that states its limit; fails_when=an anchor is missing, misnamed or empty, or a reason claims more than the verdict establishes (no-renderer-frame or chain-incomplete reported as outside-data-function); no_claim=that the run writes these events (the run tests)
test('serverRenderErrors.pagesReasons has an anchor for each Pages reason and journal event', () => {
  // Arrange
  const { pagesReasons } = serverRenderHelp().serverRenderErrors
  const reasonNames = [
    'other-route',
    'outside-data-function',
    'readiness.entry-request',
    'no-async-chain',
    'no-renderer-frame',
    'route-unreadable',
    'chain-incomplete',
    'verdict-error',
    'client-mapping-unverified',
  ] as const
  // Act
  const anchors = reasonNames.map((name) => pagesReasons[name].anchor)
  // Assert
  assert.deepEqual(
    anchors,
    reasonNames.map((name) => `codebook://help/repository-browser#${name}`),
  )
  for (const name of reasonNames)
    assert.ok(pagesReasons[name].meaning.length > 40, name)
  assert.ok(
    pagesReasons['no-renderer-frame'].meaning.includes(
      'never reported as outside-data-function',
    ),
  )
  assert.ok(
    pagesReasons['no-renderer-frame'].meaning.includes(
      'Next 16.1.4 and 16.4.4',
    ),
  )
  assert.ok(
    pagesReasons['chain-incomplete'].meaning.includes(
      'continuation-limit, fetch-failed, other-debugger or timeout',
    ),
  )
  assert.ok(
    pagesReasons['verdict-error'].meaning.includes(
      'a log id, a shape summary without values and the Next version',
    ),
  )
  assert.ok(
    pagesReasons['verdict-error'].meaning.includes(
      'do not repeat the same start, and give the learner the log id',
    ),
  )
  assert.ok(
    pagesReasons['client-mapping-unverified'].meaning.includes(
      'ends not reached',
    ),
  )
})

// Value: protects=the help's own SERVER_STOP_NOT_REACHED section tells the chat what a Pages run's failure carries (router, resumedHits, attributionMode, nextVersion, unknown side effects) and how to recover without an unasked restart; fails_when=the Pages sentences leave the meaning or recovery, or the recovery says one new start is safe; no_claim=the static recovery text in errors.ts (the run tests pin it)
test('the help SERVER_STOP_NOT_REACHED section names the Pages details and a recovery that asks the learner before a new start', () => {
  // Arrange
  const { codes } = serverRenderHelp().serverRenderErrors
  // Act
  const meaning = codes.SERVER_STOP_NOT_REACHED.meaning
  const recovery = codes.SERVER_STOP_NOT_REACHED.recovery
  // Assert
  for (const phrase of [
    'In a Pages run (details.router pages)',
    'details.resumedHits',
    'details.attributionMode',
    'details.nextVersion',
    "the message then says the line may have run outside the entry page's data function",
    'details.sideEffects is unknown in a Pages run',
  ])
    assert.ok(meaning.includes(phrase), phrase)
  assert.ok(
    recovery.includes(
      'when the data function writes, ask the learner before one new start and never start unasked',
    ),
  )
  assert.ok(
    codes.ENTRY_LOAD_TIMEOUT.recovery.includes(
      'In a Pages run details.sideEffects is unknown',
    ),
  )
})

// Value: protects=the Pages support table lists the data-function server stops and the browser-stop rule for the page component, and no longer says Pages server-side code cannot be stopped; fails_when=nextSupport still lists getServerSideProps and getStaticProps as not stoppable, or the pointer to serverRenderQuickStart leaves the table; no_claim=that the run seals these stops (the run tests)
test('the Next support table lists the Pages data-function server stops and no longer calls them unsupported', () => {
  // Arrange
  const { nextSupport } = nextHelp()
  // Act
  const { pagesServerStops, notStoppable } = nextSupport
  // Assert
  assert.equal(pagesServerStops.length, 2)
  assert.ok(
    pagesServerStops[0]?.startsWith(
      "A line inside the entry page's getServerSideProps or getStaticProps, or in a module they call",
    ),
  )
  assert.ok(
    pagesServerStops[0]?.includes(
      'configuration version 3 (Codebook 0.2.74.0, API 1.17 or later; serverRenderQuickStart',
    ),
  )
  assert.ok(
    pagesServerStops[1]?.startsWith(
      'A line of the page component or of getInitialProps in the entry page is a browser stop',
    ),
  )
  assert.equal(
    notStoppable.some((entry) =>
      entry.includes('getServerSideProps, getStaticProps, API routes'),
    ),
    false,
  )
  assert.ok(notStoppable[0]?.includes("runtime: 'experimental-edge'"))
  assert.ok(
    notStoppable[2]?.includes(
      "A Pages page's data functions are supported from API 1.17",
    ),
  )
})

// Value: protects=the NEXT_SERVER_ONLY_STOP and NEXT_STOP_NOT_SEALED meanings name the Pages refusals with their details (router, sideEffects, requiredVersion, reason client-component), so an agent decides by fields, not prose; fails_when=a meaning loses a Pages refusal or its details field; no_claim=that the run raises them (the run tests)
test('the Next refusal meanings name the Pages server-stop refusals and their details', () => {
  // Arrange
  const { nextRefusals } = nextHelp()
  // Act
  const serverOnly = nextRefusals.NEXT_SERVER_ONLY_STOP?.meaning ?? ''
  const notSealed = nextRefusals.NEXT_STOP_NOT_SEALED?.meaning ?? ''
  // Assert
  assert.ok(
    serverOnly.includes(
      'every refusal of a stop in a Pages run carries details.router pages',
    ),
  )
  assert.ok(serverOnly.includes('details.sideEffects none'))
  assert.ok(serverOnly.includes('details.requiredVersion 3'))
  assert.ok(
    notSealed.includes(
      "A server stop in a Pages run (details.router pages): the line is in the entry page's own module and its client compile maps it (details.reason client-component",
    ),
  )
  assert.ok(notSealed.includes('no tracked workspace file'))
})

// Value: protects=the help's client-component recovery, the static NEXT_STOP_NOT_SEALED recovery and the refusal's own message give the same Pages instruction (declare the line with participant "browser"; a getInitialProps line pauses in the browser only after a client navigation); fails_when=one of the three drifts from the others or the App Router wording returns for a Pages line; no_claim=the exact wording of each text
test('the client-component recovery reads the same in the help, the static recovery and the Pages refusal message', () => {
  // Arrange
  const helpRecovery =
    serverRenderHelp().serverRenderErrors.codes.NEXT_STOP_NOT_SEALED.recovery
  const staticRecovery = ERROR_RECOVERY.NEXT_STOP_NOT_SEALED
  const message = pagesServerStopRefusal({
    kind: 'client-component',
    place: 'pages/products/[id].tsx:30',
  }).message
  // Act / Assert
  for (const text of [helpRecovery, staticRecovery, message]) {
    assert.ok(text.includes('participant "browser"'), text)
    assert.ok(text.includes('getInitialProps'), text)
    assert.ok(text.includes('getServerSideProps or getStaticProps'), text)
  }
  assert.ok(helpRecovery.includes('only after a client navigation'))
  assert.ok(staticRecovery.includes('only after a client navigation'))
  assert.ok(message.includes('only after a client navigation'))
})

// Value: protects=the migration table separates saved-study compatibility (format 8 unchanged, no new field, 0.2.73.2 the rollback target) from the live feature's minimums (0.2.74.0 and API 1.17); fails_when=a row leaves, or the live minimum is worded as a saved-study requirement; no_claim=that an older Codebook refuses a Pages stop (the run tests)
test('the migration table separates the saved Pages run (format 8 unchanged) from the live minimums', () => {
  // Arrange
  const { table } = serverRenderHelp().serverRenderMigration
  // Act
  const live = table.find((row) =>
    row.item.startsWith('minimum for a Pages Router data-function server stop'),
  )
  const saved = table.find((row) =>
    row.item.startsWith('saved study of a Pages Router server run'),
  )
  // Assert
  assert.equal(table.length, 5)
  assert.equal(
    live?.change,
    'Codebook 0.2.74.0 or later, MCP API 1.17 or later; an older Codebook refuses a server stop in a Pages run with NEXT_SERVER_ONLY_STOP',
  )
  assert.ok(
    saved?.change.startsWith(
      'format 8, unchanged and with no new field: Codebook 0.2.73.2 or later opens and replays it',
    ),
  )
  assert.ok(saved?.change.includes('0.2.73.2 is the supported rollback target'))
  assert.ok(
    saved?.change.includes(
      'Only starting such a run needs 0.2.74.0 and API 1.17',
    ),
  )
})

// Value: protects=API 1.17 is the served version and its API note names the additive Pages fields (dataFunction, the run's Next version and attribution summary, the failure details) and keeps saved-study compatibility apart from the live feature; fails_when=API_VERSION is not 1.17 or the note drops a field; no_claim=that the run reports the fields (the run tests)
test('API_VERSION is 1.17 and its note names the Pages data-function fields and the unchanged study format', async () => {
  // Arrange
  const constants = await readPackaged('src', 'constants.ts')
  // Act
  const note =
    constants
      .split('\n')
      .find((line) => line.startsWith(' * 1.17 is additive')) ?? ''
  // Assert
  assert.equal(API_VERSION, '1.17')
  for (const phrase of [
    'Pages Router data-function server stops (configuration version 3)',
    '`dataFunction`',
    "the run resource names the run's Next version and an attribution summary",
    '`readiness.entry-request`',
    '`router`',
    '`resumedHits`',
    '`attributionMode`',
    '`nextVersion`',
    '`requiredVersion`',
    'format 8 is unchanged and gains no field',
    'a Pages server stop needs Codebook 0.2.74.0 with this API',
  ])
    assert.ok(note.includes(phrase), phrase)
})

// Value: protects=the bundled skill carries one Pages sentence (data functions take server stops in configuration version 3, the readiness request is mentioned when a value can depend on it) and the consent sentence, copies no configuration, and no longer calls Pages server-side code unsupported; fails_when=a sentence leaves the skill, the version is not 1.0.66, or the skill embeds the quick start's configuration; no_claim=how a chat follows the rules
test('the bundled skill 1.0.66 states the Pages data-function stops, the readiness request and the consent rule without copying the contract', async () => {
  // Arrange
  const skill = await readPackaged('skills', 'codebook', 'SKILL.md')
  const paragraph = await readServerRendersSkillParagraph()
  // Act / Assert
  assert.ok(skill.includes('metadata:\n  version: "1.0.66"\n'))
  assert.ok(
    paragraph.startsWith(
      '**Server renders (API 1.16; Pages Router data functions API 1.17).**',
    ),
  )
  assert.ok(
    paragraph.includes(
      'A Pages Router page\'s data functions (`getServerSideProps`, `getStaticProps`) and the code they call take a `participant: "server"` stop in configuration version 3, only when `codebook_status` reports API 1.17 or later',
    ),
  )
  assert.ok(
    paragraph.includes(
      "a Pages data function also runs once during Codebook's readiness request before the stop is armed, so mention that request when a value can depend on it (a cache, a counter, a one-time initialisation)",
    ),
  )
  assert.ok(
    paragraph.includes(
      'tell the learner that the run executes it at least twice and ask first; not running is the only escape, and the learner decides',
    ),
  )
  assert.ok(paragraph.includes('API 1.16 or later'))
  assert.doesNotMatch(skill, /Pages server-side code/)
  assert.equal(paragraph.includes('pages/products/[id].tsx'), false)
  assert.equal(paragraph.includes('"afterOperation": 0'), false)
})

// Value: protects=every user-visible Pages data-function behaviour the CHANGELOG names has a README sentence (minimums, the line rule, after operation, development getStaticProps, the readiness request and its consent, counted hits, unconfirmed pauses, the unpaused code, saved studies, the refusals); fails_when=a sentence leaves the Server renders section; no_claim=the behaviour itself
test('the README Server renders section describes the Pages data-function stops, their limits and their updating rules', async () => {
  // Arrange
  const section = await readServerRendersReadmeSection()
  // Act / Assert
  assert.ok(section.length > 0)
  for (const phrase of [
    '**Codebook 0.2.74.0 / MCP API 1.17** for a Pages Router page',
    '`configurationPagesEntryRender`',
    '`routerKind`',
    '**Pages Router data functions (0.2.74.0).**',
    '`dataFunction`',
    'a placeholder dynamic-route source (`pages/products/[id].tsx`), which needs a concrete `entryPath` such as `/products/1`',
    '**Which line is a server line.**',
    '`getInitialProps` line pauses in the browser only after a client navigation, never at the entry load',
    '**After an operation.**',
    '`readiness.entry-request`',
    'the chat asks you before it starts such a run',
    '`details.sideEffects: "unknown"`',
    '`other-route`',
    '`outside-data-function`',
    '`resumedHits`',
    '`attributionMode`',
    '`nextVersion`',
    '**An `unconfirmed` pause.**',
    '`no-async-chain`, `no-renderer-frame`, `route-unreadable`, `chain-incomplete` or `verdict-error`',
    '`client-mapping-unverified`',
    '**Not paused in this version.**',
    '`getStaticPaths`',
    "`runtime: 'experimental-edge'`",
    '`_app`',
    'Codebook 0.2.73.2 or later opens and replays it',
    'an older Codebook refuses it with `NEXT_SERVER_ONLY_STOP`',
  ])
    assert.ok(section.includes(phrase), phrase)
})

// Value: protects=the README states the Pages-specific refusals (a server stop in pages/api or _document before the server starts, a version 2 server stop naming version 3 with requiredVersion, the Pages client-component reason), the API 1.17 note and the skill version the update step names; fails_when=a refusal bullet keeps the pre-1.17 wording or the 1.17 note or the 1.0.66 version leaves the README; no_claim=the refusals themselves (the run tests)
test('the README names the Pages server-stop refusals, the API 1.17 note and skill 1.0.66', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  // Act / Assert
  for (const phrase of [
    'with **MCP API 1.17** (`codebook_status` reports the installed build). API 1.17 is additive: it adds Pages Router data-function server stops in configuration version 3',
    'A saved Pages server run stays study format 8 with no new field.',
    'A server stop in a `pages/api` file or in `_document` is refused with this code before the development server starts (`details.sideEffects` is `none`).',
    'A server stop in a version 2 Pages run is refused with this code too, naming configuration version 3 and the Pages quick start (`details.requiredVersion` is `3`)',
    'Every refusal of a stop in a Pages run carries `details.router: "pages"`.',
    "(`details.reason` is `client-component`: the page component and `getInitialProps` lines also run in the page's server render and in the browser",
    "so Cursor's managed skill updates to **1.0.66**",
    '**What the chat asks first (1.0.66).**',
  ])
    assert.ok(readme.includes(phrase), phrase)
  assert.equal(
    readme.includes('a Pages Router page takes client stops only'),
    false,
  )
})

// Value: protects=no packaged Pages text names a behaviour that does not exist (the call-site window E0b did not need, a call-site attribution mode, a production getStaticProps claim); fails_when=the help names a call-site window or attribution mode, or claims getStaticProps runs on every production request; no_claim=that every sentence is true (the run tests and the native checks decide that)
test('the served help names no call-site window and no production getStaticProps behaviour', async (context) => {
  // Arrange
  const help = await readServedHelp(context)
  // Act
  const text = JSON.stringify(help)
  // Assert
  assert.equal(/call-site/i.test(text), false)
  assert.equal(
    /production[^.]*runs getStaticProps on each request/i.test(text),
    false,
  )
  assert.ok(text.includes('async-chain'))
})
