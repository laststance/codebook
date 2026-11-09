import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { ACTIVE_TIMEOUT_MS, API_PROCESS_PROBE_MS } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  apiServerHit,
  apiServerRunHarness,
  scriptApiThread,
  sendApiRequest,
  type ApiServerRunHarness,
  type ScriptedApiSession,
  type ScriptedApiThread,
  type ScriptedThreadsAnswer,
} from './utils/apiServerRunHarness'
import { realRunInService } from './utils/realRunInService'
import {
  journalTypes,
  publishedPause,
  routeHandlerRunHarness,
  sendOperation,
} from './utils/routeHandlerRunHarness'

/** A repository file the API thread waits in, no declared stop's file. */
const WAITING_FILE = 'apps/api/src/lib/pool.ts'

/** How long a test watches that something does not happen, in real milliseconds. */
const NOTHING_HAPPENS_WATCH_MS = 300

/**
 * Opens an API run whose threads answer as scripted, without expiring the deadline.
 * @param context - The test.
 * @param threads - What the API thread (or each thread, in order) answers; a `paused` frame's relative `path` is read inside the harness's real repository folder, an absolute one and a js-debug virtual one (`<node_internals>/…`) as given.
 * @param threadsAnswer - How `threads` itself is answered.
 * @param probeOnly - Whether only the probe's requests are scripted (see {@link scriptApiThread}).
 * @returns The harness with operation 1 sent, and the scripted session.
 * @example const { harness, session } = await openScriptedApiRun(context, { kind: 'running' })
 */
async function openScriptedApiRun(
  context: TestContext,
  threads: ScriptedApiThread | readonly ScriptedApiThread[],
  threadsAnswer: ScriptedThreadsAnswer = 'listed',
  probeOnly = false,
): Promise<{ harness: ApiServerRunHarness; session: ScriptedApiSession }> {
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  const root = await realpath(harness.directory)
  const resolved = (Array.isArray(threads) ? threads : [threads]).map(
    (thread): ScriptedApiThread =>
      thread.kind === 'paused' &&
      thread.path !== undefined &&
      !thread.path.startsWith('/') &&
      !thread.path.startsWith('<')
        ? { ...thread, path: join(root, thread.path) }
        : thread,
  )
  const session = scriptApiThread(
    context,
    harness,
    resolved,
    threadsAnswer,
    probeOnly,
  )
  await sendOperation(harness, 1)
  return { harness, session }
}

/**
 * Opens an API run whose threads answer as scripted and ends it by letting the not-reached deadline expire.
 * @param context - The test.
 * @param threads - What the API thread (or each thread, in order) answers.
 * @param threadsAnswer - How `threads` itself is answered.
 * @returns The harness, with the failure present, and the probe's requests as the scripted session recorded them.
 * @example const { harness, asked } = await failApiStop(context, { kind: 'running' })
 */
async function failApiStop(
  context: TestContext,
  threads: ScriptedApiThread | readonly ScriptedApiThread[],
  threadsAnswer: ScriptedThreadsAnswer = 'listed',
): Promise<{ harness: ApiServerRunHarness; asked: string[] }> {
  const { harness, session } = await openScriptedApiRun(
    context,
    threads,
    threadsAnswer,
  )
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the not-reached failure',
  )
  return { harness, asked: session.asked }
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

/**
 * Proves a condition stays false for a bounded real time, polling it.
 * @param condition - What must not become true.
 * @param description - What is watched, named when it does become true.
 * @example await staysFalse(() => failures.length > 0, 'a failure')
 */
async function staysFalse(
  condition: () => boolean,
  description: string,
): Promise<void> {
  await assert.rejects(
    waitUntil(condition, description, NOTHING_HAPPENS_WATCH_MS),
    /Timed out waiting for/,
  )
}

// Value: protects=AC 5 not-reached wording: an API stop that no request reached after its operation fails SERVER_STOP_NOT_REACHED as an "API server handler" with the API's own possibilities (never the Next route-handler ones), and a probe that reads nothing says so; fails_when=the failure is a generic timeout, names a route handler or Next's apiResolver, states a cause as established, or does not ask the scripted session; no_claim=a real API's timing (the stand-in never pauses and the manual clock moves the 20 s bound)
test('an API stop no request reaches fails SERVER_STOP_NOT_REACHED in the API handler words', async (context) => {
  // Arrange and Act
  const { harness, asked } = await failApiStop(context, {
    kind: 'error',
    message: 'Cannot read stack of an unknown thread',
  })
  // Assert
  const failure = harness.run.view().failures[0]!
  assert.match(
    failure,
    /^SERVER_STOP_NOT_REACHED: Declared stop apps\/api\/src\/rpc\/switches\.ts:\d+ \(API server handler [^)]*\) was not reached within 20 s after operation 1\. Codebook could not read whether the API process was paused when the deadline ran out\. For a stop in the app's own API these are possibilities, never the established cause: /,
  )
  assert.equal(failure.includes('apiResolver'), false)
  assert.deepEqual(asked, ['threads', 'stackTrace'])
})

// Value: protects=the API not-reached wording names the cause the native checks met most: the app's own request deadline ran out while an earlier stop held the request; fails_when=the possibilities leave that cause out, so the chat guesses a client-side or branch cause; no_claim=that the deadline was the cause of this harness run (the stand-in has no deadline; the sentence is a possibility)
test('an API stop no request reaches names the app deadline that ran out during an earlier stop as a possibility', async (context) => {
  // Arrange and Act
  const { harness, asked } = await failApiStop(context, { kind: 'running' })
  // Assert
  assert.equal(
    harness.run
      .view()
      .failures[0]!.includes(
        "the app's own request deadline ran out while an earlier stop held the request (the API's output after the continue may say so)",
      ),
    true,
  )
  assert.deepEqual(asked, ['threads', 'stackTrace'])
})

// Value: protects=AC 1' an API stop that no request reached while the API thread stood paused elsewhere in the repository names that place (path relative to the repository, one-based line) in details and in the failure sentence, before the possibilities, and claims nothing about declared stops; fails_when=the state is dropped, the path is absolute or outside the repository form, the sentence follows the possibilities or says the place is no declared stop's; no_claim=real js-debug mapping of a frame (the stand-in answers the frame with an absolute source path)
test('an API stop no request reaches names the repository place where the API thread stood paused', async (context) => {
  // Arrange and Act
  const { harness, asked } = await failApiStop(context, {
    kind: 'paused',
    path: WAITING_FILE,
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
    /after operation 1\. When the deadline ran out, the API process was paused at apps\/api\/src\/lib\/pool\.ts:41\. For a stop in the app's own API these are possibilities/,
  )
  assert.equal(failure.includes('no declared stop'), false)
  assert.deepEqual(asked, ['threads', 'stackTrace'])
})

// Value: protects=AC 1' an API stop that no request reached while js-debug answered "Thread is not paused" says only that the API process was running, not paused at any breakpoint, and that the request may be waiting inside the app or may not have arrived; fails_when=the running state reads as unknown or paused, the sentence claims the request is waiting, or it is missing; no_claim=why the request waits (the sentence names examples, not a cause the run observed)
test('an API stop no request reaches says the API process was running when js-debug answers that the thread is not paused', async (context) => {
  // Arrange and Act
  const { harness, asked } = await failApiStop(context, { kind: 'running' })
  // Assert
  assert.deepEqual(apiProcessOf(harness), { state: 'not-paused' })
  assert.match(
    harness.run.view().failures[0]!,
    /after operation 1\. When the deadline ran out, the API process was running, not paused at any breakpoint\. If the request reached the API, it may be waiting inside the app, for example on its database or another service it calls; or no request reached the line\. For a stop in the app's own API/,
  )
  assert.deepEqual(asked, ['threads', 'stackTrace'])
})

// Value: protects=AC 1' a failure to read the API thread is never reported as running: any other error is unknown; fails_when=an adapter error other than "Thread is not paused" reads as not-paused, which would tell the learner the request waits inside the app; no_claim=which errors js-debug really raises
test('an API stop no request reaches reports unknown when the stack request fails with another error', async (context) => {
  // Arrange and Act
  const { harness, asked } = await failApiStop(context, {
    kind: 'error',
    message: 'Cannot read stack of an unknown thread',
  })
  // Assert
  assert.deepEqual(apiProcessOf(harness), { state: 'unknown' })
  assert.deepEqual(asked, ['threads', 'stackTrace'])
})

// Value: protects=AC 1' only js-debug's exact "Thread is not paused" message reads as running: a longer message that contains it is unknown; fails_when=the match is a substring test, so "Thread is not paused or was disposed" tells the learner the API was running; no_claim=which longer messages js-debug really raises
test('an API stop no request reaches reports unknown when the error only contains the not-paused phrase', async (context) => {
  // Arrange and Act
  const { harness, asked } = await failApiStop(context, {
    kind: 'error',
    message: 'Thread is not paused or was disposed',
  })
  // Assert
  assert.deepEqual(apiProcessOf(harness), { state: 'unknown' })
  assert.deepEqual(asked, ['threads', 'stackTrace'])
})

// Value: protects=AC 1' a paused thread whose frame lies in a dependency, outside the repository or has no source path is still paused, and the failure names no place and claims no location it did not map; fails_when=such a frame reads as running or unknown, a node_modules, outside or sourceless path is named as a repository place, or the sentence claims where an unmapped place lies; no_claim=real js-debug frames of library code
for (const { name, frame } of [
  {
    name: 'in node_modules',
    frame: {
      kind: 'paused',
      path: 'node_modules/pg-pool/index.js',
      line: 7,
    },
  },
  {
    name: 'outside the repository',
    frame: { kind: 'paused', path: '/outside-repository/lib/a.ts', line: 3 },
  },
  { name: 'with no source path', frame: { kind: 'paused', line: 9 } },
] as const) {
  test(`an API stop no request reaches reports paused without a place for a frame ${name}`, async (context) => {
    // Arrange and Act
    const { harness, asked } = await failApiStop(context, frame)
    // Assert
    assert.deepEqual(apiProcessOf(harness), { state: 'paused' })
    assert.equal(
      harness.run
        .view()
        .failures[0]!.includes(
          "the API process was paused at a place Codebook could not map to a file of the repository. For a stop in the app's own API",
        ),
      true,
    )
    assert.deepEqual(asked, ['threads', 'stackTrace'])
  })
}

// Value: protects=AC 1' a paused frame that js-debug names by a virtual path (`<node_internals>/…`) names no repository place, even while the extension host's working folder is the repository; fails_when=the virtual path is resolved against the working folder and named as a repository file; no_claim=which virtual paths a real js-debug sends (the stand-in answers one)
test('an API stop no request reaches names no place for a frame js-debug gives a virtual path', async (context) => {
  // Arrange
  const { harness, session } = await openScriptedApiRun(context, {
    kind: 'paused',
    path: '<node_internals>/internal/process/task_queues',
    line: 95,
  })
  const previousFolder = process.cwd()
  process.chdir(await realpath(harness.directory))
  // Act
  try {
    harness.advance(ACTIVE_TIMEOUT_MS)
    await waitUntil(
      () => harness.run.view().failures.length > 0,
      'the not-reached failure',
    )
  } finally {
    // The working folder goes back before the harness removes the repository.
    process.chdir(previousFolder)
  }
  // Assert
  assert.deepEqual(apiProcessOf(harness), { state: 'paused' })
  assert.deepEqual(session.asked, ['threads', 'stackTrace'])
})

// Value: protects=AC 1' a debug session whose threads request fails or lists no thread reads as unknown, never running; fails_when=an error or an empty list reads as not-paused, which would tell the learner the request waits inside the app; no_claim=real js-debug thread lists
for (const threadsAnswer of ['error', 'empty'] as const) {
  test(`an API stop no request reaches reports unknown when the threads request ${threadsAnswer === 'error' ? 'fails' : 'lists no thread'}`, async (context) => {
    // Arrange and Act
    const { harness, asked } = await failApiStop(
      context,
      { kind: 'running' },
      threadsAnswer,
    )
    // Assert
    assert.deepEqual(apiProcessOf(harness), { state: 'unknown' })
    assert.deepEqual(asked, ['threads'])
  })
}

// Value: protects=AC 1' the state does not depend on thread order: a paused thread decides whether a running thread or a thread whose request failed comes first; fails_when=an earlier running or failed thread hides a later paused one; no_claim=how many threads a real API has
for (const { name, threads } of [
  {
    name: 'a running thread comes first',
    threads: [
      { kind: 'running' },
      { kind: 'paused', path: WAITING_FILE, line: 41 },
    ],
  },
  {
    name: 'a thread whose request failed comes first',
    threads: [
      { kind: 'error', message: 'Cannot read stack' },
      { kind: 'paused', path: WAITING_FILE, line: 41 },
    ],
  },
] as const) {
  test(`an API stop no request reaches reports paused when ${name}`, async (context) => {
    // Arrange and Act
    const { harness, asked } = await failApiStop(context, threads)
    // Assert
    assert.deepEqual(apiProcessOf(harness), {
      state: 'paused',
      at: { path: 'apps/api/src/lib/pool.ts', line: 41 },
    })
    assert.deepEqual(asked, ['threads', 'stackTrace', 'stackTrace'])
  })
}

// Value: protects=AC 1' a paused thread decides at once: a later thread that never answers neither hides it nor holds the failure until the bound; fails_when=the probe waits on the later thread and the run reads unknown at the bound; no_claim=how many threads a real API has
test('an API stop no request reaches reports paused when a later thread never answers', async (context) => {
  // Arrange and Act
  const { harness, asked } = await failApiStop(context, [
    { kind: 'paused', path: WAITING_FILE, line: 41 },
    { kind: 'silent' },
  ])
  // Assert
  assert.deepEqual(apiProcessOf(harness), {
    state: 'paused',
    at: { path: 'apps/api/src/lib/pool.ts', line: 41 },
  })
  assert.deepEqual(asked, ['threads', 'stackTrace'])
})

// Value: protects=AC 1' with several threads, the API is not-paused only when every thread answered that it runs; fails_when=one running thread beside a thread whose request failed reads as not-paused; no_claim=how many threads a real API has
test('an API stop no request reaches reports unknown when one thread runs and another thread fails', async (context) => {
  // Arrange and Act
  const { harness, asked } = await failApiStop(context, [
    { kind: 'running' },
    { kind: 'error', message: 'Cannot read stack' },
  ])
  // Assert
  assert.deepEqual(apiProcessOf(harness), { state: 'unknown' })
  assert.deepEqual(asked, ['threads', 'stackTrace', 'stackTrace'])
})

// Value: protects=AC 1' a session that never answers ends the run with unknown after the 5 s bound, not before it and not never; fails_when=the run fails before the bound passes, never fails, or reports a guess; no_claim=real time (the harness clock stands for the 5 s bound; the run's own 20 s deadline has passed by then)
test('an API stop no request reaches fails with unknown once the 5 s bound passes on a session that never answers', async (context) => {
  // Arrange
  const { harness, session } = await openScriptedApiRun(context, {
    kind: 'silent',
  })
  // Act
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => session.asked.includes('stackTrace'),
    'the API thread was asked',
  )
  harness.advance(API_PROCESS_PROBE_MS - 1)
  // Assert
  await staysFalse(
    () => harness.run.view().failures.length > 0,
    'a failure before the bound',
  )
  harness.advance(1)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the failure after the bound',
  )
  assert.deepEqual(
    {
      apiProcess: apiProcessOf(harness),
      sentence: harness.run
        .view()
        .failures[0]!.includes(
          'Codebook could not read whether the API process was paused when the deadline ran out. ',
        ),
    },
    { apiProcess: { state: 'unknown' }, sentence: true },
  )
})

// Value: protects=AC 1' the probe stops asking once its bound passed: a thread that answers late does not lead to a request for the next thread; fails_when=the loop goes on after the bound and keeps sending stackTrace to a session the run is about to end; no_claim=what js-debug does with a request after the session ended
test('an API stop no request reaches sends no further stack request after the bound passed', async (context) => {
  // Arrange
  const { harness, session } = await openScriptedApiRun(context, [
    { kind: 'silent' },
    { kind: 'running' },
  ])
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => session.asked.includes('stackTrace'),
    'the first thread was asked',
  )
  harness.advance(API_PROCESS_PROBE_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the failure after the bound',
  )
  // Act
  session.releaseSilent()
  // Assert
  await staysFalse(
    () => session.asked.length > 2,
    'a stack request after the bound',
  )
  assert.deepEqual(session.asked, ['threads', 'stackTrace'])
})

// Value: protects=AC 1' a request that reaches the declared stop while the probe still waits keeps the run going: the stale not-reached failure is dropped, the pause is published and the drop is journaled; fails_when=the probe's result fails the run after the late pause was admitted; no_claim=a real API's timing (the manual clock moves the deadline and the bound)
test('an API stop reached while the probe waits keeps the run going and drops the stale failure', async (context) => {
  // Arrange
  const { harness, session } = await openScriptedApiRun(
    context,
    { kind: 'silent' },
    'listed',
    true,
  )
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => session.asked.includes('stackTrace'),
    'the probe was waiting on the API thread',
  )
  // Act
  sendApiRequest(harness, { id: '7', path: '/api/rpc/switches/switchTo' })
  await apiServerHit(harness)
  await publishedPause(harness)
  harness.advance(API_PROCESS_PROBE_MS)
  await waitUntil(
    () => journalTypes(harness).includes('api.process-probe-dropped'),
    'the dropped probe result in the journal',
  )
  // Assert
  assert.deepEqual(
    {
      failures: [...harness.run.view().failures],
      status: harness.run.view().status,
      apiProcess: harness.run.view().operationFailure?.serverRender?.apiProcess,
    },
    { failures: [], status: 'paused-server', apiProcess: undefined },
  )
})

// Value: protects=AC 1' a learner's Stop while the probe still waits leaves a stopped run: the probe's late answer or its bound adds no not-reached failure and no operation failure after the Stop; fails_when=the probe's result composes SERVER_STOP_NOT_REACHED and sets the operation failure of the stopped run; no_claim=a real API's timing (the manual clock moves the deadline and the bound)
test('a run stopped while the probe waits gains no not-reached failure afterwards', async (context) => {
  // Arrange
  const { harness, session } = await openScriptedApiRun(context, {
    kind: 'silent',
  })
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => session.asked.includes('stackTrace'),
    'the probe was waiting on the API thread',
  )
  // Act
  await harness.run.stop()
  session.releaseSilent()
  harness.advance(API_PROCESS_PROBE_MS)
  await staysFalse(
    () => harness.run.view().operationFailure !== undefined,
    'an operation failure after the Stop',
  )
  // Assert
  assert.deepEqual(
    {
      failures: [...harness.run.view().failures],
      status: harness.run.view().status,
      operationFailure: harness.run.view().operationFailure,
    },
    { failures: [], status: 'cancelled', operationFailure: undefined },
  )
})

// Value: protects=AC 2 details.apiProcess reaches the error the chat reads through the service, as details.apiOutputTail does; fails_when=the service's error builder or sanitizing drops the field; no_claim=the MCP transport (the service error is what the transport serves)
test('details.apiProcess of an unreached API stop reaches the error the chat reads', async (context) => {
  // Arrange
  const { service, receipt, harness } =
    await realRunInService<ApiServerRunHarness>(context, {
      openHarness: (inner) => apiServerRunHarness(inner),
    })
  const { asked } = scriptApiThread(context, harness, { kind: 'running' })
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
      asked,
    },
    {
      code: 'SERVER_STOP_NOT_REACHED',
      apiProcess: { state: 'not-paused' },
      asked: ['threads', 'stackTrace'],
    },
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
