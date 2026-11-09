import assert from 'node:assert/strict'
import { rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type {
  DevelopmentApp,
  DevelopmentBundleRequest,
  DevelopmentServerStart,
} from '../developmentServerAdapter'
import { StudyError } from '../errors'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { STATIC_PAGE_ADAPTER } from '../staticPageDevAdapter'
import { createBundleVerifier } from '../utils/createBundleVerifier'

import {
  createPackedLibrary,
  LIBRARY_SOURCE,
} from './utils/packedLibraryFixture'
import {
  createStaticPageRepository,
  STATIC_PAGE_HTML,
  stopOf,
  type StaticPageRepository,
} from './utils/staticPageFixture'

/** Builds the start request of a run on a fixture page; `handle.app` receives the started server. */
async function startRequestOf(
  repository: StaticPageRepository,
  entryPath = '/',
) {
  const handle: { app?: DevelopmentApp } = {}
  const steps: string[] = []
  const request: DevelopmentServerStart = {
    workspace: repository.pageFolder,
    staticPagePackage: await repository.resolvePage(),
    entryPath,
    node: process.execPath,
    record: () => undefined,
    inspectServer: false,
    signal: new AbortController().signal,
    alive: () => undefined,
    assertPortFree: async () => undefined,
    onStep: (step) => steps.push(step),
    onDeclaredPort: () => undefined,
    onApp: (app) => {
      handle.app = app
    },
  }
  return { request, handle, steps }
}

/** Starts the adapter and closes the server when the test ends. */
async function startAdapter(
  context: TestContext,
  repository: StaticPageRepository,
) {
  const prepared = await startRequestOf(repository)
  context.after(async () => {
    await prepared.handle.app?.close()
  })
  const started = await STATIC_PAGE_ADAPTER.start(prepared.request)
  return { ...prepared, started }
}

// Value: protects=a journal write that throws after the server started still leaves the run holding the server so it can close it; fails_when=onApp is called after the failing record and the started server is never handed over (it leaks); no_claim=what the journal does with the failure
test('the adapter hands the started server to the run before it journals the acquisition', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const prepared = await startRequestOf(repository)
  context.after(async () => {
    await prepared.handle.app?.close()
  })
  // Only the acquisition write fails; the later close journal write must not.
  let isFirstWrite = true
  prepared.request.record = (): void => {
    if (!isFirstWrite) return
    isFirstWrite = false
    throw new Error('journal write failed')
  }
  // Act
  const outcome = await STATIC_PAGE_ADAPTER.start(prepared.request).then(
    () => 'started',
    () => 'failed',
  )
  // Assert
  assert.equal(outcome, 'failed')
  assert.equal(prepared.handle.app?.isRunning(), true)
})

// Value: protects=AC 2 the adapter starts Codebook's own loopback server on a port the OS picked, reports that port, hands the run a handle that answers the entry page, waits for the page and its scripts, and closes with the run; fails_when=another host or a fixed port is used, the handle does not answer or is not handed over, or the server outlives close; no_claim=a real editor run (native check)
test('the adapter starts a loopback server, reports its port and closes it with the run', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const { started, handle, request } = await startAdapter(context, repository)
  // Act
  const origin = await started.app.ready(request.signal, '/')
  await STATIC_PAGE_ADAPTER.waitForServerSettled(
    started.app,
    5_000,
    request.signal,
  )
  const running = started.app.isRunning()
  await started.app.close()
  const reached = await fetch(`${origin}/`).then(
    () => true,
    () => false,
  )
  // Assert
  assert.equal(origin, `http://127.0.0.1:${started.port}`)
  assert.ok(started.port > 0)
  assert.equal(handle.app, started.app)
  assert.equal(running, true)
  assert.equal(started.app.isRunning(), false)
  assert.equal(reached, false)
})

// Value: protects=AC 1 a page that needs a bundler is refused by name before any server starts, with nothing started; fails_when=a server is started for such a page, or the refusal loses its code, reason or reference; no_claim=the other gaps (readiness tests)
test('the adapter refuses a page that needs a bundler before starting a server', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context, {
    'index.html': '<script type="module" src="/src/main.tsx"></script>',
  })
  const { request, handle } = await startRequestOf(repository)
  // Act
  const refusal = await STATIC_PAGE_ADAPTER.start(request).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'STATIC_PAGE_UNSUPPORTED')
  assert.deepEqual(refusal.details, {
    reason: 'needs-bundler',
    reference: '/src/main.tsx',
    kind: 'missing-file',
    sideEffects: 'none',
  })
  assert.equal(handle.app, undefined)
})

// Value: protects=AC 1 the early workspace check refuses a folder with no entry page and a folder that is another adapter's app with their own reasons; fails_when=either is accepted or both read the same; no_claim=the start order of a run
test('the workspace check refuses a missing entry page and another adapters app by reason', async (context) => {
  // Arrange
  const empty = await createStaticPageRepository(context)
  const viteApp = await createStaticPageRepository(context, {
    'package.json': JSON.stringify({ dependencies: { vite: '8' } }),
  })
  const check = async (
    repository: StaticPageRepository,
    entryPath: string,
  ): Promise<unknown> =>
    STATIC_PAGE_ADAPTER.assertWorkspace(
      repository.pageFolder,
      process.execPath,
      new AbortController().signal,
      undefined,
      undefined,
      undefined,
      undefined,
      await repository.resolvePage(),
      entryPath,
    ).then(
      () => 'accepted',
      (error: unknown) =>
        error instanceof StudyError ? error.details?.reason : 'other',
    )
  // Act
  const results = [
    await check(empty, '/'),
    await check(empty, '/absent.html'),
    await check(viteApp, '/'),
  ]
  // Assert
  assert.deepEqual(results, ['accepted', 'no-entry-page', 'not-a-static-page'])
})

/** Builds the bundle request of a stop for a started page. */
async function bundleRequestOf(
  repository: StaticPageRepository,
  source: DevelopmentBundleRequest['source'],
  origin: string,
  extra: Partial<DevelopmentBundleRequest> = {},
): Promise<DevelopmentBundleRequest> {
  return {
    workspace: repository.root,
    staticPagePackage: await repository.resolvePage(),
    source,
    citationEndLine: source.line,
    signal: new AbortController().signal,
    entryPath: '/',
    execution: 'browser',
    ownedOrigin: origin,
    record: () => undefined,
    ...extra,
  }
}

// Value: protects=AC 3 the adapter seals a stop in the page's inline script through readBundle, and a script announced under localhost at /index.html is that module; fails_when=readBundle refuses the page's own stop, or the module test rejects the browser's spelling; no_claim=js-debug's announcement (native check)
test('the adapter seals a page script stop and recognises the browser spelling of its address', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const { started } = await startAdapter(context, repository)
  const origin = `http://127.0.0.1:${started.port}`
  // Act
  const { bundle } = await STATIC_PAGE_ADAPTER.readBundle(
    await bundleRequestOf(
      repository,
      stopOf(repository.htmlPath, STATIC_PAGE_HTML, 8),
      origin,
    ),
  )
  // Assert
  assert.equal(createBundleVerifier(bundle).hashes.javascript.length, 64)
  assert.equal(
    STATIC_PAGE_ADAPTER.isScriptOfModule(
      bundle.scriptUrl,
      `http://localhost:${started.port}/index.html`,
    ),
    true,
  )
  assert.deepEqual(
    STATIC_PAGE_ADAPTER.browserDebugFields(repository.pageFolder),
    {
      webRoot: repository.pageFolder,
      sourceMaps: true,
    },
  )
})

// Value: protects=AC 4 a stop in the declared library's src/ goes through readBundle's library seal against the served packed build, naming the checked-out file; fails_when=the library stop is refused as outside the page or sealed from the page; no_claim=the redirect that serves the build (cdnImportRedirect tests)
test('the adapter seals a library stop against the packed build the page imports from the CDN', async (context) => {
  // Arrange
  const repository = await createStaticPageRepository(context)
  const library = await createPackedLibrary(context)
  const { started } = await startAdapter(context, repository)
  const origin = `http://127.0.0.1:${started.port}`
  const source = {
    path: 'src/a.ts',
    hash: sha256(LIBRARY_SOURCE),
    line: 2,
    column: 1,
  }
  // Act
  const { bundle } = await STATIC_PAGE_ADAPTER.readBundle(
    await bundleRequestOf(repository, source, origin, {
      staticPageLibraryStop: {
        packageName: 'lib',
        examplePackageRoot: 'examples/page',
        packedRoot: library.packedRoot,
        libraryRoot: library.libraryRoot,
        libraryRootRelative: '.',
        files: library.files,
      },
    }),
  )
  // Assert
  assert.equal(bundle.scriptUrl, 'https://unpkg.com/lib@latest/dist/lib.mjs')
  assert.equal(bundle.source, LIBRARY_SOURCE)
})

// Value: protects=the library-stop branch never reads an entry page that is a link leaving the page folder; fails_when=the linked file's CDN address is found and the stop is sealed; no_claim=the wording of the refusal, or links on Windows without symlink privilege (test skipped there)
test('a library stop does not read an entry page that is a link leaving the folder', async (context) => {
  // Arrange
  if (process.platform === 'win32') {
    context.skip('symlinks need privileges on Windows')
    return
  }
  const repository = await createStaticPageRepository(context)
  const library = await createPackedLibrary(context)
  const { started } = await startAdapter(context, repository)
  const origin = `http://127.0.0.1:${started.port}`
  const outside = join(repository.root, 'outside.html')
  await writeFile(
    outside,
    '<script type="module">import "https://unpkg.com/lib@latest/dist/lib.mjs"</script>',
  )
  await rm(join(repository.pageFolder, 'index.html'))
  await symlink(outside, join(repository.pageFolder, 'index.html'))
  const source = {
    path: 'src/a.ts',
    hash: sha256(LIBRARY_SOURCE),
    line: 2,
    column: 1,
  }
  // Act
  const outcome = await STATIC_PAGE_ADAPTER.readBundle(
    await bundleRequestOf(repository, source, origin, {
      staticPageLibraryStop: {
        packageName: 'lib',
        examplePackageRoot: 'examples/page',
        packedRoot: library.packedRoot,
        libraryRoot: library.libraryRoot,
        libraryRootRelative: '.',
        files: library.files,
      },
    }),
  ).then(
    () => 'sealed',
    () => 'refused',
  )
  // Assert
  assert.equal(outcome, 'refused')
})
