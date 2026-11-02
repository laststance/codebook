import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import {
  SERVER_RENDER_ENTRY_CONFIGURATION,
  serverRenderHelp,
} from '../serverRenderHelp'
import { captureStudy } from '../utils/captureStudy'
import { configuredDomExpression } from '../utils/configuredDomExpression'

import {
  serviceHostedEntryRun,
  type ServiceHostedEntryRun,
} from './utils/entryRenderService'
import { readEvidenceText } from './utils/readEvidenceText'

/** A workspace key in the shape a saved study carries. */
const WORKSPACE_KEY = 'a'.repeat(64)

/** The harness options of a run with the saved session: Codebook's own request is redirected to sign-in, the browser's warm-up load finishes, and the armed second load is the entry render. */
function savedSessionOptions(
  operations: ServiceHostedEntryRunOperations,
): NonNullable<Parameters<typeof serviceHostedEntryRun>[1]> {
  return {
    savedSession: { admission: 'saved' },
    entryAnswer: { status: 307, location: '/login' },
    navigationLandings: ['/dashboard', '/dashboard'],
    documentReadyState: 'complete',
    loadingFromNavigation: 2,
    operations: { ...operations, signInPaths: ['/login'] },
  }
}

type ServiceHostedEntryRunOperations = NonNullable<
  NonNullable<Parameters<typeof serviceHostedEntryRun>[1]>['operations']
>

/** The run-level `before` conditions' expression, which the page evaluates once the entry page loaded. @example beforeExpressionOf(run) */
function beforeExpressionOf(run: ServiceHostedEntryRun): string {
  const configuration = run.harness.definition.configuration
  if (!('before' in configuration)) throw new Error('A version 1 configuration')
  return configuredDomExpression(configuration.before)
}

/** Waits until the entry stop was armed and the (second, for a saved session) entry navigation started. @example await armedEntryNavigation(run, 2) */
async function armedEntryNavigation(
  run: ServiceHostedEntryRun,
  navigations: number,
): Promise<void> {
  await waitUntil(
    () => run.harness.server!.breakpointsAcknowledged() > 0,
    'the entry-render stop was armed',
  )
  await waitUntil(
    () => run.harness.navigations.length >= navigations,
    'the entry navigation started',
  )
}

// Value: protects=AC 2 and AC 11a (entry /dashboard, operations omitted, saved session): following the quick start's call order a run reads preparing, then paused before the page loaded and before the run-level before conditions were read, codebook_continue with the run resource's current continueArguments completes the run, and no confirmation is asked; fails_when=the pause is published after the load or the before conditions, the paused state is hidden by preparing, the continue arguments are missing, or the resource asks for a confirmation; no_claim=a real Next dev server; spike s01-base shows the pause before load, here a stand-in server hits the armed stop
test('following the quick start call order, an entry-render pause is read as paused before the page loads and one codebook_continue completes the run', async (context) => {
  // Arrange: the help's quick start declares the same shape as the run under test
  const quickStart = serverRenderHelp().serverRenderQuickStart
  assert.match(
    quickStart.callOrder[4]!,
    /preparing: wait and poll\. paused: read inspectionUri and sourceUri, explain the values in the chat, then codebook_continue with the current continueArguments\./,
  )
  const run = await serviceHostedEntryRun(
    context,
    savedSessionOptions({
      operations: [],
      stopOperations: [0],
      stopParticipants: ['server'],
    }),
  )
  const { harness, service, state } = run
  // The service releases a completed run within 250 ms, which would read `stopping` where this test reads `completed`.
  run.holdMaintenance()
  const configuration: Record<string, unknown> = JSON.parse(
    JSON.stringify(harness.definition.configuration),
  )
  assert.deepEqual(
    {
      participant: configuration.participant,
      afterOperation: configuration.afterOperation,
      hasOperations: 'operations' in configuration,
      entryPath: configuration.entryPath,
    },
    {
      participant: SERVER_RENDER_ENTRY_CONFIGURATION.participant,
      afterOperation: SERVER_RENDER_ENTRY_CONFIGURATION.afterOperation,
      hasOperations: 'operations' in SERVER_RENDER_ENTRY_CONFIGURATION,
      entryPath: SERVER_RENDER_ENTRY_CONFIGURATION.entryPath,
    },
  )
  // Act: the first poll reads preparing
  assert.equal(state().state, 'preparing')
  await armedEntryNavigation(run, 2)
  harness.server!.hit({ route: '/dashboard' })
  await waitUntil(() => state().state === 'paused-server', 'the paused state')
  const paused = state()
  // Assert: paused before the page load and before the before conditions
  assert.equal(harness.run.view().status, 'paused-server')
  assert.equal(paused.confirmation, 'not-needed')
  assert.equal(
    paused.message,
    'The server render of the entry page is paused; the page finishes loading after you continue. Stop it with codebook_stop if you do not continue.',
  )
  assert.equal(
    harness.evaluatedExpressions.includes(beforeExpressionOf(run)),
    false,
  )
  assert.ok(paused.participants.server?.snapshotUri)
  assert.ok(paused.participants.server?.sourceUri)
  // Act: continue with the current continueArguments
  harness.setDocumentReadyState('complete')
  const answer = await service.continueToNextState(
    paused.participants.server.continueArguments!,
  )
  // Assert
  assert.equal('next' in answer ? answer.next : undefined, 'result')
  assert.equal(state().state, 'completed')
  assert.equal(state().operationStatus, 'Page load · complete')
  assert.equal(
    harness.evaluatedExpressions.includes(beforeExpressionOf(run)),
    true,
  )
  assert.equal(harness.server!.continues.length, 1)
})

// Value: protects=AC 3 (entry-render stop then an operation-driven stop, saved session): the confirmation is asked after the entry pause was continued and before operation 1 is sent, and the second pause is observed after operation 1; fails_when=the confirmation is asked while the entry pause is held or after the input, the input is sent without it, or the second pause loses its attribution; no_claim=a real Next dev server (two stand-in hits)
test('a mixed run asks the saved-session confirmation after the entry pause was continued and before operation 1 is sent', async (context) => {
  // Arrange
  const run = await serviceHostedEntryRun(
    context,
    savedSessionOptions({
      operations: [
        {
          kind: 'click',
          title: 'Create Invoice',
          selector: 'button[type=submit]',
        },
      ],
      stopOperations: [0, 1],
      stopParticipants: ['server', 'server'],
    }),
    [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
      },
    ],
  )
  const { harness, service, state, receipt } = run
  const asked: { inputsSeen: number; runState: string }[] = []
  service.environment.confirmSavedSessionOperations = async () => {
    asked.push({ inputsSeen: harness.inputsSeen(), runState: state().state })
    return true
  }
  service.environment.noticeOperationsConfirmation = async () => undefined
  await armedEntryNavigation(run, 2)
  // Act: the entry-render pause, held, then continued
  harness.server!.hit({ route: '/dashboard' })
  await waitUntil(() => state().state === 'paused-server', 'the entry pause')
  assert.deepEqual(asked, [])
  const entryPause = state().participants.server!
  harness.setDocumentReadyState('complete')
  await service.continue(entryPause.continueArguments!)
  await waitUntil(() => state().state === 'ready', 'ready for operation 1')
  // Assert: nothing asked or sent while the render was held or finishing
  assert.deepEqual(asked, [])
  assert.equal(harness.inputsSeen(), 0)
  assert.equal(state().confirmation, 'awaiting-learner')
  // Act
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: 'repository-operation',
  })
  await waitUntil(() => harness.inputsSeen() === 1, 'operation 1 sent')
  harness.server!.hit({
    generated: { line: 0, column: 6 },
    source: { line: 1, column: 7 },
    route: '/dashboard',
  })
  await waitUntil(
    () => harness.run.view().snapshots.length === 2,
    'the second pause',
  )
  // Assert
  assert.deepEqual(asked, [{ inputsSeen: 0, runState: 'ready' }])
  const [first, second] = harness.run.view().snapshots
  assert.deepEqual(
    [
      [
        first?.attribution,
        first?.operationIndex,
        first?.declaredIndex,
        first?.executionIndex,
      ],
      [
        second?.attribution,
        second?.operationIndex,
        second?.declaredIndex,
        second?.executionIndex,
      ],
    ],
    [
      ['entry-load', undefined, 0, 0],
      ['after-operation', 1, 1, 1],
    ],
  )
})

// Value: protects=AC 15 while paused: during an entry-render pause the run resource reads paused-server with the pause's inspection, source and continue arguments and the status words, Save keeps a format 8 study holding the pause, and no operation record says an input was dispatched; fails_when=the paused state is hidden, Save refuses or writes format 7, or an operation record reads dispatched; no_claim=the editor's Save command (captureStudy is the copy it makes)
test('during an entry-render pause the run resource, a Save copy and the operation records match a server-action pause', async (context) => {
  // Arrange
  const run = await serviceHostedEntryRun(context)
  const { harness, state, service } = run
  await armedEntryNavigation(run, 1)
  // Act
  harness.server!.hit({ route: '/dashboard' })
  await waitUntil(() => state().state === 'paused-server', 'the entry pause')
  const paused = state()
  const record = service.record(run.receipt)
  const saved = await captureStudy(service, record, WORKSPACE_KEY)
  // Assert
  assert.equal(paused.operationStatus, 'Page load · paused in server render')
  assert.deepEqual(
    [
      Boolean(paused.participants.server?.snapshotUri),
      Boolean(paused.participants.server?.sourceUri),
      Boolean(paused.participants.server?.continueArguments),
    ],
    [true, true, true],
  )
  assert.equal(saved?.version, 8)
  assert.deepEqual(
    saved?.observations.map((observation) => [
      observation.execution,
      observation.attribution,
      observation.declaredIndex,
    ]),
    [['server-render', 'entry-load', 0]],
  )
  assert.equal(harness.run.view().operation?.inputDispatched ?? false, false)
  assert.equal(harness.inputsSeen(), 0)
})

// Value: protects=AC 15 declined confirmation: with the saved session and one operation, the learner declines the confirmation after the entry pause; the run stays ready, the operation is not run, and the partial study is format 8 and holds the entry pause; fails_when=the declined run loses the entry pause, writes format 7, or sends an input; no_claim=the real confirmation dialog (the environment's question is stubbed)
test('a declined confirmation after an entry pause leaves a partial format 8 study that holds the pause and sends no input', async (context) => {
  // Arrange
  const run = await serviceHostedEntryRun(
    context,
    savedSessionOptions({
      operations: [
        {
          kind: 'click',
          title: 'Create Invoice',
          selector: 'button[type=submit]',
        },
      ],
      stopOperations: [0],
      stopParticipants: ['server'],
    }),
  )
  const { harness, service, state, receipt } = run
  service.environment.confirmSavedSessionOperations = async () => false
  service.environment.noticeOperationsConfirmation = async () => undefined
  await armedEntryNavigation(run, 2)
  harness.server!.hit({ route: '/dashboard' })
  await waitUntil(() => state().state === 'paused-server', 'the entry pause')
  harness.setDocumentReadyState('complete')
  await service.continue(state().participants.server!.continueArguments!)
  await waitUntil(() => state().state === 'ready', 'ready for operation 1')
  // Act
  const declined = await service
    .performAction({ ...receipt, key: 'op-1', action: 'repository-operation' })
    .catch((error: { code: string }) => error)
  const saved = await captureStudy(
    service,
    service.record(receipt),
    WORKSPACE_KEY,
  )
  // Assert
  assert.equal((declined as { code: string }).code, 'OPERATIONS_NOT_CONFIRMED')
  assert.equal(harness.inputsSeen(), 0)
  assert.equal(harness.run.view().operations?.[0]?.state, 'not-run')
  assert.equal(saved?.version, 8)
  assert.deepEqual(
    saved?.observations.map((observation) => [
      observation.execution,
      observation.attribution,
    ]),
    [['server-render', 'entry-load']],
  )
})

// Value: protects=AC 7a ENTRY_LOAD_TIMEOUT: the page not loading within 20 s of the last continue fails the run with the code, its details (route, last stop, elapsed time), the recovery and no sent input, and the secret query value of the entry path appears in no sink; fails_when=the code, a detail or the recovery is missing, or the query value reaches the run resource, the journal or the evidence; no_claim=isError of the MCP answer (the tool layer maps every StudyError), and the evidence folder, whose saved configuration keeps the declared entryPath verbatim
test('an entry page that does not load after the last continue fails with ENTRY_LOAD_TIMEOUT and masks the entry path query', async (context) => {
  // Arrange
  const run = await serviceHostedEntryRun(context, {
    entryPath: '/dashboard?ref=sekret-q-91',
  })
  const { harness, state } = run
  await armedEntryNavigation(run, 1)
  harness.server!.hit({ route: '/dashboard' })
  const pause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the entry pause',
  )
  await harness.run.continue('server', pause.pause)
  // Act: the page does not load for 20 s
  harness.advance(20_000)
  await waitUntil(() => state().error, 'the failed run')
  await waitUntil(() => state().resourcesReleased, 'resources released')
  // Assert
  const error = state().error!
  assert.equal(error.code, 'ENTRY_LOAD_TIMEOUT')
  assert.match(error.recovery, /resourcesReleased/)
  assert.match(
    error.recovery,
    /codebook:\/\/help\/repository-browser#ENTRY_LOAD_TIMEOUT\.$/,
  )
  assert.deepEqual(
    {
      entryRoute: error.details?.entryRoute,
      lastPausedStop: error.details?.lastPausedStop,
      sent: error.details?.sent,
      sideEffects: error.details?.sideEffects,
    },
    {
      entryRoute: '/dashboard?ref=<redacted>',
      lastPausedStop: 'src/theme.ts:1',
      sent: 'not-sent',
      sideEffects: 'none',
    },
  )
  assert.equal(typeof error.details?.elapsedMs, 'number')
  const sinkMap = {
    state: JSON.stringify(state()),
    events: JSON.stringify(harness.run.view().events),
  }
  const sinks = Object.values(sinkMap).join('\n')
  assert.equal(sinks.includes('sekret-q-91'), false)
})

// Value: protects=AC 7a SERVER_STOP_NOT_REACHED (entry-render): a page that loads without the stop being hit fails the run with the code, phase, stop lists, firstExecutionObserved false, the "may" sentence and sent not-sent; fails_when=the phase, a list or the possibility wording is missing, or the failure names an operation; no_claim=why Next skipped the code
test('an entry page that loads without reaching the stop fails with SERVER_STOP_NOT_REACHED in the entry-render phase', async (context) => {
  // Arrange
  const run = await serviceHostedEntryRun(context, {
    documentReadyState: 'complete',
  })
  const { state } = run
  // Act
  await waitUntil(() => state().error, 'the failed run')
  // Assert
  const error = state().error!
  assert.equal(error.code, 'SERVER_STOP_NOT_REACHED')
  assert.match(
    error.message,
    /^The page finished without reaching declared stop src\/theme\.ts:1\. It may have run only while Codebook prepared the page/,
  )
  assert.deepEqual(JSON.parse(JSON.stringify(error.details)), {
    phase: 'entry-render',
    stop: 'src/theme.ts:1',
    pausedStops: [],
    notReachedStops: ['src/theme.ts:1'],
    firstExecutionObserved: false,
    sent: 'not-sent',
    sideEffects: 'none',
    runUri: error.details?.runUri,
    retry: error.details?.retry,
    logId: 'service-run-71#start',
  })
})

// Value: protects=AC 8a codebook_stop: stopping during an entry-render pause resumes the server process and ends the run with its resources released, and a secret-named value at the pause is masked in the run resource, the journal and the evidence; fails_when=the process stays paused, the run stays alive, or the secret value reaches a sink; no_claim=the saved study's copy (captureStudy of a stopped run is the editor's job)
test('Stop during an entry-render pause resumes the server, ends the run and keeps a secret-named value out of every sink', async (context) => {
  // Arrange
  const run = await serviceHostedEntryRun(context, {
    inspections: [
      { path: 'nextTheme', mode: 'value', required: true },
      { path: 'sessionToken', mode: 'value', required: false },
    ],
    inspectionScope: { sessionToken: 'tok-live-77' },
  })
  const { harness, state, service, receipt } = run
  await armedEntryNavigation(run, 1)
  harness.server!.hit({ route: '/dashboard' })
  await waitUntil(() => state().state === 'paused-server', 'the entry pause')
  // Act
  await service.stop(receipt)
  // Assert
  assert.equal(state().state, 'stopped')
  assert.equal(state().resourcesReleased, true)
  assert.equal(harness.server!.isClosed(), true)
  const sinks = [
    JSON.stringify(state()),
    JSON.stringify(harness.run.view().events),
    JSON.stringify(harness.run.view().snapshots),
    await readEvidenceText(harness.run.view().artifactDirectory),
  ].join('\n')
  assert.equal(sinks.includes('tok-live-77'), false)
  // The pause was there, so the absence is not an empty sink.
  assert.match(sinks, /"value:nextTheme":"dark"/)
})

// Value: protects=AC 8a SOURCE_CHANGED: a saved edit of the paused module ends the run with SOURCE_CHANGED at the continue and sends no resume; fails_when=the edited module is continued, or the failure is another code; no_claim=the editor's save event (the file is written on disk, which the run's source check reads)
test('a saved edit of the module paused in an entry render ends the run with SOURCE_CHANGED and sends no resume', async (context) => {
  // Arrange
  const run = await serviceHostedEntryRun(context)
  const { harness, state, service } = run
  await armedEntryNavigation(run, 1)
  harness.server!.hit({ route: '/dashboard' })
  await waitUntil(() => state().state === 'paused-server', 'the entry pause')
  await writeFile(
    join(harness.directory, 'src/theme.ts'),
    'var nextTheme = "light";\n',
  )
  // Act
  const outcome = await service
    .continueToNextState(state().participants.server!.continueArguments!)
    .catch((error: { code: string }) => error)
  // Assert
  assert.equal((outcome as { code: string }).code, 'SOURCE_CHANGED')
  assert.equal(harness.server!.continues.length, 0)
})

// Value: protects=task 3a run messages and AC 15 set progress: after a continue inside a set of two entry-render stops the run resource says it waits for the next stop (2 of 2), and a held second pause reads the set position; fails_when=the waiting message is missing or counts wrong, or the status item keeps the old pause words; no_claim=the status item widget (its text is the shared operationStatus)
test('inside a set of two entry-render stops the run resource says it waits for the next stop after the first continue', async (context) => {
  // Arrange
  const run = await serviceHostedEntryRun(
    context,
    {
      operations: {
        operations: [],
        stopOperations: [0, 0],
        stopParticipants: ['server', 'server'],
      },
    },
    [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
      },
    ],
  )
  const { harness, state, service } = run
  await armedEntryNavigation(run, 1)
  harness.server!.hit({ route: '/dashboard' })
  await waitUntil(() => state().state === 'paused-server', 'the first pause')
  assert.equal(
    state().operationStatus,
    'Page load · paused in server render (1 of 2)',
  )
  // Act
  await service.continue(state().participants.server!.continueArguments!)
  await waitUntil(
    () => state().message !== undefined && state().state !== 'paused-server',
    'waiting for the next stop',
  )
  // Assert
  assert.equal(
    state().message,
    'Waiting for the next stop of this render (2 of 2).',
  )
  // Act
  harness.server!.hit({
    generated: { line: 0, column: 6 },
    source: { line: 1, column: 7 },
    route: '/dashboard',
  })
  await waitUntil(() => state().state === 'paused-server', 'the second pause')
  // Assert
  assert.equal(
    state().operationStatus,
    'Page load · paused in server render (2 of 2)',
  )
})

/** Opens a mixed run (entry-render stop plus an `afterOperation: 1` stop, saved session), continues the entry pause, and waits until the run is ready for operation 1. @example const run = await readyMixedRun(context) */
async function readyMixedRun(context: TestContext) {
  const run = await serviceHostedEntryRun(
    context,
    savedSessionOptions({
      operations: [
        {
          kind: 'click',
          title: 'Create Invoice',
          selector: 'button[type=submit]',
        },
      ],
      stopOperations: [0, 1],
      stopParticipants: ['server', 'server'],
    }),
    [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
      },
    ],
  )
  const { harness, service, state } = run
  service.environment.confirmSavedSessionOperations = async () => true
  service.environment.noticeOperationsConfirmation = async () => undefined
  await armedEntryNavigation(run, 2)
  harness.server!.hit({ route: '/dashboard' })
  await waitUntil(() => state().state === 'paused-server', 'the entry pause')
  harness.setDocumentReadyState('complete')
  await service.continue(state().participants.server!.continueArguments!)
  await waitUntil(() => state().state === 'ready', 'ready for operation 1')
  return run
}

// Value: protects=F1 while the run waits for its first operation: a React copy hit at the retired entry-render stop's position, arriving after the run is ready and before operation 1, is resumed and journaled breakpoint.react-copy, and operation 1 still pauses at its own stop; fails_when=the copy pause is dropped by the intake so its stopped fails the run as an unexpected or additional server stop, or the run leaves ready; no_claim=that js-debug sends this copy at this moment (native trial)
test('a React copy hit at the entry stop while the run waits for operation 1 is resumed and operation 1 still pauses', async (context) => {
  // Arrange
  const run = await readyMixedRun(context)
  const { harness, service, state, receipt } = run
  const resumesBefore = harness.server!.continues.length
  // Act: React's copy of the module hits the entry stop's position while the run is ready
  harness.server!.announceReactCopy('3672', 109)
  harness.server!.hit({
    scriptId: '3672',
    generated: { line: 0, column: 6 },
    source: { line: 1, column: 7 },
  })
  await waitUntil(
    () => harness.server!.continues.length === resumesBefore + 1,
    'the copy hit resumed',
  )
  // Assert
  assert.equal(
    harness.run
      .view()
      .events.filter((event) => event.type === 'breakpoint.react-copy').length,
    1,
  )
  assert.equal(state().state, 'ready')
  assert.equal(harness.run.view().failures.length, 0)
  // Act: operation 1 is sent and reaches its stop
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: 'repository-operation',
  })
  await waitUntil(() => harness.inputsSeen() === 1, 'operation 1 sent')
  harness.server!.hit({
    generated: { line: 0, column: 6 },
    source: { line: 1, column: 7 },
    route: '/dashboard',
  })
  await waitUntil(
    () => harness.run.view().snapshots.length === 2,
    'the second pause',
  )
  // Assert
  assert.equal(harness.run.view().snapshots[1]?.attribution, 'after-operation')
})

// Value: protects=today's handling of a ready-time pause that is not a copy at an owned position: a plain server pause while the run waits for operation 1 is resumed as a repeat hit, not as a React copy and journals no breakpoint.react-copy; fails_when=the new copy intake takes any ready-time pause for a copy; no_claim=the verdict the run reaches for such a pause (unchanged by this fix)
test('a plain server pause while the run waits for operation 1 is not resumed as a React copy', async (context) => {
  // Arrange
  const run = await readyMixedRun(context)
  const { harness } = run
  const resumesBefore = harness.server!.continues.length
  // Act
  harness.server!.hit({ route: '/dashboard' })
  await new Promise((resolve) => setTimeout(resolve, 300))
  // Assert
  assert.equal(
    harness.run
      .view()
      .events.filter((event) => event.type === 'breakpoint.react-copy').length,
    0,
  )
  // A render hit of the entry stop that already paused is a repeat hit, resumed once and journaled as such (never as a copy)
  assert.equal(harness.server!.continues.length, resumesBefore + 1)
  assert.equal(
    harness.run
      .view()
      .events.filter((event) => event.type === 'breakpoint.repeat-hit').length,
    1,
  )
})
