import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { hideSavedProfilePath } from '../runtimeSupport/utils/hideSavedProfilePath'
import { assertSavedSessionOrigin } from '../utils/assertSavedSessionOrigin'
import { describeNextEntryResponse } from '../utils/describeNextEntryResponse'
import { matchSignInPath } from '../utils/matchSignInPath'
import { refusalFailureOf } from '../utils/refusalFailureOf'
import { withRunStartRefusalDetails } from '../utils/withRunStartRefusalDetails'

// Value: protects=CEO-S3 matching; fails_when=/login/ or /login?callbackUrl=x misses /login, /en/login matches without being listed, / is reduced to nothing, or /Login matches; no_claim=none beyond protects
test('a page on a declared sign-in path is recognised with a trailing slash or a query, a locale path only when listed', () => {
  // Arrange
  const declared = ['/login', '/']
  // Act and assert
  assert.equal(matchSignInPath('/login/', declared), '/login')
  assert.equal(
    matchSignInPath('http://localhost:3000/login?callbackUrl=%2Fa', declared),
    '/login',
  )
  assert.equal(matchSignInPath('/en/login', declared), undefined)
  assert.equal(matchSignInPath('/Login', declared), undefined)
  assert.equal(matchSignInPath('/', declared), '/')
  assert.equal(matchSignInPath('/login', undefined), undefined)
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
