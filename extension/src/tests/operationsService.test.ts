import assert from 'node:assert/strict'
import { basename } from 'node:path'
import { test, type TestContext } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer } from '../server'

import { configuredServiceHarness } from './utils/configuredServiceHarness'
import { ControlledOperationsRuntime } from './utils/controlledOperationsRuntime'

const OPERATION_ACTION = 'repository-operation'

/** Starts a version 3 run on the service harness and returns it ready for its first operation. @example const { service, receipt, runtime } = await startOperationsRun(context, 'run-1') */
async function startOperationsRun(
  context: TestContext,
  key: string,
  operations: readonly Record<string, unknown>[] = [
    { kind: 'click', title: 'First', selector: '#first' },
    {
      kind: 'text',
      title: 'Password',
      selector: '#password',
      secret: 'ask-learner',
    },
    { kind: 'click', title: 'Last', selector: '#last' },
  ],
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
    key,
    configuration: {
      version: 3,
      adapter: configuration.adapter,
      book: configuration.book,
      source: configuration.source,
      participant: 'browser',
      afterOperation: 1,
      before: configuration.action.before,
      after: configuration.action.after,
      operations,
      inspections: configuration.inspections,
    },
  })
  const record = service.record(receipt)
  await record.preparation
  const runtime = harness.runtimes[0]
  assert.ok(runtime instanceof ControlledOperationsRuntime)
  return { ...harness, receipt, record, runtime }
}

/** Connects an MCP client to the service, as the agent's chat does. */
async function connectMcpClient(
  context: TestContext,
  service: Parameters<typeof startServer>[0],
) {
  const endpoint = await startServer(service)
  context.after(() => endpoint.close())
  const client = new Client({ name: 'operations-tool-test', version: '1.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
      },
    }),
  )
  context.after(() => client.close())
  return client
}

/** Catches the domain error an action raises. */
async function errorOf(action: () => unknown): Promise<StudyError> {
  try {
    await action()
  } catch (error) {
    assert.ok(error instanceof StudyError)
    return error
  }
  throw new Error('The action was not refused.')
}

// protects=DX-7/ENG-2: an operation action answers an acceptance receipt at once, lists the run's operations in the run resource, and the same key answers the same receipt, also after the run moved on; fails_when=the receipt lacks operationIndex or accepted, a repeat takes another operation, or the resource lists receipts instead of progress; no_claim=the real run's progress (run tests); the synthetic runtime stands in
test('an operation action answers an acceptance receipt, and its key answers the same receipt after the run moved on', async (context) => {
  // Arrange
  const { service, receipt, runtime } = await startOperationsRun(context, 'ack')
  // Act
  const first = await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  runtime.finish(1)
  const repeated = await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  const state = service.state(service.record(receipt))
  // Assert
  assert.deepEqual(first, {
    operationId: first.operationId,
    key: 'op-1',
    runUri: first.runUri,
    operationIndex: 1,
    accepted: true,
  })
  assert.deepEqual(repeated, first)
  assert.equal(runtime.dispatches, 1)
  assert.deepEqual(
    state.operations,
    runtime.records.map((record) => ({ ...record })),
  )
  assert.deepEqual(state.nextActions.includes(OPERATION_ACTION), true)
})

// protects=DX-8: a repository-click sent to a version 3 run keeps code BUSY and says it was not sent, which action is expected and not to retry; fails_when=the code changes, the expected action is missing or the request is taken; no_claim=none beyond protects
test('a repository-click sent to a version 3 run answers BUSY with the expected action and sent not-sent', async (context) => {
  // Arrange
  const { service, receipt, runtime } = await startOperationsRun(
    context,
    'busy',
  )
  // Act
  const error = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'click',
      action: 'repository-click',
    }),
  )
  // Assert
  assert.equal(error.code, 'BUSY')
  const described = error.describe()
  assert.deepEqual(described.details, {
    reason: 'action-mismatch',
    expected: OPERATION_ACTION,
    sent: 'not-sent',
    runUri: described.details?.runUri,
  })
  assert.match(
    described.recovery,
    /^Do not retry this request\. Send the expected action repository-operation with a new key\. Nothing was sent\./,
  )
  assert.equal(runtime.dispatches, 0)
})

// protects=DX-7: a key reused with another action is IDEMPOTENCY_CONFLICT; fails_when=it is taken as a new action; no_claim=none beyond protects
test('a key reused with another action answers IDEMPOTENCY_CONFLICT', async (context) => {
  // Arrange
  const { service, receipt } = await startOperationsRun(context, 'conflict')
  await service.performAction({
    ...receipt,
    key: 'same',
    action: OPERATION_ACTION,
  })
  // Act
  const error = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'same',
      action: 'repository-click',
    }),
  )
  // Assert
  assert.equal(error.code, 'IDEMPOTENCY_CONFLICT')
})

// protects=the refusals between operations, as for extension clicks: a paused run answers RUN_PAUSED, a run mid-input ACTION_IN_PROGRESS, and a finished run NO_MORE_ACTIONS, each saying nothing was sent; fails_when=a refusal uses another code or the operation is taken; no_claim=the run's own state machine (run tests)
test('a paused run, a run sending an operation and a run with every operation sent each refuse the next operation with their own code', async (context) => {
  // Arrange
  const { service, receipt, runtime } = await startOperationsRun(
    context,
    'refusals',
  )
  const next = (key: string) =>
    service.performAction({ ...receipt, key, action: OPERATION_ACTION })
  // Act
  runtime.status = 'paused-browser'
  const paused = await errorOf(() => next('while-paused'))
  runtime.status = 'acting'
  const sending = await errorOf(() => next('while-sending'))
  for (const record of runtime.records) record.state = 'done'
  const finished = await errorOf(() => next('after-last'))
  // Assert
  assert.equal(paused.code, 'RUN_PAUSED')
  assert.equal(paused.describe().details?.sent, 'not-sent')
  assert.equal(sending.code, 'ACTION_IN_PROGRESS')
  assert.equal(finished.code, 'NO_MORE_ACTIONS')
  assert.equal(runtime.dispatches, 0)
})

// protects=DX-3/ENG-4: an ask-learner operation asks the learner in the editor, passes the answer to the run, and the answer is in no receipt, run resource or error; fails_when=the answer is missing from the run's call or shows in any serialization the agent reads; no_claim=the real input box (extension test); the environment's asker is a stand-in
test('an ask-learner operation asks the learner, hands the answer to the run and leaves it out of every answer the agent reads', async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startOperationsRun(
    context,
    'ask',
  )
  const questions: unknown[] = []
  environment.askLearnerSecret = async (question) => {
    questions.push(question)
    return 'typed-by-learner'
  }
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  runtime.finish(1)
  // Act
  const second = await service.performAction({
    ...receipt,
    key: 'op-2',
    action: OPERATION_ACTION,
  })
  // Assert
  assert.deepEqual(runtime.learnerSecrets, [undefined, 'typed-by-learner'])
  assert.equal(second.operationIndex, 2)
  assert.deepEqual(questions, [
    {
      runId: receipt.runId,
      repository: basename(environment.workspace),
      title: 'Password',
    },
  ])
  const serialized = JSON.stringify({
    second,
    state: service.state(service.record(receipt)),
  })
  assert.doesNotMatch(serialized, /typed-by-learner/)
})

// protects=DX-3: a declined, dismissed or empty answer is OPERATIONS_NOT_CONFIRMED, sends nothing, leaves the run ready and does not use the key; fails_when=the run takes the operation, the run stops being ready, or the same key cannot be used after the learner agrees; no_claim=the real input box
test('declining the secret question answers OPERATIONS_NOT_CONFIRMED, leaves the run ready and keeps the key reusable', async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startOperationsRun(
    context,
    'decline',
  )
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  runtime.finish(1)
  let answer: string | undefined
  environment.askLearnerSecret = async () => answer
  // Act
  const declined = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-2',
      action: OPERATION_ACTION,
    }),
  )
  answer = ''
  const empty = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-2',
      action: OPERATION_ACTION,
    }),
  )
  const readyAfterDecline = runtime.view().status
  answer = 'typed-by-learner'
  const accepted = await service.performAction({
    ...receipt,
    key: 'op-2',
    action: OPERATION_ACTION,
  })
  // Assert
  assert.equal(declined.code, 'OPERATIONS_NOT_CONFIRMED')
  assert.equal(empty.code, 'OPERATIONS_NOT_CONFIRMED')
  assert.equal(declined.describe().details?.sent, 'not-sent')
  assert.equal(readyAfterDecline, 'ready')
  assert.equal(accepted.operationIndex, 2)
  assert.deepEqual(runtime.learnerSecrets, [undefined, 'typed-by-learner'])
})

// protects=DX-3: an editor with no input box answers PREREQUISITE_MISSING and sends nothing; fails_when=the operation is taken without a secret; no_claim=none beyond protects
test('an editor without an input box answers PREREQUISITE_MISSING for an ask-learner operation', async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startOperationsRun(
    context,
    'no-box',
  )
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  runtime.finish(1)
  environment.askLearnerSecret = undefined
  // Act
  const error = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-2',
      action: OPERATION_ACTION,
    }),
  )
  // Assert
  assert.equal(error.code, 'PREREQUISITE_MISSING')
  assert.equal(runtime.dispatches, 1)
})

// protects=CEO-S18/DX-7: while the learner is asked, a repeat of the same key joins that question, and another key answers BUSY with reason awaiting-confirmation; fails_when=the learner is asked twice, or another key is taken; no_claim=none beyond protects
test('while the learner is asked, the same key joins the question and another key answers BUSY awaiting-confirmation', async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startOperationsRun(
    context,
    'asking',
  )
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  runtime.finish(1)
  let answerQuestion = (_secret: string): void => {}
  let asked = 0
  environment.askLearnerSecret = () => {
    asked++
    return new Promise<string>((resolve) => {
      answerQuestion = resolve
    })
  }
  const first = service.performAction({
    ...receipt,
    key: 'op-2',
    action: OPERATION_ACTION,
  })
  // Act
  const joined = service.performAction({
    ...receipt,
    key: 'op-2',
    action: OPERATION_ACTION,
  })
  const other = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-other',
      action: OPERATION_ACTION,
    }),
  )
  answerQuestion('typed-by-learner')
  const [firstReceipt, joinedReceipt] = await Promise.all([first, joined])
  // Assert
  assert.equal(asked, 1)
  assert.deepEqual(joinedReceipt, firstReceipt)
  assert.equal(other.code, 'BUSY')
  assert.equal(other.describe().details?.reason, 'awaiting-confirmation')
})

// protects=DX-2: a continuation that ends in OPERATION_AFTER_NOT_MET reaches the MCP boundary as isError true with ok false, the coded error carrying the operation's fields and the partial run state; fails_when=the result is ok true, the code is RUNTIME_FAILED, or the fields or the run state are missing; no_claim=the real run's failure (run tests); the synthetic runtime fails when the test says so
test('a version 3 run that fails after a continuation answers isError with OPERATION_AFTER_NOT_MET, its fields and the run state', async (context) => {
  // Arrange
  const { service, receipt, runtime } = await startOperationsRun(
    context,
    'dx2',
    [{ kind: 'click', title: 'Create Invoice', selector: '#submit' }],
  )
  runtime.pausesOnAction = true
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  const client = await connectMcpClient(context, service)
  const paused = service.state(service.record(receipt))
  const continueArguments = paused.participants.browser.continueArguments
  assert.ok(continueArguments)
  // Act
  const continuing = client.callTool({
    name: 'codebook_continue',
    arguments: continueArguments,
  })
  await waitUntil(() => runtime.status === 'running', 'the continued run')
  runtime.records[0]!.state = 'failed'
  runtime.failure = {
    code: 'OPERATION_AFTER_NOT_MET',
    operationIndex: 1,
    path: 'after',
    sent: 'sent',
    sideEffects: 'unknown',
    logId: `${receipt.runId}#1`,
  }
  runtime.failures.push(
    'OPERATION_AFTER_NOT_MET: Operation 1 (Create Invoice) was sent, but its result could not be confirmed: Timed out waiting for configured after conditions',
  )
  runtime.status = 'failed'
  const result = await continuing
  // Assert
  assert.equal(result.isError, true)
  const structured = result.structuredContent as {
    ok: boolean
    error: { code: string; recovery: string; details: Record<string, unknown> }
    state: { state: string; operations: { state: string }[] }
  }
  assert.equal(structured.ok, false)
  assert.equal(structured.error.code, 'OPERATION_AFTER_NOT_MET')
  assert.match(
    structured.error.recovery,
    /^Audience: chat\. Operation 1 was sent, but its result could not be confirmed\. Changes the app made are not undone\./,
  )
  assert.deepEqual(structured.error.details, {
    runUri: structured.error.details.runUri,
    operationIndex: 1,
    path: 'after',
    sent: 'sent',
    sideEffects: 'unknown',
    retry: 'Never retry automatically; ask the learner.',
    logId: `${receipt.runId}#1`,
  })
  assert.equal(structured.state.state, 'failed')
  assert.equal(structured.state.operations[0]?.state, 'failed')
})

// protects=DX-2 as a defect fix for version 1 and 2: a repository-browser run of the single action that fails after a continuation also answers isError true with the run state; fails_when=the failure is answered as ok true; no_claim=the real run's failure (run tests); the synthetic runtime fails when the test says so
test('a single-action run that fails after a continuation answers isError with the run state', async (context) => {
  // Arrange
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'single',
    configuration,
  })
  await service.record(receipt).preparation
  service.action({ ...receipt, action: 'repository-click', key: 'one' })
  const runtime = runtimes[0]!
  const client = await connectMcpClient(context, service)
  const continueArguments = service.state(service.record(receipt)).participants
    .browser.continueArguments
  assert.ok(continueArguments)
  // Act
  const continuing = client.callTool({
    name: 'codebook_continue',
    arguments: continueArguments,
  })
  await waitUntil(() => runtime.status === 'running', 'the continued run')
  runtime.failures.push(
    'Repository continuation reached no next declared pause',
  )
  runtime.status = 'failed'
  const result = await continuing
  // Assert
  assert.equal(result.isError, true)
  const structured = result.structuredContent as {
    ok: boolean
    error: { code: string }
    state: { state: string }
  }
  assert.equal(structured.ok, false)
  assert.equal(structured.error.code, 'RUNTIME_FAILED')
  assert.equal(structured.state.state, 'failed')
})

// protects=DX-2 for codebook_action: an action sent to a repository-browser run that already failed answers isError true with the error and the run state; fails_when=the result carries no run state; no_claim=none beyond protects
test('an action sent to a failed run answers isError with the error and the run state', async (context) => {
  // Arrange
  const { service, receipt, runtime } = await startOperationsRun(
    context,
    'dx2-action',
  )
  runtime.failures.push('Repository setup deadline exceeded')
  runtime.status = 'failed'
  const client = await connectMcpClient(context, service)
  // Act
  const result = await client.callTool({
    name: 'codebook_action',
    arguments: {
      instanceId: receipt.instanceId,
      runId: receipt.runId,
      key: 'late',
      action: OPERATION_ACTION,
    },
  })
  // Assert
  assert.equal(result.isError, true)
  const structured = result.structuredContent as {
    ok: boolean
    state?: { state: string }
  }
  assert.equal(structured.ok, false)
  assert.equal(structured.state?.state, 'failed')
})

// protects=DX-2 for codebook_action: a used key resent with another action to a failed run answers why that request was refused (IDEMPOTENCY_CONFLICT), with the run's own failure kept in the state beside it; fails_when=the answer's error is the run's failure (OPERATION_AFTER_NOT_MET) instead of the refusal, or the state loses the run's failure; no_claim=the real run's failure (run tests); the synthetic runtime fails when the test says so
test('a used key resent with another action to a failed run answers IDEMPOTENCY_CONFLICT with the run failure in its state', async (context) => {
  // Arrange
  const { service, receipt, runtime } = await startOperationsRun(
    context,
    'dx2-conflict',
    [{ kind: 'click', title: 'Create Invoice', selector: '#submit' }],
  )
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  runtime.records[0]!.state = 'failed'
  runtime.failure = {
    code: 'OPERATION_AFTER_NOT_MET',
    operationIndex: 1,
    path: 'after',
    sent: 'sent',
    sideEffects: 'unknown',
    logId: `${receipt.runId}#1`,
  }
  runtime.failures.push(
    'OPERATION_AFTER_NOT_MET: Operation 1 (Create Invoice) was sent, but its result could not be confirmed: Timed out waiting for configured after conditions',
  )
  runtime.status = 'failed'
  const client = await connectMcpClient(context, service)
  // Act
  const result = await client.callTool({
    name: 'codebook_action',
    arguments: {
      instanceId: receipt.instanceId,
      runId: receipt.runId,
      key: 'op-1',
      action: 'repository-click',
    },
  })
  // Assert
  assert.equal(result.isError, true)
  const structured = result.structuredContent as {
    ok: boolean
    error: { code: string; message: string }
    state?: { state: string; error?: { code: string } }
  }
  assert.equal(structured.ok, false)
  assert.equal(structured.error.code, 'IDEMPOTENCY_CONFLICT')
  assert.equal(
    structured.error.message,
    'Action key already names different arguments.',
  )
  assert.equal(structured.state?.state, 'failed')
  assert.equal(structured.state?.error?.code, 'OPERATION_AFTER_NOT_MET')
})

// protects=DX-7: a key whose run failed afterwards still answers its first receipt, so a lost response is recovered without a second operation; fails_when=the repeat is refused as not ready or takes another operation; no_claim=none beyond protects
test('a key answers its first receipt after the run failed', async (context) => {
  // Arrange
  const { service, receipt, runtime } = await startOperationsRun(
    context,
    'replay-failed',
  )
  const first = await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  runtime.records[0]!.state = 'failed'
  runtime.failures.push('INPUT_NOT_ACCEPTED: Operation 1 (First) was sent.')
  runtime.status = 'failed'
  // Act
  const repeated = await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  // Assert
  assert.deepEqual(repeated, first)
  assert.equal(runtime.dispatches, 1)
})

// protects=the run resource carries the status words the chat and the status item share, moving from sending to the next operation and to Done; fails_when=operationStatus is missing from the resource, stays on an old operation, or reads a bare count; no_claim=the status bar item (the workspace shows the same words)
test('the run resource carries the operation status words for the chat as the run moves', async (context) => {
  // Arrange
  const { service, receipt, runtime } = await startOperationsRun(
    context,
    'status',
    [
      { kind: 'click', title: 'First', selector: '#first' },
      { kind: 'click', title: 'Last', selector: '#last' },
    ],
  )
  const statusOf = (): unknown =>
    (service.state(service.record(receipt)) as { operationStatus?: string })
      .operationStatus
  // Act
  const before = statusOf()
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  const sendingFirst = statusOf()
  runtime.finish(1)
  await service.performAction({
    ...receipt,
    key: 'op-2',
    action: OPERATION_ACTION,
  })
  const sendingLast = statusOf()
  runtime.finish(2)
  const finished = statusOf()
  // Assert
  assert.equal(before, undefined)
  assert.equal(sendingFirst, 'Operation 1/2 · First · sending')
  assert.equal(sendingLast, 'Operation 2/2 · Last · sending')
  assert.equal(finished, 'Done · 2 operations')
})

// protects=a thrown error from the editor's input box answers PREREQUISITE_MISSING while a declined box stays OPERATIONS_NOT_CONFIRMED; fails_when=an input-box fault reads as a declined ask; no_claim=the real input box (extension test), the asker is a stand-in
test('an input box that throws answers PREREQUISITE_MISSING and one that resolves nothing answers OPERATIONS_NOT_CONFIRMED', async (context) => {
  // Arrange
  const { service, receipt, runtime, environment } = await startOperationsRun(
    context,
    'ask',
  )
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  runtime.finish(1)
  environment.askLearnerSecret = async () => {
    throw new Error('input box crashed')
  }
  // Act
  const faulted = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-2',
      action: OPERATION_ACTION,
    }),
  )
  environment.askLearnerSecret = async () => undefined
  const declined = await errorOf(() =>
    service.performAction({
      ...receipt,
      key: 'op-2',
      action: OPERATION_ACTION,
    }),
  )
  // Assert
  assert.equal(faulted.code, 'PREREQUISITE_MISSING')
  assert.match(faulted.message, /input box crashed/)
  assert.equal(declined.code, 'OPERATIONS_NOT_CONFIRMED')
})
