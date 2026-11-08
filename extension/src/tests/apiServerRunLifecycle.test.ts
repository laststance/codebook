import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { REPOSITORY_PAUSE_HOLD_TIMEOUT_MS } from '../constants'
import { StudyError } from '../errors'
import { OwnedApiServer } from '../ownedApiServer'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { apiServerRefusalOf } from '../utils/apiServerRefusalOf'
import {
  claimOwnedDevelopmentPort,
  releaseOwnedDevelopmentPort,
} from '../utils/ownedDevelopmentPorts'

import {
  apiServerHit,
  apiServerRunHarness,
  sendApiRequest,
} from './utils/apiServerRunHarness'
import { freeLoopbackPort } from './utils/freeLoopbackPort'
import { removeTestFolder } from './utils/removeTestFolder'
import { publishedPause, sendOperation } from './utils/routeHandlerRunHarness'

const SECRET = 'hunter2-typed-by-learner'

// Value: protects=AC 5 and E-6: an API that exits after the run was ready ends the run with SERVER_EXITED led by the api-server variant, quoting the exit code and the masked output tail; fails_when=the failure is a generic transport error or the variant is missing; no_claim=a real process exit (ownedApiServer.test.ts)
test('an API exit after the run is ready ends the run as SERVER_EXITED for the API', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  // Act
  harness.fake.exit(3, null, 'connect ECONNREFUSED 127.0.0.1:5433')
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the exit failure',
  )
  // Assert
  const failure = harness.run.view().failures[0] ?? ''
  assert.deepEqual(
    {
      led: failure.startsWith(
        'SERVER_EXITED(api-server): The API exited with code 3.',
      ),
      quotesTail: failure.includes('connect ECONNREFUSED 127.0.0.1:5433'),
    },
    { led: true, quotesTail: true },
  )
})

// Value: protects=E-6 and D24: the loss of the API's debug session that arrives before the process exit is resolved to the exit fact within the arbiter's bound; fails_when=the generic "Selected debugger terminated" text wins; no_claim=js-debug's real termination order
test('a lost API debug session resolves to the API exit when the exit follows within the bound', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  // Act
  harness.run.terminated(harness.server!.session)
  harness.fake.exit(1, null, 'fatal: out of memory')
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the exit failure',
  )
  // Assert
  assert.equal(
    (harness.run.view().failures[0] ?? '').startsWith(
      'SERVER_EXITED(api-server):',
    ),
    true,
  )
})

// Value: protects=E-6: an inspector channel that closes while the API still runs is reported as the transport loss it is; fails_when=the arbiter invents an exit or never reports the loss; no_claim=the 2 s bound's exact value
test('a closed API inspector channel with the API still running keeps its own failure', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  // Act
  harness.serverProxy!.close()
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the channel failure',
  )
  // Assert
  assert.equal(harness.run.view().failures[0], 'Selected server CDP closed')
})

// Value: protects=E-4 and AC 5 hold expiry: a held API pause that outlives the hold ends the run with the API's group killed before anything resumes or detaches; fails_when=the handler is continued, or the group is closed normally; no_claim=the real hold length (the manual clock moves it)
test('a held API pause that outlives the hold kills the API group before anything resumes', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendApiRequest(harness, { id: '7', path: '/api/rpc/x' })
  await apiServerHit(harness)
  await publishedPause(harness)
  // Act
  harness.advance(REPOSITORY_PAUSE_HOLD_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the hold expiry',
  )
  await harness.run.stop()
  // Assert
  const events = harness.fake.events
  assert.deepEqual(
    {
      killedBeforeClose:
        events.indexOf('kill-first') < events.lastIndexOf('close'),
      continues: harness.server!.continues.length,
      failure: harness.run.view().failures[0]?.includes('pause hold deadline'),
    },
    { killedBeforeClose: true, continues: 1, failure: true },
  )
})

// Value: protects=E-4 and AC 5: a Stop while the API pause is held kills the API's group first and never continues the handler; fails_when=the cleanup detaches or resumes before the kill; no_claim=a marker file a real handler would write
test('stopping a run with a held API pause kills the API group without continuing the handler', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendApiRequest(harness, { id: '7', path: '/api/rpc/x' })
  await apiServerHit(harness)
  await publishedPause(harness)
  // Act
  await harness.run.stop()
  // Assert
  assert.deepEqual(
    {
      events: harness.fake.events.slice(-2),
      continues: harness.server!.continues.length,
    },
    { events: ['kill-first', 'close'], continues: 1 },
  )
})

// Value: protects=AC 5 cleanup failure and the run's state: an API group that cannot be confirmed gone leaves the run's state and failures as they were and adds cleanup "failed" with the pid to the run resource; fails_when=the run turns failed, gets another code, or the resource hides the pid; no_claim=a real stuck process
test('an API group that cannot be confirmed gone is reported as cleanup failed without changing the run state', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    fake: { closeFails: true },
  })
  await harness.run.prepare()
  // Act
  const stopError = await harness.run.stop().then(
    () => undefined,
    (error: unknown) => error,
  )
  const view = harness.run.view()
  // Assert
  assert.deepEqual(
    {
      status: view.status,
      failures: [...view.failures],
      cleanup: view.apiServer?.cleanup,
      pid: view.apiServer?.pid,
      stopFailed: String(stopError).includes('cleanup failed'),
      released: view.resourcesReleased,
    },
    {
      status: 'cancelled',
      failures: [],
      cleanup: 'failed',
      pid: 4242,
      stopFailed: true,
      released: false,
    },
  )
  // The retried Stop of the test's own cleanup closes the group.
  harness.fake.closeFails = false
})

// Value: protects=E-8 and D26: the password the learner typed is given to the API launcher as a live set, and API output that echoes it reaches the journal masked; fails_when=the set is a copy taken before the password was typed, or the journal keeps the value; no_claim=the launcher's own stateful mask across chunks (ownedApiServer.test.ts)
test('API output that echoes the typed password reaches the journal masked', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    operations: [
      {
        kind: 'text',
        title: 'Password',
        selector: '#password',
        secret: 'ask-learner',
      },
    ],
    extra: {
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
        stopParticipants: ['server'],
        controls: { '#password': { tagName: 'input', type: 'password' } },
      },
    },
  })
  await harness.run.prepare()
  // Act
  harness.run.action('op-1', 'repository-operation', { learnerSecret: SECRET })
  await waitUntil(() => harness.inputsSeen() === 1, 'the password input')
  const liveSecrets = harness.fake.checkInputs[0]!.secrets!()
  await harness.fake.emitOutput(`sign-in for ${SECRET} accepted`)
  // Assert
  const output = harness.run
    .view()
    .events.filter((event) => event.type === 'api-server.output')
    .map((event) => JSON.stringify(event.detail))
    .join('\n')
  assert.deepEqual(
    {
      liveSetHoldsPassword: liveSecrets.has(SECRET),
      journalKeepsPassword: output.includes(SECRET),
      journalMasked: output.includes('[masked]'),
    },
    {
      liveSetHoldsPassword: true,
      journalKeepsPassword: false,
      journalMasked: true,
    },
  )
})

// Value: protects=E-6 notice: Node's "Waiting for the debugger to disconnect" notice on the API's stderr makes the run let go of its debugger session, so an API that called process.exit can actually exit; fails_when=the notice is only journaled and the API stays attached; no_claim=a real process.exit under a real debugger (lane 3 observed it; the native check watches it)
test('the debugger-disconnect notice on the API stderr detaches the run from the API', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  // Act
  // The launcher reads the notice on the raw stderr lines and calls the run once the API is confirmed to be ending.
  await harness.fake.emitDisconnectNotice()
  // Assert
  assert.equal(harness.releases.includes('debugger'), true)
})

// Value: protects=E-13: a port that an earlier Codebook node-server run still holds is refused PORT_UNAVAILABLE for the API before anything starts, in the API's words; fails_when=the API is checked free, or the refusal speaks as the node-server profile; no_claim=a foreign listener's probe (ownedApiServer.test.ts)
test('a port held by a running Codebook node-server run is refused as PORT_UNAVAILABLE for the API', async (context) => {
  // Arrange
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-api-port-')),
  )
  context.after(() => removeTestFolder(workspace))
  await mkdir(join(workspace, 'apps/api'), { recursive: true })
  await writeFile(join(workspace, 'apps/api/package.json'), '{"type":"module"}')
  await writeFile(join(workspace, 'apps/api/server.mjs'), 'export {}\n')
  const port = await freeLoopbackPort()
  const claim = claimOwnedDevelopmentPort(port)
  context.after(() => releaseOwnedDevelopmentPort(claim))
  // Act
  const error = await OwnedApiServer.check({
    workspace,
    declaration: { packageRoot: 'apps/api', entry: 'server.mjs', port },
    node: { executable: process.execPath, version: process.version },
    record: () => undefined,
  }).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  const refusal = await apiServerRefusalOf(error, {
    port,
    step: 'api-server-check',
    cause: 'held',
    journalUri: 'events',
  })
  // Assert
  assert.equal(refusal instanceof StudyError, true)
  assert.deepEqual(
    {
      code: (refusal as StudyError).code,
      participant: (refusal as StudyError).details?.participant,
      sideEffects: (refusal as StudyError).details?.sideEffects,
    },
    { code: 'PORT_UNAVAILABLE', participant: 'apiServer', sideEffects: 'none' },
  )
})
