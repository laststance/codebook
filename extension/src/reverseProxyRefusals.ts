import {
  REVERSE_PROXY_PROOF_TIMEOUT_MS,
  type ReverseProxyRefusalReason,
  type ReverseProxyUnreachableKind,
} from './constants'
import { StudyError } from './errors'

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
  /** Which sentence `proof-unreachable` uses: connection refused, no route or connection reset. */
  unreachableKind?: ReverseProxyUnreachableKind
  /** `true` when the failure came before the proof request was started (the system certificates could not be read), so nothing was sent; only `proof-unclassified` reads it. */
  proofNotStarted?: boolean
}

/** What a reason sentence is worded from: the refusal's facts plus the declared origin's host and the port the browser connects to. */
type SentenceInput = ReverseProxyRefusalFacts & {
  host: string
  effectivePort: number
}

/** The ` (<tlsCode>)` tail of a certificate sentence, or nothing when the code is unknown. */
function tlsSuffix(tlsCode: string | undefined): string {
  return tlsCode === undefined ? '' : ` (${tlsCode})`
}

/** The sentence of the two browser certificate reasons: the proof accepted the certificate, the browser did not. */
function browserCertificateSentence({
  origin,
  browserError,
}: SentenceInput): string {
  const detail = browserError === undefined ? '' : ` (${browserError})`
  return `The browser rejected the certificate of ${origin}${detail} although the proof accepted it.`
}

/** The parenthesized variant of the `proof-unreachable` sentence, or nothing when the failure came from the browser check, which names its own error. */
const UNREACHABLE_VARIANTS: Record<ReverseProxyUnreachableKind, string> = {
  refused: ' (connection refused)',
  'no-route': ' (no route)',
  reset: ' (connection reset)',
}

/** `address:port`, with an IPv6 address bracketed. */
function addressWithPort(address: string, port: number): string {
  return address.includes(':') ? `[${address}]:${port}` : `${address}:${port}`
}

/** The observation each reason states: the host and addresses are this machine's own resolver answers and are shown; the nonce, response headers, body and a redirect's `Location` never are. */
const REASON_SENTENCES: Record<
  ReverseProxyRefusalReason,
  (input: SentenceInput) => string
> = {
  'not-resolved': ({ host }) =>
    `The host ${host} has no address on this machine.`,
  'not-loopback': ({ host, address = 'an address' }) =>
    `The host ${host} resolves to ${address}, which is not a loopback address; Codebook trusts only a proxy on this machine.`,
  'same-socket': ({ address = '', effectivePort }) =>
    `The origin's address ${addressWithPort(address, effectivePort)} is the address the development server needs, so the proxy and the server cannot share it.`,
  'proof-unreachable': ({ origin, unreachableKind }) =>
    `No request completed at ${origin}${unreachableKind === undefined ? '' : UNREACHABLE_VARIANTS[unreachableKind]}.`,
  'proof-wrong-server': ({ origin, status, upstreamPort }) =>
    `${origin} answered${status === undefined ? '' : ` with status ${status}`} but not with the identity of the development server Codebook started on port ${upstreamPort}.`,
  'proof-redirected': ({ origin, status }) =>
    `${origin} answered with a redirect${status === undefined ? '' : ` (status ${status})`}; Codebook follows none.`,
  'proof-timeout': ({ origin, timeoutMs = REVERSE_PROXY_PROOF_TIMEOUT_MS }) =>
    `${origin} did not answer within ${timeoutMs} ms.`,
  'proof-unclassified': ({ origin, logId }) =>
    `The proof request to ${origin} failed in a way Codebook does not classify${logId === undefined ? '' : ` (log id ${logId})`}.`,
  'certificate-untrusted': ({ origin, tlsCode }) =>
    `This system does not trust the certificate chain of ${origin}${tlsSuffix(tlsCode)}.`,
  'certificate-expired': ({ origin, tlsCode }) =>
    `The certificate of ${origin} has expired or is not yet valid${tlsSuffix(tlsCode)}.`,
  'certificate-host-mismatch': ({ origin, tlsCode }) =>
    `The certificate of ${origin} does not name its host${tlsSuffix(tlsCode)}.`,
  'certificate-invalid': ({ origin, tlsCode }) =>
    `This system rejected the certificate of ${origin}${tlsSuffix(tlsCode)}.`,
  'browser-certificate-untrusted': browserCertificateSentence,
  'browser-certificate-rejected': browserCertificateSentence,
  'browser-address-mismatch': ({
    origin,
    address = 'Codebook checked',
    browserAddress = 'another address',
  }) =>
    `The browser reached ${browserAddress} for ${origin}, not the checked address ${address}.`,
}

/** The `Fix:` sentence of each reason, shown to the learner (also by the saved-session setup); {@link fixOf} words `proof-unclassified` by whether a log id exists. */
const REASON_FIXES: Record<ReverseProxyRefusalReason, string> = {
  'not-resolved':
    'Map the host to a loopback address with a hosts entry or local DNS, then ask for a new run.',
  'not-loopback':
    'Codebook supports a proxy on this machine only; map the host to a loopback address.',
  'same-socket':
    'Declare the port your proxy forwards to, which differs from the port the proxy itself listens on.',
  'proof-unreachable':
    'Start your proxy and check that the host maps to the address it listens on.',
  'proof-wrong-server':
    "Check the port in your proxy's configuration (proxy_pass, reverse_proxy) and that it forwards this path to the app's dev server without requiring sign-in.",
  'proof-redirected': 'Declare the scheme and port your proxy serves directly.',
  'proof-timeout': 'Check that your proxy and the server behind it respond.',
  'proof-unclassified': 'Look up the log id in Output > Codebook.',
  'certificate-untrusted':
    'Add the issuer of your local certificate to the system trust store (the tool that created the certificate has an install command).',
  'certificate-expired': "Renew the proxy's certificate.",
  'certificate-host-mismatch': 'Use a certificate that names this host.',
  'certificate-invalid':
    "Check the proxy's certificate; Codebook never bypasses certificate checks.",
  'browser-certificate-untrusted':
    'Make the browser trust the same certificate issuer; some systems keep a separate browser trust store.',
  'browser-certificate-rejected':
    "Check the proxy's certificate in the browser; Codebook never bypasses certificate checks.",
  'browser-address-mismatch':
    'Let the browser reach your host name directly: add it to your system proxy bypass list.',
}

/** The reasons decided before anything starts, whose opening says nothing was started. */
const REASONS_BEFORE_START: ReadonlySet<ReverseProxyRefusalReason> = new Set([
  'not-resolved',
  'not-loopback',
  'same-socket',
])

/** The reasons after which the proof's one GET (or the probe's fetch) may have reached a responder Codebook does not control. */
const REASONS_THAT_REACHED_A_RESPONDER: ReadonlySet<ReverseProxyRefusalReason> =
  new Set([
    'proof-wrong-server',
    'proof-redirected',
    'proof-timeout',
    'proof-unclassified',
    'browser-address-mismatch',
  ])

/** The sentence a refusal adds when something may have been sent. */
const PROOF_GET_SENTENCE =
  "Codebook sent its proof request and, when the browser check ran, the throwaway browser's one request (no cookie), and no operation."

/** The `proof-unclassified` Fix when no log id exists: the saved-session setup refuses without one, so the learner is sent to the reverse proxy line of the Output instead. */
const PROOF_UNCLASSIFIED_FIX_WITHOUT_LOG_ID =
  'Look for the reverse proxy line in Output > Codebook; ask for a new run only if you know the cause.'

/** The optional facts that become `details` fields. */
const OPTIONAL_DETAIL_FIELDS = [
  'address',
  'status',
  'timeoutMs',
  'tlsCode',
  'browserError',
  'browserAddress',
  'logId',
] as const

/**
 * Tells what a refusal establishes about anything reaching a server.
 *
 * Called by {@link reverseProxyRefusal} for the message and the details.
 * @param reason - The refusal reason.
 * @param facts - {@link ReverseProxyRefusalFacts}; `requestWritten` is read by `proof-unreachable`, `proofNotStarted` by `proof-unclassified`.
 * @returns `unknown` when a responder Codebook does not control may have received the proof path, else `none`.
 * @example
 * sideEffectsOf('proof-timeout', { origin: 'https://app.example.test', upstreamPort: 4310, resourcesReleased: true }) // => 'unknown'
 * sideEffectsOf('proof-unclassified', { origin: 'https://app.example.test', upstreamPort: 4310, resourcesReleased: true, proofNotStarted: true }) // => 'none'
 */
function sideEffectsOf(
  reason: ReverseProxyRefusalReason,
  facts: ReverseProxyRefusalFacts,
): 'none' | 'unknown' {
  // A reset after the write may follow a forward by the proxy; a refused connection cannot.
  if (reason === 'proof-unreachable')
    return facts.requestWritten ? 'unknown' : 'none'
  // No request was started when the system certificates could not be read, so nothing reached any server.
  if (reason === 'proof-unclassified' && facts.proofNotStarted === true)
    return 'none'
  return REASONS_THAT_REACHED_A_RESPONDER.has(reason) ? 'unknown' : 'none'
}

/**
 * Words the opening of a refusal with the normalized origin and what was stopped.
 *
 * Called by {@link reverseProxyRefusal}.
 * @param reason - The refusal reason.
 * @param facts - {@link ReverseProxyRefusalFacts}; `resourcesReleased` decides whether the stop is claimed.
 * @returns The opening sentence.
 * @example
 * openingOf('not-resolved', { origin: 'https://app.example.test', upstreamPort: 4310, resourcesReleased: true }) // => 'Codebook did not trust the reverse proxy this run declared (origin https://app.example.test, upstream port 4310), so nothing was started.'
 */
function openingOf(
  reason: ReverseProxyRefusalReason,
  facts: ReverseProxyRefusalFacts,
): string {
  const declared = `Codebook did not trust the reverse proxy this run declared (origin ${facts.origin}, upstream port ${facts.upstreamPort})`
  // Nothing was started for the three reasons decided before the start.
  if (REASONS_BEFORE_START.has(reason))
    return `${declared}, so nothing was started.`
  // Later the stop is claimed only when the run confirmed it.
  return facts.resourcesReleased
    ? `${declared}, so no run browser opened and the development server it started was stopped.`
    : `${declared}, so no run browser opened, and Codebook could not confirm that it stopped the development server it started.`
}

/**
 * Words the `Fix:` sentence of a refusal.
 *
 * Called by {@link reverseProxyRefusal}.
 * @param reason - The refusal reason.
 * @param facts - {@link ReverseProxyRefusalFacts}; only a `proof-unclassified` refusal reads `logId`.
 * @returns The fix; the one for `proof-unclassified` names the log id only when the refusal carries one.
 * @example
 * fixOf('proof-unclassified', { origin: 'https://app.example.test', upstreamPort: 4310, resourcesReleased: true }) // => 'Look for the reverse proxy line in Output > Codebook; ask for a new run only if you know the cause.'
 */
function fixOf(
  reason: ReverseProxyRefusalReason,
  facts: ReverseProxyRefusalFacts,
): string {
  // The saved-session setup refuses without a log id, so its learner gets the variant that needs none.
  if (reason === 'proof-unclassified' && facts.logId === undefined)
    return PROOF_UNCLASSIFIED_FIX_WITHOUT_LOG_ID
  return REASON_FIXES[reason]
}

/**
 * Builds the `details` of a refusal: the fixed fields and those optional facts that were given.
 *
 * Called by {@link reverseProxyRefusal}.
 * @param reason - The refusal reason.
 * @param facts - {@link ReverseProxyRefusalFacts}.
 * @param sideEffects - What {@link sideEffectsOf} decided.
 * @returns The value-light, secret-free details.
 * @example
 * detailsOf('proof-timeout', { origin: 'https://app.example.test', upstreamPort: 4310, resourcesReleased: true, timeoutMs: 10_000 }, 'unknown').timeoutMs // => 10000
 */
function detailsOf(
  reason: ReverseProxyRefusalReason,
  facts: ReverseProxyRefusalFacts,
  sideEffects: 'none' | 'unknown',
): Record<string, unknown> {
  // Only the facts the caller has become fields; the others stay absent instead of undefined.
  const given = OPTIONAL_DETAIL_FIELDS.filter(
    (field) => facts[field] !== undefined,
  ).map((field) => [field, facts[field]])
  return {
    reason,
    origin: facts.origin,
    upstreamPort: facts.upstreamPort,
    sideEffects,
    browserOpened: false,
    resourcesReleased: facts.resourcesReleased,
    ...Object.fromEntries(given),
  }
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
  const url = new URL(facts.origin)
  const effectivePort =
    Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
  const sentence = REASON_SENTENCES[reason]({
    ...facts,
    host: url.hostname,
    effectivePort,
  })
  const sideEffects = sideEffectsOf(reason, facts)
  // A refusal after which something may have been sent says so before the Fix line.
  const sent = sideEffects === 'unknown' ? ` ${PROOF_GET_SENTENCE}` : ''
  return new StudyError(
    'REVERSE_PROXY_REFUSED',
    `${openingOf(reason, facts)} ${sentence}${sent} Fix: ${fixOf(reason, facts)}`,
    undefined,
    undefined,
    undefined,
    detailsOf(reason, facts, sideEffects),
  )
}
