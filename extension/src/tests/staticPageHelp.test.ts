import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { liveRepositoryConfigSchema } from '../repositoryConfigSchemas'
import { readResource } from '../resources'
import {
  STATIC_PAGE_NESTED_CONFIGURATION,
  STATIC_PAGE_LIBRARY_CONFIGURATION,
} from '../staticPageHelp'

import { createHarness } from './helpers'

type StaticPageQuickStart = {
  summary: string
  limits: string[]
  configurationNested: unknown
  refusals: Record<string, { anchor: string; reasons: Record<string, string> }>
  library: {
    whatRuns: string[]
    refusals: Record<string, string>
    limits: string[]
    sample: unknown
  }
}

/**
 * Reads the served repository-browser help as an agent does.
 * @param context - Test context that closes the harness.
 * @returns The parsed help with the `staticPageQuickStart` key and `startHere`.
 * @example
 * const help = await readHelp(context) // => { startHere: '…', staticPageQuickStart: {…} }
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
    staticPageQuickStart: StaticPageQuickStart
  }
}

// Value: protects=the two copyable static-page configurations in the help are configurations the live schema accepts, so a chat that copies one does not start with a refused shape; fails_when=a sample drifts from the schema or the help stops serving it; no_claim=that a run with it succeeds
test('the static-page help samples parse with the live configuration schema', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const nested = liveRepositoryConfigSchema.safeParse(
    help.staticPageQuickStart.configurationNested,
  )
  const library = liveRepositoryConfigSchema.safeParse(
    help.staticPageQuickStart.library.sample,
  )
  // Assert
  assert.equal(nested.success, true)
  assert.equal(library.success, true)
  assert.deepEqual(
    help.staticPageQuickStart.configurationNested,
    STATIC_PAGE_NESTED_CONFIGURATION,
  )
  assert.deepEqual(
    help.staticPageQuickStart.library.sample,
    STATIC_PAGE_LIBRARY_CONFIGURATION,
  )
})

// Value: protects=the static-page help has an entry for every refusal code with the reason keys the code raises, so a refusal's help anchor lands on a recovery; fails_when=a code, an anchor or a reason leaves the help; no_claim=that the run raises these refusals
test('the static-page help lists every refusal code with each reason the code raises', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const refusals = help.staticPageQuickStart.refusals
  // Act
  const reasonsOf = (code: string) => Object.keys(refusals[code]?.reasons ?? {})
  // Assert
  const codes = [
    'STATIC_PAGE_UNSUPPORTED',
    'STATIC_PAGE_SERVER_FAILED',
    'STATIC_PAGE_SEAL_FAILED',
    'REPOSITORY_BROWSER_LIBRARY_REFUSED',
  ]
  assert.deepEqual(Object.keys(refusals), codes)
  for (const code of codes)
    assert.equal(
      refusals[code]?.anchor,
      `codebook://help/repository-browser#${code}`,
    )
  assert.deepEqual(reasonsOf('STATIC_PAGE_UNSUPPORTED'), [
    'no-entry-page',
    'needs-bundler',
    'entry-unreadable',
    'not-a-static-page',
  ])
  assert.deepEqual(reasonsOf('STATIC_PAGE_SERVER_FAILED'), [
    'listen-failed',
    'not-ready',
  ])
  assert.deepEqual(reasonsOf('STATIC_PAGE_SEAL_FAILED'), [
    'outside-package',
    'node-modules',
    'not-in-page-script',
    'ambiguous-source',
    'unmapped-line',
    'map-limit',
    'map-unreadable',
    'library-build-stale',
    'library-not-in-build',
    'library-build-unmapped',
  ])
  assert.deepEqual(reasonsOf('REPOSITORY_BROWSER_LIBRARY_REFUSED'), [
    'library-path-absent',
  ])
})

// Value: protects=every codebook://help/repository-browser#<CODE> anchor that staticPageRefusals.ts writes into a recovery resolves to a refusal entry of the static-page help; fails_when=a refusal recovery links to a code the help lacks; no_claim=anchors of other adapters
test('every help anchor the static-page refusals link to resolves to a help entry', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const source = await readFile(
    join(__dirname, '../../src/staticPageRefusals.ts'),
    'utf8',
  )
  // Act
  const linkedCodes = new Set(
    [...source.matchAll(/recoveryEnd\('([A-Z_]+)'\)/g)].map(
      (match) => match[1],
    ),
  )
  // Assert
  assert.ok(linkedCodes.has('STATIC_PAGE_SEAL_FAILED'))
  assert.ok(linkedCodes.has('REPOSITORY_BROWSER_LIBRARY_REFUSED'))
  for (const code of linkedCodes)
    assert.equal(
      help.staticPageQuickStart.refusals[code ?? '']?.anchor,
      `codebook://help/repository-browser#${code}`,
    )
})

// Value: protects=the static-page help states when to use it (ready flag, API 1.42, no build step), the needs-bundler limit and the CDN disclosure, and the library route says the packed build replaces the unpkg and jsDelivr URLs; fails_when=a sentence leaves the help; no_claim=that the sentences match a run
test('the static-page help states its use, its limits and the library CDN replacement', async (context) => {
  // Arrange
  const help = await readHelp(context)
  const section = help.staticPageQuickStart
  // Act
  const limitText = section.limits.join('\n')
  const libraryText = section.library.whatRuns.join('\n')
  // Assert
  assert.ok(section.summary.includes('adapters["static-page"].ready'))
  assert.ok(section.summary.includes('API 1.42'))
  assert.ok(section.summary.includes('no build step'))
  assert.ok(limitText.includes('needs-bundler'))
  assert.ok(limitText.includes('which is not the checked-out library'))
  assert.ok(limitText.includes('library-not-in-build'))
  const libraryJson = JSON.stringify(section.library)
  assert.ok(libraryText.includes("packed build's file"))
  assert.ok(libraryJson.includes('https://unpkg.com/<name>@<version>/<path>'))
  assert.ok(
    libraryJson.includes(
      'https://cdn.jsdelivr.net/npm/<name>@<version>/<path>',
    ),
  )
  assert.ok(
    section.library.limits.join('\n').includes('loads the published copy'),
  )
  assert.ok(
    section.library.refusals['library-path-absent']?.includes(
      'details.cause is absent (the packed build lacks the path), too-large (a file over 32 MiB) or unreadable (a directory or a read error)',
    ),
  )
})

// Value: protects=the start-here sentence routes a plain HTML page to staticPageQuickStart with API 1.42; fails_when=startHere stops naming the section or its minimum API; no_claim=the agent follows it
test('the repository-browser start guide routes a plain HTML page to staticPageQuickStart', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const startHere = help.startHere
  // Assert
  assert.ok(startHere.includes('staticPageQuickStart for a plain HTML page'))
  assert.ok(startHere.includes('(API 1.42 or later)'))
})

// Value: protects=the library help tells a chat that a stop in a minified build reads declared inspections by their source names through the map names; fails_when=the sentence leaves the help, so a chat declares compiled names; no_claim=that a given build keeps names in its map
test('the static-page library help says a minified build is read by source name through the map names', async (context) => {
  // Arrange
  const help = await readHelp(context)
  // Act
  const libraryText = help.staticPageQuickStart.library.whatRuns.join('\n')
  // Assert
  assert.ok(
    libraryText.includes(
      "A stop in a minified build reads each declared inspection by its source name through the build's source map names (when a name maps to one variable of the paused frame's scopes; otherwise it stays unavailable).",
    ),
  )
})
