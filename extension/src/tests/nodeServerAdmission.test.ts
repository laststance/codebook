import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NODE_SERVER_PROFILE } from '../constants'
import { StudyError } from '../errors'
import type { NodeServerConfiguration } from '../nodeServerConfigSchemas'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { createHarness } from './helpers'
import {
  nodeServerConfigurationOf,
  startFakeNodeServerRun,
} from './utils/startFakeNodeServerRun'

/**
 * Starts nothing: asks the service to start a node-server run and returns what it throws, for the admission refusals that happen before any run exists.
 * @param service - The service.
 * @param configuration - The start's configuration.
 * @param key - The start key.
 * @returns The thrown error, or `undefined` when the start was accepted.
 */
function startRefusal(
  service: Awaited<ReturnType<typeof createHarness>>['service'],
  configuration: unknown,
  key = 'refused',
): unknown {
  try {
    service.start({
      instanceId: service.instanceId,
      profile: NODE_SERVER_PROFILE,
      key,
      configuration: configuration as Record<string, unknown>,
    })
  } catch (error) {
    return error
  }
  return undefined
}

// protects=a node-server start is admitted and the run reads ready with http-request as its only way forward; fails_when=the profile is refused as unsupported, the run never reaches ready, or nextActions omit http-request or stop; no_claim=the real server launch (part R)
test('a node-server start with a valid declaration prepares to ready and offers the http-request action', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  // Act
  const { service, record, run } = await startFakeNodeServerRun(harness)
  const state = service.state(record)
  // Assert
  assert.equal(record.profile, NODE_SERVER_PROFILE)
  assert.equal(run.calls[0], 'prepare')
  assert.equal(state.state, 'ready')
  assert.deepEqual(state.nextActions, ['http-request', 'stop'])
  assert.equal(state.profile, NODE_SERVER_PROFILE)
})

// protects=the unsupported-profile refusal lists every profile the service has; fails_when=node-server is missing from the list, so an agent cannot learn that it exists from the refusal; no_claim=status
test('an unknown profile is refused as UNSUPPORTED_PROFILE naming all three profiles', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  // Act
  const refusal = (() => {
    try {
      harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'node-serverless',
        key: 'unknown',
        configuration: {},
      })
    } catch (error) {
      return error
    }
    return undefined
  })()
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'UNSUPPORTED_PROFILE')
  assert.equal(
    refusal.message,
    'Available profiles: repository-browser, node-test, node-server',
  )
})

// protects=INVALID_CONFIGURATION lists every violation of a node-server declaration and names the help (D4); fails_when=only the first violation is named, a field path is missing, or the help link is gone; no_claim=the MCP boundary (protocol tests)
test('a refused node-server declaration lists every violation and names codebook://help/node-server', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const declaration = {
    ...nodeServerConfigurationOf(harness),
    port: 80,
    request: { method: 'GET', path: 'api/healthz' },
  }
  // Act
  const refusal = startRefusal(harness.service, declaration)
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
  assert.match(
    refusal.message,
    /configuration\.port: expected an integer from 1024 to 65535/,
  )
  assert.match(
    refusal.message,
    /configuration\.request\.path: expected a path on the server starting with "\/"/,
  )
  assert.match(refusal.message, /See codebook:\/\/help\/node-server\.$/)
  assert.equal(harness.service.records.size, 0)
})

// protects=a node-server start without a configuration is refused as INVALID_CONFIGURATION, not as a crash; fails_when=undefined reaches the run; no_claim=none
test('a node-server start without a configuration is refused as INVALID_CONFIGURATION', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  // Act
  const refusal = startRefusal(harness.service, undefined)
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'INVALID_CONFIGURATION')
  assert.match(refusal.message, /^configuration: /)
})

// protects=BUSY while a run lives, the same key and arguments replaying the receipt, and IDEMPOTENCY_CONFLICT for the same key with other arguments, as for the other profiles; fails_when=a second run starts beside the first, a replay creates another run, or a changed declaration is accepted under an old key; no_claim=the run slot's limit
test('a second node-server start is BUSY, a repeated start replays its receipt and a changed one conflicts', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, receipt } = await startFakeNodeServerRun(harness)
  const declaration = nodeServerConfigurationOf(harness)
  // Act
  const replay = service.start({
    instanceId: service.instanceId,
    profile: NODE_SERVER_PROFILE,
    key: 'server-run',
    configuration: declaration,
  })
  const busy = startRefusal(service, declaration, 'another-key')
  const conflict = startRefusal(
    service,
    { ...declaration, port: 4200 },
    'server-run',
  )
  // Assert
  assert.deepEqual(replay, receipt)
  assert.ok(busy instanceof StudyError)
  assert.equal(busy.code, 'BUSY')
  assert.ok(conflict instanceof StudyError)
  assert.equal(conflict.code, 'IDEMPOTENCY_CONFLICT')
  assert.equal(service.records.size, 1)
})

// protects=workspace trust is the first step of the preparation (D5): an untrusted workspace ends the run with PREREQUISITE_MISSING before the cited sources are read or a run is created; fails_when=the environment is asked for a run after trust failed; no_claim=the real trust check (environment tests)
test('an untrusted workspace ends the node-server preparation with PREREQUISITE_MISSING before any run is created', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  harness.service.environment.assertWorkspace = () => {
    throw new StudyError('PREREQUISITE_MISSING', 'Trust this workspace first.')
  }
  // Act
  const { service, record, created } = await startFakeNodeServerRun(harness)
  // Assert
  assert.equal(record.error?.code, 'PREREQUISITE_MISSING')
  assert.equal(record.error?.message, 'Trust this workspace first.')
  assert.equal(created.length, 0)
  await record.stopPromise
  assert.equal(service.state(record).state, 'stopped')
})

// protects=the cited sources are pinned from the published book node before anything is created (D12): the environment receives the article's cited file at its retained hash, the parsed declaration with its defaults and the run id; fails_when=the run is created with a different declaration, without the cited sources, or with another id; no_claim=the file check at launch
test('the node-server run is created with the parsed declaration, the pinned cited sources and the run id', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  // Act
  const { record, created } = await startFakeNodeServerRun(harness)
  // Assert
  assert.equal(created.length, 1)
  const [configuration, , citedSources, runId] = created[0] as [
    NodeServerConfiguration,
    unknown,
    { path: string; hash: string }[],
    string,
  ]
  assert.equal(configuration.packageRoot, '.')
  assert.equal(configuration.loader, 'tsx')
  assert.equal(configuration.port, 4100)
  assert.deepEqual(
    citedSources.map((source) => source.path),
    ['src/theme.ts', 'src/mode.ts'],
  )
  assert.equal(citedSources[0]?.hash, configuration.source.hash)
  assert.equal(runId, record.id)
})

// protects=a changed cited file is refused while nothing runs; fails_when=a declaration whose source hash is not the article's reaches the environment; no_claim=the wording of the mismatch
test('a node-server stop whose hash is not the published citation ends the preparation before any run is created', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const declaration = nodeServerConfigurationOf(harness)
  harness.service.environment.createNodeServerRun = async () => {
    throw new Error('must not be created')
  }
  // Act
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: NODE_SERVER_PROFILE,
    key: 'changed-hash',
    configuration: {
      ...declaration,
      source: { ...declaration.source, hash: 'b'.repeat(64) },
    },
  })
  const record = harness.service.record(receipt)
  await record.preparation
  // Assert
  assert.equal(record.error?.code, 'INVALID_CONFIGURATION')
  assert.equal(record.nodeServer?.run, undefined)
})

// protects=a node-server start on a book node the revision lacks is refused in the answer of the start itself; fails_when=the run is accepted and ends later without saying why; no_claim=the wording
test('a node-server start on a node the book revision lacks is refused as BOOK_UNAVAILABLE', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const declaration = nodeServerConfigurationOf(harness)
  // Act
  const refusal = await harness.service
    .startOnStoredBook({
      instanceId: harness.service.instanceId,
      profile: NODE_SERVER_PROFILE,
      key: 'missing-node',
      configuration: {
        ...declaration,
        book: { ...declaration.book, nodeId: 'missing' },
      },
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'BOOK_UNAVAILABLE')
})

// protects=the profile's prerequisites gate the start: a missing prerequisite ends the run with PREREQUISITE_MISSING naming each missing item, and an environment without the hook reads the profile as not ready; fails_when=a run is created without its prerequisites; no_claim=how the environment finds them
test('missing node-server prerequisites and a missing run factory end the preparation with PREREQUISITE_MISSING', async (context) => {
  // Arrange
  const unready = await createHarness({
    prerequisites: async () => ({
      ready: true,
      missing: [],
      profiles: {
        'node-server': {
          ready: false,
          missing: ['node-server needs lsof or ss.', 'node-server needs ps.'],
        },
      },
    }),
  })
  context.after(() => unready.close())
  const withoutFactory = await createHarness()
  context.after(() => withoutFactory.close())
  // Act
  const missing = await startFakeNodeServerRun(unready)
  const receipt = withoutFactory.service.start({
    instanceId: withoutFactory.service.instanceId,
    profile: NODE_SERVER_PROFILE,
    key: 'no-factory',
    configuration: nodeServerConfigurationOf(withoutFactory),
  })
  const withoutFactoryRecord = withoutFactory.service.record(receipt)
  await withoutFactoryRecord.preparation
  // Assert
  assert.equal(missing.record.error?.code, 'PREREQUISITE_MISSING')
  assert.equal(
    missing.record.error?.message,
    'node-server needs lsof or ss.; node-server needs ps.',
  )
  assert.equal(missing.created.length, 0)
  assert.equal(withoutFactoryRecord.error?.code, 'PREREQUISITE_MISSING')
})

// protects=a run's own typed rejection is the run's error and releases the slot (a failed start leaves nothing owned); fails_when=the rejection is replaced by a generic error, the run stays unstopped, or the next start is still BUSY; no_claim=the real refusals (part R)
test('a node-server run that rejects its preparation ends with that error, is stopped and frees the slot', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness, {
    holdPrepare: true,
  })
  run.prepareFailure = new StudyError(
    'PORT_UNAVAILABLE',
    'Port 4100 is held by another process.',
  )
  // Act
  run.prepareGate.resolve()
  await record.preparation
  await record.stopPromise
  // Assert
  const state = service.state(record)
  assert.equal(record.error?.code, 'PORT_UNAVAILABLE')
  assert.equal(state.error?.code, 'PORT_UNAVAILABLE')
  assert.equal(state.state, 'stopped')
  assert.deepEqual(run.calls, ['prepare', 'stop'])
  assert.doesNotThrow(() =>
    service.start({
      instanceId: service.instanceId,
      profile: NODE_SERVER_PROFILE,
      key: 'after-failed-start',
      configuration: nodeServerConfigurationOf(harness),
    }),
  )
})

// protects=a stop during the preparation cancels the run (the run's stop settles its prepare) and the run reads stopped without an error of its own; fails_when=the stop waits for a prepare that never ends, or the run keeps its process; no_claim=the real cancellation of a launch
test('a stop during the node-server preparation stops the run and ends as stopped with no error', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness, {
    holdPrepare: true,
  })
  await waitUntil(() => run.calls.includes('prepare'), 'the run was created')
  // Act
  const stopping = service.stop({
    instanceId: service.instanceId,
    runId: record.id,
  })
  run.prepareGate.resolve()
  const state = await stopping
  // Assert
  assert.equal(state.state, 'stopped')
  assert.equal(state.error, undefined)
  assert.equal(run.calls.filter((call) => call === 'stop').length, 1)
})

// protects=D3: a server run holds no history from its start: no read-history, a history outcome that is unavailable with the reason, a study outcome that never claims a saved study, and no checkpoint; fails_when=read-history is offered, the run reads saved, or a checkpoint begins; no_claim=server runs becoming saveable later
test('a node-server run is excluded from history: no read-history and no saved study is ever claimed', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('paused')
  // Act
  const live = service.state(record)
  const checkpoint = service.beginHistory(record, live.materialSignature)
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const stopped = service.state(record)
  // Assert
  assert.equal(record.historyExcluded, 'server-run-not-saved')
  assert.equal(checkpoint, undefined)
  assert.equal(live.nextActions.includes('read-history'), false)
  assert.equal(stopped.historyOutcome.status, 'unavailable')
  assert.equal(
    stopped.historyOutcome.reason,
    'Server runs are not saved yet: this run keeps no history, and no replay or saved study exists for it.',
  )
  assert.notEqual(stopped.studyOutcome, 'demonstrated')
  assert.notEqual(stopped.recordedStudyOutcome, 'demonstrated')
})

// protects=D3: a server run is evictable, so a seventeenth run does not meet LIMIT_EXCEEDED; fails_when=sixteen stopped server runs fill the retained-run limit; no_claim=the limit for the other profiles
test('stopped node-server runs are evicted for the next start instead of filling the retained-run limit', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  // Act
  for (let index = 0; index < 17; index++) {
    const { service, record } = await startFakeNodeServerRun(harness, {
      key: `run-${index}`,
    })
    await service.stop({ instanceId: service.instanceId, runId: record.id })
  }
  // Assert
  assert.equal(harness.service.records.size, 16)
})

// protects=D13: a server stop is explained in the chat, so codebook_explain and codebook_reveal refuse it as they refuse a test stop; fails_when=the refusal is another code or the service reads a snapshot of a run that has none; no_claim=the native debugger showing the stop
test('codebook_explain and codebook_reveal refuse a node-server stop as EVIDENCE_UNAVAILABLE', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { service, record, run } = await startFakeNodeServerRun(harness)
  await run.enter('paused')
  const identity = { instanceId: service.instanceId, runId: record.id }
  const snapshotUri = service.uri(record.id, 'snapshots/server-1')
  // Act
  const explained = await Promise.resolve()
    .then(() =>
      service.explain({
        ...identity,
        key: 'explain',
        snapshotUri,
        sourceHash: 'a'.repeat(64),
        valuePaths: ['nextTheme'],
        interpretation: 'x',
      }),
    )
    .catch((error: unknown) => error)
  const revealed = await service
    .reveal({ ...identity, snapshotUri })
    .catch((error: unknown) => error)
  // Assert
  assert.ok(explained instanceof StudyError)
  assert.equal(explained.code, 'EVIDENCE_UNAVAILABLE')
  assert.ok(revealed instanceof StudyError)
  assert.equal(revealed.code, 'EVIDENCE_UNAVAILABLE')
})
