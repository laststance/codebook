import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'

import { StudyError } from '../errors'
import { startServer } from '../server'

import { createHarness } from './helpers'
import {
  FAKE_EXTENSION_SESSION_ID,
  FAKE_EXTENSION_THREAD_ID,
  FakeChromeExtensionRuntime,
} from './utils/fakeChromeExtensionRuntime'
import { chromeExtensionConfigurationOf } from './utils/startFakeChromeExtensionRun'

/** Connects a real MCP SDK client to a service's endpoint, so a call passes the tool's input schema as an editor chat's does. */
async function connectMcpClient(
  context: TestContext,
  service: Parameters<typeof startServer>[0],
) {
  const endpoint = await startServer(service)
  context.after(() => endpoint.close())
  const client = new Client({
    name: 'chrome-extension-protocol-test',
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
    state: z
      .looseObject({
        state: z.string(),
        chromeExtension: z.looseObject({ phase: z.string() }),
      })
      .optional(),
    data: z.looseObject({}).optional(),
  }),
})

// protects=a wrong chrome-extension declaration passes the tool boundary and is answered by the service as INVALID_CONFIGURATION naming the help, not as the SDK's input validation error; fails_when=the SDK refuses it first; no_claim=the other profiles' boundary errors
test('codebook_start answers a wrong chrome-extension declaration as INVALID_CONFIGURATION naming the help', async (context) => {
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
        profile: 'chrome-extension',
        key: 'wrong',
        configuration: {
          ...chromeExtensionConfigurationOf(harness),
          clicks: [{ selector: '#ping' }],
        },
      },
    }),
  )
  // Assert
  assert.equal(answer.isError, true)
  assert.equal(answer.structuredContent.error?.code, 'INVALID_CONFIGURATION')
  assert.match(
    answer.structuredContent.error?.message ?? '',
    /configuration\.clicks\[0\]\.title: .*See codebook:\/\/help\/chrome-extension\.$/,
  )
})

// protects=codebook_start, codebook_action and codebook_continue reach a chrome-extension run through the tool schemas: the start names the manifest, the click answers its index, a failure that cleaned the run up answers as an error with the run state beside it; fails_when=a schema rejects extension-click or participant extension, or the failure loses the state; no_claim=real Chrome
test('the tools drive a chrome-extension run through their schemas and answer a failed click with the run state', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const run = new FakeChromeExtensionRuntime()
  harness.service.environment.createChromeExtensionRun = async () => run
  const client = await connectMcpClient(context, harness.service)
  const instanceId = harness.service.instanceId
  // Act
  const started = toolResultSchema.parse(
    await client.callTool({
      name: 'codebook_start',
      arguments: {
        instanceId,
        profile: 'chrome-extension',
        key: 'start',
        configuration: chromeExtensionConfigurationOf(harness),
      },
    }),
  )
  const runId = z
    .object({ runId: z.string() })
    .parse(started.structuredContent.data).runId
  const clicked = toolResultSchema.parse(
    await client.callTool({
      name: 'codebook_action',
      arguments: {
        instanceId,
        runId,
        key: 'click-1',
        action: 'extension-click',
      },
    }),
  )
  const generation = run.pauseAt(2, 'service-worker')
  const continued = toolResultSchema.parse(
    await client.callTool({
      name: 'codebook_continue',
      arguments: {
        instanceId,
        runId,
        participant: 'extension',
        sessionId: FAKE_EXTENSION_SESSION_ID,
        threadId: FAKE_EXTENSION_THREAD_ID,
        generation,
      },
    }),
  )
  run.clickFailure = new StudyError(
    'INPUT_PARTIAL',
    'Input 1 of click 2 failed after earlier inputs were typed; the extension may have reacted.',
  )
  const failed = toolResultSchema.parse(
    await client.callTool({
      name: 'codebook_action',
      arguments: {
        instanceId,
        runId,
        key: 'click-2',
        action: 'extension-click',
      },
    }),
  )
  // Assert
  assert.equal(started.structuredContent.ok, true)
  assert.deepEqual(started.structuredContent.data?.extension, {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    surface: {
      kind: 'popup',
      path: 'popup.html',
      url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
    },
    manifest: {
      name: 'Ping demo',
      permissions: ['storage'],
      hostPermissions: ['https://example.com/*'],
    },
  })
  assert.equal(clicked.structuredContent.data?.clickIndex, 1)
  assert.equal(continued.structuredContent.data?.accepted, true)
  assert.equal(failed.isError, true)
  assert.equal(failed.structuredContent.error?.code, 'INPUT_PARTIAL')
  assert.equal(failed.structuredContent.state?.chromeExtension.phase, 'failed')
})

// protects=D5, DXR6: a click that fails with RUNTIME_FAILED (an ended debug session, a time limit) answers the error with the run state beside it like the other failed-state codes; fails_when=the answer is a plain error without the state; no_claim=which failure produced the code
test('a click that fails with RUNTIME_FAILED answers the run state beside the error', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const run = new FakeChromeExtensionRuntime()
  harness.service.environment.createChromeExtensionRun = async () => run
  const client = await connectMcpClient(context, harness.service)
  const instanceId = harness.service.instanceId
  const started = toolResultSchema.parse(
    await client.callTool({
      name: 'codebook_start',
      arguments: {
        instanceId,
        profile: 'chrome-extension',
        key: 'start',
        configuration: chromeExtensionConfigurationOf(harness),
      },
    }),
  )
  const runId = z
    .object({ runId: z.string() })
    .parse(started.structuredContent.data).runId
  run.clickFailure = new StudyError(
    'RUNTIME_FAILED',
    'The debug session ended.',
  )
  // Act
  const failed = toolResultSchema.parse(
    await client.callTool({
      name: 'codebook_action',
      arguments: {
        instanceId,
        runId,
        key: 'click-1',
        action: 'extension-click',
      },
    }),
  )
  // Assert
  assert.equal(failed.isError, true)
  assert.equal(failed.structuredContent.error?.code, 'RUNTIME_FAILED')
  assert.equal(failed.structuredContent.state?.chromeExtension.phase, 'failed')
})

// protects=the server instructions and the help resource announce the chrome-extension profile at API 1.10; fails_when=the instructions omit the profile or the help URI is not served; no_claim=the help's content, tested apart
test('the server announces chrome-extension in its instructions and serves its help', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const client = await connectMcpClient(context, harness.service)
  // Act
  const instructions = client.getInstructions() ?? ''
  const help = await client.readResource({
    uri: 'codebook://help/chrome-extension',
  })
  // Assert
  assert.equal(
    instructions.startsWith('API 1.12. Call codebook_status first.'),
    true,
  )
  assert.equal(instructions.includes('codebook://help/chrome-extension'), true)
  assert.equal(help.contents[0]?.mimeType, 'application/json')
  const text =
    help.contents[0] && 'text' in help.contents[0] ? help.contents[0].text : ''
  assert.equal(JSON.parse(text).profile, 'chrome-extension')
})
