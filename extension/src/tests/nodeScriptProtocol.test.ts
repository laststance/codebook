import assert from 'node:assert/strict'
import { before, test, type TestContext } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'

import { NODE_SCRIPT_PROFILE } from '../constants'
import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer } from '../server'

import { createHarness } from './helpers'
import { FakeNodeScriptRuntime } from './utils/fakeNodeScriptRuntime'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.looseObject({
    ok: z.boolean(),
    error: z.looseObject({ code: z.string(), message: z.string() }).optional(),
    state: z.looseObject({ state: z.string() }).optional(),
    data: z.looseObject({}).optional(),
  }),
})

/** Starts a node-script run paused at its first stop and connects an MCP client, returning what a `codebook_continue` call needs. */
async function pausedScriptRun(context: TestContext) {
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service } = harness
  const run = new FakeNodeScriptRuntime()
  service.environment.createNodeScriptRun = async () => run
  const base = harness.configuration
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: NODE_SCRIPT_PROFILE,
    key: 'first',
    configuration: {
      version: 1,
      adapter: 'node-script',
      book: base.book,
      entry: 'src/run.mjs',
      source: base.source,
      inspections: base.inspections.slice(0, 1),
      additionalStops: [
        {
          ...base.source,
          anchorIndex: 0,
          inspections: base.inspections.slice(0, 1),
        },
      ],
    },
  })
  const record = service.record(receipt)
  await record.preparation
  run.pauseAt(0, { total: 3 })
  const endpoint = await startServer(service)
  context.after(() => endpoint.close())
  const client = new Client({
    name: 'node-script-protocol-test',
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
  const args = service.state(record).participants.server?.continueArguments
  assert.ok(args)
  return { run, client, args }
}

/** Calls codebook_continue and resolves with the answer once the fake run resumed and the test drove it to an outcome. */
async function continueThrough(
  setup: Awaited<ReturnType<typeof pausedScriptRun>>,
  reach: (run: FakeNodeScriptRuntime) => void,
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

// protects=a node-script run that fails during the continuation wait (a capture failure) is isError with the run's error and state, as a node-server failure is; fails_when=the failure reads as a successful continuation with ok true; no_claim=the wording of the cause
test('codebook_continue answers a failed node-script run as an error with the run state beside it', async (context) => {
  // Arrange
  const setup = await pausedScriptRun(context)
  // Act
  const answer = await continueThrough(setup, (run) =>
    run.change({
      runFailure: new StudyError('RUNTIME_FAILED', 'The capture failed.'),
    }),
  )
  // Assert
  assert.equal(answer.isError, true)
  assert.equal(answer.structuredContent.ok, false)
  assert.equal(answer.structuredContent.error?.code, 'RUNTIME_FAILED')
  assert.ok(answer.structuredContent.state)
})

// protects=a script's own exit, even nonzero, is an observed end and stays a result; fails_when=the nonzero exit is isError; no_claim=the end fields (their own tests)
test('codebook_continue answers a node-script exit with a nonzero code as a result', async (context) => {
  // Arrange
  const setup = await pausedScriptRun(context)
  // Act
  const answer = await continueThrough(setup, (run) => run.end({ exitCode: 3 }))
  // Assert
  assert.equal(answer.isError, undefined)
  assert.equal(answer.structuredContent.ok, true)
  assert.equal(
    (answer.structuredContent.data as { next?: string }).next,
    'ended',
  )
})
