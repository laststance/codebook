import { createHmac } from 'node:crypto'

import {
  REVERSE_PROXY_PROOF_PATH_PREFIX,
  REVERSE_PROXY_PROOF_SECRET_ENV,
} from '../constants'

/**
 * Builds the CommonJS text of the identity preload the development server runs with `--require`.
 *
 * Why it exists: the proof must be answered by Codebook's code inside the server Codebook started, without running any route code of the app. The preload replaces `http.Server.prototype.emit` so a `request` whose URL starts with {@link REVERSE_PROXY_PROOF_PATH_PREFIX} is answered with `HMAC-SHA256(secret, challenge + ':' + pid)` (the digest covers the answering pid, so a proxy cannot keep a valid digest and swap the pid header), the secret read from {@link REVERSE_PROXY_PROOF_SECRET_ENV}; without the variable it is inert. The text holds no secret. Called by `ReverseProxyGate.preparePreload()`.
 *
 * Answers: `GET` with a 32-hex challenge and no query is `200` with the digest as body and the answering `process.pid` in `x-codebook-proof-pid`; any other method is `405`; a malformed challenge or a query is `404`. Every answer is written here, so a request under the prefix never reaches Next or any app code, and the preload never throws into the server.
 * @returns The source of the preload file.
 * @example
 * buildReverseProxyIdentityPreloadSource().includes('__codebook_proof__') // => true
 */
export function buildReverseProxyIdentityPreloadSource(): string {
  const prefix = JSON.stringify(REVERSE_PROXY_PROOF_PATH_PREFIX)
  const variable = JSON.stringify(REVERSE_PROXY_PROOF_SECRET_ENV)
  return `'use strict'
const PREFIX = ${prefix}
const secret = process.env[${variable}]
const CHALLENGE = /^[0-9a-f]{32}$/

// Writes one complete answer; every answer closes the connection and is never cached.
function send(response, status, body, headers) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    connection: 'close',
    ...headers,
  })
  response.end(body)
}

// Chooses the answer of one proof request from its method and the text after the prefix.
function answer(request, response) {
  if (request.method !== 'GET') return send(response, 405, 'Method Not Allowed', { allow: 'GET' })
  const challenge = request.url.slice(PREFIX.length)
  // A query, a path or a malformed challenge is answered here too: falling through would run the app's not-found code.
  if (!CHALLENGE.test(challenge)) return send(response, 404, 'Not Found')
  const digest = require('node:crypto').createHmac('sha256', secret).update(challenge + ':' + process.pid).digest('hex')
  send(response, 200, digest, { 'x-codebook-proof-pid': String(process.pid) })
}

// Without the variable the preload changes nothing.
if (typeof secret === 'string' && secret !== '') {
  const server = require('node:http').Server.prototype
  const emit = server.emit
  server.emit = function (event, request, response) {
    const isProof =
      event === 'request' &&
      request !== undefined &&
      typeof request.url === 'string' &&
      request.url.startsWith(PREFIX)
    if (!isProof) return emit.apply(this, arguments)
    try {
      answer(request, response)
    } catch {
      // The preload never throws into the server; a proof that cannot be written ends the socket.
      try { response.destroy() } catch {}
    }
    return true
  }
}
`
}

/**
 * Computes the answer the preload gives to a challenge, for the prover to compare with.
 *
 * Why it exists: the proof is a keyed answer to a fresh challenge, so a party on the path that never saw the secret cannot forge it. Called by `ReverseProxyGate.prove()` and by the identity preload's tests.
 * @param secret - The run's identity secret (hex).
 * @param challenge - The 32-hex-character challenge of one proof.
 * @param pid - The decimal pid the answer reports; the digest covers it, so an answer cannot be re-attributed to another process.
 * @returns `HMAC-SHA256(secret, challenge + ':' + pid)` as 64 lowercase hex characters.
 * @example
 * expectedProofOf(secret, '00112233445566778899aabbccddeeff', 4242) // => '9f2c…' (64 hex characters)
 */
export function expectedProofOf(
  secret: string,
  challenge: string,
  pid: number,
): string {
  return createHmac('sha256', secret)
    .update(`${challenge}:${pid}`)
    .digest('hex')
}
