import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { describeOperationFailureDetails } from '../utils/describeOperationFailureDetails'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

const OPERATION_ACTION = 'repository-operation'

/** Copies a value out of the run module's realm so a strict deep comparison takes it for this realm's. @example plain(run.view().operationFailure) */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}
const open: RepositoryOperation = {
  kind: 'click',
  title: 'Open',
  selector: '#open',
}
const palette: RepositoryOperation = {
  kind: 'press',
  title: 'Open palette',
  key: 'Control+k',
  after: [{ kind: 'visible', selector: '#palette' }],
}
const submit: RepositoryOperation = {
  kind: 'click',
  title: 'Create Invoice',
  selector: 'button[type=submit]',
}

// Value: protects=AC1/AC2: a press between two clicks is sent after the first and before the last, as one key down then one key up; fails_when=the press is skipped, sent twice, sent before the first click is done or releases the key before pressing it; no_claim=a real browser (harness stands in for the page; pressOperation.test.ts uses real Chrome)
test('a press between two clicks sends one key down then one key up in operation order', async (context) => {
  // Arrange
  const { run, keys, mouse } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      operations: {
        operations: [open, palette, submit],
        stopOperations: [3],
      },
    },
  )
  await run.prepare()
  // Act
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  run.action('op-2', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[1]?.state === 'done', 'op 2')
  const mouseEventsBeforeLast = mouse.length
  run.action('op-3', OPERATION_ACTION)
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop inside the last click',
  )
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().operations?.[2]?.state === 'done', 'op 3')
  // Assert
  assert.deepEqual(plain(keys), [
    { type: 'keyDown', key: 'k' },
    { type: 'keyUp', key: 'k' },
  ])
  assert.equal(mouseEventsBeforeLast, 2)
  assert.equal(mouse.length, 4)
})

// Value: protects=D15: a stop armed after the press pauses inside the key handler, so the acknowledgement stays pending until the learner continues and then the press is done; fails_when=the press is acknowledged while the page is paused or never finishes after the continue; no_claim=a real debugger (harness)
test('a stop inside the key handler keeps the press unacknowledged until it is continued', async (context) => {
  // Arrange
  const { run } = await configuredRuntimeHarness(context, undefined, [], {
    operations: { operations: [palette], stopOperations: [1] },
  })
  await run.prepare()
  run.action('op-1', OPERATION_ACTION)
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop inside the key handler',
  )
  // Assert: during the pause the key is sent but not acknowledged.
  assert.equal(run.view().operations?.[0]?.ack, 'pending')
  // Act
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'done')
  // Assert
  assert.equal(run.view().operations?.[0]?.ack, 'yes')
})

// Value: protects=D13: a key the page ignores leaves the press's own after unmet, and the run fails as OPERATION_AFTER_NOT_MET at that press, naming its title; fails_when=the run reports success, or the failure names another operation; no_claim=Chrome's rendering of the conditions (harness)
test('an ignored key fails the run as OPERATION_AFTER_NOT_MET at the press with its title', async (context) => {
  // Arrange
  const { run, suppressInputPause, advance } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      operations: {
        operations: [open, palette, submit],
        stopOperations: [3],
        press: { dropKeys: true },
      },
    },
  )
  await run.prepare()
  // The declared stop is only the run's requirement: the page runs past it.
  suppressInputPause()
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  // Act
  run.action('op-2', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[1]?.ack === 'yes', 'the key')
  advance(20_000)
  await waitUntil(() => run.view().status === 'failed', 'the failure')
  // Assert
  const view = run.view()
  assert.match(
    view.failures[0] ?? '',
    /^OPERATION_AFTER_NOT_MET: Operation 2 \(Open palette\) was sent/,
  )
  assert.equal(view.operationFailure?.operationIndex, 2)
  assert.equal(view.operationFailure?.sent, 'sent')
})

// Value: protects=D30: a press whose own after already holds is refused before the key, because the result could not prove the key caused it; fails_when=the key is sent anyway or the refusal lacks the reason and path; no_claim=the page's real conditions (harness)
test('a press whose after already holds is refused with nothing sent', async (context) => {
  // Arrange
  const { run, suppressInputPause, keys } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      operations: {
        operations: [open, palette, submit],
        stopOperations: [3],
        press: { afterHoldsFromStart: true },
      },
    },
  )
  await run.prepare()
  // The declared stop is only the run's requirement: the page runs past it.
  suppressInputPause()
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  // Act
  run.action('op-2', OPERATION_ACTION)
  await waitUntil(() => run.view().status === 'failed', 'the refusal')
  // Assert
  const view = run.view()
  assert.match(view.failures[0] ?? '', /^INPUT_NOT_ACCEPTED: /)
  assert.deepEqual(plain(view.operationFailure), {
    code: 'INPUT_NOT_ACCEPTED',
    operationIndex: 2,
    path: 'operations[1].after',
    reason: 'press-after-already-holds',
    sent: 'not-sent',
    sideEffects: 'unknown',
    logId: `${run.id}#2`,
  })
  assert.deepEqual(keys, [])
})

// Value: protects=AC2/D13: a verified press is recorded without a value check and with its effect verified by after; fails_when=the record claims a value check or leaves the effect pending; no_claim=a real browser (harness)
test('a completed press is recorded with no value check and its effect verified by after', async (context) => {
  // Arrange
  const { run } = await configuredRuntimeHarness(context, undefined, [], {
    operations: { operations: [palette], stopOperations: [1] },
  })
  await run.prepare()
  // Act
  run.action('op-1', OPERATION_ACTION)
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop inside the key handler',
  )
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  // Assert
  assert.deepEqual(plain(run.view().operations?.[0]), {
    index: 1,
    kind: 'press',
    title: 'Open palette',
    state: 'done',
    ack: 'yes',
    valueCheck: 'n/a',
    effect: 'after-verified',
  })
})

// Value: protects=D24: the closed reason of a press refusal reaches the run's operationFailure and the error details an agent reads; fails_when=the reason is dropped on either path; no_claim=the MCP transport (service tests)
test('the reason of a press refusal appears in the run failure and in the error details', async (context) => {
  // Arrange
  const { run, suppressInputPause } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      operations: {
        operations: [palette],
        stopOperations: [1],
        press: {
          focus: {
            ready: true,
            tagName: 'input',
            type: 'text',
            name: 'q',
            id: 'q',
            autocomplete: '',
            isTextEntry: true,
            isInFrame: false,
            isFocused: true,
          },
        },
      },
    },
  )
  await run.prepare()
  // The declared stop is only the run's requirement: the page runs past it.
  suppressInputPause()
  // Act
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().status === 'failed', 'the refusal')
  // Assert
  const failure = run.view().operationFailure!
  assert.equal(failure.reason, 'press-focus-in-text-entry')
  assert.equal(
    describeOperationFailureDetails(failure).reason,
    'press-focus-in-text-entry',
  )
})

// Value: protects=D25: a page that is paused when the press is due gets no key and the run fails as RUN_FAILED_UNEXPECTEDLY, not sent; fails_when=the key is sent into a paused page or the failure says it was sent; no_claim=a real debugger (harness)
test('a paused page at the press refuses the key as RUN_FAILED_UNEXPECTEDLY with nothing sent', async (context) => {
  // Arrange
  const { run, suppressInputPause, keys, emitPause } =
    await configuredRuntimeHarness(context, undefined, [], {
      operations: {
        operations: [open, palette, submit],
        stopOperations: [3],
      },
    })
  await run.prepare()
  // The declared stop is only the run's requirement: the page runs past it.
  suppressInputPause()
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  // Act: the page pauses on its own before the press is sent.
  emitPause(1, 1, false)
  run.action('op-2', OPERATION_ACTION)
  await waitUntil(() => run.view().status === 'failed', 'the refusal')
  // Assert
  assert.match(run.view().failures[0] ?? '', /^RUN_FAILED_UNEXPECTEDLY: /)
  assert.equal(run.view().operationFailure?.sent, 'not-sent')
  assert.deepEqual(keys, [])
})

// Value: protects=D25/E1 d: a browser pause the run received over CDP before the debugger's stopped event keeps the key release waiting until the page runs again, so no key is lost into a paused page; fails_when=the keyUp is sent while the page is paused by such a pause (the stand-in page then records it as lost); no_claim=a real debugger (harness)
test('a browser pause received before the debugger stopped event keeps the key release waiting', async (context) => {
  // Arrange
  const { run, suppressInputPause, keys, lostKeys, emitDapStopOnly } =
    await configuredRuntimeHarness(context, undefined, [], {
      operations: {
        operations: [palette],
        stopOperations: [1],
        press: { pausesAfterKeyDown: true },
      },
    })
  await run.prepare()
  // The declared stop is only the run's requirement: the page pauses itself after the key down.
  suppressInputPause()
  // Act: the page pauses over CDP only, so the key release has time to be sent.
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => keys.length >= 1, 'the key down')
  await new Promise((resolve) => setTimeout(resolve, 300))
  const keysWhilePaused = keys.length
  emitDapStopOnly()
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of the key handler',
  )
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  // Assert
  assert.equal(keysWhilePaused, 1)
  assert.deepEqual(plain(keys), [
    { type: 'keyDown', key: 'k' },
    { type: 'keyUp', key: 'k' },
  ])
  assert.deepEqual(plain(lostKeys), [])
})

// Value: protects=OCR1-4 c: two presses with an identical after condition each complete on their own key; fails_when=the stand-in page answers both presses' after reads for one operation, so the first press never meets its after; no_claim=a real browser (harness)
test('two presses with the same after condition both complete', async (context) => {
  // Arrange
  const { run, suppressInputPause } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      operations: {
        operations: [
          palette,
          { ...palette, title: 'Open palette again' },
          submit,
        ],
        stopOperations: [3],
      },
    },
  )
  await run.prepare()
  // The declared stop is only the run's requirement: the page runs past it.
  suppressInputPause()
  // Act
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  run.action('op-2', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[1]?.state === 'done', 'op 2')
  // Assert
  assert.equal(run.view().operations?.[1]?.effect, 'after-verified')
})
