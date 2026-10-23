import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  browserOriginOf,
  isOwnedApplicationOrigin,
  loopbackOriginsOf,
} from '../utils/ownedApplicationOrigin'

// Value: protects=port 80 yields origins in the form location.origin reports, without an empty port (F428); fails_when=an origin ends in "localhost:" or keeps ":80", so navigation and every ownership check fail; why_new=CodeRabbit and OCR L1 of the review of e638c1b..7139a69e; seam=pure functions; no_claim=a server on port 80
test('port 80 gives origins without a port and the browser origin without a port', () => {
  // Arrange
  const reported = 'http://127.0.0.1:80'

  // Act
  const browser = browserOriginOf(reported)
  const owned = loopbackOriginsOf(reported)

  // Assert
  assert.equal(browser, 'http://localhost')
  assert.deepEqual(owned, [
    'http://localhost',
    'http://127.0.0.1',
    'http://[::1]',
  ])
  assert.equal(isOwnedApplicationOrigin('http://localhost', reported), true)
})

// Value: protects=the three loopback names at the owned port are one origin and nothing else is (D65); fails_when=another port, host or scheme is accepted; why_new=F426/F428; seam=pure functions; no_claim=the browser
test('localhost, 127.0.0.1 and [::1] at the owned port are owned and other ports and hosts are not', () => {
  // Arrange
  const owned = 'http://127.0.0.1:3165'

  // Act / Assert
  for (const page of [
    'http://localhost:3165',
    'http://127.0.0.1:3165',
    'http://[::1]:3165',
  ])
    assert.equal(isOwnedApplicationOrigin(page, owned), true, page)
  for (const page of [
    'http://localhost:3166',
    'http://example.invalid:3165',
    'https://localhost:3165',
    undefined,
  ])
    assert.equal(isOwnedApplicationOrigin(page, owned), false, String(page))
})

// Value: protects=a host without IPv6 loopback does not accept [::1] as owned (D66); fails_when=[::1] stays owned although Codebook holds no listener there; why_new=F427; seam=pure functions; no_claim=the forwarder
test('[::1] is not owned when the run holds no IPv6 listener', () => {
  // Arrange
  const owned = 'http://127.0.0.1:3165'

  // Act
  const origins = loopbackOriginsOf(owned, false)

  // Assert
  assert.deepEqual(origins, ['http://localhost:3165', 'http://127.0.0.1:3165'])
  assert.equal(
    isOwnedApplicationOrigin('http://[::1]:3165', owned, false),
    false,
  )
})
