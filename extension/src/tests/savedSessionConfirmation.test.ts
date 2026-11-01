import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import type {
  OperationsConfirmationNotice,
  SavedSessionOperationsQuestion,
} from '../operationsConfirmationTypes'
import { startServer } from '../server'

import { configuredServiceHarness } from './utils/configuredServiceHarness'
import { ControlledOperationsRuntime } from './utils/controlledOperationsRuntime'
import { defer } from './utils/defer'

const OPERATION_ACTION = 'repository-operation'

const FOUR_OPERATIONS = [
  { kind: 'choose', title: 'Customer', selector: '#customer', value: 'c1' },
  { kind: 'text', title: 'Amount', selector: '#amount', text: '120' },
  { kind: 'click', title: 'Pending', selector: '#pending' },
  {
    kind: 'text',
    title: 'Password',
    selector: '#password',
    secret: 'ask-learner',
  },
]

/** Starts a version 3 run on the service harness whose view reports the given session (the stand-in for lane B's decision) and returns it ready for operation 1. */
async function startRun(
  context: TestContext,
  options: { session?: 'saved' | 'fresh'; operations?: typeof FOUR_OPERATIONS },
) {
  const harness = await configuredServiceHarness(
    context,
    undefined,
    (directory, definition) =>
      new ControlledOperationsRuntime(directory, definition),
  )
  const { service, configuration } = harness
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'start',
    configuration: {
      version: 3,
      adapter: configuration.adapter,
      book: configuration.book,
      source: configuration.source,
      participant: 'browser',
      entryPath: '/dashboard/invoices/create',
      afterOperation: 1,
      before: configuration.action.before,
      after: configuration.action.after,
      operations: options.operations ?? FOUR_OPERATIONS,
      inspections: configuration.inspections,
    },
  })
  await service.record(receipt).preparation
  const runtime = harness.runtimes[0]
  assert.ok(runtime instanceof ControlledOperationsRuntime)
  if (options.session) runtime.session = options.session
  return { ...harness, receipt, runtime }
}

/** Records every call of the three editor hooks of the confirmation, answering as the test sets. */
function recordHooks(environment: {
  confirmSavedSessionOperations?: unknown
  noticeOperationsConfirmation?: unknown
}) {
  const state = {
    questions: [] as SavedSessionOperationsQuestion[],
    notices: [] as OperationsConfirmationNotice['kind'][],
    answers: [] as boolean[],
    late: [] as ((confirmed: boolean) => void)[],
    review: false,
  }
  environment.confirmSavedSessionOperations = async (
    question: SavedSessionOperationsQuestion,
    _signal: AbortSignal,
    onLateAnswer: (confirmed: boolean) => void,
  ) => {
    state.questions.push(question)
    state.late.push(onLateAnswer)
    return state.answers.shift() ?? false
  }
  environment.noticeOperationsConfirmation = async (
    notice: OperationsConfirmationNotice,
  ) => {
    state.notices.push(notice.kind)
    return state.review ? ('review-again' as const) : undefined
  }
  return state
}

/** Catches the error an action raises. */
async function errorOf(action: () => unknown) {
  try {
    await action()
  } catch (error) {
    return error as {
      code: string
      message: string
      describe(): { details?: Record<string, unknown> }
    }
  }
  throw new Error('The action was not refused.')
}

// protects=X1/AC6a: the first operation of a saved-session run shows exactly one confirmation, only its primary answer sends operation 1, and operation 2 asks nothing; fails_when=operation 1 is sent without the dialog, the dialog shows twice, or a confirmed run asks again; no_claim=the real editor modal (stand-in hook) and the page input (the controlled runtime counts dispatches)
test('a saved-session run shows one confirmation before operation 1 and sends it after the learner chose Run', async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startRun(context, {
    session: 'saved',
  })
  const hooks = recordHooks(environment)
  hooks.answers.push(true)
  // Act
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  runtime.finish(1)
  await service.performAction({
    ...receipt,
    key: 'op-2',
    action: OPERATION_ACTION,
  })
  // Assert
  assert.equal(hooks.questions.length, 1)
  assert.equal(runtime.dispatches, 2)
  assert.equal(service.state(service.record(receipt)).confirmation, 'confirmed')
})

// protects=AC6a/CEO-S18: a decline reaches the chat as OPERATIONS_NOT_CONFIRMED with details.question saved-session-operations and sent not-sent, dispatches nothing, keeps the run ready and the key unused; fails_when=the decline is accepted, anything is dispatched, or the key is remembered; no_claim=the native dialog
test('declining the confirmation answers OPERATIONS_NOT_CONFIRMED, sends nothing and keeps the run ready and the key unused', async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startRun(context, {
    session: 'saved',
  })
  const hooks = recordHooks(environment)
  hooks.answers.push(false, true)
  // Act
  const declined = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  const stateAfterDecline = service.state(service.record(receipt))
  const reviewed = await service.reviewSavedSessionOperations(receipt.runId)
  const sent = await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  // Assert
  assert.equal(declined.code, 'OPERATIONS_NOT_CONFIRMED')
  assert.equal(
    declined.describe().details?.question,
    'saved-session-operations',
  )
  assert.equal(declined.describe().details?.sent, 'not-sent')
  assert.equal(stateAfterDecline.confirmation, 'declined')
  assert.equal(stateAfterDecline.state, 'ready')
  assert.equal(reviewed, 'confirmed')
  assert.equal(sent.operationIndex, 1)
  assert.equal(runtime.dispatches, 1)
})

// protects=DES-4/D10 d6/ENG-6: after a decline the next action is refused at once with no second dialog and no second notice until Review again, which shows a new dialog; fails_when=the dialog reopens on the chat's retry, the notice repeats while open, or Review again leaves the run unconfirmed; no_claim=the notification UI (a deferred stands in)
test('after a decline the next operation is refused without a second dialog until Review again shows a new one', async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startRun(context, {
    session: 'saved',
  })
  const hooks = recordHooks(environment)
  const noticeOpen = defer<undefined>()
  environment.noticeOperationsConfirmation = async (notice) => {
    hooks.notices.push(notice.kind)
    return noticeOpen.promise
  }
  hooks.answers.push(false, true)
  await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  // Act
  const refused = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-2',
      action: OPERATION_ACTION,
    }),
  )
  const questionsBeforeReview = hooks.questions.length
  const awaiting = service.awaitingOperationsReview()
  const reviewed = await service.reviewSavedSessionOperations(receipt.runId)
  // Assert
  assert.equal(refused.code, 'OPERATIONS_NOT_CONFIRMED')
  assert.equal(questionsBeforeReview, 1)
  // The declined notice is still open when the retry came, so no second one showed; Review again then ends with the confirmed notice.
  assert.deepEqual(hooks.notices, ['declined', 'confirmed'])
  assert.equal(awaiting?.runId, receipt.runId)
  assert.equal(reviewed, 'confirmed')
  assert.equal(hooks.questions.length, 2)
  assert.equal(service.awaitingOperationsReview(), undefined)
  assert.equal(runtime.dispatches, 0)
})

// protects=DES-4 (the status item refreshes when a run starts or stops waiting for Review again); fails_when=the service emits no change on a decline or on Review again's answer; no_claim=the status item itself (the commands test)
test('the service announces when a run starts and stops waiting for Review again', async (context) => {
  // Arrange
  const { service, receipt, environment } = await startRun(context, {
    session: 'saved',
  })
  const hooks = recordHooks(environment)
  hooks.answers.push(false, true)
  const waiting: (string | undefined)[] = []
  service.operationsReviewChanged = (): void => {
    waiting.push(service.awaitingOperationsReview()?.runId)
  }
  // Act
  await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  await service.reviewSavedSessionOperations(receipt.runId)
  // Assert
  assert.deepEqual(waiting, [receipt.runId, undefined])
})

// protects=OCR 10: operations confirmed through Review again stay confirmed when the "Operations confirmed" notice cannot be shown (the window is closing); fails_when=reviewSavedSessionOperations leaves the notice's rejection unhandled, which the extension host logs and Node's default unhandled-rejection mode turns into a crash; no_claim=the editor's notification API (a stand-in that rejects)
test('Review again confirms the operations even when the confirmed notice cannot be shown', async (context) => {
  // Arrange
  const { service, receipt, environment } = await startRun(context, {
    session: 'saved',
  })
  const hooks = recordHooks(environment)
  hooks.answers.push(false, true)
  environment.noticeOperationsConfirmation = async (notice) => {
    hooks.notices.push(notice.kind)
    if (notice.kind === 'confirmed') throw new Error('The window is closing.')
    return undefined
  }
  await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  const unhandled: unknown[] = []
  const noteUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', noteUnhandled)
  context.after(() => {
    process.off('unhandledRejection', noteUnhandled)
  })
  // Act
  const reviewed = await service.reviewSavedSessionOperations(receipt.runId)
  // A rejection nobody handles is reported once the microtasks of this turn have run.
  await new Promise((resolve) => setImmediate(resolve))
  // Assert
  assert.equal(reviewed, 'confirmed')
  assert.deepEqual(hooks.notices, ['declined', 'confirmed'])
  assert.deepEqual(unhandled, [])
})

// protects=CEO-S18/ENG-6: a dialog not answered in time is not confirmed, and its later Run answer is ignored and only offers Review again; fails_when=a late answer approves, sends operation 1, or is dropped without a notice; no_claim=the 300 s value (a constant)
test('a dialog not answered in time is not confirmed, and its later Run answer is ignored and offers Review again', async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startRun(context, {
    session: 'saved',
  })
  service.confirmationTimeoutMs = 1
  const hooks = recordHooks(environment)
  environment.confirmSavedSessionOperations = (
    _question,
    signal,
    onLateAnswer,
  ) => {
    hooks.late.push(onLateAnswer!)
    // The editor's modal stays on screen; the asker answers false once the wait aborts.
    return new Promise<boolean>((resolve) =>
      signal.addEventListener('abort', () => resolve(false)),
    )
  }
  const expired = defer<void>()
  environment.noticeOperationsConfirmation = async (notice) => {
    hooks.notices.push(notice.kind)
    if (notice.kind === 'expired-answer') expired.resolve()
    return undefined
  }
  // Act
  const timedOut = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  hooks.late[0]!(true)
  await expired.promise
  // Assert
  assert.equal(timedOut.code, 'OPERATIONS_NOT_CONFIRMED')
  assert.equal(service.state(service.record(receipt)).confirmation, 'declined')
  assert.equal(runtime.dispatches, 0)
  assert.deepEqual(hooks.notices, ['timed-out', 'expired-answer'])
})

// protects=ENG-6: a stale dialog's answer never approves the dialog that Review again shows; fails_when=any answer counts for another token; no_claim=none beyond protects
test("a stale dialog's late answer never approves the dialog Review again shows", async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startRun(context, {
    session: 'saved',
  })
  service.confirmationTimeoutMs = 1
  const hooks = recordHooks(environment)
  const second = defer<boolean>()
  let calls = 0
  environment.confirmSavedSessionOperations = (
    _question,
    signal,
    onLateAnswer,
  ) => {
    calls++
    hooks.late.push(onLateAnswer!)
    if (calls === 2) return second.promise
    return new Promise<boolean>((resolve) =>
      signal.addEventListener('abort', () => resolve(false)),
    )
  }
  await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  service.confirmationTimeoutMs = 60_000
  const reviewing = service.reviewSavedSessionOperations(receipt.runId)
  // Act
  hooks.late[0]!(true)
  second.resolve(false)
  const outcome = await reviewing
  // Assert
  assert.equal(outcome, 'declined')
  assert.equal(service.state(service.record(receipt)).confirmation, 'declined')
  assert.equal(runtime.dispatches, 0)
})

// protects=CEO-R4/ENG-6: codebook_stop while the dialog is open sends nothing, also when Run is answered as the stop begins; fails_when=an input is sent after a stop began or the action hangs; no_claim=the real run's own stopping check
test('stopping the run while the dialog is open sends nothing, even when Run is answered as the stop begins', async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startRun(context, {
    session: 'saved',
  })
  const answer = defer<boolean>()
  environment.confirmSavedSessionOperations = () => answer.promise
  const pending = errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  await Promise.resolve()
  // Act
  const stopping = service.stop({
    instanceId: service.instanceId,
    runId: receipt.runId,
  })
  answer.resolve(true)
  const refusal = await pending
  await stopping
  // Assert
  assert.equal(refusal.code, 'BUSY')
  assert.equal(runtime.dispatches, 0)
})

// protects=CEO-S18/DX-8: another key while the dialog is open answers BUSY awaiting-confirmation with details.question saved-session-operations, and the same key joins the one dialog; fails_when=two dialogs open or another key is taken; no_claim=none beyond protects
test('another key while the dialog is open answers BUSY awaiting-confirmation and the same key joins it', async (context) => {
  // Arrange
  const { service, receipt, environment } = await startRun(context, {
    session: 'saved',
  })
  const answer = defer<boolean>()
  let shown = 0
  environment.confirmSavedSessionOperations = () => {
    shown++
    return answer.promise
  }
  const first = service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  const joined = service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  // Act
  const other = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'other',
      action: OPERATION_ACTION,
    }),
  )
  answer.resolve(true)
  const [firstReceipt, joinedReceipt] = await Promise.all([first, joined])
  // Assert
  assert.equal(shown, 1)
  assert.deepEqual(joinedReceipt, firstReceipt)
  assert.equal(other.code, 'BUSY')
  assert.equal(other.describe().details?.reason, 'awaiting-confirmation')
  assert.equal(other.describe().details?.question, 'saved-session-operations')
})

// protects=CEO-S1: an editor without the dialog answers PREREQUISITE_MISSING and a dialog that throws answers PREREQUISITE_MISSING naming the confirmation dialog; fails_when=an operation is sent unconfirmed or a fault reads as a decline; no_claim=a real editor lacking modals
test('an editor that cannot show the dialog, or whose dialog throws, answers PREREQUISITE_MISSING and sends nothing', async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startRun(context, {
    session: 'saved',
  })
  const lines: string[] = []
  service.outputLog = (line) => lines.push(line.text)
  environment.confirmSavedSessionOperations = undefined
  // Act
  const missing = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  environment.confirmSavedSessionOperations = () => {
    throw new Error('modal exploded')
  }
  const thrown = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  // Assert
  assert.equal(missing.code, 'PREREQUISITE_MISSING')
  assert.equal(thrown.code, 'PREREQUISITE_MISSING')
  assert.match(thrown.message, /confirmation dialog failed/)
  assert.equal(runtime.dispatches, 0)
  assert.equal(lines.filter((line) => /modal exploded/.test(line)).length, 1)
})

// protects=DX-10/CEO-S15: a fresh-session run and a run with the learner's setting off send without a dialog; the setting-off run reads confirmationSetting off; fails_when=either is asked; no_claim=the user-settings read (environment test)
test('a fresh-session run and a run with the setting off send without a dialog', async (context) => {
  // Arrange
  const fresh = await startRun(context, { session: 'fresh' })
  const off = await startRun(context, { session: 'saved' })
  for (const run of [fresh, off]) {
    run.environment.confirmSavedSessionOperations = () => {
      throw new Error('the dialog must not open')
    }
  }
  off.environment.savedSessionConfirmationEnabled = () => false
  // Act
  await fresh.service.performAction({
    ...fresh.receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  await off.service.performAction({
    ...off.receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  const freshState = fresh.service.state(fresh.service.record(fresh.receipt))
  const offState = off.service.state(off.service.record(off.receipt))
  // Assert
  assert.equal(freshState.confirmation, 'not-needed')
  assert.equal('confirmationSetting' in freshState, false)
  assert.equal(offState.confirmation, 'not-needed')
  assert.equal(offState.confirmationSetting, 'off')
  assert.equal(fresh.runtime.dispatches + off.runtime.dispatches, 2)
})

// protects=DES-4/ENG-8/DX-1: the dialog names the repository folder, the page and each operation, with a secret hidden and a choice by its label, and a failed page read only turns a choice into chosen when sent; fails_when=an option value is shown instead of its label, a secret is shown, or a failed read blocks the dialog; no_claim=the page read itself
test('the dialog names the page and each operation, hides a secret and shows a choice by its label', async (context) => {
  // Arrange
  const withFacts = await startRun(context, { session: 'saved' })
  withFacts.runtime.confirmationFacts = [
    { index: 1, found: true, secret: false, optionLabel: 'Evil Rabbit' },
  ]
  const failing = await startRun(context, { session: 'saved' })
  failing.runtime.confirmationFactsFailure = new Error('page gone')
  const first = recordHooks(withFacts.environment)
  const second = recordHooks(failing.environment)
  // Act
  await errorOf(() =>
    withFacts.service.performAction({
      ...withFacts.receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  await errorOf(() =>
    failing.service.performAction({
      ...failing.receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  // Assert
  assert.equal(first.questions[0]?.entryPath, '/dashboard/invoices/create')
  assert.deepEqual(
    first.questions[0]?.operations.map((line) => line.value),
    ['Evil Rabbit', '120', undefined, '(hidden)'],
  )
  assert.equal(second.questions[0]?.operations[0]?.value, '(chosen when sent)')
})

// protects=X1 asked once per run + DX-3 order: the confirmation comes before the secret box, a declined secret keeps the run confirmed, and the next action asks only the secret; fails_when=the confirmation is asked twice or the secret first; no_claim=the real boxes
test('a saved-session run asks the confirmation first, then the secret, and a declined secret does not ask the confirmation again', async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startRun(context, {
    session: 'saved',
    operations: [
      {
        kind: 'text',
        title: 'Password',
        selector: '#password',
        secret: 'ask-learner',
      },
      { kind: 'click', title: 'Submit', selector: '#submit' },
    ] as typeof FOUR_OPERATIONS,
  })
  const order: string[] = []
  environment.confirmSavedSessionOperations = async () => {
    order.push('confirm')
    return true
  }
  environment.askLearnerSecret = async () => {
    order.push('secret')
    return undefined
  }
  // Act
  const first = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  const second = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  // Assert
  assert.deepEqual(order, ['confirm', 'secret', 'secret'])
  assert.equal(first.describe().details?.question, 'secret')
  assert.equal(second.code, 'OPERATIONS_NOT_CONFIRMED')
  assert.equal(service.state(service.record(receipt)).confirmation, 'confirmed')
  assert.equal(runtime.dispatches, 0)
})

// protects=the Study-page bypass: a direct service.action of operation 1 on an unconfirmed saved-session run is refused and sends nothing; fails_when=any caller sends operation 1 unconfirmed; no_claim=the Study webview button wiring
test('a direct action on an unconfirmed saved-session run is refused and sends nothing', async (context) => {
  // Arrange
  const { service, receipt, runtime } = await startRun(context, {
    session: 'saved',
  })
  // Act
  const refusal = await errorOf(() =>
    service.action({ ...receipt, key: 'op-1', action: OPERATION_ACTION }),
  )
  // Assert
  assert.equal(refusal.code, 'OPERATIONS_NOT_CONFIRMED')
  assert.equal(runtime.dispatches, 0)
})

// protects=CEO-R7/ENG-4: Output records that the confirmation was shown and declined without any declared value or label; fails_when=a declared value or option label reaches Output; no_claim=the real channel
test('the Output lines record the confirmation without any operation value', async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startRun(context, {
    session: 'saved',
  })
  runtime.confirmationFacts = [
    { index: 1, found: true, secret: false, optionLabel: 'Evil Rabbit' },
  ]
  const lines: string[] = []
  service.outputLog = (line) => lines.push(line.text)
  recordHooks(environment)
  // Act
  await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    }),
  )
  // Assert
  // The random run id may hold "120" or "c1", so it is taken out before the values are looked for
  const joined = lines.join('\n').replaceAll(receipt.runId, '<run>')
  assert.match(
    joined,
    /Run <run>: saved-session confirmation of 4 operations shown/,
  )
  assert.match(joined, /declined/)
  assert.doesNotMatch(joined, /120|Evil Rabbit|c1/)
})

// protects=AC6a/DX-6 over MCP: a decline reaches the chat as isError true, ok false, code OPERATIONS_NOT_CONFIRMED; fails_when=the decline reads as a success; no_claim=the native dialog
test('a declined confirmation reaches the chat as an error result', async (context) => {
  // Arrange
  const { service, receipt, environment } = await startRun(context, {
    session: 'saved',
  })
  recordHooks(environment)
  const endpoint = await startServer(service)
  context.after(() => endpoint.close())
  const client = new Client({
    name: 'saved-session-confirmation-test',
    version: '1.0',
  })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
      },
    }),
  )
  context.after(() => client.close())
  // Act
  const result = await client.callTool({
    name: 'codebook_action',
    arguments: {
      instanceId: receipt.instanceId,
      runId: receipt.runId,
      key: 'op-1',
      action: OPERATION_ACTION,
    },
  })
  // Assert
  const structured = result.structuredContent as {
    ok: boolean
    error: { code: string }
  }
  assert.equal(result.isError, true)
  assert.equal(structured.ok, false)
  assert.equal(structured.error.code, 'OPERATIONS_NOT_CONFIRMED')
})
