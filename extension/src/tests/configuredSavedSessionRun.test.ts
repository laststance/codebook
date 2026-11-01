import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import type { RuntimeControl } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { readEvidenceText } from './utils/readEvidenceText'

const OPERATION_ACTION = 'repository-operation'
/** The service's run id, which the store's lock must name. */
const SERVICE_RUN_ID = 'service-run-7'
const pending: RepositoryOperation = {
  kind: 'click',
  title: 'Pending',
  selector: '#pending',
}
const submit: RepositoryOperation = {
  kind: 'click',
  title: 'Create Invoice',
  selector: 'button[type=submit]',
}
const third: RepositoryOperation = {
  kind: 'click',
  title: 'Confirm',
  selector: '#confirm',
}
/** A redirect of the entry page to the sign-in page, as the app's proxy answers a request without a session. */
const REDIRECT_TO_LOGIN = {
  status: 307,
  location: '/login?callbackUrl=%2Fdashboard%2Finvoices',
} as const

/** Builds the control the service gives a run, with its own run id. @example controlOf(context) */
function controlOf(
  context: TestContext,
  outputLines: string[] = [],
): RuntimeControl {
  const abort = new AbortController()
  context.after(() => abort.abort())
  return {
    signal: abort.signal,
    deadlineAt: Date.now() + 300_000,
    preparationDeadlineAt: Date.now() + 300_000,
    runId: SERVICE_RUN_ID,
    outputLog: (line) => outputLines.push(line.text),
  }
}

/** Copies a value out of the run module's realm. @example plain(run.view().session) */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

/** Opens a version 3 harness with the sign-in path declared and the stand-in store bound. @example await signInHarness(context, { savedSession: { admission: 'saved' } }) */
async function signInHarness(
  context: TestContext,
  options: Parameters<typeof configuredRuntimeHarness>[3] = {},
  operations: RepositoryOperation[] = [pending, submit],
  outputLines: string[] = [],
) {
  return configuredRuntimeHarness(
    context,
    controlOf(context, outputLines),
    [],
    {
      entryPath: '/dashboard/invoices',
      ...options,
      operations: {
        operations,
        stopOperations: [operations.length],
        signInPaths: ['/login'],
        ...options.operations,
      },
    },
  )
}

// Value: protects=AC1 run side and the lock's run id (cross-check 5): a version 3 run with a saved session asks the store once, before its server starts, with the service's run id, opens the saved folder and reads session saved with appState kept; fails_when=the store is asked after the server, with the run object's own id, twice, or the view lacks session/appState/savedSession; no_claim=real cookies or a real page (the harness stands in for both)
test('a version 3 run with a saved session asks the store once with the service run id before its server starts, and reads session saved with the app data kept', async (context) => {
  // Arrange
  const harness = await signInHarness(context, {
    savedSession: { admission: 'saved' },
  })
  // Act
  await harness.run.prepare()
  // Assert
  const view = harness.run.view()
  assert.deepEqual(harness.savedSessionCalls, [
    'remember',
    `acquire:${SERVICE_RUN_ID}:saved-if-available`,
    'prepare',
    'recordBrowser',
  ])
  assert.ok(
    harness.releases.indexOf('saved session acquired') <
      harness.releases.indexOf('application acquired'),
  )
  assert.deepEqual(harness.savedProfileFolders, [harness.savedProfileFolder])
  assert.equal(view.session, 'saved')
  assert.equal(view.appState, 'kept')
  assert.deepEqual(plain(view.savedSession), {
    available: true,
    state: 'saved',
    setupAt: '2026-11-02T00:00:00.000Z',
  })
  assert.equal(view.status, 'ready')
})

// Value: protects=ENG-12 release order (cross-check 3, Codex correction 3): the saved session is released after the browser closed and kept when the close could not confirm Chrome's exit, until Stop retries; fails_when=release precedes the browser, or a failed close still releases; no_claim=real process exit (the close is a stand-in)
test('the saved session is released only after the browser closed, and is kept until Stop retries when the close failed', async (context) => {
  // Arrange
  const harness = await signInHarness(context, {
    savedSession: { admission: 'saved' },
    closeFailsOnce: true,
  })
  await harness.run.prepare()

  // Act: the first Stop cannot confirm Chrome's exit.
  await assert.rejects(harness.run.stop(), /exit could not be confirmed/)
  // Assert: the lease is still held.
  assert.equal(harness.savedSessionCalls.includes('release'), false)

  // Act: the retried Stop closes the browser.
  await harness.run.stop()
  // Assert
  assert.equal(harness.savedSessionCalls.at(-1), 'release')
  assert.ok(
    harness.releases.indexOf('browser') <
      harness.releases.indexOf('saved session'),
  )
})

// Value: protects=release on a failure path (the saved session must not stay locked after a failed run); fails_when=a run that failed after its admission never frees the saved session; no_claim=which failure
test('a failed run frees the saved session after its browser closed', async (context) => {
  // Arrange
  const harness = await signInHarness(context, {
    savedSession: { admission: 'saved' },
  })
  await harness.run.prepare()
  // Act
  harness.run.fail('Chrome was killed')
  await waitUntil(
    () => harness.savedSessionCalls.includes('release'),
    'the saved session release',
  )
  // Assert
  assert.ok(
    harness.releases.indexOf('browser') <
      harness.releases.indexOf('saved session'),
  )
})

// Value: protects=AC1 refusal and CEO-V10: without a saved session a run whose entry redirects to the declared sign-in page is refused with SIGN_IN_REQUIRED no-saved-session before the browser opens, nothing is sent, and the editor is told once; fails_when=a browser is launched, an Input request is made, the reason differs or no notice is raised; no_claim=a real proxy redirect
test('without a saved session, an entry that redirects to the sign-in page is refused before the browser opens and sends nothing', async (context) => {
  // Arrange
  const harness = await signInHarness(context, {
    savedSession: { admission: 'no-saved-session' },
    entryAnswer: REDIRECT_TO_LOGIN,
  })
  // Act
  await assert.rejects(harness.run.prepare())
  // Assert
  const view = harness.run.view()
  assert.match(view.failures[0]!, /^SIGN_IN_REQUIRED\(no-saved-session\): /)
  assert.equal(harness.launchConfigurations.length, 0)
  assert.deepEqual(harness.inputRequests, [])
  assert.deepEqual(plain(harness.signInNotices), ['no-saved-session'])
  assert.equal(view.session, 'fresh')
  assert.deepEqual(plain(view.savedSession), {
    available: false,
    state: 'none',
  })
})

// Value: protects=DES-3 setup-not-finished: a run that finds a setup closed before Done starts fresh and names that reason; fails_when=the reason reads no-saved-session or the unconfirmed profile is opened; no_claim=the store's writing of confirmed:false
test('a run started after the setup was closed before Done is refused with setup-not-finished and never opens a saved folder', async (context) => {
  // Arrange
  const harness = await signInHarness(context, {
    savedSession: { admission: 'setup-not-finished' },
    entryAnswer: REDIRECT_TO_LOGIN,
  })
  // Act
  await assert.rejects(harness.run.prepare())
  // Assert
  assert.match(
    harness.run.view().failures[0]!,
    /^SIGN_IN_REQUIRED\(setup-not-finished\): /,
  )
  assert.deepEqual(harness.savedProfileFolders, [])
  assert.equal(harness.run.view().savedSession?.state, 'unconfirmed')
})

// Value: protects=the readiness blocker and the native fact (a proxy-redirected request compiles no route): a saved run whose entry redirects loads the entry once in its browser before any stop is sealed, binds nothing from that load, and loads it again for the run; fails_when=the seal reads before the first navigation, the warm load binds a script, or the run fails with the redirect text; no_claim=that Next compiles the route (the native trial verifies)
test('a saved run whose entry redirects to sign-in loads the entry once before sealing its stops and binds only the real load', async (context) => {
  // Arrange
  const harness = await signInHarness(context, {
    savedSession: { admission: 'saved' },
    entryAnswer: REDIRECT_TO_LOGIN,
  })
  // Act
  await harness.run.prepare()
  // Assert
  const events = harness.run.view().events.map((event) => event.type)
  const warmed = events.indexOf('application.entry-warmed-with-saved-session')
  assert.ok(warmed >= 0)
  assert.ok(warmed < events.indexOf('source.sealed'))
  assert.deepEqual(harness.navigations, [
    'http://localhost:4321/dashboard/invoices',
    'http://localhost:4321/dashboard/invoices',
  ])
  // The module parsed by the warm load is not bound; the real load binds it once, after the seal.
  assert.equal(events.filter((type) => type === 'stop.module-parsed').length, 1)
  assert.ok(
    events.indexOf('stop.module-parsed') > events.indexOf('source.sealed'),
  )
  assert.equal(harness.run.view().status, 'ready')
})

// Value: protects=E6 entry-load detection and ENG-10: a saved run whose browser lands on the sign-in page is refused with redirected-to-sign-in (session-cookie-only for a session-only cookie) before any stop is sealed or operation sent; fails_when=the run seals, reaches ready, or names the other reason; no_claim=cookie expiry detection
test('a saved run that lands on the sign-in page is refused before sealing, with the reason the cookie kind decides', async (context) => {
  for (const [appCookies, reason] of [
    ['persistent', 'redirected-to-sign-in'],
    ['session-only', 'session-cookie-only'],
  ] as const) {
    // Arrange
    const harness = await signInHarness(context, {
      savedSession: { admission: 'saved', appCookies },
      entryAnswer: REDIRECT_TO_LOGIN,
      navigationLandsOn: '/login',
    })
    // Act
    await assert.rejects(harness.run.prepare())
    // Assert
    const view = harness.run.view()
    assert.match(
      view.failures[0]!,
      new RegExp(`^SIGN_IN_REQUIRED\\(${reason}\\): `),
    )
    assert.equal(
      view.events.some((event) => event.type === 'source.sealed'),
      false,
    )
    assert.deepEqual(harness.inputRequests, [])
    assert.deepEqual(plain(harness.signInNotices), [reason])
  }
})

// Value: protects=E6 after-operation detection and DX-5 fields: a client-side redirect to the sign-in page after operation 1 fails the run naming operation 1 as sent, and operation 2 is never sent; fails_when=operation 2 receives an Input request, the failure lacks reason or sent, or NAVIGATION_BEFORE_LAST_OPERATION wins; no_claim=a real router push
test('a client-side redirect to the sign-in page after operation 1 fails the run with SIGN_IN_REQUIRED naming operation 1 as sent', async (context) => {
  // Arrange
  const harness = await signInHarness(
    context,
    { savedSession: { admission: 'saved' } },
    [pending, submit, third],
  )
  await harness.run.prepare()
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().operations?.[0]?.state === 'done',
    'operation 1',
  )
  const requestsBefore = harness.inputRequests.length
  // Act
  harness.landOn('/login', 'within-document')
  // Assert
  const failure = harness.run.view().operationFailure
  assert.equal(failure?.code, 'SIGN_IN_REQUIRED')
  assert.equal(failure?.reason, 'redirected-to-sign-in')
  assert.equal(failure?.operationIndex, 1)
  assert.equal(failure?.sent, 'sent')
  assert.equal(harness.inputRequests.length, requestsBefore)
  assert.deepEqual(plain(harness.signInNotices), ['redirected-to-sign-in'])
})

// Value: protects=E4 precedence: a full load of the sign-in page between operations answers SIGN_IN_REQUIRED, not NAVIGATION_BEFORE_LAST_OPERATION; fails_when=the navigation code is reported; no_claim=none beyond protects
test('a full load of the sign-in page between operations answers SIGN_IN_REQUIRED, not the navigation refusal', async (context) => {
  // Arrange
  const harness = await signInHarness(
    context,
    { savedSession: { admission: 'saved' } },
    [pending, submit, third],
  )
  await harness.run.prepare()
  harness.run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => harness.run.view().operations?.[0]?.state === 'done',
    'operation 1',
  )
  // Act
  harness.landOn('/login/', 'document')
  // Assert
  assert.equal(harness.run.view().operationFailure?.code, 'SIGN_IN_REQUIRED')
})

// Value: protects=AC4/CEO-S15: a version 2 run in a repository with a saved session starts fresh, never calls the store and never refuses a sign-in page; fails_when=the store is asked, a saved folder is used, or a landing on /login fails the run; no_claim=none beyond protects
test('a version 2 run never touches the saved-session store', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(
    context,
    controlOf(context),
    [],
    { participant: 'browser', savedSession: { admission: 'saved' } },
  )
  // Act
  await harness.run.prepare()
  harness.landOn('/login', 'document')
  // Assert
  assert.deepEqual(harness.savedSessionCalls, [])
  assert.deepEqual(harness.savedProfileFolders, [])
  assert.equal(harness.run.view().session, undefined)
  assert.equal(harness.run.view().failures.length, 0)
})

// Value: protects=DX-10: a version 3 run that declares session fresh asks the store for a fresh profile, opens no saved folder and reads session fresh without appState; fails_when=the saved folder is used or appState reads kept; no_claim=Lane C's confirmation skip
test('a version 3 run that declares session fresh opens no saved folder and keeps no app data', async (context) => {
  // Arrange
  const harness = await signInHarness(context, {
    savedSession: { admission: 'no-saved-session' },
    operations: {
      operations: [pending, submit],
      stopOperations: [2],
      session: 'fresh',
    },
  })
  // Act
  await harness.run.prepare()
  // Assert
  const view = harness.run.view()
  assert.ok(
    harness.savedSessionCalls.includes(`acquire:${SERVICE_RUN_ID}:fresh`),
  )
  assert.deepEqual(harness.savedProfileFolders, [])
  assert.equal(view.session, 'fresh')
  assert.equal(view.appState, undefined)
  assert.equal(view.savedSession, undefined)
})

// Value: protects=CEO-S16/DX-8 and SIGN_IN_IN_PROGRESS: a refusal of the store ends the run before any server or Chrome starts and is the error the run fails with; fails_when=adapter.start runs or a launch happens; no_claim=the file lock race (the store's own tests)
test('a refusal of the store starts no server and opens no Chrome', async (context) => {
  // Arrange
  const refusal = new StudyError(
    'BUSY',
    'Another run uses the saved session.',
    undefined,
    undefined,
    undefined,
    { reason: 'profile-in-use', heldBy: 'run' },
  )
  const harness = await signInHarness(context, {
    savedSession: { admission: 'saved', refuse: refusal },
  })
  // Act
  const error = await harness.run.prepare().catch((failure: unknown) => failure)
  // Assert
  assert.equal(error, refusal)
  assert.equal(harness.releases.includes('application acquired'), false)
  assert.equal(harness.launchConfigurations.length, 0)
})

// Value: protects=CEO-V3: a saved run whose server reports a non-loopback origin is refused with SIGN_IN_ORIGIN_REFUSED before the browser opens, and the saved session is freed; fails_when=a launch happens or the lease stays taken; no_claim=real Vite or Next host settings
test('a saved run whose server reports a non-loopback origin is refused before the browser opens and frees the saved session', async (context) => {
  // Arrange
  const harness = await signInHarness(context, {
    savedSession: { admission: 'saved' },
    serverOrigin: 'http://192.0.2.10:4321',
  })
  // Act
  const error = await harness.run.prepare().catch((failure: unknown) => failure)
  await harness.run.stop()
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'SIGN_IN_ORIGIN_REFUSED')
  assert.equal(harness.launchConfigurations.length, 0)
  assert.equal(harness.savedSessionCalls.at(-1), 'release')
})

// Value: protects=D13 (E6 after the last operation): a sign-out flow whose after conditions hold on the sign-in page completes, and an expired session after submit, where they do not hold, answers SIGN_IN_REQUIRED instead of OPERATION_AFTER_NOT_MET; fails_when=a sign-out flow fails, or the expired session reads the after refusal; no_claim=a real sign-out
test('a sign-in page reached after the last operation completes the run when the after conditions hold there and fails it as SIGN_IN_REQUIRED when they do not', async (context) => {
  // Arrange: a sign-out flow, whose result is the sign-in page.
  const signOut = await signInHarness(
    context,
    { savedSession: { admission: 'saved' } },
    [submit],
  )
  await signOut.run.prepare()
  signOut.run.action('op-1', OPERATION_ACTION)
  const stop = await waitUntil(
    () => signOut.run.view().participants.browser.snapshot,
    'the stop',
  )
  // Act
  signOut.landOn('/login', 'document')
  await signOut.run.continue('browser', stop.pause)
  await waitUntil(
    () => signOut.run.view().status === 'completed',
    'the completed sign-out flow',
  )
  // Assert
  assert.equal(signOut.run.view().operationFailure, undefined)
  assert.deepEqual(signOut.signInNotices, [])

  // Arrange: a session that expired after submit; the result never shows.
  const expired = await signInHarness(
    context,
    { savedSession: { admission: 'saved' } },
    [submit],
  )
  await expired.run.prepare()
  expired.run.action('op-1', OPERATION_ACTION)
  const expiredStop = await waitUntil(
    () => expired.run.view().participants.browser.snapshot,
    'the stop',
  )
  expired.landOn('/login', 'document')
  expired.failAfterWith({ conditionIndex: 0, reason: 'not-visible' })
  await expired.run.continue('browser', expiredStop.pause)
  await waitUntil(() => expired.afterReads() > 0, 'the after condition read')
  // Act
  expired.advance(20_000)
  await waitUntil(() => expired.run.view().status === 'failed', 'the failure')
  // Assert
  assert.equal(expired.run.view().operationFailure?.code, 'SIGN_IN_REQUIRED')
  assert.equal(
    expired.run.view().operationFailure?.reason,
    'redirected-to-sign-in',
  )
  assert.deepEqual(plain(expired.signInNotices), ['redirected-to-sign-in'])
})

// Value: protects=G4 / CEO-S25 run side: a session token that rides on the sign-in redirect's query and on the landing URL, and the saved folder's path, are absent from the run resource, its journal, the evidence files, the Output lines, the failure text and the editor notice; fails_when=any of them holds the token or the folder path; no_claim=the cookie jar of the profile (the run never reads cookies) and a debugger value named sessionToken (the stand-in page has none)
test('a session token on the sign-in redirect and the saved folder path are absent from every sink of a refused saved run', async (context) => {
  // Arrange
  const token = 'tok_Zq81xV3mRkP7wL2e'
  const outputLines: string[] = []
  const harness = await signInHarness(
    context,
    {
      savedSession: { admission: 'saved' },
      entryAnswer: {
        status: 307,
        location: `/login?callbackUrl=%2Fdashboard&sessionToken=${token}`,
      },
      navigationLandsOn: `/login?sessionToken=${token}`,
    },
    [pending, submit],
    outputLines,
  )

  // Act
  await assert.rejects(harness.run.prepare())
  await harness.run.stop().catch(() => undefined)

  // Assert
  const sinks = [
    JSON.stringify(harness.run.view()),
    await readEvidenceText(harness.run.view().artifactDirectory),
    outputLines.join('\n'),
    harness.signInNotices.join('\n'),
  ].join('\n')
  assert.equal(sinks.includes(token), false)
  assert.equal(sinks.includes('sessionToken'), false)
  assert.equal(sinks.includes(harness.savedProfileFolder), false)
  assert.equal(sinks.includes('0123abcd'), false)
  // The refusal itself is there, so the absence is not an empty sink.
  assert.match(sinks, /SIGN_IN_REQUIRED\(redirected-to-sign-in\)/)
})
