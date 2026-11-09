import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  browserOriginOf,
  entryOriginOf,
  isOwnedApplicationOrigin,
  loopbackOriginsOf,
  ownedOriginsOf,
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

// Value: protects=AC 6 the owned origins of a reverseProxy run: the declared origin joins the loopback names of the server's port; fails_when=the declared origin is missing, or replaces the loopback names; no_claim=a page or a browser
test('the owned origins of a run with a declared origin are the loopback names and the declared origin', () => {
  // Arrange
  const reported = 'http://127.0.0.1:4310'

  // Act
  const owned = ownedOriginsOf(reported, false, 'https://app.example.test')

  // Assert
  assert.deepEqual(owned, [
    'http://localhost:4310',
    'http://127.0.0.1:4310',
    'https://app.example.test',
  ])
})

// Value: protects=AC 10 runs without reverseProxy keep their owned origins; fails_when=a run with no declaration gains an origin; no_claim=a run with a declaration
test('the owned origins of a run without a declared origin are the loopback names only', () => {
  // Act
  const owned = ownedOriginsOf('http://127.0.0.1:3165')

  // Assert
  assert.deepEqual(owned, [
    'http://localhost:3165',
    'http://127.0.0.1:3165',
    'http://[::1]:3165',
  ])
})

// Value: protects=AC 6 the declared origin is owned exactly: the same scheme, host and port, and nothing near it; fails_when=another port, scheme or host of the declared name is accepted, or the declared origin is accepted without a declaration; no_claim=redirect handling
test('only the exact declared origin is owned beside the loopback names', () => {
  // Arrange
  const owned = 'http://127.0.0.1:4310'
  const declared = 'https://app.example.test'

  // Act / Assert
  assert.equal(isOwnedApplicationOrigin(declared, owned, true, declared), true)
  for (const page of [
    'https://app.example.test:8443',
    'http://app.example.test',
    'https://other.example.test',
  ])
    assert.equal(isOwnedApplicationOrigin(page, owned, true, declared), false)
  // Without a declaration the declared origin is a foreign page.
  assert.equal(isOwnedApplicationOrigin(declared, owned), false)
})

// Value: protects=AC 6 the entry origin: a proved declaration is where the entry opens, otherwise the loopback browser origin; fails_when=a run without a declaration opens at the declared origin, or a declaring run opens at localhost; no_claim=the navigation itself
test('the entry origin is the declared origin when one is proved and the loopback browser origin otherwise', () => {
  // Act / Assert
  assert.equal(
    entryOriginOf('http://localhost:4310', 'https://app.example.test'),
    'https://app.example.test',
  )
  assert.equal(entryOriginOf('http://localhost:4310'), 'http://localhost:4310')
})
