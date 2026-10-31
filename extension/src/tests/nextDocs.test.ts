import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { ERROR_RECOVERY } from '../errors'
import { NEXT_QUICK_START_CONFIGURATION } from '../nextHelp'
import { NEXT_REFUSAL_CODES } from '../nextRefusals'
import {
  repositoryConfigSchema,
  retainedRepositoryConfigSchema,
} from '../repositoryConfigSchemas'
import { readResource } from '../resources'

import { createHarness } from './helpers'

/** The compatibility-mode sentence of Issue 166, word for word; the help and the README must both carry it. */
const COMPATIBILITY_SENTENCE =
  'Codebook runs your Next app with webpack (`next dev --webpack`) even when your dev script uses Turbopack. The page is built from the same source; a Turbopack-only loader or setting has no effect during the run.'

/** The parts of the help these tests read; every other key is left unread. */
type RepositoryBrowserHelp = Record<string, unknown> & {
  startHere?: string
  nextQuickStart?: {
    prerequisites: string[]
    callOrder: string[]
    configuration: unknown
  }
  nextSupport?: {
    supportedNext: string
    pagesStops: string[]
    notStoppable: string[]
    compatibility: string
    preparation: string
    unsupported: string[]
    fastRefresh: string
    setupBudget: string
  }
  nextRefusals?: Record<
    string,
    { anchor: string; meaning: string; recovery: string }
  >
  viteRefusals?: Record<string, unknown>
}

/**
 * Reads `codebook://help/repository-browser` from a fresh service, as an agent reads it.
 * @param context - The test context, which closes the harness after the test.
 * @returns The parsed help object.
 * @example
 * const help = await readRepositoryBrowserHelp(context) // => { startHere: '…', viteQuickStart: {…}, … }
 */
async function readRepositoryBrowserHelp(
  context: TestContext,
): Promise<RepositoryBrowserHelp> {
  const harness = await createHarness()
  context.after(() => harness.close())
  const resource = await readResource(
    harness.service,
    'codebook://help/repository-browser',
  )
  return JSON.parse('text' in resource ? resource.text : '{}')
}

/**
 * Reads the packaged README's Next section: from its heading to the next second-level heading.
 * @returns The section text, or an empty text when the heading is missing.
 * @example
 * await readNextReadmeSection() // => '## Explain a browser interaction in a Next.js app\n\nThe quick start …'
 */
async function readNextReadmeSection(): Promise<string> {
  const readme = await readFile(join(__dirname, '../../README.md'), 'utf8')
  const start = readme.indexOf(
    '\n## Explain a browser interaction in a Next.js app\n',
  )
  if (start === -1) return ''
  const end = readme.indexOf('\n## ', start + 1)
  return readme.slice(start + 1, end === -1 ? undefined : end)
}

// protects=the Next quick start's configuration is valid for the public schema, so an agent that copies it and fills the placeholders is not refused for its shape; fails_when=the schema changes a field and the help keeps the old example, or the example loses its Pages citation or entryPath; no_claim=that the placeholders name real sources
test('the Next quick start configuration parses with the public repository-browser schema', () => {
  // Arrange
  const configuration = JSON.parse(
    JSON.stringify(NEXT_QUICK_START_CONFIGURATION),
  )
  // Act
  const result = retainedRepositoryConfigSchema.safeParse(configuration)
  const parsed = repositoryConfigSchema.parse(configuration)
  // Assert
  assert.equal(result.success, true)
  assert.equal(parsed.adapter, 'next-dev-webpack')
  assert.equal(configuration.source.path, 'src/pages/index.tsx')
  assert.equal(configuration.entryPath, '/')
})

// protects=every refusal code a Next Pages run can answer has its own section in the help, whose anchor the recovery text names and whose recovery is the one the error carries; fails_when=a code is added to NEXT_REFUSAL_CODES without a help section, or the help's recovery drifts from ERROR_RECOVERY; no_claim=the wording of the recovery
test('the repository-browser help has one anchor section for every Next refusal code', async (context) => {
  // Arrange
  const help = await readRepositoryBrowserHelp(context)
  // Act
  const refusals = help.nextRefusals ?? {}
  // Assert
  assert.deepEqual(Object.keys(refusals), [
    'NEXT_UNSUPPORTED_SETTING',
    'NEXT_ENTRY_REDIRECTED',
    'NEXT_ROUTE_NOT_COMPILED',
    'NEXT_ROUTE_CONFLICT',
    'NEXT_ROUTE_NOT_FOUND',
    'NEXT_SERVER_ONLY_STOP',
    'NEXT_STOP_NOT_SEALED',
    'NEXT_SETUP_DEADLINE',
  ])
  for (const code of NEXT_REFUSAL_CODES) {
    assert.equal(
      refusals[code]?.anchor,
      `codebook://help/repository-browser#${code}`,
    )
    assert.equal(refusals[code]?.recovery, ERROR_RECOVERY[code])
    assert.ok((refusals[code]?.meaning.length ?? 0) > 0)
  }
})

// protects=an agent that follows a "See codebook://help/repository-browser#<CODE>" link in any help text lands on a section of the help; fails_when=a recovery names an anchor that neither the Next nor the Vite refusal sections hold; no_claim=anchors of other help resources
test('every repository-browser anchor the help names resolves to a refusal section of the help', async (context) => {
  // Arrange
  const help = await readRepositoryBrowserHelp(context)
  const sections = new Set([
    ...Object.keys(help.nextRefusals ?? {}),
    ...Object.keys(help.viteRefusals ?? {}),
  ])
  // Act
  const named = [
    ...JSON.stringify(help).matchAll(
      /codebook:\/\/help\/repository-browser#([A-Z_]+)/g,
    ),
  ].map((match) => match[1])
  // Assert
  assert.ok(named.includes('NEXT_SETUP_DEADLINE'))
  assert.deepEqual(
    named.filter((code) => !sections.has(code ?? '')),
    [],
  )
})

// protects=an agent that read the help before Cycle 0065 still finds every section it knew, and the start-here sentence leads; fails_when=a key is dropped or renamed, or startHere no longer comes first; no_claim=the content of the keys
test('the repository-browser help keeps its existing top keys and leads with startHere', async (context) => {
  // Arrange / Act
  const help = await readRepositoryBrowserHelp(context)
  // Assert
  assert.deepEqual(Object.keys(help), [
    'startHere',
    'viteQuickStart',
    'viteSupport',
    'viteFirstRun',
    'viteRefusals',
    'nextQuickStart',
    'nextSupport',
    'nextRefusals',
    'profile',
    'configurationSchema',
    'entry',
    'additionalStops',
    'inspections',
    'sourceBinding',
    'initialState',
    'sequence',
    'recovery',
    'retainedFormats',
  ])
})

// protects=an agent reading the help first is sent from codebook_status to the quick start of its app (Next, App or Pages, or Vite); fails_when=startHere stops naming either quick start, the adapters readiness or routerKind; no_claim=that the agent follows it
test('startHere sends a Next app to nextQuickStart and a Vite app to viteQuickStart', async (context) => {
  // Arrange
  const help = await readRepositoryBrowserHelp(context)
  // Act
  const startHere = help.startHere ?? ''
  // Assert
  assert.ok(startHere.startsWith('Read codebook_status first'))
  assert.ok(startHere.includes('profiles[].prerequisites.adapters'))
  assert.ok(startHere.includes('routerKind'))
  assert.ok(
    startHere.includes(
      'nextQuickStart for a Next app (App Router or Pages Router)',
    ),
  )
  assert.ok(startHere.includes('viteQuickStart for a Vite app'))
})

// protects=the learner's promise about Turbopack reads the same in the help and the packaged README; fails_when=either copy is reworded or dropped; no_claim=the run behavior the sentence describes
test('the compatibility-mode sentence is in the help and the README word for word', async (context) => {
  // Arrange
  const help = await readRepositoryBrowserHelp(context)
  // Act
  const readme = await readFile(join(__dirname, '../../README.md'), 'utf8')
  // Assert
  assert.equal(help.nextSupport?.compatibility, COMPATIBILITY_SENTENCE)
  assert.ok(readme.includes(COMPATIBILITY_SENTENCE))
})

// protects=the Next quick start tells an agent to stop the learner's own next dev, to have skipped preparation run first, and that the start receipt is no success; fails_when=a prerequisite or the poll step is dropped, or the call order changes; no_claim=the agent follows it
test('the Next quick start gives the prerequisites, the call order and the poll after the receipt', async (context) => {
  // Arrange
  const help = await readRepositoryBrowserHelp(context)
  const expectedStepStarts = [
    'codebook_status: ',
    'codebook://help/repository-browser (this help): ',
    'codebook_sources, then codebook_source: ',
    'codebook_publish_book: ',
    'codebook_start: ',
    'Poll the run resource it names until the run reads ready, or a failed state with an error code',
    'codebook_action repository-click: ',
    'At each pause read inspectionUri and sourceUri',
  ]
  // Act
  const prerequisites = help.nextQuickStart?.prerequisites ?? []
  const callOrder = help.nextQuickStart?.callOrder ?? []
  // Assert
  assert.equal(prerequisites.length, 3)
  assert.ok(
    prerequisites[0]?.startsWith(
      'Stop your own next dev for this workspace first',
    ),
  )
  assert.ok(prerequisites[0]?.includes('.next/dev/lock'))
  assert.ok(prerequisites[0]?.includes('PREREQUISITE_MISSING'))
  assert.ok(prerequisites[1]?.includes('dependencies are installed'))
  assert.ok(prerequisites[2]?.includes('from the workspace root'))
  assert.ok(prerequisites[2]?.includes('Codebook never runs it'))
  assert.equal(callOrder.length, expectedStepStarts.length)
  expectedStepStarts.forEach((start, index) =>
    assert.ok(callOrder[index]?.startsWith(start), `step ${index + 1}`),
  )
  assert.ok(
    callOrder[4]?.endsWith(
      'the answer is a receipt with a run id, not success.',
    ),
  )
})

// protects=the help states which Pages code can stop, which cannot (with the code each gives), the unsupported settings with their codes, the 90 s budget and the supported Next; fails_when=any of these limits leaves nextSupport; no_claim=the run enforces them (the run tests)
test('the Next support section names the stoppable Pages code, the server-only limits, the unsupported settings and the 90 s budget', async (context) => {
  // Arrange
  const help = await readRepositoryBrowserHelp(context)
  // Act
  const support = help.nextSupport
  // Assert
  assert.ok(support)
  assert.equal(
    support.supportedNext,
    'Next 16, whose development server writes the default .next/dev output.',
  )
  assert.deepEqual(support.pagesStops, [
    'The page module of the entry route, under pages/ or src/pages/ (pages/ wins when both exist), a .tsx, .ts, .jsx, .js file.',
    'A client component the page imports.',
    '_app (pages/_app or src/pages/_app).',
  ])
  assert.ok(
    support.notStoppable[0]?.includes(
      'getServerSideProps, getStaticProps, API routes (pages/api) and _document',
    ),
  )
  assert.ok(support.notStoppable[0]?.includes('NEXT_SERVER_ONLY_STOP'))
  assert.ok(
    support.notStoppable[0]?.includes('otherwise with NEXT_STOP_NOT_SEALED'),
  )
  assert.ok(support.notStoppable[1]?.includes('next/dynamic'))
  assert.ok(support.notStoppable[2]?.startsWith('Server components'))
  assert.ok(support.preparation.includes('never runs scripts.dev'))
  assert.ok(support.preparation.includes('preparation.envSettings'))
  assert.ok(support.unsupported[0]?.startsWith('basePath or i18n routing'))
  assert.ok(support.unsupported[0]?.includes('NEXT_UNSUPPORTED_SETTING'))
  assert.ok(support.unsupported[1]?.startsWith('A custom distDir'))
  assert.ok(support.unsupported[1]?.includes('NEXT_ROUTE_NOT_COMPILED'))
  assert.ok(support.unsupported[2]?.startsWith('A custom pageExtensions'))
  assert.ok(support.unsupported[2]?.includes('NEXT_ROUTE_NOT_FOUND'))
  assert.ok(support.fastRefresh.includes('SOURCE_CHANGED'))
  assert.ok(
    support.setupBudget.startsWith(
      'Preparation has 90 s in all, with no override',
    ),
  )
})

// protects=the packaged README reads in the order Issue 166 fixed (the run, before starting, the refusals) and opens with the quick start's place; fails_when=a heading is renamed, reordered or dropped, or the first sentence stops naming the help and its nextQuickStart key; no_claim=the rest of the README
test('the README explains a Next run, then what to do before starting, then the refusals, leading with the quick start', async () => {
  // Arrange
  const section = await readNextReadmeSection()
  // Act
  const headings = section.split('\n').filter((line) => /^#{2,3} /.test(line))
  const firstSentence = section.split('\n\n')[1]?.split('. ')[0] ?? ''
  // Assert
  assert.deepEqual(headings, [
    '## Explain a browser interaction in a Next.js app',
    '### Before starting',
    '### When Codebook cannot verify a stop',
  ])
  assert.ok(firstSentence.includes('`nextQuickStart`'))
  assert.ok(firstSentence.includes('`codebook://help/repository-browser`'))
})

// protects=a learner who meets any Next refusal code finds it explained in the packaged README's Next section; fails_when=a code of NEXT_REFUSAL_CODES has no sentence there; no_claim=the sentence's wording
test('every Next refusal code is named by a sentence of the README Next section', async () => {
  // Arrange
  const section = await readNextReadmeSection()
  // Act
  const unnamed = NEXT_REFUSAL_CODES.filter(
    (code) => !section.includes(`\n- \`${code}\`: `),
  )
  // Assert
  assert.deepEqual(unnamed, [])
})

// protects=the README states the redirect rule (final path named, query values redacted, the learner's question decides), the server-side and next/dynamic limits, the status fields and the plain next dev App case; fails_when=one of them leaves the Next section; no_claim=the run behaves so (the run tests)
test('the README Next section states the redirect rule, the stop limits, the status fields and the plain next dev App case', async () => {
  // Arrange
  const section = await readNextReadmeSection()
  // Act
  const redirect =
    section
      .split('\n')
      .find((line) => line.startsWith('- `NEXT_ENTRY_REDIRECTED`: ')) ?? ''
  // Assert
  assert.ok(redirect.includes('names the final path'))
  assert.ok(redirect.includes('query and fragment values redacted'))
  assert.ok(redirect.includes('only when your question is about that page'))
  assert.ok(
    section.includes(
      '`getServerSideProps`, `getStaticProps`, API routes (`pages/api`) and `_document` run on the server and cannot be stopped in',
    ),
  )
  assert.ok(
    section.includes('a `next/dynamic` module is, which cannot be sealed'),
  )
  assert.ok(section.includes('`basePath` or `i18n` routing'))
  assert.ok(section.includes('a custom `distDir`'))
  assert.ok(section.includes('a custom `pageExtensions`'))
  assert.ok(section.includes('`nextRouters: ["app", "pages"]`'))
  assert.ok(
    section.includes('adds `routerKind` (`app`, `pages`, `both` or `none`'),
  )
  assert.ok(section.includes('`preparation`: its `status` reads `skipped`'))
  assert.ok(
    section.includes('its `envSettings` names the environment settings'),
  )
  assert.ok(
    section.includes(
      'An App Router project whose `dev` script is plain `next dev` (Turbopack by default in Next 16) runs the same way, because Codebook always starts `next dev --webpack`.',
    ),
  )
})

// protects=skill 1.0.58 routes Pages Router pages to next-dev-webpack, re-reads the help when the nextRouters marker changes, relays a refusal's code and recovery without an unrelated stop, and says saved only after the save; fails_when=any of these rules leaves the browser paragraph; no_claim=how a chat follows it
test('the bundled skill routes Pages Router pages to the Next adapter and re-reads the help when nextRouters changes', async () => {
  // Arrange
  const skill = await readFile(
    join(__dirname, '..', '..', 'skills', 'codebook', 'SKILL.md'),
    'utf8',
  )
  // Act
  const paragraph =
    skill.split('\n\n').find((part) => part.startsWith('**Browser runs.**')) ??
    ''
  // Assert
  assert.ok(
    paragraph.includes(
      '`next-dev-webpack` for Next, App Router and Pages Router pages alike',
    ),
  )
  assert.ok(
    paragraph.includes(
      "Read that help again whenever the profile's `nextRouters` in `codebook_status` differs from the list you remember.",
    ),
  )
  assert.ok(
    paragraph.includes(
      "with its `code` and the recovery that code's section in that help gives",
    ),
  )
  assert.ok(
    paragraph.includes(
      'never move a stop to unrelated code to make a run succeed',
    ),
  )
  assert.ok(
    paragraph.includes(
      'Say the learning is saved only once its save has completed, never while it is still saving.',
    ),
  )
})

// protects=the browser route forbidding edits of the learner's project to make a run reach its stops, not only to make it start; fails_when=the rule goes back to "to make a run start", which a chat read as allowing edits of page code and API constants once the run had started; why_new=N65 Cursor trial (Cycle 0065): Grok 4.6 High edited the page's padding and the API's page size so a declared click would land; no_claim=how a chat follows it
test('the bundled skill forbids editing the project to make a browser run start or reach its stops', async () => {
  // Arrange
  const skill = await readFile(
    join(__dirname, '..', '..', 'skills', 'codebook', 'SKILL.md'),
    'utf8',
  )
  // Act
  const paragraph =
    skill.split('\n\n').find((part) => part.startsWith('**Browser runs.**')) ??
    ''
  // Assert
  assert.ok(
    paragraph.includes(
      "Never edit the project's files, config or scripts to make a run start or reach its stops; when the page itself keeps the declared action from happening, tell the learner what blocks it.",
    ),
  )
})
