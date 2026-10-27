import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { test } from 'node:test'

import { z } from 'zod'

import { StudyError } from '../errors'
import { sendDeclaredRequest } from '../utils/sendDeclaredRequest'

import { startFixtureServer } from './utils/startFixtureServer'

/** The fixture's `/echo` answer. */
const echoSchema = z.object({
  method: z.string(),
  headers: z.record(z.string(), z.unknown()),
  rawHeaderNames: z.array(z.string()),
  body: z.string(),
})

/** A peer check that accepts every connection. */
const acceptPeer = async (): Promise<void> => undefined

// protects=a GET reaches the server and its 200 JSON comes back shaped; fails_when=the sender cannot complete a plain request; no_claim=HTTPS
test('a GET is sent over one connection and its JSON response is observed', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  // Act
  const { written, response } = sendDeclaredRequest({
    host: '127.0.0.1',
    port: server.port,
    request: { method: 'GET', path: '/health' },
    runId: 'run-1',
    verifyPeer: acceptPeer,
    signal: new AbortController().signal,
  })
  await written
  const observed = await response
  // Assert
  assert.equal(observed.status, 200)
  assert.equal(observed.contentType, 'application/json')
  assert.equal(observed.body, '{"status":"ok"}')
  assert.equal(observed.readCut, false)
})

// protects=the exact headers and body the server sees (TD-6 safety, identity of the run); fails_when=a header is missing, Expect is sent, or the body is altered; no_claim=header order
test('a POST with a JSON body carries the declared headers, the run id and its exact body', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  // Act
  const { response } = sendDeclaredRequest({
    host: '127.0.0.1',
    port: server.port,
    request: {
      method: 'POST',
      path: '/echo?x=1',
      contentType: 'application/json',
      body: '{"name":"ひらがな"}',
    },
    runId: 'run-42',
    verifyPeer: acceptPeer,
    signal: new AbortController().signal,
  })
  const echoed = echoSchema.parse(JSON.parse((await response).body))
  // Assert
  assert.equal(echoed.method, 'POST')
  assert.equal(echoed.body, '{"name":"ひらがな"}')
  assert.equal(echoed.headers.host, `localhost:${server.port}`)
  assert.equal(echoed.headers['accept-encoding'], 'identity')
  assert.equal(echoed.headers.connection, 'close')
  assert.equal(echoed.headers['user-agent'], 'codebook')
  assert.equal(echoed.headers['x-codebook-run'], 'run-42')
  assert.equal(echoed.headers['content-type'], 'application/json')
  assert.equal(echoed.headers['content-length'], '23')
  assert.equal(echoed.headers.expect, undefined)
})

// protects=a body over 1 MiB is cut and the socket destroyed; fails_when=more than 1 MiB is kept or readCut is false; no_claim=memory use of the server
test('a response over 1 MiB is read to the limit and reported cut', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  // Act
  const { response } = sendDeclaredRequest({
    host: '127.0.0.1',
    port: server.port,
    request: { method: 'GET', path: '/big' },
    runId: 'run-1',
    verifyPeer: acceptPeer,
    signal: new AbortController().signal,
  })
  const observed = await response
  // Assert
  assert.equal(observed.status, 200)
  assert.equal(observed.bodyBytes, 1_048_576)
  assert.equal(observed.readCut, true)
  assert.match(
    observed.body,
    / … at least 1040384 more bytes \(cut at 1 MiB\)$/,
  )
})

// protects=3xx is the observation, never followed, and its Location is bounded; fails_when=the sender follows or relays another origin; no_claim=cookies
test('a redirect is the response and its Location shows a path or a note', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  const send = (path: string) =>
    sendDeclaredRequest({
      host: '127.0.0.1',
      port: server.port,
      request: { method: 'GET', path },
      runId: 'run-1',
      verifyPeer: acceptPeer,
      signal: new AbortController().signal,
    }).response
  // Act
  const same = await send('/redirect-same')
  const other = await send('/redirect-other')
  // Assert
  assert.deepEqual(
    [same.status, same.location, other.status, other.location],
    [302, '/health', 302, '(another origin)'],
  )
})

// protects=4xx is an observed response not a failure; fails_when=404 rejects; no_claim=5xx specifics
test('a 404 resolves as a response', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  // Act
  const observed = await sendDeclaredRequest({
    host: '127.0.0.1',
    port: server.port,
    request: { method: 'GET', path: '/missing' },
    runId: 'run-1',
    verifyPeer: acceptPeer,
    signal: new AbortController().signal,
  }).response
  // Assert
  assert.equal(observed.status, 404)
})

// protects=a reset before any response is REQUEST_FAILED and never retried; fails_when=the sender hangs, retries or throws another error; no_claim=the wording
test('a connection reset before a response rejects with REQUEST_FAILED and sends once', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  // Act
  const { response } = sendDeclaredRequest({
    host: '127.0.0.1',
    port: server.port,
    request: { method: 'GET', path: '/reset' },
    runId: 'run-1',
    verifyPeer: acceptPeer,
    signal: new AbortController().signal,
  })
  // Assert
  await assert.rejects(
    response,
    (error: unknown) =>
      error instanceof StudyError && error.code === 'REQUEST_FAILED',
  )
  const afterwards = await sendDeclaredRequest({
    host: '127.0.0.1',
    port: server.port,
    request: { method: 'GET', path: '/echo' },
    runId: 'run-1',
    verifyPeer: acceptPeer,
    signal: new AbortController().signal,
  }).response
  assert.equal(afterwards.status, 200)
})

// protects=nothing is written to a peer the run refuses (TD-6 / listener ownership); fails_when=any byte reaches the server after verifyPeer throws; no_claim=how the run words the refusal
test('a refused peer receives zero bytes and written rejects with the refusal', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  const refusal = new StudyError(
    'LISTENER_NOT_OWNED',
    'not the launched server',
  )
  let seen: { localPort: number; remotePort: number } | undefined
  // Act
  const { written, response } = sendDeclaredRequest({
    host: '127.0.0.1',
    port: server.port,
    request: {
      method: 'POST',
      path: '/echo',
      contentType: 'text/plain',
      body: 'do not send',
    },
    runId: 'run-1',
    verifyPeer: async (connection) => {
      seen = connection
      throw refusal
    },
    signal: new AbortController().signal,
  })
  // Assert
  await assert.rejects(written, refusal)
  await assert.rejects(response, refusal)
  assert.equal(seen?.remotePort, server.port)
  const counted = await sendDeclaredRequest({
    host: '127.0.0.1',
    port: server.port,
    request: { method: 'GET', path: '/received-bytes' },
    runId: 'run-1',
    verifyPeer: acceptPeer,
    signal: new AbortController().signal,
  }).response
  assert.equal(counted.body, '{"bytes":0}')
})

// protects=the run's deadline stops the request; fails_when=abort leaves the socket open or resolves; no_claim=REQUEST_TIMEOUT mapping (the run's)
test('aborting the signal destroys the request and rejects with the abort reason', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  const controller = new AbortController()
  const reason = new Error('request deadline')
  // Act
  const { response } = sendDeclaredRequest({
    host: '127.0.0.1',
    port: server.port,
    request: { method: 'GET', path: '/health' },
    runId: 'run-1',
    verifyPeer: async () => {
      controller.abort(reason)
    },
    signal: controller.signal,
  })
  // Assert
  await assert.rejects(response, reason)
})

// protects=a server's Content-Type cannot carry a credential or unbounded text into the chat; fails_when=the header is returned raw; no_claim=body redaction (covered)
test('a response Content-Type is redacted and bounded to 256 characters', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  // Act
  const observed = await sendDeclaredRequest({
    host: '127.0.0.1',
    port: server.port,
    request: { method: 'GET', path: '/odd-content-type' },
    runId: 'run-1',
    verifyPeer: acceptPeer,
    signal: new AbortController().signal,
  }).response
  // Assert
  assert.equal(
    observed.contentType,
    `text/plain; note=[masked];${'x'.repeat(230)}`,
  )
})

// protects=the run-lifetime signal does not keep a settled request alive; fails_when=the abort listener stays after the response or a refusal; no_claim=listener count of other code
test('the abort listener is removed once the request settles', async (t) => {
  // Arrange
  const server = await startFixtureServer(t)
  const controller = new AbortController()
  // Act
  await sendDeclaredRequest({
    host: '127.0.0.1',
    port: server.port,
    request: { method: 'GET', path: '/health' },
    runId: 'run-1',
    verifyPeer: acceptPeer,
    signal: controller.signal,
  }).response
  const refused = sendDeclaredRequest({
    host: '127.0.0.1',
    port: server.port,
    request: { method: 'GET', path: '/health' },
    runId: 'run-1',
    verifyPeer: async () => {
      throw new Error('refused')
    },
    signal: controller.signal,
  })
  await assert.rejects(refused.written, /refused/)
  // Assert
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
})
