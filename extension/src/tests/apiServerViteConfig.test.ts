import assert from 'node:assert/strict'
import { test } from 'node:test'

import { liveRepositoryConfigSchema } from '../repositoryConfigSchemas'

const API_SERVER = {
  packageRoot: 'server',
  entry: 'src/index.ts',
  port: 5200,
}

/** A server stop in the API's own folder, declared after operation 1. */
const API_STOP = {
  participant: 'server',
  source: {
    path: 'server/src/handler.ts',
    hash: 'b'.repeat(64),
    line: 12,
    column: 3,
  },
  anchorIndex: 0,
  inspections: [{ path: 'input', mode: 'value', required: true }],
  afterOperation: 1,
}

/**
 * A valid version 3 vite-dev configuration for an app at the repository root with its API in `server/`: one browser stop in the app and one server stop in the API; the caller replaces fields.
 * @example configuration({ packageRoot: 'apps/web' }).packageRoot // => 'apps/web'
 */
function configuration(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 3,
    adapter: 'vite-dev',
    book: {
      bookId: 'interface',
      revision: 1,
      nodeId: 'sign-in',
      anchorIndex: 0,
    },
    source: {
      path: 'src/App.tsx',
      hash: 'a'.repeat(64),
      line: 56,
      column: 5,
    },
    apiServer: API_SERVER,
    participant: 'browser',
    afterOperation: 1,
    before: [{ kind: 'visible', selector: '#email' }],
    after: [{ kind: 'text', selector: '#status', equals: 'sent' }],
    operations: [{ kind: 'click', title: 'Press', selector: '#press' }],
    inspections: [{ path: 'state', mode: 'value', required: true }],
    additionalStops: [API_STOP],
    ...extra,
  }
}

/** The issues the live schema gives an input as `path: message` lines, or `accepted`. */
function issuesOf(input: unknown): string {
  const result = liveRepositoryConfigSchema.safeParse(input)
  return result.success
    ? 'accepted'
    : result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n')
}

/** A configuration whose `apiServer` declares the given `proxyPaths`. */
function withProxyPaths(proxyPaths: unknown): Record<string, unknown> {
  return configuration({ apiServer: { ...API_SERVER, proxyPaths } })
}

// Value: protects=an app at the repository root with its API in a subfolder validates (the shape of a root Vite app with a server folder); fails_when=the old containment refusal fires for an API folder inside the app folder; no_claim=a real run
test('a vite-dev run at the repository root accepts an API in a subfolder', () => {
  // Arrange
  const input = configuration()
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.equal(issues, 'accepted')
})

// Value: protects=an API folder that equals or contains the app folder is refused naming apiServer.packageRoot; fails_when=either shape is accepted; no_claim=symbolic links (the run checks real paths)
test('a vite-dev run refuses an API folder that contains or equals the app folder', () => {
  // Arrange
  const equalFolders = configuration({
    packageRoot: 'server',
    source: { ...API_STOP.source, path: 'server/src/App.tsx' },
  })
  const appInsideApi = configuration({
    packageRoot: 'server/web',
    source: { ...API_STOP.source, path: 'server/web/src/App.tsx' },
  })
  const apiAtRoot = configuration({
    apiServer: { ...API_SERVER, packageRoot: '.' },
  })
  // Act
  const issues = [equalFolders, appInsideApi, apiAtRoot].map(issuesOf)
  // Assert
  assert.match(
    issues[0]!,
    /^apiServer\.packageRoot: apiServer\.packageRoot "server" equals or contains the app's packageRoot "server"; declare the API's folder inside the app's folder or beside it, never around it\./m,
  )
  assert.match(
    issues[1]!,
    /^apiServer\.packageRoot: apiServer\.packageRoot "server" equals or contains the app's packageRoot "server\/web"/m,
  )
  assert.match(
    issues[2]!,
    /^apiServer\.packageRoot: apiServer\.packageRoot "\." equals or contains the app's packageRoot "\."/m,
  )
})

// Value: protects=a browser stop inside the API folder is refused naming participant; fails_when=a browser stop in server/ passes; no_claim=runtime sealing
test('a browser stop inside the API folder is refused naming participant', () => {
  // Arrange
  const input = configuration({
    source: { ...API_STOP.source, path: 'server/src/page.ts' },
  })
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.equal(
    issues,
    'source.path: With apiServer, a browser stop must lie outside apiServer.packageRoot "server"; server/src/page.ts is declared at configuration.source.path. Declare participant "server" for a stop in the API folder.',
  )
})

// Value: protects=a server stop outside the API folder and an entry-load server stop are refused naming their field; fails_when=either passes; no_claim=that the files exist
test('a server stop outside the API folder and a server stop at afterOperation 0 are refused naming the field', () => {
  // Arrange
  const outsideApi = configuration({
    additionalStops: [
      {
        ...API_STOP,
        source: { ...API_STOP.source, path: 'src/handler.ts' },
      },
    ],
  })
  const entryLoad = configuration({
    additionalStops: [{ ...API_STOP, afterOperation: 0 }],
  })
  // Act
  const issues = [outsideApi, entryLoad].map(issuesOf)
  // Assert
  assert.equal(
    issues[0],
    'additionalStops.0.source.path: A server stop must lie inside apiServer.packageRoot "server"; src/handler.ts is declared at configuration.additionalStops.0.source.path. Declare participant "browser" for a stop outside the API folder.',
  )
  assert.match(
    issues[1]!,
    /^additionalStops\.0\.afterOperation: afterOperation 0 is declared at configuration\.additionalStops\.0\.afterOperation, but an API server stop needs an operation: entry-load API stops are not supported \(API 1\.38\)/m,
  )
})

// Value: protects=D5 apiServer and library are never declared on one vite-dev run; fails_when=both are accepted; no_claim=the library run's own rules
test('apiServer with library on one vite-dev run is refused', () => {
  // Arrange
  const input = configuration({
    packageRoot: 'apps/web',
    source: { ...API_STOP.source, path: 'apps/web/src/App.tsx' },
    library: { packageRoot: 'packages/ui', buildScript: 'build' },
  })
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.match(
    issues,
    /^apiServer: apiServer and library cannot be declared on one vite-dev run; declare the library run or the API run, not both\.$/m,
  )
})

// Value: protects=the TypeScript-entry loader rule holds on the new adapter; fails_when=a TypeScript entry with loader node is accepted on vite-dev; no_claim=that tsx is installed
test('a TypeScript entry with loader node is refused on vite-dev', () => {
  // Arrange
  const input = configuration({
    apiServer: { ...API_SERVER, loader: 'node' },
  })
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.match(
    issues,
    /^apiServer\.loader: expected "tsx" for a TypeScript entry/m,
  )
})

// Value: protects=1 to 8 well-formed prefixes validate and keep their declared order; fails_when=a well-formed prefix is refused; no_claim=that the dev server forwards them
test('proxyPaths accepts one to eight well-formed prefixes', () => {
  // Arrange
  const one = withProxyPaths(['/api'])
  const eight = withProxyPaths([
    '/api',
    '/api/v2',
    '/auth',
    '/graphql',
    '/health',
    '/a-b_c.d',
    '/x/y/z',
    '/uploads',
  ])
  const encoded = withProxyPaths(['/api%20v1', '/api/v1'])
  // Act
  const issues = [one, eight, encoded].map(issuesOf)
  // Assert
  assert.deepEqual(issues, ['accepted', 'accepted', 'accepted'])
})

const PROXY_PATH_REFUSALS: ReadonlyArray<{
  rule: string
  proxyPaths: string[]
  expected: string
}> = [
  {
    rule: 'a trailing slash names the corrected value',
    proxyPaths: ['/api/'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "/api/" must not end with "/"; declare "/api".',
  },
  {
    rule: 'a missing leading slash names the corrected value',
    proxyPaths: ['api'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "api" must start with "/"; declare "/api".',
  },
  {
    rule: 'the root slash',
    proxyPaths: ['/'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "/" is the root, which matches every request; declare the API\'s own prefix, for example "/api".',
  },
  {
    rule: 'an empty entry',
    proxyPaths: [''],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "" is empty; declare a path prefix that starts with "/", for example "/api".',
  },
  {
    rule: 'a wildcard',
    proxyPaths: ['/api/*'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "/api/*" holds "*", "?" or "#"; declare a literal path prefix without a wildcard, query or fragment.',
  },
  {
    rule: 'a query',
    proxyPaths: ['/api?x=1'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "/api?x=1" holds "*", "?" or "#"; declare a literal path prefix without a wildcard, query or fragment.',
  },
  {
    rule: 'a fragment',
    proxyPaths: ['/api#top'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "/api#top" holds "*", "?" or "#"; declare a literal path prefix without a wildcard, query or fragment.',
  },
  {
    rule: 'an entry of 257 characters',
    proxyPaths: [`/${'a'.repeat(256)}`],
    expected: `apiServer.proxyPaths.0: apiServer.proxyPaths[0] "/${'a'.repeat(256)}" is 257 characters long; a prefix holds at most 256.`,
  },
  {
    rule: 'a space in the prefix',
    proxyPaths: ['/api v1'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "/api v1" holds " ", which a URL path does not; write the path as the page sends it (percent-encoded, for example "%20" for a space).',
  },
  {
    rule: 'a newline in the prefix',
    proxyPaths: ['/api\n'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "/api\\n" holds "\\n", which a URL path does not; write the path as the page sends it (percent-encoded, for example "%20" for a space).',
  },
  {
    rule: 'a backslash in the prefix',
    proxyPaths: ['/a\\b'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "/a\\\\b" holds "\\\\", which a URL path does not; write the path as the page sends it (percent-encoded, for example "%20" for a space).',
  },
  {
    rule: 'a malformed percent escape',
    proxyPaths: ['/a%zz'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "/a%zz" holds "%", which a URL path does not; write the path as the page sends it (percent-encoded, for example "%20" for a space).',
  },
  {
    rule: 'only slashes names no corrected value',
    proxyPaths: ['//'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "//" must not end with "/"; declare the API\'s own prefix, for example "/api".',
  },
  {
    rule: 'an empty segment inside the prefix',
    proxyPaths: ['/api//x'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "/api//x" holds an empty segment ("//"), which URL normalization removes before a request reaches the dev server; write the path as the page sends it.',
  },
  {
    rule: 'a dot segment inside the prefix',
    proxyPaths: ['/api/./x'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "/api/./x" holds the segment ".", which URL normalization removes before a request reaches the dev server; write the path as the page sends it.',
  },
  {
    rule: 'a dot-dot segment inside the prefix',
    proxyPaths: ['/a/../b'],
    expected:
      'apiServer.proxyPaths.0: apiServer.proxyPaths[0] "/a/../b" holds the segment "..", which URL normalization removes before a request reaches the dev server; write the path as the page sends it.',
  },
  {
    rule: 'a duplicate names both indexes',
    proxyPaths: ['/api', '/auth', '/api'],
    expected:
      'apiServer.proxyPaths.2: apiServer.proxyPaths[2] "/api" repeats apiServer.proxyPaths[0]; declare each prefix once.',
  },
  {
    rule: 'an empty list',
    proxyPaths: [],
    expected:
      'apiServer.proxyPaths: apiServer.proxyPaths is empty; declare 1 to 8 prefixes or omit it.',
  },
  {
    rule: 'nine entries',
    proxyPaths: ['/a', '/b', '/c', '/d', '/e', '/f', '/g', '/h', '/i'],
    expected:
      'apiServer.proxyPaths: apiServer.proxyPaths declares 9 entries; declare at most 8.',
  },
]

// Value: protects=every malformed proxy prefix is refused as a configuration issue naming apiServer.proxyPaths[i] with its value, the broken rule and the corrected value when derivable; fails_when=a malformed prefix reaches the tracker; no_claim=how the tracker matches prefixes
for (const { rule, proxyPaths, expected } of PROXY_PATH_REFUSALS)
  test(`proxyPaths refuses ${rule} naming apiServer.proxyPaths[i]`, () => {
    // Arrange
    const input = withProxyPaths(proxyPaths)
    // Act
    const issues = issuesOf(input)
    // Assert
    assert.equal(issues, expected)
  })

// Value: protects=proxyPaths is a vite-dev-only key; fails_when=expo-web-dev accepts it or words the refusal differently; no_claim=the Expo run's attribution by API origin
test('proxyPaths on expo-web-dev is refused with the vite-dev-only sentence', () => {
  // Arrange
  const input = configuration({
    adapter: 'expo-web-dev',
    packageRoot: 'apps/app',
    source: { ...API_STOP.source, path: 'apps/app/src/App.tsx' },
    apiServer: {
      ...API_SERVER,
      packageRoot: 'apps/api',
      proxyPaths: ['/api'],
    },
    additionalStops: [
      {
        ...API_STOP,
        source: { ...API_STOP.source, path: 'apps/api/src/handler.ts' },
      },
    ],
  })
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.equal(
    issues,
    "apiServer.proxyPaths: apiServer.proxyPaths is accepted on vite-dev only: Metro does not proxy, and an Expo page calls the API's own origin.",
  )
})

// Value: protects=D14 a server participant on vite-dev without apiServer names apiServer and API 1.38 as the way out; fails_when=the refusal stays the plain browser-only sentence; no_claim=the react-scripts-dev refusal
test('participant server on vite-dev without apiServer names apiServer and API 1.38', () => {
  // Arrange
  const input = configuration({
    apiServer: undefined,
    participant: 'server',
    source: API_STOP.source,
    additionalStops: undefined,
  })
  // Act
  const issues = issuesOf(input)
  // Assert
  assert.equal(
    issues,
    'participant: adapter "vite-dev" supports browser stops only; participant "server" is declared at configuration.participant. To pause in the app\'s own Node API, declare apiServer (API 1.38).',
  )
})

// Value: protects=D44 expo-web-dev keeps refusing an API folder nested in the app folder and equal folders; fails_when=the vite-dev folder rule leaks into expo-web-dev; no_claim=the vite-dev rule
test('expo-web-dev keeps refusing an API folder nested in the app folder and equal folders', () => {
  // Arrange
  const expo = (apiRoot: string) =>
    configuration({
      adapter: 'expo-web-dev',
      packageRoot: 'apps/app',
      source: { ...API_STOP.source, path: 'apps/app/src/App.tsx' },
      apiServer: { ...API_SERVER, packageRoot: apiRoot },
      additionalStops: undefined,
    })
  // Act
  const issues = ['apps/app/api', 'apps/app'].map((root) =>
    issuesOf(expo(root)),
  )
  // Assert
  assert.match(
    issues[0]!,
    /^apiServer\.packageRoot: apiServer\.packageRoot "apps\/app\/api" and the app's packageRoot "apps\/app" must not contain one another/m,
  )
  assert.match(
    issues[1]!,
    /^apiServer\.packageRoot: apiServer\.packageRoot "apps\/app" and the app's packageRoot "apps\/app" must not contain one another/m,
  )
})
