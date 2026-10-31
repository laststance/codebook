import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REPOSITORY_RUN_TIMEOUT_MS } from '../constants'
import { StudyError } from '../errors'
import { nextSetupDeadlineRecovery } from '../nextRefusals'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { refusalFailureOf } from '../utils/refusalFailureOf'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

const NO_STOPS: never[] = []

/**
 * The real preparation budget the router-wait test gives its run. The router wait compares `Date.now` with the run's preparation deadline, and the harness's manual clock does not move `Date.now` (its `advance` fires only the run's timers), so only real time reaches that comparison. One second rounds to "1 s" in the deadline sentence whatever few milliseconds pass between setting it and the preparation's start.
 */
const ROUTER_WAIT_BUDGET_MS = 1_000

// --- The router wait's own deadline ---

// Value: protects=the Pages router wait ends the run itself with NEXT_SETUP_DEADLINE, the router step and the router-late recovery when its next poll would pass the setup budget, before any progress timer fires; fails_when=the deadline guard of the router wait is removed and the wait polls past the budget; why_new=Cycle 0066 task 25 (the existing deadline tests fire the progress timer, whose text says the same); seam=a real one-second preparation budget through the run control, since the router wait reads Date.now, which harness.advance does not move; no_claim=the progress timer's text (nextPagesRun tests)
test('a Pages router that is seen but never ready ends the router wait itself at the setup budget with the router-late recovery', async (context) => {
  // Arrange
  const control = {
    signal: new AbortController().signal,
    deadlineAt: 0,
    preparationDeadlineAt: 0,
  }
  const harness = await configuredRuntimeHarness(context, control, NO_STOPS, {
    nextPages: {
      pageStates: [
        { pathname: '/', routerSeen: true, isReady: false, route: '/' },
      ],
    },
  })
  let rejection: unknown
  // Act: the run reads both deadlines when its preparation starts, so they are set right before it.
  control.deadlineAt = Date.now() + REPOSITORY_RUN_TIMEOUT_MS
  control.preparationDeadlineAt = Date.now() + ROUTER_WAIT_BUDGET_MS
  harness.run.prepare().catch((error: unknown) => {
    rejection = error
  })
  const failure = await waitUntil(() => rejection, 'the router wait refusal')
  // Assert
  assert.ok(failure instanceof StudyError, String(failure))
  assert.deepEqual(
    {
      code: failure.code,
      message: failure.message,
      recoveryOverride: failure.recoveryOverride,
    },
    {
      code: 'NEXT_SETUP_DEADLINE',
      message:
        'Repository setup deadline (1 s) exceeded while waiting for the page router to become ready before sending the declared input or click: the router did not become ready within 1 s. Codebook stopped the server it started; the browser Codebook opened was closed and no input or click was sent.',
      recoveryOverride: nextSetupDeadlineRecovery('router-late'),
    },
  )
  assert.equal(harness.mouse.length, 0)
})

// --- The pathname checks around the click point ---

// Value: protects=a Pages page that leaves its entry path while the click target is read receives no click: the pathname read after the click point ends the run with NEXT_ENTRY_REDIRECTED; fails_when=the path check after the click point is removed and the click is sent on the other page; why_new=Cycle 0066 task 26; seam=scripted router states (the fourth read is the check after the click point); no_claim=the timing of a real router.push
test('a Pages page that leaves its entry path while the click target is read receives no click and the run ends as redirected', async (context) => {
  // Arrange
  const atEntry = { pathname: '/', routerSeen: true, isReady: true, route: '/' }
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {
      pageStates: [
        // After the load, then the router wait.
        atEntry,
        atEntry,
        // Right before the click target is read.
        atEntry,
        // Right after the click point was read.
        {
          pathname: '/login',
          routerSeen: true,
          isReady: true,
          route: '/login',
        },
      ],
    },
  })
  await harness.run.prepare()
  // Act
  harness.run.action('click', 'repository-click')
  await waitUntil(
    () => harness.run.view().failures.length > 0 || harness.mouse.length > 0,
    'the redirect refusal or the click',
  )
  // Assert
  assert.deepEqual(refusalFailureOf(harness.run.view().failures[0] ?? ''), {
    code: 'NEXT_ENTRY_REDIRECTED',
    message:
      'The page left the entry path / for /login before the click was sent (a client redirect), so Codebook sent no click; the browser Codebook opened is closed with the run.',
  })
  assert.equal(harness.pagesStateReads(), 4)
  assert.equal(harness.mouse.length, 0)
  assert.equal(harness.run.view().operation?.inputDispatched, false)
})

// Value: protects=a Pages run with initial inputs whose page leaves its entry path before the click tells the agent that the declared inputs were written and no click was sent; fails_when=the before-click moment ignores the initial inputs and the message says only that no click was sent; why_new=Cycle 0066 task 27 (the before-click-after-inputs moment had no test); seam=scripted router states (the fourth read is the check before the click); no_claim=the timing of a real router.push
test('a Pages page with initial inputs that leaves its entry path before the click says the inputs were written and no click was sent', async (context) => {
  // Arrange
  const atEntry = { pathname: '/', routerSeen: true, isReady: true, route: '/' }
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    initialInputs: [{ selector: '#email', text: 'learner@example.invalid' }],
    nextPages: {
      pageStates: [
        // After the load, then the router wait.
        atEntry,
        atEntry,
        // Right before the first initial input.
        atEntry,
        // Right before the click.
        {
          pathname: '/login',
          routerSeen: true,
          isReady: true,
          route: '/login',
        },
      ],
    },
  })
  await harness.run.prepare()
  // Act
  harness.run.action('click', 'repository-click')
  await waitUntil(
    () => harness.run.view().failures.length > 0 || harness.mouse.length > 0,
    'the redirect refusal or the click',
  )
  // Assert
  assert.deepEqual(refusalFailureOf(harness.run.view().failures[0] ?? ''), {
    code: 'NEXT_ENTRY_REDIRECTED',
    message:
      'The page left the entry path / for /login before the click was sent (a client redirect); the declared inputs were written and Codebook sent no click; the browser Codebook opened is closed with the run.',
  })
  assert.deepEqual(harness.insertedTexts, ['learner@example.invalid'])
  assert.equal(harness.mouse.length, 0)
})

// --- Fast Refresh after the click ---

// Value: protects=a Fast Refresh of the sealed module after the click was sent ends a Pages run with SOURCE_CHANGED that also says the click's result was not verified, so the agent claims no result for it; fails_when=the click-unverified suffix is dropped or not chosen for a sent and unverified click; why_new=Cycle 0066 task 28 (only the before-click text had a run test); seam=suppressInputPause keeps the stop from pausing after the click, and announceSealedModule re-announces the module under a new script id; no_claim=a real Fast Refresh
test('a Fast Refresh of the sealed module after the click was sent ends a Pages run saying the click result was not verified', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    nextPages: {},
  })
  harness.suppressInputPause()
  await harness.run.prepare()
  harness.run.action('click', 'repository-click')
  await waitUntil(() => harness.mouse.length === 2, 'the click sent')
  // Act
  harness.announceSealedModule('refreshed')
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the source change',
  )
  // Assert
  assert.deepEqual(refusalFailureOf(harness.run.view().failures[0] ?? ''), {
    code: 'SOURCE_CHANGED',
    message:
      "src/theme.ts changed during the run, so Codebook stopped it. Earlier captured observations remain readable. The click's result was not verified.",
  })
  assert.equal(harness.run.view().operation?.inputDispatched, true)
})
