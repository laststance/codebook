import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { REACT_SCRIPTS_LIBRARY_MINIMUM_API } from '../constants'
import { liveRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { readResource } from '../resources'

import { createHarness } from './helpers'

type ReactScriptsLibraryHelp = {
  minimumApi: string
  whenToUse: string
  phase: string
  facts: string
  studies: string
  sample: unknown
  refusals: Record<
    string,
    { anchor: string; code: string; meaning: string; fix: string }
  >
}

/**
 * Reads the `library` section of the served repository-browser help as an agent does.
 * @param context - Test context that closes the harness.
 * @returns The `reactScriptsQuickStart.library` section.
 * @example
 * const library = await readLibraryHelp(context) // => { minimumApi: '1.35', … }
 */
async function readLibraryHelp(
  context: TestContext,
): Promise<ReactScriptsLibraryHelp> {
  const harness = await createHarness()
  context.after(() => harness.close())
  const resource = await readResource(
    harness.service,
    'codebook://help/repository-browser',
  )
  const help = JSON.parse('text' in resource ? resource.text : '{}') as {
    reactScriptsQuickStart: { library: ReactScriptsLibraryHelp }
  }
  return help.reactScriptsQuickStart.library
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

// Value: protects=the library section is gated on API 1.35 and states when to declare library, the root-library packageRoot "." and the confirmation wait; fails_when=a sentence a chat needs to declare the route leaves the help; no_claim=that a run succeeds
test('the react-scripts library help gates on API 1.35 and tells the chat to keep polling confirming', async (context) => {
  // Arrange
  const library = await readLibraryHelp(context)
  // Act / Assert
  assert.equal(REACT_SCRIPTS_LIBRARY_MINIMUM_API, '1.35')
  assert.equal(library.minimumApi, '1.35')
  assert.ok(
    library.whenToUse.includes('"." when the library is the repository root'),
  )
  assert.ok(
    library.whenToUse.includes(
      'installed manifest of one of its direct dependencies',
    ),
  )
  assert.ok(
    library.phase.includes(
      'keep polling the run resource while it reads confirming',
    ),
  )
  assert.ok(library.facts.includes('reachedThroughCount'))
  assert.ok(
    library.facts.includes('declared by <dependencies> in this Example'),
  )
  assert.ok(library.studies.includes('study format 17 (.study.v17.json)'))
})

// Value: protects=every library refusal reason has one anchor, the code the run raises and a fix; fails_when=a reason, anchor or code changes or leaves the help; no_claim=that the run raises it
test('the react-scripts library help lists every library refusal reason with its anchor and code', async (context) => {
  // Arrange
  const library = await readLibraryHelp(context)
  // Act
  const rows = Object.entries(library.refusals).map(([reason, row]) => [
    reason,
    row.code,
  ])
  // Assert
  assert.deepEqual(rows, [
    ['library-needs-package-root', 'LIBRARY_BUILD_UNSUPPORTED'],
    ['not-a-dependency', 'LIBRARY_BUILD_UNSUPPORTED'],
    ['library-redirect-not-applied', 'REACT_SCRIPTS_UNSUPPORTED'],
    ['library-build-stale', 'REACT_SCRIPTS_SEAL_FAILED'],
    ['library-build-unmapped', 'REACT_SCRIPTS_SEAL_FAILED'],
    ['library-not-in-build', 'REACT_SCRIPTS_SEAL_FAILED'],
    ['library-build-changed', 'RUNTIME_FAILED'],
  ])
  for (const [reason, row] of Object.entries(library.refusals)) {
    assert.equal(row.anchor, `codebook://help/repository-browser#${reason}`)
    assert.ok(row.fix.length > 0, reason)
  }
  const unmapped = library.refusals['library-build-unmapped']?.meaning ?? ''
  assert.ok(unmapped.includes('no-sources-content'))
  assert.ok(unmapped.includes('content-differs'))
})

// Value: protects=the library sample uses neutral placeholders and no real repository's names; fails_when=a real project's folder or package enters the sample; no_claim=none
test('the react-scripts library sample names no real repository', async (context) => {
  // Arrange
  const library = await readLibraryHelp(context)
  // Act
  const text = JSON.stringify(library.sample)
  // Assert
  assert.equal(/redux|tanstack|examples\/counter/i.test(text), false)
  assert.ok(text.includes('"library":{"packageRoot":"packages/widgets"}'))
})

// Value: protects=the library sample is a configuration the live schema accepts; fails_when=the sample drifts from the schema; no_claim=that a run succeeds. DEPENDS ON LANE D: passes only once the schema accepts library on react-scripts-dev
test('the react-scripts library sample parses with the live configuration schema', async (context) => {
  // Arrange
  const library = await readLibraryHelp(context)
  // Act
  const parsed = liveRepositoryConfigSchema.safeParse(library.sample)
  // Assert
  assert.equal(parsed.success, true)
})

// Value: protects=the skill's Create React App paragraph lets a library run stop in the declared library's checked-out source, as the README says; fails_when=the paragraph limits stops to the app's own source again, so a chat avoids a supported library stop; no_claim=how a chat follows it
test('the skill allows a react-scripts library run to stop in the library source', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  const paragraph =
    skill
      .split('\n')
      .find((line) => line.startsWith('**A Create React App app')) ?? ''
  // Act / Assert
  assert.ok(
    paragraph.includes(
      "when the run declares `library` (API 1.35 or later), in that library's checked-out source too",
    ),
    paragraph,
  )
  assert.equal(paragraph.includes("in the app's own source only"), false)
})

// Value: protects=the bundled skill, the README and AGENTS.md carry the bundler library route; fails_when=a sentence leaves one of them; no_claim=how a chat follows it
test('the skill, README and AGENTS.md document the react-scripts library route', async () => {
  // Arrange
  const skill = await readPackaged('skills/codebook/SKILL.md')
  const readme = await readPackaged('README.md')
  const agents = await readFile(join(__dirname, '../../../AGENTS.md'), 'utf8')
  // Act / Assert
  for (const phrase of [
    '`react-scripts-dev` when it reports API 1.35 or later',
    'keep polling the run resource while it reads `confirming`',
    '`publishedCopyLoaded` false',
  ])
    assert.ok(skill.includes(phrase), phrase)
  for (const phrase of [
    'Run the Example on the checked-out library (MCP API 1.35)',
    '`library-redirect-not-applied`',
    '`not-a-dependency`',
    'format 17 (`.study.v17.json`)',
  ])
    assert.ok(readme.includes(phrase), phrase)
  assert.ok(
    agents.includes(
      'library react-scripts Example run on the checked-out library (pack route)',
    ),
  )
})
