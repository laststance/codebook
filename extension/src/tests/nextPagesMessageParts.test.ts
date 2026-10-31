import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeNextEntryResponse } from '../utils/describeNextEntryResponse'
import { isHotUpdateScriptUrl } from '../utils/isHotUpdateScriptUrl'
import { maskNextServerOutput } from '../utils/maskNextServerOutput'
import { nextPathnameOf } from '../utils/nextPathnameOf'
import { redactNextEntryPath } from '../utils/redactNextEntryPath'

// Value: protects=a redirect target's query and fragment values never reach a Next refusal while their names stay readable; fails_when=a value (a token) is kept or a name is lost; why_new=Cycle 0065 lane C (the service sanitizer masks no query value); seam=none; no_claim=the service's own sanitizer
test('a quoted Next path keeps its query and fragment names and hides every value', () => {
  // Act
  // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every message.
  const redacted = redactNextEntryPath('/login?token=SECRET&next=%2F#frag')
  // Assert
  // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every message.
  assert.equal(redacted, '/login?token=<redacted>&next=<redacted>#<redacted>')
})

// Value: protects=a bare query part, which may be a token itself, is hidden whole; fails_when=`?SECRET` is kept as a name; why_new=Cycle 0065 lane C; seam=none; no_claim=none
test('a quoted Next path hides a bare query part whole', () => {
  // Act
  const redacted = redactNextEntryPath('/reset?SECRET')
  // Assert
  assert.equal(redacted, '/reset?<redacted>')
})

// Value: protects=a page-supplied path cannot carry control characters or unbounded length into a message; fails_when=a line break survives or the path is not cut; why_new=Cycle 0065 lane C (the page and the manifests are untrusted); seam=none; no_claim=none
test('a quoted Next path drops control characters and is cut at its limit', () => {
  // Arrange
  const longPath = `/a\n\u0007${'b'.repeat(300)}`
  // Act
  const redacted = redactNextEntryPath(longPath)
  // Assert
  assert.equal(redacted, `/a${'b'.repeat(254)}…`)
})

// Value: protects=a same-origin redirect of the entry page is kept only as a redacted origin-less path; fails_when=the raw Location, its origin or its token is kept; why_new=Cycle 0065 run sequence step 3; seam=none; no_claim=the HTTP request (nextEntryReadiness tests)
test('a same-origin redirect of the entry page is described by its redacted path', () => {
  // Act
  const entry = describeNextEntryResponse(
    307,
    // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every message.
    'http://localhost:4321/login?token=SECRET#frag',
    'http://127.0.0.1:4321/dashboard',
    'http://127.0.0.1:4321',
  )
  // Assert
  assert.deepEqual(entry, {
    status: 307,
    location: {
      sameOrigin: true,
      // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every message.
      path: '/login?token=<redacted>#<redacted>',
    },
  })
})

// Value: protects=a redirect to another site is kept as "another origin" with nothing of its address; fails_when=its host, path or query is kept; why_new=Cycle 0065 run sequence step 3 (a cross-origin target is never named or fetched); seam=none; no_claim=that nothing fetches it (nextEntryReadiness tests)
test('a redirect of the entry page to another origin keeps nothing of its address', () => {
  // Act
  const entry = describeNextEntryResponse(
    302,
    'https://accounts.example.com/o/oauth?client_secret=SECRET',
    'http://127.0.0.1:4321/',
    'http://127.0.0.1:4321',
  )
  // Assert
  assert.deepEqual(entry, { status: 302, location: { sameOrigin: false } })
})

// Value: protects=a redirect of the entry path to itself is recognized as a loop; fails_when=the loop is not marked; why_new=Cycle 0065 NEXT_ENTRY_REDIRECTED names a redirect loop; seam=none; no_claim=a loop over several hops
test('a redirect of the entry page to its own path and query is marked as a redirect loop', () => {
  // Act
  const entry = describeNextEntryResponse(
    308,
    '/dashboard?tab=1',
    'http://127.0.0.1:4321/dashboard?tab=1',
    'http://127.0.0.1:4321',
  )
  // Assert
  assert.deepEqual(entry, {
    status: 308,
    location: { sameOrigin: true, path: '/dashboard?tab=<redacted>' },
    redirectsToItself: true,
  })
})

// Value: protects=an answer that is no redirect keeps only its status; fails_when=a Location of a non-redirect is described; why_new=Cycle 0065 lane C; seam=none; no_claim=none
test('an entry page answer that is no redirect keeps only its status', () => {
  // Act
  const entry = describeNextEntryResponse(
    404,
    '/elsewhere',
    'http://127.0.0.1:4321/missing',
    'http://127.0.0.1:4321',
  )
  // Assert
  assert.deepEqual(entry, { status: 404 })
})

// Value: protects=quoted Next dev-server output hides cookie, authorization, query and secret-named values the shared redactor leaves, while plain settings stay readable; fails_when=any seeded SECRET survives or NODE_ENV is masked; why_new=Cycle 0065 lane B finding (redactSecretText masks no query or cookie value); seam=none; no_claim=the shared redactor (createOutputRedactor tests)
test('quoted Next server output hides cookie, authorization, query and secret-named values and keeps plain settings', () => {
  // Arrange
  const output = [
    'Set-Cookie: s=SECRET; Path=/; HttpOnly',
    'cookie: theme=dark; sid=SECRET',
    'Authorization: Bearer [masked]',
    "{ 'set-cookie': 's=SECRET' }",
    // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every message.
    ' GET /login?token=SECRET&next=%2F 200 in 12ms',
    'API_KEY=SECRET NODE_ENV=development',
  ].join('\n')
  // Act
  const masked = maskNextServerOutput(output)
  // Assert
  assert.equal(
    masked,
    [
      'Set-Cookie: <redacted>',
      'cookie: <redacted>',
      'Authorization: <redacted>',
      "{ 'set-cookie': <redacted>",
      // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every message.
      ' GET /login?token=<redacted>&next=<redacted> 200 in 12ms',
      'API_KEY=<redacted> NODE_ENV=development',
    ].join('\n'),
  )
})

// Value: protects=the Pages path checks compare paths the way the entry path is resolved (query dropped, trailing slash dropped, segments decoded); fails_when=`/posts/` or `/caf%C3%A9` read as another page than `/posts` or `/café`; why_new=Cycle 0065 final-path and pathname checks; seam=none; no_claim=none
test('a page path and its entry path compare without query, trailing slash or encoding', () => {
  // Act
  const normalized = [
    nextPathnameOf('/posts/?tab=1'),
    nextPathnameOf('/caf%C3%A9'),
    nextPathnameOf('/'),
    nextPathnameOf('/%E0%A4%A'),
  ]
  // Assert
  assert.deepEqual(normalized, ['/posts', '/café', '/', '/%E0%A4%A'])
})

// Value: protects=a Fast Refresh hot-update chunk is told apart from a sealed module address; fails_when=a hot-update chunk with a query is missed or a webpack-internal module is taken for one; why_new=Cycle 0065 (a *.hot-update.js never binds as a sealed module); seam=none; no_claim=none
test('a hot-update chunk address is told apart from a module address', () => {
  // Act
  const verdicts = [
    isHotUpdateScriptUrl(
      'http://localhost:4321/_next/static/webpack/pages/index.0a1b.hot-update.js?ts=1',
    ),
    isHotUpdateScriptUrl(
      'webpack-internal:///(pages-dir-browser)/./src/pages/index.tsx',
    ),
    isHotUpdateScriptUrl(''),
  ]
  // Assert
  assert.deepEqual(verdicts, [true, false, false])
})
