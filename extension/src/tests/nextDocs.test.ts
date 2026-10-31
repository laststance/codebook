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
import { DEV_SCRIPT_WEBPACK_FORMS } from './utils/devScriptWebpackForms'

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

/**
 * Reads the packaged README's API 1.12 compatibility note: from "API 1.12 is additive" to the API 1.11 note after it.
 * @returns The note, or an empty text when either end is missing.
 * @example
 * await readApi112ReadmeNote() // => 'API 1.12 is additive: it adds Next Pages Router pages to the `next-dev-webpack` adapter …'
 */
async function readApi112ReadmeNote(): Promise<string> {
  const readme = await readFile(join(__dirname, '../../README.md'), 'utf8')
  const start = readme.indexOf('API 1.12 is additive')
  const end = readme.indexOf('API 1.11 was additive', start)
  return start === -1 || end === -1 ? '' : readme.slice(start, end)
}

/**
 * Reads the 1.12 line of the `API_VERSION` doc comment in `src/constants.ts` (tests run from `dist/tests`).
 * @returns The line, or an empty text when the doc has no 1.12 line.
 * @example
 * await readApi112VersionDoc() // => ' * 1.12 is additive: Next Pages Router pages on the `next-dev-webpack` adapter …'
 */
async function readApi112VersionDoc(): Promise<string> {
  const constants = await readFile(
    join(__dirname, '../../src/constants.ts'),
    'utf8',
  )
  return constants.split('\n').find((line) => line.startsWith(' * 1.12 ')) ?? ''
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
      "Never edit the project's files, config or scripts to make a run start or reach its stops, not even temporarily or with a plan to restore them, and not after the learner agrees to continue; when the page itself keeps the declared action from happening (an automatic load that races the click, for example), tell the learner what blocks it and offer only choices that change no project file: another declared action or stop, another page, or explaining what the run did observe.",
    ),
  )
})

// Value: protects=a client or skill reading the API 1.12 note learns that every repository-browser click, App Router and Vite runs included, now scrolls a target outside the viewport to its middle before the click (1.11 read it as obscured); fails_when=the README note or the API_VERSION doc says App Router and Vite runs are unchanged, or stops naming the scroll; why_new=Cycle 0066 task 4 (Cycle 0065 review and CodeRabbit CLI round 5: the note contradicted the click step); seam=README and constants.ts text; no_claim=the run scrolls so (configuredDomExpression tests)
test('the API 1.12 note in the README and the API_VERSION doc names the below-the-fold scroll of every repository-browser click', async () => {
  // Arrange
  const readmeNote = await readApi112ReadmeNote()
  const versionDoc = await readApi112VersionDoc()
  // Act
  const notes = [readmeNote, versionDoc]
  // Assert
  assert.ok(
    readmeNote.includes(
      "API 1.12 also changes the click of every `repository-browser` run, App Router and Vite runs included: a click target whose centre lies outside the visible page is first scrolled to the middle of the viewport before the click, so the page's own scroll and visibility handlers run before it, where API 1.11 read such a target as obscured (`click-target-obscured`); App Router and Vite runs are otherwise unchanged.",
    ),
  )
  assert.ok(
    versionDoc.includes(
      'It also changes the click of every `repository-browser` run, App Router and Vite runs included: a click target whose centre lies outside the viewport is first scrolled to the middle of the viewport, where 1.11 read it as obscured (`click-target-obscured`); App Router and Vite runs are otherwise unchanged.',
    ),
  )
  assert.deepEqual(
    notes.filter((note) =>
      note.includes('App Router and Vite runs are unchanged'),
    ),
    [],
  )
})

// Value: protects=a client reading the API 1.12 note expects nextRoute only where the runtime sets it, for a Next run in a workspace with a Pages folder, and not for a Next run without one; fails_when=the README note or the API_VERSION doc says every Next run's resource names its nextRoute; why_new=Cycle 0066 task 5 (Cycle 0065 review: runtime.ts documents nextRoute absent without a Pages folder; D4, the docs follow the runtime); seam=README and constants.ts text; no_claim=the run resource omits it (run tests)
test('the API 1.12 note in the README and the API_VERSION doc name nextRoute only for a Next run in a workspace with a Pages folder', async () => {
  // Arrange
  const readmeNote = await readApi112ReadmeNote()
  const versionDoc = await readApi112VersionDoc()
  // Act
  const notes = [readmeNote, versionDoc]
  // Assert
  assert.ok(
    readmeNote.includes(
      'the resource of a Next run in a workspace with a Pages folder (`pages/` or `src/pages/`) names its `nextRoute` once its entry path is resolved (router, route and, for a Pages route, its source file), while a Next run in a workspace without a Pages folder has no `nextRoute`',
    ),
  )
  assert.ok(
    versionDoc.includes(
      'the resource of a Next run in a workspace with a Pages folder names its `nextRoute` (not a Next run in a workspace without one)',
    ),
  )
  assert.deepEqual(
    notes.filter((note) =>
      note.includes("a Next run's resource names its `nextRoute`"),
    ),
    [],
  )
})

// Value: protects=an agent reading the help or the README learns that a Next run in a workspace with a Pages folder answers NEXT_SETUP_DEADLINE at its early steps, before its route is known, not only a Pages Router run, and that an App-resolved run's deadline has no Next code; fails_when=the help's NEXT_SETUP_DEADLINE meaning, nextSupport.setupBudget or the README bullet says only a Pages Router run answers that code; why_new=Cycle 0066 task 6 (Cycle 0065 review: setupDeadlineText names the code for a Pages-capable run whose entry is not yet resolved as App); seam=help resource and README text; no_claim=the run decides so (nextPagesRun tests)
test('the help and the README say a Next run in a workspace with a Pages folder answers NEXT_SETUP_DEADLINE at its early steps, before its route is known', async (context) => {
  // Arrange
  const help = await readRepositoryBrowserHelp(context)
  const section = await readNextReadmeSection()
  // Act
  const meaning = help.nextRefusals?.NEXT_SETUP_DEADLINE?.meaning ?? ''
  const setupBudget = help.nextSupport?.setupBudget ?? ''
  const readmeBullet =
    section
      .split('\n')
      .find((line) => line.startsWith('- `NEXT_SETUP_DEADLINE`: ')) ?? ''
  // Assert
  assert.ok(
    meaning.startsWith(
      'A Next run in a workspace with a Pages folder (pages/ or src/pages/) did not get ready within the 90 s setup budget, at its early steps (starting Next, waiting for the server to answer the entry page, reading the route manifests), before its route is known, and at every step once its entry path resolved as a Pages route; once its entry path resolved as an App route, as in a workspace without a Pages folder, the deadline carries no Next code (the failure reads Repository setup deadline exceeded). The message names the step it reached',
    ),
  )
  assert.equal(
    setupBudget,
    'Preparation has 90 s in all, with no override: starting Next, the entry page, the route manifests, sealing the stops, the browser and the page router. A Next run in a workspace with a Pages folder (pages/ or src/pages/) past it is refused with NEXT_SETUP_DEADLINE at its early steps (starting Next, waiting for the server to answer the entry page, reading the route manifests), before its route is known, and at every step once its entry path resolved as a Pages route; any other Next run past it fails with Repository setup deadline exceeded, with no Next code.',
  )
  assert.ok(
    readmeBullet.startsWith(
      '- `NEXT_SETUP_DEADLINE`: a Next run in a workspace with a Pages folder (`pages/` or `src/pages/`) did not get ready within 90 s, at its early steps (starting Next, waiting for the server to answer the entry page, reading the route manifests), before its route is known, or at any step once its entry path resolved as a Pages route (once it resolved as an App route, as in a workspace without a Pages folder, the run fails with "Repository setup deadline exceeded" and no Next code), and the message names the step it reached',
    ),
  )
})

// Value: protects=a chat whose Pages run hit the setup deadline tells the learner the recovery the run gave for the step it reached (a retry, a corrected entryPath, the input selector, or reading the history first), as the help's NEXT_SETUP_DEADLINE meaning says, not the section's general retry; fails_when=skill 1.0.59's browser paragraph or the README's skill bullet stops naming the run's own recovery for NEXT_SETUP_DEADLINE; why_new=Cycle 0066 task 8 (Cycle 0065 review: the skill worded the deadline recovery differently from the help's per-step recovery); seam=SKILL.md, help resource and README text; no_claim=how a chat follows it
test('the bundled skill relays the recovery the run gives for NEXT_SETUP_DEADLINE, the per-step recovery the help names', async (context) => {
  // Arrange
  const skill = await readFile(
    join(__dirname, '..', '..', 'skills', 'codebook', 'SKILL.md'),
    'utf8',
  )
  const help = await readRepositoryBrowserHelp(context)
  const section = await readNextReadmeSection()
  // Act
  const paragraph =
    skill.split('\n\n').find((part) => part.startsWith('**Browser runs.**')) ??
    ''
  const meaning = help.nextRefusals?.NEXT_SETUP_DEADLINE?.meaning ?? ''
  // Assert
  assert.ok(
    paragraph.includes(
      "For `NEXT_SETUP_DEADLINE`, relay the `recovery` of the run resource's `error` instead, word for word: the run words it for the step it reached (one retry, a corrected `entryPath`, the input selector, or reading the captured history before any new start).",
    ),
  )
  assert.ok(meaning.includes('The recovery the run gives fits that step'))
  assert.ok(
    section.includes(
      "- **What the bundled skill does (1.0.60).** The chat sends a question about a Pages Router page to `next-dev-webpack` as it does for an App Router page, tells you a refusal's code with the recovery of that code's section in the help (for `NEXT_SETUP_DEADLINE`, the recovery the run itself gives for the step it reached: one retry, a corrected `entryPath`, the input selector, or reading the captured history first),",
    ),
  )
})

// Value: protects=a learner reading when a Pages launch or compile failure adds the webpack-compatibility sentence finds exactly the dev script forms devScriptRequestsWebpack reads, as asking or as not asking for webpack; fails_when=the README's condition lists a form the table-driven devScriptRequestsWebpack test does not prove, misses one, or puts one on the wrong side; why_new=Cycle 0066 task 12 (Cycle 0065 red team: "has no --webpack" covered quoted, ";"-ended and delegated forms the function does not read); seam=README text and the shared form table; no_claim=the function's answers (devScriptRequestsWebpack test)
test('the README lists exactly the dev script forms a Pages launch failure reads as asking, or not asking, Next for webpack', async () => {
  // Arrange
  const section = await readNextReadmeSection()
  const codeSpansOf = (text: string): string[] =>
    [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '')
  // Act
  const condition =
    section
      .split('\n')
      .find((line) =>
        line.includes("Codebook reads only the `dev` script's own text"),
      ) ?? ''
  const listStart = condition.indexOf("the script's end after it: ")
  const listed = listStart === -1 ? '' : condition.slice(listStart)
  const [asking = '', notAsking = ''] = listed.split(' ask for webpack; ')
  // Assert
  assert.deepEqual(
    codeSpansOf(asking),
    DEV_SCRIPT_WEBPACK_FORMS.filter((form) => form.asksForWebpack).map(
      (form) => form.devScript,
    ),
  )
  assert.deepEqual(
    codeSpansOf(notAsking.split(' do not.')[0] ?? ''),
    DEV_SCRIPT_WEBPACK_FORMS.filter((form) => !form.asksForWebpack).map(
      (form) => form.devScript,
    ),
  )
})

// Value: protects=an agent reading the help learns that a server stop in a Pages run is refused as NEXT_SERVER_ONLY_STOP, and that a counted predev depends on the package manager with a note when that is unknown; fails_when=the NEXT_SERVER_ONLY_STOP meaning, nextSupport.notStoppable or nextSupport.preparation keep the Cycle 0065 wording; why_new=Cycle 0066 integration (lane C changed tasks 7 and 9, whose help sentences went stale); seam=help resource text; no_claim=the run and the readiness decide so (nextPagesRun and repositoryAdapterReadiness tests)
test('the help says a Pages server stop is refused as server-only and that a predev counts only when the package manager runs it', async (context) => {
  // Arrange
  const help = await readRepositoryBrowserHelp(context)
  // Act
  const meaning = help.nextRefusals?.NEXT_SERVER_ONLY_STOP?.meaning ?? ''
  const notStoppable = help.nextSupport?.notStoppable?.[0] ?? ''
  const preparation = help.nextSupport?.preparation ?? ''
  // Assert
  assert.ok(
    meaning.endsWith(
      "A server stop (participant server in a version 2 configuration) is refused with it in a Pages run too, because a Pages run observes only the page's client code.",
    ),
  )
  assert.ok(
    notStoppable.endsWith(
      'A server stop (participant server) in a Pages run is refused with NEXT_SERVER_ONLY_STOP before the browser opens.',
    ),
  )
  assert.ok(
    preparation.includes(
      'statements before next dev (and a predev script when the package manager of the project runs pre scripts: npm, Yarn 1, pnpm 9 or later, or pnpm 7 and 8 with enable-pre-post-scripts) are skipped,',
    ),
  )
  assert.ok(
    preparation.includes(
      '(one more when a counted pre script may or may not run because the package manager or its version is unknown)',
    ),
  )
})

// Value: protects=a chat whose run the page itself blocks (an automatic load racing the click) never edits a project file, not temporarily and not after the learner says continue, and offers only choices that change no project file; fails_when=the skill or the README keeps the 1.0.59 wording that a Cursor agent read as allowing a temporary edit; why_new=Cycle 0066 task 35 (N66: Grok 4.6 High disabled the page's auto-load in src/pages/index.tsx after 「はい、続けて」); seam=skill and README text; no_claim=that a chat obeys it (the N66 Cursor retest)
test('the bundled skill and the README forbid temporary project edits, also after the learner agrees to continue', async () => {
  // Arrange
  const skill = await readFile(
    join(__dirname, '..', '..', 'skills', 'codebook', 'SKILL.md'),
    'utf8',
  )
  const section = await readNextReadmeSection()
  // Act
  const paragraph =
    skill.split('\n\n').find((part) => part.startsWith('**Browser runs.**')) ??
    ''
  // Assert
  assert.ok(
    paragraph.includes(
      'not even temporarily or with a plan to restore them, and not after the learner agrees to continue',
    ),
  )
  assert.ok(
    paragraph.includes(
      'offer only choices that change no project file: another declared action or stop, another page, or explaining what the run did observe.',
    ),
  )
  assert.ok(
    section.includes(
      "never edits the project's files, config or scripts to make a run start or reach its stops, not even temporarily or after you agree to continue (when the page itself keeps the declared action from happening, such as an automatic load that races the click, it tells you what blocks it and offers only choices that change no project file)",
    ),
  )
})
