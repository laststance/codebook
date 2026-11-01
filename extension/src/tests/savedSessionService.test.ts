import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { StudyError } from '../errors'
import type { RuntimeControl } from '../runtime'
import { startServer } from '../server'

import { configuredServiceHarness } from './utils/configuredServiceHarness'
import { ControlledOperationsRuntime } from './utils/controlledOperationsRuntime'

const OPERATION_ACTION = 'repository-operation'

/** A runtime whose preparation ends the way a refused saved-session run does: it fails with what a test chose. */
class RefusedAtStartRuntime extends ControlledOperationsRuntime {
  refusal?: StudyError
  failureText?: string
  override async prepare(): Promise<void> {
    await super.prepare()
    if (this.failureText) {
      this.failures.push(this.failureText)
      this.status = 'failed'
      throw new Error('Repository run is unavailable')
    }
    if (this.refusal) {
      this.status = 'failed'
      throw this.refusal
    }
  }
}

/** Starts a version 3 run on the service harness; the runtime is made by `prepareRuntime`, which may configure it before its preparation runs. @example const run = await startRun(context, 'k1', (runtime) => { runtime.session = 'saved' }) */
async function startRun(
  context: TestContext,
  key: string,
  prepareRuntime: (runtime: RefusedAtStartRuntime) => void = () => undefined,
) {
  const controls: (RuntimeControl | undefined)[] = []
  const harness = await configuredServiceHarness(
    context,
    undefined,
    (directory, definition, control) => {
      controls.push(control)
      const runtime = new RefusedAtStartRuntime(directory, definition)
      prepareRuntime(runtime)
      return runtime
    },
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
      operations: [{ kind: 'click', title: 'First', selector: '#first' }],
      inspections: configuration.inspections,
      signInPaths: ['/login'],
    },
  })
  const record = service.record(receipt)
  await record.preparation
  const runtime = harness.runtimes[0]
  assert.ok(runtime instanceof RefusedAtStartRuntime)
  return { ...harness, receipt, record, runtime, controls }
}

/** Connects an MCP client to the service, as the agent's chat does. */
async function connectMcpClient(
  context: TestContext,
  service: Parameters<typeof startServer>[0],
) {
  const endpoint = await startServer(service)
  context.after(() => endpoint.close())
  const client = new Client({ name: 'saved-session-test', version: '1.0' })
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

// Value: protects=cross-check 5 (the lock's run id): the id the runtime receives in its control is the service's record id, so the store's lock names the run that Stop run and remove stops; fails_when=the control carries another id or none; no_claim=the store (lane A)
test('the runtime is created with the service record id as its run id', async (context) => {
  // Arrange and act
  const { receipt, controls } = await startRun(context, 'run-id')
  // Assert
  assert.equal(controls[0]?.runId, receipt.runId)
})

// Value: protects=DX-9/CEO-V9/AC4: the run resource of a saved-session run reads session saved, appState kept and the saved-session status; a run without a profile (versions 1 and 2) has none of the three; fails_when=a field is missing, or a run without a session gains one; no_claim=codebook_status (lane A)
test('the run resource reads session, appState and savedSession for a saved-session run and none of them for a run without a profile', async (context) => {
  // Arrange
  const saved = await startRun(context, 'saved', (runtime) => {
    runtime.session = 'saved'
    runtime.appState = 'kept'
    runtime.savedSession = {
      available: true,
      state: 'saved',
      setupAt: '2026-11-02T00:00:00.000Z',
    }
  })
  const plainRun = await startRun(context, 'plain')

  // Act
  const savedState = saved.service.state(saved.record)
  const plainState = plainRun.service.state(plainRun.record)

  // Assert
  assert.equal(savedState.session, 'saved')
  assert.equal(savedState.appState, 'kept')
  assert.deepEqual(savedState.savedSession, {
    available: true,
    state: 'saved',
    setupAt: '2026-11-02T00:00:00.000Z',
  })
  assert.equal('session' in plainState, false)
  assert.equal('appState' in plainState, false)
  assert.equal('savedSession' in plainState, false)
})

const SIGN_IN_FAILURE =
  'SIGN_IN_REQUIRED(no-saved-session): The page landed on /login and shop has no saved session, so the run stopped before it sent anything.'
const SIGN_IN_DETAILS = (runUri: string, runId: string) => ({
  runUri,
  reason: 'no-saved-session',
  session: 'fresh',
  savedSession: { state: 'none' },
  command: 'codebook.setUpSavedSession',
  sent: 'not-sent',
  sideEffects: 'none',
  retry: 'Ask the learner to set up the saved session, then start one new run.',
  logId: `${runId}#start`,
})

// Value: protects=G5 and DES-3: a run that ended with SIGN_IN_REQUIRED answers isError true at the MCP boundary with the reason, the profile it used, the setup command and the fields that decide a retry; fails_when=the result is ok, the code is RUNTIME_FAILED, or details lack the reason; no_claim=the run's own detection (run tests)
test('a run that ended with SIGN_IN_REQUIRED answers isError with the reason, the profile and the setup command', async (context) => {
  // Arrange
  const { service, receipt, record, runtime } = await startRun(
    context,
    'sign-in',
    (created) => {
      created.session = 'fresh'
      created.savedSession = { available: false, state: 'none' }
    },
  )
  runtime.failures.push(SIGN_IN_FAILURE)
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
    state?: {
      state: string
      error?: { code: string; details: Record<string, unknown> }
    }
  }
  assert.equal(structured.ok, false)
  assert.equal(structured.state?.state, 'failed')
  assert.equal(structured.state?.error?.code, 'SIGN_IN_REQUIRED')
  assert.deepEqual(
    structured.state?.error?.details,
    SIGN_IN_DETAILS(service.uri(record.id), record.id),
  )
})

// Value: protects=the same fields when the refusal comes during the run's preparation (the readiness redirect): the run's error keeps the reason through the service; fails_when=the details are dropped on the preparation path; no_claim=the run's detection (run tests)
test('a sign-in refusal during preparation keeps its reason and profile in the run error', async (context) => {
  // Arrange and act
  const { service, record } = await startRun(context, 'prep', (runtime) => {
    runtime.session = 'fresh'
    runtime.savedSession = { available: false, state: 'none' }
    runtime.failureText = SIGN_IN_FAILURE
  })
  const state = service.state(record)

  // Assert
  assert.equal(state.error?.code, 'SIGN_IN_REQUIRED')
  assert.deepEqual(
    state.error?.details,
    SIGN_IN_DETAILS(service.uri(record.id), record.id),
  )
})

// Value: protects=CEO-R7/DX-5 and the details-preserving sanitizedError: a saved-session refusal of the store keeps its own fields through the service and gains the run, the retry rule and the log id; fails_when=the details are dropped, the reason or heldBy is lost, or the added fields are missing; no_claim=the store's file lock
test('a busy saved session keeps its reason and gains the run, the retry rule and the log id', async (context) => {
  // Arrange
  const { service, record } = await startRun(context, 'busy', (runtime) => {
    runtime.refusal = new StudyError(
      'BUSY',
      'Another run of this repository uses the saved session.',
      undefined,
      undefined,
      undefined,
      { reason: 'profile-in-use', heldBy: 'run', sent: 'not-sent' },
    )
  })

  // Act
  const state = service.state(record)

  // Assert
  assert.equal(state.error?.code, 'BUSY')
  assert.deepEqual(state.error?.details, {
    runUri: service.uri(record.id),
    sideEffects: 'none',
    retry: 'Wait until the other run ended, then start one new run.',
    logId: `${record.id}#start`,
    reason: 'profile-in-use',
    heldBy: 'run',
    sent: 'not-sent',
  })
})
