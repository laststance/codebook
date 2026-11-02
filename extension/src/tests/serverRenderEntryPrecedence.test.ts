import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  armedEntry,
  entryRenderHarness,
  heldEntryPause,
} from './utils/entryRenderHarness'

/** A redirect of the entry page to the sign-in page, as the app's proxy answers a request without a session. */
const REDIRECT_TO_LOGIN = { status: 307, location: '/login' } as const
/** Builds the zero-operation entry-render operations with the sign-in path declared. @example operations: signInOperations() */
const signInOperations = () => ({
  operations: [],
  stopOperations: [0],
  stopParticipants: ['server' as const],
  signInPaths: ['/login'],
})

// Value: protects=X22 precedence of a redirect() during the entry render (AC 19): when the browser commits the redirect target, NEXT_ENTRY_REDIRECTED decides the run and names both paths, whichever stop a shared layout of the target holds; fails_when=the run waits for a load of the target, ends with another code, or names no path; no_claim=Next's real redirect response, and the resume of the target layout's hit (the classification test)
test('a redirect during the entry render ends the run as NEXT_ENTRY_REDIRECTED naming both paths', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, { holdNavigation: true })
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  // Act: the browser commits the redirect target instead of the entry page
  harness.commitMainFrame('/dashboard/other')
  // Assert
  await assert.rejects(prepared)
  const failure = harness.run.view().failures[0]!
  assert.match(failure, /^NEXT_ENTRY_REDIRECTED: /)
  assert.match(failure, /entry path \/dashboard for \/dashboard\/other/)
})

// Value: protects=X22 (AC 19) with the render classification: the shared layout of a redirect target holds the armed stop, its hit is another route's and is resumed without a pause, and the entry rule NEXT_ENTRY_REDIRECTED still decides when the browser commits the target; fails_when=the hit pauses the learner in a render that is not the entry's, or the run ends with another code; no_claim=Next's real redirect response; needs the render hit classification (route read) of the pause intake
test('a redirect during the entry render resumes the target layout hit as another route before NEXT_ENTRY_REDIRECTED ends the run', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, { holdNavigation: true })
  const prepared = harness.run.prepare()
  await armedEntry(harness)
  // Act: the layout of /dashboard/other runs for the redirect target, then the browser commits it
  harness.server!.hit({ route: '/dashboard/other' })
  await waitUntil(
    () => harness.server!.continues.length === 1,
    'the other route hit was resumed',
  )
  harness.commitMainFrame('/dashboard/other')
  // Assert
  await assert.rejects(prepared)
  const view = harness.run.view()
  assert.match(view.failures[0]!, /^NEXT_ENTRY_REDIRECTED: /)
  assert.equal(view.snapshots.length, 0)
})

// Value: protects=X22 and AC 19: on the saved-session second entry load a SIGN_IN_REQUIRED landing wins over the armed entry-render stop, the run has no operation to excuse it, and the armed stop is released; fails_when=a zero-operation run treats the sign-in page as its result, the run waits for the stop, or the stop stays armed; no_claim=real cookies (the stand-in lands the second load on /login)
test('a saved session whose second entry load lands on sign-in ends the zero-operation run as SIGN_IN_REQUIRED and releases the armed stop', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, {
    savedSession: { admission: 'saved' },
    entryAnswer: REDIRECT_TO_LOGIN,
    navigationLandings: ['/dashboard', '/login'],
    documentReadyState: 'complete',
    operations: signInOperations(),
  })
  // Act
  const prepared = harness.run.prepare()
  // Assert
  await assert.rejects(prepared)
  const view = harness.run.view()
  assert.match(
    view.failures[0]!,
    /^SIGN_IN_REQUIRED\(redirected-to-sign-in\): /,
  )
  assert.equal(view.snapshots.length, 0)
  assert.deepEqual(harness.navigations, [
    'http://localhost:4321/dashboard',
    'http://localhost:4321/dashboard',
  ])
  await waitUntil(
    () => harness.server!.isClosed(),
    'the armed stop was released with the server session',
  )
})

// Value: protects=X22 and AC 19: a stop that Next does not reach on the saved-session second load (a cached result) fails with SERVER_STOP_NOT_REACHED, phase entry-render, no input sent; fails_when=the run waits for a pause that cannot come, completes, or names another code or phase; no_claim=what makes Next skip the code (the stand-in loads the page without a hit)
test('a stop that the saved-session second entry load never reaches fails with SERVER_STOP_NOT_REACHED in the entry-render phase', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, {
    savedSession: { admission: 'saved' },
    entryAnswer: REDIRECT_TO_LOGIN,
    navigationLandings: ['/dashboard', '/dashboard'],
    documentReadyState: 'complete',
    operations: signInOperations(),
  })
  // Act
  const prepared = harness.run.prepare()
  // Assert
  await assert.rejects(prepared)
  const view = harness.run.view()
  assert.match(view.failures[0]!, /^SERVER_STOP_NOT_REACHED: /)
  assert.deepEqual(
    JSON.parse(
      JSON.stringify({
        code: view.operationFailure?.code,
        sent: view.operationFailure?.sent,
        phase: view.operationFailure?.serverRender?.phase,
        notReached: view.operationFailure?.serverRender?.notReachedStops,
      }),
    ),
    {
      code: 'SERVER_STOP_NOT_REACHED',
      sent: 'not-sent',
      phase: 'entry-render',
      notReached: ['src/theme.ts:1'],
    },
  )
  assert.deepEqual(harness.inputRequests, [])
})

// Value: protects=AC 19 values: a render pause whose frame holds cookies()/headers() results records only the object markers, never a member (spike: both are objects in the paused frame); fails_when=a member of the cookie store or the headers reaches the pause's values or any stored form of the run; no_claim=the real RequestCookies/Headers classes (plain objects stand in; the marker rule is typeof)
test('an entry-render pause whose frame holds cookies() and headers() results records object markers only', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, {
    inspections: [
      { path: 'nextTheme', mode: 'value', required: true },
      { path: 'cookieStore', mode: 'value', required: false },
      { path: 'requestHeaders', mode: 'value', required: false },
    ],
    inspectionScope: {
      cookieStore: { session: 'cookie-member-7f3a' },
      requestHeaders: { authorization: 'header-member-91bc' },
    },
  })
  const prepared = harness.run.prepare()
  // Act
  const pause = await heldEntryPause(harness)
  harness.setDocumentReadyState('complete')
  await harness.run.continue('server', pause.pause)
  await prepared
  // Assert
  assert.deepEqual(JSON.parse(JSON.stringify(pause.values)), {
    'value:nextTheme': 'dark',
    'value:cookieStore': { type: 'object' },
    'value:requestHeaders': { type: 'object' },
  })
  assert.equal(pause.attribution, 'entry-load')
  const stored = JSON.stringify(harness.run.view())
  assert.doesNotMatch(stored, /cookie-member-7f3a|header-member-91bc/)
})
