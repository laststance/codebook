import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { libraryRecoveryOf } from '../nextRefusals'
import { sha256 } from '../runtimeSupport/utils/sha256'
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
    sideEffects: 'unknown',
  })
  // Act
  const text = viteLibraryFailureText(error)
  const restored = text === undefined ? undefined : refusalFailureOf(text)
  // Assert
  assert.equal(restored?.code, 'VITE_SEAL_FAILED')
  assert.deepEqual(restored?.libraryDetails, {
    reason: 'library-build-unmapped',
    cause: 'lazy-import',
    sideEffects: 'unknown',
  })
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
    sideEffects: 'unknown',
  })
})
