import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { libraryRecoveryOf } from '../nextRefusals'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import { createViteLibraryModuleSource } from '../utils/createViteLibraryModuleSource'
import { refusalFailureOf } from '../utils/refusalFailureOf'
import { sealViteLibraryStop } from '../utils/sealViteLibraryStop'
import {
  viteLibraryBuildChangedFailure,
  viteLibraryFailureText,
  viteLibraryRefusal,
} from '../viteLibraryRefusals'

const TEXT = 'export const a = 1\nexport const b = 2\n'

/** A served module whose inline map names `../../src/a.ts` with the given text. */
function servedModule(sourcesContent: string[] = [TEXT]): string {
  const map = JSON.stringify({
    version: 3,
    sources: ['../../src/a.ts'],
    sourcesContent,
    names: [],
    mappings: 'AAAA;AACA',
  })
  return `export {}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(map).toString('base64')}`
}

/** Stages a repository with a library source and a server that answers the entry page and the library module. */
async function stage(
  context: TestContext,
  options: { moduleText?: string } = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'vite-lib-seal-')))
  await mkdir(join(root, 'packages/core/src'), { recursive: true })
  await mkdir(join(root, 'examples/app'), { recursive: true })
  await writeFile(join(root, 'packages/core/src/a.ts'), TEXT)
  const modulePath = `/@fs${root}/packages/core/build/modern/a.js`
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url ?? '')
    if (request.url === '/') {
      response.setHeader('content-type', 'text/html')
      response.end(
        '<script type="module" src="/@vite/client"></script><script type="module" src="/src/main.tsx"></script>',
      )
      return
    }
    if (request.url?.startsWith(modulePath)) {
      response.setHeader('content-type', 'text/javascript')
      response.end(options.moduleText ?? servedModule())
      return
    }
    response.statusCode = 404
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(async () => {
    server.close()
    await rm(root, { recursive: true, force: true })
  })
  const address = server.address()
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  const walks: { entries: string[]; libraryFolder: string }[] = []
  const library = {
    name: '@scope/core',
    folder: 'packages/core',
    realFolder: join(root, 'packages/core'),
  }
  const moduleSource = createViteLibraryModuleSource({
    ownedOrigin: origin,
    entryPath: '/',
    libraryRealFolder: library.realFolder,
    requestWalk: async (entries, libraryFolder) => {
      walks.push({ entries, libraryFolder })
      return { modules: [`${modulePath}?v=abc`], optimizedLibrary: false }
    },
    signal: new AbortController().signal,
  })
  return { root, origin, requests, walks, library, moduleSource, modulePath }
}

/** The request of one seal over a staged repository. */
function sealRequest(
  fixture: Awaited<ReturnType<typeof stage>>,
  overrides: { hash?: string } = {},
) {
  return {
    appRoot: join(fixture.root, 'examples/app'),
    packageRootRelative: 'examples/app',
    library: fixture.library,
    repositoryRoot: fixture.root,
    source: {
      path: 'packages/core/src/a.ts',
      line: 1,
      column: 1,
      hash: overrides.hash ?? sha256(TEXT),
    },
    citationEndLine: 2,
    ownedOrigin: fixture.origin,
    moduleSource: fixture.moduleSource,
    signal: new AbortController().signal,
  }
}

// protects=AC 1 seal: the library stop is sealed from the served /@fs/ module (bytes unchanged, sealed address with the library's real file, map entries normalized to absolute originals) after one walk seeded with the entry page's module scripts; fails_when=the bundle names another file or address, the walk is not seeded from the page's module scripts or the served bytes are altered; no_claim=a real Vite server (a stand-in HTTP server answers the entry page and the module)
test('seals a library stop from the served /@fs/ module after one walk seeded with the entry module scripts', async (context) => {
  // Arrange
  const fixture = await stage(context)
  // Act
  const { bundle } = await sealViteLibraryStop(sealRequest(fixture))
  // Assert
  const realFile = join(fixture.root, 'packages/core/src/a.ts')
  assert.deepEqual(fixture.walks, [
    {
      entries: ['/@vite/client', '/src/main.tsx'],
      libraryFolder: join(fixture.root, 'packages/core'),
    },
  ])
  assert.equal(bundle.sourcePath, realFile)
  assert.equal(bundle.scriptUrl, `${fixture.origin}${fixture.modulePath}?v=abc`)
  assert.equal(bundle.javascript, servedModule())
  assert.deepEqual(JSON.parse(bundle.sourceMap).sources, [realFile])
})

// protects=decision D13: two library stops of one page generation share one walk and fetch the module once; fails_when=each stop walks or fetches again; no_claim=reseal per generation (integration test)
test('shares one walk and one module fetch between two seals of the same page generation', async (context) => {
  // Arrange
  const fixture = await stage(context)
  // Act
  await sealViteLibraryStop(sealRequest(fixture))
  await sealViteLibraryStop(sealRequest(fixture))
  // Assert
  assert.equal(fixture.walks.length, 1)
  assert.equal(
    fixture.requests.filter((url) => url.includes('/build/modern/a.js')).length,
    1,
  )
})

// protects=decision table row 8 end to end: a stale served map is refused as VITE_SEAL_FAILED library-build-stale with the library, the repository-relative file, the package root, sideEffects none and the Vite recovery; fails_when=any field is missing or the code is the Next one; no_claim=none beyond protects
test('refuses a stale served map with the library-build-stale fields of a Vite seal failure', async (context) => {
  // Arrange
  const fixture = await stage(context, {
    moduleText: servedModule(['export const a = 0\n']),
  })
  // Act
  const failure = await sealViteLibraryStop(sealRequest(fixture)).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'VITE_SEAL_FAILED')
  assert.deepEqual(failure.details, {
    reason: 'library-build-stale',
    packageRoot: 'examples/app',
    library: '@scope/core',
    file: 'packages/core/src/a.ts',
    sideEffects: 'none',
  })
  assert.equal(
    failure.recoveryOverride,
    libraryRecoveryOf('library-build-stale', 'vite'),
  )
})

// protects=accepted article: a stop file that differs from the accepted hash is a plain error, not a library refusal; fails_when=the changed file is sealed; no_claim=none beyond protects
test('throws when the checked-out stop file differs from the accepted article', async (context) => {
  // Arrange
  const fixture = await stage(context)
  // Act / Assert
  await assert.rejects(
    sealViteLibraryStop(sealRequest(fixture, { hash: sha256('other') })),
    /Selected source differs from the accepted article/,
  )
})

// protects=Cycle 0078 refusal text: the Vite recovery says no browser opened and no page code ran, the Next one says nothing was started; fails_when=the Next sentence is reused under Vite or the Next text changed; no_claim=help wording (Lane C)
test('words the Vite library recovery by what a Vite run had started and keeps the Next text unchanged', () => {
  // Arrange / Act
  const vite = libraryRecoveryOf('library-build-stale', 'vite')
  const next = libraryRecoveryOf('library-build-stale')
  // Assert
  assert.match(vite, /No browser was opened/)
  assert.doesNotMatch(vite, /no server/)
  assert.match(next, /Nothing was started: no server, no browser and no input/)
})

// protects=lazy-import refusal: the refusal carries cause lazy-import, sideEffects unknown (the page's code ran) and survives a run's failure text; fails_when=the cause or the unknown side effects are lost in the text; no_claim=the run's arming (integration test)
test('restores a lazy-import refusal from its failure text with the reason, the cause and unknown side effects', () => {
  // Arrange
  const error = viteLibraryRefusal({
    reason: 'library-build-unmapped',
    cause: 'lazy-import',
    packageRoot: 'examples/app',
    library: '@scope/core',
    file: 'packages/core/src/a.ts',
  })
  // Act
  const text = viteLibraryFailureText(error)
  const restored = text === undefined ? undefined : refusalFailureOf(text)
  // Assert
  assert.equal(restored?.code, 'VITE_SEAL_FAILED')
  assert.deepEqual(restored?.libraryDetails, {
    reason: 'library-build-unmapped',
    cause: 'lazy-import',
    packageRoot: 'examples/app',
    library: '@scope/core',
    file: 'packages/core/src/a.ts',
    sideEffects: 'unknown',
  })
  assert.equal(error.details?.sideEffects, 'unknown')
  assert.equal(
    restored?.recoveryOverride,
    libraryRecoveryOf('library-build-unmapped', 'vite'),
  )
})

// protects=AC 3 failure text: a Vite library build change keeps RUNTIME_FAILED, reason library-build-changed and unknown side effects without a Next router field; fails_when=the Pages router field leaks into a Vite run; no_claim=the run's checks (integration tests)
test('restores a Vite library build change from its failure text without the Pages router field', () => {
  // Arrange
  const error = viteLibraryBuildChangedFailure({
    packageRoot: 'examples/app',
    library: '@scope/core',
    file: 'packages/core/src/a.ts',
  })
  // Act
  const text = viteLibraryFailureText(error)
  const restored = text === undefined ? undefined : refusalFailureOf(text)
  // Assert
  assert.equal(restored?.code, 'RUNTIME_FAILED')
  assert.deepEqual(restored?.libraryDetails, {
    reason: 'library-build-changed',
    packageRoot: 'examples/app',
    library: '@scope/core',
    file: 'packages/core/src/a.ts',
    sideEffects: 'unknown',
  })
})

// protects=a build-changed or lazy-import failure whose file path holds parentheses and a colon still restores its package root, library and file from the text; fails_when=the identity is cut at a parenthesis or lost; no_claim=the run's recording of the text (integration test)
test('restores the package root, library and file of a failure whose names hold parentheses and colons', () => {
  // Arrange
  const identity = {
    packageRoot: 'examples/react/(group)/app',
    library: '@scope/core',
    file: 'packages/core/src/a:(b).ts',
  }
  // Act
  const text = viteLibraryFailureText(viteLibraryBuildChangedFailure(identity))
  const restored = text === undefined ? undefined : refusalFailureOf(text)
  // Assert
  assert.equal(restored?.code, 'RUNTIME_FAILED')
  assert.deepEqual(restored?.libraryDetails, {
    reason: 'library-build-changed',
    ...identity,
    sideEffects: 'unknown',
  })
})

// protects=a not-in-build refusal lists at most five candidates in its message and details; fails_when=all seven are listed; no_claim=the candidate selection
test('lists at most five candidate modules and counts the rest', () => {
  // Arrange
  const candidates = [
    '/1.js',
    '/2.js',
    '/3.js',
    '/4.js',
    '/5.js',
    '/6.js',
    '/7.js',
  ]
  // Act
  const error = viteLibraryRefusal({
    reason: 'library-not-in-build',
    packageRoot: 'examples/app',
    library: '@scope/core',
    file: 'packages/core/src/a.ts',
    candidates,
  })
  // Assert
  assert.deepEqual(error.details?.candidates, candidates.slice(0, 5))
  assert.match(
    error.message,
    /\(\/1\.js, \/2\.js, \/3\.js, \/4\.js, \/5\.js and 2 more\)/,
  )
  assert.doesNotMatch(error.message, /\/6\.js/)
})

// protects=Vite recovery and help say the owned Vite server started and may have written its own dependency cache while Codebook wrote nothing; fails_when=the text says no file was written at all; no_claim=the Next text
test('words the Vite library recovery with the dependency cache the owned server may have written', () => {
  // Arrange / Act
  const recovery = libraryRecoveryOf('library-build-stale', 'vite')
  // Assert
  assert.match(
    recovery,
    /no page or application code ran and Codebook wrote no learner file or build output/,
  )
  assert.match(recovery, /may have written its own dependency cache/)
  assert.doesNotMatch(recovery, /no file was written/)
})

// protects=a library-build-unmapped message tells the learner to rebuild with source maps only for the causes a rebuild fixes (no-map, no-content, malformed); fails_when=a lazy-import, prebundled, no-line, bound or deadline refusal tells the learner to rebuild, or a no-map refusal stops saying it; no_claim=the recovery sentence (shared with the Next path) and the help rows
test('asks for a rebuild with source maps only when a rebuild can fix the unmapped cause', () => {
  // Arrange
  const identity = {
    reason: 'library-build-unmapped' as const,
    packageRoot: 'examples/react/basic',
    library: '@scope/core',
    file: 'packages/core/src/a.ts',
  }
  const rebuildSentence =
    'The library must be built with source maps that include sourcesContent.'

  // Act
  const noMap = viteLibraryRefusal({ ...identity, cause: 'no-map' }).message
  const lazyImport = viteLibraryRefusal({
    ...identity,
    cause: 'lazy-import',
  }).message
  const prebundled = viteLibraryRefusal({
    ...identity,
    cause: 'prebundled',
  }).message
  const deadline = viteLibraryRefusal({
    ...identity,
    cause: 'deadline',
  }).message

  // Assert
  assert.ok(noMap.endsWith(`Codebook never builds. ${rebuildSentence}`))
  assert.ok(!lazyImport.includes(rebuildSentence))
  assert.ok(!prebundled.includes(rebuildSentence))
  assert.ok(!deadline.includes(rebuildSentence))
})

// protects=transient failure: one failed module fetch is not cached, so the next read of that module fetches again; fails_when=the rejection is remembered and every later read refuses without a request; no_claim=real Vite
test('reads a module again after a transient fetch failure instead of refusing every later stop', async (context) => {
  // Arrange
  const fixture = await stage(context)
  const missing = `/@fs${fixture.root}/packages/core/build/missing.js`
  const attempt = () =>
    fixture.moduleSource.read(missing).then(
      () => 'read',
      () => 'failed',
    )
  // Act
  const first = await attempt()
  const second = await attempt()
  // Assert
  assert.equal(first, 'failed')
  assert.equal(second, 'failed')
  assert.equal(fixture.requests.filter((url) => url === missing).length, 2)
})

// protects=owned origin: a module path that is not a single-slash path is refused before any request; fails_when=a scheme-relative path is fetched; no_claim=none beyond protects
test('refuses to read a module path that is not on the owned server without any request', async (context) => {
  // Arrange
  const fixture = await stage(context)
  // Act
  const failure = await fixture.moduleSource.read('//evil.test/a.js').then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'VITE_SEAL_FAILED')
  assert.deepEqual(fixture.requests, [])
})

// protects=decision table row 2 (deadline): a launcher walk answer that times out is refused as library-build-unmapped with cause deadline and the library identity, not an uncoded error; fails_when=the WaitTimeoutError propagates or another cause is reported; no_claim=the real launcher (a scripted list rejects)
test('refuses a walk answer timeout as library-build-unmapped with cause deadline', async (context) => {
  // Arrange
  const fixture = await stage(context)
  const request = {
    ...sealRequest(fixture),
    moduleSource: {
      list: () => Promise.reject(new WaitTimeoutError('walk timed out')),
      read: fixture.moduleSource.read,
    },
  }
  // Act
  const failure = await sealViteLibraryStop(request).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'VITE_SEAL_FAILED')
  assert.deepEqual(failure.details, {
    reason: 'library-build-unmapped',
    cause: 'deadline',
    packageRoot: 'examples/app',
    library: '@scope/core',
    file: 'packages/core/src/a.ts',
    sideEffects: 'none',
  })
})

// protects=launcher exit stays itself: a launcher that exited during the walk is not worded as a deadline; fails_when=every walk failure becomes cause deadline; no_claim=the real launcher (a scripted list rejects)
test('lets a launcher exit during the walk fail as it is instead of as a deadline', async (context) => {
  // Arrange
  const fixture = await stage(context)
  const request = {
    ...sealRequest(fixture),
    moduleSource: {
      list: () => Promise.reject(new Error('Application exited: 1')),
      read: fixture.moduleSource.read,
    },
  }
  // Act / Assert
  await assert.rejects(sealViteLibraryStop(request), /Application exited: 1/)
})

// protects=decision table row 2 (bound): library modules whose served bytes together pass the fetch bound refuse as library-build-unmapped with cause bound and the library identity; fails_when=the bound error escapes uncoded, is swallowed or another cause is reported; no_claim=the real launcher's walk bound (only the byte bound of the module fetches); why_new=the fetch-side bound was untested while the walk bound was; seam=none
test('refuses library modules whose fetched bytes pass the bound as library-build-unmapped with cause bound', async (context) => {
  // Arrange
  const fixture = await stage(context, { moduleText: 'x'.repeat(7_000_000) })
  const moduleSource = createViteLibraryModuleSource({
    ownedOrigin: fixture.origin,
    entryPath: '/',
    libraryRealFolder: fixture.library.realFolder,
    requestWalk: async () => ({
      // Three 7,000,000-byte modules pass the 20 MiB bound of one generation.
      modules: [1, 2, 3].map((n) => `${fixture.modulePath}?v=${n}`),
      optimizedLibrary: false,
    }),
    signal: new AbortController().signal,
  })
  // Act
  const failure = await sealViteLibraryStop({
    ...sealRequest(fixture),
    moduleSource,
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'VITE_SEAL_FAILED')
  assert.deepEqual(failure.details, {
    reason: 'library-build-unmapped',
    cause: 'bound',
    packageRoot: 'examples/app',
    library: '@scope/core',
    file: 'packages/core/src/a.ts',
    sideEffects: 'none',
  })
})

// protects=entry page: an entry path the owned server does not answer with a page ends the seal with a coded VITE_SEAL_FAILED that names the status; fails_when=the 404 body is walked as an entry page or the failure escapes uncoded; no_claim=the real Vite entry handling; why_new=no test reached the entry-page fetch failure rows; seam=none
test('refuses an entry path the owned server answers with a 404 before any walk', async (context) => {
  // Arrange
  const fixture = await stage(context)
  const walked: string[][] = []
  const moduleSource = createViteLibraryModuleSource({
    ownedOrigin: fixture.origin,
    entryPath: '/missing',
    libraryRealFolder: fixture.library.realFolder,
    requestWalk: async (entries) => {
      walked.push(entries)
      return { modules: [], optimizedLibrary: false }
    },
    signal: new AbortController().signal,
  })
  // Act
  const failure = await sealViteLibraryStop({
    ...sealRequest(fixture),
    moduleSource,
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'VITE_SEAL_FAILED')
  assert.match(failure.message, /it answered status 404/)
  assert.deepEqual(walked, [])
})

// protects=entry page: an entry page that redirects is never followed (it could leave the owned origin) and ends the seal with a coded VITE_SEAL_FAILED; fails_when=the redirect is followed to another host or the walk starts from a redirect body; no_claim=the real Vite entry handling; why_new=no test reached the entry-page redirect row; seam=none
test('refuses an entry page that redirects without following it', async (context) => {
  // Arrange
  const fixture = await stage(context)
  const requests: string[] = []
  const redirecting = createServer((request, response) => {
    requests.push(request.url ?? '')
    response.statusCode = 302
    response.setHeader('location', `${fixture.origin}/`)
    response.end()
  })
  await new Promise<void>((resolve) =>
    redirecting.listen(0, '127.0.0.1', resolve),
  )
  context.after(() => redirecting.close())
  const address = redirecting.address()
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  const moduleSource = createViteLibraryModuleSource({
    ownedOrigin: origin,
    entryPath: '/',
    libraryRealFolder: fixture.library.realFolder,
    requestWalk: async () => ({ modules: [], optimizedLibrary: false }),
    signal: new AbortController().signal,
  })
  // Act
  const failure = await sealViteLibraryStop({
    ...sealRequest(fixture),
    ownedOrigin: origin,
    moduleSource,
  }).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.match(failure.message, /it redirects \(status 302\)/)
  assert.deepEqual(requests, ['/'])
  assert.deepEqual(fixture.requests, [])
})
