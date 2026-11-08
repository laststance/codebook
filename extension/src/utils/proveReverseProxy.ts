import { timingSafeEqual } from 'node:crypto'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

import {
  REVERSE_PROXY_PROOF_BODY_LIMIT_BYTES,
  REVERSE_PROXY_PROOF_PATH_PREFIX,
} from '../constants'
import type {
  ReverseProxyRefusalReason,
  ReverseProxyUnreachableKind,
} from '../constants'

import type { ParsedReverseProxyOrigin } from './parseReverseProxyOrigin'

/** What {@link proveReverseProxy} needs for one proof request. */
export type ReverseProxyProofInput = {
  /** The parsed declared origin (its scheme picks `https` or `http`, its hostname is the SNI and `Host`). */
  origin: Extract<ParsedReverseProxyOrigin, { ok: true }>
  /** The validated address the request connects to (an IP literal, so no second lookup). */
  address: string
  /** The 32-hex-character challenge of this proof. */
  challenge: string
  /** Computes the answer the given pid must have given (`HMAC-SHA256(secret, challenge + ':' + pid)`); called with the pid the response reports, so the digest authenticates that pid. */
  expectedOf: (pid: number) => string
  /** The trust anchors, from {@link readSystemCertificates}. */
  ca: readonly string[]
  /** Bound on the whole request, {@link REVERSE_PROXY_PROOF_TIMEOUT_MS}. */
  timeoutMs: number
}

/** The refusal reasons a proof request itself can end in. */
export type ReverseProxyProofFailureReason = Extract<
  ReverseProxyRefusalReason,
  | 'proof-unreachable'
  | 'proof-wrong-server'
  | 'proof-redirected'
  | 'proof-timeout'
  | 'proof-unclassified'
  | 'certificate-untrusted'
  | 'certificate-expired'
  | 'certificate-host-mismatch'
  | 'certificate-invalid'
>

/** What {@link proveReverseProxy} answers. */
export type ReverseProxyProofResult =
  | {
      ok: true
      /** The `x-codebook-proof-pid` the answering process reported; the gate binds it to the process group Codebook started. */
      serverPid: number
    }
  | {
      ok: false
      reason: ReverseProxyProofFailureReason
      /** Whether the request's `finish` event fired: false means nothing reached any server. */
      requestWritten: boolean
      /** The HTTP status, for `proof-wrong-server` and `proof-redirected`. */
      status?: number
      /** Node's TLS error code, for the `certificate-*` reasons. */
      tlsCode?: string
      /** The bound that ended the request, for `proof-timeout`. */
      timeoutMs?: number
      /** Which sentence a `proof-unreachable` refusal uses: `refused` (`ECONNREFUSED`), `no-route` (`EHOSTUNREACH`, `ENETUNREACH`, `ENOTFOUND`) or `reset` (`ECONNRESET`, `EPIPE`, `ETIMEDOUT`). */
      unreachableKind?: ReverseProxyUnreachableKind
    }

/** Transport error codes that mean nothing answered (before or after the write), each with the kind of failure the refusal names. */
const UNREACHABLE_KINDS: ReadonlyMap<string, ReverseProxyUnreachableKind> =
  new Map([
    ['ECONNREFUSED', 'refused'],
    ['EHOSTUNREACH', 'no-route'],
    ['ENETUNREACH', 'no-route'],
    ['ENOTFOUND', 'no-route'],
    ['ECONNRESET', 'reset'],
    ['EPIPE', 'reset'],
    ['ETIMEDOUT', 'reset'],
  ])

/** Certificate codes of a chain the system store does not vouch for. */
const UNTRUSTED_CODES: ReadonlySet<string> = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
])

/** Certificate codes of a certificate outside its validity period. */
const EXPIRED_CODES: ReadonlySet<string> = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
])

/**
 * Names the refusal reason of a transport error from its Node error code.
 * @param code - `error.code`, when the error has one.
 * @returns The reason; anything unlisted (an HTTP parse error included) is `proof-unclassified`.
 * @example
 * reasonOfTransportCode('ECONNREFUSED') // => 'proof-unreachable'
 * reasonOfTransportCode('ERR_TLS_CERT_ALTNAME_INVALID') // => 'certificate-host-mismatch'
 */
export function reasonOfTransportCode(
  code: string | undefined,
): ReverseProxyProofFailureReason {
  if (code === undefined) return 'proof-unclassified'
  if (UNREACHABLE_KINDS.has(code)) return 'proof-unreachable'
  if (UNTRUSTED_CODES.has(code)) return 'certificate-untrusted'
  if (EXPIRED_CODES.has(code)) return 'certificate-expired'
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID')
    return 'certificate-host-mismatch'
  return /^(CERT_|ERR_TLS_|ERR_SSL_)/.test(code)
    ? 'certificate-invalid'
    : 'proof-unclassified'
}

/**
 * Names which `proof-unreachable` sentence a transport error code gets.
 * @param code - `error.code`.
 * @returns `refused`, `no-route` or `reset`; `undefined` for a code that is not an unreachable code.
 * @example
 * unreachableKindOfCode('EHOSTUNREACH') // => 'no-route'
 * unreachableKindOfCode('EPIPE') // => 'reset'
 */
export function unreachableKindOfCode(
  code: string | undefined,
): ReverseProxyUnreachableKind | undefined {
  return code === undefined ? undefined : UNREACHABLE_KINDS.get(code)
}

/**
 * Reads the pid header the identity preload answers with.
 * @param header - The raw header value.
 * @returns The positive integer pid, or `undefined`.
 * @example
 * pidOfHeader('4242') // => 4242
 * pidOfHeader('abc') // => undefined
 */
function pidOfHeader(
  header: string | string[] | undefined,
): number | undefined {
  if (typeof header !== 'string' || !/^[1-9]\d*$/.test(header)) return undefined
  const pid = Number(header)
  return Number.isSafeInteger(pid) ? pid : undefined
}

/**
 * Whether a body equals the expected keyed answer, in constant time.
 * @param body - What the server sent.
 * @param expected - The answer the secret, challenge and reported pid give.
 * @returns True only for equal bytes.
 */
function isExpectedBody(body: Buffer, expected: string): boolean {
  const expectedBytes = Buffer.from(expected)
  return (
    body.length === expectedBytes.length && timingSafeEqual(body, expectedBytes)
  )
}

/**
 * Reads at most the body limit; a longer body is reported as `undefined` and the response is cut off.
 * @param response - The response to read.
 * @returns The body, or `undefined` when it is longer than {@link REVERSE_PROXY_PROOF_BODY_LIMIT_BYTES}.
 */
function readBoundedBody(
  response: IncomingMessage,
): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    response.on('data', (chunk: Buffer) => {
      total += chunk.length
      chunks.push(chunk)
      // Stop reading at the limit: a proof answer is 64 characters.
      if (total > REVERSE_PROXY_PROOF_BODY_LIMIT_BYTES) {
        response.destroy()
        resolve(undefined)
      }
    })
    response.on('end', () => resolve(Buffer.concat(chunks)))
    response.on('error', reject)
    response.on('close', () => resolve(Buffer.concat(chunks)))
  })
}

/**
 * Judges a response: status first, then the keyed body and the pid header.
 * @param response - The proof response.
 * @param input - The proof input (the expected answer).
 * @returns The proof result; `requestWritten` is true because a response exists.
 */
async function judgeResponse(
  response: IncomingMessage,
  input: ReverseProxyProofInput,
): Promise<ReverseProxyProofResult> {
  const status = response.statusCode ?? 0
  const failure = { ok: false, requestWritten: true, status } as const
  if (status >= 300 && status < 400) {
    response.destroy()
    return { ...failure, reason: 'proof-redirected' }
  }
  if (status !== 200) {
    response.destroy()
    return { ...failure, reason: 'proof-wrong-server' }
  }
  const body = await readBoundedBody(response)
  const serverPid = pidOfHeader(response.headers['x-codebook-proof-pid'])
  // The digest covers the pid, so it can only be recomputed once a valid pid is known.
  if (
    !body ||
    serverPid === undefined ||
    !isExpectedBody(body, input.expectedOf(serverPid))
  )
    return { ...failure, reason: 'proof-wrong-server' }
  return { ok: true, serverPid }
}

/**
 * Starts the one proof request: the validated address as the socket target, the declared host as SNI and `Host`, nothing else.
 * @param input - The proof input.
 * @param signal - Aborts (destroys) the request.
 * @returns The request.
 */
function startRequest(
  input: ReverseProxyProofInput,
  signal: AbortSignal,
): ClientRequest {
  const { origin } = input
  const send = origin.scheme === 'https' ? httpsRequest : httpRequest
  return send({
    host: input.address,
    port: origin.effectivePort,
    method: 'GET',
    path: `${REVERSE_PROXY_PROOF_PATH_PREFIX}${input.challenge}`,
    // The Host header carries the declared host (and its non-default port), as a browser's request would.
    headers: {
      host: new URL(origin.origin).host,
      accept: 'text/plain',
      connection: 'close',
    },
    agent: false,
    signal,
    ...(origin.scheme === 'https'
      ? {
          servername: origin.hostname,
          rejectUnauthorized: true,
          ca: [...input.ca],
        }
      : {}),
  })
}

/**
 * Sends the single proof request to the declared origin and classifies the outcome.
 *
 * Why it exists: the origin counts as proved only when a keyed answer to a fresh challenge comes back over a connection the system trusts. It uses `node:https` (or `node:http`) to the validated address with the declared host as SNI and `Host`, no cookie, no redirect, `rejectUnauthorized: true`, at most {@link REVERSE_PROXY_PROOF_BODY_LIMIT_BYTES} body bytes and the bound of the input. Called by `ReverseProxyGate.prove()`.
 * @param input - {@link ReverseProxyProofInput}.
 * @param signal - The run's signal; it destroys the request.
 * @returns `{ ok: true, serverPid }` for status 200, a matching body and a positive integer pid header; otherwise the classified failure.
 * @throws The signal's reason when the run is cancelled (no refusal).
 * @example
 * await proveReverseProxy({ origin, address: '127.0.0.1', challenge, expectedOf, ca, timeoutMs: 10_000 }, signal) // => { ok: true, serverPid: 4242 }
 */
export function proveReverseProxy(
  input: ReverseProxyProofInput,
  signal: AbortSignal,
): Promise<ReverseProxyProofResult> {
  signal.throwIfAborted()
  const bound = AbortSignal.any([signal, AbortSignal.timeout(input.timeoutMs)])
  return new Promise((resolve, reject) => {
    let requestWritten = false
    const failWith = (error: unknown): void => {
      // The run's own cancellation rethrows its reason; the bound alone is a timeout.
      if (signal.aborted) return reject(signal.reason)
      if (bound.aborted)
        return resolve({
          ok: false,
          reason: 'proof-timeout',
          requestWritten,
          timeoutMs: input.timeoutMs,
        })
      const code =
        error instanceof Error && 'code' in error
          ? String(error.code)
          : undefined
      const reason = reasonOfTransportCode(code)
      resolve({
        ok: false,
        reason,
        requestWritten,
        ...(reason.startsWith('certificate-') ? { tlsCode: code } : {}),
        // The three variants of the unreachable sentence.
        ...(reason === 'proof-unreachable'
          ? { unreachableKind: unreachableKindOfCode(code) }
          : {}),
      })
    }
    const request = startRequest(input, bound)
    request.on('finish', () => {
      requestWritten = true
    })
    request.on('error', failWith)
    request.on('response', (response) => {
      judgeResponse(response, input).then(resolve, failWith)
    })
    request.end()
  })
}
