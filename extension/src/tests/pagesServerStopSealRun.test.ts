import assert from 'node:assert/strict'
import { realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { StudyError } from '../errors'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import {
  browserChunk,
  PAGE_SOURCE,
  pagesEvalModule,
  serverChunk,
} from './utils/nextPagesBuildHarness'

/** The `operations` option of a version 3 Pages run whose only stop is a server stop at the entry load (`afterOperation` 0, `operations` omitted). */
const SERVER_STOP_AT_ENTRY_LOAD = {
  operations: [],
  stopOperations: [0],
  stopParticipants: ['server' as const],
}

/** The fields every Pages stop refusal after the owned server started carries. */
const PAGES_DETAILS_AFTER_READINESS = {
  router: 'pages',
  sideEffects: 'unknown',
}

/** The entry page with a comment on line 1, the page component on lines 2-4 and a data function on line 5: only lines 2-5 hold code. */
const COMMENT_ABOVE_COMPONENT_PAGE_SOURCE =
  '// Home renders the label.\n' +
  'export default function Home() {\n' +
  "  return 'Show more'\n" +
  '}\n' +
  'export const getStaticProps = () => ({ props: {} })\n'

/** The entry page with the page component on lines 1-3, a comment on line 4 and a data function on line 5: lines 1-3 and 5 hold code. */
const COMMENT_ABOVE_DATA_FUNCTION_PAGE_SOURCE =
  'export default function Home() {\n' +
  "  return 'Show more'\n" +
  '}\n' +
  '// getStaticProps feeds the page.\n' +
  'export const getStaticProps = () => ({ props: {} })\n'

/** An older save of the entry page, whose text a stale browser chunk's map still carries: line 2 names another label than the accepted source. */
const STALE_PAGE_SOURCE =
  'export default function Home() {\n' +
  "  const label = 'Show less'\n" +
  '  return label\n' +
  '}\n' +
  'export const getStaticProps = () => ({ props: {} })\n'

/**
 * Runs a harness run's preparation and returns what it rejected with.
 * @returns The rejection, or `undefined` when the preparation passed.
 */
async function preparationFailure(
  harness: Awaited<ReturnType<typeof configuredRuntimeHarness>>,
): Promise<unknown> {
  return harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
}

// Value: protects=a server stop declared on a comment line directly above the page component is refused as client-component, because its breakpoint would be requested on the component's first server position, a line the page's client compile maps; fails_when=the stop is accepted because the comment line itself is unmapped in the client compile, so the run later ends not reached or unconfirmed after the data function ran; no_claim=a real Next compile (the harness writes the maps)
test('a server stop on a comment line above the page component is refused as client-component', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    fixture: {
      source: COMMENT_ABOVE_COMPONENT_PAGE_SOURCE,
      citationEndLine: 5,
      declaredLine: 1,
    },
    sourcePath: 'src/pages/index.tsx',
    operations: SERVER_STOP_AT_ENTRY_LOAD,
    nextPages: {
      mappedLines: [2, 3, 4],
      serverCompile: { mappedLines: [2, 3, 4, 5] },
    },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_STOP_NOT_SEALED')
  assert.deepEqual(failure.details, {
    reason: 'client-component',
    stop: 'src/pages/index.tsx:1',
    ...PAGES_DETAILS_AFTER_READINESS,
  })
  assert.equal(harness.launchConfigurations.length, 0)
})

// Value: protects=a server stop declared on a comment line directly above the entry page's data function is still sealed, because its breakpoint is requested on the data function's line, which the page's client compile does not map; fails_when=the requested-line check refuses it as client-component, or reads a line other than the first mapped server line after the comment; no_claim=arming or pausing (the stand-in server has no inspector, so the preparation ends after the seal)
test('a server stop on a comment line above the data function is sealed from the server compile', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    fixture: {
      source: COMMENT_ABOVE_DATA_FUNCTION_PAGE_SOURCE,
      citationEndLine: 5,
      declaredLine: 4,
    },
    sourcePath: 'src/pages/index.tsx',
    operations: SERVER_STOP_AT_ENTRY_LOAD,
    nextPages: {
      mappedLines: [1, 2, 3],
      serverCompile: { mappedLines: [1, 2, 3, 5] },
    },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.notEqual(
    failure instanceof StudyError ? failure.code : undefined,
    'NEXT_STOP_NOT_SEALED',
  )
  assert.deepEqual(
    harness.run
      .view()
      .events.filter((event) => event.type === 'seal.layer')
      .map((event) => JSON.parse(JSON.stringify(event.detail))),
    [{ stop: 'src/pages/index.tsx:4', layer: 'pages-dir-node' }],
  )
})

// Value: protects=a raw failure of the Pages server seal (here two server chunks carry different copies of the stop's module), which happens after the readiness request ran the data function, reports the router and sideEffects unknown with its message instead of a bare failure with no details; fails_when=the failure reaches the service as a plain Error with no details, or its message is lost; no_claim=which raw failure a real build raises (the reader tests pin each)
test('a raw failure of the Pages server seal reports router pages and sideEffects unknown', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    fixture: { source: PAGE_SOURCE, citationEndLine: 5, declaredLine: 5 },
    sourcePath: 'src/pages/index.tsx',
    operations: SERVER_STOP_AT_ENTRY_LOAD,
    nextPages: {
      mappedLines: 4,
      serverCompile: {
        holdsCited: false,
        chunks: {
          'chunks/first': { holdsCited: true },
          'chunks/second': { holdsCited: true },
        },
      },
    },
  })
  const workspace = await realpath(harness.directory)
  // The second chunk carries a copy of the module whose map covers one line fewer, so the two copies cannot be told apart.
  await writeFile(
    join(workspace, '.next/dev/server/chunks/second.js'),
    serverChunk({
      './src/pages/index.tsx': pagesEvalModule(
        workspace,
        'src/pages/index.tsx',
        PAGE_SOURCE,
        'pages-dir-node',
        4,
      ),
    }),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'RUNTIME_FAILED')
  assert.match(failure.message, /Ambiguous application source chunk/)
  assert.deepEqual(failure.details, PAGES_DETAILS_AFTER_READINESS)
})

// Value: protects=a stale client compile of the entry page (its browser map's original differs from the accepted source) refuses a server stop on an entry-page line as not sealed with the browser-module wording, router pages and sideEffects unknown; fails_when=the verifier's "Map original differs from frozen source" escapes the browser check as a raw failure or as RUNTIME_FAILED; no_claim=how a real Next build leaves a stale chunk (the harness rewrites it)
test('a server stop on an entry-page line whose browser chunk maps an older text of the page is refused as browser-module-absent', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    fixture: { source: PAGE_SOURCE, citationEndLine: 5, declaredLine: 5 },
    sourcePath: 'src/pages/index.tsx',
    operations: SERVER_STOP_AT_ENTRY_LOAD,
    nextPages: { mappedLines: 4, serverCompile: true },
  })
  const workspace = await realpath(harness.directory)
  // The page's browser chunk carries the module of an older save of the page, so its map's original is not the accepted text.
  await writeFile(
    join(workspace, '.next/dev/static/chunks/pages/index.js'),
    browserChunk('pages/index', {
      './src/pages/index.tsx': pagesEvalModule(
        workspace,
        'src/pages/index.tsx',
        STALE_PAGE_SOURCE,
        'pages-dir-browser',
        4,
      ),
    }),
  )
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_STOP_NOT_SEALED')
  assert.equal(
    failure.message,
    "Codebook could not verify the browser code of the page that holds src/pages/index.tsx:5, which it needs to tell a data-function line from a page-component line. This does not establish that the line is in the page's data function. A stop in a module that the data function imports, instead of the page's own file, needs no browser check: declare it there.",
  )
  assert.deepEqual(failure.details, PAGES_DETAILS_AFTER_READINESS)
  assert.equal(harness.launchConfigurations.length, 0)
})
