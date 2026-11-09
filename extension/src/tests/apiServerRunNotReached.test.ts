import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'

import { ACTIVE_TIMEOUT_MS, API_PROCESS_PROBE_MS } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  apiServerRunHarness,
  scriptApiThread,
  type ApiServerRunHarness,
  type ScriptedApiThread,
} from './utils/apiServerRunHarness'
import { realRunInService } from './utils/realRunInService'
import {
  routeHandlerRunHarness,
  sendOperation,
} from './utils/routeHandlerRunHarness'

/** A repository file the API thread waits in, no declared stop's file. */
const WAITING_FILE = 'apps/api/src/lib/pool.ts'

/**
 * Opens an API run whose thread answers as scripted and ends it by letting the not-reached deadline expire.
 * @param context - The test.
 * @param thread - What the API thread answers; a `paused` path is read inside the harness's real repository folder.
 * @returns The harness, with the failure present.
 * @example const harness = await failApiStop(context, { kind: 'running' })
 */
async function failApiStop(
  context: TestContext,
  thread: ScriptedApiThread,
): Promise<ApiServerRunHarness> {
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  scriptApiThread(
    harness,
    thread.kind === 'paused'
      ? {
          ...thread,
          path: join(await realpath(harness.directory), WAITING_FILE),
        }
      : thread,
  )
  await sendOperation(harness, 1)
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the not-reached failure',
  )
  return harness
}

/**
 * Reads the measured API process state of the run's operation failure.
 * @param harness - A harness whose run failed.
 * @returns `serverRender.apiProcess` as plain data.
 * @example apiProcessOf(harness) // { state: 'not-paused' }
 */
function apiProcessOf(harness: ApiServerRunHarness): unknown {
  return JSON.parse(
    JSON.stringify(
      harness.run.view().operationFailure?.serverRender?.apiProcess,
    ),
  )
}

// Value: protects=AC 5 not-reached wording: an API stop that no request reached after its operation fails SERVER_STOP_NOT_REACHED as an "API server handler" with the API's own possibilities (never the Next route-handler ones); fails_when=the failure is a generic timeout, names a route handler or Next's apiResolver, or states a cause as established; why_new=no test reached the API branch of the not-reached wording (handlerKindWords, notReachedPossibilities); seam=none; no_claim=a real API's timing (the stand-in never pauses and the manual clock moves the 20 s bound)
test('an API stop no request reaches fails SERVER_STOP_NOT_REACHED in the API handler words', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  // Act
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the not-reached failure',
  )
  // Assert
  const failure = harness.run.view().failures[0]!
  assert.match(
    failure,
    /^SERVER_STOP_NOT_REACHED: Declared stop apps\/api\/src\/rpc\/switches\.ts:\d+ \(API server handler [^)]*\) was not reached within 20 s after operation 1\. Codebook could not read whether the API process was paused when the deadline ran out\. For a stop in the app's own API these are possibilities, never the established cause: /,
  )
  assert.equal(failure.includes('apiResolver'), false)
})

// Value: protects=the API not-reached wording names the cause the native checks met most: the app's own request deadline ran out while an earlier stop held the request; fails_when=the possibilities leave that cause out, so the chat guesses a client-side or branch cause; no_claim=that the deadline was the cause of this harness run (the stand-in has no deadline; the sentence is a possibility)
test('an API stop no request reaches names the app deadline that ran out during an earlier stop as a possibility', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  // Act
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the not-reached failure',
  )
  // Assert
  assert.equal(
    harness.run
      .view()
      .failures[0]!.includes(
        "the app's own request deadline ran out while an earlier stop held the request (the API's output after the continue may say so)",
      ),
    true,
  )
})

// Value: protects=AC 1' an API stop that no request reached while the API thread stood paused elsewhere in the repository names that place (path relative to the repository, one-based line) in details and in the failure sentence, before the possibilities; fails_when=the state is dropped, the path is absolute or outside the repository form, or the sentence follows the possibilities; no_claim=real js-debug mapping of a frame (the stand-in answers the frame with an absolute source path)
test('an API stop no request reaches names the repository place where the API thread stood paused', async (context) => {
  // Arrange and Act
  const harness = await failApiStop(context, {
    kind: 'paused',
    line: 41,
  })
  // Assert
  const failure = harness.run.view().failures[0]!
  assert.deepEqual(apiProcessOf(harness), {
    state: 'paused',
    at: { path: 'apps/api/src/lib/pool.ts', line: 41 },
  })
  assert.match(
    failure,
    /after operation 1\. When the deadline ran out, the API process was paused at apps\/api\/src\/lib\/pool\.ts:41, a place no declared stop names\. For a stop in the app's own API these are possibilities/,
  )
})

// Value: protects=AC 1' an API stop that no request reached while js-debug answered "Thread is not paused" says the API process was running and the request still waits inside the app; fails_when=the running state reads as unknown or paused, or the sentence is missing; no_claim=why the request waits (the sentence names examples, not a cause the run observed)
test('an API stop no request reaches says the API process was running when js-debug answers that the thread is not paused', async (context) => {
  // Arrange and Act
  const harness = await failApiStop(context, { kind: 'running' })
  // Assert
  assert.deepEqual(apiProcessOf(harness), { state: 'not-paused' })
  assert.match(
    harness.run.view().failures[0]!,
    /after operation 1\. When the deadline ran out, the API process was running, not paused: the request is still waiting inside the app, for example on its database or another service it calls, and the API's own output after the run may name it\. For a stop in the app's own API/,
  )
})

// Value: protects=AC 1' a failure to read the API thread is never reported as running: any other error is unknown; fails_when=an adapter error other than "Thread is not paused" reads as not-paused, which would tell the learner the request waits inside the app; no_claim=which errors js-debug really raises
test('an API stop no request reaches reports unknown when the stack request fails with another error', async (context) => {
  // Arrange and Act
  const harness = await failApiStop(context, {
    kind: 'error',
    message: 'Cannot read stack of an unknown thread',
  })
  // Assert
  assert.deepEqual(apiProcessOf(harness), { state: 'unknown' })
})

// Value: protects=AC 1' a session that never answers ends the run with unknown after the 5 s bound, not before it and not never; fails_when=the run fails before the bound passes, never fails, or reports a guess; no_claim=real time (the harness clock stands for the 5 s bound; the run's own 20 s deadline has passed by then)
test('an API stop no request reaches fails with unknown once the 5 s bound passes on a session that never answers', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  const asked = scriptApiThread(harness, { kind: 'silent' })
  await sendOperation(harness, 1)
  // Act
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(() => asked.includes('threads'), 'the API thread was asked')
  harness.advance(API_PROCESS_PROBE_MS - 1)
  await nextTurn()
  const failuresBeforeBound = harness.run.view().failures.length
  harness.advance(1)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the failure after the bound',
  )
  // Assert
  assert.deepEqual(
    {
      failuresBeforeBound,
      apiProcess: apiProcessOf(harness),
      sentence: harness.run
        .view()
        .failures[0]!.includes(
          'Codebook could not read whether the API process was paused when the deadline ran out. ',
        ),
    },
    {
      failuresBeforeBound: 0,
      apiProcess: { state: 'unknown' },
      sentence: true,
    },
  )
})

// Value: protects=AC 2 details.apiProcess reaches the error the chat reads through the service, as details.apiOutputTail does; fails_when=the service's error builder or sanitizing drops the field; no_claim=the MCP transport (the service error is what the transport serves)
test('details.apiProcess of an unreached API stop reaches the error the chat reads', async (context) => {
  // Arrange
  const { service, receipt, harness } =
    await realRunInService<ApiServerRunHarness>(context, {
      openHarness: (inner) => apiServerRunHarness(inner),
    })
  scriptApiThread(harness, { kind: 'running' })
  await sendOperation(harness, 1)
  // Act
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the not-reached failure',
  )
  // Assert
  const state = service.state(service.record(receipt))
  assert.deepEqual(
    {
      code: state.error?.code,
      apiProcess: (state.error?.details as { apiProcess?: unknown }).apiProcess,
    },
    { code: 'SERVER_STOP_NOT_REACHED', apiProcess: { state: 'not-paused' } },
  )
})

// Value: protects=AC 1' the probe runs for an API stop only: a route-handler stop of a Next app that no request reached asks the debugger nothing and its failure names no API process; fails_when=the probe runs on every not-reached failure; no_claim=Pages, render and browser stops (the same wording path is not entered for them)
test('a Next route-handler stop no request reaches does not ask for the API process', async (context) => {
  // Arrange
  const harness = await routeHandlerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  const commandsBefore = harness.server!.commands.length
  // Act
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the not-reached failure',
  )
  // Assert
  assert.deepEqual(
    {
      commands: harness
        .server!.commands.slice(commandsBefore)
        .filter((command) => command === 'threads' || command === 'stackTrace'),
      apiProcess:
        harness.run.view().operationFailure?.serverRender?.apiProcess ?? null,
    },
    { commands: [], apiProcess: null },
  )
})
