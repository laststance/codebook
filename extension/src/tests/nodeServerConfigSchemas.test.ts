import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nodeServerConfigSchema } from '../nodeServerConfigSchemas'
import { describeNodeServerConfigurationIssues } from '../utils/describeNodeServerConfigurationIssues'

import { createConfiguredStudy } from './utils/createConfiguredStudy'

/** A minimal node-server declaration: one GET to a TypeScript entry at the repository root. */
function minimalGetDeclaration() {
  const browser = createConfiguredStudy().configuration
  return {
    version: 1,
    adapter: 'node-server',
    book: browser.book,
    entry: 'src/server.ts',
    port: 4100,
    request: { method: 'GET', path: '/api/healthz' },
    source: {
      path: 'src/app.ts',
      hash: browser.source.hash,
      line: 54,
      column: 1,
    },
    inspections: [{ path: 'c.req.path', mode: 'value', required: true }],
  }
}

test('a node-server GET declaration runs its TypeScript entry from the repository root through tsx', () => {
  // protects: the defaults the launcher relies on; fails_when: packageRoot or loader lose their defaults; no_claim: the loader exists on disk.
  // Arrange
  const declaration = minimalGetDeclaration()
  // Act
  const configuration = nodeServerConfigSchema.parse(declaration)
  // Assert
  assert.equal(configuration.packageRoot, '.')
  assert.equal(configuration.loader, 'tsx')
  assert.deepEqual(configuration.request, {
    method: 'GET',
    path: '/api/healthz',
  })
})

test('a node-server JavaScript entry runs with plain node unless the declaration names tsx', () => {
  // protects: the loader default by entry extension; fails_when: a .mjs entry is sent through tsx by default; no_claim: tsx can run it.
  // Arrange
  const javascriptEntry = { ...minimalGetDeclaration(), entry: 'server.mjs' }
  const javascriptThroughTsx = { ...javascriptEntry, loader: 'tsx' }
  // Act
  const plain = nodeServerConfigSchema.parse(javascriptEntry)
  const throughTsx = nodeServerConfigSchema.parse(javascriptThroughTsx)
  // Assert
  assert.equal(plain.loader, 'node')
  assert.equal(throughTsx.loader, 'tsx')
})

test('a monorepo node-server declaration names its package root and an entry relative to it', () => {
  // protects: monorepo servers (switch-time apps/api); fails_when: packageRoot is refused or rewritten; no_claim: the folder exists.
  // Arrange
  const declaration = { ...minimalGetDeclaration(), packageRoot: 'apps/api' }
  // Act
  const configuration = nodeServerConfigSchema.parse(declaration)
  // Assert
  assert.equal(configuration.packageRoot, 'apps/api')
  assert.equal(configuration.entry, 'src/server.ts')
})

test('a node-server POST declaration sends a JSON body with its content type', () => {
  // protects: state-changing requests with a body; fails_when: a JSON body under the limit is refused; no_claim: the request is sent.
  // Arrange
  const declaration = {
    ...minimalGetDeclaration(),
    request: {
      method: 'POST',
      path: '/api/auth/sign-in/email',
      contentType: 'application/json',
      body: '{"email":"nobody@example.com","password":"not-the-password"}',
    },
  }
  // Act
  const configuration = nodeServerConfigSchema.parse(declaration)
  // Assert
  assert.deepEqual(configuration.request, {
    method: 'POST',
    path: '/api/auth/sign-in/email',
    contentType: 'application/json',
    body: '{"email":"nobody@example.com","password":"not-the-password"}',
  })
})

test('a node-server request path keeps a query string, also one with an encoded slash', () => {
  // protects: ordinary query strings; fails_when: a query is refused for the path component's rules; no_claim: the server accepts it.
  // Arrange
  const declaration = {
    ...minimalGetDeclaration(),
    request: { method: 'GET', path: '/api/post_list?page=1&next=%2Fhome' },
  }
  // Act
  const result = nodeServerConfigSchema.safeParse(declaration)
  // Assert
  assert.equal(result.success, true)
})

test('a node-server request cannot leave the declared server or walk its path', () => {
  // protects: "no arbitrary requests": the request goes to the declared server's own path only; fails_when: any listed path parses; no_claim: the server's routing.
  // Arrange
  const refusedPaths = [
    'api/healthz',
    'http://localhost:4100/api/healthz',
    '//evil.example/api',
    '/api/healthz#fragment',
    '/api/../admin',
    '/api/%2e%2e/admin',
    '/api/%2E%2E/admin',
    '/api%2fadmin',
    '/api%5Cadmin',
    '/api\\admin',
    '/api/healthz\r\nX-Injected: 1',
    '/api/\u0000',
    '/api/health z',
    '/api/café',
    `/${'a'.repeat(2_048)}`,
  ]
  // Act
  const outcomes = refusedPaths.map((path) => {
    const result = nodeServerConfigSchema.safeParse({
      ...minimalGetDeclaration(),
      request: { method: 'GET', path },
    })
    return {
      path,
      success: result.success,
      issuePaths: result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join('.')),
    }
  })
  // Assert
  for (const outcome of outcomes) {
    assert.equal(
      outcome.success,
      false,
      `parsed: ${JSON.stringify(outcome.path)}`,
    )
    assert.deepEqual(outcome.issuePaths, ['request.path'])
  }
})

test('a node-server request body needs a content type, stays within 16,384 bytes and never rides on a GET or DELETE', () => {
  // protects: the bounded request body; fails_when: any listed body rule parses; no_claim: the server reads the body.
  // Arrange
  const base = minimalGetDeclaration()
  const refusedRequests = [
    { method: 'GET', path: '/api/items', contentType: 'text/plain', body: 'x' },
    {
      method: 'DELETE',
      path: '/api/items/1',
      contentType: 'text/plain',
      body: 'x',
    },
    { method: 'POST', path: '/api/items', body: 'x' },
    { method: 'POST', path: '/api/items', contentType: 'application/json' },
    {
      method: 'PUT',
      path: '/api/items/1',
      contentType: 'text/plain',
      body: 'あ'.repeat(5_462),
    },
  ]
  // Act
  const outcomes = refusedRequests.map(
    (request) => nodeServerConfigSchema.safeParse({ ...base, request }).success,
  )
  const largestAccepted = nodeServerConfigSchema.safeParse({
    ...base,
    request: {
      method: 'PATCH',
      path: '/api/items/1',
      contentType: 'text/plain',
      body: 'a'.repeat(16_384),
    },
  }).success
  // Assert
  assert.deepEqual(outcomes, [false, false, false, false, false])
  assert.equal(largestAccepted, true)
})

test('a node-server port is the server own port from 1024 to 65535', () => {
  // protects: "no arbitrary ports"; fails_when: a privileged, fractional or out-of-range port parses; no_claim: the server listens there.
  // Arrange
  const base = minimalGetDeclaration()
  // Act
  const outcomes = [80, 1023, 1024, 65_535, 65_536, 4100.5, 0].map(
    (port) => nodeServerConfigSchema.safeParse({ ...base, port }).success,
  )
  // Assert
  assert.deepEqual(outcomes, [false, false, true, true, false, false, false])
})

test('a node-server entry is a script inside its package root that node cannot read as an option', () => {
  // protects: the launch argv; fails_when: an option-like, non-script or traversing entry parses; no_claim: the file exists.
  // Arrange
  const base = minimalGetDeclaration()
  const refusedEntries = [
    '--inspect=0.0.0.0:9229',
    '-e.ts',
    'src/server.json',
    '../server.ts',
    '/srv/server.ts',
    'src/server',
  ]
  // Act
  const outcomes = refusedEntries.map(
    (entry) => nodeServerConfigSchema.safeParse({ ...base, entry }).success,
  )
  const acceptedExtensions = [
    'a.ts',
    'a.mts',
    'a.cts',
    'a.js',
    'a.mjs',
    'a.cjs',
  ].map((entry) => nodeServerConfigSchema.safeParse({ ...base, entry }).success)
  // Assert
  assert.deepEqual(outcomes, [false, false, false, false, false, false])
  assert.deepEqual(acceptedExtensions, [true, true, true, true, true, true])
})

test('a TypeScript node-server entry cannot be declared to run with plain node', () => {
  // protects: the loader rule; fails_when: a .ts entry with loader node parses; no_claim: node's own type stripping.
  // Arrange
  const declaration = { ...minimalGetDeclaration(), loader: 'node' }
  // Act
  const result = nodeServerConfigSchema.safeParse(declaration)
  // Assert
  assert.equal(result.success, false)
  assert.deepEqual(
    result.error?.issues.map((issue) => issue.path.join('.')),
    ['loader'],
  )
})

test('a node-server declaration has no command, environment or arbitrary adapter', () => {
  // protects: "no arbitrary commands"; fails_when: an extra field or another adapter parses; no_claim: none.
  // Arrange
  const base = minimalGetDeclaration()
  // Act
  const outcomes = [
    { ...base, command: 'pnpm dev' },
    { ...base, env: { PORT: '4100' } },
    { ...base, nodeArgs: ['--inspect=0.0.0.0'] },
    { ...base, adapter: 'shell' },
  ].map((declaration) => nodeServerConfigSchema.safeParse(declaration).success)
  // Assert
  assert.deepEqual(outcomes, [false, false, false, false])
})

test('a node-server declaration keeps at most seven additional stops, each with a required value', () => {
  // protects: the shared stop bound and the value rule; fails_when: eight additional stops or a type-only stop parse; no_claim: the stops bind.
  // Arrange
  const base = minimalGetDeclaration()
  const additionalStop = {
    ...base.source,
    line: 60,
    anchorIndex: 0,
    inspections: [{ path: 'values', mode: 'value', required: true }],
  }
  const typeOnlyStop = {
    ...additionalStop,
    inspections: [{ path: 'values', mode: 'type', required: true }],
  }
  // Act
  const sevenStops = nodeServerConfigSchema.safeParse({
    ...base,
    additionalStops: Array.from({ length: 7 }, () => additionalStop),
  }).success
  const eightStops = nodeServerConfigSchema.safeParse({
    ...base,
    additionalStops: Array.from({ length: 8 }, () => additionalStop),
  }).success
  const typeOnly = nodeServerConfigSchema.safeParse({
    ...base,
    additionalStops: [typeOnlyStop],
  }).success
  // Assert
  assert.equal(sevenStops, true)
  assert.equal(eightStops, false)
  assert.equal(typeOnly, false)
})

test('a refused node-server declaration lists every violation with its field and expected value and names the help', () => {
  // protects: INVALID_CONFIGURATION's cause for node-server; fails_when: a violation is missing, unnamed or the help link is gone; no_claim: the MCP error envelope (pt2).
  // Arrange
  const declaration = {
    ...minimalGetDeclaration(),
    port: 80,
    request: { method: 'GET', path: '/api/../admin' },
  }
  const result = nodeServerConfigSchema.safeParse(declaration)
  assert.equal(result.success, false)
  // Act
  const description = describeNodeServerConfigurationIssues(
    result.error?.issues ?? [],
  )
  // Assert
  assert.equal(
    description,
    'configuration.port: expected an integer from 1024 to 65535, the port the server\'s own code listens on. configuration.request.path: expected a path on the server starting with "/", without ".." segments. See codebook://help/node-server.',
  )
})
