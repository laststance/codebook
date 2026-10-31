import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { NEXT_SETUP_STEPS, REPOSITORY_SETUP_TIMEOUT_MS } from '../constants'
import { ERROR_RECOVERY, StudyError } from '../errors'
import { LearningLibrary } from '../learningLibrary'
import {
  nextSetupDeadlineRecovery,
  nextSetupDeadlineSentence,
} from '../nextRefusals'
import { RecordingStore } from '../recordingStore'
import { RepositoryBookStore } from '../repositoryBook'
import { readResource } from '../resources'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StudyService } from '../service'
import { refusalFailureOf } from '../utils/refusalFailureOf'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { PAGE_SOURCE } from './utils/nextPagesBuildHarness'

const NO_STOPS: never[] = []

/** The answer of route manifests that do not list the entry path while the Pages manifest exists. */
const UNRESOLVED_WITH_PAGES = {
  settings: {},
  kind: 'unresolved',
  manifests: { pages: true, app: false },
} as const

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

/**
 * Starts a study service over a harness run, as an agent's start does, and waits for its preparation.
 * @param context - The test, which shuts the service down when it ends.
 * @param harness - The run to serve.
 * @returns The service, the start receipt and the run's record.
 */
async function startThroughService(
  context: TestContext,
  harness: Awaited<ReturnType<typeof configuredRuntimeHarness>>,
) {
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const directory = join(harness.directory, '.learning')
  const library = new LearningLibrary(directory, '0'.repeat(64))
  books = new RepositoryBookStore(harness.sources, library)
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Two citations.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: harness.definition.descriptor.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  service = new StudyService(
    {
      workspace: harness.directory,
      host: {
        id: 'vscode',
        productVersion: 'test',
        apiVersion: 'test',
        commit: 'test',
      },
      build: {
        revision: 'controlled-runtime',
        dirty: false,
        sourceHash: '0'.repeat(64),
      },
      prerequisites: async () => ({ ready: true, missing: [] }),
      createRuntime: async () => harness.run,
    },
    join(harness.directory, '.service'),
  )
  service.repository = books
  service.recordings = new RecordingStore(directory, library.workspaceKey)
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'pages-run',
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  await record.preparation
  return { service, receipt, record }
}

// --- The run sequence table ---

// Value: protects=a basePath setting is refused first, before the redirect the same entry answered, with the Next version and before any browser opens; fails_when=the redirect wins, the version is missing or a browser opens; why_new=Cycle 0065 sequence table (setting + redirect); seam=scripted entry answer and route manifests; no_claim=reading routes-manifest.json (readNextRouteManifests tests)
test('a Pages run whose project sets basePath and whose entry redirects is refused for the setting before any browser opens', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {
      entry: { status: 307, location: '/docs' },
      manifests: { ...UNRESOLVED_WITH_PAGES, settings: { basePath: '/docs' } },
    },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_UNSUPPORTED_SETTING')
  assert.match(
    failure.message,
    /^This Next 16\.4\.3 project sets basePath \(\/docs\)/,
  )
  assert.equal(harness.launchConfigurations.length, 0)
})

// Value: protects=an entry path no manifest lists, on a page with no router, is refused as not found before the browser opens; fails_when=the run opens the browser and waits for a router; why_new=Cycle 0065 sequence table (no route + no router); seam=scripted manifests and router states; no_claim=none
test('a Pages run whose entry path no manifest lists and whose page has no router is refused as not found before any browser opens', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {
      manifests: UNRESOLVED_WITH_PAGES,
      pageStates: [{ pathname: '/', routerSeen: false, isReady: false }],
    },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_ROUTE_NOT_FOUND')
  assert.equal(harness.launchConfigurations.length, 0)
  assert.equal(harness.pagesStateReads(), 0)
})

// Value: protects=a wrong entryPath the server answers with 404 is refused as not found naming the path and the status, not as an uncoded readiness failure; fails_when=the 404 throws before the manifests are read or the code differs; why_new=Cycle 0065 sequence table (wrong entryPath 404); seam=scripted entry answer and manifests; no_claim=none
test('a Pages run whose entry path answers 404 is refused as not found naming the path and the status', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {
      entryPath: '/missing',
      entry: { status: 404 },
      manifests: UNRESOLVED_WITH_PAGES,
    },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_ROUTE_NOT_FOUND')
  assert.match(
    failure.message,
    /^No page serves the entry path \/missing \(HTTP 404\)/,
  )
})

// Value: protects=a same-origin redirect of the entry page is refused naming the target with its query and fragment values redacted; fails_when=the token reaches the message or the code differs; why_new=Cycle 0065 sequence table (same-origin 3xx); seam=scripted entry answer, described by the real code; no_claim=none
test('a Pages run whose entry redirects on the same origin is refused naming the redacted target', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {
      entryPath: '/dashboard',
      // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every message.
      entry: { status: 307, location: '/login?token=SECRET#frag' },
      manifests: UNRESOLVED_WITH_PAGES,
    },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_ENTRY_REDIRECTED')
  assert.equal(
    failure.message,
    // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every message.
    'The entry path /dashboard answered HTTP 307 and redirects to /login?token=<redacted>#<redacted> on the same origin. Codebook observes only the page the entry path itself renders, so it stopped before opening the browser.',
  )
})

// Value: protects=a redirect of the entry page to another origin is refused as "another origin" without its address; fails_when=the other host is named; why_new=Cycle 0065 sequence table (other-origin 3xx); seam=scripted entry answer; no_claim=that nothing fetched it (nextEntryReadiness tests)
test('a Pages run whose entry redirects to another origin is refused without naming that origin', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {
      entry: {
        status: 302,
        location: 'https://accounts.example.com/authorize?state=SECRET',
      },
      manifests: UNRESOLVED_WITH_PAGES,
    },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_ENTRY_REDIRECTED')
  assert.match(
    failure.message,
    /redirects to another origin \(Codebook neither names nor follows it\)/,
  )
  assert.equal(failure.message.includes('accounts.example.com'), false)
})

// Value: protects=an entry page that redirects to itself is refused naming the redirect loop; fails_when=the loop is not named; why_new=Cycle 0065 sequence table (redirect loop); seam=scripted entry answer; no_claim=a loop over several hops
test('a Pages run whose entry redirects to itself is refused naming a redirect loop', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {
      entryPath: '/dashboard',
      entry: { status: 308, location: '/dashboard' },
      manifests: UNRESOLVED_WITH_PAGES,
    },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_ENTRY_REDIRECTED')
  assert.match(
    failure.message,
    /redirects to \/dashboard on the same origin: a redirect loop, since it redirects to itself\./,
  )
})

// Value: protects=a client redirect that lands after the router was ready (here between preparation and the click) ends the run with NEXT_ENTRY_REDIRECTED and no input is sent; fails_when=the click is dispatched on the other page or the code is lost; why_new=Cycle 0065 sequence table (client redirect 200 ms after ready; the pathname check right before the first input); seam=setPagesState stands in for the page's router.push; no_claim=the timing of a real router.push
test('a Pages page that redirects on the client after its router was ready receives no click and the run ends as redirected', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {},
  })
  await harness.run.prepare()
  harness.setPagesState({
    pathname: '/login',
    routerSeen: true,
    isReady: true,
    route: '/login',
  })
  // Act
  harness.run.action('click', 'repository-click')
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the redirect refusal',
  )
  // Assert
  const refusal = refusalFailureOf(harness.run.view().failures[0] ?? '')
  assert.equal(refusal?.code, 'NEXT_ENTRY_REDIRECTED')
  assert.equal(
    refusal?.message,
    'The page left the entry path / for /login before the click was sent (a client redirect), so Codebook sent no click; the browser Codebook opened is closed with the run.',
  )
  assert.equal(harness.mouse.length, 0)
  assert.equal(harness.run.view().operation?.inputDispatched, false)
})

// Value: protects=a Pages page whose router never appears ends at the setup budget with NEXT_SETUP_DEADLINE, the router step and the router-absent recovery (fix entryPath, never retry unchanged); fails_when=the deadline reads as the plain App text or with another variant; why_new=Cycle 0065 sequence table (router absent at the deadline); seam=the manual clock fires the setup deadline; no_claim=a real page's router
test('a Pages page with no Next router ends at the setup deadline with the router-absent recovery', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {
      pageStates: [{ pathname: '/', routerSeen: false, isReady: false }],
    },
  })
  const preparing = harness.run.prepare().catch(() => undefined)
  await waitUntil(() => harness.pagesStateReads() >= 2, 'the router wait')
  // Act
  harness.advance(REPOSITORY_SETUP_TIMEOUT_MS)
  await preparing
  // Assert
  const refusal = refusalFailureOf(harness.run.view().failures[0] ?? '')
  assert.deepEqual(refusal, {
    code: 'NEXT_SETUP_DEADLINE',
    message: nextSetupDeadlineSentence(
      NEXT_SETUP_STEPS.waitingForRouter,
      REPOSITORY_SETUP_TIMEOUT_MS,
      'absent',
    ),
    recoveryOverride: nextSetupDeadlineRecovery('router-absent'),
  })
  assert.equal(harness.mouse.length, 0)
})

// Value: protects=a Pages router that appears and turns ready only after some reads lets the run reach ready; fails_when=the first not-ready read refuses the run; why_new=Cycle 0065 sequence table (a router that turns ready late passes); seam=scripted router states; no_claim=none
test('a Pages router that turns ready late lets the run reach ready', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {
      pageStates: [
        { pathname: '/', routerSeen: false, isReady: false },
        { pathname: '/', routerSeen: false, isReady: false },
        { pathname: '/', routerSeen: true, isReady: false, route: '/' },
        { pathname: '/', routerSeen: true, isReady: true, route: '/' },
      ],
    },
  })
  // Act
  await harness.run.prepare()
  // Assert
  assert.equal(harness.run.view().status, 'ready')
  assert.equal(harness.pagesStateReads(), 4)
})

// --- Pages checks after the load ---

// Value: protects=a Pages page that already sits on another path once it loaded is refused before any input; fails_when=the final path is not compared; why_new=Cycle 0065 step 9 (final path); seam=scripted router state; no_claim=none
test('a Pages page that ended on another path once it loaded is refused as redirected before any input', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {
      pageStates: [
        {
          pathname: '/login',
          routerSeen: true,
          isReady: true,
          route: '/login',
        },
      ],
    },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_ENTRY_REDIRECTED')
  assert.equal(
    failure.message,
    'The page left the entry path / for /login once the page loaded (a redirect in the page), so Codebook sent no input or click; the browser Codebook opened is closed with the run.',
  )
})

// Value: protects=a Pages page whose router reports another route than the resolved one (a rewrite or middleware) is refused naming both routes; fails_when=the route is not compared; why_new=Cycle 0065 step 9 (router.route match); seam=scripted router state; no_claim=none
test('a Pages page whose router reports another route than the resolved one is refused naming both routes', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {
      pageStates: [
        { pathname: '/', routerSeen: true, isReady: true, route: '/[slug]' },
      ],
    },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_ENTRY_REDIRECTED')
  assert.match(
    failure.message,
    /reports the Pages route \/\[slug\], not \/, the route the entry path resolved to/,
  )
})

// --- Pages seal ---

// Value: protects=a Pages stop is sealed from the page's entry chunk before the browser opens, so the page's parse of its module binds it; fails_when=the seal happens after the navigation or the parsed module is not bound; why_new=Cycle 0065 step 7 (seal before navigation); seam=the real Pages seal over a written build; no_claim=a native debugger binding
test('a Pages stop sealed from the page chunk before navigation binds when the page parses its module', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {},
  })
  // Act
  await harness.run.prepare()
  // Assert
  const events = harness.run.view().events.map((event) => event.type)
  assert.equal(harness.run.view().status, 'ready')
  assert.ok(
    events.indexOf('source.sealed') < events.indexOf('stop.module-parsed'),
  )
  const parsed = harness.run
    .view()
    .events.find((event) => event.type === 'stop.module-parsed')
  assert.equal(
    JSON.stringify(parsed?.detail).includes(
      'webpack-internal:///(pages-dir-browser)/./src/theme.ts',
    ),
    true,
  )
})

// Value: protects=two stops of one Pages run share one discovery cache, so the chunk both live in is read once; fails_when=each stop gets its own cache or reads the chunk again; why_new=Cycle 0065 (one NextPagesDiscoveryCache per run); seam=a spy around the real Pages seal; no_claim=the cache's own accounting (readPagesDevelopmentBundle tests)
test('two stops in one Pages chunk share the run discovery cache and read the chunk once', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'enabled', mode: 'value', required: true }],
      },
    ],
    { nextPages: {} },
  )
  // Act
  await harness.run.prepare()
  // Assert
  const [first, second] = harness.pagesSeals
  assert.equal(harness.pagesSeals.length, 2)
  assert.equal(first!.cache, second!.cache)
  const secondReadBytes = second!.readBytesAfter! - second!.readBytesBefore
  assert.equal(
    secondReadBytes,
    Buffer.byteLength(harness.definition.descriptor.sources[0]!.text) +
      Buffer.byteLength(harness.pagesBuildManifest!),
  )
})

// --- Pages unmapped line ---

// Value: protects=a stop on a getStaticProps line, which the page's server compile maps and its browser code does not, is refused as server-only before the browser opens; fails_when=the general uncoded binding failure or NEXT_STOP_NOT_SEALED is given; why_new=Cycle 0065 NEXT_SERVER_ONLY_STOP (server-compile evidence); seam=a written server compile; no_claim=a real Next server compile
test('a Pages stop on a line only the server compile maps is refused as server-only before any browser opens', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    fixture: { source: PAGE_SOURCE, citationEndLine: 5, declaredLine: 5 },
    nextPages: { mappedLines: 4, serverCompile: true },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_SERVER_ONLY_STOP')
  assert.equal(
    failure.message,
    "Declared stop src/theme.ts:5 cannot pause in the browser: the line is compiled for the server only: the page's server compile maps it and the code the browser loads does not (for example getStaticProps or getServerSideProps). Move the stop to the client code of the page that serves the same question.",
  )
  assert.equal(harness.launchConfigurations.length, 0)
})

// Value: protects=an unmapped Pages line without server evidence is refused as not sealed, saying it is not thereby server-only; fails_when=it is called server-only or stays uncoded; why_new=Cycle 0065 NEXT_STOP_NOT_SEALED (no verified browser mapping); seam=a build without a server compile; no_claim=none
test('a Pages stop on an unmapped line without server evidence is refused as not sealed, not as server-only', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    fixture: { source: PAGE_SOURCE, citationEndLine: 5, declaredLine: 5 },
    nextPages: { mappedLines: 4 },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_STOP_NOT_SEALED')
  assert.equal(
    failure.message,
    'Codebook could not verify a browser source mapping for src/theme.ts:5. This does not establish that the code is server-only.',
  )
})

// Value: protects=a stop in the Pages _document file is refused as server-only before any chunk is read; fails_when=the run reads the build first (here it has no chunks, so a read fails otherwise) or gives another code; why_new=Cycle 0065 (_document refused before any chunk read); seam=sourcePath moves the stop into src/pages; no_claim=none
test('a Pages stop in _document is refused as server-only before any chunk is read', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    sourcePath: 'src/pages/_document.tsx',
    nextPages: { chunks: false },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_SERVER_ONLY_STOP')
  assert.match(failure.message, /it is in the Pages _document file/)
  assert.equal(harness.pagesSeals.length, 0)
})

// Value: protects=a stop in a Pages API route is refused as server-only before any chunk is read; fails_when=the run reads the build first or gives another code; why_new=Cycle 0065 (pages/api refused before any chunk read); seam=sourcePath moves the stop into src/pages/api; no_claim=none
test('a Pages stop in an API route is refused as server-only before any chunk is read', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    sourcePath: 'src/pages/api/hello.ts',
    nextPages: { chunks: false },
  })
  // Act
  const failure = await preparationFailure(harness)
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.equal(failure.code, 'NEXT_SERVER_ONLY_STOP')
  assert.match(failure.message, /it is in an API route/)
  assert.equal(harness.pagesSeals.length, 0)
})

// --- Fast Refresh ---

// Value: protects=a Fast Refresh of a sealed module during a Pages run ends it with SOURCE_CHANGED, its static recovery reaching the agent through the run resource; fails_when=the run resource shows RUNTIME_FAILED or the App text; why_new=Cycle 0065 mid-run module replacement through lane B's registry; seam=announceSealedModule re-announces the module under a new script id; no_claim=a real Fast Refresh
test('a Fast Refresh of the sealed module during a Pages run reaches the run resource as SOURCE_CHANGED with its recovery', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {},
  })
  const { service, receipt } = await startThroughService(context, harness)
  // Act
  harness.announceSealedModule('refreshed')
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the source change',
  )
  const resource = await readResource(service, receipt.runUri)
  // Assert
  assert.ok('text' in resource)
  const error = JSON.parse(resource.text).error
  assert.deepEqual(
    { code: error.code, message: error.message, recovery: error.recovery },
    {
      code: 'SOURCE_CHANGED',
      message:
        'src/theme.ts changed during the run, so Codebook stopped it. Earlier captured observations remain readable.',
      recovery: ERROR_RECOVERY.SOURCE_CHANGED,
    },
  )
})

// Value: protects=a hot-update chunk the page parses during a Pages run is never taken for the sealed module; fails_when=its parse fails the run; why_new=Cycle 0065 (*.hot-update.js never binds as a sealed module); seam=announceScript; no_claim=none
test('a hot-update chunk parsed during a Pages run leaves the run ready', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {},
  })
  await harness.run.prepare()
  // Act
  harness.announceScript(
    'hot',
    'http://localhost:4321/_next/static/webpack/pages/index.0a1b2c.hot-update.js',
  )
  // Assert
  assert.deepEqual([...harness.run.view().failures], [])
  assert.equal(harness.run.view().status, 'ready')
})

// --- Cleanup ---

// Value: protects=every Pages refusal before input releases the owned server and the browser, and only the checks after the load ever opened a browser; fails_when=a refusal leaves the server or the browser running, or a refusal before the seal ended opens a browser; why_new=Cycle 0065 cleanup table (refusals are thrown before input so the existing cleanup runs); seam=the harness's release records; no_claim=a real process group exit (configuredApplication tests)
test('every Pages refusal before input releases the owned server and the browser, and only checks after the load opened one', async (context) => {
  // Arrange
  const cases = [
    {
      name: 'setting',
      options: {
        nextPages: {
          manifests: {
            ...UNRESOLVED_WITH_PAGES,
            settings: { i18n: true as const },
          },
        },
      },
      browserOpened: false,
    },
    {
      name: 'redirect',
      options: {
        nextPages: {
          entry: { status: 307, location: '/login' },
          manifests: UNRESOLVED_WITH_PAGES,
        },
      },
      browserOpened: false,
    },
    {
      name: 'not found',
      options: { nextPages: { manifests: UNRESOLVED_WITH_PAGES } },
      browserOpened: false,
    },
    {
      name: 'server-only file',
      options: {
        sourcePath: 'src/pages/api/hello.ts',
        nextPages: { chunks: false },
      },
      browserOpened: false,
    },
    {
      name: 'final path',
      options: {
        nextPages: {
          pageStates: [
            {
              pathname: '/login',
              routerSeen: true,
              isReady: true,
              route: '/login',
            },
          ],
        },
      },
      browserOpened: true,
    },
    {
      name: 'route mismatch',
      options: {
        nextPages: {
          pageStates: [
            {
              pathname: '/',
              routerSeen: true,
              isReady: true,
              route: '/[slug]',
            },
          ],
        },
      },
      browserOpened: true,
    },
  ]
  const released: {
    name: string
    browserOpened: boolean
    application: boolean
    browser: boolean
    resourcesReleased: boolean
  }[] = []
  // Act
  for (const { name, options } of cases) {
    const harness = await configuredRuntimeHarness(
      context,
      undefined,
      NO_STOPS,
      options,
    )
    await preparationFailure(harness)
    await harness.run.stop()
    released.push({
      name,
      browserOpened: harness.launchConfigurations.length > 0,
      application: harness.releases.includes('application'),
      browser: harness.releases.includes('browser'),
      resourcesReleased: harness.run.view().resourcesReleased,
    })
  }
  // Assert
  assert.deepEqual(
    released,
    cases.map(({ name, browserOpened }) => ({
      name,
      browserOpened,
      application: true,
      browser: true,
      resourcesReleased: true,
    })),
  )
})

// --- Secrets ---

// Value: protects=a seeded SECRET in a redirect target, in the dev server's output (Set-Cookie, Authorization) and in a routes-manifest redirect source reaches neither the agent's error (message, cause, recovery), the run resource nor the run's journal; fails_when=SECRET appears in any of them; why_new=Cycle 0065 secrets requirement (Issue 166); seam=scripted entry answer and output tail, real routes-manifest reading for the redirect source; no_claim=a real dev server's output (nextEntryReadiness tests cover the launcher's mask)
test('a seeded SECRET in a redirect, the server output or a routes-manifest redirect source reaches no error, run resource or journal', async (context) => {
  // Arrange
  const cases = [
    {
      code: 'NEXT_ENTRY_REDIRECTED',
      nextPages: {
        entryPath: '/dashboard',
        // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every message.
        entry: { status: 307, location: '/login?token=SECRET#frag' },
        manifests: UNRESOLVED_WITH_PAGES,
      },
    },
    {
      code: 'NEXT_ROUTE_NOT_COMPILED',
      nextPages: {
        manifests: {
          settings: {},
          kind: 'unresolved' as const,
          manifests: { pages: false, app: false },
        },
        outputTail:
          'Set-Cookie: s=SECRET; Path=/\nAuthorization: Bearer SECRET\n',
      },
    },
    {
      code: 'NEXT_UNSUPPORTED_SETTING',
      nextPages: {
        routesManifest: {
          basePath: '/docs',
          redirects: [
            { source: '/old/SECRET', destination: '/', permanent: false },
          ],
        },
      },
    },
  ]
  const outcomes: { code: string; secretSeen: boolean }[] = []
  // Act
  for (const { nextPages } of cases) {
    const harness = await configuredRuntimeHarness(
      context,
      undefined,
      NO_STOPS,
      { nextPages },
    )
    const { service, receipt, record } = await startThroughService(
      context,
      harness,
    )
    const resource = await readResource(service, receipt.runUri)
    assert.ok('text' in resource)
    const visible = [
      JSON.stringify(record.error?.describe()),
      resource.text,
      JSON.stringify(harness.run.view().events),
    ].join('\n')
    outcomes.push({
      code: record.error?.code ?? 'none',
      secretSeen: visible.includes('SECRET'),
    })
  }
  // Assert
  assert.deepEqual(
    outcomes,
    cases.map(({ code }) => ({ code, secretSeen: false })),
  )
})

// --- Run resource ---

// Value: protects=the run resource of a Pages run names the router, the resolved route and the page's source; fails_when=nextRoute is missing or differs; why_new=Cycle 0065 run resource field; seam=the service over a harness run; no_claim=an App run's resource (viteVersionIdentity tests keep it unchanged)
test('the run resource of a Pages run shows the resolved Pages route and its source', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {},
  })
  // Act
  const { service, receipt } = await startThroughService(context, harness)
  const resource = await readResource(service, receipt.runUri)
  // Assert
  assert.ok('text' in resource)
  assert.deepEqual(JSON.parse(resource.text).nextRoute, {
    router: 'pages',
    route: '/',
    source: 'src/pages/index.tsx',
  })
})
