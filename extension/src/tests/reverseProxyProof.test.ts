import assert from 'node:assert/strict'
import { once } from 'node:events'
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from 'node:http'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { Socket } from 'node:net'
import { createServer as createNetServer } from 'node:net'
import { test } from 'node:test'

import {
  proveReverseProxy,
  reasonOfTransportCode,
  unreachableKindOfCode,
} from '../utils/proveReverseProxy'
import type { ReverseProxyProofInput } from '../utils/proveReverseProxy'

import { freeLoopbackPort } from './utils/freeLoopbackPort'
import { createSelfSignedCertificate } from './utils/selfSignedCertificate'

const CHALLENGE = '0123456789abcdef0123456789abcdef'
const EXPECTED = 'a'.repeat(64)
const ANSWERING_PID = 4242
const DECLARED_HOST = 'app.example.test'
const neverCancelled = new AbortController().signal

type Handler = (request: IncomingMessage, response: ServerResponse) => void

type FixtureServer = {
  port: number
  requests: { url: string | undefined; headers: IncomingHttpHeaders }[]
  sockets: Set<Socket>
  close: () => Promise<void>
}

/** Starts a loopback HTTP or HTTPS server; the caller closes it. */
async function serve(
  handler: Handler,
  tls?: { certificate: string; privateKey: string },
): Promise<FixtureServer> {
  const requests: FixtureServer['requests'] = []
  const sockets = new Set<Socket>()
  const listener: Handler = (request, response) => {
    requests.push({ url: request.url, headers: request.headers })
    handler(request, response)
  }
  const server = tls
    ? createHttpsServer(
        { cert: tls.certificate, key: tls.privateKey },
        listener,
      )
    : createHttpServer(listener)
  server.on('connection', (socket) => sockets.add(socket))
  server.on('secureConnection', (socket) => sockets.add(socket))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return {
    port: address.port,
    requests,
    sockets,
    close: async (): Promise<void> => {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    },
  }
}

/** Starts a raw TCP server that runs `onRequestBytes` when the request arrives; returns its port and a closer. */
async function serveRaw(onRequestBytes: (socket: Socket) => void) {
  const sockets = new Set<Socket>()
  const server = createNetServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('data', () => onRequestBytes(socket))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return {
    port: address.port,
    close: (): void => {
      for (const socket of sockets) socket.destroy()
      server.close()
    },
  }
}

/** The proof answer a correct preload gives. */
function answerProof(headers: Record<string, string> = {}): Handler {
  return (_request, response): void => {
    response.writeHead(200, { 'x-codebook-proof-pid': '4242', ...headers })
    response.end(EXPECTED)
  }
}

/** A proof input for a fixture server at `port` (the origin names a host that does not resolve). */
function inputFor(
  port: number,
  overrides: Partial<ReverseProxyProofInput> & {
    scheme?: 'http' | 'https'
  } = {},
): ReverseProxyProofInput {
  const scheme = overrides.scheme ?? 'http'
  return {
    origin: {
      ok: true,
      origin: `${scheme}://${DECLARED_HOST}:${port}`,
      hostname: DECLARED_HOST,
      port: String(port),
      effectivePort: port,
      scheme,
    },
    address: '127.0.0.1',
    challenge: CHALLENGE,
    // The keyed answer is bound to the pid: only the answering pid of the fixture has a matching digest.
    expectedOf: (pid) => (pid === ANSWERING_PID ? EXPECTED : 'f'.repeat(64)),
    ca: [],
    timeoutMs: 5_000,
    ...overrides,
  }
}

/** Runs one proof against a server and closes it afterwards. */
async function proveAgainst(
  handler: Handler,
  overrides: Partial<ReverseProxyProofInput> & {
    scheme?: 'http' | 'https'
  } = {},
  tls?: { certificate: string; privateKey: string },
) {
  const server = await serve(handler, tls)
  try {
    return {
      result: await proveReverseProxy(
        inputFor(server.port, overrides),
        neverCancelled,
      ),
      server,
    }
  } finally {
    await server.close()
  }
}

// Value: protects=a correct keyed answer over http proves the origin; fails_when=a matching 200 with a pid is not accepted; no_claim=the answering process is the one Codebook started (the gate binds that)
test('a keyed 200 answer over http proves the origin and reports the answering pid', async () => {
  // Arrange
  const handler = answerProof()
  // Act
  const { result } = await proveAgainst(handler)
  // Assert
  assert.deepEqual(result, { ok: true, serverPid: 4242 })
})

// Value: protects=the digest authenticating the answering pid; fails_when=a valid digest with a substituted pid header is accepted; no_claim=the process-group check of the gate
test('a valid digest with a substituted pid header is refused as proof-wrong-server', async () => {
  // Arrange
  const handler = answerProof({ 'x-codebook-proof-pid': '4343' })
  // Act
  const { result } = await proveAgainst(handler)
  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'proof-wrong-server',
    requestWritten: true,
    status: 200,
  })
})

// Value: protects=the proof runs over https against a certificate the caller trusts; fails_when=ca, servername or the address connection is wrong; no_claim=the real operating system store
test('a keyed 200 answer over https with a trusted certificate proves the origin', async () => {
  // Arrange
  const tls = await createSelfSignedCertificate(DECLARED_HOST)
  // Act
  const { result } = await proveAgainst(
    answerProof(),
    { scheme: 'https', ca: [tls.certificate] },
    tls,
  )
  // Assert
  assert.deepEqual(result, { ok: true, serverPid: 4242 })
})

// Value: protects=another upstream answering the path is not taken for the dev server; fails_when=a 200 with another body or a 404 passes; no_claim=what the other server is
for (const [label, status, body] of [
  ['a 200 with another body', 200, 'not the keyed answer'],
  ['a 404', 404, 'not found'],
] as const) {
  test(`${label} is refused as proof-wrong-server with its status`, async () => {
    // Arrange
    const handler: Handler = (_request, response) => {
      response.writeHead(status, { 'x-codebook-proof-pid': '4242' })
      response.end(body)
    }
    // Act
    const { result } = await proveAgainst(handler)
    // Assert
    assert.deepEqual(result, {
      ok: false,
      reason: 'proof-wrong-server',
      requestWritten: true,
      status,
    })
  })
}

// Value: protects=a redirect is never followed to another host; fails_when=a 3xx is followed or reported as wrong-server; no_claim=where the redirect leads
for (const status of [301, 302, 307, 308]) {
  test(`a ${status} answer is refused as proof-redirected and not followed`, async () => {
    // Arrange
    const handler: Handler = (_request, response) => {
      response.writeHead(status, {
        location: 'https://elsewhere.example.test/',
      })
      response.end()
    }
    // Act
    const { result, server } = await proveAgainst(handler)
    // Assert
    assert.deepEqual(result, {
      ok: false,
      reason: 'proof-redirected',
      requestWritten: true,
      status,
    })
    assert.equal(server.requests.length, 1)
  })
}

// Value: protects=a closed port is told apart and nothing counts as sent; fails_when=requestWritten is true or the reason differs; no_claim=who else listens there
test('a closed port is refused as proof-unreachable with nothing written', async () => {
  // Arrange
  const port = await freeLoopbackPort()
  // Act
  const result = await proveReverseProxy(inputFor(port), neverCancelled)
  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'proof-unreachable',
    requestWritten: false,
    unreachableKind: 'refused',
  })
})

// Value: protects=a proxy that accepts and never answers ends at the bound; fails_when=the bound is not applied to the whole request; no_claim=the 10 s production bound
test('a server that accepts and never answers is refused as proof-timeout at the bound', async () => {
  // Arrange
  const handler: Handler = () => {}
  // Act
  const { result } = await proveAgainst(handler, { timeoutMs: 300 })
  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'proof-timeout',
    requestWritten: true,
    timeoutMs: 300,
  })
})

// Value: protects=a server that stalls after the headers ends at the bound too; fails_when=the bound covers only the handshake; no_claim=nothing about a slow body that finishes in time
test('a server that stalls after the headers is refused as proof-timeout at the bound', async () => {
  // Arrange
  const handler: Handler = (_request, response) => {
    response.writeHead(200, { 'x-codebook-proof-pid': '4242' })
    response.flushHeaders()
  }
  // Act
  const { result } = await proveAgainst(handler, { timeoutMs: 300 })
  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'proof-timeout',
    requestWritten: true,
    timeoutMs: 300,
  })
})

// Value: protects=a non-HTTP reply is an unclassified refusal not a crash; fails_when=the parse error escapes or is called unreachable; no_claim=which protocol the other side speaks
test('a garbage reply is refused as proof-unclassified', async () => {
  // Arrange
  const server = await serveRaw((socket) =>
    socket.end('garbage garbage\r\n\r\n'),
  )
  try {
    // Act
    const result = await proveReverseProxy(
      inputFor(server.port),
      neverCancelled,
    )
    // Assert
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.reason, 'proof-unclassified')
  } finally {
    server.close()
  }
})

// Value: protects=a certificate the system does not trust is refused, never bypassed; fails_when=rejectUnauthorized is off or the ca is ignored; no_claim=the real system store
test('a certificate missing from the trust anchors is refused as certificate-untrusted', async () => {
  // Arrange
  const tls = await createSelfSignedCertificate(DECLARED_HOST)
  // Act
  const { result } = await proveAgainst(
    answerProof(),
    { scheme: 'https', ca: [] },
    tls,
  )
  // Assert
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.reason, 'certificate-untrusted')
})

// Value: protects=a certificate for another name is not accepted for the declared host; fails_when=servername or the identity check is dropped; no_claim=name matching rules beyond Node's
test('a certificate issued for another name is refused as certificate-host-mismatch', async () => {
  // Arrange
  const tls = await createSelfSignedCertificate('other.example.test')
  // Act
  const { result } = await proveAgainst(
    answerProof(),
    { scheme: 'https', ca: [tls.certificate] },
    tls,
  )
  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'certificate-host-mismatch',
    requestWritten: false,
    tlsCode: 'ERR_TLS_CERT_ALTNAME_INVALID',
  })
})

// Value: protects=the error-code table of D22; fails_when=a code moves to another reason; no_claim=that Node emits the synthetic codes
for (const [code, reason] of [
  ['ECONNREFUSED', 'proof-unreachable'],
  ['EHOSTUNREACH', 'proof-unreachable'],
  ['ENETUNREACH', 'proof-unreachable'],
  ['ECONNRESET', 'proof-unreachable'],
  ['EPIPE', 'proof-unreachable'],
  ['ETIMEDOUT', 'proof-unreachable'],
  ['ENOTFOUND', 'proof-unreachable'],
  ['SELF_SIGNED_CERT_IN_CHAIN', 'certificate-untrusted'],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', 'certificate-untrusted'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'certificate-untrusted'],
  ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'certificate-untrusted'],
  ['UNABLE_TO_GET_ISSUER_CERT', 'certificate-untrusted'],
  ['CERT_HAS_EXPIRED', 'certificate-expired'],
  ['CERT_NOT_YET_VALID', 'certificate-expired'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'certificate-host-mismatch'],
  ['CERT_REVOKED', 'certificate-invalid'],
  ['ERR_TLS_INVALID_PROTOCOL_VERSION', 'certificate-invalid'],
  ['ERR_SSL_WRONG_VERSION_NUMBER', 'certificate-invalid'],
  ['HPE_INVALID_CONSTANT', 'proof-unclassified'],
  ['EACCES', 'proof-unclassified'],
] as const) {
  test(`transport code ${code} is classified as ${reason}`, () => {
    // Arrange
    const transportCode = code
    // Act
    const classified = reasonOfTransportCode(transportCode)
    // Assert
    assert.equal(classified, reason)
  })
}

// Value: protects=O3-2 the three proof-unreachable sentences are told apart by errno; fails_when=a code moves to another variant, so refused, no route and reset read alike; no_claim=that Node emits the synthetic codes
for (const [code, kind] of [
  ['ECONNREFUSED', 'refused'],
  ['EHOSTUNREACH', 'no-route'],
  ['ENETUNREACH', 'no-route'],
  ['ENOTFOUND', 'no-route'],
  ['ECONNRESET', 'reset'],
  ['EPIPE', 'reset'],
  ['ETIMEDOUT', 'reset'],
  ['CERT_REVOKED', undefined],
] as const) {
  test(`transport code ${code} names the ${kind ?? 'no'} unreachable variant`, () => {
    // Arrange
    const transportCode = code
    // Act
    const named = unreachableKindOfCode(transportCode)
    // Assert
    assert.equal(named, kind)
  })
}

// Value: protects=an error without a code is unclassified; fails_when=undefined is read as unreachable; no_claim=the error text
test('an error without a code is classified as proof-unclassified', () => {
  // Arrange
  const transportCode = undefined
  // Act
  const classified = reasonOfTransportCode(transportCode)
  // Assert
  assert.equal(classified, 'proof-unclassified')
})

// Value: protects=the request leaks no credential and names the declared host; fails_when=a cookie, authorization or a loopback Host header is sent; no_claim=headers added by a proxy
test('the request carries the keyed path and the declared host and no cookie or authorization', async () => {
  // Arrange
  const handler = answerProof()
  // Act
  const { server } = await proveAgainst(handler)
  // Assert
  const [request] = server.requests
  assert.equal(request?.url, `/__codebook_proof__/${CHALLENGE}`)
  assert.equal(request?.headers.host, `${DECLARED_HOST}:${server.port}`)
  assert.equal(request?.headers.cookie, undefined)
  assert.equal(request?.headers.authorization, undefined)
})

// Value: protects=the proof connects to the validated address with no second lookup; fails_when=the host name is resolved again (app.example.test does not resolve); no_claim=DNS behavior
test('a declared host name that does not resolve is still proved through the validated address', async () => {
  // Arrange
  const handler = answerProof()
  // Act
  const { result } = await proveAgainst(handler)
  // Assert
  assert.equal(result.ok, true)
})

// Value: protects=cancelling the run destroys the socket and reports the run's reason; fails_when=the request outlives the abort or a refusal is returned; no_claim=the production bound
test('a run cancelled mid-flight destroys the socket and rejects with the signal reason', async () => {
  // Arrange
  const server = await serve(() => {})
  const controller = new AbortController()
  try {
    // Act
    const pending = proveReverseProxy(inputFor(server.port), controller.signal)
    while (server.requests.length === 0)
      // gstack-timing-ok: a poll until the server saw the request, not a sleep before an assertion
      await new Promise((resolve) => setTimeout(resolve, 10))
    const [socket] = [...server.sockets]
    controller.abort(new Error('run cancelled'))
    // Assert
    await assert.rejects(pending, { message: 'run cancelled' })
    if (socket && !socket.destroyed) await once(socket, 'close')
    assert.equal(socket?.destroyed, true)
  } finally {
    await server.close()
  }
})

// Value: protects=the body read is bounded at 128 bytes; fails_when=a long body is read in full or accepted; no_claim=how much the server tried to send
test('a body longer than 128 bytes is refused as proof-wrong-server and the read stops', async () => {
  // Arrange
  const handler: Handler = (_request, response) => {
    response.writeHead(200, { 'x-codebook-proof-pid': '4242' })
    response.write('a'.repeat(200))
  }
  // Act
  const { result } = await proveAgainst(handler)
  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'proof-wrong-server',
    requestWritten: true,
    status: 200,
  })
})

// Value: protects=the answering process must report a pid; fails_when=a missing or non-numeric x-codebook-proof-pid passes; no_claim=that a present pid is the right process
for (const [label, pidHeader] of [
  ['missing', undefined],
  ['non-numeric', 'abc'],
  ['zero', '0'],
] as const) {
  test(`a ${label} proof pid header is refused as proof-wrong-server`, async () => {
    // Arrange
    const handler: Handler = (_request, response) => {
      response.writeHead(
        200,
        pidHeader ? { 'x-codebook-proof-pid': pidHeader } : {},
      )
      response.end(EXPECTED)
    }
    // Act
    const { result } = await proveAgainst(handler)
    // Assert
    assert.deepEqual(result, {
      ok: false,
      reason: 'proof-wrong-server',
      requestWritten: true,
      status: 200,
    })
  })
}

// Value: protects=a reset after the write is reported as written (the proxy may have forwarded it); fails_when=requestWritten stays false; no_claim=what the proxy did with the request
test('a connection reset after the request was written is refused as proof-unreachable with requestWritten true', async () => {
  // Arrange
  const server = await serveRaw((socket) => socket.resetAndDestroy())
  try {
    // Act
    const result = await proveReverseProxy(
      inputFor(server.port),
      neverCancelled,
    )
    // Assert
    assert.deepEqual(result, {
      ok: false,
      reason: 'proof-unreachable',
      requestWritten: true,
      unreachableKind: 'reset',
    })
  } finally {
    server.close()
  }
})
