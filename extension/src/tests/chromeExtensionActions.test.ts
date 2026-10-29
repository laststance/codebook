import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { readResource } from '../resources'

import { createHarness } from './helpers'
import { defer } from './utils/defer'
import {
  FAKE_EXTENSION_SESSION_ID,
  FAKE_EXTENSION_THREAD_ID,
} from './utils/fakeChromeExtensionRuntime'
import { startFakeChromeExtensionRun } from './utils/startFakeChromeExtensionRun'

/** The arguments of one `codebook_action` call on a started run. */
function clickInput(
  started: Awaited<ReturnType<typeof startFakeChromeExtensionRun>>,
  key: string,
) {
  return {
    instanceId: started.service.instanceId,
    runId: started.record.id,
    key,
    action: 'extension-click' as const,
  }
}

/** Reads the run resource as the chat does and parses it. */
async function readState(
  started: Awaited<ReturnType<typeof startFakeChromeExtensionRun>>,
) {
  const resource = await readResource(
    started.service,
    started.service.uri(started.record.id),
  )
  if (!('text' in resource)) throw new Error('The resource is text.')
  return JSON.parse(resource.text)
}

// protects=SR2 and SR12: each extension-click answers its 1-based click index, outcome, inputs applied and dispatch, with the receipt fields; fails_when=the index is zero-based, a field is missing or the second click repeats the first; no_claim=what the click did in Chrome
test('extension-click answers the click index, outcome and dispatch of each declared click', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeChromeExtensionRun(harness)
  // Act
  const first = await started.service.performAction(
    clickInput(started, 'click-1'),
  )
  const second = await started.service.performAction(
    clickInput(started, 'click-2'),
  )
  // Assert
  assert.deepEqual(first, {
    operationId: 'fake-extension-run:click:1',
    key: 'click-1',
    runUri: started.service.uri(started.record.id),
    clickIndex: 1,
    outcome: 'settled',
    inputsApplied: 0,
    clickDispatched: true,
    inputEffects: [],
    clickEffect: 'confirmed',
  })
  assert.equal('clickIndex' in second && second.clickIndex, 2)
})

// protects=DXR4: a click whose handler paused at a stop answers that its press was sent and is not yet answered (clickEffect unknown), so the chat never reads clickDispatched false as a click that did not happen, as a VS Code chat could in the Cycle 0061 pt2 dry run; fails_when=the answer leaves out the click's side effect; no_claim=how the chat words it
test('a click paused inside its handler answers that its press was sent and not yet answered', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeChromeExtensionRun(harness)
  started.run.nextOutcome = 'paused'
  started.run.nextClickEffect = 'unknown'
  // Act
  const answer = await started.service.performAction(
    clickInput(started, 'click-1'),
  )
  // Assert
  assert.deepEqual(
    {
      outcome: 'outcome' in answer && answer.outcome,
      clickDispatched: 'clickDispatched' in answer && answer.clickDispatched,
      clickEffect: 'clickEffect' in answer && answer.clickEffect,
      inputEffects: 'inputEffects' in answer && answer.inputEffects,
    },
    {
      outcome: 'paused',
      clickDispatched: false,
      clickEffect: 'unknown',
      inputEffects: [],
    },
  )
})

// protects=NO_MORE_ACTIONS passes through after the last declared click; fails_when=a third click is sent or another code answers; no_claim=the run's own bookkeeping
test('a click after the last declared one answers NO_MORE_ACTIONS', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeChromeExtensionRun(harness)
  await started.service.performAction(clickInput(started, 'click-1'))
  await started.service.performAction(clickInput(started, 'click-2'))
  // Act, Assert
  await assert.rejects(
    started.service.performAction(clickInput(started, 'click-3')),
    (error) =>
      error instanceof StudyError &&
      error.code === 'NO_MORE_ACTIONS' &&
      error.message === 'Every declared click was performed.',
  )
})

// protects=DXR3: the same key after a lost response returns the original receipt and sends no second click; fails_when=the run clicks again or the receipt differs; no_claim=network loss itself
test('the same key after a lost response returns the original receipt without a second click', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeChromeExtensionRun(harness)
  const original = await started.service.performAction(
    clickInput(started, 'click-1'),
  )
  // Act
  const repeated = await started.service.performAction(
    clickInput(started, 'click-1'),
  )
  // Assert
  assert.deepEqual(repeated, original)
  assert.deepEqual(started.run.calls, ['prepare', 'click'])
})

// protects=DXR3: two concurrent calls with the same key join one click and answer the same receipt; fails_when=the second call starts another click or answers ACTION_IN_PROGRESS; no_claim=the real click's duration
test('two concurrent calls with the same key join one click', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeChromeExtensionRun(harness)
  started.run.clickGate = defer<void>()
  // Act
  const first = started.service.performAction(clickInput(started, 'click-1'))
  const second = started.service.performAction(clickInput(started, 'click-1'))
  started.run.clickGate.resolve()
  const answers = await Promise.all([first, second])
  // Assert
  assert.deepEqual(answers[1], answers[0])
  assert.equal(started.run.calls.filter((call) => call === 'click').length, 1)
})

// protects=DXR3: the same key replays its receipt after the run completed and was released; fails_when=the replay answers NO_MORE_ACTIONS, RUN_NOT_READY or clicks again; no_claim=cleanup itself
test('the same key replays its receipt after the run ended', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeChromeExtensionRun(harness)
  const original = await started.service.performAction(
    clickInput(started, 'click-1'),
  )
  await started.service.performAction(clickInput(started, 'click-2'))
  started.run.complete({
    kind: 'text',
    before: { value: 'idle' },
    after: { value: 'pong' },
    changed: true,
    observedAtMs: 900,
  })
  await new Promise((resolve) => setImmediate(resolve))
  // Act
  const repeated = await started.service.performAction(
    clickInput(started, 'click-1'),
  )
  // Assert
  assert.deepEqual(repeated, original)
  assert.equal(started.record.stopped, true)
})

// protects=DXR3: a key used again for another action is IDEMPOTENCY_CONFLICT; fails_when=the other action runs or answers another code; no_claim=the other actions' wording
test('the same key with another action answers IDEMPOTENCY_CONFLICT', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeChromeExtensionRun(harness)
  await started.service.performAction(clickInput(started, 'click-1'))
  // Act, Assert
  await assert.rejects(
    started.service.performAction({
      ...clickInput(started, 'click-1'),
      action: 'http-request',
    }),
    (error) =>
      error instanceof StudyError &&
      error.code === 'IDEMPOTENCY_CONFLICT' &&
      error.message === 'Action key already names different arguments.',
  )
})

// protects=SR29: a click with a new key while one is in flight answers ACTION_IN_PROGRESS and a click at a pause answers RUN_PAUSED; fails_when=either starts a click or answers another code; no_claim=the debugger's pause
test('a new key answers ACTION_IN_PROGRESS during a click and RUN_PAUSED at a stop', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeChromeExtensionRun(harness)
  started.run.clickGate = defer<void>()
  const inFlight = started.service.performAction(clickInput(started, 'click-1'))
  // Act
  const concurrent = await started.service
    .performAction(clickInput(started, 'click-2'))
    .catch((error: unknown) => error)
  started.run.clickGate.resolve()
  await inFlight
  started.run.pauseAt(1)
  const paused = await started.service
    .performAction(clickInput(started, 'click-3'))
    .catch((error: unknown) => error)
  // Assert
  assert.equal(
    concurrent instanceof StudyError && concurrent.code,
    'ACTION_IN_PROGRESS',
  )
  assert.equal(
    concurrent instanceof StudyError && concurrent.message,
    'A click is still in progress.',
  )
  assert.equal(paused instanceof StudyError && paused.code, 'RUN_PAUSED')
  assert.equal(
    paused instanceof StudyError && paused.message,
    'A stop is paused; continue it before the next click.',
  )
})

// protects=DXR3: a refused click is stored and the same key replays the refusal without asking the run again, while a new key retries; fails_when=the same key clicks again or the new key is refused; no_claim=the selector lookup
test('a refused click is replayed for the same key and retried with a new key', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeChromeExtensionRun(harness)
  started.run.clickFailure = new StudyError(
    'SELECTOR_NOT_FOUND',
    'No element matches #ping in the extension surface.',
  )
  const refusal = await started.service
    .performAction(clickInput(started, 'click-1'))
    .catch((error: unknown) => error)
  // Act
  const replayed = await started.service
    .performAction(clickInput(started, 'click-1'))
    .catch((error: unknown) => error)
  const retried = await started.service.performAction(
    clickInput(started, 'click-1b'),
  )
  // Assert
  assert.equal(replayed, refusal)
  assert.equal(
    refusal instanceof StudyError && refusal.message,
    'No element matches #ping in the extension surface.',
  )
  assert.equal('clickIndex' in retried && retried.clickIndex, 1)
  assert.equal(started.run.calls.filter((call) => call === 'click').length, 2)
})

// protects=ER16: at a pause the run resource lists the pause with complete continueArguments and offers continue-extension; fails_when=a field of the arguments is missing or the action is not offered; no_claim=the debugger session
test('a paused run lists the pause with its own complete continue arguments', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeChromeExtensionRun(harness)
  await started.service.performAction(clickInput(started, 'click-1'))
  // Act
  const generation = started.run.pauseAt(1)
  const state = await readState(started)
  // Assert
  assert.equal(state.state, 'paused')
  assert.equal(state.nextActions.includes('continue-extension'), true)
  assert.deepEqual(state.chromeExtension.pauses[0].continueArguments, {
    instanceId: started.service.instanceId,
    runId: started.record.id,
    participant: 'extension',
    sessionId: FAKE_EXTENSION_SESSION_ID,
    threadId: FAKE_EXTENSION_THREAD_ID,
    generation,
    answer: 'next',
  })
  assert.deepEqual(state.chromeExtension.stopsNotReached, [2])
  assert.equal(state.chromeExtension.stops.captured[0].stopIndex, 1)
})

// protects=DXR5: codebook_continue with a listed pause's arguments continues the run and a stale generation answers STALE_PAUSE; fails_when=a stale pause continues or the listed one is refused; no_claim=what the debugger resumes
test('codebook_continue continues a listed pause and refuses a stale generation', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeChromeExtensionRun(harness)
  await started.service.performAction(clickInput(started, 'click-1'))
  const generation = started.run.pauseAt(1)
  const arguments_ = {
    instanceId: started.service.instanceId,
    runId: started.record.id,
    participant: 'extension' as const,
    sessionId: FAKE_EXTENSION_SESSION_ID,
    threadId: FAKE_EXTENSION_THREAD_ID,
    generation,
  }
  // Act
  const stale = await started.service
    .continue({ ...arguments_, generation: generation + 5 })
    .catch((error: unknown) => error)
  const accepted = await started.service.continue(arguments_)
  const none = await started.service
    .continue(arguments_)
    .catch((error: unknown) => error)
  // Assert
  assert.equal(stale instanceof StudyError && stale.code, 'STALE_PAUSE')
  assert.deepEqual(accepted, {
    accepted: true,
    runUri: started.service.uri(started.record.id),
  })
  assert.equal(none instanceof StudyError && none.code, 'NO_PAUSE')
  assert.deepEqual(started.run.calls, [
    'prepare',
    'click',
    `continue:${generation}`,
  ])
})

// protects=SR23: continue with answer next answers the observed result when the run completes, with the run state; fails_when=the wait ends without next or the state lacks the observation; no_claim=the observation's timing
test('codebook_continue with answer next names the result once the run completed', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeChromeExtensionRun(harness)
  await started.service.performAction(clickInput(started, 'click-1'))
  const generation = started.run.pauseAt(1)
  // Act
  const waiting = started.service.continueToNextState({
    instanceId: started.service.instanceId,
    runId: started.record.id,
    participant: 'extension',
    sessionId: FAKE_EXTENSION_SESSION_ID,
    threadId: FAKE_EXTENSION_THREAD_ID,
    generation,
    answer: 'next',
  })
  await new Promise((resolve) => setImmediate(resolve))
  started.run.complete({
    kind: 'text',
    before: { value: 'idle' },
    after: { value: 'pong' },
    changed: true,
    observedAtMs: 900,
  })
  const answer = await waiting
  // Assert
  assert.equal('next' in answer && answer.next, 'result')
  assert.equal('state' in answer && answer.state.claimable, true)
})

// protects=SR22: codebook_stop on a live run routes to the run's stop and releases the slot; fails_when=the run is not stopped or the record stays active; no_claim=the browser's real cleanup
test('codebook_stop routes to the extension run and releases the run', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeChromeExtensionRun(harness)
  await started.service.performAction(clickInput(started, 'click-1'))
  // Act
  await started.service.stopForTool({
    instanceId: started.service.instanceId,
    runId: started.record.id,
  })
  // Assert
  assert.equal(started.record.stopped, true)
  assert.deepEqual(started.run.calls, ['prepare', 'click', 'stop'])
})
