import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { CdnImportRedirect } from '../utils/cdnImportRedirect'
import { createBundleVerifier } from '../utils/createBundleVerifier'
import { findCdnPackageImports } from '../utils/findCdnPackageImports'
import { matchCdnPackageUrl } from '../utils/matchCdnPackageUrl'
import { SingleBundleCache } from '../utils/readSingleServedBundle'
import { sealStaticPageLibraryStop } from '../utils/sealStaticPageLibraryStop'

import { FakePageSession } from './utils/fakePageSession'
import {
  createPackedLibrary,
  LIBRARY_BUILD,
  LIBRARY_MAP,
  LIBRARY_SOURCE,
  type PackedLibraryFixture,
} from './utils/packedLibraryFixture'

/** Starts a redirect for a package on a fake page session and returns what a test observes. */
async function startRedirect(
  library: PackedLibraryFixture,
  packageName = 'lib',
) {
  const session = new FakePageSession()
  const absent: string[] = []
  const redirect = new CdnImportRedirect({
    cdp: session.cdp,
    packageName,
    files: library.files,
    record: () => undefined,
    onPathAbsent: (path) => absent.push(path),
  })
  await redirect.enable()
  return { session, redirect, absent }
}

/** Reads the one fulfillment a session received: its headers by name and its body text. */
function fulfillmentOf(session: FakePageSession) {
  const command = session.commands.find(
    (candidate) => candidate.method === 'Fetch.fulfillRequest',
  )
  const params = command?.params as {
    requestId: string
    responseCode: number
    responseHeaders: { name: string; value: string }[]
    body: string
  }
  return {
    requestId: params.requestId,
    status: params.responseCode,
    headers: Object.fromEntries(
      params.responseHeaders.map((header) => [header.name, header.value]),
    ),
    body: Buffer.from(params.body, 'base64').toString('utf8'),
  }
}

/** Decodes the inline map a served script ends with. */
function inlineMapOf(body: string): { sources: string[]; mappings: string } {
  const match =
    /sourceMappingURL=data:application\/json;base64,([^\s]+)\s*$/.exec(body)
  return JSON.parse(Buffer.from(match![1]!, 'base64').toString('utf8'))
}

// Value: protects=AC 4 a paused unpkg request for the declared package (a query on it, any version) is fulfilled with the packed build's bytes, its map inlined with the sources named by the checked-out file, JavaScript content type and open CORS; fails_when=the published copy is served, the map stays a reference, or the source keeps the packed path; no_claim=that js-debug binds a breakpoint in the served script (native check)
test('an unpkg request for the declared package is fulfilled with the packed build and its map inlined', async (context) => {
  // Arrange
  const library = await createPackedLibrary(context)
  const { session } = await startRedirect(library)
  // Act
  session.pause('https://unpkg.com/lib@latest/dist/lib.mjs?x=1#frag', 'r1')
  await session.until((commands) =>
    commands.some((command) => command.method === 'Fetch.fulfillRequest'),
  )
  const served = fulfillmentOf(session)
  // Assert
  assert.equal(served.requestId, 'r1')
  assert.equal(served.status, 200)
  assert.equal(served.headers['Content-Type'], 'text/javascript; charset=utf-8')
  assert.equal(served.headers['Access-Control-Allow-Origin'], '*')
  assert.equal(
    served.body.startsWith(
      'export const a = 1\nexport const double = (x) => x * 2\n//# sourceMappingURL=data:application/json;base64,',
    ),
    true,
  )
  const map = inlineMapOf(served.body)
  assert.deepEqual(map.sources, [join(library.libraryRoot, 'src', 'a.ts')])
  assert.equal(map.mappings, 'AAAA;AACA')
})

// Value: protects=AC 4 a jsDelivr request for a scoped package name is matched literally and fulfilled, and the page's session is subscribed to the event before Fetch is enabled with a pattern for each CDN form; fails_when=a scoped name is not matched, Fetch.enable comes before JsDebug.subscribe, or a pattern is missing; no_claim=how js-debug forwards the event (native check)
test('a jsDelivr request for a scoped package is fulfilled, and the subscription precedes Fetch.enable with both patterns', async (context) => {
  // Arrange
  const library = await createPackedLibrary(context)
  const { session } = await startRedirect(library, '@scope/lib')
  // Act
  session.pause(
    'https://cdn.jsdelivr.net/npm/@scope/lib@1.2.3/dist/lib.mjs',
    'r2',
  )
  await session.until((commands) =>
    commands.some((command) => command.method === 'Fetch.fulfillRequest'),
  )
  // Assert
  assert.deepEqual(
    session.commands.map((command) => command.method),
    ['JsDebug.subscribe', 'Fetch.enable', 'Fetch.fulfillRequest'],
  )
  assert.deepEqual(session.commands[0]?.params, {
    events: ['Fetch.requestPaused'],
  })
  assert.deepEqual(session.commands[1]?.params, {
    patterns: [
      { urlPattern: 'https://unpkg.com/@scope/lib@*', requestStage: 'Request' },
      {
        urlPattern: 'https://cdn.jsdelivr.net/npm/@scope/lib@*',
        requestStage: 'Request',
      },
    ],
  })
  assert.equal(fulfillmentOf(session).requestId, 'r2')
})

// Value: protects=AC 4 a request for the build's map is answered with the packed copy's map unchanged as JSON; fails_when=the map is rewritten, or served as JavaScript; no_claim=the inlined copy a script carries
test('a request for the packed map is fulfilled unchanged as JSON', async (context) => {
  // Arrange
  const library = await createPackedLibrary(context)
  const { session } = await startRedirect(library)
  // Act
  session.pause('https://unpkg.com/lib@1/dist/lib.mjs.map', 'r3')
  await session.until((commands) =>
    commands.some((command) => command.method === 'Fetch.fulfillRequest'),
  )
  const served = fulfillmentOf(session)
  // Assert
  assert.equal(served.body, LIBRARY_MAP)
  assert.equal(
    served.headers['Content-Type'],
    'application/json; charset=utf-8',
  )
})

// Value: protects=AC 4 a matching request for a path the packed build lacks, or one that climbs out of the packed folder, ends the run with the absent path reported and the request failed, never falling through to the published copy; fails_when=such a request is continued, fulfilled from outside the packed folder, or not reported; no_claim=the refusal text (restored by the run)
test('a request for an absent path or one leaving the packed folder is reported and failed, not continued', async (context) => {
  // Arrange
  const library = await createPackedLibrary(context)
  const { session, absent } = await startRedirect(library)
  const failedRequestCount = (
    commands: ReadonlyArray<{ method: string }>,
  ): number =>
    commands.filter((command) => command.method === 'Fetch.failRequest').length
  // Act
  // Each request is answered before the next is paused: the two absence checks read the file system, so concurrent requests could report in either order.
  session.pause('https://unpkg.com/lib@1/dist/missing.mjs', 'r4')
  await session.until((commands) => failedRequestCount(commands) === 1)
  session.pause(
    'https://unpkg.com/lib@1/..%2f..%2f..%2fchecked-out%2fsrc%2fa.ts',
    'r5',
  )
  await session.until((commands) => failedRequestCount(commands) === 2)
  // Assert
  assert.deepEqual(absent, [
    'dist/missing.mjs',
    '../../../checked-out/src/a.ts',
  ])
  assert.deepEqual(
    session.commands
      .filter((command) => command.method === 'Fetch.failRequest')
      .map((command) => command.params),
    [
      { requestId: 'r4', errorReason: 'BlockedByClient' },
      { requestId: 'r5', errorReason: 'BlockedByClient' },
    ],
  )
  assert.equal(
    session.commands.some(
      (command) => command.method === 'Fetch.continueRequest',
    ),
    false,
  )
})

// Value: protects=AC 4 a remote request that is not a file of the declared package (another package, no version, another host, a POST) continues unchanged; fails_when=another package or host is intercepted or fulfilled; no_claim=requests the patterns never pause
test('requests that are not files of the declared package continue unchanged', async (context) => {
  // Arrange
  const library = await createPackedLibrary(context)
  const { session } = await startRedirect(library)
  const urls = [
    'https://unpkg.com/other@1/dist/lib.mjs',
    'https://unpkg.com/lib/dist/lib.mjs',
    'https://cdn.example.test/lib@1/dist/lib.mjs',
    'https://unpkg.com/lib@1/',
  ]
  // Act
  for (const [index, url] of urls.entries()) session.pause(url, `c${index}`)
  session.pause('https://unpkg.com/lib@1/dist/lib.mjs', 'post', 'POST')
  await session.until(
    (commands) =>
      commands.filter((command) => command.method === 'Fetch.continueRequest')
        .length === 5,
  )
  // Assert
  assert.deepEqual(
    session.commands
      .filter((command) => command.method === 'Fetch.continueRequest')
      .map((command) => command.params),
    [
      { requestId: 'c0' },
      { requestId: 'c1' },
      { requestId: 'c2' },
      { requestId: 'c3' },
      { requestId: 'post' },
    ],
  )
  assert.equal(
    session.commands.some(
      (command) => command.method === 'Fetch.fulfillRequest',
    ),
    false,
  )
})

// Value: protects=AC 4 Fetch.disable is sent when the run ends and again-safe, also after a request failed the run, and a request paused after the disable is let through unchanged so it never hangs; fails_when=interception stays on, a second disable sends again, or a late event is answered with anything but a continue; no_claim=a page session that already closed (the disable then fails quietly)
test('Fetch.disable is sent once when the run ends, also after a failed request, and a late event is only continued', async (context) => {
  // Arrange
  const library = await createPackedLibrary(context)
  const { session, redirect } = await startRedirect(library)
  session.pause('https://unpkg.com/lib@1/dist/missing.mjs', 'r6')
  await session.until((commands) =>
    commands.some((command) => command.method === 'Fetch.failRequest'),
  )
  // Act
  await redirect.disable()
  await redirect.disable()
  session.pause('https://unpkg.com/lib@1/dist/lib.mjs', 'late')
  await session.until((commands) =>
    commands.some((command) => command.method === 'Fetch.continueRequest'),
  )
  // Assert
  assert.deepEqual(
    session.commands.map((command) => command.method),
    [
      'JsDebug.subscribe',
      'Fetch.enable',
      'Fetch.failRequest',
      'Fetch.disable',
      'Fetch.continueRequest',
    ],
  )
})

// Value: protects=AC 4 a request paused in the gap after disable() began (or when Fetch.disable throws) is continued, not left paused; fails_when=answer returns without answering once disabled; no_claim=that the browser then loads the published copy (native check)
test('a request paused after disable() gets Fetch.continueRequest with its own request id', async (context) => {
  // Arrange
  const library = await createPackedLibrary(context)
  const { session, redirect } = await startRedirect(library)
  await redirect.disable()
  // Act
  session.pause('https://example.test/other.js', 'gap-1')
  await session.until((commands) =>
    commands.some((command) => command.method === 'Fetch.continueRequest'),
  )
  // Assert
  const continued = session.commands.find(
    (command) => command.method === 'Fetch.continueRequest',
  )
  assert.deepEqual(continued?.params, { requestId: 'gap-1' })
})

// Value: protects=AC 4 a page session that is gone when the run ends does not make the disable throw; fails_when=disable rejects on a closed session, which would skip the rest of the cleanup; no_claim=that interception ended (the page is gone)
test('disabling on a closed page session does not throw', async (context) => {
  // Arrange
  const library = await createPackedLibrary(context)
  const { session, redirect } = await startRedirect(library)
  session.close()
  // Act
  const outcome = await redirect.disable().then(
    () => 'resolved',
    () => 'rejected',
  )
  // Assert
  assert.equal(outcome, 'resolved')
})

// Value: protects=AC 4 the URL rule: unpkg and jsDelivr forms, a scoped name literal, query and fragment dropped, any non-empty version, a non-empty path; fails_when=a form matches that the decision does not allow or one it allows does not; no_claim=redirects (never followed, the rule matches the requested URL)
test('the CDN URL rule matches the two forms of the declared package only', () => {
  // Arrange
  const cases: [string, string, unknown][] = [
    [
      'https://unpkg.com/lib@1.0.0/a.js',
      'lib',
      { version: '1.0.0', path: 'a.js' },
    ],
    [
      'https://unpkg.com/@s/lib@next/dist/a.mjs?q=1',
      '@s/lib',
      { version: 'next', path: 'dist/a.mjs' },
    ],
    [
      'https://cdn.jsdelivr.net/npm/lib@1/a.js',
      'lib',
      { version: '1', path: 'a.js' },
    ],
    ['https://cdn.jsdelivr.net/lib@1/a.js', 'lib', undefined],
    ['https://unpkg.com/lib@/a.js', 'lib', undefined],
    ['https://unpkg.com/lib@1', 'lib', undefined],
    ['http://unpkg.com/lib@1/a.js', 'lib', undefined],
    ['https://unpkg.com/library@1/a.js', 'lib', undefined],
  ]
  // Act
  const results = cases.map(([url, name]) => matchCdnPackageUrl(url, name))
  // Assert
  assert.deepEqual(
    results,
    cases.map(([, , expected]) => expected),
  )
})

/** Builds the library seal request of a stop in `src/a.ts` for a fixture. */
function libraryStopRequest(
  library: PackedLibraryFixture,
  text = LIBRARY_SOURCE,
) {
  return {
    request: {
      appRoot: library.libraryRoot,
      packageRootRelative: '.',
      packageRelativePath: 'src/a.ts',
      source: { path: 'src/a.ts', hash: sha256(text), line: 2, column: 1 },
      citationEndLine: 2,
      ownedOrigin: 'http://127.0.0.1:4310',
      signal: new AbortController().signal,
      cache: new SingleBundleCache(),
    },
    library: {
      packageName: 'lib',
      examplePackageRoot: 'examples/page',
      packedRoot: library.packedRoot,
      files: library.files,
      imports: findCdnPackageImports(
        '<script type="module">import {a} from "https://unpkg.com/lib@latest/dist/lib.mjs"</script>',
        'lib',
      ),
    },
  }
}

// Value: protects=AC 4 a stop in the library's checked-out src/ is sealed against the very text the redirect serves: the bundle is the served script, its map names the checked-out file, and a pause position maps to the declared line; fails_when=the sealed text differs from the served one, the source keeps the packed path, or the line does not map; no_claim=that js-debug binds the stop (native check)
test('a stop in the checked-out library source is sealed against the served build and its inline map', async (context) => {
  // Arrange
  const library = await createPackedLibrary(context)
  const { request, library: input } = libraryStopRequest(library)
  const { session } = await startRedirect(library)
  session.pause('https://unpkg.com/lib@latest/dist/lib.mjs', 'seal')
  await session.until((commands) =>
    commands.some((command) => command.method === 'Fetch.fulfillRequest'),
  )
  const served = fulfillmentOf(session).body
  // Act
  const { bundle } = await sealStaticPageLibraryStop(request, input)
  const verifier = createBundleVerifier(bundle)
  // Assert
  assert.equal(bundle.javascript, served)
  assert.equal(bundle.scriptUrl, 'https://unpkg.com/lib@latest/dist/lib.mjs')
  assert.equal(bundle.sourcePath, join(library.libraryRoot, 'src', 'a.ts'))
  assert.equal(bundle.source, LIBRARY_SOURCE)
  assert.equal(verifier.originalLine({ lineNumber: 1, columnNumber: 0 }), 2)
})

// Value: protects=AC 4 a library file edited after the build is refused library-build-stale, and a stop in a file no served map names is refused library-not-in-build, both under STATIC_PAGE_SEAL_FAILED; fails_when=an edited or unmapped file is sealed; no_claim=the wording of the recovery
test('an edited library file is refused as stale and an unmapped one as not in the build', async (context) => {
  // Arrange
  const stale = await createPackedLibrary(context, {
    checkedOutSource: `${LIBRARY_SOURCE}// edited\n`,
  })
  const fresh = await createPackedLibrary(context)
  const staleInput = libraryStopRequest(stale, `${LIBRARY_SOURCE}// edited\n`)
  const unmapped = libraryStopRequest(fresh)
  await writeFile(
    join(fresh.libraryRoot, 'src', 'b.ts'),
    'export const b = 1\n',
  )
  unmapped.request.packageRelativePath = 'src/b.ts'
  unmapped.request.source = {
    path: 'src/b.ts',
    hash: sha256('export const b = 1\n'),
    line: 1,
    column: 1,
  }
  // Act
  const outcomes = await Promise.all(
    [staleInput, unmapped].map(({ request, library }) =>
      sealStaticPageLibraryStop(request, library).then(
        () => 'sealed',
        (error: unknown) =>
          error instanceof StudyError
            ? [error.code, error.details?.reason]
            : 'other',
      ),
    ),
  )
  // Assert
  assert.deepEqual(outcomes, [
    ['STATIC_PAGE_SEAL_FAILED', 'library-build-stale'],
    ['STATIC_PAGE_SEAL_FAILED', 'library-not-in-build'],
  ])
})

// Value: protects=AC 4 the packed files are read once and served identically to the redirect and the seal, and a map's source whose packed bytes differ from the checked-out file keeps the packed path (so a stale source is never claimed); fails_when=the redirect and the seal read different bytes, or an unequal source is renamed to the checked-out file; no_claim=the build step that makes the packed copy
test('a map source that differs from the checked-out file keeps the packed path', async (context) => {
  // Arrange
  const library = await createPackedLibrary(context, {
    checkedOutSource: `${LIBRARY_SOURCE}// edited\n`,
  })
  // Act
  const first = await library.files.read('dist/lib.mjs')
  const second = await library.files.read('dist/lib.mjs')
  // Assert
  assert.equal(first, second)
  assert.deepEqual(first?.map?.sources, [
    join(library.packedRoot, 'src', 'a.ts'),
  ])
  assert.equal(first?.text?.endsWith('\n'), false)
  assert.equal(
    (await readFile(join(library.packedRoot, 'dist', 'lib.mjs'), 'utf8')) ===
      LIBRARY_BUILD,
    true,
  )
})
