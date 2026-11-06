import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applySetCookies, cookieHeaderOf } from '../utils/applySetCookies'
import { buildSignInBody } from '../utils/buildSignInBody'
import { cookieMaskValues } from '../utils/cookieMaskValues'
import { signInOutcomeOf } from '../utils/signInOutcomeOf'

const NOW_MS = Date.parse('2026-11-06T00:00:00Z')

// protects=the sign-in body carries the declared fields and the typed secret under secretField; fails_when=the secret is missing, misnamed, or a field is dropped; no_claim=the server accepts the body; plain object stands for the parsed config
test('sign-in body holds every declared field and the secret under its field name', () => {
  // Arrange
  const signIn = {
    path: '/api/auth/sign-in/email',
    fields: { email: 'learner@example.test', remember: 'yes' },
    secretField: 'password',
    secret: 'ask-learner' as const,
  }
  // Act
  const body = buildSignInBody(signIn, 'p4ss"word')
  // Assert
  assert.equal(
    body,
    '{"email":"learner@example.test","remember":"yes","password":"p4ss\\"word"}',
  )
})

// protects=cookies are kept in order and replaced by name; fails_when=a later pair does not replace an earlier one or order is lost; no_claim=real Set-Cookie headers from a server
test('later cookie of the same name replaces the earlier one and the header keeps insertion order', () => {
  // Arrange
  const headers = ['a=1; Path=/', 'b=2', 'a=3; HttpOnly']
  // Act
  const cookies = applySetCookies(headers, NOW_MS)
  // Assert
  assert.equal(cookieHeaderOf(cookies), 'a=3; b=2')
})

// protects=attributes never leak into the value or name; fails_when=Path, Domain, Secure, SameSite or HttpOnly changes what is sent; no_claim=scoping rules are applied
test('cookie attributes are ignored', () => {
  // Arrange
  const headers = [
    ' sid = abc123 ; Path=/x; Domain=example.test; Secure; SameSite=Lax; HttpOnly',
  ]
  // Act
  const cookies = applySetCookies(headers, NOW_MS)
  // Assert
  assert.equal(cookieHeaderOf(cookies), 'sid=abc123')
})

// protects=lines that are not cookies are skipped; fails_when=a line without = or with an empty name adds a cookie; no_claim=none
test('malformed cookie lines are ignored', () => {
  // Arrange
  const headers = ['justtext', '=novalue', '  =x', 'ok=1']
  // Act
  const cookies = applySetCookies(headers, NOW_MS)
  // Assert
  assert.equal(cookieHeaderOf(cookies), 'ok=1')
  assert.deepEqual(cookies.seenValues, ['1'])
})

// protects=a deletion removes the session cookie; fails_when=empty value, Max-Age 0, negative Max-Age or past Expires leaves the cookie; no_claim=timezone parsing beyond GMT dates
test('empty value, Max-Age zero, negative Max-Age and past Expires each delete the cookie', () => {
  // Arrange
  const deletions = [
    'sid=',
    'sid=x1; Max-Age=0',
    'sid=x1; Max-Age=-5',
    'sid=x1; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]
  for (const deletion of deletions) {
    // Act
    const cookies = applySetCookies(
      [deletion],
      NOW_MS,
      applySetCookies(['sid=abcdef', 'keep=1'], NOW_MS),
    )
    // Assert
    assert.equal(cookieHeaderOf(cookies), 'keep=1', deletion)
  }
})

// protects=a future Expires and a positive Max-Age keep the cookie; fails_when=they are treated as deletions; no_claim=expiry later in the run
test('future Expires and positive Max-Age keep the cookie', () => {
  // Arrange
  const headers = [
    'a=1; Expires=Fri, 01 Jan 2100 00:00:00 GMT',
    'b=2; Max-Age=60',
  ]
  // Act
  const cookies = applySetCookies(headers, NOW_MS)
  // Assert
  assert.equal(cookieHeaderOf(cookies), 'a=1; b=2')
})

// protects=every value ever seen stays maskable; fails_when=a replaced or deleted value is forgotten, or a value is duplicated; no_claim=none
test('seen values keep replaced and deleted values without duplicates', () => {
  // Arrange
  const first = applySetCookies(['sid=old-value', 'x=same'], NOW_MS)
  // Act
  const second = applySetCookies(
    ['sid=new-value', 'x=same', 'sid=; Max-Age=0'],
    NOW_MS,
    first,
  )
  // Assert
  assert.deepEqual(second.seenValues, ['old-value', 'same', 'new-value'])
  assert.equal(cookieHeaderOf(second), 'x=same')
})

// protects=previous cookies are not mutated; fails_when=applying headers changes the earlier result; no_claim=none
test('applying cookies leaves the previous result unchanged', () => {
  // Arrange
  const previous = applySetCookies(['a=1'], NOW_MS)
  // Act
  applySetCookies(['a=2', 'b=3'], NOW_MS, previous)
  // Assert
  assert.equal(cookieHeaderOf(previous), 'a=1')
  assert.deepEqual(previous.seenValues, ['1'])
})

// protects=no cookie header when nothing is left; fails_when=an empty string is returned; no_claim=none
test('cookie header is undefined when no cookie remains', () => {
  // Arrange
  const cookies = applySetCookies([], NOW_MS)
  // Act
  const header = cookieHeaderOf(cookies)
  // Assert
  assert.equal(header, undefined)
})

// protects=express-session style signed value is masked in every echoed form; fails_when=decoded form, s: stripped form, payload or signature is missing; no_claim=the server echoes these forms
test('mask values for an express-session cookie cover encoded, decoded, unprefixed and split forms', () => {
  // Arrange
  const values = ['s%3Asid123456.sigABCDEF']
  // Act
  const masked = cookieMaskValues(values)
  // Assert
  assert.deepEqual(masked, [
    's%3Asid123456.sigABCDEF',
    's:sid123456.sigABCDEF',
    'sid123456.sigABCDEF',
    'sid123456',
    'sigABCDEF',
  ])
})

// protects=Better Auth token.signature is split at the last dot; fails_when=split happens at the first dot; no_claim=signature encoding
test('mask values split a token and signature at the last dot', () => {
  // Arrange
  const values = ['abc.def.signature1']
  // Act
  const masked = cookieMaskValues(values)
  // Assert
  assert.deepEqual(masked, ['abc.def.signature1', 'signature1', 'abc.def'])
})

// protects=short parts and duplicates never become masks; fails_when=a part under six characters is kept or a candidate repeats; no_claim=none
test('mask values drop parts under six characters, dedupe and sort longest first', () => {
  // Arrange
  const values = ['abc.defghijk', 'abc.defghijk', 'tiny', 'bad%zzvalue']
  // Act
  const masked = cookieMaskValues(values)
  // Assert
  assert.deepEqual(masked, ['abc.defghijk', 'bad%zzvalue', 'defghijk'])
})

// protects=sign-in is judged by status and cookie; fails_when=a redirect, error or cookie-less 2xx counts as signed in; no_claim=the server's real status for wrong passwords
test('sign-in outcome is signed-in only for 2xx with a cookie to send', () => {
  // Arrange
  const withCookie = applySetCookies(['sid=abcdef'], NOW_MS)
  const withoutCookie = applySetCookies([], NOW_MS)
  // Act
  const outcomes = {
    ok: signInOutcomeOf(200, withCookie),
    created: signInOutcomeOf(204, withCookie),
    noCookie: signInOutcomeOf(200, withoutCookie),
    redirect: signInOutcomeOf(302, withCookie),
    unauthorized: signInOutcomeOf(401, withCookie),
    tooMany: signInOutcomeOf(429, withCookie),
    serverError: signInOutcomeOf(500, withCookie),
  }
  // Assert
  assert.deepEqual(outcomes, {
    ok: { kind: 'signed-in' },
    created: { kind: 'signed-in' },
    noCookie: { kind: 'failed', reason: 'no-session-cookie' },
    redirect: { kind: 'failed', reason: 'rejected' },
    unauthorized: { kind: 'failed', reason: 'rejected' },
    tooMany: { kind: 'failed', reason: 'rejected' },
    serverError: { kind: 'failed', reason: 'rejected' },
  })
})
