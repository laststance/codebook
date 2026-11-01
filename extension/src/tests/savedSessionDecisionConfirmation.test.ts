import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import type { SavedSessionOperationsQuestion } from '../operationsConfirmationTypes'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer } from '../server'

import { readEvidenceText } from './utils/readEvidenceText'
import { realRunInService } from './utils/realRunInService'

const OPERATION_ACTION = 'repository-operation'

/** Counts the questions the editor's dialog hook was asked, answering as `answer` says. */
function recordQuestions(
  environment: { confirmSavedSessionOperations?: unknown },
  answer: boolean,
) {
  const questions: SavedSessionOperationsQuestion[] = []
  environment.confirmSavedSessionOperations = async (
    question: SavedSessionOperationsQuestion,
  ) => {
    questions.push(question)
    return answer
  }
  return questions
}

/** Connects an MCP client to the service, as the agent's chat does. */
async function connectChat(
  context: TestContext,
  service: Parameters<typeof startServer>[0],
) {
  const endpoint = await startServer(service)
  context.after(() => endpoint.close())
  const client = new Client({ name: 'saved-session-decision', version: '1.0' })
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

// protects=AC6a on the run's own decision: a version 3 run that the store admitted with the saved session (no stand-in view) shows the confirmation before operation 1 and sends it after Run; fails_when=the service ignores session saved read from the real run, so no dialog shows and operation 1 is sent unasked; no_claim=the real editor modal and the real store (both are fakes of their ports)
test('a run admitted with a saved session shows the confirmation before operation 1 and sends it after the learner chose Run', async (context) => {
  // Arrange
  const { service, receipt, harness } = await realRunInService(context, {
    savedSession: { admission: 'saved' },
  })
  const questions = recordQuestions(service.environment, true)
  assert.equal(harness.run.view().session, 'saved')
  // Act
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  await waitUntil(
    () => harness.run.view().operations?.[0]?.state === 'done',
    'operation 1 done',
  )
  // Assert
  assert.equal(questions.length, 1)
  assert.notEqual(harness.inputRequests.length, 0)
})

// protects=AC6a/CEO-S18 on the run's own decision: a decline sends no Input.* request to the page and reaches the chat as isError true with OPERATIONS_NOT_CONFIRMED; fails_when=the decline lets an input request through, or the MCP result is ok; no_claim=the native dialog
test('a declined confirmation of a run admitted with a saved session sends no input event and answers OPERATIONS_NOT_CONFIRMED to the chat', async (context) => {
  // Arrange
  const { service, receipt, harness } = await realRunInService(context, {
    savedSession: { admission: 'saved' },
  })
  const questions = recordQuestions(service.environment, false)
  service.environment.noticeOperationsConfirmation = async () => undefined
  const client = await connectChat(context, service)
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
  assert.equal(questions.length, 1)
  assert.deepEqual(harness.inputRequests, [])
  assert.equal(harness.run.view().operations?.[0]?.state, 'not-run')
})

// protects=G4/CEO-S25 at a stop: a debugger value named sessionToken and a page cookie value, seen at the stop of a saved-session run, are absent from the run resource, the service journal, the recording, the saved-study folder, the evidence folder and the Output lines; fails_when=either value reaches a sink, or the stop never captured (the sessionToken name in the sinks is the proof the stop was seen); no_claim=the profile's cookie jar (the run never reads it) and a real debugger
test('a session token and a cookie value seen at a stop of a saved-session run reach no sink', async (context) => {
  // Arrange
  const tokenValue = 'tok_Qv7ZnL4xW9sRc2Kd'
  const cookieValue = 'ck_Hb3YpT8mJf6Ua1Ge'
  const outputLines: string[] = []
  const { service, receipt, harness } = await realRunInService(context, {
    savedSession: { admission: 'saved' },
    outputLines,
    extraVariables: { sessionToken: tokenValue, appCookie: cookieValue },
  })
  recordQuestions(service.environment, true)
  // Act
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  await waitUntil(
    () => harness.run.view().operations?.[0]?.state === 'done',
    'operation 1 done',
  )
  await service.performAction({
    ...receipt,
    key: 'op-2',
    action: OPERATION_ACTION,
  })
  await waitUntil(
    () => harness.run.view().snapshots.length > 0,
    'a committed stop',
  )
  const resource = JSON.stringify(service.state(service.record(receipt)))
  await service.stop(receipt)
  // Assert
  const sinks = [
    resource,
    JSON.stringify(harness.run.view()),
    await readEvidenceText(harness.directory),
    outputLines.join('\n'),
  ].join('\n')
  for (const value of [tokenValue, cookieValue])
    assert.equal(sinks.includes(value), false)
  // The stop was captured, so the absence is not an empty sink.
  assert.match(sinks, /sessionToken/)
})

// protects=DX-10 on the run's own decision: a run admitted fresh (no saved session yet, or the configuration declares session fresh) shows no confirmation and sends operation 1; fails_when=a fresh run is asked; no_claim=the learner's setting off (environment test)
for (const [name, options] of [
  [
    'a run admitted with a fresh profile because no session was saved',
    { savedSession: { admission: 'no-saved-session' as const } },
  ],
  [
    'a run that declares session fresh',
    {
      savedSession: { admission: 'no-saved-session' as const },
      session: 'fresh' as const,
    },
  ],
] as const) {
  test(`${name} shows no confirmation and sends operation 1`, async (context) => {
    // Arrange
    const { service, receipt, harness } = await realRunInService(
      context,
      options,
    )
    const questions = recordQuestions(service.environment, false)
    assert.equal(harness.run.view().session, 'fresh')
    // Act
    await service.performAction({
      ...receipt,
      key: 'op-1',
      action: OPERATION_ACTION,
    })
    await waitUntil(
      () => harness.run.view().operations?.[0]?.state === 'done',
      'operation 1 done',
    )
    // Assert
    assert.deepEqual(questions, [])
    assert.notEqual(harness.inputRequests.length, 0)
  })
}
