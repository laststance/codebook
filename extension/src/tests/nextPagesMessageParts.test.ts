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

// Value: protects=a bare query part of a URL the dev server logs, which may be a token itself, is hidden whole, beside the named values hidden as before; fails_when=`/reset?3f9ac0d1e2b4` or `?tok` is kept, the fragment changes, or an empty query gains a placeholder; why_new=Cycle 0066 task 15 (the query mask took only name=value parts); seam=none; no_claim=a real dev server's log format
test('quoted Next server output hides a bare query part of a logged URL whole', () => {
  // Act
  const masked = [
    maskNextServerOutput('GET /reset?3f9ac0d1e2b4 200'),
    maskNextServerOutput('/verify?tok&x=1'),
    maskNextServerOutput('/a?x=1#frag'),
    maskNextServerOutput('/a?'),
  ]
  // Assert
  assert.deepEqual(masked, [
    'GET /reset?<redacted> 200',
    '/verify?<redacted>&x=<redacted>',
    '/a?x=<redacted>#frag',
    '/a?',
  ])
})

// Value: protects=a bare token of a URL the dev server logs is hidden whole also where it reads like a parameter name: with base64 `=` padding, or followed by a second `?`; fails_when=`dG9rZW4tc2VjcmV0` or `SECRET` is kept as a name before `=<redacted>`; why_new=Cycle 0066 task 48 (redactedPairsOf kept the text before the first `=` as a name); seam=none; no_claim=a real dev server's log format
test('quoted Next server output hides a padded bare token and a token before a second question mark whole', () => {
  // Act
  const masked = [
    maskNextServerOutput('GET /verify?dG9rZW4tc2VjcmV0== 200'),
    maskNextServerOutput('GET /verify?dG9rZW4= 200'),
    maskNextServerOutput('GET /a?SECRET?x=1 200'),
  ]
  // Assert
  assert.deepEqual(masked, [
    'GET /verify?<redacted> 200',
    'GET /verify?<redacted> 200',
    'GET /a?<redacted> 200',
  ])
})

// Value: protects=a query part with an empty value is masked whole, since `name=` cannot be told from a token with one `=` of padding, while a part with a value keeps its name; fails_when=`debug=` keeps its name (the padded-token leak returns) or `tab=1` loses its name; why_new=Cycle 0066 task 48 (an empty value now marks a bare part); seam=none; no_claim=that the empty-valued name was a secret
test('quoted Next server output masks an empty-valued query part whole and keeps the name of a valued one', () => {
  // Act
  const masked = maskNextServerOutput('GET /a?debug=&tab=1 200')
  // Assert
  assert.equal(masked, 'GET /a?<redacted>&tab=<redacted> 200')
})

// Value: protects=a logged URL inside quotes or brackets hides its token whole and leaves the quote for the assignment masking; fails_when=the query swallows the closing quote or bracket, so a padded token keeps its body as a name or a quoted secret value is masked only up to its first blank; why_new=Cycle 0066 Codex adversarial review (URL_QUERY took quotes into the query); seam=none; no_claim=a real dev server's log format
test('quoted Next server output hides a token of a URL inside quotes or brackets and keeps a quoted secret value masked whole', () => {
  // Act
  const masked = [
    maskNextServerOutput('{"url":"/verify?c2Vzc2lvbi1zZWNyZXQ="}'),
    maskNextServerOutput('(see /verify?dG9rZW4=)'),
    maskNextServerOutput('PASSWORD="correct horse /reset?opaque"'),
  ]
  // Assert
  assert.deepEqual(masked, [
    '{"url":"/verify?<redacted>"}',
    '(see /verify?<redacted>)',
    'PASSWORD=<redacted>',
  ])
})

// Value: protects=a quote inside a logged URL's query value is masked with the value, while a quote that closes the text around the URL still ends the query; fails_when=the query stops at every quote (`?q="SECRET"` keeps SECRET) or a valued part swallows the closing quote of a quoted secret (`horse` survives); why_new=Cycle 0066 /ship pass 2 red team and parent probe (the first quote fix stopped at every quote, and QUERY_VALUE swallowed the closing quote, in the base too); seam=none; no_claim=a real dev server's log format
test('quoted Next server output masks a quote inside a query value and keeps a quote that closes the text around the URL', () => {
  // Act
  const masked = [
    maskNextServerOutput('GET /search?q="SECRET" 200'),
    maskNextServerOutput('GET /cb?code=abc"def 200'),
    maskNextServerOutput('PASSWORD="correct horse /reset?a=b"'),
    maskNextServerOutput(maskNextServerOutput('GET /search?q=x 200')),
  ]
  // Assert
  assert.deepEqual(masked, [
    'GET /search?q=<redacted>" 200',
    'GET /cb?code=<redacted> 200',
    'PASSWORD=<redacted>',
    'GET /search?q=<redacted> 200',
  ])
})

// Value: protects=a quote followed by a comma or bracket inside a logged query value is masked with the rest of the value, as the base did, and only the closers at the very end stay readable; fails_when=a quote plus closer ends the value and leaves its tail (`,cd`, `SECRET`) visible; why_new=Cycle 0066 /ship pass 2 fix-check (a quote stop un-hid what the base hid); seam=none; no_claim=a real dev server's log format
test('quoted Next server output masks the tail of a query value after a quote and a closer', () => {
  // Act
  const masked = [
    maskNextServerOutput('GET /a?x=ab",cd 200'),
    maskNextServerOutput('GET /a?x=abc",SECRET","next":"y"} 200'),
    maskNextServerOutput('(see /a?x=1)'),
  ]
  // Assert
  assert.deepEqual(masked, [
    'GET /a?x=<redacted> 200',
    'GET /a?x=<redacted>"} 200',
    '(see /a?x=<redacted>)',
  ])
})

// Value: protects=a secret-named assignment inside another assignment's value (a forwarded flag) is masked; fails_when=the outer non-secret name's value is skipped whole, so API_TOKEN's or NPM_TOKEN's value survives; why_new=Cycle 0066 native adversarial review (the base pattern leaked it too); seam=none; no_claim=a real dev server's log format
test('quoted Next server output hides a secret-named assignment inside a forwarded flag', () => {
  // Act
  const masked = maskNextServerOutput(
    '--env=API_TOKEN=abc123 --build-arg=NPM_TOKEN=x a=b=c',
  )
  // Assert
  assert.equal(
    masked,
    '--env=API_TOKEN=<redacted> --build-arg=NPM_TOKEN=<redacted> a=b=c',
  )
})

// Value: protects=masking a long run of plain assignments ends in linear time, since a plain name's value is searched again for assignments; fails_when=each plain name rescans its value to the end of the word (seconds on this input); why_new=Cycle 0066 native adversarial review fix (plain values are searched); seam=none; no_claim=a real dev server's output
test('masking a 256 KB run of plain assignments returns it unchanged within one second', () => {
  // Arrange
  const output = 'a='.repeat(131_072)
  // Act
  const startedAt = performance.now()
  const masked = maskNextServerOutput(output)
  const elapsedMs = performance.now() - startedAt
  // Assert
  assert.equal(masked, output)
  // gstack-timing-ok: an explicit bound, since a node:test timeout cannot stop a synchronous body; a linear scan takes milliseconds here, a rescan of each value takes seconds
  assert.ok(elapsedMs < 1_000, `masking took ${elapsedMs} ms`)
})

// Value: protects=a quoted entry path or redirect target hides a padded bare token, a token before a second `?` and an empty-valued flag whole, in the query and the fragment; fails_when=any of them keeps the text before its first `=`; why_new=Cycle 0066 task 48 (redactNextEntryPath shares redactedPairsOf); seam=none; no_claim=the route Next resolves for such a path
test('a quoted Next path hides a padded bare token, a token before a second question mark and an empty-valued flag whole', () => {
  // Act
  const redacted = [
    redactNextEntryPath('/verify?dG9rZW4tc2VjcmV0=='),
    redactNextEntryPath('/a?SECRET?x=1'),
    redactNextEntryPath('/a?flag=&tab=1#dG9rZW4='),
  ]
  // Assert
  assert.deepEqual(redacted, [
    '/verify?<redacted>',
    '/a?<redacted>',
    '/a?<redacted>&tab=<redacted>#<redacted>',
  ])
})

// Value: protects=code a compile error quotes keeps its optional chains readable, since a `?` without a `/` before it in its word is no URL query; fails_when=`user?.profile?.name` is masked; why_new=Cycle 0066 task 15 (bare parts are masked only in a logged URL); seam=none; no_claim=a word that is both a path and code
test('quoted Next server output keeps an optional chain of quoted code readable', () => {
  // Act
  const masked = maskNextServerOutput(
    '  12 |   const name = user?.profile?.name',
  )
  // Assert
  assert.equal(masked, '  12 |   const name = user?.profile?.name')
})

// Value: protects=masking a long dotted run of server output ends in linear time, so a hostile output chunk cannot stall a Pages refusal or the launcher's journal; fails_when=the assignment pattern backtracks quadratically over the run (seconds on this input); why_new=Cycle 0066 task 3 (Cycle 0065 smoke QA measured about 1 s per 64 KB chunk); seam=none; no_claim=a real dev server's output
test('masking a 256 KB dotted run of server output returns it unchanged within one second', () => {
  // Arrange
  const output = 'a.'.repeat(131_072)
  // Act
  const startedAt = performance.now()
  const masked = maskNextServerOutput(output)
  const elapsedMs = performance.now() - startedAt
  // Assert
  assert.equal(masked, output)
  // gstack-timing-ok: an explicit bound, since a node:test timeout cannot stop a synchronous body; a linear scan takes milliseconds here, the quadratic pattern took seconds
  assert.ok(elapsedMs < 1_000, `masking took ${elapsedMs} ms`)
})

// Value: protects=the linear assignment scan keeps today's masking: a secret-named value and a secret-named flag value hidden, a dotted plain name kept; fails_when=TOKEN's or --token's value survives, or a.b=c is masked; why_new=Cycle 0066 task 3 (the assignment pattern was rewritten); seam=none; no_claim=none
test('quoted Next server output still hides secret-named assignments and keeps a dotted plain one', () => {
  // Act
  const masked = maskNextServerOutput('TOKEN=abc a.b=c --token=abc')
  // Assert
  assert.equal(masked, 'TOKEN=<redacted> a.b=c --token=<redacted>')
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

// Value: protects=a page whose path holds an encoded slash is another page than the path with a real slash, so the Pages path checks refuse a client navigation to another route; fails_when=`/posts/a%2Fb` compares equal to `/posts/a/b`, the hex case of an encoded slash matters, `café` stops matching its encoding, or a literal `%2F` text (`%252F`) reads as an encoded slash; why_new=Cycle 0066 task 16 (every escape was decoded, `%2F` included); seam=none; no_claim=the route Next resolves for an encoded slash
test('a page path with an encoded slash is another page than the path with a real slash', () => {
  // Act
  const comparedEqual = [
    nextPathnameOf('/posts/a%2Fb') === nextPathnameOf('/posts/a/b'),
    nextPathnameOf('/posts/a%2fb') === nextPathnameOf('/posts/a%2Fb'),
    nextPathnameOf('/posts/caf%C3%A9') === nextPathnameOf('/posts/café'),
    nextPathnameOf('/posts/a%252Fb') === nextPathnameOf('/posts/a%2Fb'),
  ]
  // Assert
  assert.deepEqual(comparedEqual, [false, true, true, false])
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
