import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { RepositoryOperation } from '../repositoryConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  configuredRuntimeHarness,
  type FakeControl,
} from './utils/configuredRuntimeHarness'

const OPERATION_ACTION = 'repository-operation'

/** Copies a value out of the run module's realm, whose objects a strict deep comparison would not take for this realm's. @example plain(run.view().operations?.[0]) */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}
const choose: RepositoryOperation = {
  kind: 'choose',
  title: 'Customer',
  selector: '#customer',
  value: 'c1',
}
const amount: RepositoryOperation = {
  kind: 'text',
  title: 'Amount',
  selector: '#amount',
  text: '120',
}
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
/** A required value of the harness page at a stop, as the single-action tests declare it. */
const ENABLED_STOP = [
  { path: 'enabled', mode: 'value', required: true },
] as const
/** The control the harness page reports for the amount: a number input. */
const NUMBER_CONTROLS: Record<string, FakeControl> = {
  '#amount': { tagName: 'input', type: 'number' },
}
/** The control the harness page reports for the customer: a select with one usable option. */
const CUSTOMER_CONTROLS: Record<string, FakeControl> = {
  '#customer': { tagName: 'select', options: [{ value: 'c1' }] },
}

// Value: protects=AC3: four ordered operations (choose, text, click, submit) each sent by its own action, with a client stop inside the text and a stop inside the submit, run to the result; each step's record, the receipts and the refusals between steps; fails_when=an operation is offered before the previous one is done, a stop of a later operation arms early, a record skips a state or the run completes without the last stop's continuation; no_claim=a real browser or debugger: the configured runtime harness stands in for the page, the debugger events and the protocol (the engine itself is proven against real Chrome in configuredOperations.test.ts)
test('four operations run in order, each offered only after the previous one is done, with stops inside the second and the fourth', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    [{ line: 1, column: 7, inspections: [...ENABLED_STOP] }],
    {
      operations: {
        operations: [choose, amount, pending, submit],
        stopOperations: [2, 4],
        controls: { ...CUSTOMER_CONTROLS, ...NUMBER_CONTROLS },
      },
    },
  )
  const { run, ownedBreakpointsRequested } = harness
  await run.prepare()
  const offered = (): string | undefined => run.view().nextAction
  // Assert: the run offers the operation action and no stop is armed before its operation.
  assert.equal(offered(), OPERATION_ACTION)
  assert.equal(ownedBreakpointsRequested(), 0)

  // Act: operation 1, a choose with no stop.
  const first = run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  // Assert
  assert.equal(first.operationIndex, 1)
  assert.deepEqual(plain(run.view().operations?.[0]), {
    index: 1,
    kind: 'choose',
    title: 'Customer',
    state: 'done',
    ack: 'yes',
    valueCheck: 'passed',
    effect: 'dispatched',
  })
  assert.equal(run.view().status, 'ready')
  assert.equal(offered(), OPERATION_ACTION)
  assert.equal(ownedBreakpointsRequested(), 0)

  // Act: operation 2, whose stop pauses inside the page's handler before the input is acknowledged.
  run.action('op-2', OPERATION_ACTION)
  const firstStop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of operation 2',
  )
  // Assert
  assert.equal(run.view().status, 'paused-browser')
  assert.equal(offered(), undefined)
  assert.deepEqual(plain(run.view().operations?.[1]), {
    index: 2,
    kind: 'text',
    title: 'Amount',
    state: 'paused',
    ack: 'pending',
    valueCheck: 'pending',
    effect: 'pending',
  })
  assert.equal(ownedBreakpointsRequested(), 1)
  assert.throws(
    () => run.action('op-3', OPERATION_ACTION),
    /conflict: wrong, repeated or unavailable input/,
  )

  // Act: the learner-visible stop is continued.
  await run.continue('browser', firstStop.pause)
  await waitUntil(() => run.view().operations?.[1]?.state === 'done', 'op 2')
  // Assert
  assert.deepEqual(plain(run.view().operations?.[1]), {
    index: 2,
    kind: 'text',
    title: 'Amount',
    state: 'done',
    ack: 'yes',
    valueCheck: 'passed',
    effect: 'dispatched',
  })
  assert.equal(run.view().status, 'ready')
  assert.equal(offered(), OPERATION_ACTION)

  // Act: operation 3, a click with no stop.
  run.action('op-3', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[2]?.state === 'done', 'op 3')
  assert.equal(run.view().status, 'ready')
  assert.equal(run.view().operations?.[3]?.state, 'not-run')

  // Act: operation 4, the submit, whose stop follows it.
  run.action('op-4', OPERATION_ACTION)
  const lastStop = await waitUntil(
    () => run.view().snapshots[1] && run.view().participants.browser.snapshot,
    'the stop of operation 4',
  )
  // Assert: no operation is left to offer, and a further action is refused.
  assert.equal(offered(), undefined)
  assert.throws(
    () => run.action('op-5', OPERATION_ACTION),
    /conflict: wrong, repeated or unavailable input/,
  )
  await run.continue('browser', lastStop.pause)
  await waitUntil(() => run.view().status === 'completed', 'the result')
  await run.stop()

  // Assert
  const view = run.view()
  assert.deepEqual(
    plain(
      view.operations?.map((operation) => [operation.state, operation.effect]),
    ),
    [
      ['done', 'dispatched'],
      ['done', 'dispatched'],
      ['done', 'dispatched'],
      ['done', 'after-verified'],
    ],
  )
  assert.equal(view.finalOutcome, 'demonstrated')
  assert.equal(view.snapshots.length, 2)
  assert.equal(harness.inputsSeen(), 4)
  assert.equal(
    run.action('op-2', OPERATION_ACTION).operationIndex,
    2,
    'a repeated key answers the first receipt',
  )
})

// protects=ENG-1: every stop of an operation is taken before the next operation is offered, and the next one is offered the moment the last of them is continued; fails_when=operation 2 is offered between two stops of operation 1, or is not offered after the last; no_claim=a real debugger (harness)
test('a run offers the next operation only after the last stop declared for the current one is continued', async (context) => {
  // Arrange
  const { run } = await configuredRuntimeHarness(
    context,
    undefined,
    [{ line: 1, column: 7, inspections: [...ENABLED_STOP] }],
    {
      operations: {
        operations: [pending, submit],
        stopOperations: [1, 1],
      },
    },
  )
  await run.prepare()
  run.action('op-1', OPERATION_ACTION)
  const first = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the first stop of operation 1',
  )
  // Act
  await run.continue('browser', first.pause)
  const second = await waitUntil(
    () => run.view().snapshots[1] && run.view().participants.browser.snapshot,
    'the second stop of operation 1',
  )
  // Assert: between the two stops of one operation nothing is offered.
  assert.equal(run.view().nextAction, undefined)
  // Act
  await run.continue('browser', second.pause)
  await waitUntil(() => run.view().status === 'ready', 'ready for operation 2')
  // Assert
  assert.equal(run.view().nextAction, OPERATION_ACTION)
  assert.deepEqual(
    plain(run.view().operations?.map((operation) => operation.state)),
    ['done', 'not-run'],
  )
  run.action('op-2', OPERATION_ACTION)
  await waitUntil(() => run.view().status === 'completed', 'the result')
})

// protects=ENG-1/ENG-2: a stop declared for a later operation is not armed while an earlier operation runs, so its line cannot pause the run before its turn; fails_when=the owned breakpoint exists before the operation it follows is sent; no_claim=a real debugger (harness)
test('a stop is armed only when its operation is sent, never while an earlier operation runs', async (context) => {
  // Arrange
  const { run, ownedBreakpointsRequested } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      operations: { operations: [pending, submit], stopOperations: [2] },
    },
  )
  await run.prepare()
  // Act
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  const beforeTurn = ownedBreakpointsRequested()
  run.action('op-2', OPERATION_ACTION)
  await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of operation 2',
  )
  // Assert
  assert.equal(beforeTurn, 0)
  assert.equal(ownedBreakpointsRequested(), 1)
})

// protects=ENG-2: a stop inside an input handler leaves the acknowledgement and the value check pending until it is continued, and a value check that fails afterwards fails the run as INPUT_NOT_ACCEPTED, reported as sent; fails_when=the record shows the input acknowledged during the pause, or the failure is uncoded; no_claim=a real page (harness stands in for the text control)
test('a value check that fails after the stop is continued fails the run as INPUT_NOT_ACCEPTED with the operation recorded as sent', async (context) => {
  // Arrange
  const { run } = await configuredRuntimeHarness(context, undefined, [], {
    operations: {
      operations: [amount],
      stopOperations: [1],
      failValueCheck: ['#amount'],
    },
  })
  await run.prepare()
  run.action('op-1', OPERATION_ACTION)
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop inside the handler',
  )
  // Assert: during the pause neither the acknowledgement nor the value check is known.
  assert.equal(run.view().operations?.[0]?.ack, 'pending')
  assert.equal(run.view().operations?.[0]?.valueCheck, 'pending')
  // Act
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().status === 'failed', 'the failure')
  // Assert
  const view = run.view()
  assert.match(view.failures[0] ?? '', /^INPUT_NOT_ACCEPTED: /)
  assert.deepEqual(plain(view.operationFailure), {
    code: 'INPUT_NOT_ACCEPTED',
    operationIndex: 1,
    path: 'operations[0].text',
    sent: 'sent',
    sideEffects: 'unknown',
    logId: `${run.id}#1`,
  })
  assert.deepEqual(plain(view.operations?.[0]), {
    index: 1,
    kind: 'text',
    title: 'Amount',
    state: 'failed',
    ack: 'yes',
    valueCheck: 'failed',
    effect: 'pending',
  })
})

// protects=a chat text sent to a secret control sends nothing and fails the run with SECRET_INPUT_FROM_CHAT, not sent; fails_when=the text reaches the page, or the failure is uncoded or says it was sent; no_claim=the real control (engine tests)
test('chat text into a password control fails the run before anything is typed', async (context) => {
  // Arrange
  const { run, insertedTexts } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      operations: {
        operations: [
          {
            kind: 'text',
            title: 'Password',
            selector: '#password',
            text: 'hunter2',
          },
        ],
        stopOperations: [1],
        controls: { '#password': { tagName: 'input', type: 'password' } },
      },
    },
  )
  await run.prepare()
  // Act
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().status === 'failed', 'the refusal')
  // Assert
  const view = run.view()
  assert.match(view.failures[0] ?? '', /^SECRET_INPUT_FROM_CHAT: /)
  assert.doesNotMatch(view.failures[0] ?? '', /hunter2/)
  assert.deepEqual(insertedTexts, [])
  assert.equal(view.operationFailure?.sent, 'not-sent')
  assert.equal(view.operationFailure?.sideEffects, 'none')
  assert.equal(view.operations?.[0]?.state, 'failed')
})

// protects=an ask-learner operation is typed with the learner's value, which the run keeps in memory for masking, and the secret frame gate is armed by the operation; fails_when=the value is not typed, the gate stays unarmed, or the value shows in the journal, the view or the failure; no_claim=masking of sinks (another lane); the control is the harness's stand-in
test('an ask-learner operation types the learner value with the frame gate armed and keeps the value out of the journal and the view', async (context) => {
  // Arrange
  const { run, insertedTexts } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      operations: {
        operations: [
          {
            kind: 'text',
            title: 'Password',
            selector: '#password',
            secret: 'ask-learner',
          },
        ],
        stopOperations: [1],
        controls: { '#password': { tagName: 'input', type: 'password' } },
      },
    },
  )
  await run.prepare()
  // Act
  run.action('op-1', OPERATION_ACTION, { learnerSecret: 'typed-by-learner' })
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of the password operation',
  )
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().status === 'completed', 'the result')
  await run.stop()
  // Assert
  assert.deepEqual(insertedTexts, ['typed-by-learner'])
  assert.equal(run.secretFrameGate.armed, true)
  assert.equal([...run.learnerSecrets].join(','), 'typed-by-learner')
  const serialized = JSON.stringify({
    view: run.view(),
    events: run.view().events,
  })
  assert.doesNotMatch(serialized, /typed-by-learner/)
})

// protects=ENG-5: when the secret gate cannot arm for operation 2, the run fails as operation 2 (not sent, no side effects) with SECRET_BECAME_VISIBLE and nothing is typed; fails_when=the failure names operation 1 or says sent, or the secret is typed; no_claim=a real page (the harness stands in for the gate's observer, which finds a plain text control)
test('a secret gate that cannot arm for operation 2 fails the run as operation 2, not sent', async (context) => {
  // Arrange
  const { run, insertedTexts } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      operations: {
        operations: [
          amount,
          {
            kind: 'text',
            title: 'Password',
            selector: '#password',
            secret: 'ask-learner',
          },
        ],
        stopOperations: [2],
        controls: {
          '#password': {
            tagName: 'input',
            type: 'password',
            observedType: 'text',
          },
        },
      },
    },
  )
  await run.prepare()
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  insertedTexts.length = 0
  // Act
  run.action('op-2', OPERATION_ACTION, { learnerSecret: 'typed-by-learner' })
  await waitUntil(() => run.view().status === 'failed', 'the refusal')
  // Assert
  const view = run.view()
  assert.match(view.failures[0] ?? '', /^SECRET_BECAME_VISIBLE: Operation 2 /)
  assert.deepEqual(plain(view.operationFailure), {
    code: 'SECRET_BECAME_VISIBLE',
    operationIndex: 2,
    path: 'operations[1].selector',
    sent: 'not-sent',
    sideEffects: 'none',
    logId: `${run.id}#2`,
  })
  assert.deepEqual(insertedTexts, [])
})

// protects=an ask-learner operation cannot be reserved without the learner's secret; fails_when=the run accepts the operation and types nothing; no_claim=the learner is asked by the service (service tests)
test('an ask-learner operation without the learner secret is not accepted', async (context) => {
  // Arrange
  const { run } = await configuredRuntimeHarness(context, undefined, [], {
    operations: {
      operations: [
        {
          kind: 'text',
          title: 'Password',
          selector: '#p',
          secret: 'ask-learner',
        },
      ],
      stopOperations: [1],
    },
  })
  await run.prepare()
  // Act, Assert
  assert.throws(
    () => run.action('op-1', OPERATION_ACTION),
    /conflict: the learner secret was not supplied/,
  )
  assert.equal(run.view().nextAction, OPERATION_ACTION)
})

// protects=a repository-click sent to a version 3 run is not accepted, and a version 3 action sent to a version 1 run is not either; fails_when=either action is taken; no_claim=the service's BUSY answer (service tests)
test('the run of one configuration version refuses the other version’s action', async (context) => {
  // Arrange
  const operationsRun = await configuredRuntimeHarness(context, undefined, [], {
    operations: { operations: [pending], stopOperations: [1] },
  })
  const singleRun = await configuredRuntimeHarness(context)
  await operationsRun.run.prepare()
  await singleRun.run.prepare()
  // Act, Assert
  assert.throws(
    () => operationsRun.run.action('click', 'repository-click'),
    /conflict/,
  )
  assert.throws(
    () => singleRun.run.action('operation', OPERATION_ACTION),
    /conflict/,
  )
})

// protects=OPERATION_AFTER_NOT_MET: a last operation whose run-level after conditions never hold fails the run with the coded text and the sent fields; fails_when=the failure is the plain timeout text, or the operation is reported as not sent; no_claim=Chrome's rendering of the conditions (harness page)
test('a result that never shows fails the run as OPERATION_AFTER_NOT_MET naming the run-level after conditions', async (context) => {
  // Arrange
  const { run, advance, failAfterWith, afterReads } =
    await configuredRuntimeHarness(context, undefined, [], {
      operations: { operations: [submit], stopOperations: [1] },
    })
  await run.prepare()
  run.action('op-1', OPERATION_ACTION)
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop',
  )
  failAfterWith({ conditionIndex: 0, reason: 'not-visible' })
  await run.continue('browser', stop.pause)
  await waitUntil(() => afterReads() > 0, 'the after condition read')
  // Act
  advance(20_000)
  await waitUntil(() => run.view().status === 'failed', 'the failure')
  // Assert
  const view = run.view()
  assert.match(
    view.failures[0] ?? '',
    /^OPERATION_AFTER_NOT_MET: Operation 1 \(Create Invoice\) was sent, but its result could not be confirmed/,
  )
  assert.deepEqual(plain(view.operationFailure), {
    code: 'OPERATION_AFTER_NOT_MET',
    operationIndex: 1,
    path: 'after',
    sent: 'sent',
    sideEffects: 'unknown',
    logId: `${run.id}#1`,
  })
  assert.equal(view.operations?.[0]?.state, 'failed')
})

// protects=an operation's own after conditions that never hold fail the run as OPERATION_AFTER_NOT_MET naming condition 2 and its reason, not the plain deadline text; fails_when=the failure names no condition (the run-level deadline wording) or the operation is reported as not sent; no_claim=Chrome's rendering of the conditions (the harness page answers the read)
test('an operation whose own after conditions never hold fails naming the failing condition of that operation', async (context) => {
  // Arrange
  const operationWithAfter: RepositoryOperation = {
    ...amount,
    after: [
      { kind: 'visible', selector: '#first' },
      { kind: 'visible', selector: '#second' },
    ],
  }
  const { run, advance, failOperationAfterWith, evaluatedExpressions } =
    await configuredRuntimeHarness(context, undefined, [], {
      operations: {
        operations: [operationWithAfter, submit],
        stopOperations: [2],
      },
    })
  await run.prepare()
  failOperationAfterWith(1, { conditionIndex: 1, reason: 'not-visible' })
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => run.view().operations?.[0]?.ack === 'yes',
    'the acknowledged input',
  )
  const readsBefore = evaluatedExpressions.length
  await waitUntil(
    () => evaluatedExpressions.length > readsBefore,
    'a read of the operation after conditions',
  )
  // Act
  advance(20_000)
  await waitUntil(() => run.view().status === 'failed', 'the failure')
  // Assert
  const view = run.view()
  assert.match(
    view.failures[0] ?? '',
    /^OPERATION_AFTER_NOT_MET: Operation 1 \(Amount\) was sent, but its result could not be confirmed: Timed out waiting for the operation's after conditions: condition 2 not-visible/,
  )
  assert.deepEqual(plain(view.operationFailure), {
    code: 'OPERATION_AFTER_NOT_MET',
    operationIndex: 1,
    path: 'operations[0].after',
    sent: 'sent',
    sideEffects: 'unknown',
    logId: `${run.id}#1`,
  })
})

// protects=only the wait for an operation's own after conditions maps to OPERATION_AFTER_NOT_MET: a failure whose text merely mentions after conditions, before the input, is RUN_FAILED_UNEXPECTEDLY, not sent; fails_when=an error is classified by its words, so a transport failure before the input reads as a result that did not show; no_claim=a real transport (the harness page throws while resolving the control)
test('a failure before the input that mentions after conditions in its text is an unexpected failure, not a missing result', async (context) => {
  // Arrange
  const { run, insertedTexts } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      operations: {
        operations: [amount],
        stopOperations: [1],
        selectControlFailsWith: 'lookup of the after conditions failed',
      },
    },
  )
  await run.prepare()
  // Act
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().status === 'failed', 'the failure')
  // Assert
  const view = run.view()
  assert.match(view.failures[0] ?? '', /^RUN_FAILED_UNEXPECTEDLY: /)
  assert.equal(view.operationFailure?.sent, 'not-sent')
  assert.deepEqual(insertedTexts, [])
})

// protects=an adapter pause that does not retire within the bound fails the run as RUN_FAILED_UNEXPECTEDLY with the operation's log id, sent because the input was dispatched, never as a missing result; fails_when=the wait for adapter pauses is reported as OPERATION_AFTER_NOT_MET; no_claim=a real debugger (the test marks the browser participant paused without an announced stop)
test('an adapter pause that never retires fails the operation as an unexpected failure, not a missing result', async (context) => {
  // Arrange
  const { run, advance } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      operations: {
        operations: [amount, submit],
        stopOperations: [2],
      },
    },
  )
  await run.prepare()
  const participants = Reflect.get(run, 'participants') as {
    browser: { unannouncedPause: boolean }
  }
  participants.browser.unannouncedPause = true
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(
    () => run.view().operations?.[0]?.ack === 'yes',
    'the acknowledged input',
  )
  // Act
  advance(20_000)
  await waitUntil(() => run.view().status === 'failed', 'the failure')
  // Assert
  const view = run.view()
  assert.match(view.failures[0] ?? '', /^RUN_FAILED_UNEXPECTEDLY: /)
  assert.deepEqual(plain(view.operationFailure), {
    code: 'RUN_FAILED_UNEXPECTEDLY',
    operationIndex: 1,
    sent: 'sent',
    sideEffects: 'unknown',
    logId: `${run.id}#1`,
  })
})

// protects=a stop that arrives while the last stop of operation 1 is being continued, and belongs to no declared stop of operation 1, fails the run as an unexpected or additional stop before operation 1 settles; fails_when=the queued stop is silently dropped, so the run offers operation 2 or later fails with a misleading result message; no_claim=a real debugger (the harness reports the pause at the column of the stop declared for operation 2)
test('a stop queued while the last stop of an operation is continued fails the run as an unexpected stop', async (context) => {
  // Arrange
  const { run, holdContinuation, emitDapStopOnly } =
    await configuredRuntimeHarness(
      context,
      undefined,
      [{ line: 1, column: 7, inspections: [...ENABLED_STOP] }],
      {
        operations: {
          operations: [amount, submit],
          stopOperations: [1, 2],
          controls: { ...NUMBER_CONTROLS },
        },
      },
    )
  const receipts = holdContinuation()
  await run.prepare()
  run.action('op-1', OPERATION_ACTION)
  const firstStop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of operation 1',
  )
  const continuation = run
    .continue('browser', firstStop.pause)
    .catch(() => undefined)
  await receipts.started
  // Act: a debugger stop of the same participant arrives after the continuation's DAP receipt and before operation 2 was sent.
  receipts.dap()
  emitDapStopOnly()
  receipts.cdp()
  receipts.input()
  receipts.response()
  await continuation
  await waitUntil(() => run.view().status === 'failed', 'the failure')
  // Assert
  const view = run.view()
  assert.match(
    view.failures.join('\n'),
    /Unexpected or additional browser stop invalidated the declared operation/,
  )
  assert.notEqual(view.operations?.[0]?.state, 'done')
})

// protects=E4: a full document load between operations ends a Next run with NAVIGATION_BEFORE_LAST_OPERATION, while the entry load and a load after the last operation are not failures; fails_when=a load before the last operation is followed silently, or the entry load fails the run; no_claim=Chrome's real frameNavigated events (harness reports them)
test('a document load after operation 1 of 2 ends the run, and the entry load does not', async (context) => {
  // Arrange
  const { run, reloadPage } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      operations: {
        operations: [choose, pending],
        stopOperations: [2],
        controls: CUSTOMER_CONTROLS,
      },
    },
  )
  await run.prepare()
  // The entry page's own load.
  reloadPage()
  assert.equal(run.view().status, 'ready')
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  // Act
  reloadPage()
  await waitUntil(() => run.view().status === 'failed', 'the failure')
  // Assert
  assert.match(
    run.view().failures[0] ?? '',
    /^NAVIGATION_BEFORE_LAST_OPERATION: The page loaded a new document after operation 1 and before operation 2 could be sent/,
  )
  assert.equal(run.view().operationFailure?.sent, 'sent')
})

// protects=CEO-R7/DX-5: one structured Output line per operation event, each carrying the log id of its operation, and none holding a typed value; fails_when=a line leaks the learner's secret or the declared text, or a refusal has no line with its log id; no_claim=the editor's Output channel (the line sink is injected)
test('the Output lines of a run name each operation by its log id and hold no typed value', async (context) => {
  // Arrange
  const lines: { level: string; text: string }[] = []
  const now = Date.now()
  const { run } = await configuredRuntimeHarness(
    context,
    {
      signal: new AbortController().signal,
      deadlineAt: now + 600_000,
      preparationDeadlineAt: now + 90_000,
      runId: 'service-run-1',
      outputLog: (line) => lines.push(line),
    },
    [],
    {
      operations: {
        operations: [
          {
            kind: 'text',
            title: 'Email',
            selector: '#email',
            text: 'declared-text',
          },
          {
            kind: 'text',
            title: 'Password',
            selector: '#password',
            secret: 'ask-learner',
          },
        ],
        stopOperations: [2],
        controls: { '#password': { tagName: 'input', type: 'password' } },
      },
    },
  )
  await run.prepare()
  // Act
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  run.action('op-2', OPERATION_ACTION, { learnerSecret: 'typed-by-learner' })
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of operation 2',
  )
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().status === 'completed', 'the result')
  // Assert
  const text = lines.map((line) => line.text).join('\n')
  assert.match(
    text,
    /Run service-run-1: operation 1\/2 sending \(text\) \[log service-run-1#1\]/,
  )
  assert.match(
    text,
    /Run service-run-1: operation 2\/2 done \(after-verified\) \[log service-run-1#2\]/,
  )
  assert.doesNotMatch(text, /typed-by-learner|declared-text/)
})

// protects=the run's aggregate operation receipt only moves forward: once operation 1 is acknowledged, starting operation 2 does not take the acknowledgement back, so a checkpoint saved during operation 2's stop passes the library's checkpoint rule; fails_when=accepting a later operation resets inputAcknowledged to false; no_claim=the library save itself (assertStudyCheckpoint compares exactly this field); the page and debugger are the controlled harness
test('accepting operation 2 keeps the acknowledgement of operation 1 in the aggregate receipt', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(
    context,
    undefined,
    [{ line: 1, column: 7, inspections: [...ENABLED_STOP] }],
    {
      operations: {
        operations: [choose, amount],
        stopOperations: [2, 2],
        controls: { ...CUSTOMER_CONTROLS, ...NUMBER_CONTROLS },
      },
    },
  )
  const { run } = harness
  await run.prepare()
  run.action('op-1', OPERATION_ACTION)
  await waitUntil(() => run.view().operations?.[0]?.state === 'done', 'op 1')
  const afterFirst = plain(run.view().operation)
  // Act
  run.action('op-2', OPERATION_ACTION)
  await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of operation 2',
  )
  const duringSecond = plain(run.view().operation)
  // Assert
  assert.equal(afterFirst?.inputAcknowledged, true)
  assert.equal(duringSecond?.inputAcknowledged, true)
  assert.equal(plain(run.view().operations?.[1])?.ack, 'pending')
})
