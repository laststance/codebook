import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { liveRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { readResource } from '../resources'

import { createHarness } from './helpers'

type NextLibraryHelp = {
  minimumApi: string
  whenToUse: string
  whatRuns: string[]
  phase: string
  facts: string
  studies: string
  limits: string[]
  sample: unknown
  refusals: Record<
    string,
    { anchor?: string; code?: string; meaning?: string; fix?: string }
  >
}

/**
 * Reads the `library` section of the served repository-browser help as an agent does.
 * @param context - Test context that closes the harness.
 * @returns The `nextQuickStart.library` section.
 * @example
 * const library = await readLibraryHelp(context) // => { minimumApi: '1.36', … }
 */
async function readLibraryHelp(context: TestContext): Promise<NextLibraryHelp> {
  const harness = await createHarness()
  context.after(() => harness.close())
  const resource = await readResource(
    harness.service,
    'codebook://help/repository-browser',
  )
  const help = JSON.parse('text' in resource ? resource.text : '{}') as {
    nextQuickStart: { library: NextLibraryHelp }
  }
  return help.nextQuickStart.library
}

/**
 * Reads a file relative to the extension folder.
 * @param relativePath - Path below the extension folder.
 * @returns The file text.
 * @example
 * await readPackaged('README.md') // => '# Codebook …'
 */
async function readPackaged(relativePath: string): Promise<string> {
  return readFile(join(__dirname, '../..', relativePath), 'utf8')
}

// Value: protects=the Next library help is gated on API 1.36 and tells the chat the root-library packageRoot "." rule, the direct-dependency rule and the confirmation wait; fails_when=a sentence a chat needs to declare the route leaves the help; no_claim=that a run succeeds
test('the Next library help gates on API 1.36 and tells the chat to keep polling confirming', async (context) => {
  // Arrange
  const library = await readLibraryHelp(context)
  // Act / Assert
  assert.equal(library.minimumApi, '1.36')
  assert.ok(
    library.whenToUse.includes('"." when the library is the repository root'),
  )
  assert.ok(library.whenToUse.includes('lists the library'))
  assert.ok(
    library.phase.includes(
      'keep polling the run resource while it reads confirming',
    ),
  )
  assert.ok(library.whatRuns.join(' ').includes('next dev --webpack'))
  assert.ok(library.facts.includes('publishedCopyLoaded'))
  assert.ok(library.studies.includes('study format 18 (.study.v18.json)'))
})

// Value: protects=every Next library refusal reason has its anchor, the code the run raises and a fix; fails_when=a reason, anchor or code leaves or changes in the help; no_claim=that the run raises it
test('the Next library help lists the library refusal reasons with their anchors and codes', async (context) => {
  // Arrange
  const library = await readLibraryHelp(context)
  // Act
  const rows = [
    'library-needs-package-root',
    'not-a-dependency',
    'library-redirect-not-applied',
    'library-stop-unsupported',
  ].map((reason) => [
    reason,
    library.refusals[reason]?.code,
    library.refusals[reason]?.anchor,
  ])
  // Assert
  assert.deepEqual(rows, [
    [
      'library-needs-package-root',
      'LIBRARY_BUILD_UNSUPPORTED',
      'codebook://help/repository-browser#library-needs-package-root',
    ],
    [
      'not-a-dependency',
      'LIBRARY_BUILD_UNSUPPORTED',
      'codebook://help/repository-browser#not-a-dependency',
    ],
    [
      'library-redirect-not-applied',
      'NEXT_UNSUPPORTED_SETTING',
      'codebook://help/repository-browser#library-redirect-not-applied',
    ],
    [
      'library-stop-unsupported',
      'NEXT_STOP_NOT_SEALED',
      'codebook://help/repository-browser#library-stop-unsupported',
    ],
  ])
  assert.ok(library.refusals['package-manager-unsupported'] === undefined)
  assert.ok(
    String(library.refusals.packageManagerUnsupported).includes(
      'package-manager-unsupported',
    ),
  )
  assert.ok(library.limits.join(' ').includes('library-stop-unsupported'))
})

// Value: protects=the library sample uses neutral placeholders and no real repository's names or answer keys; fails_when=a real project's folder or package enters the sample; no_claim=none
test('the Next library sample names no real repository', async (context) => {
  // Arrange
  const library = await readLibraryHelp(context)
  // Act
  const text = JSON.stringify(library.sample)
  // Assert
  assert.equal(/redux|rsc|tanstack|publish-ci/i.test(text), false)
  assert.ok(text.includes('"library":{"packageRoot":"packages/widgets"}'))
})

// Value: protects=the library sample is a configuration the live schema accepts; fails_when=the sample drifts from the schema; no_claim=that a run succeeds. DEPENDS ON LANE A: passes only once the schema accepts library on next-dev-webpack
test('the Next library sample parses with the live configuration schema', async (context) => {
  // Arrange
  const library = await readLibraryHelp(context)
  // Act
  const parsed = liveRepositoryConfigSchema.safeParse(library.sample)
  // Assert
  assert.equal(parsed.success, true)
})

// Value: protects=the bundled skill names next-dev-webpack with API 1.36 beside the other bundlers and warns that library stops are refused; fails_when=the sentence loses the adapter, the API or the stop limit; no_claim=how a chat follows it
test('the skill names next-dev-webpack at API 1.36 in its library sentence', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  // Act / Assert
  for (const phrase of [
    '`vite-dev` when `codebook_status` reports API 1.34 or later',
    '`react-scripts-dev` when it reports API 1.35 or later',
    '`next-dev-webpack` when it reports API 1.36 or later',
    "a Next library run refuses a stop in the library's own source",
  ])
    assert.ok(skill.includes(phrase), phrase)
})

// Value: protects=the README and AGENTS.md carry the Next library route, its refusals and the format 18 saved-study note; fails_when=a user-visible sentence leaves one of them; no_claim=how a chat follows it
test('the README and AGENTS.md document the Next library route', async () => {
  // Arrange
  const readme = await readPackaged('README.md')
  const agents = await readFile(join(__dirname, '../../../AGENTS.md'), 'utf8')
  // Act / Assert
  for (const phrase of [
    'with **MCP API 1.44**',
    'Run the Example on the checked-out library (MCP API 1.36)',
    "the Example's own `next dev --webpack`",
    '`library-needs-package-root`',
    '`not-a-dependency`',
    '`library-redirect-not-applied`',
    '`library-stop-unsupported`',
    'format 18 (`.study.v18.json`)',
    'Codebook 0.2.99 and older list it as saved by a newer Codebook',
  ])
    assert.ok(readme.includes(phrase), phrase)
  assert.ok(
    agents.includes(
      'library Next Example run on the checked-out library (pack route)',
    ),
  )
})
