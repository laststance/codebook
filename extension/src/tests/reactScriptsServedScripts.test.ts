import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { REPOSITORY_JAVASCRIPT_LIMIT_BYTES } from '../constants'
import { StudyError } from '../errors'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import { awaitReactScriptsFirstCompile } from '../utils/awaitReactScriptsFirstCompile'
import {
  ReactScriptsBundleCache,
  ReactScriptsBundleNotReadyError,
  readReactScriptsServedBundle,
} from '../utils/readReactScriptsServedBundle'
import { sealReactScriptsLibraryStop } from '../utils/sealReactScriptsLibraryStop'
import { sealReactScriptsStop } from '../utils/sealReactScriptsStop'

import { createReactScriptsRepository } from './utils/reactScriptsFixture'

/** How one served script answers a request; the request count (1 for the first) lets a script become ready later. */
type ScriptAnswer = 'ok' | 'not-found' | 'html' | 'redirect-off-origin'

/** One script of the fixture page: its map (`null` for a runtime without `sourceMappingURL`) and how it answers. */
type FixtureScript = {
  map: { sources: string[]; sourcesContent: string[] } | null
  answer?: (requestCount: number) => ScriptAnswer
  /** Pads the script text to this many bytes. */
  padToBytes?: number
  /** Changes the script bytes by request count (a recompile that leaves the other scripts alone). */
  version?: (requestCount: number) => string
  /** Gives the map by the count of requests for it (a map that is stale on its first read). */
  mapAt?: (requestCount: number) => {
    sources: string[]
    sourcesContent: string[]
  }
}

/**
 * Serves an entry page naming the given scripts in order, each with its own map, from one loopback server (the shape react-scripts 4 serves: a runtime, a vendors chunk and the app's chunk).
 * @param context - The test, which closes the server.
 * @param scripts - The scripts by file name, in page order.
 * @param outsideScripts - Script addresses outside static/js/ the page also names.
 * @param pageScriptsAt - The script names the page names on its nth request; when absent, every script of {@link scripts}.
 * @returns The owned origin.
 * @example const { origin } = await serveScripts(context, { 'main.chunk.js': { map: null } })
 */
async function serveScripts(
  context: TestContext,
  scripts: Record<string, FixtureScript>,
  outsideScripts: string[] = [],
  pageScriptsAt?: (pageCount: number) => string[],
) {
  const requestCounts = new Map<string, number>()
  // Scripts outside static/js/ (an env-config.js) name a map that does not exist.
  const pageOf = (names: string[]) =>
    [...names.map((name) => `/static/js/${name}`), ...outsideScripts]
      .map((src) => `<script src="${src}"></script>`)
      .join('')
  const page = pageOf(Object.keys(scripts))
  let pageCount = 0
  const server = createServer((request, response) => {
    const path = request.url ?? '/'
    if (path === '/') {
      pageCount += 1
      response.setHeader('content-type', 'text/html')
      // A page whose script list changes by request count stands for a recompile that adds a chunk.
      response.end(pageScriptsAt ? pageOf(pageScriptsAt(pageCount)) : page)
      return
    }
    if (outsideScripts.includes(path)) {
      response.setHeader('content-type', 'application/javascript')
      response.end(`window.x = 1\n//# sourceMappingURL=${path}.map\n`)
      return
    }
    const isMap = path.endsWith('.map')
    const name = path.replace('/static/js/', '').replace(/\.map$/, '')
    const script = scripts[name]
    if (script === undefined) {
      response.statusCode = 404
      response.end()
      return
    }
    const count = (requestCounts.get(path) ?? 0) + 1
    requestCounts.set(path, count)
    // The answer rule belongs to the script; its map is always served.
    const answer = isMap ? 'ok' : (script.answer?.(count) ?? 'ok')
    if (answer === 'not-found') {
      response.statusCode = 404
      response.end()
    } else if (answer === 'html') {
      response.setHeader('content-type', 'text/html')
      response.end(page)
    } else if (answer === 'redirect-off-origin') {
      response.statusCode = 302
      response.setHeader('location', 'http://example.invalid/elsewhere.js')
      response.end()
    } else if (isMap) {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          version: 3,
          file: name,
          names: [],
          mappings: 'AAAA;AACA;AACA;AACA',
          ...(script.mapAt?.(count) ?? script.map),
        }),
      )
    } else {
      const reference =
        script.map === null ? '' : `\n//# sourceMappingURL=${name}.map\n`
      const body = `console.log(${JSON.stringify(name)}${script.version ? `, ${JSON.stringify(script.version(count))}` : ''})${reference}`
      response.setHeader('content-type', 'application/javascript')
      response.end(
        script.padToBytes === undefined
          ? body
          : body + '/'.repeat(script.padToBytes),
      )
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise<void>((done) => server.close(() => done())))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('The fixture server has no port.')
  return { origin: `http://127.0.0.1:${address.port}` }
}

/** Builds the seal request for the stop in the staged app's `src/App.js`. */
function appStopRequest(
  repository: Awaited<ReturnType<typeof createReactScriptsRepository>>,
  origin: string,
  cache: ReactScriptsBundleCache,
) {
  return {
    appRoot: repository.appRoot,
    packageRootRelative: repository.appFolder,
    packageRelativePath: 'src/App.js',
    source: {
      path: `${repository.appFolder}/src/App.js`,
      hash: repository.sourceHash,
      line: 2,
      column: 1,
    },
    citationEndLine: 3,
    ownedOrigin: origin,
    signal: new AbortController().signal,
    cache,
  }
}

/** Reads the refusal a promise ended with: code and reason. */
async function refusalOf(
  pending: Promise<unknown>,
): Promise<{ code: string; reason: unknown }> {
  const error = await pending.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  assert.ok(error instanceof StudyError, String(error))
  return { code: error.code, reason: error.details?.reason }
}

/** The map of a runtime or vendors script: no file of the app. */
const OTHER_MAP = {
  sources: ['/elsewhere/node_modules/redux/es/redux.js'],
  sourcesContent: ['export const redux = 1\n'],
}

// Value: protects=a react-scripts 4 app (runtime, vendors chunk, app chunk) seals a stop in src/ from the map of the chunk that names it; fails_when=the reader takes only the first script or only a script named bundle.js; no_claim=a real webpack 4 compile
test('a stop in src seals in the map of the app chunk of three served scripts', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const stopPath = join(repository.appRoot, 'src/App.js')
  const { origin } = await serveScripts(context, {
    'bundle.js': {
      map: { sources: ['webpack/bootstrap'], sourcesContent: [''] },
    },
    'vendors~main.chunk.js': { map: OTHER_MAP },
    'main.chunk.js': {
      map: { sources: [stopPath], sourcesContent: [repository.sourceText] },
    },
  })
  const cache = new ReactScriptsBundleCache('/', repository.appRoot)
  // Act
  const { bundle } = await sealReactScriptsStop(
    appStopRequest(repository, origin, cache),
  )
  // Assert
  assert.equal(bundle.scriptUrl, `${origin}/static/js/main.chunk.js`)
  assert.equal(bundle.sourcePath, stopPath.replaceAll('\\', '/'))
})

// Value: protects=a file that two served maps name is refused ambiguous-source instead of sealing in the first; fails_when=the first matching map wins; no_claim=which copy a browser would run
test('a canonical path named by two served maps is refused with ambiguous-source', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const stopPath = join(repository.appRoot, 'src/App.js')
  const named = { sources: [stopPath], sourcesContent: [repository.sourceText] }
  const { origin } = await serveScripts(context, {
    'a.chunk.js': { map: named },
    'b.chunk.js': { map: named },
  })
  // Act
  const refusal = await refusalOf(
    sealReactScriptsStop(
      appStopRequest(repository, origin, new ReactScriptsBundleCache()),
    ),
  )
  // Assert
  assert.deepEqual(refusal, {
    code: 'REACT_SCRIPTS_SEAL_FAILED',
    reason: 'ambiguous-source',
  })
})

// Value: protects=an entry page naming nine same-origin scripts is refused too-many-scripts; fails_when=the reader reads an unbounded number of scripts; no_claim=the limit value is right for every app
test('a ninth same-origin script is refused with too-many-scripts', async (context) => {
  // Arrange
  const scripts: Record<string, FixtureScript> = {}
  for (let index = 1; index <= 9; index++)
    scripts[`chunk${index}.js`] = { map: OTHER_MAP }
  const { origin } = await serveScripts(context, scripts)
  // Act
  const refusal = await refusalOf(
    readReactScriptsServedBundle(
      origin,
      new AbortController().signal,
      new ReactScriptsBundleCache(),
    ),
  )
  // Assert
  assert.deepEqual(refusal, {
    code: 'REACT_SCRIPTS_SEAL_FAILED',
    reason: 'too-many-scripts',
  })
})

// Value: protects=a script that redirects off the owned origin is refused script-off-origin and never followed; fails_when=the redirect is polled as not ready forever or followed; no_claim=redirects that stay on the owned origin
test('a script redirected off the owned origin is refused with script-off-origin', async (context) => {
  // Arrange
  const { origin } = await serveScripts(context, {
    'bundle.js': { map: OTHER_MAP },
    'main.chunk.js': { map: OTHER_MAP, answer: () => 'redirect-off-origin' },
  })
  // Act
  const refusal = await refusalOf(
    readReactScriptsServedBundle(
      origin,
      new AbortController().signal,
      new ReactScriptsBundleCache(),
    ),
  )
  // Assert
  assert.deepEqual(refusal, {
    code: 'REACT_SCRIPTS_SEAL_FAILED',
    reason: 'script-off-origin',
  })
})

// Value: protects=a script over the byte limit is refused script-too-large; fails_when=an oversized script is read whole or reported as map-unreadable; no_claim=maps over the limit (map-limit)
test('a script over the byte limit is refused with script-too-large', async (context) => {
  // Arrange
  const { origin } = await serveScripts(context, {
    'bundle.js': {
      map: OTHER_MAP,
      padToBytes: REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
    },
  })
  // Act
  const refusal = await refusalOf(
    readReactScriptsServedBundle(
      origin,
      new AbortController().signal,
      new ReactScriptsBundleCache(),
    ),
  )
  // Assert
  assert.deepEqual(refusal, {
    code: 'REACT_SCRIPTS_SEAL_FAILED',
    reason: 'script-too-large',
  })
})

// Value: protects=webpack's runtime script without sourceMappingURL is skipped when other scripts have maps; fails_when=the runtime script refuses the whole run as map-unreadable; no_claim=the runtime script is sealed
test('a runtime script without a source map is skipped and the other maps are read', async (context) => {
  // Arrange
  const { origin } = await serveScripts(context, {
    'runtime.js': { map: null },
    'main.chunk.js': { map: OTHER_MAP },
  })
  // Act
  const served = await readReactScriptsServedBundle(
    origin,
    new AbortController().signal,
    new ReactScriptsBundleCache(),
  )
  // Assert
  assert.deepEqual(
    served.map((script) => script.bundleUrl),
    [`${origin}/static/js/main.chunk.js`],
  )
})

// Value: protects=readiness waits through a 404 script and an HTML page in place of a script and then reads ready; fails_when=the wait ends at the first 404 or HTML answer, or reads the HTML as a script; no_claim=how long a real compile takes
test('readiness polls through a 404 script and an HTML answer before it reads ready', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const stopPath = join(repository.appRoot, 'src/App.js')
  const { origin } = await serveScripts(context, {
    'vendors~main.chunk.js': {
      map: OTHER_MAP,
      answer: (count) => (count === 1 ? 'not-found' : 'ok'),
    },
    'main.chunk.js': {
      map: { sources: [stopPath], sourcesContent: [repository.sourceText] },
      answer: (count) => (count <= 2 ? 'html' : 'ok'),
    },
  })
  const cache = new ReactScriptsBundleCache('/', repository.appRoot)
  // Act
  await awaitReactScriptsFirstCompile(
    origin,
    cache,
    10_000,
    new AbortController().signal,
  )
  // Assert
  assert.equal(
    cache.entry?.bundleUrl,
    `${origin}/static/js/vendors~main.chunk.js`,
  )
  assert.equal(cache.scriptCaches.size, 2)
  assert.equal(cache.mapReads, 2)
})

// Value: protects=readiness needs a map that names a file under the app folder, so a page whose maps name only other folders never reads ready; fails_when=any served map makes the app ready; no_claim=the wait budget of a real run
test('readiness does not accept maps that name no file of the app', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const { origin } = await serveScripts(context, {
    'bundle.js': { map: OTHER_MAP },
  })
  const cache = new ReactScriptsBundleCache('/', repository.appRoot)
  // Act
  const waiting = awaitReactScriptsFirstCompile(
    origin,
    cache,
    700,
    new AbortController().signal,
  )
  // Assert
  await assert.rejects(waiting, WaitTimeoutError)
})

// Value: protects=a library file the vendors chunk's map names is found and sealed under react-scripts 4's split output; fails_when=the library seal reads only one script; no_claim=a real packed build
test('a library file named only by the vendors map is sealed', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const libraryText = 'export function createStore() {\n  return 1\n}\n'
  const libraryRoot = join(repository.root, 'packages/lib')
  const packedRoot = join(repository.root, 'private/node_modules/lib')
  const checkedOut = join(libraryRoot, 'src/createStore.ts')
  await mkdir(dirname(checkedOut), { recursive: true })
  await writeFile(checkedOut, libraryText)
  await mkdir(join(packedRoot, 'src'), { recursive: true })
  await writeFile(join(packedRoot, 'src/createStore.ts'), libraryText)
  const { origin } = await serveScripts(context, {
    'bundle.js': {
      map: { sources: ['webpack/bootstrap'], sourcesContent: [''] },
    },
    'vendors~main.chunk.js': {
      map: { sources: [checkedOut], sourcesContent: [libraryText] },
    },
    'main.chunk.js': { map: OTHER_MAP },
  })
  // Act
  const { bundle } = await sealReactScriptsLibraryStop(
    {
      appRoot: libraryRoot,
      packageRootRelative: 'packages/lib',
      packageRelativePath: 'src/createStore.ts',
      source: {
        path: 'packages/lib/src/createStore.ts',
        hash: sha256(libraryText),
        line: 2,
        column: 1,
      },
      citationEndLine: 3,
      ownedOrigin: origin,
      signal: new AbortController().signal,
      cache: new ReactScriptsBundleCache(),
    },
    {
      packageName: 'lib',
      examplePackageRoot: 'examples/counter',
      packedRoot,
    },
  )
  // Assert
  assert.equal(bundle.scriptUrl, `${origin}/static/js/vendors~main.chunk.js`)
  assert.equal(bundle.sourcePath, checkedOut.replaceAll('\\', '/'))
})

// Value: protects=a react-scripts 5 page with a second same-origin script outside static/js/ reads ready and seals; fails_when=the reader fetches every same-origin script and a missing map of an env-config.js keeps the app waiting; no_claim=scripts under static/js/ that are not webpack's
test('a script outside static/js whose map is missing does not stop readiness or the seal', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const stopPath = join(repository.appRoot, 'src/App.js')
  const { origin } = await serveScripts(
    context,
    {
      'bundle.js': {
        map: { sources: [stopPath], sourcesContent: [repository.sourceText] },
      },
    },
    ['/config.js'],
  )
  const cache = new ReactScriptsBundleCache('/', repository.appRoot)
  // Act
  await awaitReactScriptsFirstCompile(
    origin,
    cache,
    10_000,
    new AbortController().signal,
  )
  const { bundle } = await sealReactScriptsStop(
    appStopRequest(repository, origin, cache),
  )
  // Assert
  assert.deepEqual(
    [...cache.scriptCaches.keys()],
    [`${origin}/static/js/bundle.js`],
  )
  assert.equal(bundle.scriptUrl, `${origin}/static/js/bundle.js`)
})

// Value: protects=the eight-script limit counts only the scripts under static/js/; fails_when=scripts outside the webpack output folder count toward the limit; no_claim=the limit value
test('scripts outside static/js do not count toward the eight-script limit', async (context) => {
  // Arrange
  const scripts: Record<string, FixtureScript> = {}
  for (let index = 1; index <= 8; index++)
    scripts[`chunk${index}.js`] = { map: OTHER_MAP }
  const { origin } = await serveScripts(context, scripts, [
    '/config.js',
    '/vendor/a.js',
    '/vendor/b.js',
  ])
  // Act
  const served = await readReactScriptsServedBundle(
    origin,
    new AbortController().signal,
    new ReactScriptsBundleCache(),
  )
  // Assert
  assert.equal(served.length, 8)
})

// Value: protects=a seal without the app folder never reads an HTML answer as a script; fails_when=the HTML check is removed and the HTML page seals or is refused not-in-entry-bundle; no_claim=how long the server stays in that state
test('a chunk that answers HTML makes the seal read not ready', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const stopPath = join(repository.appRoot, 'src/App.js')
  const { origin } = await serveScripts(context, {
    'vendors~main.chunk.js': { map: OTHER_MAP, answer: () => 'html' },
    'main.chunk.js': {
      map: { sources: [stopPath], sourcesContent: [repository.sourceText] },
    },
  })
  // Act
  const sealing = sealReactScriptsStop(
    appStopRequest(repository, origin, new ReactScriptsBundleCache()),
  )
  // Assert
  await assert.rejects(sealing, ReactScriptsBundleNotReadyError)
})

// Value: protects=a stale map of the script that holds the stop is read once more even when another script's map was re-read; fails_when=the retry compares the summed map-read count; no_claim=a stale map that stays stale
test('a stale map of the stop script is re-read after another script recompiled', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const stopPath = join(repository.appRoot, 'src/App.js')
  const stale = {
    sources: [stopPath],
    sourcesContent: ['export const old = 1\n'],
  }
  const fresh = { sources: [stopPath], sourcesContent: [repository.sourceText] }
  const { origin } = await serveScripts(context, {
    'a.chunk.js': { map: OTHER_MAP, version: (count) => `v${count}` },
    'main.chunk.js': {
      map: stale,
      mapAt: (count) => (count === 1 ? stale : fresh),
    },
  })
  const cache = new ReactScriptsBundleCache()
  const first = await refusalOf(
    sealReactScriptsStop(appStopRequest(repository, origin, cache)),
  )
  // Act
  const { bundle } = await sealReactScriptsStop(
    appStopRequest(repository, origin, cache),
  )
  // Assert
  assert.equal(first.code, 'SOURCE_CHANGED')
  assert.equal(bundle.scriptUrl, `${origin}/static/js/main.chunk.js`)
})

// Value: protects=an app folder that cannot be read is a not-ready result, not a raw filesystem error; fails_when=the realpath error escapes readiness; no_claim=the folder comes back later
test('an unreadable app folder reads not ready', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const { origin } = await serveScripts(context, {
    'bundle.js': { map: OTHER_MAP },
  })
  const cache = new ReactScriptsBundleCache(
    '/',
    join(repository.root, 'no-such-app-folder'),
  )
  // Act
  const reading = readReactScriptsServedBundle(
    origin,
    new AbortController().signal,
    cache,
  )
  // Assert
  await assert.rejects(reading, ReactScriptsBundleNotReadyError)
})

// Value: protects=after a stale map makes the seal forget its entries, the next seal reads the entry page again, so a chunk a recompile added is read and the stop seals in the map that now names its file; fails_when=forgetEntries keeps the cached script list, the added chunk is never read and the stop is refused; no_claim=a real webpack recompile
test('a chunk added by a recompile after a stale map is read on the next seal', async (context) => {
  // Arrange
  const repository = await createReactScriptsRepository(context)
  const stopPath = join(repository.appRoot, 'src/App.js')
  const stale = {
    sources: [stopPath],
    sourcesContent: ['export const old = 1\n'],
  }
  const fresh = { sources: [stopPath], sourcesContent: [repository.sourceText] }
  const { origin } = await serveScripts(
    context,
    {
      'main.chunk.js': {
        map: stale,
        // The bundle bytes stay, so the second seal reads the cached stale map first and then forgets the cache.
        mapAt: (count) => (count === 1 ? stale : OTHER_MAP),
      },
      'added.chunk.js': { map: fresh },
    },
    [],
    (pageCount) =>
      pageCount === 1 ? ['main.chunk.js'] : ['main.chunk.js', 'added.chunk.js'],
  )
  const cache = new ReactScriptsBundleCache()
  const first = await refusalOf(
    sealReactScriptsStop(appStopRequest(repository, origin, cache)),
  )
  // Act
  const { bundle } = await sealReactScriptsStop(
    appStopRequest(repository, origin, cache),
  )
  // Assert
  assert.equal(first.code, 'SOURCE_CHANGED')
  assert.equal(bundle.scriptUrl, `${origin}/static/js/added.chunk.js`)
})
