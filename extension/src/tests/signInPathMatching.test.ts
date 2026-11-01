import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { hideSavedProfilePath } from '../runtimeSupport/utils/hideSavedProfilePath'
import { assertSavedSessionOrigin } from '../utils/assertSavedSessionOrigin'
import { describeNextEntryResponse } from '../utils/describeNextEntryResponse'
import { describeSignInRequiredDetails } from '../utils/describeSignInRequiredDetails'
import { matchSignInPath } from '../utils/matchSignInPath'
import { refusalFailureOf } from '../utils/refusalFailureOf'
import { signInRequiredMessage } from '../utils/signInRequiredMessage'
import { withRunStartRefusalDetails } from '../utils/withRunStartRefusalDetails'

/** The origin of the server Codebook started in these tests; the page opens it as `localhost`. */
const OWNED_ORIGIN = 'http://127.0.0.1:3000'

// Value: protects=CEO-S3 matching; fails_when=/login/ or /login?callbackUrl=x misses /login, /en/login matches without being listed, / is reduced to nothing, or /Login matches; no_claim=none beyond protects
test('a page on a declared sign-in path is recognised with a trailing slash or a query, a locale path only when listed', () => {
  // Arrange
  const declared = ['/login', '/']
  // Act and assert
  assert.equal(
    matchSignInPath(
      new URL('http://localhost:3000/login/'),
      OWNED_ORIGIN,
      declared,
    ),
    '/login',
  )
  assert.equal(
    matchSignInPath(
      new URL('http://localhost:3000/login?callbackUrl=%2Fa'),
      OWNED_ORIGIN,
      declared,
    ),
    '/login',
  )
  assert.equal(
    matchSignInPath(
      new URL('http://localhost:3000/en/login'),
      OWNED_ORIGIN,
      declared,
    ),
    undefined,
  )
  assert.equal(
    matchSignInPath(
      new URL('http://localhost:3000/Login'),
      OWNED_ORIGIN,
      declared,
    ),
    undefined,
  )
  assert.equal(
    matchSignInPath(new URL('http://localhost:3000/'), OWNED_ORIGIN, declared),
    '/',
  )
  assert.equal(
    matchSignInPath(
      new URL('http://localhost:3000/login'),
      OWNED_ORIGIN,
      undefined,
    ),
    undefined,
  )
})

// Value: protects=E4 and the same-origin contract of signInPaths (OCR 1, OCR 13): a page that left the app (an external OAuth sign-in page, Chrome's error page, another port, an unowned [::1]) or whose pathname starts with // is on no declared sign-in path; fails_when=https://github.com/login matches /login, chrome-error://chromewebdata/ matches /, or //x/login is parsed as host x and matches /login; no_claim=the run's own navigation refusal (run tests)
test('a page on another origin, or a pathname starting with //, is on no declared sign-in path', () => {
  // Arrange
  const declared = ['/login', '/']
  // Act
  const answers = [
    matchSignInPath(
      'https://github.com/login?client_id=Iv1abc',
      OWNED_ORIGIN,
      declared,
    ),
    matchSignInPath('chrome-error://chromewebdata/', OWNED_ORIGIN, declared),
    matchSignInPath('http://localhost:4000/login', OWNED_ORIGIN, declared),
    matchSignInPath('http://[::1]:3000/login', OWNED_ORIGIN, declared, false),
    matchSignInPath(
      { origin: 'http://localhost:3000', pathname: '//x/login' },
      OWNED_ORIGIN,
      declared,
    ),
    matchSignInPath('/login', OWNED_ORIGIN, declared),
  ]
  // Assert
  assert.deepEqual(answers, [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ])
  // The same pages on the app's own origin are on a sign-in path, so the absence above is the origin's doing.
  assert.equal(
    matchSignInPath('http://localhost:3000/login', OWNED_ORIGIN, declared),
    '/login',
  )
  assert.equal(
    matchSignInPath('http://[::1]:3000/login', OWNED_ORIGIN, declared, true),
    '/login',
  )
})

// Value: protects=OCR 24: a sign-in path written with non-ASCII characters matches the page, whose location.pathname the browser percent-encodes; fails_when=/ログイン never matches its own page, so the run acts on the sign-in page; no_claim=Chrome's own encoding of other characters (the URL parser's rules stand in)
test('a sign-in path with non-ASCII characters is recognised on the page that percent-encodes it', () => {
  // Arrange
  const declared = ['/ログイン']
  // Act
  const fromNavigation = matchSignInPath(
    new URL('http://localhost:3000/ログイン?next=%2F'),
    OWNED_ORIGIN,
    declared,
  )
  const fromPageRead = matchSignInPath(
    {
      origin: 'http://localhost:3000',
      pathname: '/%E3%83%AD%E3%82%B0%E3%82%A4%E3%83%B3/',
    },
    OWNED_ORIGIN,
    declared,
  )
  // Assert
  assert.equal(fromNavigation, '/ログイン')
  assert.equal(fromPageRead, '/ログイン')
})

// Value: protects=OCR 1 at the readiness check: a same-origin redirect whose path starts with // names no sign-in path; fails_when=a Location of //x/login on the owned origin reads as redirectsToSignIn /login; no_claim=a real Next server
test('a redirect of the entry to a same-origin path starting with // is not a redirect to the sign-in page', () => {
  // Arrange
  const origin = 'http://127.0.0.1:3000'
  // Act
  const described = describeNextEntryResponse(
    307,
    `${origin}//x/login`,
    `${origin}/dashboard`,
    origin,
    ['/login'],
  )
  // Assert
  assert.equal(described.redirectsToSignIn, undefined)
})

// Value: protects=readiness detection input; fails_when=a redirect to /login?callbackUrl=… is not named by its declared path, a cross-origin /login is named, or the raw query appears in the answer; no_claim=a real Next server
test('a redirect of the entry to a declared sign-in path is named by its declared path and its query never leaves', () => {
  // Arrange
  const origin = 'http://127.0.0.1:3000'
  // Act
  const same = describeNextEntryResponse(
    307,
    '/login?callbackUrl=%2Fdashboard&state=SECRETVALUE',
    `${origin}/dashboard`,
    origin,
    ['/login'],
  )
  const alias = describeNextEntryResponse(
    307,
    'http://localhost:3000/login',
    `${origin}/dashboard`,
    origin,
    ['/login'],
  )
  const foreign = describeNextEntryResponse(
    302,
    'https://accounts.example.com/login',
    `${origin}/dashboard`,
    origin,
    ['/login'],
  )
  // Assert
  assert.equal(same.redirectsToSignIn, '/login')
  assert.equal(JSON.stringify(same).includes('SECRETVALUE'), false)
  assert.equal(alias.redirectsToSignIn, '/login')
  assert.equal(foreign.redirectsToSignIn, undefined)
})

// Value: protects=the reason surviving the failure text; fails_when=the reason is lost or an unknown reason is accepted; no_claim=none beyond protects
test('a failure led by SIGN_IN_REQUIRED restores its code and reason, and an unknown reason restores the code alone', () => {
  // Act and assert
  assert.deepEqual(
    refusalFailureOf(
      'SIGN_IN_REQUIRED(redirected-to-sign-in): The page landed.',
    ),
    {
      code: 'SIGN_IN_REQUIRED',
      message: 'The page landed.',
      details: { reason: 'redirected-to-sign-in' },
    },
  )
  assert.deepEqual(refusalFailureOf('SIGN_IN_REQUIRED(because): The page.'), {
    code: 'SIGN_IN_REQUIRED',
    message: 'The page.',
  })
})

// Value: protects=R8 path hiding; fails_when=a spelling of the folder (the lease path, the real path with a prefix, a path with a space) survives in a journal text; no_claim=the journal records themselves (host browser tests)
test('every spelling of the saved folder is replaced in a command line, also with a space in its path', () => {
  // Arrange
  const folder =
    '/Users/ada/Library/Application Support/Code/sign-in-profiles/h1'
  const real = `/private${folder}`
  // Act
  const hidden = hideSavedProfilePath(
    `chrome --user-data-dir=${real} --headless=new --user-data-dir=/other/place`,
    [folder, real],
  )
  // Assert
  assert.equal(
    hidden,
    'chrome --user-data-dir=<saved-session> --headless=new --user-data-dir=<saved-session>',
  )
})

// Value: protects=CEO-V3; fails_when=a non-loopback origin passes or a loopback one is refused; no_claim=none beyond protects
test('the saved session opens only on a loopback origin', () => {
  // Act and assert
  for (const origin of [
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://[::1]:3000',
  ])
    assert.doesNotThrow(() => assertSavedSessionOrigin(origin))
  assert.throws(
    () => assertSavedSessionOrigin('http://192.0.2.10:3000'),
    (error: unknown) =>
      error instanceof StudyError && error.code === 'SIGN_IN_ORIGIN_REFUSED',
  )
})

// Value: protects=DX-5/CEO-R7; fails_when=a start refusal lacks the retry rule or the log id, or an unrelated error gains them; no_claim=the store's own fields (they win)
test('only the saved-session refusals of a run start gain the run, the retry rule and the log id', () => {
  // Arrange
  const inUse = new StudyError('SIGN_IN_PROFILE_IN_USE', 'A Chrome holds it.')
  const other = new StudyError('RUNTIME_FAILED', 'Something else.')
  // Act
  const completed = withRunStartRefusalDetails(inUse, 'codebook://run/r1', 'r1')
  // Assert
  assert.equal(completed.details?.logId, 'r1#start')
  assert.equal(completed.details?.sideEffects, 'none')
  assert.equal(
    withRunStartRefusalDetails(other, 'codebook://run/r1', 'r1'),
    other,
  )
})

// Value: protects=OCR 17 and OCR 36 in the retry rule an agent reads: a run that declared session fresh is told to drop it, session-cookie-only sets up again only with the app's keep-me-signed-in choice, any other reason sets up; fails_when=either case says "set up the saved session, then start one new run", which repeats the same refusal; no_claim=the service's wiring (savedSessionService tests)
test('the retry of a sign-in refusal drops a declared fresh profile, and sets up a session-only sign-in again only with the app keep-me-signed-in choice', () => {
  // Act
  const declaredFresh = describeSignInRequiredDetails({
    reason: 'no-saved-session',
    session: 'fresh',
    sent: 'not-sent',
    logId: 'r1#start',
  })
  const sessionOnly = describeSignInRequiredDetails({
    reason: 'session-cookie-only',
    session: 'saved',
    savedSession: { available: true, state: 'saved', setupAt: '2026-11-02' },
    sent: 'not-sent',
    logId: 'r1#start',
  })
  const none = describeSignInRequiredDetails({
    reason: 'no-saved-session',
    session: 'fresh',
    savedSession: { available: false, state: 'none' },
    sent: 'not-sent',
    logId: 'r1#start',
  })
  // Assert
  assert.equal(
    declaredFresh.retry,
    'Remove session: "fresh" from the configuration, then start one new run.',
  )
  assert.equal(
    sessionOnly.retry,
    "Ask the learner to set up the saved session again only when the app's sign-in page offers to keep them signed in (such as Remember me), choosing it; otherwise start no new run.",
  )
  assert.equal(
    none.retry,
    'Ask the learner to set up the saved session, then start one new run.',
  )
})

// Value: protects=OCR 36 in the run's own sentence: a session the app keeps only while the browser is open names the one setup that can help and stops the loop; fails_when=the sentence ends without telling the agent whether another setup or run helps; no_claim=the editor notice (savedSessionCommands tests)
test('a session-only sign-in names the keep-me-signed-in setup as the only retry', () => {
  // Act
  const message = signInRequiredMessage('session-cookie-only', {
    repositoryName: 'shop',
    landedOn: '/login',
  })
  // Assert
  assert.equal(
    message,
    "The page landed on /login: shop keeps its sign-in only while the browser stays open, so a saved session cannot keep it. The run stopped before it sent anything. Only when the app's sign-in page offers to keep the learner signed in (such as Remember me), ask the learner to set up the saved session again with that choice; otherwise this flow cannot run with a saved session, so do not start another run for it.",
  )
})
