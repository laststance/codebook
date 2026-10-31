import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REPOSITORY_RUN_TIMEOUT_MS } from '../constants'
import { StudyError } from '../errors'
import { nextSetupDeadlineRecovery } from '../nextRefusals'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

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
