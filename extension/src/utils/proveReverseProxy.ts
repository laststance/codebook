import type { ReverseProxyRefusalReason } from '../constants'

import type { ParsedReverseProxyOrigin } from './parseReverseProxyOrigin'

/** What {@link proveReverseProxy} needs for one proof request. */
export type ReverseProxyProofInput = {
  /** The parsed declared origin (its scheme picks `https` or `http`, its hostname is the SNI and `Host`). */
  origin: Extract<ParsedReverseProxyOrigin, { ok: true }>
  /** The validated address the request connects to (an IP literal, so no second lookup). */
  address: string
  /** The 32-hex-character challenge of this proof. */
  challenge: string
  /** `HMAC-SHA256(secret, challenge)` the answer must equal. */
  expected: string
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
 * await proveReverseProxy({ origin, address: '127.0.0.1', challenge, expected, ca, timeoutMs: 10_000 }, signal) // => { ok: true, serverPid: 4242 }
 */
export async function proveReverseProxy(
  input: ReverseProxyProofInput,
  signal: AbortSignal,
): Promise<ReverseProxyProofResult> {
  void input
  void signal
  throw new Error('not implemented')
}
