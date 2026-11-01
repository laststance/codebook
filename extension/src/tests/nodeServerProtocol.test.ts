import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'

import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer } from '../server'

import { createHarness } from './helpers'
import { FakeNodeServerRuntime } from './utils/fakeNodeServerRuntime'
import {
  nodeServerConfigurationOf,
  startFakeNodeServerRun,
} from './utils/startFakeNodeServerRun'

/** Connects a real MCP SDK client to a service's endpoint, so a call passes the tool's input schema as an editor chat's does. */
async function connectMcpClient(
  context: TestContext,
  service: Parameters<typeof startServer>[0],
) {
  const endpoint = await startServer(service)
  context.after(() => endpoint.close())
  const client = new Client({
    name: 'node-server-protocol-test',
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
  return client
}

const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.looseObject({
    ok: z.boolean(),
    error: z.looseObject({ code: z.string(), message: z.string() }).optional(),
    state: z.looseObject({ state: z.string() }).optional(),
    data: z.looseObject({}).optional(),
  }),
})

// protects=D4: a wrong node-server declaration passes the tool boundary and is answered by the service as INVALID_CONFIGURATION listing every violation and the help, not as the SDK's input validation error; fails_when=the SDK refuses it first or only one violation is named; no_claim=the other profiles' boundary errors (their own tests)
test('codebook_start answers a wrong node-server declaration with every violation and the help link', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const client = await connectMcpClient(context, harness.service)
  // Act
  const answer = toolResultSchema.parse(
    await client.callTool({
      name: 'codebook_start',
      arguments: {
        instanceId: harness.service.instanceId,
        profile: 'node-server',
        key: 'wrong',
        configuration: {
          ...nodeServerConfigurationOf(harness),
          port: 80,
          request: { method: 'GET', path: 'x' },
        },
      },
    }),
  )
  // Assert
  assert.equal(answer.isError, true)
  assert.equal(answer.structuredContent.error?.code, 'INVALID_CONFIGURATION')
  assert.match(
    answer.structuredContent.error?.message ?? '',
    /configuration\.port: .*configuration\.request\.path: .*See codebook:\/\/help\/node-server\.$/,
  )
})

// protects=codebook_start and codebook_action reach a node-server run through the tools: the start receipt, then the http-request receipt, then REQUEST_ALREADY_SENT for another key as an error; fails_when=the action tool still rejects http-request at its schema or runs the browser path; no_claim=the real server
test('codebook_start and codebook_action drive a node-server run through the tool schemas', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const run = new FakeNodeServerRuntime()
  harness.service.environment.createNodeServerRun = async () => run
  const client = await connectMcpClient(context, harness.service)
  const instanceId = harness.service.instanceId
  // Act
  const started = toolResultSchema.parse(
    await client.callTool({
      name: 'codebook_start',
      arguments: {
        instanceId,
        profile: 'node-server',
        key: 'start',
        configuration: nodeServerConfigurationOf(harness),
      },
    }),
  )
  const runId = z
    .object({ runId: z.string() })
    .parse(started.structuredContent.data).runId
  await harness.service.record({ instanceId, runId }).preparation
  const sent = toolResultSchema.parse(
    await client.callTool({
      name: 'codebook_action',
      arguments: { instanceId, runId, key: 'send-1', action: 'http-request' },
    }),
  )
  const again = toolResultSchema.parse(
    await client.callTool({
      name: 'codebook_action',
      arguments: { instanceId, runId, key: 'send-2', action: 'http-request' },
    }),
  )
  // Assert
  assert.equal(started.structuredContent.ok, true)
  assert.equal(sent.structuredContent.ok, true)
  assert.equal(sent.structuredContent.data?.key, 'send-1')
  assert.equal(again.isError, true)
  assert.equal(again.structuredContent.error?.code, 'REQUEST_ALREADY_SENT')
  assert.deepEqual(run.calls, ['prepare', 'sendRequest:send-1'])
})

/** Starts a run paused at its first stop and returns what the continuation call needs. */
async function pausedRun(context: TestContext) {
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startFakeNodeServerRun(harness)
  await started.run.enter('paused')
  const client = await connectMcpClient(context, harness.service)
  const args = started.service.state(started.record).participants.server
    ?.continueArguments
  assert.ok(args)
  return { ...started, client, args }
}

/** Calls codebook_continue and resolves with the answer once the fake run reaches the outcome the test drives. */
async function continueThrough(
  setup: Awaited<ReturnType<typeof pausedRun>>,
  reach: (run: Awaited<ReturnType<typeof pausedRun>>['run']) => void,
) {
  const pending = setup.client.callTool({
    name: 'codebook_continue',
    arguments: setup.args,
  })
  await waitUntil(
    () => setup.run.calls.includes('continue:1'),
    'the run resumed',
  )
  reach(setup.run)
  return toolResultSchema.parse(await pending)
}

// protects=D1 error channel: a continuation whose wait ends in a request failure is isError with REQUEST_FAILED and the run state beside the error, as codebook_stop answers a failed seal; fails_when=the failed request reads as a successful continuation or loses the state; no_claim=the wording of the cause
test('codebook_continue answers a failed request as an error with the run state beside it', async (context) => {
  // Arrange
  const setup = await pausedRun(context)
  // Act
  const answer = await continueThrough(setup, (run) =>
    run.failRequest('REQUEST_FAILED', 'Connection reset.'),
  )
  // Assert
  assert.equal(answer.isError, true)
  assert.equal(answer.structuredContent.ok, false)
  assert.equal(answer.structuredContent.error?.code, 'REQUEST_FAILED')
  assert.equal(answer.structuredContent.state?.state, 'request-failed')
})

// protects=error channel: a run failure during the wait is isError with the run's error and state; fails_when=SERVER_EXITED reads as ok; no_claim=none
test('codebook_continue answers a server that exits as an error with the run state beside it', async (context) => {
  // Arrange
  const setup = await pausedRun(context)
  // Act
  const answer = await continueThrough(setup, (run) =>
    run.failRun(
      new StudyError('SERVER_EXITED', 'The server exited with code 1.'),
    ),
  )
  // Assert
  assert.equal(answer.isError, true)
  assert.equal(answer.structuredContent.error?.code, 'SERVER_EXITED')
  assert.ok(
    ['stopping', 'stopped'].includes(
      answer.structuredContent.state?.state ?? '',
    ),
  )
})

// protects=learner-paused, responded and stopped are results, not errors; fails_when=any of them is isError; no_claim=none
test('codebook_continue answers responded and learner-paused as results', async (context) => {
  // Arrange
  const responded = await pausedRun(context)
  const learner = await pausedRun(context)
  // Act
  const respondedAnswer = await continueThrough(responded, (run) =>
    run.respond(),
  )
  const learnerAnswer = await continueThrough(learner, (run) =>
    run.learnerPause('learner'),
  )
  // Assert
  assert.equal(respondedAnswer.isError, undefined)
  assert.equal(respondedAnswer.structuredContent.ok, true)
  assert.equal(
    (respondedAnswer.structuredContent.data as { next?: string }).next,
    'responded',
  )
  assert.equal(learnerAnswer.isError, undefined)
  assert.equal(
    (learnerAnswer.structuredContent.data as { next?: string }).next,
    'learner-paused',
  )
})

// protects=a refused continuation is the domain error as for every profile; fails_when=LEARNER_PAUSED or STALE_PAUSE is swallowed or generic; no_claim=none
test('codebook_continue refuses a stale generation with STALE_PAUSE as an error', async (context) => {
  // Arrange
  const setup = await pausedRun(context)
  // Act
  const answer = toolResultSchema.parse(
    await setup.client.callTool({
      name: 'codebook_continue',
      arguments: { ...setup.args, generation: 9 },
    }),
  )
  // Assert
  assert.equal(answer.isError, true)
  assert.equal(answer.structuredContent.error?.code, 'STALE_PAUSE')
})

// protects=the agent-facing text names the new profile and action: instructions, start, action and continue descriptions, the action enum and the help resource; fails_when=an agent that reads only the tool list cannot learn that node-server and http-request exist; no_claim=the full help (its own tests)
test('the MCP server names node-server and http-request in its instructions, tools and resources', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const client = await connectMcpClient(context, harness.service)
  // Act
  const tools = (await client.listTools()).tools
  const resources = (await client.listResources()).resources
  const instructions = client.getInstructions() ?? ''
  // Assert
  const description = (name: string) =>
    tools.find((tool) => tool.name === name)?.description ?? ''
  assert.match(instructions, /node-server uses codebook:\/\/help\/node-server/)
  assert.match(
    description('codebook_start'),
    /node-server runs the repository's own Node HTTP server/,
  )
  assert.match(
    description('codebook_action'),
    /For node-server the action is http-request/,
  )
  assert.match(
    instructions,
    /whose answer names what the request did next \(paused with a new generation, responded, learner-paused, unattributed or stopped are results; a failed request or run is an error with the run state beside it\)/,
  )
  const action = tools.find((tool) => tool.name === 'codebook_action')
    ?.inputSchema.properties?.action
  assert.deepEqual(action && 'enum' in action ? action.enum : undefined, [
    'repository-click',
    'repository-operation',
    'http-request',
    'extension-click',
  ])
  assert.ok(
    resources.some(
      (resource) => resource.uri === 'codebook://help/node-server',
    ),
  )
})

// protects=the tool text an editor builds its confirmation summary from (VS Code shows a tool's title and description): codebook_start promises no request only for a node-server start (a browser start loads the application's page, a test start runs the test), and codebook_action says its method comes from the run's declaration and that a GET is sent without the dialog while the server's handler decides whether it changes data, with no promise that a GET changes nothing; fails_when=either tool is described as posting data, the start promises no traffic for every profile, or the action's method is left unsaid; no_claim=what a model-written summary says
test('codebook_start and codebook_action describe themselves so an editor’s confirmation summary follows the run', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const client = await connectMcpClient(context, harness.service)

  // Act
  const { tools } = await client.listTools()
  const start = tools.find((tool) => tool.name === 'codebook_start')
  const action = tools.find((tool) => tool.name === 'codebook_action')

  // Assert
  assert.ok(start && action)
  assert.match(
    start.description ?? '',
    /A node-server start sends no request to the server and posts no data: its one declared request is sent only later, by codebook_action http-request \(a repository-browser start loads the application's page; a node-test start runs the declared test\)\./,
  )
  assert.doesNotMatch(start.description ?? '', /server and sends no request/)
  assert.equal(start.annotations?.title, 'Start the declared Codebook run')
  assert.match(
    action.description ?? '',
    /HTTP method comes from the declaration of the run, never from this tool; a GET is sent without the confirmation dialog, and the server's own handler decides whether it changes data\./,
  )
  assert.doesNotMatch(action.description ?? '', /a GET changes nothing/)
  assert.equal(
    action.annotations?.title,
    "Send the run's declared action (method as declared)",
  )
  assert.equal(action.annotations?.readOnlyHint, false)
  assert.equal(action.annotations?.destructiveHint, true)
})
