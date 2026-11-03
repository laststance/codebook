import assert from 'node:assert/strict'
import { realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  REPOSITORY_DISCOVERY_LIMIT_BYTES,
  REPOSITORY_DISCOVERY_TIMEOUT_MS,
} from '../constants'
import { StudyError } from '../errors'
import { createNextPagesDiscoveryCache } from '../utils/createNextPagesDiscoveryCache'
import { readPagesServerBundle } from '../utils/readPagesServerBundle'
import {
  sealPagesServerStop,
  type PagesServerStopSealRequest,
} from '../utils/sealPagesServerStop'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import {
  browserChunk,
  PAGE_SOURCE,
  nextPagesBuild,
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

// Value: protects=a Pages page whose entry chunks do not hold the entry page's own module (it is loaded later) cannot be checked against the client compile, so a server stop on one of its lines is refused as browser-module-absent with router pages and sideEffects unknown, never accepted unchecked; fails_when=a missing entry chunk module is read as "the client compile does not map the line" and the stop is sealed; no_claim=a real next/dynamic page (the harness writes the page chunk without the module)
test('a server stop on an entry-page line whose module no entry chunk holds is refused as browser-module-absent', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    fixture: { source: PAGE_SOURCE, citationEndLine: 5, declaredLine: 5 },
    sourcePath: 'src/pages/index.tsx',
    operations: SERVER_STOP_AT_ENTRY_LOAD,
    nextPages: {
      mappedLines: 4,
      serverCompile: true,
      citedInPageChunk: false,
    },
  })
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

/**
 * Writes the stand-in Pages project with a server compile that holds the entry page and returns the request that seals its line 5 (the data function) as a server stop, without going through a run, so a test can steer the discovery cache, the abort signal and the chunk fetcher the browser check uses.
 * @param context - The test, which removes the project afterwards.
 * @param extras - The request's signal, cache and fetcher; a fresh cache by default.
 * @returns The request, the workspace's build helpers and the cache the request carries.
 */
async function entryPageDataFunctionRequest(
  context: TestContext,
  extras: Partial<PagesServerStopSealRequest> = {},
) {
  const build = await nextPagesBuild(context)
  await build.writeServerBuild()
  const cache = extras.cache ?? createNextPagesDiscoveryCache()
  const request: PagesServerStopSealRequest = {
    workspace: build.workspace,
    selected: { ...build.page, line: 5, column: 1 },
    citationEndLine: 5,
    route: '/',
    entrySource: 'src/pages/index.tsx',
    ...extras,
    cache,
  }
  return { build, request, cache }
}

/**
 * Seals a request and returns what it rejected with.
 * @returns The rejection, or `undefined` when the seal passed.
 */
async function sealFailure(
  request: PagesServerStopSealRequest,
): Promise<unknown> {
  return sealPagesServerStop(request).then(
    () => undefined,
    (error: unknown) => error,
  )
}

// Value: protects=a run whose discovery bytes the server seal used up ends the entry-page client check with RUNTIME_FAILED, the budget message and the Pages details (router pages, sideEffects unknown), because the data function already ran; fails_when=the budget failure of the browser check is read as "no browser module" and refused as NEXT_STOP_NOT_SEALED, which blames the page instead of the spent budget; no_claim=a real 128 MiB build (the cache is primed with the bytes the server seal reads, so the server seal takes exactly what is left)
test('a server stop on an entry-page line ends as RUNTIME_FAILED with the Pages details when the server seal used the last discovery bytes', async (context) => {
  // Arrange
  const { build, request, cache } = await entryPageDataFunctionRequest(context)
  // The server seal alone reads this many bytes; a cache that has only that much left is empty once the server seal is done.
  const measured = createNextPagesDiscoveryCache()
  await readPagesServerBundle({
    workspace: build.workspace,
    selected: request.selected,
    route: '/',
    cache: measured,
  })
  cache.readBytes = REPOSITORY_DISCOVERY_LIMIT_BYTES - measured.readBytes
  // Act
  const failure = await sealFailure(request)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'RUNTIME_FAILED')
  assert.equal(failure.message, 'Build discovery resource limit exceeded')
  assert.deepEqual(failure.details, PAGES_DETAILS_AFTER_READINESS)
  // The server compile was read and decoded, and the budget ended at the browser check: the page's browser chunk was never read.
  assert.equal(cache.readBytes, REPOSITORY_DISCOVERY_LIMIT_BYTES)
  assert.deepEqual([...cache.chunks.keys()], ['server/pages/index.js'])
})

// Value: protects=a browser chunk fetch that fails after the run's discovery time ran out ends the entry-page client check with RUNTIME_FAILED, the budget message and the Pages details, not as a missing browser module; fails_when=the elapsed-time check of the browser check is removed, so the timeout of the fetch reads as "no browser module" and is refused as NEXT_STOP_NOT_SEALED; no_claim=a real 30 s wait or the real chunk fetcher (the fake fetcher spends the clock and fails)
test('a server stop on an entry-page line ends as RUNTIME_FAILED with the Pages details when the browser chunk fetch fails after the discovery time ran out', async (context) => {
  // Arrange
  const cache = createNextPagesDiscoveryCache()
  const { build, request } = await entryPageDataFunctionRequest(context, {
    cache,
    // The fetch spends the clock and fails the way an aborted download does, with an error that is no budget error.
    fetchChunk: async () => {
      cache.spentMs = REPOSITORY_DISCOVERY_TIMEOUT_MS
      throw new Error('The operation was aborted due to timeout')
    },
  })
  // No chunk file of the page exists, so its chunk is fetched from the owned server.
  await rm(join(build.workspace, '.next/dev/static/chunks/pages/index.js'))
  // Act
  const failure = await sealFailure(request)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'RUNTIME_FAILED')
  assert.equal(failure.message, 'Build discovery resource limit exceeded')
  assert.deepEqual(failure.details, PAGES_DETAILS_AFTER_READINESS)
})

// Value: protects=a run stopped while the entry page's browser chunk is fetched rejects the seal with the abort reason itself, not as a refusal about the browser module and not as RUNTIME_FAILED with the Pages details; fails_when=the abort check of the browser check is removed (the stop reads as a missing browser module) or the seal wraps the abort as RUNTIME_FAILED; no_claim=the real chunk fetcher (the fake fetcher stops the run and fails)
test('a run stopped during the entry-page browser check rejects the server stop seal with the abort reason unchanged', async (context) => {
  // Arrange
  const controller = new AbortController()
  const reason = new Error('The run was stopped')
  const { build, request } = await entryPageDataFunctionRequest(context, {
    signal: controller.signal,
    // The run is stopped while the fetch is under way; the fetch then fails with an error of its own.
    fetchChunk: async () => {
      controller.abort(reason)
      throw new Error('fetch failed')
    },
  })
  await rm(join(build.workspace, '.next/dev/static/chunks/pages/index.js'))
  // Act
  const failure = await sealFailure(request)
  // Assert
  assert.equal(failure, reason)
})
