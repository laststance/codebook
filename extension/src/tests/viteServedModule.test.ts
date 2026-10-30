import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { REPOSITORY_JAVASCRIPT_LIMIT_BYTES } from '../constants'
import { StudyError } from '../errors'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { createBundleVerifier } from '../utils/createBundleVerifier'
import { isViteScriptOfModule } from '../utils/isViteScriptOfModule'
import { readViteServedModule } from '../utils/readViteServedModule'
import { viteModuleUrl } from '../utils/viteModuleUrl'

const SOURCE = 'export const theme = "dark"\n'

type Route = {
  status?: number
  type?: string
  body?: string
  location?: string
}

/** Creates a package root holding `src/theme.ts` and a server that answers `routes` by path. */
async function startFixture(
  context: TestContext,
  routes: Record<string, Route>,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codebook-served-')))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src/theme.ts'), SOURCE)
  const server = createServer((request, response) => {
    const route = routes[decodeURIComponent(request.url ?? '')]
    response.statusCode = route?.status ?? 404
    if (route?.location) response.setHeader('location', route.location)
    response.setHeader('content-type', route?.type ?? 'text/plain')
    response.end(route?.body ?? '')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(async () => {
    server.close()
    await rm(root, { recursive: true, force: true })
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const origin = `http://127.0.0.1:${port}`
  const stop = {
    path: 'src/theme.ts',
    hash: sha256(SOURCE),
    line: 1,
    column: 1,
  }
  return { root, origin, stop }
}

/** A served module with an inline map that names `theme.ts` relative to the module directory. */
function servedModule(map: Record<string, unknown> | undefined): string {
  const code = 'export const theme = "dark";\n'
  if (!map) return code
  const encoded = Buffer.from(JSON.stringify(map)).toString('base64')
  return `${code}//# sourceMappingURL=data:application/json;base64,${encoded}\n`
}

const GOOD_MAP = {
  version: 3,
  sources: ['theme.ts'],
  sourcesContent: [SOURCE],
  names: [],
  mappings: 'AAAA',
}

/** Runs the seal and returns the refusal. */
async function refusalOf(promise: Promise<unknown>): Promise<StudyError> {
  const error: unknown = await promise.then(
    () => undefined,
    (cause: unknown) => cause,
  )
  assert.ok(error instanceof StudyError, `expected a StudyError, got ${error}`)
  return error
}

test('seals the served module unchanged and its map maps the declared line to the workspace file', async (context) => {
  // Arrange
  const body = servedModule(GOOD_MAP)
  const fixture = await startFixture(context, {
    '/src/theme.ts': { status: 200, type: 'text/javascript', body },
  })
  // Act
  const { bundle } = await readViteServedModule(
    fixture.root,
    fixture.origin,
    fixture.stop,
    new AbortController().signal,
  )
  const verifier = createBundleVerifier(bundle)
  // Assert
  assert.equal(bundle.javascript, body)
  assert.equal(bundle.scriptUrl, `${fixture.origin}/src/theme.ts`)
  assert.equal(bundle.sourcePath, join(fixture.root, 'src/theme.ts'))
  assert.deepEqual(verifier.mappedPositions(1, 1).positions, [
    { line: 1, column: 1 },
  ])
})

test('refuses a stop whose module is not served, naming the file, the line and the address', async (context) => {
  // Arrange
  const fixture = await startFixture(context, {})
  // Act
  const error = await refusalOf(
    readViteServedModule(
      fixture.root,
      fixture.origin,
      fixture.stop,
      new AbortController().signal,
    ),
  )
  // Assert
  assert.equal(error.code, 'VITE_SEAL_FAILED')
  assert.match(
    error.message,
    new RegExp(
      `Declared stop src/theme\\.ts:1 cannot be sealed: ${fixture.origin.replaceAll('.', '\\.')}/src/theme\\.ts answered status 404`,
    ),
  )
})

test('refuses a redirect without following it and names the address', async (context) => {
  // Arrange
  const fixture = await startFixture(context, {
    '/src/theme.ts': { status: 302, location: 'http://127.0.0.1:1/elsewhere' },
  })
  // Act
  const error = await refusalOf(
    readViteServedModule(
      fixture.root,
      fixture.origin,
      fixture.stop,
      new AbortController().signal,
    ),
  )
  // Assert
  assert.match(
    error.message,
    /\/src\/theme\.ts redirects \(status 302\) and Codebook follows no redirect/,
  )
})

test('refuses a module served as something other than JavaScript', async (context) => {
  // Arrange
  const fixture = await startFixture(context, {
    '/src/theme.ts': { status: 200, type: 'text/html', body: '<html>' },
  })
  // Act
  const error = await refusalOf(
    readViteServedModule(
      fixture.root,
      fixture.origin,
      fixture.stop,
      new AbortController().signal,
    ),
  )
  // Assert
  assert.match(error.message, /is served as text\/html, not JavaScript/)
})

test('refuses a module without an inline map', async (context) => {
  // Arrange
  const fixture = await startFixture(context, {
    '/src/theme.ts': {
      status: 200,
      type: 'text/javascript',
      body: servedModule(undefined),
    },
  })
  // Act
  const error = await refusalOf(
    readViteServedModule(
      fixture.root,
      fixture.origin,
      fixture.stop,
      new AbortController().signal,
    ),
  )
  // Assert
  assert.match(error.message, /has 0 inline source maps, not exactly one/)
})

test('refuses a map that names another file or carries different source text', async (context) => {
  // Arrange
  const otherFile = await startFixture(context, {
    '/src/theme.ts': {
      status: 200,
      type: 'text/javascript',
      body: servedModule({ ...GOOD_MAP, sources: ['other.ts'] }),
    },
  })
  const otherText = await startFixture(context, {
    '/src/theme.ts': {
      status: 200,
      type: 'text/javascript',
      body: servedModule({ ...GOOD_MAP, sourcesContent: ['export {}\n'] }),
    },
  })
  // Act
  const named = await refusalOf(
    readViteServedModule(
      otherFile.root,
      otherFile.origin,
      otherFile.stop,
      new AbortController().signal,
    ),
  )
  const text = await refusalOf(
    readViteServedModule(
      otherText.root,
      otherText.origin,
      otherText.stop,
      new AbortController().signal,
    ),
  )
  // Assert
  assert.match(named.message, /does not name the stop's file exactly once/)
  assert.match(text.message, /carries source text that differs from the file/)
})

test('refuses a body over the JavaScript byte limit', async (context) => {
  // Arrange
  const fixture = await startFixture(context, {
    '/src/theme.ts': {
      status: 200,
      type: 'text/javascript',
      body: 'a'.repeat(REPOSITORY_JAVASCRIPT_LIMIT_BYTES + 1),
    },
  })
  // Act
  const error = await refusalOf(
    readViteServedModule(
      fixture.root,
      fixture.origin,
      fixture.stop,
      new AbortController().signal,
    ),
  )
  // Assert
  assert.match(error.message, /exceeds 8388608 bytes/)
})

test('maps stop files to served addresses with encoding, case and Windows-style input', async (context) => {
  // Arrange
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codebook-url-')))
  context.after(() => rm(root, { recursive: true, force: true }))
  const names = [
    'src/my file.tsx',
    'src/a#b.ts',
    'src/q?x.ts',
    'src/日本語.ts',
    'src/[id].tsx',
    'src/CamelCase.ts',
  ]
  await mkdir(join(root, 'src'), { recursive: true })
  for (const name of names) await writeFile(join(root, name), '')
  // Act
  const urls = await Promise.all(
    [...names, 'src\\CamelCase.ts'].map(
      async (name) =>
        (await viteModuleUrl(root, name, 'http://127.0.0.1:3010')).url,
    ),
  )
  // Assert
  assert.deepEqual(urls, [
    'http://127.0.0.1:3010/src/my%20file.tsx',
    'http://127.0.0.1:3010/src/a%23b.ts',
    'http://127.0.0.1:3010/src/q%3Fx.ts',
    'http://127.0.0.1:3010/src/%E6%97%A5%E6%9C%AC%E8%AA%9E.ts',
    'http://127.0.0.1:3010/src/%5Bid%5D.tsx',
    'http://127.0.0.1:3010/src/CamelCase.ts',
    'http://127.0.0.1:3010/src/CamelCase.ts',
  ])
})

test('refuses stop files outside the root, in node_modules or of a framework extension', async (context) => {
  // Arrange
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codebook-url-')))
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'codebook-out-')))
  context.after(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })
  await mkdir(join(root, 'node_modules/pkg'), { recursive: true })
  await writeFile(join(root, 'node_modules/pkg/index.js'), '')
  await writeFile(join(root, 'App.vue'), '')
  await writeFile(join(outside, 'secret.ts'), '')
  await symlink(join(outside, 'secret.ts'), join(root, 'linked.ts'))
  // Act
  const messages: string[] = []
  for (const name of ['linked.ts', 'node_modules/pkg/index.js', 'App.vue'])
    messages.push(
      await viteModuleUrl(root, name, 'http://127.0.0.1:3010').then(
        () => 'accepted',
        (error: Error) => error.message,
      ),
    )
  // Assert
  assert.match(messages[0]!, /linked\.ts resolves outside the package root/)
  assert.match(
    messages[1]!,
    /node_modules\/pkg\/index\.js is inside node_modules/,
  )
  assert.match(messages[2]!, /App\.vue has the extension \.vue/)
})

test('refuses a map that is not UTF-8 JSON with the coded seal failure instead of a raw parse error', async (context) => {
  // Arrange
  const notJson = Buffer.from('not json').toString('base64')
  const notUtf8 = Buffer.from([0xff, 0xfe, 0xfd]).toString('base64')
  const fixtures = await Promise.all(
    [notJson, notUtf8].map((encoded) =>
      startFixture(context, {
        '/src/theme.ts': {
          status: 200,
          type: 'text/javascript',
          body: `export const theme = "dark";\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`,
        },
      }),
    ),
  )
  // Act
  const errors = await Promise.all(
    fixtures.map((fixture) =>
      refusalOf(
        readViteServedModule(
          fixture.root,
          fixture.origin,
          fixture.stop,
          new AbortController().signal,
        ),
      ),
    ),
  )
  // Assert
  for (const error of errors) {
    assert.equal(error.code, 'VITE_SEAL_FAILED')
    assert.match(
      error.message,
      /the inline source map of http:\/\/127\.0\.0\.1:\d+\/src\/theme\.ts is not valid UTF-8 JSON/,
    )
  }
})

test('refuses a map source entry with a malformed percent escape with the coded seal failure', async (context) => {
  // Arrange
  const fixture = await startFixture(context, {
    '/src/theme.ts': {
      status: 200,
      type: 'text/javascript',
      body: servedModule({ ...GOOD_MAP, sources: ['theme.ts', '/%E0%A4%A'] }),
    },
  })
  // Act
  const error = await refusalOf(
    readViteServedModule(
      fixture.root,
      fixture.origin,
      fixture.stop,
      new AbortController().signal,
    ),
  )
  // Assert
  assert.equal(error.code, 'VITE_SEAL_FAILED')
  assert.match(
    error.message,
    /has the source entry "\/%E0%A4%A", which is not a valid URL path/,
  )
})

test('matches an announced script to its sealed address on any loopback host and ignores the hot-update query', () => {
  // Arrange
  const sealed = 'http://127.0.0.1:3010/src/theme.ts'
  // Act
  const results = [
    isViteScriptOfModule(sealed, 'http://localhost:3010/src/theme.ts'),
    isViteScriptOfModule(sealed, 'http://localhost:3010/src/theme.ts?t=1730'),
    isViteScriptOfModule(sealed, 'http://[::1]:3010/src/theme.ts'),
    isViteScriptOfModule(sealed, 'http://localhost:3011/src/theme.ts'),
    isViteScriptOfModule(sealed, 'http://example.com:3010/src/theme.ts'),
    isViteScriptOfModule(sealed, 'http://localhost:3010/src/other.ts'),
    isViteScriptOfModule(sealed, ''),
  ]
  // Assert
  assert.deepEqual(results, [true, true, true, false, false, false, false])
})
