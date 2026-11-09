import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { test } from 'node:test'

import type * as ConfiguredBrowserRunModule from '../configuredBrowserRun'
import { StudyError } from '../errors'
import type * as OwnedRepositoryBreakpointModule from '../ownedRepositoryBreakpoint'
import { CdnImportRedirect } from '../utils/cdnImportRedirect'
import { refusalFailureOf } from '../utils/refusalFailureOf'

import { FakePageSession } from './utils/fakePageSession'
import { loadModule } from './utils/loadModule'
import { createPackedLibrary } from './utils/packedLibraryFixture'
import { createStaticPageRepository } from './utils/staticPageFixture'

/** Loads the run class with an editor stand-in and builds a bare run whose own fields a test sets. */
async function bareRun(
  fields: Record<string, unknown>,
  globals: Record<string, unknown> = {},
) {
  const vscode = {}
  const breakpointModule = await loadModule<
    typeof OwnedRepositoryBreakpointModule
  >(resolve(__dirname, '../ownedRepositoryBreakpoint.js'), { vscode })
  const { ConfiguredBrowserRun } = await loadModule<
    typeof ConfiguredBrowserRunModule
  >(
    resolve(__dirname, '../configuredBrowserRun.js'),
    {
      vscode,
      './ownedRepositoryBreakpoint': breakpointModule,
      './runtimeSupport/hostBrowser': { HostBrowser: class {} },
    },
    globals,
  )
  const run = Object.create(ConfiguredBrowserRun.prototype) as Record<
    string,
    (...values: unknown[]) => unknown
  >
  Object.assign(run, fields)
  return run
}

/** A version 3 static-page configuration with one browser stop. */
function configurationOf(
  path: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 3,
    adapter: 'static-page',
    packageRoot: 'examples/page',
    book: { anchorIndex: 0 },
    source: { path, hash: 'a'.repeat(64), line: 1, column: 1 },
    participant: 'browser',
    afterOperation: 0,
    ...extra,
  }
}

// Value: protects=AC 4 the run enables the redirect on its page session and a request for a path the packed build lacks fails the run with the coded text the service restores as REPOSITORY_BROWSER_LIBRARY_REFUSED library-path-absent, naming the path, library and page; fails_when=the run does not fail, the text is not restorable or loses the path; no_claim=how the failed run reaches the chat (service tests)
test('a request for an absent library path fails the run with a restorable library-path-absent text', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const library = await createPackedLibrary(context)
  const failures: string[] = []
  const session = new FakePageSession()
  const run = await bareRun({
    staticPageLibraryRoute: {
      packedLibrary: () => ({
        packageName: 'lib',
        libraryRoot: library.libraryRoot,
        packedRoot: library.packedRoot,
      }),
    },
    staticPagePackedFiles: library.files,
    staticPagePackage: await repository.resolvePage(),
    evidence: { record: () => undefined },
    fail: (text: string) => failures.push(text),
  })
  // Act
  await run.enableCdnImportRedirect!(session.cdp)
  session.pause('https://unpkg.com/lib@latest/dist/missing.mjs', 'r1')
  await session.until((commands) =>
    commands.some((command) => command.method === 'Fetch.failRequest'),
  )
  const restored = refusalFailureOf(failures[0] ?? '')
  // Assert
  assert.equal(failures.length, 1)
  assert.equal(restored?.code, 'REPOSITORY_BROWSER_LIBRARY_REFUSED')
  assert.deepEqual(restored?.libraryDetails, {
    reason: 'library-path-absent',
    cause: 'absent',
    path: 'dist/missing.mjs',
    library: 'lib',
    packageRoot: 'examples/page',
    sideEffects: 'partial',
  })
  assert.match(
    restored?.recoveryOverride ?? '',
    /REPOSITORY_BROWSER_LIBRARY_REFUSED\.$/,
  )
})

// Value: protects=AC 4 a run without a declared library installs no interception: the page session sees no command; fails_when=Fetch is enabled for a run that declares no library; no_claim=the note that the page loads a published copy (journal)
test('a run without a declared library sends nothing to the page session', async () => {
  // Arrange
  const session = new FakePageSession()
  const run = await bareRun({})
  // Act
  await run.enableCdnImportRedirect!(session.cdp)
  // Assert
  assert.deepEqual(session.commands, [])
})

// Value: protects=AC 4 the cleanup ends the interception before it closes the page: finalizeLibrary sends Fetch.disable first; fails_when=Fetch stays enabled when the run ends, fails or is cancelled; no_claim=the library route's own finalization (route tests)
test('the library finalization disables the interception before anything else', async (context) => {
  // Arrange
  const library = await createPackedLibrary(context)
  const session = new FakePageSession()
  const redirect = new CdnImportRedirect({
    cdp: session.cdp,
    packageName: 'lib',
    files: library.files,
    record: () => undefined,
    onPathAbsent: () => undefined,
  })
  await redirect.enable()
  const run = await bareRun({ cdnImportRedirect: redirect })
  // Act
  const failures = await run.finalizeLibrary!()
  // Assert
  assert.equal(JSON.stringify(failures), '[]')
  assert.deepEqual(
    session.commands.map((command) => command.method),
    ['JsDebug.subscribe', 'Fetch.enable', 'Fetch.disable'],
  )
})

// Value: protects=AC 4 the library stop request is built for a stop in the declared library folder outside the page and for no other stop: the page's own stops keep the page seal; fails_when=a page stop takes the library seal or a library stop does not; no_claim=the seal itself (adapter tests)
test('only a stop in the declared library outside the page takes the library seal', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const library = await createPackedLibrary(context)
  const run = await bareRun({
    definition: {
      configuration: configurationOf('src/a.ts', {
        library: { packageRoot: 'packages/lib' },
      }),
    },
    options: { workspace: repository.root },
    staticPageLibraryRoute: {
      packedLibrary: () => ({
        packageName: 'lib',
        libraryRoot: library.libraryRoot,
        packedRoot: library.packedRoot,
      }),
    },
    staticPagePackedFiles: library.files,
    staticPagePackage: await repository.resolvePage(),
  })
  // Act
  const libraryStop = run.staticPageLibraryStopRequest!({
    participant: 'browser',
    source: { path: 'packages/lib/src/a.ts' },
  }) as { staticPageLibraryStop?: Record<string, unknown> }
  const pageStop = run.staticPageLibraryStopRequest!({
    participant: 'browser',
    source: { path: repository.htmlPath },
  })
  const otherStop = run.staticPageLibraryStopRequest!({
    participant: 'browser',
    source: { path: 'examples/other/a.js' },
  })
  // Assert
  assert.equal(libraryStop.staticPageLibraryStop?.packageName, 'lib')
  assert.equal(
    libraryStop.staticPageLibraryStop?.libraryRootRelative,
    'packages/lib',
  )
  assert.equal(
    libraryStop.staticPageLibraryStop?.examplePackageRoot,
    'examples/page',
  )
  assert.equal(JSON.stringify(pageStop), '{}')
  assert.equal(JSON.stringify(otherStop), '{}')
})

// Value: protects=AC 3 the run refuses a stop outside the page folder before any server starts, and lets a stop in the declared library folder through to the library seal; fails_when=an outside stop passes, or a library stop is refused as outside; no_claim=the seal that follows
test('the page resolution refuses a stop outside the page and lets a declared library stop through', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const runOf = (path: string, extra: Record<string, unknown> = {}) =>
    bareRun({
      definition: { configuration: configurationOf(path, extra) },
      options: { workspace: repository.root },
    })
  const resolutionOf = async (
    path: string,
    extra?: Record<string, unknown>,
  ) => {
    try {
      await (
        await runOf(path, extra)
      ).resolveStaticPagePackageOfRun!()
      return 'resolved'
    } catch (error) {
      return error instanceof StudyError ? error.details?.reason : 'other'
    }
  }
  // Act
  const results = [
    await resolutionOf('packages/lib/src/a.ts', {
      library: { packageRoot: 'packages/lib' },
    }),
    await resolutionOf('packages/lib/src/a.ts'),
    await resolutionOf(repository.htmlPath),
    await resolutionOf(`${repository.pageRoot}/node_modules/x/index.js`),
  ]
  // Assert
  assert.deepEqual(results, [
    'resolved',
    'outside-package',
    'resolved',
    'node-modules',
  ])
})

// Value: protects=the published-copy note names the CDN address of the page the server answered, not of a file read from disk, so the note describes the bytes served; fails_when=the note is empty or names an address only the disk file holds; no_claim=the learner-facing wording of the note
test('the published-copy note names the CDN address of the served page', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end(
      '<script type="module" src="https://unpkg.com/lib@1/dist/served.js"></script>',
    )
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  context.after(() => server.close())
  const { port } = server.address() as AddressInfo
  const recorded: Array<{ type: string; detail: unknown }> = []
  const run = await bareRun(
    {
      staticPageLibraryFolder: () => undefined,
      staticPagePackage: await repository.resolvePage(),
      definition: { configuration: { entryPath: '/' } },
      abort: new AbortController(),
      evidence: {
        record: (type: string, detail: unknown) =>
          recorded.push({ type, detail }),
      },
    },
    { fetch },
  )
  // Act
  await run.noteCdnImports!(`http://127.0.0.1:${port}`)
  // Assert
  // The run is loaded in its own realm, so the records are compared as JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(recorded)), [
    {
      type: 'static-page.published-copy',
      detail: {
        note: 'The page loaded a published copy from a CDN, not the checked-out library: https://unpkg.com/lib@1/dist/served.js',
        url: 'https://unpkg.com/lib@1/dist/served.js',
      },
    },
  ])
})

// Value: protects=the published-copy note also names a CDN address that only a same-origin script of the page holds; fails_when=the note is missing because only the entry page is scanned; no_claim=the wording of the note
test('the published-copy note names the CDN address found in a same-origin script', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context, {
    'main.js': 'import "https://unpkg.com/lib@1/dist/from-script.js"\n',
  })
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end('<script type="module" src="main.js"></script>')
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  context.after(() => server.close())
  const { port } = server.address() as AddressInfo
  const recorded: Array<{ type: string; detail: unknown }> = []
  const run = await bareRun(
    {
      staticPageLibraryFolder: () => undefined,
      staticPagePackage: await repository.resolvePage(),
      definition: { configuration: { entryPath: '/' } },
      abort: new AbortController(),
      evidence: {
        record: (type: string, detail: unknown) =>
          recorded.push({ type, detail }),
      },
    },
    { fetch },
  )
  // Act
  await run.noteCdnImports!(`http://127.0.0.1:${port}`)
  // Assert
  assert.deepEqual(
    JSON.parse(JSON.stringify(recorded)).map(
      (entry: { detail: { url: string } }) => entry.detail.url,
    ),
    ['https://unpkg.com/lib@1/dist/from-script.js'],
  )
})

// Value: protects=the published-copy note never holds more than the page limit of a served answer; fails_when=an oversized served page is read whole and still yields a note; no_claim=the limit value
test('an oversized served page gives no published-copy note', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end(
      '<script src="https://unpkg.com/lib@1/dist/big.js"></script>' +
        ' '.repeat(2 * 1024 * 1024),
    )
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  context.after(() => server.close())
  const { port } = server.address() as AddressInfo
  const recorded: unknown[] = []
  const run = await bareRun(
    {
      staticPageLibraryFolder: () => undefined,
      staticPagePackage: await repository.resolvePage(),
      definition: { configuration: { entryPath: '/' } },
      abort: new AbortController(),
      evidence: { record: (...values: unknown[]) => recorded.push(values) },
    },
    { fetch },
  )
  // Act
  await run.noteCdnImports!(`http://127.0.0.1:${port}`)
  // Assert
  assert.deepEqual(recorded, [])
})
