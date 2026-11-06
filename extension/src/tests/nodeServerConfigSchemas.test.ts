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

/** A valid signIn object: the shape the help's sample shows, with placeholder values. */
function validSignIn() {
  return {
    path: '/api/auth/sign-in/email',
    fields: { email: 'learner@example.test' },
    secretField: 'password',
    secret: 'ask-learner',
  }
}

/** Parses a declaration with the given signIn and returns the refusal as `path: message` strings. */
function signInRefusals(signIn: unknown, request?: Record<string, unknown>) {
  const result = nodeServerConfigSchema.safeParse({
    ...minimalGetDeclaration(),
    ...(request ? { request } : {}),
    signIn,
  })
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      )
}

// protects=a configuration with signIn parses and keeps the signIn as declared; fails_when=the optional signIn object is refused or its fields are rewritten; no_claim=that a server accepts the sign-in (no run happens, only the schema parses)
test('a node-server declaration with signIn parses and keeps the signIn as declared', () => {
  // Arrange
  const declaration = { ...minimalGetDeclaration(), signIn: validSignIn() }
  // Act
  const configuration = nodeServerConfigSchema.parse(declaration)
  // Assert
  assert.deepEqual(configuration.signIn, {
    path: '/api/auth/sign-in/email',
    fields: { email: 'learner@example.test' },
    secretField: 'password',
    secret: 'ask-learner',
  })
})

// protects=a declaration without signIn parses exactly as before (no signIn key appears); fails_when=signIn becomes required or gets a default; no_claim=none
test('a node-server declaration without signIn parses with no signIn key', () => {
  // Arrange
  const declaration = minimalGetDeclaration()
  // Act
  const configuration = nodeServerConfigSchema.parse(declaration)
  // Assert
  assert.equal('signIn' in configuration, false)
})

// protects=each signIn refusal names its field path and its exact message; fails_when=a bad path, a missing or oversized field set, a bad key or value, a wrong secret marker is accepted or reported under another path; no_claim=that a server accepts a sign-in (only the schema runs)
test('a node-server signIn is refused with the path of each violation', () => {
  // Arrange
  const nineFields = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [`field${index}`, 'value']),
  )
  const cases: {
    name: string
    signIn: unknown
    path: string
    message: string
  }[] = [
    {
      name: 'bad path',
      signIn: { ...validSignIn(), path: 'api/sign-in' },
      path: 'signIn.path',
      message:
        'expected a path on the server starting with "/", not a URL or "//host".',
    },
    {
      name: 'zero fields',
      signIn: { ...validSignIn(), fields: {} },
      path: 'signIn.fields',
      message: 'expected 1 to 8 non-secret fields.',
    },
    {
      name: 'nine fields',
      signIn: { ...validSignIn(), fields: nineFields },
      path: 'signIn.fields',
      message: 'expected 1 to 8 non-secret fields.',
    },
    {
      name: 'over-long key',
      signIn: { ...validSignIn(), fields: { ['k'.repeat(257)]: 'value' } },
      path: `signIn.fields.${'k'.repeat(257)}`,
      message: 'Invalid key in record',
    },
    {
      name: 'over-long value',
      signIn: { ...validSignIn(), fields: { email: 'v'.repeat(257) } },
      path: 'signIn.fields.email',
      message: 'expected a non-empty string of at most 256 characters.',
    },
    {
      name: 'field named like secretField',
      signIn: {
        ...validSignIn(),
        fields: { pin: 'value' },
        secretField: 'pin',
      },
      path: 'signIn.fields.pin',
      message: 'expected no field named like secretField.',
    },
    {
      name: 'password key',
      signIn: {
        ...validSignIn(),
        fields: { password: 'value' },
        secretField: 'passphrase',
      },
      path: 'signIn.fields.password',
      message:
        'expected a non-secret field: name a password or token field in secretField, so the learner types it.',
    },
    {
      name: 'accessToken key',
      signIn: { ...validSignIn(), fields: { accessToken: 'value' } },
      path: 'signIn.fields.accessToken',
      message:
        'expected a non-secret field: name a password or token field in secretField, so the learner types it.',
    },
    {
      name: 'JWT value',
      signIn: {
        ...validSignIn(),
        fields: { email: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc' },
      },
      path: 'signIn.fields.email',
      message:
        'expected a non-secret value: this one has the shape of a credential.',
    },
    {
      name: 'secret other than ask-learner',
      signIn: { ...validSignIn(), secret: 'hunter2hunter2' },
      path: 'signIn.secret',
      message:
        'expected "ask-learner": the learner types the secret into the editor\'s box.',
    },
  ]
  // Act
  const outcomes = cases.map(({ name, signIn, path, message }) => ({
    name,
    expected: `${path}: ${message}`,
    refusals: signInRefusals(signIn),
  }))
  // Assert
  for (const { name, expected, refusals } of outcomes)
    assert.ok(refusals.includes(expected), `${name}: ${refusals.join(' | ')}`)
})

// protects=a request whose path (query ignored) equals signIn.path is refused at request.path; fails_when=the declared request may be the sign-in itself; no_claim=that other paths are accepted by a real server
test('a node-server request that is the signIn route is refused at request.path', () => {
  // Arrange
  const request = { method: 'GET', path: '/api/auth/sign-in/email?next=1' }
  // Act
  const refusals = signInRefusals(validSignIn(), request)
  // Assert
  assert.deepEqual(refusals, [
    'request.path: expected a request other than the signIn route: Codebook sends the sign-in first, then this request.',
  ])
})

// protects=no signIn refusal quotes the refused value; fails_when=a JWT, a long value or a secret marker appears in a refusal message; no_claim=refusals of other fields
test('a node-server signIn refusal never repeats the refused value', () => {
  // Arrange
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc'
  const longValue = 'v'.repeat(257)
  const marker = 'hunter2hunter2'
  const signIn = {
    path: '/api/auth/sign-in/email',
    fields: { email: jwt, name: longValue, password: 'p4ssw0rd-secret' },
    secretField: 'password2',
    secret: marker,
  }
  // Act
  const text = signInRefusals(signIn).join('\n')
  // Assert
  assert.notEqual(text, '')
  for (const value of [jwt, longValue, marker, 'p4ssw0rd-secret'])
    assert.equal(text.includes(value), false, value)
})

// protects=signIn issues read well in the INVALID_CONFIGURATION cause the agent sees (field path, expectation, help link); fails_when=a signIn issue loses its configuration.signIn path or the help link; no_claim=the MCP error envelope
test('a refused signIn is worded with its configuration path and the help link', () => {
  // Arrange
  const result = nodeServerConfigSchema.safeParse({
    ...minimalGetDeclaration(),
    signIn: {
      ...validSignIn(),
      fields: { password: 'x' },
      secretField: 'passphrase',
    },
  })
  assert.equal(result.success, false)
  // Act
  const description = describeNodeServerConfigurationIssues(
    result.error?.issues ?? [],
  )
  // Assert
  assert.equal(
    description,
    'configuration.signIn.fields.password: expected a non-secret field: name a password or token field in secretField, so the learner types it. See codebook://help/node-server.',
  )
})
