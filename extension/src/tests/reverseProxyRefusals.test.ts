import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REVERSE_PROXY_REFUSAL_REASONS } from '../constants'
import {
  ERROR_RECOVERY,
  REVERSE_PROXY_REFUSAL_RECOVERY,
  StudyError,
} from '../errors'
import {
  reverseProxyRefusal,
  type ReverseProxyRefusalFacts,
} from '../reverseProxyRefusals'
import { withRunStartRefusalDetails } from '../utils/withRunStartRefusalDetails'

const ORIGIN = 'https://app.example.test'
const BASE: ReverseProxyRefusalFacts = {
  origin: ORIGIN,
  upstreamPort: 4310,
  resourcesReleased: true,
}
const OPENING_BEFORE_START =
  'Codebook did not trust the reverse proxy this run declared (origin https://app.example.test, upstream port 4310), so nothing was started.'
const OPENING_AFTER_START =
  'Codebook did not trust the reverse proxy this run declared (origin https://app.example.test, upstream port 4310), so no run browser opened and the development server it started was stopped.'
const SENT =
  "Codebook sent its proof request and, when the browser check ran, the throwaway browser's one request (no cookie), and no operation."

// Value: protects=AC 2 not-resolved wording; fails_when=the opening claims a stop for a run that started nothing, the host is missing or the Fix line changes; no_claim=the run's cleanup
test('not-resolved says nothing was started and names the host with its Fix', () => {
  // Arrange
  const facts = { ...BASE }
  // Act
  const error = reverseProxyRefusal('not-resolved', facts)
  // Assert
  assert.equal(error.code, 'REVERSE_PROXY_REFUSED')
  assert.equal(
    error.message,
    `${OPENING_BEFORE_START} The host app.example.test has no address on this machine. Fix: Map the host to a loopback address with a hosts entry or local DNS, then ask for a new run.`,
  )
  assert.deepEqual(error.details, {
    reason: 'not-resolved',
    origin: ORIGIN,
    upstreamPort: 4310,
    sideEffects: 'none',
    browserOpened: false,
    resourcesReleased: true,
  })
})

// Value: protects=AC 2 not-loopback wording and the first non-loopback address; fails_when=the address is not shown or the sentence claims a started server; no_claim=which address a resolver orders first
test('not-loopback names the first non-loopback address and the proxy-on-this-machine rule', () => {
  // Arrange
  const facts = { ...BASE, address: '10.0.0.5' }
  // Act
  const error = reverseProxyRefusal('not-loopback', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_BEFORE_START} The host app.example.test resolves to 10.0.0.5, which is not a loopback address; Codebook trusts only a proxy on this machine. Fix: Codebook supports a proxy on this machine only; map the host to a loopback address.`,
  )
  assert.equal(error.details?.address, '10.0.0.5')
  assert.equal(error.details?.sideEffects, 'none')
})

// Value: protects=AC 2 same-socket wording with an IPv6 address bracketed before the port; fails_when=the address and port are not joined as a socket or the IPv6 brackets are lost; no_claim=the rule that decides same-socket (the gate)
test('same-socket names the shared socket with the IPv6 address bracketed', () => {
  // Arrange
  const facts = {
    ...BASE,
    origin: 'https://app.example.test:4310',
    address: '::1',
  }
  // Act
  const error = reverseProxyRefusal('same-socket', facts)
  // Assert
  assert.equal(
    error.message,
    "Codebook did not trust the reverse proxy this run declared (origin https://app.example.test:4310, upstream port 4310), so nothing was started. The origin's address [::1]:4310 is the address the development server needs, so the proxy and the server cannot share it. Fix: Declare the port your proxy forwards to, which differs from the port the proxy itself listens on.",
  )
})

// Value: protects=AC 2 proof-unreachable with no request written is side-effect free; fails_when=a refused connection reports unknown side effects or loses its Fix; no_claim=which errno caused it
test('proof-unreachable before the request was written reports no side effects', () => {
  // Arrange
  const facts = {
    ...BASE,
    requestWritten: false,
    address: '127.0.0.1',
    unreachableKind: 'refused',
  } as const
  // Act
  const error = reverseProxyRefusal('proof-unreachable', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} No request completed at ${ORIGIN} (connection refused). Fix: Start your proxy and check that the host maps to the address it listens on.`,
  )
  assert.equal(error.details?.sideEffects, 'none')
})

// Value: protects=D22 a reset after the write may follow a forward, so side effects are unknown; fails_when=a reset reads as none or omits the one-GET sentence; no_claim=that the proxy did forward
test('proof-unreachable after the request was written reports unknown side effects', () => {
  // Arrange
  const facts = {
    ...BASE,
    requestWritten: true,
    unreachableKind: 'reset',
  } as const
  // Act
  const error = reverseProxyRefusal('proof-unreachable', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} No request completed at ${ORIGIN} (connection reset). ${SENT} Fix: Start your proxy and check that the host maps to the address it listens on.`,
  )
  assert.equal(error.details?.sideEffects, 'unknown')
})

// Value: protects=AC 2 proof-wrong-server with its status; fails_when=the status or the port is missing, or side effects read none; no_claim=what the other responder was
test('proof-wrong-server names the status and the port and reports unknown side effects', () => {
  // Arrange
  const facts = { ...BASE, status: 404, address: '127.0.0.1' }
  // Act
  const error = reverseProxyRefusal('proof-wrong-server', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} ${ORIGIN} answered with status 404 but not with the identity of the development server Codebook started on port 4310. ${SENT} Fix: Check the port in your proxy's configuration (proxy_pass, reverse_proxy) and that it forwards this path to the app's dev server without requiring sign-in.`,
  )
  assert.equal(error.details?.status, 404)
  assert.equal(error.details?.sideEffects, 'unknown')
})

// Value: protects=AC 2 proof-redirected differs from proof-wrong-server by status and wording; fails_when=a redirect is worded as a wrong server or drops its status; no_claim=where the redirect pointed (never shown)
test('proof-redirected names the redirect status and says Codebook follows none', () => {
  // Arrange
  const facts = { ...BASE, status: 301 }
  // Act
  const error = reverseProxyRefusal('proof-redirected', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} ${ORIGIN} answered with a redirect (status 301); Codebook follows none. ${SENT} Fix: Declare the scheme and port your proxy serves directly.`,
  )
  assert.equal(error.details?.status, 301)
})

// Value: protects=AC 2 proof-timeout names the bound; fails_when=the bound is not shown or is not a detail; no_claim=why the proxy stalled
test('proof-timeout names the bound it waited', () => {
  // Arrange
  const facts = { ...BASE, timeoutMs: 10000 }
  // Act
  const error = reverseProxyRefusal('proof-timeout', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} ${ORIGIN} did not answer within 10000 ms. ${SENT} Fix: Check that your proxy and the server behind it respond.`,
  )
  assert.equal(error.details?.timeoutMs, 10000)
})

// Value: protects=AC 2 proof-unclassified points to the Output log id; fails_when=the log id is not in the message and the details; no_claim=what the unclassified error was
test('proof-unclassified names the log id to look up', () => {
  // Arrange
  const facts = { ...BASE, logId: 'r1#start' }
  // Act
  const error = reverseProxyRefusal('proof-unclassified', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} The proof request to ${ORIGIN} failed in a way Codebook does not classify (log id r1#start). ${SENT} Fix: Look up the log id in Output > Codebook.`,
  )
  assert.equal(error.details?.logId, 'r1#start')
  assert.equal(error.details?.sideEffects, 'unknown')
})

// Value: protects=O3-2 a refused connection, a missing route and a reset are told apart in the sentence; fails_when=two kinds read alike or the no-route kind falls back to the refused sentence; no_claim=which errno caused each kind
test('proof-unreachable names connection refused, no route and connection reset as three sentences', () => {
  // Arrange
  const sentenceOf = (unreachableKind: 'refused' | 'no-route' | 'reset') =>
    reverseProxyRefusal('proof-unreachable', {
      ...BASE,
      requestWritten: false,
      unreachableKind,
    }).message
  // Act
  const refused = sentenceOf('refused')
  const noRoute = sentenceOf('no-route')
  const reset = sentenceOf('reset')
  // Assert
  assert.match(
    refused,
    /No request completed at https:\/\/app\.example\.test \(connection refused\)\. Fix:/,
  )
  assert.match(
    noRoute,
    /No request completed at https:\/\/app\.example\.test \(no route\)\. Fix:/,
  )
  assert.match(
    reset,
    /No request completed at https:\/\/app\.example\.test \(connection reset\)\. Fix:/,
  )
})

// Value: protects=C4-4 a refusal without a log id (the saved-session setup) does not send the learner to a log id that does not exist; fails_when=the Fix still says Look up the log id; no_claim=that the Output line exists
test('proof-unclassified without a log id sends the learner to the reverse proxy line of the Output', () => {
  // Arrange
  const facts = { ...BASE }
  // Act
  const error = reverseProxyRefusal('proof-unclassified', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} The proof request to ${ORIGIN} failed in a way Codebook does not classify. ${SENT} Fix: Look for the reverse proxy line in Output > Codebook; ask for a new run only if you know the cause.`,
  )
  assert.equal(error.details?.logId, undefined)
})

// Value: protects=C3-5 a failure before the proof request reports that nothing was sent; fails_when=the refusal claims one GET was sent or reports unknown side effects although no request was started; no_claim=the system trust store itself
test('proof-unclassified before the proof request was started reports no side effects and no GET sentence', () => {
  // Arrange
  const facts = { ...BASE, logId: 'r1#start', proofNotStarted: true }
  // Act
  const error = reverseProxyRefusal('proof-unclassified', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} The proof request to ${ORIGIN} failed in a way Codebook does not classify (log id r1#start). Fix: Look up the log id in Output > Codebook.`,
  )
  assert.equal(error.details?.sideEffects, 'none')
  assert.equal('proofNotStarted' in (error.details ?? {}), false)
})

// Value: protects=O3-4 the Output line the service writes is the one logId names; fails_when=a logId carried by the refusal replaces the service's run id line; no_claim=the run's own id scheme
test('the service run id names the log line even when the refusal carries another log id', () => {
  // Arrange
  const refusal = reverseProxyRefusal('proof-unclassified', {
    ...BASE,
    logId: 'other-run#start',
  })
  // Act
  const details = withRunStartRefusalDetails(
    refusal,
    'codebook://run/r1',
    'r1',
  ).details
  // Assert
  assert.equal(details?.logId, 'r1#start')
})

// Value: protects=C2-10 the base recovery does not claim a stop for the three reasons that start nothing; fails_when=the text again says the development server was stopped without naming not-resolved, not-loopback and same-socket; no_claim=the per-reason sentences
test('the base recovery says which reasons start nothing and so stop nothing', () => {
  // Arrange
  const recovery = ERROR_RECOVERY.REVERSE_PROXY_REFUSED
  // Act
  const clause =
    'Codebook sent no operation; for every reason except not-resolved, not-loopback and same-socket, which start nothing, it stopped the development server it started, and details.resourcesReleased says whether that stop was confirmed (when it is false, start no run, read the run resource and tell the learner)'
  // Assert
  assert.ok(recovery.includes(clause))
})

// Value: protects=AC 2 certificate-untrusted keeps the TLS code and no side effects; fails_when=the TLS code is lost or the handshake failure reads unknown; no_claim=which issuer is missing
test('certificate-untrusted names the TLS code and reports no side effects', () => {
  // Arrange
  const facts = { ...BASE, tlsCode: 'SELF_SIGNED_CERT_IN_CHAIN' }
  // Act
  const error = reverseProxyRefusal('certificate-untrusted', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} This system does not trust the certificate chain of ${ORIGIN} (SELF_SIGNED_CERT_IN_CHAIN). Fix: Add the issuer of your local certificate to the system trust store (the tool that created the certificate has an install command).`,
  )
  assert.equal(error.details?.tlsCode, 'SELF_SIGNED_CERT_IN_CHAIN')
  assert.equal(error.details?.sideEffects, 'none')
})

// Value: protects=AC 2 certificate-expired wording; fails_when=an expired or not-yet-valid certificate is worded as untrusted; no_claim=the certificate's dates
test('certificate-expired says the certificate expired or is not yet valid', () => {
  // Arrange
  const facts = { ...BASE, tlsCode: 'CERT_HAS_EXPIRED' }
  // Act
  const error = reverseProxyRefusal('certificate-expired', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} The certificate of ${ORIGIN} has expired or is not yet valid (CERT_HAS_EXPIRED). Fix: Renew the proxy's certificate.`,
  )
})

// Value: protects=AC 2 certificate-host-mismatch wording; fails_when=a name mismatch loses its Fix; no_claim=which names the certificate holds
test('certificate-host-mismatch says the certificate does not name its host', () => {
  // Arrange
  const facts = { ...BASE, tlsCode: 'ERR_TLS_CERT_ALTNAME_INVALID' }
  // Act
  const error = reverseProxyRefusal('certificate-host-mismatch', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} The certificate of ${ORIGIN} does not name its host (ERR_TLS_CERT_ALTNAME_INVALID). Fix: Use a certificate that names this host.`,
  )
})

// Value: protects=AC 2 certificate-invalid never offers a bypass; fails_when=the Fix stops saying certificate checks are never bypassed; no_claim=the TLS failure's cause
test('certificate-invalid tells the learner that certificate checks are never bypassed', () => {
  // Arrange
  const facts = { ...BASE, tlsCode: 'ERR_SSL_WRONG_VERSION_NUMBER' }
  // Act
  const error = reverseProxyRefusal('certificate-invalid', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} This system rejected the certificate of ${ORIGIN} (ERR_SSL_WRONG_VERSION_NUMBER). Fix: Check the proxy's certificate; Codebook never bypasses certificate checks.`,
  )
})

// Value: protects=AC 2 browser-certificate-untrusted keeps the browser's error and reports the browser never opened a run page; fails_when=browserOpened turns true or the browser error is lost; no_claim=the browser's trust store contents
test('browser-certificate-untrusted names the browser error and keeps browserOpened false', () => {
  // Arrange
  const facts = { ...BASE, browserError: 'net::ERR_CERT_AUTHORITY_INVALID' }
  // Act
  const error = reverseProxyRefusal('browser-certificate-untrusted', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} The browser rejected the certificate of ${ORIGIN} (net::ERR_CERT_AUTHORITY_INVALID) although the proof accepted it. Fix: Make the browser trust the same certificate issuer; some systems keep a separate browser trust store.`,
  )
  assert.equal(error.details?.browserOpened, false)
  assert.equal(error.details?.sideEffects, 'none')
})

// Value: protects=AC 2 browser-certificate-rejected wording; fails_when=it is worded as untrusted or offers a bypass; no_claim=which net error the browser saw beyond the one shown
test('browser-certificate-rejected tells the learner that certificate checks are never bypassed', () => {
  // Arrange
  const facts = { ...BASE, browserError: 'net::ERR_CERT_DATE_INVALID' }
  // Act
  const error = reverseProxyRefusal('browser-certificate-rejected', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} The browser rejected the certificate of ${ORIGIN} (net::ERR_CERT_DATE_INVALID) although the proof accepted it. Fix: Check the proxy's certificate in the browser; Codebook never bypasses certificate checks.`,
  )
})

// Value: protects=D23 browser-address-mismatch names both addresses and says a system proxy bypass fixes it; fails_when=the checked or the browser's address is missing, or side effects read none; no_claim=which proxy or PAC file routed the browser
test('browser-address-mismatch names the checked and the browser address with unknown side effects', () => {
  // Arrange
  const facts = {
    ...BASE,
    address: '127.0.0.1',
    browserAddress: '10.1.2.3',
  }
  // Act
  const error = reverseProxyRefusal('browser-address-mismatch', facts)
  // Assert
  assert.equal(
    error.message,
    `${OPENING_AFTER_START} The browser reached 10.1.2.3 for ${ORIGIN}, not the checked address 127.0.0.1. ${SENT} Fix: Let the browser reach your host name directly: add it to your system proxy bypass list.`,
  )
  assert.equal(error.details?.browserAddress, '10.1.2.3')
  assert.equal(error.details?.sideEffects, 'unknown')
})

// Value: protects=D25 the opening never claims a stop the run could not confirm; fails_when=resourcesReleased false still says the server was stopped; no_claim=whether the server really runs
test('an unconfirmed cleanup says Codebook could not confirm the stop and reports resourcesReleased false', () => {
  // Arrange
  const facts = { ...BASE, resourcesReleased: false, status: 404 }
  // Act
  const error = reverseProxyRefusal('proof-wrong-server', facts)
  // Assert
  assert.match(
    error.message,
    /^Codebook did not trust the reverse proxy this run declared \(origin https:\/\/app\.example\.test, upstream port 4310\), so no run browser opened, and Codebook could not confirm that it stopped the development server it started\./,
  )
  assert.equal(error.details?.resourcesReleased, false)
})

// Value: protects=D9 the retry rule per reason; fails_when=not-loopback or proof-unclassified allow a normal retry, a common reason loses the two-start budget sentence, or an unconfirmed cleanup still allows a run; no_claim=the service wiring
test('the start retry rule follows the reason and forbids a run when the cleanup is unconfirmed', () => {
  // Arrange
  const refusal = (
    reason: Parameters<typeof reverseProxyRefusal>[0],
    released = true,
  ) =>
    withRunStartRefusalDetails(
      reverseProxyRefusal(reason, { ...BASE, resourcesReleased: released }),
      'codebook://run/r1',
      'r1',
    ).details
  // Act
  const common = refusal('proof-timeout')
  const notLoopback = refusal('not-loopback')
  const unclassified = refusal('proof-unclassified')
  const unreleased = refusal('certificate-expired', false)
  // Assert
  assert.equal(
    common?.retry,
    "After the learner's answer or confirmation, start one new run; this is at most the second start for this question.",
  )
  assert.equal(common?.runUri, 'codebook://run/r1')
  assert.equal(common?.logId, 'r1#start')
  assert.equal(common?.sideEffects, 'unknown')
  assert.equal(
    notLoopback?.retry,
    'Start no run unless the learner says they changed the host mapping.',
  )
  assert.equal(
    unclassified?.retry,
    'Start one new run only if the learner asks.',
  )
  assert.equal(
    unreleased?.retry,
    'Start no run: Codebook could not confirm that it stopped what it started; tell the learner.',
  )
})

// Value: protects=D27 origin-not-proven is retried once with nothing changed; fails_when=the reason falls back to the origin-not-loopback rule; no_claim=the origin check itself
test('a SIGN_IN_ORIGIN_REFUSED without a proof is retried once with nothing changed', () => {
  // Arrange
  const error = new StudyError(
    'SIGN_IN_ORIGIN_REFUSED',
    'The origin has no proof.',
    undefined,
    undefined,
    undefined,
    { reason: 'origin-not-proven' },
  )
  // Act
  const details = withRunStartRefusalDetails(
    error,
    'codebook://run/r1',
    'r1',
  ).details
  // Assert
  assert.equal(
    details?.retry,
    'Change nothing and start one new run; if it repeats, tell the learner and stop.',
  )
})

// Value: protects=D9 the code, its recovery and the reason list stay one list; fails_when=a reason has no recovery sentence, the code loses its recovery or a refusal carries an override; no_claim=the help text
test('every reason has a recovery sentence and the code answers the joined recovery', () => {
  // Arrange
  const recoveryReasons = Object.keys(REVERSE_PROXY_REFUSAL_RECOVERY)
  // Act
  const error = reverseProxyRefusal('not-resolved', BASE)
  // Assert
  assert.deepEqual(recoveryReasons, [...REVERSE_PROXY_REFUSAL_REASONS])
  assert.equal(REVERSE_PROXY_REFUSAL_REASONS.length, 15)
  assert.equal(error.describe().recovery, ERROR_RECOVERY.REVERSE_PROXY_REFUSED)
  assert.match(
    ERROR_RECOVERY.REVERSE_PROXY_REFUSED,
    /codebook:\/\/help\/repository-browser#REVERSE_PROXY_REFUSED/,
  )
})
