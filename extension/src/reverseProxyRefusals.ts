import type { ReverseProxyRefusalReason } from './constants'
import type { StudyError } from './errors'

/** What a `REVERSE_PROXY_REFUSED` refusal is worded from: the declaration, what the run knows about its cleanup, and the reason's own fields. */
export type ReverseProxyRefusalFacts = {
  /** The normalized declared origin. */
  origin: string
  upstreamPort: number
  /** Whether the run confirmed that it stopped the server it started; never a constant. */
  resourcesReleased: boolean
  /** The address involved: the first non-loopback answer, the same-socket address, or the address the proof checked. */
  address?: string
  /** The HTTP status, for `proof-wrong-server` and `proof-redirected`. */
  status?: number
  /** The bound, for `proof-timeout`. */
  timeoutMs?: number
  /** Node's TLS error code, for the `certificate-*` reasons. */
  tlsCode?: string
  /** The browser's `net::ERR_…` text, for the `browser-certificate-*` reasons. */
  browserError?: string
  /** The address the browser reached, for `browser-address-mismatch`. */
  browserAddress?: string
  /** The Output line id, for `proof-unclassified`. */
  logId?: string
  /** Whether the proof request was written; decides `sideEffects` of `proof-unreachable`. */
  requestWritten?: boolean
}

/**
 * Builds the `REVERSE_PROXY_REFUSED` error of one reason: the message (opening, reason sentence, `Fix:` line) and the `details` (`reason`, `origin`, `upstreamPort`, `sideEffects`, `browserOpened`, `resourcesReleased` and the reason's own fields).
 *
 * Why it exists: every refusal of the declaration, from the run and from the saved-session setup, has one wording and one set of facts. The opening differs for the three reasons decided before anything starts. `sideEffects` follows what the failure establishes (`none`, or `unknown` when the proof request may have reached a responder Codebook does not control); `browserOpened` is always false because the probe's throwaway browser is closed. Called by the run and by the setup when the gate returns a failure.
 * @param reason - One of {@link REVERSE_PROXY_REFUSAL_REASONS}.
 * @param facts - {@link ReverseProxyRefusalFacts}.
 * @returns A {@link StudyError} with code `REVERSE_PROXY_REFUSED`.
 * @example
 * reverseProxyRefusal('proof-timeout', { origin: 'https://app.example.test', upstreamPort: 4310, resourcesReleased: true, timeoutMs: 10_000 }).details?.reason // => 'proof-timeout'
 */
export function reverseProxyRefusal(
  reason: ReverseProxyRefusalReason,
  facts: ReverseProxyRefusalFacts,
): StudyError {
  void reason
  void facts
  throw new Error('not implemented')
}
