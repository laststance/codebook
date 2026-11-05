import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { STOP_IMAGE_APPLICATION_NOT_YET_AVAILABLE_TEXT } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { armedEntry, entryRenderHarness } from './utils/entryRenderHarness'
import { pagesServerRun } from './utils/pagesServerRunHarness'

type Harness = Awaited<ReturnType<typeof entryRenderHarness>>

/** The harness options of a run whose Codebook readiness request stays open, so a module evaluation can pause in it. */
const READINESS_HELD = { holdReadiness: true, realSourceRoot: true }

/** The harness options of a run with the saved session: Codebook's own request is redirected to sign-in, the warm-up load is held like a response a pause holds, and the armed second load is the entry render. */
const SAVED_SESSION: Parameters<typeof entryRenderHarness>[1] = {
  realSourceRoot: true,
  holdNavigation: true,
  savedSession: { admission: 'saved' },
  entryAnswer: { status: 307, location: '/login' },
  navigationLandings: ['/dashboard', '/dashboard'],
  documentReadyState: 'complete',
  loadingFromNavigation: 2,
}

/** The stop of a second declaration at column 7 of the same line, a call of the module's function. */
const SECOND_STOP: NonNullable<
  Parameters<typeof entryRenderHarness>[3]
>[number] = {
  line: 1,
  column: 7,
  inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
}

/** Lists the journal event types of a run, in order. @example journalTypes(harness) // ['run.session', …] */
function journalTypes(harness: Harness): string[] {
  return harness.run.view().events.map((event) => event.type)
}

/**
 * Sends the hit of a module's first evaluation: the script carries its own source map (so the run can seal it) and the stack holds the module's top-level frame and its factory.
 * @param harness - The run's harness.
 * @param extra - Further fields of the hit.
 * @example evaluateModule(harness)
 */
function evaluateModule(
  harness: Harness,
  extra: Parameters<NonNullable<Harness['server']>['hit']>[0] = {},
): void {
  const server = harness.server!
  server.setScriptText('server', server.instanceText(';AAAA', server.sealedUrl))
  server.hit({
    stack: 'evaluation',
    generated: { line: 1, column: 0 },
    ...extra,
  })
}

/** Opens a run whose readiness request is held with its provisional breakpoint registered. @example const { harness, prepared } = await heldReadiness(context) */
async function heldReadiness(
  context: TestContext,
  extra: Parameters<typeof entryRenderHarness>[1] = {},
  additionalStops: Parameters<typeof entryRenderHarness>[3] = [],
) {
  const harness = await entryRenderHarness(
    context,
    { ...READINESS_HELD, ...extra },
    undefined,
    additionalStops,
  )
  const prepared = harness.run.prepare()
  await waitUntil(
    () =>
      harness.readinessRequestHeld() &&
      harness.server!.breakpointsAcknowledged() > 0 &&
      journalTypes(harness).includes('preparation.window-opened'),
    'the readiness request sent with the provisional breakpoints registered',
  )
  return { harness, prepared }
}

/** Waits for the published pause of the server. @example const pause = await publishedPause(harness) */
function publishedPause(harness: Harness) {
  return waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published pause',
  )
}

// Value: protects=AC 1 (module-scope server stop, no sign-in): a stop on code that runs when Next first evaluates the module pauses during Codebook's own readiness request and says so; fails_when=the stop is armed only after readiness (today) so no pause comes, or the pause is labelled as the page load; no_claim=a real Next server
test('a module-scope server stop pauses in the readiness request, labelled as a preparation pause of the module', async (context) => {
  // Arrange
  const { harness, prepared } = await heldReadiness(context)
  // Act
  evaluateModule(harness)
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    {
      execution: snapshot.execution,
      attribution: snapshot.attribution,
      scope: snapshot.scope,
      preparationRequest: snapshot.preparationRequest,
      declaredIndex: snapshot.declaredIndex,
      executionIndex: snapshot.executionIndex,
      status: harness.run.view().status,
      navigations: harness.navigations.length,
    },
    {
      execution: 'server-render',
      attribution: 'preparation',
      scope: 'module',
      preparationRequest: 'readiness',
      declaredIndex: 0,
      executionIndex: 0,
      status: 'paused-server',
      navigations: 0,
    },
  )
  // Cleanup: the run goes on to its end
  await harness.run.continue('server', snapshot.pause)
  harness.releaseReadiness()
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
  harness.setDocumentReadyState('complete')
  await prepared
})

// Value: protects=R11 (capture without a browser): a pause in the readiness request has no page to draw, so it publishes "application not yet available" (status absent: no image is owed) and never an image; fails_when=the capture is attempted without a page and fails the pause, an image of a later frame is borrowed, or the missing image is reported as a failed capture; no_claim=the replay of the saved pause
test('a preparation pause in the readiness request publishes without an image and says the application is not yet available', async (context) => {
  // Arrange
  const { harness } = await heldReadiness(context)
  // Act
  evaluateModule(harness)
  await publishedPause(harness)
  // Assert
  assert.deepEqual(
    { ...harness.run.view().captures['paused-server'] },
    {
      status: 'absent',
      error: STOP_IMAGE_APPLICATION_NOT_YET_AVAILABLE_TEXT,
    },
  )
  assert.equal(journalTypes(harness).includes('capture.received'), false)
})

// Value: protects=AC 1 (sign-in): behind sign-in Codebook's own request is redirected, so the module is first evaluated by the saved-session warm load, which pauses with the held navigation; fails_when=the warm load runs before the provisional breakpoint exists, or the warm-up page is bounded by the navigation's own timer; no_claim=the learner's sign-in
test('a module-scope server stop pauses in the saved-session warm load, labelled warm-load', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, {
    ...SAVED_SESSION,
    operations: {
      operations: [],
      stopOperations: [0],
      stopParticipants: ['server'],
      signInPaths: ['/login'],
    },
  })
  const prepared = harness.run.prepare()
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the warm-up navigation started',
  )
  // Act
  evaluateModule(harness)
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    [
      snapshot.attribution,
      snapshot.preparationRequest,
      snapshot.scope,
      harness.heldNavigationCount(),
      harness.run.view().snapshotCaptures?.[snapshot.id]?.status,
    ],
    ['preparation', 'warm-load', 'module', 1, 'absent'],
  )
  // Cleanup
  await harness.run.continue('server', snapshot.pause)
  harness.answerNavigation()
  await waitUntil(
    () => harness.navigations.length >= 2,
    'the entry navigation started',
  )
  harness.answerNavigation()
  await prepared
})

// Value: protects=AC 1 (sign-in, slow compile): while the server has not answered the warm-up load (Next still compiles the route), the old document already reads complete, but the warm load keeps waiting for the answer and the preparation window stays open, so the module's later first evaluation still pauses there; fails_when=the warm load judges the old document as settled, closes the window and the evaluation runs without a breakpoint; no_claim=Next's real compile time
test('the warm load waits for the server to answer before it judges the page, so a slow compile still pauses in the window', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, {
    ...SAVED_SESSION,
    operations: {
      operations: [],
      stopOperations: [0],
      stopParticipants: ['server'],
      signInPaths: ['/login'],
    },
  })
  const prepared = harness.run.prepare()
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the warm-up navigation started',
  )
  // Act: the compile outlasts the page's quiet window while the answer is held
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  const closedWhileCompiling = journalTypes(harness).includes(
    'preparation.window-closed',
  )
  evaluateModule(harness)
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    [
      closedWhileCompiling,
      snapshot.preparationRequest,
      harness.navigations.length,
    ],
    [false, 'warm-load', 1],
  )
  // Cleanup
  await harness.run.continue('server', snapshot.pause)
  harness.answerNavigation()
  await waitUntil(
    () => harness.navigations.length >= 2,
    'the entry navigation started',
  )
  harness.answerNavigation()
  await prepared
})

// Value: protects=AC 3 (a provisional hit inside a function): a call of the stop's function during Codebook's own request is resumed at once and journaled, nothing is published, and the stop pauses at the entry load as before; fails_when=the call is published as the module evaluation, fails the run, or the stop is lost for the entry load; no_claim=a real render
test('a call of the stop function during the readiness request is resumed and journaled, and the stop pauses at the entry load', async (context) => {
  // Arrange
  const { harness, prepared } = await heldReadiness(context)
  // Act
  harness.server!.hit({ stack: 'call' })
  await waitUntil(
    () => harness.server!.continues.length === 1,
    'the call hit resumed by the run',
  )
  // Assert: nothing was published
  assert.equal(harness.run.view().status, 'preparing')
  assert.equal(harness.run.view().participants.server?.snapshot, undefined)
  assert.equal(
    journalTypes(harness).filter(
      (type) => type === 'breakpoint.preparation-hit-resumed',
    ).length,
    1,
  )
  // Act: the readiness request ends and the entry load reaches the stop
  harness.releaseReadiness()
  await armedEntry(harness)
  harness.server!.hit({ route: '/dashboard' })
  const entryPause = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    [entryPause.attribution, entryPause.scope, entryPause.preparationRequest],
    ['entry-load', undefined, undefined],
  )
  await harness.run.continue('server', entryPause.pause)
  harness.setDocumentReadyState('complete')
  await prepared
})

// Value: protects=AC 3 (mixed run): a run with a module-scope stop and a function stop pauses at both in execution order, the first in Codebook's own request and the second at the entry load; fails_when=the second stop is lost, reordered or armed twice; no_claim=real Next
test('a mixed run pauses at the module evaluation first and at the entry load second, in execution order', async (context) => {
  // Arrange
  const { harness, prepared } = await heldReadiness(
    context,
    {
      operations: {
        operations: [],
        stopOperations: [0, 0],
        stopParticipants: ['server', 'server'],
      },
    },
    [SECOND_STOP],
  )
  // Act
  evaluateModule(harness, { hitBreakpoints: ['owned-breakpoint'] })
  const first = await publishedPause(harness)
  await harness.run.continue('server', first.pause)
  // The entry load runs the function of the module, which the compiled chunk holds.
  harness.server!.resetScriptText('server')
  harness.releaseReadiness()
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
  harness.server!.hit({
    generated: { line: 0, column: 6 },
    source: { line: 1, column: 7 },
    route: '/dashboard',
  })
  const second = await waitUntil(
    () => harness.run.view().snapshots[1],
    'the entry pause',
  )
  // Assert
  assert.deepEqual(
    [first, second].map((snapshot) => [
      snapshot.attribution,
      snapshot.declaredIndex,
      snapshot.executionIndex,
    ]),
    [
      ['preparation', 0, 0],
      ['entry-load', 1, 1],
    ],
  )
  await harness.run.continue('server', second.pause)
  harness.setDocumentReadyState('complete')
  await prepared
})

// Value: protects=O2 (after-operation stop): only a stop declared afterOperation 0 gets a provisional breakpoint, so a helper shared with operation 1 is not consumed during Codebook's own request; fails_when=every server stop is registered in the window; no_claim=the later pause of the stop
test('a stop declared after operation 1 gets no provisional breakpoint', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(
    context,
    {
      ...READINESS_HELD,
      operations: {
        operations: [
          {
            kind: 'click',
            title: 'Create Invoice',
            selector: 'button[type=submit]',
          },
        ],
        stopOperations: [0, 1],
        stopParticipants: ['server', 'server'],
      },
    },
    undefined,
    [SECOND_STOP],
  )
  // Act
  harness.run.prepare().catch(() => undefined)
  await waitUntil(
    () => journalTypes(harness).includes('preparation.window-opened'),
    'the window opened',
  )
  // Assert
  const opened = harness.run
    .view()
    .events.find((event) => event.type === 'preparation.window-opened')
  assert.deepEqual(opened?.detail, {
    stops: [{ declaredIndex: 0, requestedLine: 1 }],
  })
})

// Value: protects=O2 / AC 3 (after-operation stops keep today's path): a stop declared after operation 1 whose module is evaluated after the operation pauses as an after-operation render with today's labels, never as a module evaluation; fails_when=the evaluation-shaped stack labels it scope module (saved as format 12, named "After operation 1 · Module evaluation") or skips the route read; no_claim=a real client navigation
test('a stop after operation 1 hit with the stack of a module evaluation pauses as an after-operation render without scope module', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, {
    realSourceRoot: true,
    operations: {
      operations: [
        {
          kind: 'text',
          title: 'Search',
          selector: 'input[placeholder="Search invoices..."]',
          text: 'de',
        },
      ],
      stopOperations: [1],
      stopParticipants: ['server'],
    },
    documentReadyState: 'complete',
  })
  await harness.run.prepare()
  harness.run.action('op-1', 'repository-operation')
  await waitUntil(() => harness.inputsSeen() === 1, 'the text was typed')
  // Act
  harness.server!.hit({ stack: 'evaluation' })
  const snapshot = await publishedPause(harness)
  // Assert
  assert.deepEqual(
    [snapshot.attribution, snapshot.operationIndex, snapshot.scope],
    ['after-operation', 1, undefined],
  )
})

// Value: protects=R3 (React copies): a hit in React's fabricated copy of the module is never a module evaluation, even with the evaluation's stack; fails_when=E1's false matches reach the learner; no_claim=real React
test('a hit in a React server copy of the module is resumed and journaled, never published as a module evaluation', async (context) => {
  // Arrange
  const { harness } = await heldReadiness(context)
  // Act
  evaluateModule(harness, { unannounced: { reactCopy: 107 } })
  await waitUntil(
    () => harness.server!.continues.length === 1,
    'the copy hit resumed by the run',
  )
  // Assert
  assert.equal(harness.run.view().participants.server?.snapshot, undefined)
  assert.ok(
    journalTypes(harness).includes('breakpoint.preparation-hit-resumed'),
  )
})

// Value: protects=R4 (seal at the pause): a paused script whose map retains other bytes than the declared source resumes the runtime, shows nothing and refuses the stop; fails_when=a value is published before the seal or the server stays paused; no_claim=the wording of a production refusal
test('bytes that differ from the declared source are refused at the pause and the runtime is resumed', async (context) => {
  // Arrange
  const { harness, prepared } = await heldReadiness(context)
  const settled = prepared.catch((error: unknown) => error)
  const server = harness.server!
  server.setScriptText(
    'server',
    server.instanceText(';AAAA', server.sealedUrl, true),
  )
  // Act
  server.hit({ stack: 'evaluation', generated: { line: 1, column: 0 } })
  await settled
  // Assert
  assert.equal(harness.run.view().status, 'failed')
  assert.equal(harness.run.view().participants.server?.snapshot, undefined)
  assert.equal(server.continues.length, 1)
})

// Value: protects=AC 8 / R5 (hold): a preparation pause held for longer than the 90 s setup budget fails nothing, the run continues and completes after the continue, and the held time is reported so the run resource's preparationDeadlineAt moves with it; fails_when=the setup deadline or a request bound fires while the learner reads, or the reported deadline stays in the past; no_claim=real time (the run's manual clock moves; production bounds stay)
test('a preparation pause held past the 90 s setup budget fails nothing and the run completes after the continue', async (context) => {
  // Arrange
  const { harness, prepared } = await heldReadiness(context)
  evaluateModule(harness)
  const snapshot = await publishedPause(harness)
  // Act: the learner reads for 100 s on the run's clock (and 50 ms of wall time pass)
  harness.advance(100_000)
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.deepEqual([...harness.run.view().failures], [])
  await harness.run.continue('server', snapshot.pause)
  harness.releaseReadiness()
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
  harness.setDocumentReadyState('complete')
  await prepared
  // Assert
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed',
  )
  assert.deepEqual([...harness.run.view().failures], [])
  // The run resource's setup deadline moves by the held wall time, as the runtime's own budget did.
  assert.ok((harness.run.view().preparationHeldMs ?? 0) >= 50)
})

// Value: protects=R11 (complete run): a preparation pause owes no image, so a run whose only server stop paused in the readiness request still ends with every owed image held; fails_when=the absent image makes the capture outcome incomplete and the study partial; no_claim=the before and after images of a real page
test('a run whose server stop paused in the readiness request keeps the pause image absent and its capture outcome complete', async (context) => {
  // Arrange
  const { harness, prepared } = await heldReadiness(context)
  evaluateModule(harness)
  const snapshot = await publishedPause(harness)
  // Act
  await harness.run.continue('server', snapshot.pause)
  harness.releaseReadiness()
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
  harness.setDocumentReadyState('complete')
  await prepared
  await waitUntil(
    () => harness.run.view().status === 'completed',
    'the run completed',
  )
  // Assert
  const view = harness.run.view()
  assert.deepEqual(
    [view.snapshotCaptures?.[snapshot.id]?.status, view.captureOutcome],
    ['absent', 'complete'],
  )
})

// Value: protects=AC 4 / DX-10 (not reached after the window): a stop the preparation window covered that never paused names the candidates that remain (the entry route not importing the module, an earlier evaluation, a cache, a render that did not reach it) and no longer blames module scope as such; fails_when=the text still says the stop ran only at module scope while Codebook prepared the page, or states a cause as established; no_claim=which candidate applied
test('a covered stop the page never reaches fails with the module-evaluation candidates, not the module-scope cause', async (context) => {
  // Arrange: the readiness request ends without any evaluation of the stop's module
  const { harness, prepared } = await heldReadiness(context)
  prepared.catch(() => undefined)
  // Act
  harness.releaseReadiness()
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
  harness.setDocumentReadyState('complete')
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the run failed',
  )
  // Assert
  const failure = harness.run.view().failures[0]!
  assert.match(
    failure,
    /^SERVER_STOP_NOT_REACHED: The page finished without reaching declared stop [^ ]+\. It may have run only while Codebook prepared the page \(a module Next evaluated before the stop could be armed, or a cached result\), the entry route may not import its module, or this render did not reach it\. Check that the entry route imports the module/,
  )
  assert.equal(failure.includes('code at module scope'), false)
})

// Value: protects=O5 (Pages workspaces): a workspace with a Pages folder opens no preparation window, because its router is known only after readiness; fails_when=the window opens and consumes a Pages data function during Codebook's own request; no_claim=App Router entries of such mixed workspaces
test('a workspace with a Pages folder opens no preparation window', async (context) => {
  // Arrange
  const harness = await pagesServerRun(context)
  // Act
  const prepared = harness.run.prepare().catch(() => undefined)
  await armedEntry(harness)
  // Assert
  assert.equal(
    harness.run
      .view()
      .events.some((event) => event.type === 'preparation.window-opened'),
    false,
  )
  void prepared
})

// Value: protects=R8 (uninitialized bindings): a module-level binding the debugger's scope does not list is not shown at all, never as undefined or as a value; fails_when=an entry is invented for a binding the scope omits; no_claim=js-debug's own scope listing
test('a binding the debugger scope omits is not shown as a value at a module evaluation', async (context) => {
  // Arrange
  const { harness } = await heldReadiness(context)
  harness.server!.setScope({ connectionString: 'postgres://localhost/app' })
  // Act
  evaluateModule(harness)
  const snapshot = await publishedPause(harness)
  // Assert
  const names = JSON.stringify(snapshot.debugger)
  assert.match(names, /connectionString/)
  assert.doesNotMatch(names, /"client"/)
})
