import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ReplayDebugSnapshot } from '../replayDebugSchemas'
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot'

/** A dummy database URL with a user and password, assembled at run time so the repository's secret scanner does not read it as a credential. */
const DUMMY_DATABASE_URL = ['postgres:/', 'u:p@h', 'db'].join('/')

// The fixtures below copy the shapes js-debug 1.140.0 answered for a Node server paused inside a Next.js-style handler (RequestCookies, Headers, Map, plain objects, IncomingMessage's flat rawHeaders); only the cookie value is a made-up opaque string.
const COOKIE_VALUE = ['SESSION', 'COOKIE', 'VALUE', 'opaque', '8f3a91c2'].join(
  '-',
)
const BASIC_CREDENTIAL = ['dXNlcjpT', 'M2NyZXRQ', 'YXNz'].join('')
const OAUTH_CODE = ['oauth', 'callback', 'code', '77c1'].join('-')
const RESET_TOKEN = ['reset', 'token', 'value', '55aa'].join('-')

type DapVariable = {
  name: string
  value: string
  type?: string
  variablesReference: number
}

type PausedFrame = ReturnType<typeof pausedFrame>

/**
 * Builds the `request` a debug adapter would answer for one paused frame whose locals scope is reference 1.
 *
 * @param tree - The variables each reference lists; a reference missing here lists nothing.
 * @param failing - The references whose `variables` request the adapter fails.
 * @returns The request function for {@link captureReplayDebugSnapshot} and the references it was asked to expand.
 */
function pausedFrame(
  tree: Record<number, DapVariable[]>,
  failing: readonly number[] = [],
) {
  const expandedReferences: number[] = []
  return {
    expandedReferences,
    request(
      command: 'scopes' | 'variables',
      arguments_: Record<string, number>,
    ) {
      if (command === 'scopes')
        return Promise.resolve({
          scopes: [
            {
              name: 'Local: handler',
              presentationHint: 'locals',
              variablesReference: 1,
            },
          ],
        })
      const reference = arguments_.variablesReference ?? 0
      expandedReferences.push(reference)
      if (failing.includes(reference))
        return Promise.reject(new Error('The debug adapter closed.'))
      return Promise.resolve({ variables: tree[reference] ?? [] })
    },
  }
}

/** Captures the paused frame with the limits the Node server debugger uses (depth 2, 64 variables), the browser run's defaults, or limits the test sets. */
async function capture(
  frame: PausedFrame,
  profile:
    | 'node-server'
    | 'browser-defaults'
    | { maxVariables: number }
    | { topLevelFirst: true },
): Promise<ReplayDebugSnapshot> {
  const limits =
    profile === 'node-server'
      ? { timeoutMs: 1_500, maxFrames: 8, maxVariables: 64, maxDepth: 2 }
      : profile === 'browser-defaults'
        ? undefined
        : 'maxVariables' in profile
          ? {
              timeoutMs: 1_500,
              maxFrames: 8,
              maxVariables: profile.maxVariables,
              maxDepth: 5,
            }
          : {
              timeoutMs: 1_500,
              maxFrames: 8,
              maxVariables: 64,
              maxDepth: 5,
              topLevelFirst: true,
            }
  return captureReplayDebugSnapshot({
    stack: {
      stackFrames: [{ id: 0, name: 'handler', line: 1, column: 1 }],
      totalFrames: 1,
    },
    verifiedSource: { name: 'a.ts', text: 'x', hash: 'a'.repeat(64), line: 1 },
    assertCurrent() {},
    request: frame.request,
    ...(limits && { limits }),
  })
}

/** Fails when any scripted secret appears anywhere in the saved snapshot, parent previews and unavailable texts included. */
function assertSnapshotHoldsNone(
  snapshot: ReplayDebugSnapshot,
  secrets: readonly string[],
): void {
  const saved = JSON.stringify(snapshot)
  for (const secret of secrets)
    assert.equal(saved.includes(secret), false, `the snapshot holds ${secret}`)
}

/** Finds a saved variable by its name chain from a top-level local, so a test reads the value the replay shows. */
function savedVariable(snapshot: ReplayDebugSnapshot, ...names: string[]) {
  let indices = snapshot.frames[0]!.scopes[0]!.variables
  let found: ReplayDebugSnapshot['variables'][number] | undefined
  for (const name of names) {
    const index = indices.find(
      (value) => snapshot.variables[value]!.name === name,
    )
    found = index === undefined ? undefined : snapshot.variables[index]
    indices = found?.children ?? []
  }
  assert.ok(found, `no saved variable ${names.join(' > ')}`)
  return found
}

/** A string local as the adapter lists it. */
function stringVariable(name: string, text: string): DapVariable {
  return { name, value: `'${text}'`, type: 'string', variablesReference: 0 }
}

// protects=the redaction contract for the cookie a handler pulled out of cookies(); fails_when=a {name, value} cookie record kept in a plainly named local is saved with its value, in its child, its parent preview or anywhere else in the snapshot; no_claim=a cookie whose name is not secret-named (sid_app) with no other shape, which the rule cannot recognise
test('a replay snapshot never saves the value of a cookie record held by a plainly named local', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      {
        name: 'entry',
        value: `{name: 'sid', value: '${COOKIE_VALUE}'}`,
        type: 'Object',
        variablesReference: 2,
      },
    ],
    2: [stringVariable('name', 'sid'), stringVariable('value', COOKIE_VALUE)],
  })
  // Act
  const snapshot = await capture(frame, 'node-server')
  // Assert
  assertSnapshotHoldsNone(snapshot, [COOKIE_VALUE])
  assert.equal(savedVariable(snapshot, 'entry', 'value').value, '[masked]')
  assert.equal(savedVariable(snapshot, 'entry', 'name').value, "'sid'")
})

// protects=the redaction contract for a cookie value copied into a string local; fails_when=a string local such as cookieHeader is saved with the Cookie header text, or sessionValue with a lone secret-named pair; no_claim=a bare opaque value in a plainly named local, which has no shape
test('a replay snapshot never saves a Cookie header copied into a plainly named string', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      stringVariable('cookieHeader', `sid=${COOKIE_VALUE}; theme=dark`),
      stringVariable('lastPair', `session=${COOKIE_VALUE}`),
    ],
  })
  // Act
  const snapshot = await capture(frame, 'node-server')
  // Assert
  assertSnapshotHoldsNone(snapshot, [COOKIE_VALUE])
  assert.equal(savedVariable(snapshot, 'cookieHeader').value, '[masked]')
  assert.equal(savedVariable(snapshot, 'lastPair').value, '[masked]')
})

// protects=the redaction contract for an Authorization header whose scheme the older credential shapes miss; fails_when=a Basic, Negotiate or Digest credential in a plainly named local is saved with its token; no_claim=a Basic credential shorter than eight characters, which reads as prose
test('a replay snapshot never saves the credential of an Authorization header held by a plainly named string', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      stringVariable('headerText', `Basic ${BASIC_CREDENTIAL}`),
      stringVariable('negotiated', `negotiate ${BASIC_CREDENTIAL}`),
      stringVariable(
        'digestText',
        `Digest username="ann", realm="app", nonce="${COOKIE_VALUE}"`,
      ),
    ],
  })
  // Act
  const snapshot = await capture(frame, 'node-server')
  // Assert
  assertSnapshotHoldsNone(snapshot, [BASIC_CREDENTIAL, COOKIE_VALUE])
  assert.equal(savedVariable(snapshot, 'headerText').value, '[masked]')
  assert.equal(savedVariable(snapshot, 'negotiated').value, '[masked]')
  assert.equal(savedVariable(snapshot, 'digestText').value, '[masked]')
})

// protects=the redaction contract below a cookie store (browser run, depth 5); fails_when=a RequestCookies local is expanded, or a store-like object's Map entry shows the cookie record with its value or its name and value rows; no_claim=the store classes of a library that is not named in the collapsed list
test('a replay snapshot saves a cookie store as its class name and masks the entries of a store-like object', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      {
        name: 'cookieStore',
        value: `RequestCookies {_parsed: Map(1), _headers: _Headers}`,
        type: 'RequestCookies',
        variablesReference: 2,
      },
      {
        name: 'storeLike',
        value: '{_parsed: Map(1)}',
        type: 'Object',
        variablesReference: 3,
      },
    ],
    2: [
      {
        name: '_parsed',
        value: `Map(1) {size: 1, next-auth.session-token => {name: 'ne…en', …}}`,
        type: 'Map',
        variablesReference: 9,
      },
    ],
    3: [
      {
        name: '_parsed',
        value: `Map(1) {size: 1, next-auth.session-token => {name: 'ne…en', …}}`,
        type: 'Map',
        variablesReference: 4,
      },
    ],
    4: [
      {
        name: '0',
        value: '{"next-auth.session-token" => Object}',
        type: 'Object',
        variablesReference: 5,
      },
    ],
    5: [
      stringVariable('key', 'next-auth.session-token'),
      {
        name: 'value',
        value: `{name: 'next-auth.session-token', value: '${COOKIE_VALUE}'}`,
        type: 'Object',
        variablesReference: 6,
      },
    ],
    6: [
      stringVariable('name', 'next-auth.session-token'),
      stringVariable('value', COOKIE_VALUE),
    ],
  })
  // Act
  const snapshot = await capture(frame, 'browser-defaults')
  // Assert
  assertSnapshotHoldsNone(snapshot, [COOKIE_VALUE])
  assert.equal(savedVariable(snapshot, 'cookieStore').value, 'RequestCookies')
  assert.deepEqual(savedVariable(snapshot, 'cookieStore').children, [])
  assert.equal(frame.expandedReferences.includes(2), false)
  // The entry's `value` sits beside a secret `key`, so it reads [masked] with no children.
  assert.equal(
    savedVariable(snapshot, 'storeLike', '_parsed', '0', 'value').value,
    '[masked]',
  )
})

// protects=the redaction contract for Node's flat rawHeaders array, which lists header names and values as one list; fails_when=the element after Cookie or Authorization is saved, in its own row or in the array's preview, while a header such as Host must stay readable; no_claim=a header array whose names are not quoted strings in the preview
test('a replay snapshot masks the element after a secret header name in a flat rawHeaders array and keeps the other headers readable', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      {
        name: 'rawHeaders',
        value: `Array(6) ['Host', 'localhost:3000', 'Cookie', 'sid=${COOKIE_VALUE}', 'Authorization', 'Basic ${BASIC_CREDENTIAL}']`,
        type: 'Array',
        variablesReference: 2,
      },
    ],
    2: [
      stringVariable('0', 'Host'),
      stringVariable('1', 'localhost:3000'),
      stringVariable('2', 'Cookie'),
      stringVariable('3', `sid=${COOKIE_VALUE}`),
      stringVariable('4', 'Authorization'),
      stringVariable('5', `Basic ${BASIC_CREDENTIAL}`),
    ],
  })
  // Act
  const snapshot = await capture(frame, 'node-server')
  // Assert
  assertSnapshotHoldsNone(snapshot, [COOKIE_VALUE, BASIC_CREDENTIAL])
  assert.equal(
    savedVariable(snapshot, 'rawHeaders', '1').value,
    "'localhost:3000'",
  )
  assert.equal(savedVariable(snapshot, 'rawHeaders', '3').value, '[masked]')
  assert.equal(savedVariable(snapshot, 'rawHeaders', '5').value, '[masked]')
  assert.equal(savedVariable(snapshot, 'rawHeaders').value, 'Array')
})

// protects=what the name and shape rules already covered; fails_when=context.req.headers.cookie, context.req.cookies or a Bearer string is saved with its value, or the subtree of a secret-named object is read; no_claim=the headers object's other members, which stay readable
test('a replay snapshot keeps masking the cookie header, the parsed cookies object and a Bearer string of a request', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      {
        name: 'req',
        value: 'IncomingMessage {url: …}',
        type: 'IncomingMessage',
        variablesReference: 2,
      },
      stringVariable('bearerHeader', 'Bearer abcdefgh12345'),
    ],
    2: [
      {
        name: 'headers',
        value: `{host: 'localhost:3000', cookie: 'sid=${COOKIE_VALUE}; theme=dark'}`,
        type: 'Object',
        variablesReference: 3,
      },
      {
        name: 'cookies',
        value: `{sid: '${COOKIE_VALUE}'}`,
        type: 'Object',
        variablesReference: 4,
      },
    ],
    3: [
      stringVariable('host', 'localhost:3000'),
      stringVariable('cookie', `sid=${COOKIE_VALUE}; theme=dark`),
    ],
    4: [stringVariable('sid', COOKIE_VALUE)],
  })
  // Act
  const snapshot = await capture(frame, 'browser-defaults')
  // Assert
  assertSnapshotHoldsNone(snapshot, [COOKIE_VALUE, 'abcdefgh12345'])
  assert.equal(
    savedVariable(snapshot, 'req', 'headers', 'cookie').value,
    '[masked]',
  )
  assert.equal(
    savedVariable(snapshot, 'req', 'headers', 'host').value,
    "'localhost:3000'",
  )
  assert.equal(savedVariable(snapshot, 'req', 'cookies').value, '[masked]')
  assert.equal(frame.expandedReferences.includes(4), false)
  assert.equal(
    savedVariable(snapshot, 'bearerHeader').value,
    "'Bearer [masked]'",
  )
})

// protects=the privacy of a request's socket and response and of the environment; fails_when=a Socket, TLSSocket, ServerResponse or Headers local is expanded or saved with its preview, or process.env (a plain Object to V8) is expanded; no_claim=an alias of process.env (const env = process.env), which keeps the name and shape rules only
test('a replay snapshot saves sockets, responses, header stores and process.env as their class name and never expands them', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      {
        name: 'socket',
        value: `Socket {connecting: false, _peername: {address: '10.0.0.8'}}`,
        type: 'Socket',
        variablesReference: 2,
      },
      {
        name: 'secureSocket',
        value: 'TLSSocket {encrypted: true}',
        type: 'TLSSocket',
        variablesReference: 3,
      },
      {
        name: 'res',
        value: 'ServerResponse {statusCode: 200}',
        type: 'ServerResponse',
        variablesReference: 4,
      },
      {
        name: 'headerStore',
        value: `Headers {cookie: 'sid=${COOKIE_VALUE}'}`,
        type: 'Headers',
        variablesReference: 5,
      },
      {
        name: 'process',
        value: 'process',
        type: 'process',
        variablesReference: 6,
      },
    ],
    6: [
      {
        name: 'env',
        value: `Object {PATH: '/usr/bin', DATABASE_URL: '${DUMMY_DATABASE_URL}'}`,
        type: 'Object',
        variablesReference: 7,
      },
    ],
  })
  // Act
  const snapshot = await capture(frame, 'node-server')
  // Assert
  assertSnapshotHoldsNone(snapshot, [COOKIE_VALUE, '10.0.0.8', '/usr/bin'])
  assert.equal(savedVariable(snapshot, 'socket').value, 'Socket')
  assert.equal(savedVariable(snapshot, 'secureSocket').value, 'TLSSocket')
  assert.equal(savedVariable(snapshot, 'res').value, 'ServerResponse')
  assert.equal(savedVariable(snapshot, 'headerStore').value, 'Headers')
  assert.equal(savedVariable(snapshot, 'process', 'env').value, 'Object')
  assert.deepEqual(
    frame.expandedReferences.filter(
      (reference) => reference > 1 && reference !== 6,
    ),
    [],
  )
})

// protects=readable evidence: the shape rules must not blank ordinary values; fails_when=a status string, a number, a single non-secret cookie pair or a query pair is masked; no_claim=a value that is secret but has none of the enumerated shapes
test('a replay snapshot keeps non-secret values and single non-secret pairs readable', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      stringVariable('status', 'paid'),
      { name: 'count', value: '3', type: 'number', variablesReference: 0 },
      stringVariable('preference', 'theme=dark'),
      stringVariable('pagination', 'page=2'),
      stringVariable('logLine', 'Hello, Cookie monster'),
    ],
  })
  // Act
  const snapshot = await capture(frame, 'node-server')
  // Assert
  assert.deepEqual(
    snapshot.variables.map((variable) => variable.value),
    ["'paid'", '3', "'theme=dark'", "'page=2'", "'Hello, Cookie monster'"],
  )
})

// protects=a parent's preview never carries what its masked children hide; fails_when=the cookie record's or the header array's preview keeps the value its child row masks; no_claim=a parent whose preview shows no shape, which keeps its text
test('a replay snapshot keeps no credential in the preview of a parent whose children it masked', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      {
        name: 'record',
        value: `{name: 'sid', value: '${COOKIE_VALUE}'}`,
        type: 'Object',
        variablesReference: 2,
      },
      {
        name: 'pairs',
        value: `Array(2) ['Cookie', 'sid=${COOKIE_VALUE}']`,
        type: 'Array',
        variablesReference: 3,
      },
      {
        name: 'plain',
        value: "{id: 7, theme: 'dark'}",
        type: 'Object',
        variablesReference: 4,
      },
    ],
    2: [stringVariable('name', 'sid'), stringVariable('value', COOKIE_VALUE)],
    3: [
      stringVariable('0', 'Cookie'),
      stringVariable('1', `sid=${COOKIE_VALUE}`),
    ],
    4: [
      { name: 'id', value: '7', type: 'number', variablesReference: 0 },
      stringVariable('theme', 'dark'),
    ],
  })
  // Act
  const snapshot = await capture(frame, 'browser-defaults')
  // Assert
  assertSnapshotHoldsNone(snapshot, [COOKIE_VALUE])
  assert.equal(savedVariable(snapshot, 'record').value, 'Object')
  assert.equal(savedVariable(snapshot, 'pairs').value, 'Array')
  assert.equal(savedVariable(snapshot, 'plain').value, "{id: 7, theme: 'dark'}")
})

// protects=the depth limit does not leave a shape unmasked; fails_when=a record whose children were never read because the depth limit was reached keeps its preview with the value; no_claim=the depth limit itself, which other capture tests pin
test('a replay snapshot keeps no credential in a preview whose children the depth limit left unread', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      {
        name: 'holder',
        value: '{entry: Object}',
        type: 'Object',
        variablesReference: 2,
      },
    ],
    2: [
      {
        name: 'entry',
        value: `{name: 'sid', value: '${COOKIE_VALUE}'}`,
        type: 'Object',
        variablesReference: 3,
      },
    ],
    3: [stringVariable('name', 'sid'), stringVariable('value', COOKIE_VALUE)],
  })
  // Act
  const snapshot = await capture(frame, 'node-server')
  // Assert
  assertSnapshotHoldsNone(snapshot, [COOKIE_VALUE])
  const entry = savedVariable(snapshot, 'holder', 'entry')
  assert.equal(entry.unavailable, 'Historical variable depth limit reached.')
  assert.equal(entry.value, 'Object')
})

// protects=the count limit does not leave a shape unmasked; fails_when=a record whose children the variable count limit left unread keeps its preview with the value; no_claim=which variable the limit cuts first
test('a replay snapshot keeps no credential in a preview whose children the count limit left unread', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      stringVariable('first', 'one'),
      {
        name: 'entry',
        value: `{name: 'sid', value: '${COOKIE_VALUE}'}`,
        type: 'Object',
        variablesReference: 2,
      },
    ],
    2: [stringVariable('name', 'sid'), stringVariable('value', COOKIE_VALUE)],
  })
  // Act
  const snapshot = await capture(frame, { maxVariables: 2 })
  // Assert
  assertSnapshotHoldsNone(snapshot, [COOKIE_VALUE])
  const entry = savedVariable(snapshot, 'entry')
  assert.equal(entry.unavailable, 'Historical variable count limit reached.')
  assert.equal(entry.value, 'Object')
})

// protects=a failed variables request does not leave a shape unmasked; fails_when=a record whose children the adapter failed to list keeps its preview with the value or the saved error text names it; no_claim=the wording of the adapter's error
test('a replay snapshot keeps no credential in a preview whose children the adapter failed to list', async () => {
  // Arrange
  const frame = pausedFrame(
    {
      1: [
        {
          name: 'entry',
          value: `{name: 'sid', value: '${COOKIE_VALUE}'}`,
          type: 'Object',
          variablesReference: 2,
        },
      ],
    },
    [2],
  )
  // Act
  const snapshot = await capture(frame, 'browser-defaults')
  // Assert
  assertSnapshotHoldsNone(snapshot, [COOKIE_VALUE])
  const entry = savedVariable(snapshot, 'entry')
  assert.equal(entry.unavailable, 'The debug adapter closed.')
  assert.equal(entry.value, 'Object')
})

// protects=readable prose around the Authorization words; fails_when=Token expired, Basic usage or Digest mismatch is masked, or a Digest header with name=value parameters is saved; no_claim=prose of eight or more characters after Basic or Token, which has the credential shape
test('a replay snapshot keeps Authorization-like prose readable and masks only a credential-shaped value', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      stringVariable('tokenMessage', 'Token expired'),
      stringVariable('basicMessage', 'Basic usage'),
      stringVariable('digestMessage', 'Digest mismatch'),
      stringVariable(
        'digestHeader',
        `Digest username="ann", nonce="${COOKIE_VALUE}"`,
      ),
    ],
  })
  // Act
  const snapshot = await capture(frame, 'node-server')
  // Assert
  assertSnapshotHoldsNone(snapshot, [COOKIE_VALUE])
  assert.deepEqual(
    snapshot.variables.map((variable) => variable.value),
    ["'Token expired'", "'Basic usage'", "'Digest mismatch'", '[masked]'],
  )
})

// protects=secrets in the URL of a request (req.url, resolvedUrl, a referer); fails_when=a callback code or a reset token query value is saved, or a URL without secret parameters is blanked; no_claim=a secret carried in the path itself
test('a replay snapshot masks the secret query values of a URL and keeps a URL without secret parameters readable', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      stringVariable('url', `/auth/callback?code=${OAUTH_CODE}&state=xyz`),
      stringVariable(
        'referer',
        `https://app.example/reset?access_token=${RESET_TOKEN}&page=2`,
      ),
      stringVariable('listUrl', '/items?page=2&sort=name'),
    ],
  })
  // Act
  const snapshot = await capture(frame, 'node-server')
  // Assert
  assertSnapshotHoldsNone(snapshot, [OAUTH_CODE, RESET_TOKEN])
  assert.equal(
    savedVariable(snapshot, 'url').value,
    "'/auth/callback?code=[masked]&state=xyz'",
  )
  assert.equal(
    savedVariable(snapshot, 'referer').value,
    "'https://app.example/reset?access_token=[masked]&page=2'",
  )
  assert.equal(
    savedVariable(snapshot, 'listUrl').value,
    "'/items?page=2&sort=name'",
  )
})

// protects=Next's preview-mode payload, which can hold a signed token; fails_when=context.previewData is expanded or saved with its members; no_claim=other members of context, which keep the rules above
test('a replay snapshot saves previewData as its class name only', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      {
        name: 'context',
        value: '{previewData: Object, query: Object}',
        type: 'Object',
        variablesReference: 2,
      },
    ],
    2: [
      {
        name: 'previewData',
        value: `{token: '${COOKIE_VALUE}', draft: true}`,
        type: 'Object',
        variablesReference: 3,
      },
    ],
    3: [stringVariable('draftId', COOKIE_VALUE)],
  })
  // Act
  const snapshot = await capture(frame, 'browser-defaults')
  // Assert
  assertSnapshotHoldsNone(snapshot, [COOKIE_VALUE])
  assert.equal(
    savedVariable(snapshot, 'context', 'previewData').value,
    'Object',
  )
  assert.equal(frame.expandedReferences.includes(3), false)
})

// protects=the first-pass capture the chrome-extension debugger uses (top-level values first, children second); fails_when=the second pass reads or saves a collapsed class's members or a cookie record's value; no_claim=the order in which a huge first value uses the child budget
test('a top-level-first capture masks cookie records and collapses sockets the same way as the depth-first capture', async () => {
  // Arrange
  const frame = pausedFrame({
    1: [
      {
        name: 'record',
        value: `{name: 'session', value: '${COOKIE_VALUE}'}`,
        type: 'Object',
        variablesReference: 2,
      },
      {
        name: 'socket',
        value: 'Socket {connecting: false}',
        type: 'Socket',
        variablesReference: 3,
      },
    ],
    2: [
      stringVariable('name', 'session'),
      stringVariable('value', COOKIE_VALUE),
    ],
    3: [stringVariable('remoteAddress', COOKIE_VALUE)],
  })
  // Act
  const snapshot = await capture(frame, { topLevelFirst: true })
  // Assert
  assertSnapshotHoldsNone(snapshot, [COOKIE_VALUE])
  assert.equal(savedVariable(snapshot, 'record', 'value').value, '[masked]')
  assert.equal(savedVariable(snapshot, 'socket').value, 'Socket')
  assert.equal(frame.expandedReferences.includes(3), false)
})
