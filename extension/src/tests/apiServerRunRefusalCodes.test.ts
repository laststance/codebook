import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  apiScriptText,
  apiServerHit,
  apiServerRunHarness,
  sendApiRequest,
  type ApiServerRunHarness,
} from './utils/apiServerRunHarness'
import { sendOperation } from './utils/routeHandlerRunHarness'

/**
 * Makes the stand-in API end its debug session the moment the run kills its group, as js-debug does when the debuggee dies.
 * Why it exists: the run must name the refusal that killed the API, not the session loss the kill produces.
 * Called by the tests of this file before the run is prepared.
 * @param harness - The run's harness.
 * @param options - `killFails` makes the kill itself throw, as a group that outlives the stop bound does.
 * @example endSessionOnKill(harness, { killFails: false })
 */
function endSessionOnKill(
  harness: ApiServerRunHarness,
  options: { killFails: boolean },
): void {
  const events: string[] = []
  const push = events.push.bind(events)
  events.push = (...items: string[]): number => {
    const length = push(...items)
    if (items.includes('kill-first')) {
      harness.run.terminated(harness.server!.session)
      if (options.killFails) throw new Error('The API group outlived the stop')
    }
    return length
  }
  harness.fake.events = events
}

/** Lets the loss arbiter settle: it reads the exit fact within a few ticks. @example await settleArbiter() */
async function settleArbiter(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100))
}

/**
 * Prepares the run, sends operation 1 and one API request, then delivers a pause whose executed script is not the declared file.
 * @example await hitDriftedScript(harness)
 */
async function hitDriftedScript(harness: ApiServerRunHarness): Promise<void> {
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendApiRequest(harness, { id: '7', path: '/api/rpc/x' })
  await apiServerHit(harness, {
    scriptText: apiScriptText(
      harness.server!.sealedUrl.replace('file://', ''),
      'var nextTheme = "edited";\n',
    ),
  })
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the seal refusal',
  )
  await settleArbiter()
}

// Value: protects=R1: an API that listens on another port than the declared one is refused as SERVER_NOT_LISTENING naming the declared port, even though killing it ends its debug session; fails_when=the session loss the kill causes turns the failure into SERVER_EXITED; no_claim=a real port scan (ownedApiServer.test.ts)
test('an API on another port ends with SERVER_NOT_LISTENING, not SERVER_EXITED', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    fake: {
      listen: new StudyError(
        'SERVER_NOT_LISTENING',
        'The API listens on port 4101, not the declared 4100.',
      ),
    },
  })
  endSessionOnKill(harness, { killFails: false })
  // Act
  const error = await harness.run.prepare().then(
    () => undefined,
    (thrown: unknown) => thrown as StudyError,
  )
  await settleArbiter()
  // Assert
  assert.deepEqual(
    {
      code: error?.code,
      namesPort: error?.message.includes('4100'),
      leadsWithExit: (harness.run.view().failures[0] ?? '').startsWith(
        'SERVER_EXITED',
      ),
    },
    { code: 'SERVER_NOT_LISTENING', namesPort: true, leadsWithExit: false },
  )
})

// Value: protects=R1 and E-4: a seal refused as source-drift keeps EXPO_WEB_SEAL_FAILED as the run's failure although the kill ends the API's session; fails_when=the failure is SERVER_EXITED; no_claim=a real handler (ownedApiServer.test.ts)
test('a source-drift seal refusal ends with EXPO_WEB_SEAL_FAILED, not SERVER_EXITED', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  endSessionOnKill(harness, { killFails: false })
  // Act
  await hitDriftedScript(harness)
  // Assert
  const failure = harness.run.view().failures[0] ?? ''
  assert.deepEqual(
    {
      sealFailed: failure.startsWith('EXPO_WEB_SEAL_FAILED:'),
    },
    { sealFailed: true },
  )
})

// Value: protects=F4: a seal refusal whose group kill times out keeps EXPO_WEB_SEAL_FAILED and the run resource shows cleanup "failed" with the pid; fails_when=the kill's error replaces the seal refusal or no cleanup failure is recorded; no_claim=a real stuck process
test('a seal refusal whose kill times out keeps its code and reports cleanup failed', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    fake: { closeFails: true },
  })
  endSessionOnKill(harness, { killFails: true })
  // Act
  await hitDriftedScript(harness)
  const view = harness.run.view()
  // Assert
  assert.deepEqual(
    {
      sealFailed: (view.failures[0] ?? '').startsWith('EXPO_WEB_SEAL_FAILED:'),
      cleanup: view.apiServer?.cleanup,
      pid: view.apiServer?.pid,
    },
    { sealFailed: true, cleanup: 'failed', pid: 4242 },
  )
  // The retried Stop of the test's own cleanup closes the group.
  harness.fake.closeFails = false
  harness.fake.events = []
})

// Value: protects=E-6 regression guard: an API that exits by itself while its pause is held still ends the run with SERVER_EXITED; fails_when=the run's own-ending guard swallows a genuine exit; no_claim=js-debug's real order
test('an API that exits by itself while a pause is held ends with SERVER_EXITED', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendApiRequest(harness, { id: '7', path: '/api/rpc/x' })
  await apiServerHit(harness)
  // Act
  harness.fake.exit(9, null, 'segfault in handler')
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the exit failure',
  )
  // Assert
  assert.equal(
    (harness.run.view().failures[0] ?? '').startsWith(
      'SERVER_EXITED(api-server):',
    ),
    true,
  )
})
