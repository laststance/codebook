import assert from 'node:assert/strict'
import { test } from 'node:test'

import { appCookieKindOf } from '../runtimeSupport/utils/appCookieKindOf'

// protects=ENG-10 cookie kind (session-cookie-only is told only when the app's own cookies die with the browser); fails_when=a persistent host-only cookie of a parent host, which the browser never sends to the app, makes the app read as keeping its sign-in; no_claim=which host the setup passes (always localhost today), Chrome's own cookie storage
test('a persistent host-only cookie of a parent host does not make an app whose own cookies are session-only read as persistent', () => {
  // Arrange
  const answer = {
    cookies: [
      { domain: 'localhost', session: false },
      { domain: 'app.localhost', session: true },
    ],
  }
  // Act
  const kind = appCookieKindOf(answer, 'app.localhost')
  // Assert
  assert.equal(kind, 'session-only')
})

// protects=ENG-10 cookie kind for a domain cookie, which the browser sends to every subdomain; fails_when=a persistent cookie written for a parent domain with a leading dot stops counting for the app; no_claim=public suffixes
test('a persistent domain cookie of a parent domain makes the app read as keeping its sign-in', () => {
  // Arrange
  const answer = {
    cookies: [
      { domain: '.localhost', session: false },
      { domain: 'app.localhost', session: true },
    ],
  }
  // Act
  const kind = appCookieKindOf(answer, 'app.localhost')
  // Assert
  assert.equal(kind, 'persistent')
})

// protects=the setup's host (localhost) still reads its own host-only and domain cookies; fails_when=a cookie of exactly the host, with or without the leading dot, is not counted; no_claim=cookies of other ports (cookies ignore ports)
test('host-only and domain cookies of the app host itself both count for the app', () => {
  // Arrange
  const hostOnly = { cookies: [{ domain: 'localhost', session: false }] }
  const domainCookie = { cookies: [{ domain: '.localhost', session: true }] }
  // Act
  const kinds = [
    appCookieKindOf(hostOnly, 'localhost'),
    appCookieKindOf(domainCookie, 'localhost'),
  ]
  // Assert
  assert.deepEqual(kinds, ['persistent', 'session-only'])
})
