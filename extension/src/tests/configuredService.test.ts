import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'

import * as constants from '../constants'
import { ACTIVE_TIMEOUT_MS } from '../constants'
import { StudyError } from '../errors'
import type { LearningSummary } from '../learningSummarySchemas'
import type * as ResourcesModule from '../resources'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { actionSchema } from '../schemas'
import { startServer } from '../server'

import {
  commitNextStop,
  configuredServiceHarness,
  observeResult,
} from './utils/configuredServiceHarness'
import { loadModule } from './utils/loadModule'

const receiptSchema = z.object({
  instanceId: z.string(),
  runId: z.string(),
  runUri: z.string(),
})

test('dispatch and acknowledgement each invalidate a saved configured checkpoint without changing the acting runtime state', async (context) => {
  // Arrange
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'progress',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, action: 'repository-click', key: 'one' })
  const runtime = runtimes[0]!
  runtime.status = 'acting'
  runtime.operation!.inputDispatched = false
  runtime.operation!.inputAcknowledged = false
  const accepted = service.state(record),
    revision = service.beginHistory(record, accepted.materialSignature)!
  service.reportHistory(record, accepted.materialSignature, revision, 'saved')
  // Act
  runtime.operation!.inputDispatched = true
  const dispatched = service.state(record)
  const dispatchedRevision = service.beginHistory(
    record,
    dispatched.materialSignature,
  )!
  service.reportHistory(
    record,
    dispatched.materialSignature,
    dispatchedRevision,
    'saved',
  )
  runtime.operation!.inputAcknowledged = true
  const acknowledged = service.state(record)
  // Assert
  assert.equal(dispatched.state, 'acting')
  assert.equal(acknowledged.state, 'acting')
  assert.notEqual(accepted.materialSignature, dispatched.materialSignature)
  assert.notEqual(dispatched.materialSignature, acknowledged.materialSignature)
  assert.equal(dispatched.historyOutcome.status, 'pending')
  assert.equal(acknowledged.historyOutcome.status, 'pending')
  assert.equal(acknowledged.operation?.operationId, runtime.operation!.id)
  assert.equal(acknowledged.operationProgress?.inputDispatched, true)
  assert.equal(acknowledged.operationProgress?.inputAcknowledged, true)
})

test('missing repository runtime support prevents acquisition while source authoring remains available', async (context) => {
  // Arrange
  const { service, configuration, environment, runtimes, books } =
    await configuredServiceHarness(context)
  environment.prerequisites = async () => ({
    ready: true,
    missing: [],
    profiles: {
      'repository-browser': {
        ready: false,
        missing: ['Install the supported Next development runtime.'],
      },
    },
  })
  // Act
  const status = await service.status(),
    receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'unsupported-workspace',
      configuration,
    })
  const record = service.record(receipt)
  await record.preparation
  await service.stop(receipt)
  const source = await service.source({
    instanceId: service.instanceId,
    path: configuration.source.path,
  })
  const article = await books.readDefinition(
    configuration.book.bookId,
    configuration.book.revision,
  )
  const published = await service.publishBook({
    instanceId: service.instanceId,
    bookId: 'source-only',
    expectedRevision: 0,
    key: 'still-available',
    document: article.revision.document,
  })
  // Assert
  assert.equal(status.prerequisites.ready, true)
  assert.equal(
    status.profiles.find((profile) => profile.id === 'repository-browser')
      ?.prerequisites.ready,
    false,
  )
  assert.equal(status.repository.ready, true)
  assert.equal(record.error?.code, 'PREREQUISITE_MISSING')
  assert.equal(
    record.error?.message,
    'Install the supported Next development runtime.',
  )
  assert.equal(runtimes.length, 0)
  assert.equal(source.hash, configuration.source.hash)
  assert.equal(published.bookId, 'source-only')
  assert.equal(published.revision, 1)
})

test('duplicate configured starts reserve one immutable intent before article I/O and reject any changed configuration', async (context) => {
  // Arrange
  const { service, books, configuration, runtimes } =
      await configuredServiceHarness(context),
    read = books.readDefinition.bind(books)
  let release = (): void => {},
    entered = (): void => {},
    reads = 0
  const barrier = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  books.readDefinition = async (...arguments_) => {
    reads++
    entered()
    await barrier
    return read(...arguments_)
  }
  const input = {
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'same',
      configuration,
    },
    original = structuredClone(input)
  // Act
  const first = service.start(input)
  await started
  const repeated = service.start({
    ...original,
    configuration: {
      action: original.configuration.action,
      source: original.configuration.source,
      version: 1,
      adapter: 'next-dev-webpack',
      inspections: original.configuration.inspections,
      book: original.configuration.book,
    },
  })
  configuration.action.title = 'Caller changed this after acceptance'
  // Assert
  assert.deepEqual(repeated, first)
  assert.equal(reads, 1)
  assert.equal(runtimes.length, 0)
  assert.throws(() => service.start(input), { code: 'IDEMPOTENCY_CONFLICT' })
  assert.throws(() => service.start({ ...original, key: 'another' }), {
    code: 'BUSY',
  })
  for (const changed of [
    {
      ...original.configuration,
      book: { ...original.configuration.book, anchorIndex: 1 },
    },
    {
      ...original.configuration,
      source: { ...original.configuration.source, column: 2 },
    },
    {
      ...original.configuration,
      inspections: [...original.configuration.inspections].reverse(),
    },
    {
      ...original.configuration,
      initialStorage: [{ key: 'theme', value: 'dark' }],
    },
  ])
    assert.throws(
      () => service.start({ ...original, configuration: changed }),
      { code: 'IDEMPOTENCY_CONFLICT' },
    )
  release()
  await service.record(first).preparation
  assert.equal(runtimes.length, 1)
  assert.equal(
    runtimes[0]?.definition.configuration.action.title,
    'Change theme',
  )
  assert.equal(
    service.state(service.record(first)).deadlineAt,
    new Date(service.record(first).createdAt + 600000).toISOString(),
  )
})

test('a failed configured start keeps its original receipt after source drift without silently trying the application again', async (context) => {
  // Arrange
  const { service, books, configuration, directory, runtimes } =
    await configuredServiceHarness(context)
  await writeFile(join(directory, 'src/mode.ts'), 'changed secondary citation')
  const input = {
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'failed',
    configuration,
  }
  // Act
  const receipt = service.start(input),
    record = service.record(receipt)
  await record.preparation
  await service.stop(receipt)
  books.readDefinition = async () => {
    throw new Error('Identical retry must not read mutable files.')
  }
  const repeated = service.start(structuredClone(input))
  // Assert
  assert.deepEqual(repeated, receipt)
  assert.equal(record.error?.code, 'SOURCE_CHANGED')
  assert.equal(runtimes.length, 0)
  assert.equal(service.state(record).state, 'stopped')
  assert.equal(service.state(record).finalOutcome, 'not-demonstrated')
})

test('stopping a configured start during article I/O drains its read and starts neither prerequisites nor a runtime', async (context) => {
  // Arrange
  const { service, books, configuration, environment, runtimes } =
      await configuredServiceHarness(context),
    read = books.readDefinition.bind(books)
  let release = (): void => {},
    entered = (): void => {},
    prerequisites = 0
  const barrier = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  books.readDefinition = async (...arguments_) => {
    const article = await read(...arguments_)
    entered()
    await barrier
    return article
  }
  environment.prerequisites = async () => {
    prerequisites++
    return { ready: true, missing: [] }
  }
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'cancel',
    configuration,
  })
  await started
  // Act
  let settled = false
  const stopping = service.stop(receipt).then((result) => {
    settled = true
    return result
  })
  await Promise.resolve()
  assert.equal(settled, false)
  release()
  const state = await stopping
  // Assert
  assert.equal(state.cleaned, true)
  assert.equal(prerequisites, 0)
  assert.equal(runtimes.length, 0)
  assert.equal(service.record(receipt).cancellation.signal.aborted, true)
})

test('a configured runtime returned after cancellation is still owned and released exactly once', async (context) => {
  // Arrange
  const { service, configuration, environment, runtimes } =
      await configuredServiceHarness(context),
    create = environment.createRuntime
  let release = (): void => {},
    entered = (): void => {}
  const barrier = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  environment.createRuntime = async (...arguments_) => {
    const runtime = await create(...arguments_)
    entered()
    await barrier
    return runtime
  }
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'late-acquisition',
    configuration,
  })
  await started
  // Act
  const stopped = service.stop(receipt)
  release()
  await stopped
  // Assert
  assert.equal(runtimes.length, 1)
  assert.equal(runtimes[0]?.releases, 1)
  assert.equal(runtimes[0]?.dispatches, 0)
  assert.equal(service.record(receipt).prepared, false)
})

test('stopping a held runtime preparation delivers cancellation before waiting for its completion', async (context) => {
  // Arrange
  const { service, configuration, environment, runtimes } =
      await configuredServiceHarness(context),
    create = environment.createRuntime
  let entered = (): void => {}
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  environment.createRuntime = async (...arguments_) => {
    const runtime = await create(...arguments_),
      stop = runtime.stop.bind(runtime),
      prepare = runtime.prepare.bind(runtime)
    let release = (): void => {}
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    runtime.prepare = async () => {
      await prepare()
      entered()
      await barrier
      throw new Error('Preparation cancelled')
    }
    runtime.stop = async (): Promise<void> => {
      release()
      await stop()
    }
    return runtime
  }
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'held-setup',
    configuration,
  })
  await started
  // Act
  const preparing = service.state(service.record(receipt))
  await service.stop(receipt)
  // Assert
  assert.equal(preparing.state, 'preparing')
  assert.equal(
    new Date(preparing.preparationDeadlineAt!).getTime() -
      new Date(preparing.createdAt).getTime(),
    90_000,
  )
  assert.equal(runtimes[0]?.releases, 1)
  assert.equal(runtimes[0]?.dispatches, 0)
  assert.equal(service.state(service.record(receipt)).cleaned, true)
})

test('repository preparation reports its remaining time without changing evidence identity', async (context) => {
  // Arrange
  let currentTimeMs = Date.now()
  const { service, configuration, environment } =
    await configuredServiceHarness(context, () => currentTimeMs)
  const createRuntime = environment.createRuntime
  let enteredPreparation = (): void => {}
  const preparationStarted = new Promise<void>((resolve) => {
    enteredPreparation = resolve
  })
  environment.createRuntime = async (...arguments_) => {
    const runtime = await createRuntime(...arguments_),
      prepare = runtime.prepare.bind(runtime),
      stop = runtime.stop.bind(runtime)
    let releasePreparation = (): void => {}
    const barrier = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    runtime.prepare = async (): Promise<void> => {
      await prepare()
      enteredPreparation()
      await barrier
    }
    runtime.stop = async (): Promise<void> => {
      releasePreparation()
      await stop()
    }
    return runtime
  }
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'remaining-preparation-time',
    configuration,
  })
  await preparationStarted
  const record = service.record(receipt),
    initialState = service.state(record)

  // Act
  currentTimeMs += 11_000
  const laterState = service.state(record)
  await service.stop(receipt)

  // Assert
  assert.equal(initialState.state, 'preparing')
  assert.equal(laterState.state, 'preparing')
  assert.equal(initialState.preparationRemainingMs, 90_000)
  assert.equal(laterState.preparationRemainingMs, 79_000)
  assert.equal(
    Date.parse(laterState.observedAt!) + laterState.preparationRemainingMs,
    Date.parse(laterState.preparationDeadlineAt!),
  )
  assert.equal(initialState.materialSignature, laterState.materialSignature)
  assert.equal(service.state(record).preparationRemainingMs, undefined)
})

test('repository entry rejects missing configuration and unknown profiles without input', async (context) => {
  // Arrange
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const input = {
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'valid',
    configuration,
  }
  // Act / Assert
  assert.throws(() => service.start({ ...input, configuration: undefined }), {
    code: 'INVALID_CONFIGURATION',
  })
  assert.throws(() => service.start({ ...input, profile: 'unknown' }), {
    code: 'UNSUPPORTED_PROFILE',
  })
  assert.equal(service.records.size, 0)
  const receipt = service.start(input),
    record = service.record(receipt)
  await record.preparation
  assert.equal(
    actionSchema.safeParse({
      ...receipt,
      key: 'wrong',
      action: 'unavailable-action',
    }).success,
    false,
  )
  await assert.rejects(
    service.continue({
      ...receipt,
      participant: 'server',
      sessionId: 'browser-session',
      threadId: 1,
      generation: 1,
    }),
    { code: 'STALE_PAUSE' },
  )
  assert.equal(runtimes[0]?.dispatches, 0)
  assert.deepEqual(Object.keys(service.state(record).participants), ['browser'])
})

test('configured explanations retain actual false and null facts while unavailable or foreign facts grant no interpretation or continuation', async (context) => {
  // Arrange
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'facts',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  const action = {
      ...receipt,
      key: 'click',
      action: 'repository-click' as const,
    },
    accepted = service.action(action),
    state = service.state(record),
    snapshotUri = state.participants.browser.snapshotUri!
  // Act
  const explained = await service.explain({
    ...receipt,
    key: 'explain',
    snapshotUri,
    sourceHash: configuration.source.hash,
    valuePaths: ['value:enabled', 'value:selection'],
    interpretation: 'The actual captured flag is false and selection is null.',
  })
  const explanation = await readResource(service, explained.explanationUri)
  const source = await readResource(service, `${snapshotUri}/source/typescript`)
  // Assert
  assert.equal(
    'text' in explanation &&
      JSON.parse(explanation.text).capturedFacts[0].value,
    false,
  )
  assert.equal(
    'text' in explanation &&
      JSON.parse(explanation.text).capturedFacts[1].value,
    null,
  )
  assert.equal('text' in source && source.text, 'const nextTheme = "dark";\n')
  for (const path of ['value:renderLocal', 'value:missing', 'price'])
    assert.throws(
      () =>
        service.explain({
          ...receipt,
          key: path,
          snapshotUri,
          sourceHash: configuration.source.hash,
          valuePaths: [path],
          interpretation: 'Not captured.',
        }),
      { code: 'INVALID_REFERENCE' },
    )
  await service.continue(state.participants.browser.continueArguments!)
  await assert.rejects(
    service.continue(state.participants.browser.continueArguments!),
    { code: 'STALE_PAUSE' },
  )
  await service.stop(receipt)
  assert.deepEqual(service.action(action), accepted)
  assert.equal(runtimes[0]?.dispatches, 1)
  assert.deepEqual(
    await readResource(service, `${snapshotUri}/source/typescript`),
    source,
  )
  assert.equal(service.state(record).participants.browser.resumable, false)
})

// Cycle 0044 (0042-R1): red while a run that failed inside its runtime had no error in its resource, so an agent asked for the cause could only quote terminalReason.
test('a run that fails inside its runtime gives its resource an error whose cause is the failure text', async (context) => {
  // Arrange
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'runtime-failure',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, key: 'click', action: 'repository-click' })
  // Act
  runtimes[0]!.failures.push(
    'Selected server resumed outside its owned continuation',
  )
  runtimes[0]!.status = 'failed'
  const resource = await readResource(service, receipt.runUri)
  // Assert
  assert.ok('text' in resource)
  const state = z
    .object({
      terminalReason: z.string(),
      error: z.object({ code: z.string(), cause: z.string() }),
    })
    .parse(JSON.parse(resource.text))
  assert.equal(
    state.terminalReason,
    'Selected server resumed outside its owned continuation',
  )
  assert.deepEqual(state.error, {
    code: 'RUNTIME_FAILED',
    cause: 'Selected server resumed outside its owned continuation',
  })
})

// Value: protects=the reason an agent reads for a run a learner's breakpoint ended during preparation; fails_when=the run resource names the closed transport ("The study operation failed." / "Error: CDP disconnected") instead of the runtime's own reason; why_new=native run of 2026-10-04, run 4f46d9c6; seam=runtime.prepare
test('a run its runtime ends during preparation gives its resource the runtime’s reason, not the closed transport', async (context) => {
  // Arrange
  const { service, configuration, environment, runtimes } =
      await configuredServiceHarness(context),
    create = environment.createRuntime
  environment.createRuntime = async (...arguments_) => {
    const runtime = await create(...arguments_)
    runtime.prepare = async () => {
      // A pause the run did not declare ends the runtime, whose cleanup closes the browser transport under the pending preparation.
      runtimes[0]!.failures.push(
        'Unexpected or additional server stop invalidated the declared operation',
      )
      runtimes[0]!.status = 'failed'
      throw new Error('CDP disconnected')
    }
    return runtime
  }
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'learner-breakpoint',
    configuration,
  })
  await service.record(receipt).preparation

  // Act
  const resource = await readResource(service, receipt.runUri)

  // Assert
  assert.ok('text' in resource)
  const state = z
    .object({
      terminalReason: z.string(),
      error: z.object({
        code: z.string(),
        message: z.string(),
        cause: z.string(),
      }),
    })
    .parse(JSON.parse(resource.text))
  assert.equal(
    state.terminalReason,
    'Unexpected or additional server stop invalidated the declared operation',
  )
  assert.deepEqual(state.error, {
    code: 'RUNTIME_FAILED',
    message:
      'Unexpected or additional server stop invalidated the declared operation',
    cause:
      'Unexpected or additional server stop invalidated the declared operation',
  })
})

// Value: protects=the cause an agent and the learner read for a run whose preparation failed with an error that is no StudyError (the reader's "The dedicated Application layout could not be confirmed." in Cursor after a reload, C57 rounds 1f and 1f2): the run resource's terminalReason and error.message, and the reason the runtime journals as run.failed, name that cause; fails_when=they say only "The study operation failed." while the cause stays in error.cause alone, so the journal and the saved study's reason tell nobody why the start failed; why_new=Cycle 0046 row 645; seam=environment.createRuntime, runtime.prepare and runtime.fail (ConfiguredBrowserRun journals the reason it is given as run.failed, configuredBrowserRun.ts fail)
test('a run whose preparation fails with an error that is no StudyError names that error in its terminal reason and in the reason it journals as run.failed', async (context) => {
  // Arrange
  const { service, configuration, environment } =
      await configuredServiceHarness(context),
    create = environment.createRuntime
  const journaledReasons: string[] = []
  environment.createRuntime = async (...arguments_) => {
    const runtime = await create(...arguments_)
    const failRuntime = runtime.fail.bind(runtime)
    runtime.fail = (reason): void => {
      journaledReasons.push(reason)
      failRuntime(reason)
    }
    runtime.prepare = async () => {
      throw new Error(
        'The dedicated Application layout could not be confirmed.',
      )
    }
    return runtime
  }
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'failed-application-layout',
    configuration,
  })
  await service.record(receipt).preparation

  // Act
  const resource = await readResource(service, receipt.runUri)

  // Assert
  assert.ok('text' in resource)
  const state = z
    .object({
      terminalReason: z.string(),
      error: z.object({
        code: z.string(),
        message: z.string(),
        cause: z.string(),
      }),
    })
    .parse(JSON.parse(resource.text))
  assert.deepEqual(
    {
      terminalReason: state.terminalReason,
      error: state.error,
      journaledReasons,
    },
    {
      terminalReason:
        'The study operation failed. Cause: The dedicated Application layout could not be confirmed.',
      error: {
        code: 'RUNTIME_FAILED',
        message:
          'The study operation failed. Cause: The dedicated Application layout could not be confirmed.',
        cause:
          'Error: The dedicated Application layout could not be confirmed.',
      },
      journaledReasons: [
        'The study operation failed. Cause: The dedicated Application layout could not be confirmed.',
      ],
    },
  )
})

// Value: protects=the cause an agent and the learner read for a run whose preparation failed when the release that follows fails as well: the run resource's terminalReason and error still name the preparation's cause, and the release's failure is the cleanupError; fails_when=the failed release replaces the run's error with "The study operation failed.", so the run resource no longer says why the start failed; why_new=Cycle 0046 row 653 (the release's catch in StudyService.prepare); seam=runtime.prepare and runtime.stop, both made to reject
test('a run whose preparation fails and whose release then fails keeps the preparation cause as its terminal reason', async (context) => {
  // Arrange
  const { service, configuration, environment } =
      await configuredServiceHarness(context),
    create = environment.createRuntime,
    restoreStops: (() => void)[] = []
  environment.createRuntime = async (...arguments_) => {
    const runtime = await create(...arguments_)
    const stopRuntime = runtime.stop.bind(runtime)
    restoreStops.push(() => {
      runtime.stop = stopRuntime
    })
    runtime.prepare = async () => {
      throw new Error(
        'The dedicated Application layout could not be confirmed.',
      )
    }
    runtime.stop = async () => {
      throw new Error('Owned process still alive')
    }
    return runtime
  }
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'failed-preparation-and-release',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation

  // Act
  await waitUntil(
    () => Boolean(record.cleanupError) && !record.stopping,
    'the failed release after the failed preparation',
    1_000,
  )
  const resource = await readResource(service, receipt.runUri)
  // The harness's own shutdown releases the run once the test has read it.
  for (const restoreStop of restoreStops) restoreStop()

  // Assert
  assert.ok('text' in resource)
  const state = z
    .object({
      terminalReason: z.string(),
      error: z.object({
        code: z.string(),
        message: z.string(),
        cause: z.string(),
      }),
      cleanupError: z.object({ message: z.string(), cause: z.string() }),
    })
    .parse(JSON.parse(resource.text))
  assert.deepEqual(
    {
      terminalReason: state.terminalReason,
      error: state.error,
      cleanupError: state.cleanupError,
    },
    {
      terminalReason:
        'The study operation failed. Cause: The dedicated Application layout could not be confirmed.',
      error: {
        code: 'RUNTIME_FAILED',
        message:
          'The study operation failed. Cause: The dedicated Application layout could not be confirmed.',
        cause:
          'Error: The dedicated Application layout could not be confirmed.',
      },
      cleanupError: {
        message: 'The study operation failed.',
        cause: 'Error: Owned process still alive',
      },
    },
  )
})

// Value: protects=the cause an agent and the learner read for a run that the maintenance turn ends because its evidence could not be written: the run resource's terminalReason and error.message, and the reason the runtime journals as run.failed, name the write's failure, also after the release failed on the same storage; fails_when=they say only "Evidence buffering or persistence failed." while the failure stays in error.cause alone, or the failed release replaces the run's error with "The study operation failed."; why_new=Cycle 0046 row 653 (StudyService.maintain); seam=runtime.evidence.failure, set as Evidence sets it after a failed append, and runtime.fail (ConfiguredBrowserRun journals the reason it is given as run.failed, configuredBrowserRun.ts fail)
test('a run that the maintenance turn ends for an evidence write failure names that failure in its terminal reason and in the reason it journals as run.failed', async (context) => {
  // Arrange
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'failed-evidence-write',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  const runtime = runtimes[0]!,
    failRuntime = runtime.fail.bind(runtime),
    journaledReasons: string[] = []
  runtime.fail = (reason): void => {
    journaledReasons.push(reason)
    failRuntime(reason)
  }
  runtime.evidence.failure = 'Error: ENOSPC: no space left on device, write'

  // Act
  service.maintain()
  await waitUntil(
    () => Boolean(record.cleanupError) && !record.stopping,
    'the release after the evidence failure',
    1_000,
  )
  const resource = await readResource(service, receipt.runUri)
  // The harness's own shutdown releases the run once the test has read it.
  runtime.evidence.failure = undefined

  // Assert
  assert.ok('text' in resource)
  const state = z
    .object({
      terminalReason: z.string(),
      error: z.object({
        code: z.string(),
        message: z.string(),
        cause: z.string(),
      }),
    })
    .parse(JSON.parse(resource.text))
  assert.deepEqual(
    {
      terminalReason: state.terminalReason,
      error: state.error,
      journaledReasons,
    },
    {
      terminalReason:
        'Evidence buffering or persistence failed. Cause: ENOSPC: no space left on device, write',
      error: {
        code: 'EVIDENCE_UNAVAILABLE',
        message:
          'Evidence buffering or persistence failed. Cause: ENOSPC: no space left on device, write',
        cause: 'Error: ENOSPC: no space left on device, write',
      },
      journaledReasons: [
        'Evidence buffering or persistence failed. Cause: ENOSPC: no space left on device, write',
      ],
    },
  )
})

// Value: protects=what an agent and the learner read for a run whose saved study was removed while it ran (its archive and evidence directory removed by hand or by another Codebook window, which Retry storage reports as archive-removed): the maintenance turn ends the run for the evidence write that failed, and its terminal reason, its error and the reason it journals as run.failed name that failure and the removal, without the internal storage path the write's error names; fails_when=the write's raw error ("ENOENT: no such file or directory, open '<global storage>/…/events.jsonl'") becomes the cause in the terminal reason since row 653 (the release's own failure, the run's cleanupError, is not this test's: it still names the path); why_new=Cycle 0046 row 667 (the 653 fork's finding 3); seam=StudyService.excludeHistory with 'archive-removed', as StudyWorkspace calls it, the run's evidence directory removed, an event recorded after that, and runtime.fail (ConfiguredBrowserRun journals the reason it is given as run.failed)
test('a run whose saved study was removed while it ran ends at the maintenance turn with a terminal reason that names the failed evidence write and the removal and no storage path', async (context) => {
  // Arrange: a prepared run whose study left the library; its evidence directory is gone, so the next event's append fails.
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'removed-during-run',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  const runtime = runtimes[0]!,
    failRuntime = runtime.fail.bind(runtime),
    journaledReasons: string[] = []
  runtime.fail = (reason): void => {
    journaledReasons.push(reason)
    failRuntime(reason)
  }
  await runtime.evidence.flush()
  await rm(runtime.evidence.directory, { recursive: true, force: true })
  service.excludeHistory(record, 'archive-removed')
  runtime.evidence.record('late.event')
  await runtime.evidence.flush().catch(() => undefined)
  const writeFailureNamesPath = Boolean(
    runtime.evidence.failure?.includes(runtime.evidence.directory),
  )

  // Act
  service.maintain()
  await waitUntil(
    () => Boolean(record.cleanupError) && !record.stopping,
    'the release after the evidence failure',
    1_000,
  )
  const resource = await readResource(service, receipt.runUri)
  // The harness's own shutdown releases the run once the test has read it.
  runtime.evidence.failure = undefined

  // Assert
  assert.ok('text' in resource)
  const state = z
    .object({
      terminalReason: z.string(),
      error: z.object({
        code: z.string(),
        message: z.string(),
        cause: z.string(),
      }),
    })
    .parse(JSON.parse(resource.text))
  assert.deepEqual(
    {
      writeFailureNamesPath,
      terminalReason: state.terminalReason,
      error: state.error,
      journaledReasons,
      failureNamesPath: JSON.stringify([
        state.terminalReason,
        state.error,
        journaledReasons,
      ]).includes(runtime.evidence.directory),
    },
    {
      writeFailureNamesPath: true,
      terminalReason:
        "Evidence buffering or persistence failed. Cause: The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window.",
      error: {
        code: 'EVIDENCE_UNAVAILABLE',
        message:
          "Evidence buffering or persistence failed. Cause: The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window.",
        cause:
          "The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window.",
      },
      journaledReasons: [
        "Evidence buffering or persistence failed. Cause: The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window.",
      ],
      failureNamesPath: false,
    },
  )
})

// Value: protects=what an agent and the learner read about the release of a run whose saved study was removed while it ran: the release's final evidence write fails too, since the evidence directory left with the archive, and the run's cleanupError and the explicit retry's error (Stop, as the stop tool and the Study's stop control ask it) name that failed write and the removal, without the internal storage path the write's error names; fails_when=StudyService.stopRecord makes the release's raw error ("Evidence write failed: Error: ENOENT: no such file or directory, open '<global storage>/…/events.jsonl'") the cleanupError's cause and rethrows it to the retry; why_new=Cycle 0046 row 686 (row 667 fixed the terminal reason only); seam=StudyService.excludeHistory with 'archive-removed', as StudyWorkspace calls it, the run's evidence directory removed, an event recorded after that, maintain, the run resource and StudyService.stop
test('a run whose saved study was removed while it ran keeps a release failure that names the failed evidence write and the removal and no storage path', async (context) => {
  // Arrange: a prepared run whose study left the library; its evidence directory is gone, so the next event's append and the release's final write fail.
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'removed-during-release',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  const runtime = runtimes[0]!
  await runtime.evidence.flush()
  await rm(runtime.evidence.directory, { recursive: true, force: true })
  service.excludeHistory(record, 'archive-removed')
  runtime.evidence.record('late.event')
  await runtime.evidence.flush().catch(() => undefined)
  const writeFailureNamesPath = Boolean(
    runtime.evidence.failure?.includes(runtime.evidence.directory),
  )

  // Act: the maintenance turn ends the run and its release fails; then the learner's Stop asks for the release again.
  service.maintain()
  await waitUntil(
    () => Boolean(record.cleanupError) && !record.stopping,
    'the release after the evidence failure',
    1_000,
  )
  const resource = await readResource(service, receipt.runUri)
  const retryFailure = await service
    .stop({ instanceId: service.instanceId, runId: record.id })
    .then(
      () => 'released',
      (error: unknown) => String(error),
    )
  // The harness's own shutdown releases the run once the test has read it.
  runtime.evidence.failure = undefined

  // Assert
  assert.ok('text' in resource)
  const state = z
    .object({
      cleanupError: z.object({
        code: z.string(),
        message: z.string(),
        cause: z.string(),
      }),
    })
    .parse(JSON.parse(resource.text))
  assert.deepEqual(
    {
      writeFailureNamesPath,
      cleanupError: state.cleanupError,
      retryFailure,
      failureNamesPath: JSON.stringify([
        state.cleanupError,
        retryFailure,
      ]).includes(runtime.evidence.directory),
    },
    {
      writeFailureNamesPath: true,
      cleanupError: {
        code: 'RUNTIME_FAILED',
        message: 'The study operation failed.',
        cause:
          "Error: Evidence write failed: The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window.",
      },
      retryFailure:
        "Error: Evidence write failed: The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window.",
      failureNamesPath: false,
    },
  )
})

// Cycle 0044 (0042-SR3): red while terminalReason carried a runtime failure of any length, which the saved study's 8,192-character reason refuses.
test('a runtime failure longer than the saved reason limit is cut to that limit in the run resource', async (context) => {
  // Arrange
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'long-runtime-failure',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, key: 'click', action: 'repository-click' })
  const longFailure = `The browser is paused at ${'u'.repeat(9_000)} without a debugger stop.`
  // Act
  runtimes[0]!.failures.push(longFailure)
  runtimes[0]!.status = 'failed'
  const state = service.state(record)
  // Assert
  assert.equal(state.terminalReason, longFailure.slice(0, 8_192))
  assert.equal(state.error?.cause, longFailure.slice(0, 8_192))
})

test('a repository run exposes the Study link identity separately from its debugger session identity', async (context) => {
  // Arrange
  const { service, configuration } = await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'saved-study-link',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, key: 'click', action: 'repository-click' })
  await service.continue(
    service.state(record).participants.browser.continueArguments!,
  )
  await service.stop(receipt)

  // Act
  const resource = await readResource(service, receipt.runUri)
  assert.ok('text' in resource)
  const state = z
    .object({
      instanceId: z.string(),
      runId: z.string(),
      studyId: z.string(),
      runtimeRunId: z.string(),
      observations: z.array(z.object({ id: z.string() })),
    })
    .parse(JSON.parse(resource.text))

  // Assert
  assert.equal(state.studyId, `${state.instanceId}_${state.runId}`)
  assert.notEqual(state.studyId, `${state.instanceId}_${state.runtimeRunId}`)
  assert.equal(state.observations.length, 1)
})

for (const version of [1, 2])
  test(`real SDK accepts configuration version ${version} and reconnects without a second dispatch`, async (context) => {
    // Arrange: HTTP/SDK/storage are real, editor effects remain the explicitly synthetic harness.
    const { service, configuration, runtimes } =
        await configuredServiceHarness(context),
      endpoint = await startServer(service)
    const connect = async () => {
      const client = new Client({
        name: 'configured-contract-test',
        version: '1.0',
      })
      await client.connect(
        new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), {
          requestInit: {
            headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
          },
        }),
      )
      return client
    }
    const first = await connect()
    let second: Client | undefined
    try {
      // Act
      const tools = await first.listTools(),
        start = {
          instanceId: service.instanceId,
          profile: 'repository-browser',
          key: 'sdk',
          configuration:
            version === 2
              ? { ...configuration, version: 2, participant: 'browser' }
              : configuration,
        }
      const result = await first.callTool({
          name: 'codebook_start',
          arguments: start,
        }),
        receipt = z
          .object({ data: receiptSchema })
          .parse(result.structuredContent).data
      await service.record(receipt).preparation
      const input = {
        instanceId: receipt.instanceId,
        runId: receipt.runId,
        action: 'repository-click',
        key: 'one-click',
      }
      const accepted = await first.callTool({
        name: 'codebook_action',
        arguments: input,
      })
      await first.close()
      second = await connect()
      const repeated = await second.callTool({
        name: 'codebook_action',
        arguments: input,
      })
      const invalid = await second.callTool({
        name: 'codebook_start',
        arguments: {
          ...start,
          key: 'bad',
          configuration: { ...configuration, shell: 'unexpected' },
        },
      })
      // Assert
      assert.equal(
        tools.tools.find((tool) => tool.name === 'codebook_start')?.inputSchema
          .type,
        'object',
      )
      assert.equal(accepted.isError, undefined)
      assert.deepEqual(repeated.structuredContent, accepted.structuredContent)
      assert.equal(runtimes[0]?.dispatches, 1)
      assert.equal(invalid.isError, true)
      assert.equal(service.records.size, 1)
      assert.deepEqual(
        (await second.callTool({ name: 'codebook_start', arguments: start }))
          .structuredContent,
        result.structuredContent,
      )
    } finally {
      await first.close()
      await second?.close()
      await endpoint.close()
    }
  })

// Value: protects=an agent that meets a study of a newer Codebook in the library knows from the help that it is refused and kept; fails_when=the help names only corrupt and unsupported formats (RT-1, DX-15); why_new=the help had no sentence for a newer format; seam=none
test('configured help says that a study saved in a newer format is refused as saved by a newer Codebook and is kept', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({ retainedFormats: z.string() })
    .parse(JSON.parse(help.text))
  assert.equal(
    contract.retainedFormats.includes(
      'A study saved in a newer format is refused as saved by a newer Codebook and is kept.',
    ),
    true,
  )
})

test('configured help tells an agent that only the next stop is armed and where its binding may lie', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({
      additionalStops: z.string(),
      sourceBinding: z.string(),
      sequence: z.array(z.string()),
    })
    .parse(JSON.parse(help.text))
  assert.match(
    contract.additionalStops,
    /Codebook arms only the next expected stop: the first stop before input, and each later stop inside the codebook_continue that follows the stop before it\. A later stop's line can therefore execute earlier without pausing; declare stops in the order the action executes them\./,
  )
  assert.match(
    contract.additionalStops,
    /the run fails with 'Repository continuation reached no next declared pause' and names that stop\./,
  )
  assert.match(
    contract.sourceBinding,
    /The line is the declaration and the column is a preference: Codebook accepts the debugger's verified binding anywhere on the declared line in the sealed executed module/,
  )
  assert.match(
    contract.sourceBinding,
    /Each observation's inspection resource reports it as source \{line,column\} beside requestedSource \{line,column\}; cite source\./,
  )
  assert.match(
    contract.sourceBinding,
    /Any other binding on another line fails, naming the condition that refused it: a browser stop at once while it is armed, a server stop when the adapter acknowledges it on that line or, while its registration is pending, only at its pause, about 3 seconds after it, and never when that line does not run \(the stop then ends at the 20-second deadline\); declare the bound place instead, in a citation that covers it\. Two declared stops that bind on one place fail when the second binds; declare that place once\./,
  )
  assert.match(
    contract.sourceBinding,
    /A declared line without a mapped position \(a blank line, or a comment the generated module kept\) is requested at the first mapped position after it within the stop's citation, because the debugger verifies no breakpoint on such a line, and is accepted there under the next rule; preparation fails before input only when no later line of the stop's citation can carry a position either\. The sealed map decides that; when it is too large to scan completely, the source text does: a line that is blank or only a comment carries none\./,
  )
  assert.match(
    contract.sequence[2] ?? '',
    /The inspection's source is the bound position to cite; requestedSource is the position you declared\./,
  )
  assert.match(
    contract.sequence[3] ?? '',
    /That continue arms the next declared stop before it resumes\./,
  )
  assert.doesNotMatch(help.text, /exact position/)
  assert.doesNotMatch(help.text, /first stop of each participant/)
})

// Cycle 0045 (SM-16, DX-7, ER-9): red while the help counted the rule from the declared line ("no line between the two has a mapped position"), called the column a request and said a slid browser stop fails while it is armed.
// Cycle 0046 (row 56): red while the help said that every mapped line between the requested and the bound line refuses the binding, although since rows 8 and 50 the debugger's break locations decide once it has listed them.
// Cycle 0046 (row 77): red while the help said that every line with a break location counts, although only a break location between the requested and the bound place in the generated module does.
test('configured help states the binding rule from the line the stop is requested on', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const { sourceBinding } = z
    .object({ sourceBinding: z.string() })
    .parse(JSON.parse(help.text))
  assert.equal(
    sourceBinding.includes(
      "The binding rule is counted from the line the breakpoint is requested on: the declared line, or the first mapped line after a declared line without a mapped position. When the debugger cannot pause on the requested line it binds the first place after it. Codebook accepts that binding when it lies on a later line within the stop's citation and no line between the requested line and the bound line has a mapped position (a comment the generated module kept is not one). When a mapped line lies between them, Codebook asks the debugger for the module's break locations and counts only a line that has one between the place the breakpoint was requested at and the place it was bound at in the generated module: a mapped line the debugger cannot pause on, such as a function head or its parameters, is passed over, and so is a line whose break location the build placed elsewhere in the generated module, such as a call it appends at the module's end and maps to a function's name. This also holds for a binding first known at a pause, where the place the program is paused at is the bound place; when either generated place cannot be determined, every line with a break location counts. The journal records breakpoint.rule-from-break-locations with the lines that counted and, when both are known, the two generated places (and breakpoint.requested-again-after-break-locations when a server registration is requested again for it). When the debugger cannot list break locations, the mapped lines decide. Codebook uses an accepted binding like a moved column: the inspection's source names the bound line, so cite and explain source. Let the citation cover every line of the statement the stop is in, so that a moved binding stays inside it.",
    ),
    true,
  )
  assert.equal(
    sourceBinding.includes(
      "Declare the column where the statement begins. When the debugger binds a stop on a later line although the line the breakpoint was requested on has a break location, Codebook requests the breakpoint once more, at that line's break location before the requested column; the stop fails while it is armed only when that second request is bound on a later line again or the line has no break location before the requested column. A binding that is first known at a pause (a server stop whose registration was still pending when it was armed) is not refused for this: the stop is accepted where it paused, and its inspection's place names the column that can pause on the requested line.",
    ),
    true,
  )
  assert.doesNotMatch(sourceBinding, /the column is a request/)
})

// Value: protects=an agent reading, where declaring a stop's line and column is explained, that a column on a blank line is taken at the line's start and where the run says so; fails_when=the help no longer says it, or names another journal entry than the run writes; why_new=Cycle 0045 N14c-13 (DX-1 a); seam=none
test('configured help says that any column declared on a blank line is taken as the line’s start and names the journal entry that records it', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const { sourceBinding } = z
    .object({ sourceBinding: z.string() })
    .parse(JSON.parse(help.text))
  assert.equal(
    sourceBinding.includes(
      "a line that is blank or only a comment carries none. A blank line has no column to choose: any column declared on it is taken as the line's start, and the run's journal records breakpoint.column-on-blank-line with the field, the declared and the taken position. The binding rule is counted",
    ),
    true,
  )
})

// Cycle 0045 (SM-17): red while the README kept the rule counted from the declared line and said nothing about the second request.
// Cycle 0046 (row 56): red while the README kept the rule of mapped lines alone, without the debugger's break locations.
// Cycle 0046 (row 77): red while the README counted every line with a break location, wherever that location lies in the generated module.
test('the extension README states the binding rule from the requested line, as the help does', async () => {
  // Arrange
  const readme = await readFile(join(__dirname, '../../README.md'), 'utf8')
  // Act
  const statesRule = readme.includes(
      "The binding rule is counted from the line the breakpoint is requested on: the declared line, or the first mapped line after a declared line without a mapped position. When the debugger cannot pause on the requested line it binds the first place after it. Codebook accepts that binding when it lies on a later line within the stop's citation and no line between the requested line and the bound line has a mapped position (a comment the generated module kept is not one). When a mapped line lies between them, Codebook asks the debugger for the module's break locations and counts only a line that has one between the place the breakpoint was requested at and the place it was bound at in the generated module: a mapped line the debugger cannot pause on, such as a function head or its parameters, is passed over, and so is a line whose break location the build placed elsewhere in the generated module, such as a call it appends at the module's end and maps to a function's name. This also holds for a binding first known at a pause, where the place the program is paused at is the bound place; when either generated place cannot be determined, every line with a break location counts. The run's journal records `breakpoint.rule-from-break-locations` with the lines that counted and, when both are known, the two generated places (and `breakpoint.requested-again-after-break-locations` when a server registration is requested again for it). When the debugger cannot list break locations, the mapped lines decide. Codebook uses an accepted binding like a moved column: `source` names the bound line.",
    ),
    statesSecondRequest = readme.includes(
      "The line is the declaration and the column is a preference: Codebook accepts the debugger's verified binding anywhere on that line and reports the bound position as `source` beside `requestedSource` in the observation's inspection resource. Declare the column where the statement begins. When the debugger binds a stop on a later line although the line the breakpoint was requested on has a break location, Codebook requests the breakpoint once more, at that line's break location before the requested column; the stop fails while it is armed only when that second request is bound on a later line again or the line has no break location before the requested column. A binding that is first known at a pause (a server stop whose registration was still pending when it was armed) is not refused for this: the stop is accepted where it paused, and its inspection's `place` names the column that can pause on the requested line.",
    )
  // Assert
  assert.equal(statesRule, true)
  assert.equal(statesSecondRequest, true)
})

// Value: protects=the help naming the same deadline the run enforces; fails_when=the help keeps a hard-coded "20 seconds" after the active-progress deadline changes; why_new=Cycle 0036 C08b; seam=none
test('configured help names the active-progress deadline the run uses, in seconds, in all six places', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Derived on purpose: the help must follow the deadline (20 s today), not repeat a number that can drift from it.
  const deadlineSeconds = ACTIVE_TIMEOUT_MS / 1_000

  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')

  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({ additionalStops: z.string(), sourceBinding: z.string() })
    .parse(JSON.parse(help.text))
  assert.equal(
    contract.additionalStops.includes(
      `If a later stop is not hit within ${deadlineSeconds} seconds of the preceding continuation`,
    ),
    true,
  )
  assert.equal(
    contract.sourceBinding.includes(
      `the stop then fails at the ${deadlineSeconds}-second deadline`,
    ),
    true,
  )
  assert.equal(
    contract.sourceBinding.includes(
      `A browser stop whose binding never verifies times out after ${deadlineSeconds} seconds while it is being armed`,
    ),
    true,
  )
  assert.equal(
    (help.text.match(new RegExp(`${deadlineSeconds}[ -]second`, 'g')) ?? [])
      .length,
    6,
  )
})

// Cycle 0044 (0042-SR19): red while the help said "Any other binding on another line fails at once" and "an unexpected pause or manual resume invalidates this operation", although a server binding fails about 3 s after its pause and a pause the debugger resumes by itself is retired; one sentence with Group 1's R18 (the pending-registration qualifier).
test('configured help tells an agent when a binding on another line fails for each participant and that a pause the debugger resumes by itself is retired', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({ sourceBinding: z.string(), sequence: z.array(z.string()) })
    .parse(JSON.parse(help.text))
  assert.equal(
    contract.sourceBinding.includes(
      'Any other binding on another line fails, naming the condition that refused it: a browser stop at once while it is armed, a server stop when the adapter acknowledges it on that line or, while its registration is pending, only at its pause, about 3 seconds after it, and never when that line does not run (the stop then ends at the 20-second deadline); declare the bound place instead, in a citation that covers it.',
    ),
    true,
  )
  assert.doesNotMatch(help.text, /fails at once/)
  // Cycle 0044 (0041-N10-1b, R3): one rule whatever the map's size; the help no longer says that every declared line without a mapped position fails preparation.
  assert.equal(
    contract.sourceBinding.includes(
      "A declared line without a mapped position (a blank line, or a comment the generated module kept) is requested at the first mapped position after it within the stop's citation, because the debugger verifies no breakpoint on such a line, and is accepted there under the next rule; preparation fails before input only when no later line of the stop's citation can carry a position either. The sealed map decides that; when it is too large to scan completely, the source text does: a line that is blank or only a comment carries none.",
    ),
    true,
  )
  assert.equal(
    contract.sequence[3]?.endsWith(
      "Earlier observations remain immutable. A manual or competing resume of a captured pause, or a second stop the debugger announces, invalidates this operation. A pause the debugger makes for itself away from the next declared stop's bound place and resumes by itself is retired: the journal records it as cdp.adapter-pause-retired with its place and pausedForMs (the first 100 such pauses of a run; the rest are counted), and the run goes on. A pause no stop announced that is resumed only after more than 3 seconds, or after more than 1 second while a stop of that participant is announced and still waits for its own pause, ends the run as a manual or competing resume. A stop announced for a pause that came before its turn (before the input was sent or before the preceding continuation was requested) fails naming that early pause.",
    ),
    true,
  )
  assert.doesNotMatch(help.text, /an unexpected pause or manual resume/)
})

// Cycle 0044 (0042-DOC1): red while the deadline place forms and the pause journal fields were documented only in source and CHANGELOG.
// Cycle 0045 (B-L5): the journal sentences have their own test below; this one keeps the wait and the deadline's place.
test('configured help tells an agent that a run waits for the debugger’s own pauses and how a deadline names a paused place', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({ sequence: z.array(z.string()) })
    .parse(JSON.parse(help.text))
  assert.equal(
    contract.sequence[4]?.includes(
      'A run does not complete while a pause the debugger made for itself is still open; if it stays open, the run fails at its 20-second deadline. A deadline that expires while a participant is paused with no announced stop adds where, for example "The server is paused at auth.ts:18 without a debugger stop." The place is <repository path>:<line> in a declared stop\'s module, <script URL> <line>:<column> in another announced script, "an unknown script <line>:<column>" in one never announced, and "an unknown place" for an empty stack. The journal records a pause as cdp.pause-observed',
    ),
    true,
  )
})

// Cycle 0045 (B-L5): red while the help said the journal records every pause and every resume, which is false past the cap, and named two of the four resume entries.
// Cycle 0046 (row 56): red while the list had no entry for a page pause at a server stop's breakpoint, which the run resumes itself since row 7.
// Cycle 0046 (row 271): red while the help said that both entries of such a pause come before the entry of the page's resume; only the request does, the answered entry is written after the debugger's answer and can follow it.
// Cycle 0046 (row 283): red while the help said that a request without the second entry was refused or not answered and not what the run's failure then tells the agent (row 268's sentences).
test('the configured help names every journal entry of a pause and its resume and says that pauses away from a stop are journaled up to the limit', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({ sequence: z.array(z.string()) })
    .parse(JSON.parse(help.text))
  assert.equal(
    contract.sequence[4]?.includes(
      " The journal records a pause as cdp.pause-observed (url, line, column, functionName, hitBreakpoints, stopIndex, continuation receipts): a declared stop's pause always, and of the pauses away from a stop the first 100 the runtime makes for its own instrumentation and the first 100 others of a run; the rest are counted in cdp.adapter-pauses-not-journaled when the run ends. A resume is recorded with pausedForMs under one of four names: cdp.resumed (a declared stop's pause; an instrumentation pause or a pause from before the action, when its observation was journaled), cdp.adapter-pause-retired (a pause the debugger made for itself and resumed in time, when its observation was journaled), cdp.browser-adapter-pause-retired (the same for a browser pause in a run that declares no browser stop) and cdp.unannounced-pause-resumed-late (a pause no stop announced that was resumed too late, which ends the run). A page pause at a server stop's breakpoint that Codebook resumes itself has two more entries (both with declared, hitBreakpointIds, inputDispatched): dap.server-breakpoint-browser-resume-requested when Codebook sends the page's resume, which comes before that entry of the page's resume, and dap.server-breakpoint-browser-stop-resumed once the debugger answered the request, which can come before or after it; a request without the second entry was refused or not answered, and the failure that ends the run for it (the refusal, or a deadline that expires meanwhile) names the page's pause and the declared server stop and says to keep the declaration and start a new run. Stop/seal and wait for current history/recording receipts.",
    ),
    true,
  )
  assert.doesNotMatch(help.text, /records every pause|every resume/)
})

// Value: protects=an agent that declares a server stop in a "use server" module knowing that the page's pause at that breakpoint is Codebook's to resume, not a reason to change the declaration; fails_when=the help or the README no longer says that Codebook resumes that page pause, or names another journal entry for it than the run writes; why_new=Cycle 0046 row 56: row 7 made the run resume that pause, and only the source said so; seam=none
test('the configured help and the README say that Codebook resumes a page pause at a server stop’s breakpoint in the page’s stub of a "use server" module', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  const readme = await readFile(join(__dirname, '../../README.md'), 'utf8')
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const { additionalStops } = z
    .object({ additionalStops: z.string() })
    .parse(JSON.parse(help.text))
  assert.equal(
    additionalStops.includes(
      'Server stops use the owned Next worker and sealed action-browser modules; pending breakpoint registration is not a verified pause. The editor sets a server stop\'s breakpoint in the page too; when the page pauses there, in its stub of a "use server" module, Codebook resumes the page itself and goes on waiting for the stop in the server. Codebook arms only the next expected stop:',
    ),
    true,
  )
  assert.equal(
    readme.includes(
      'One announced pause is expected: the editor sets a server stop\'s breakpoint in the page too, and when the page pauses there, in its stub of a `"use server"` module, Codebook resumes the page itself (`dap.server-breakpoint-browser-stop-resumed` in the run\'s journal) and goes on waiting for the stop in the server.',
    ),
    true,
  )
})

// Cycle 0045 (B-L5, DX-19): red while "100", "3 seconds", "1 second" were typed in the help beside their constants; the help is loaded over other constants, so a number that is typed stays what it was.
test('the configured help takes the journal limit, the two pause bounds and its two version numbers from the constants', async (context) => {
  // Arrange: the help module is evaluated over a journal limit of 7, pause bounds of 4 s and 2 s, API 9.9 and a minimum extension version 8.8.8.
  const { service } = await configuredServiceHarness(context)
  const resources = await loadModule<typeof ResourcesModule>(
    join(__dirname, '../resources.js'),
    {
      './constants': {
        ...constants,
        API_VERSION: '9.9',
        CONFIGURED_MINIMUM_EXTENSION_VERSION: '8.8.8',
        REPOSITORY_ADAPTER_PAUSE_JOURNAL_LIMIT: 7,
        REPOSITORY_ADAPTER_PAUSE_LIMIT_MS: 4_000,
        REPOSITORY_ANNOUNCED_PAUSE_RESUME_LIMIT_MS: 2_000,
      },
    },
  )
  // Act
  const help = await resources.readResource(
    service,
    'codebook://help/repository-browser',
  )
  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({ entry: z.string(), sequence: z.array(z.string()) })
    .parse(JSON.parse(help.text))
  assert.equal(
    contract.entry.startsWith('API 9.9, extension 8.8.8 or later. '),
    true,
  )
  assert.equal(
    contract.sequence[3]?.includes(
      'the journal records it as cdp.adapter-pause-retired with its place and pausedForMs (the first 7 such pauses of a run; the rest are counted), and the run goes on. A pause no stop announced that is resumed only after more than 4 seconds, or after more than 2 seconds while a stop of that participant is announced and still waits for its own pause, ends the run as a manual or competing resume.',
    ),
    true,
  )
  assert.equal(
    contract.sequence[4]?.includes(
      'the first 7 the runtime makes for its own instrumentation and the first 7 others of a run;',
    ),
    true,
  )
})

// Cycle 0045 (DX-19): red while the repository help named the path extension/README.md, which does not exist in a learner's workspace, and the Study help began a sentence with "API 1.2:".
test('no help resource names a path under extension/, the tutorial is named by the README section, and the recording discovery says since which API it exists', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  const helpUris = [
    'codebook://help/errors',
    'codebook://help/repository-browser',
    'codebook://help/node-test',
    'codebook://help/repository',
    'codebook://help/studies',
  ]
  // Act
  const texts: string[] = []
  for (const uri of helpUris) {
    const help = await readResource(service, uri)
    assert.ok('text' in help)
    texts.push(help.text)
  }
  // Assert
  assert.deepEqual(
    helpUris.filter((_uri, index) => texts[index]?.includes('extension/')),
    [],
  )
  assert.equal(
    z.object({ tutorial: z.string() }).parse(JSON.parse(texts[3] ?? ''))
      .tutorial,
    "the Codebook extension's README, section Learn this repository",
  )
  assert.equal(
    z
      .object({ recording: z.object({ discovery: z.string() }) })
      .parse(JSON.parse(texts[4] ?? ''))
      .recording.discovery.startsWith(
        'Follow codebook_status.recording.libraryUri (since API 1.2), select a saved study recordingUri, then follow framesUri/nextUri',
      ),
    true,
  )
  assert.doesNotMatch(texts[4] ?? '', /API 1\.2:/)
})

// Value: protects=an agent that reads the Study help for the step the run resource points it to finding the names the resource uses, save-learning-summary and saveLearningSummary, and what a spent budget means; fails_when=the last step of the help's sequence no longer names them, or names another number than the run's explanation budget; why_new=Cycle 0046 row 45: the run resource sends the agent to this step ("The last step of the sequence in codebook://help/studies describes it"), and the step did not name the action (Cycle 0045, documentation audit DA-2); seam=none
test('the Study help names save-learning-summary and saveLearningSummary in the last step of its sequence, and what the run resource says once the 32 explanation keys are spent', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/studies')
  // Assert
  assert.ok('text' in help)
  const { sequence } = z
    .object({ sequence: z.array(z.string()) })
    .parse(JSON.parse(help.text))
  assert.equal(
    sequence.at(-1),
    "Read the terminal state and stop result. If terminalReference is present, save a new complete learningSummary through codebook_explain with an observed final-result step citing that exact terminalReference and a new explanation key. While no explanation of a stopped run with a demonstrated result carries a learning summary, the run resource lists save-learning-summary in nextActions and gives this step as saveLearningSummary; once the run's 32 explanation keys are spent it no longer lists the action, and saveLearningSummary says that the saved study will have no learning summary. Preserve earlier unknown-at-pause claims as historical uncertainty. Separate runtime/capture evidence from saved learning history and personal understanding.",
  )
})

// Cycle 0044 (0041-DOC1): red while only the CHANGELOG said that an after condition already true before input is refused, and the README left the per-phase fix to the help.
test('configured help and the extension README tell an agent that an after condition already true before the click is refused, and how to fix a condition of each phase', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  const readme = await readFile(join(__dirname, '../../README.md'), 'utf8')
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({ initialState: z.string() })
    .parse(JSON.parse(help.text))
  assert.equal(
    contract.initialState.includes(
      "A condition timeout identifies the failing one-based predicate and its phase without exposing page values: correct a before condition against the fresh page before input, an after condition against the page the action leaves. Codebook also reads action.after just before the click; when the after conditions already hold there, the run ends with 'Configured after conditions were already true before application input' and sends no input, because such a result cannot prove the action caused it; declare an after condition only the action makes true.",
    ),
    true,
  )
  assert.equal(
    readme.includes(
      'A condition timeout names its phase: correct a before condition against the fresh page before input, an after condition against the page the action leaves. Codebook also reads the after conditions just before the click; when they already hold there, the run ends with "Configured after conditions were already true before application input" and sends no input, so declare an after condition only the action makes true.',
    ),
    true,
  )
})

// Cycle 0044 (0042-DOC2): red while the README labelled its setup section and current preview as 0.2.12 although the manifest is newer.
test('the extension README names no release other than the manifest version as its current preview', async () => {
  // Arrange
  const readme = await readFile(join(__dirname, '../../README.md'), 'utf8')
  const manifest = z
    .object({ version: z.string() })
    .parse(
      JSON.parse(await readFile(join(__dirname, '../../package.json'), 'utf8')),
    )
  // Act
  const namedCurrentVersions = [
    ...readme.matchAll(
      /existing (\d+\.\d+\.\d+) preview|identified\*\* (\d+\.\d+\.\d+) preview|current [^.]*?\*\*extension (\d+\.\d+\.\d+)/g,
    ),
  ].map((match) => match[1] ?? match[2] ?? match[3])
  // Assert
  assert.deepEqual(
    namedCurrentVersions.filter((version) => version !== manifest.version),
    [],
  )
})

// Cycle 0045 (B-L4, DX-18): the sentence covers both causes of a continuation that sends no resume; red while it named the arming failure only.
test('configured help tells an agent that a continuation that sends no resume, because its next stop cannot be armed or the other participant’s earlier pauses cannot be read, answers "Continue was not confirmed." and where the run’s reason is read', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({ additionalStops: z.string() })
    .parse(JSON.parse(help.text))
  assert.equal(
    contract.additionalStops.includes(
      " declare stops in the order the action executes them. If a later stop is not hit within 20 seconds of the preceding continuation, the run fails with 'Repository continuation reached no next declared pause' and names that stop. If a later stop cannot be armed, or that stop is the other participant's and that participant's earlier pauses cannot be read, that codebook_continue answers 'Continue was not confirmed.' with the error as its cause and sends no resume; the run ends with a reason that begins 'Next declared stop was not armed and no resume was sent' or 'Next declared stop could not be continued to' (read the run resource), and earlier observations stay. The second reason names no declaration to change: start a new run. Explain each committed pause",
    ),
    true,
  )
  // The tool never answered with the run's terminal reason; the help no longer says it does.
  assert.doesNotMatch(
    contract.additionalStops,
    /that codebook_continue fails with 'Next declared stop was not armed/,
  )
})

// Value: protects=an agent reading, before it declares conditions, that a text condition may match several elements and the other conditions may not; fails_when=the help no longer states the rule for a text condition or the uniqueness of the others; why_new=Cycle 0045 N14c-14; seam=none
test('configured help says that a text condition whose selector matches several elements holds when one of them reads the expected text', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const { initialState } = z
    .object({ initialState: z.string() })
    .parse(JSON.parse(help.text))
  assert.equal(
    initialState.includes(
      'A text condition whose selector matches several elements holds when one of them reads the expected text, and when none does its timeout says how many elements matched; a visible or attribute condition and the click target need a selector that matches exactly one element.',
    ),
    true,
  )
})

// Value: protects=an agent that reads the help once knowing what a text condition compares, in both fields that speak about conditions; fails_when=either sentence drifts, or the old "exact literals" wording comes back and contradicts the new rule; why_new=the help named no rule for whitespace and child text; seam=none
// Cycle 0044 (0041-F6): red while the help said the text rule without the joined child texts and the characters it does not normalize.
test('configured help tells an agent that a text condition compares the whole textContent trimmed with whitespace collapsed and child texts joined without a space, and what to declare for a button with an icon', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({ inspections: z.string(), initialState: z.string() })
    .parse(JSON.parse(help.text))
  assert.equal(
    contract.inspections.endsWith(
      " DOM conditions use literals, never patterns, and all conditions must hold: a text condition compares the element's whole textContent, trimmed and with whitespace runs collapsed on both sides; the texts of child elements are joined without a space, and CSS white-space, zero-width spaces and soft hyphens are not applied; an attribute condition compares the entire value exactly.",
    ),
    true,
  )
  assert.doesNotMatch(contract.inspections, /use exact literals/)
  assert.equal(
    contract.initialState.includes(
      ' A visible condition requires nonzero element geometry. A button with an icon or a hidden label often holds more text than its visible label: for a before condition prefer visible unless the text itself matters, and for an after condition keep the text check on a selector whose element holds only that text. A text-mismatch timeout says when the element holds the expected text beside other text, without exposing page text. For class membership,',
    ),
    true,
  )
})

test('configured help tells an agent that only the learner removes a saved study and that a full library is reported, not repaired', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({ recovery: z.string() })
    .parse(JSON.parse(help.text))
  assert.equal(
    contract.recovery.endsWith(
      ' Only the learner removes a saved study, in the Study workspace; an agent reports a full library and never deletes files.',
    ),
    true,
  )
})

// Cycle 0046 (rows 314 and 322): red while neither help said that a start saves no document of the learner, that a cited source open in the editor with other text refuses the start before anything runs, and that it ends a run that is already going at its next stop.
test('the repository-browser help and the node-test help tell an agent that a start saves no document of the learner, that a cited source open in the editor with other text refuses the start and ends a run that is already going, and what the learner and the agent do then', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  const sentence =
    'Codebook starts its debuggers without saving a document of the learner, and a start is refused with SOURCE_CHANGED, before the application, the test, the browser or a debugger is started, while a cited source is open in the editor with text that differs from the text the article cites, and a run that is already going ends with it at its next stop at the latest (a document that is only marked as modified and holds the cited text refuses and ends nothing): the message names the file, so ask the learner to save it, then read the source again and publish the article again, or to revert it, and start a new run.'
  // Act
  const recoveries: string[] = []
  for (const uri of [
    'codebook://help/repository-browser',
    'codebook://help/node-test',
  ]) {
    const help = await readResource(service, uri)
    assert.ok('text' in help)
    recoveries.push(
      z.object({ recovery: z.string() }).parse(JSON.parse(help.text)).recovery,
    )
  }
  // Assert: once in each help, whole.
  assert.deepEqual(
    recoveries.map((recovery) => recovery.split(sentence).length - 1),
    [1, 1],
  )
})

// Cycle 0046 (row 349): a source change can refuse a start before execution or end a running browser/Node test; help must distinguish those outcomes and preserve the earlier evidence instead of implying that nothing ran.
test('the source-changed error help distinguishes a refused start from an ended browser or Node test, keeps earlier captured observations readable and forbids automatic input replay', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)

  // Act
  const help = await readResource(service, 'codebook://help/errors')
  assert.ok('text' in help)
  const recovery = z
    .object({ SOURCE_CHANGED: z.string() })
    .parse(JSON.parse(help.text)).SOURCE_CHANGED

  // Assert
  assert.equal(
    recovery,
    'At a start, a cited source open in the editor with text that differs from the article refuses the run before the application, test, browser or debugger starts; Codebook saves no document. During a repository-browser or node-test run, the same change ends the run at its next stop or before a continuation; that continuation sends no resume. Earlier committed observations and their captured source remain readable. Read the existing run and its captured source resources; ask the learner to save or revert the named file: after a save, read the source again and publish the article again; after a revert, change nothing. Then start a new deliberate run. Never retry application input automatically.',
  )
})

// Value: protects=each observation of a multi-stop run reporting the position its own stop declared as requestedSource; fails_when=the inspection resource pairs a later observation with the first declared stop, or with a stop at another index; why_new=the only requestedSource test reads a single-stop run, where every index resolves to the same declared stop; seam=none
test('the second observation of a two-stop run reports the position its own stop declared as requestedSource, not the first stop’s', async (context) => {
  // Arrange: the second stop is declared at 1:7 and the debugger committed it at 1:9 of the same line.
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'two-stops',
      configuration: {
        ...configuration,
        additionalStops: [
          {
            line: 1,
            column: 7,
            inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
          },
        ],
      },
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, action: 'repository-click', key: 'one' })
  const runtime = runtimes[0]!,
    firstStop = runtime.snapshots[0]!
  runtime.snapshots.push({
    ...firstStop,
    id: 'browser-session:2',
    pause: { ...firstStop.pause, generation: 2 },
    source: { ...firstStop.source, column: 9 },
  })
  const observations = service.state(record).observations
  // Act
  const first = await readResource(service, observations[0]!.inspectionUri),
    second = await readResource(service, observations[1]!.inspectionUri)
  // Assert
  assert.ok('text' in first)
  assert.ok('text' in second)
  const firstFacts = JSON.parse(JSON.parse(first.text).content),
    secondFacts = JSON.parse(JSON.parse(second.text).content)
  assert.equal(
    JSON.stringify(firstFacts.requestedSource),
    '{"line":1,"column":1}',
  )
  assert.equal(firstFacts.source.column, 1)
  assert.equal(
    JSON.stringify(secondFacts.requestedSource),
    '{"line":1,"column":7}',
  )
  assert.equal(secondFacts.source.line, 1)
  assert.equal(secondFacts.source.column, 9)
})

// Value: protects=an agent reading where a stop the debugger moved to the next line really paused, beside the place it declared; fails_when=the inspection resource reports the declared line as source, or loses requestedSource, for an observation committed on another line; why_new=the requestedSource tests read observations on their declared line only (Cycle 0043, criterion 1); seam=none
test('an observation committed on the line the debugger moved its stop to reports that line as source beside the declared requestedSource', async (context) => {
  // Arrange: the stop is declared at 1:1 and the run committed it at 2:1.
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'moved-line',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, action: 'repository-click', key: 'one' })
  const stop = runtimes[0]!.snapshots[0]!
  stop.source = { ...stop.source, line: 2, column: 1 }
  const observation = service.state(record).observations[0]!
  // Act
  const inspection = await readResource(service, observation.inspectionUri)
  // Assert
  assert.ok('text' in inspection)
  const facts = JSON.parse(JSON.parse(inspection.text).content)
  assert.equal(JSON.stringify(facts.requestedSource), '{"line":1,"column":1}')
  assert.equal(facts.source.line, 2)
  assert.equal(facts.source.column, 1)
})

/**
 * Starts a run on the fixture, sends its click and commits its one stop, declared at src/theme.ts 1:1, at 2:1, as a run does when the debugger binds the breakpoint on the next line.
 * @param context - The test that owns the harness.
 * @param key - The start key of the run.
 * @returns The harness's service and runtime with the run's receipt, its record and the moved stop's snapshot URI and source hash.
 * @example const { service, receipt, snapshotUri, sourceHash } = await runWithStopMovedToNextLine(context, 'moved')
 */
const runWithStopMovedToNextLine = async (
  context: TestContext,
  key: string,
) => {
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key,
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, action: 'repository-click', key: 'one' })
  const runtime = runtimes[0]!,
    stop = runtime.snapshots[0]!
  stop.source = { ...stop.source, line: 2, column: 1 }
  return {
    service,
    runtime,
    receipt,
    record,
    snapshotUri: service.state(record).observations[0]!.snapshotUri,
    sourceHash: configuration.source.hash,
  }
}

/** The `agent.explanation-saved` entries of a run's journal, in the order they were written. @example savedExplanationEntries(runtime)[0] // { id, snapshotId, placeNamed: true } */
const savedExplanationEntries = (runtime: {
  evidence: { events: { type: string; detail: unknown }[] }
}) =>
  runtime.evidence.events
    .filter((event) => event.type === 'agent.explanation-saved')
    .map((event) => JSON.parse(JSON.stringify(event.detail)))

// Value: protects=an agent that reads a moved stop's inspection directly before it explains the stop learning which line the stop paused on; fails_when=the inspection gives the two places as fields only (source.line beside requestedSource), which both chat runs of the baseline round read and still gave the learner the declared line; why_new=Cycle 0045 cause 1 (ER-5); seam=none
test('the inspection of a stop the debugger moved to the next line says which line it paused on, which line was declared, and to name the paused line', async (context) => {
  // Arrange: the stop is declared at src/theme.ts 1:1 and the run committed it at 2:1.
  const { service, record } = await runWithStopMovedToNextLine(
    context,
    'moved-place',
  )
  const observation = service.state(record).observations[0]!

  // Act
  const inspection = await readResource(service, observation.inspectionUri)

  // Assert
  assert.ok('text' in inspection)
  const facts = JSON.parse(JSON.parse(inspection.text).content)
  assert.equal(
    facts.place,
    'src/theme.ts: this stop paused on line 2, column 1. You declared line 1 (configuration.source); the debugger bound the breakpoint on line 2. Name line 2 as the place of this pause in the interpretation, in the learning summary and in your answer to the learner.',
  )
  assert.equal(JSON.stringify(facts.declaredSource), '{"line":1,"column":1}')
  assert.equal(JSON.stringify(facts.requestedSource), '{"line":1,"column":1}')
  assert.equal(facts.source.line, 2)
  assert.equal('armed' in facts, false)
})

// Value: protects=the run resource, which an agent polls, naming the paused line of a moved stop as well; fails_when=only the inspection carries the sentence, so an agent that explains from the run resource's observation list never meets it; why_new=Cycle 0045 cause 1 (ER-5); seam=none
test('the run resource lists the observation of a moved stop with the sentence that names the line it paused on', async (context) => {
  // Arrange: the stop is declared at src/theme.ts 1:1 and the run committed it at 2:1.
  const { service, receipt } = await runWithStopMovedToNextLine(
    context,
    'moved-place-run-resource',
  )

  // Act
  const resource = await readResource(service, receipt.runUri)

  // Assert
  assert.ok('text' in resource)
  assert.equal(
    JSON.parse(resource.text).observations[0].place,
    'src/theme.ts: this stop paused on line 2, column 1. You declared line 1 (configuration.source); the debugger bound the breakpoint on line 2. Name line 2 as the place of this pause in the interpretation, in the learning summary and in your answer to the learner.',
  )
})

// A guard, green before Cycle 0045 as well (PC-3.11): the sentence must not appear where nothing moved to another line.
test('an observation that paused on its declared line carries no place sentence', async (context) => {
  // Arrange: one stop is committed where it was declared (1:1), a second one at another column of its declared line (1:7 to 1:9).
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'unmoved-place',
      configuration: {
        ...configuration,
        additionalStops: [
          {
            line: 1,
            column: 7,
            inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
          },
        ],
      },
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, action: 'repository-click', key: 'one' })
  const runtime = runtimes[0]!,
    firstStop = runtime.snapshots[0]!
  runtime.snapshots.push({
    ...firstStop,
    id: 'browser-session:2',
    pause: { ...firstStop.pause, generation: 2 },
    source: { ...firstStop.source, column: 9 },
  })
  const observations = service.state(record).observations

  // Act
  const onDeclaredPosition = await readResource(
      service,
      observations[0]!.inspectionUri,
    ),
    atAnotherColumn = await readResource(
      service,
      observations[1]!.inspectionUri,
    ),
    runResource = await readResource(service, receipt.runUri)

  // Assert
  assert.ok('text' in onDeclaredPosition)
  assert.ok('text' in atAnotherColumn)
  assert.ok('text' in runResource)
  assert.equal(
    'place' in JSON.parse(JSON.parse(onDeclaredPosition.text).content),
    false,
  )
  assert.equal(
    'place' in JSON.parse(JSON.parse(atAnotherColumn.text).content),
    false,
  )
  const listed = JSON.parse(runResource.text).observations
  assert.equal(listed.length, 2)
  assert.equal('place' in listed[0], false)
  assert.equal('place' in listed[1], false)
})

// Value: protects=the first saved interpretation of a moved stop naming the line the stop paused on, which part 5 of the validation contract judges; fails_when=an interpretation without the paused line's number is saved at once, as in both chat runs of the baseline round, or the refusal takes the key; why_new=Cycle 0045 cause 1 (ER-5); seam=none
test('an explanation of a moved stop that names no line is refused with the line it paused on and saved under the same key once it names it', async (context) => {
  // Arrange: the stop is declared at src/theme.ts 1:1 and the run committed it at 2:1.
  const { service, runtime, receipt, snapshotUri, sourceHash } =
    await runWithStopMovedToNextLine(context, 'moved-explain')
  const explanation = {
    ...receipt,
    key: 'explain-moved-stop',
    snapshotUri,
    sourceHash,
    valuePaths: ['value:nextTheme'],
  }

  // Act
  const refused = (): Promise<{ explanationUri: string }> =>
    service.explain({
      ...explanation,
      interpretation: 'The next theme is dark at this stop.',
    })
  assert.throws(refused, {
    code: 'INVALID_REFERENCE',
    message:
      'This stop paused on line 2 of src/theme.ts; you declared line 1. Name line 2 as the place of the pause in the interpretation and send codebook_explain again; the same key is free.',
  })
  const saved = await service.explain({
    ...explanation,
    interpretation: 'The stop paused on line 2, where the next theme is dark.',
  })
  const resource = await readResource(service, saved.explanationUri)

  // Assert
  assert.ok('text' in resource)
  const savedExplanation = JSON.parse(resource.text)
  assert.equal(
    savedExplanation.agentInterpretation,
    'The stop paused on line 2, where the next theme is dark.',
  )
  assert.equal(
    JSON.stringify(savedExplanation.boundPlace),
    '{"path":"src/theme.ts","declaredLine":1,"boundLine":2,"boundColumn":1}',
  )
  const entries = savedExplanationEntries(runtime)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].placeNamed, true)
})

// Value: protects=the check costing an agent at most one extra call; fails_when=a second interpretation without the line's number is refused again, so an agent that cannot produce the numeral never saves the stop; why_new=Cycle 0045 cause 1 (the decision on PC-1.8, PC-2.6, PC-3.3, PC-4.10, PC-5.7); seam=none
test('after one refusal the next explanation of that moved stop is saved although it names no line, and the journal records that the line was not named', async (context) => {
  // Arrange: the stop is declared at src/theme.ts 1:1 and the run committed it at 2:1.
  const { service, runtime, receipt, snapshotUri, sourceHash } =
    await runWithStopMovedToNextLine(context, 'moved-explain-twice')
  const explanation = {
    ...receipt,
    key: 'explain-moved-stop',
    snapshotUri,
    sourceHash,
    valuePaths: ['value:nextTheme'],
    interpretation: 'The next theme is dark at this stop.',
  }
  assert.throws(() => service.explain(explanation), {
    code: 'INVALID_REFERENCE',
  })

  // Act
  const saved = await service.explain(explanation)
  const resource = await readResource(service, saved.explanationUri)

  // Assert
  assert.ok('text' in resource)
  const savedExplanation = JSON.parse(resource.text)
  assert.equal(
    savedExplanation.agentInterpretation,
    'The next theme is dark at this stop.',
  )
  assert.equal(
    JSON.stringify(savedExplanation.boundPlace),
    '{"path":"src/theme.ts","declaredLine":1,"boundLine":2,"boundColumn":1}',
  )
  const entries = savedExplanationEntries(runtime)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].placeNamed, false)
})

// The documented limit of the guard (PC-1.8): it reads a number in prose and is no proof of the place. The place a learner reads is the structured boundPlace.
test('an interpretation that gives the declared line as the place and holds the paused line’s number as a value is saved at once', async (context) => {
  // Arrange: the stop is declared at src/theme.ts 1:1 and the run committed it at 2:1.
  const { service, runtime, receipt, snapshotUri, sourceHash } =
    await runWithStopMovedToNextLine(context, 'moved-explain-limit')

  // Act
  const saved = await service.explain({
    ...receipt,
    key: 'explain-with-wrong-place',
    snapshotUri,
    sourceHash,
    valuePaths: ['value:nextTheme'],
    interpretation: 'The stop paused on line 1 with the value 2.',
  })
  const resource = await readResource(service, saved.explanationUri)

  // Assert
  assert.ok('text' in resource)
  assert.equal(
    JSON.stringify(JSON.parse(resource.text).boundPlace),
    '{"path":"src/theme.ts","declaredLine":1,"boundLine":2,"boundColumn":1}',
  )
  assert.equal(savedExplanationEntries(runtime)[0].placeNamed, true)
})

// The other side of the same limit: a numeral the check cannot read costs one refusal and is then saved.
test('an interpretation that names the paused line only in words is refused once and then saved', async (context) => {
  // Arrange: the stop is declared at src/theme.ts 1:1 and the run committed it at 2:1.
  const { service, runtime, receipt, snapshotUri, sourceHash } =
    await runWithStopMovedToNextLine(context, 'moved-explain-words')
  const explanation = {
    ...receipt,
    key: 'explain-in-words',
    snapshotUri,
    sourceHash,
    valuePaths: ['value:nextTheme'],
    interpretation: 'The stop paused on line two, where the theme is dark.',
  }

  // Act
  const firstCall = (): Promise<{ explanationUri: string }> =>
    service.explain(explanation)
  assert.throws(firstCall, {
    code: 'INVALID_REFERENCE',
    message:
      'This stop paused on line 2 of src/theme.ts; you declared line 1. Name line 2 as the place of the pause in the interpretation and send codebook_explain again; the same key is free.',
  })
  const saved = await service.explain(explanation)

  // Assert
  assert.match(saved.explanationUri, /\/explanations\/[0-9a-f-]{36}$/)
  assert.equal(savedExplanationEntries(runtime)[0].placeNamed, false)
})

// Value: protects=the explanation the shipped skill asks for after the result, which is about the result and need not name the line again; fails_when=every explanation of a moved stop is checked, so that later one is refused; why_new=Cycle 0045 cause 1 (PC-2.6); seam=none
test('a second explanation of a moved stop that names no line is saved once a first one exists', async (context) => {
  // Arrange: the first explanation of the stop committed at 2:1 names line 2 and is saved.
  const { service, runtime, receipt, snapshotUri, sourceHash } =
    await runWithStopMovedToNextLine(context, 'moved-explain-later')
  await service.explain({
    ...receipt,
    key: 'explain-at-the-stop',
    snapshotUri,
    sourceHash,
    valuePaths: ['value:nextTheme'],
    interpretation: 'The stop paused on line 2, where the next theme is dark.',
  })

  // Act
  const later = await service.explain({
    ...receipt,
    key: 'explain-after-the-result',
    snapshotUri,
    sourceHash,
    valuePaths: ['value:nextTheme'],
    interpretation: 'After the click the label reads Dark.',
  })
  const resource = await readResource(service, later.explanationUri)

  // Assert
  assert.ok('text' in resource)
  assert.equal(
    JSON.stringify(JSON.parse(resource.text).boundPlace),
    '{"path":"src/theme.ts","declaredLine":1,"boundLine":2,"boundColumn":1}',
  )
  const entries = savedExplanationEntries(runtime)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].placeNamed, true)
  assert.equal('placeNamed' in entries[1], false)
})

// Value: protects=the check reading the paused line's number as a number of its own; fails_when=digits inside a longer number (12 or 20 for line 2) count as naming the line; why_new=Cycle 0045 cause 1 (ER-5: "not inside a longer number"); seam=none
test('an interpretation that holds the paused line’s number only inside a longer number is refused', async (context) => {
  // Arrange: the stop is declared at src/theme.ts 1:1 and the run committed it at 2:1.
  const { service, runtime, receipt, snapshotUri, sourceHash } =
    await runWithStopMovedToNextLine(context, 'moved-explain-longer-number')

  // Act
  const explained = (): Promise<{ explanationUri: string }> =>
    service.explain({
      ...receipt,
      key: 'explain-with-longer-numbers',
      snapshotUri,
      sourceHash,
      valuePaths: ['value:nextTheme'],
      interpretation: 'The value 12 arrives after 20 ms and the theme is dark.',
    })

  // Assert
  assert.throws(explained, {
    code: 'INVALID_REFERENCE',
    message:
      'This stop paused on line 2 of src/theme.ts; you declared line 1. Name line 2 as the place of the pause in the interpretation and send codebook_explain again; the same key is free.',
  })
  assert.equal(savedExplanationEntries(runtime).length, 0)
})

// Value: protects=an agent that answers in Japanese with full-width digits; fails_when=the check compares raw characters, so "２" is not read as 2 and the explanation is refused; why_new=Cycle 0045 cause 1 (ER-5: compared after NFKC normalisation); seam=none
test('an interpretation that names the paused line in full-width digits is saved at once', async (context) => {
  // Arrange: the stop is declared at src/theme.ts 1:1 and the run committed it at 2:1.
  const { service, runtime, receipt, snapshotUri, sourceHash } =
    await runWithStopMovedToNextLine(context, 'moved-explain-full-width')

  // Act
  const saved = await service.explain({
    ...receipt,
    key: 'explain-in-full-width-digits',
    snapshotUri,
    sourceHash,
    valuePaths: ['value:nextTheme'],
    interpretation: '２行目で停止しました。次のテーマは dark です。',
  })

  // Assert
  assert.match(saved.explanationUri, /\/explanations\/[0-9a-f-]{36}$/)
  assert.equal(savedExplanationEntries(runtime)[0].placeNamed, true)
})

// Value: protects=the help an agent reads before its first start naming the fields of the three places, the place sentence and the check, with the API and extension versions the constants hold; fails_when=the help still describes requestedSource only, or its entry repeats version numbers typed beside the constants; why_new=Cycle 0045 ER-8, ER-5 (4) and DX-19 (first clause); seam=none
test('configured help names the declared, the requested and the bound place, says that a moved stop’s inspection carries place and that its first interpretation must name the paused line, and takes its versions from the constants', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)

  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')

  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({ entry: z.string(), sequence: z.array(z.string()) })
    .parse(JSON.parse(help.text))
  assert.equal(
    contract.entry,
    'API 1.7, extension 0.2.0 or later. Read actual workspace source and publish an immutable source-only article first. Use its default repository/<bookId>/<nodeId> identity, exact revision, selected citation, path/hash and one-based source line/column. Leave learningItemId absent to preserve the article identity.',
  )
  assert.equal(
    (contract.sequence[2] ?? '').includes(
      " declaredSource is the position you declared (requestedSource is its older name), armed the place Codebook requested the breakpoint at when that differs, source where it bound and paused: cite source. A saved study's learning resource gives armed as {line} only, and only when the requested line differs from the declared line; a request moved to another column of the declared line is in the live inspection and the journal only. When the debugger bound a stop on another line than you declared, its inspection carries place, one sentence that names the line the stop paused on: name that line as the place of the pause in the interpretation, in the learning summary and in your answer to the learner. codebook_explain refuses the first interpretation of such a stop when it does not contain the paused line's number; send it again under the same key with the line named. ",
    ),
    true,
  )
})

// Value: protects=an editor chat that reads an observation's inspectionUri, its pages or its imageUri with the standard MCP resources/read; fails_when=those URIs answer "Resource … not found" and are readable only through codebook_read_resource; why_new=resource tests read these URIs through the service, never through MCP templates (Cycle 0044 rows N-5, N-13); seam=the synthetic runtime's snapshot capture
test('MCP resources/read returns an observation’s inspection, its pages and its snapshot image', async (context) => {
  // Arrange
  const { service, configuration, runtimes } =
      await configuredServiceHarness(context),
    endpoint = await startServer(service)
  context.after(() => endpoint.close())
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'mcp-evidence',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, action: 'repository-click', key: 'one' })
  const runtime = runtimes[0]!,
    snapshot = runtime.snapshots[0]!,
    image = Buffer.from('snapshot png fixture')
  await writeFile(join(runtime.evidence.directory, 'snapshot-1.png'), image)
  const view = runtime.view.bind(runtime)
  runtime.view = () => ({
    ...view(),
    snapshotCaptures: {
      [snapshot.id]: {
        status: 'captured',
        file: 'snapshot-1.png',
        renderer: { epoch: 'fixture', id: 1, hash: sha256(image) },
      },
    },
  })
  const observation = service.state(record).observations[0]!
  const client = new Client({ name: 'mcp-evidence-test', version: '1.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
      },
    }),
  )
  context.after(() => client.close())
  // Act
  const inspection = await client.readResource({
    uri: observation.inspectionUri,
  })
  const inspectionPage = z
    .object({ contentHash: z.string(), content: z.string() })
    .parse(
      JSON.parse(
        z.object({ text: z.string() }).parse(inspection.contents[0]).text,
      ),
    )
  const firstPage = await client.readResource({
    uri: `${observation.inspectionUri}/pages/${inspectionPage.contentHash}/0`,
  })
  const snapshotImage = await client.readResource({
    uri: observation.imageUri!,
  })
  // Assert
  assert.equal(
    JSON.stringify(JSON.parse(inspectionPage.content).requestedSource),
    '{"line":1,"column":1}',
  )
  assert.equal(
    z
      .object({ content: z.string() })
      .parse(
        JSON.parse(
          z.object({ text: z.string() }).parse(firstPage.contents[0]).text,
        ),
      ).content,
    inspectionPage.content,
  )
  assert.deepEqual(
    z
      .object({ mimeType: z.string(), blob: z.string() })
      .parse(snapshotImage.contents[0]),
    {
      mimeType: 'image/png',
      blob: Buffer.from('snapshot png fixture').toString('base64'),
    },
  )
})

// Value: protects=an MCP client that lists resource templates reading what an inspection holds since API 1.6; fails_when=the template still describes the bound position beside requestedSource only; why_new=Cycle 0045 ER-8 (protocol.ts:418); seam=none
test('the inspection resource template says that an inspection names the declared place, the requested place when it differs and the place sentence of a moved stop', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context),
    endpoint = await startServer(service)
  context.after(() => endpoint.close())
  const client = new Client({ name: 'mcp-templates-test', version: '1.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
      },
    }),
  )
  context.after(() => client.close())

  // Act
  const templates = await client.listResourceTemplates()

  // Assert
  assert.equal(
    templates.resourceTemplates.find(
      (template) => template.name === 'inspection',
    )?.description,
    "An observation's inspectionUri: the bound source position beside declaredSource (requestedSource is its older name), armed when the breakpoint was requested elsewhere, place for a stop bound on another line than declared, and the captured values, as a bounded JSON page with nextUri.",
  )
})

/**
 * Connects a real MCP SDK client to a service's endpoint, so a test sends a tool call through the tool's input schema as an editor chat does.
 * @param context - The test, whose end closes the client and the endpoint.
 * @param service - The harness's service.
 * @returns The connected client.
 * @example const client = await connectMcpClient(context, service)
 */
const connectMcpClient = async (
  context: TestContext,
  service: Parameters<typeof startServer>[0],
) => {
  const endpoint = await startServer(service)
  context.after(() => endpoint.close())
  const client = new Client({ name: 'configured-tool-test', version: '1.0' })
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

// Value: protects=an agent that names a captured fact by its path alone having its explanation saved; fails_when=codebook_explain answers "Use a declared value:<path> or type:<path> inspection. at valuePaths[0]", as it did in the VS Code run of the baseline round; why_new=Cycle 0045 cause 2 (ER-6; the amendment's title names "email", the fixture's captured fact is value:nextTheme); seam=none
test('codebook_explain accepts nextTheme for the captured fact value:nextTheme and saves it under that key', async (context) => {
  // Arrange: one stop is committed with the captured fact value:nextTheme and no fact type:nextTheme.
  const { service, configuration, runtimes } =
      await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'bare-path',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, action: 'repository-click', key: 'one' })
  const explanation = {
    instanceId: receipt.instanceId,
    runId: receipt.runId,
    key: 'explain-bare-path',
    snapshotUri: service.state(record).observations[0]!.snapshotUri,
    sourceHash: configuration.source.hash,
    interpretation: 'The next theme is dark.',
  }

  // Act
  const explained = await client.callTool({
      name: 'codebook_explain',
      arguments: { ...explanation, valuePaths: ['nextTheme'] },
    }),
    repeatedWithPrefix = await client.callTool({
      name: 'codebook_explain',
      arguments: { ...explanation, valuePaths: ['value:nextTheme'] },
    })

  // Assert
  assert.equal(explained.isError, undefined, JSON.stringify(explained.content))
  const saved = z
    .object({
      data: z.object({
        explanationUri: z.string(),
        valuePaths: z.array(z.string()),
      }),
    })
    .parse(explained.structuredContent).data
  assert.deepEqual(saved.valuePaths, ['value:nextTheme'])
  const resource = await readResource(service, saved.explanationUri)
  assert.ok('text' in resource)
  assert.equal(
    JSON.stringify(JSON.parse(resource.text).capturedFacts),
    '[{"path":"value:nextTheme","value":"dark"}]',
  )
  const entries = savedExplanationEntries(runtimes[0]!)
  assert.equal(entries.length, 1)
  assert.equal(
    JSON.stringify(entries[0].rewrittenPaths),
    '[{"from":"nextTheme","to":"value:nextTheme"}]',
  )
  // The same key in the other spelling names the same content and replays the receipt.
  assert.deepEqual(
    repeatedWithPrefix.structuredContent,
    explained.structuredContent,
  )
})

// Value: protects=an agent that leaves out the prefix where it decides between two facts being told so; fails_when=a bare path that is the path of a value fact and of a type fact is saved under one of them by guess; why_new=Cycle 0045 cause 2 (ER-6); seam=the synthetic runtime's snapshot, which gains a second fact with the same path
test('a bare path that names a value and a type fact is refused with both keys', async (context) => {
  // Arrange: the committed stop captured value:nextTheme and type:nextTheme.
  const { service, configuration, runtimes } =
      await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'ambiguous-bare-path',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, action: 'repository-click', key: 'one' })
  const stop = runtimes[0]!.snapshots[0]!
  stop.values = { ...stop.values, 'type:nextTheme': 'string' }
  const explanation = {
    instanceId: receipt.instanceId,
    runId: receipt.runId,
    key: 'explain-ambiguous-path',
    snapshotUri: service.state(record).observations[0]!.snapshotUri,
    sourceHash: configuration.source.hash,
    interpretation: 'The next theme is a string.',
  }

  // Act
  const refused = await client.callTool({
      name: 'codebook_explain',
      arguments: { ...explanation, valuePaths: ['nextTheme'] },
    }),
    withPrefix = await client.callTool({
      name: 'codebook_explain',
      arguments: { ...explanation, valuePaths: ['type:nextTheme'] },
    })

  // Assert
  assert.equal(refused.isError, true)
  const error = z
    .object({ error: z.object({ code: z.string(), message: z.string() }) })
    .parse(refused.structuredContent).error
  assert.equal(error.code, 'INVALID_REFERENCE')
  assert.equal(
    error.message,
    'valuePaths[0] "nextTheme" is the path of two captured facts of this snapshot, value:nextTheme and type:nextTheme. Send the one you mean with its prefix; the same key is free.',
  )
  assert.equal(withPrefix.isError, undefined)
  assert.deepEqual(
    z
      .object({ data: z.object({ valuePaths: z.array(z.string()) }) })
      .parse(withPrefix.structuredContent).data.valuePaths,
    ['type:nextTheme'],
  )
})

// Value: protects=an agent that reads the tool's input schema directly before the call learning which spellings of a fact path are taken; fails_when=the schema of valuePaths carries no description, or one that asks for the prefix only; why_new=Cycle 0045 cause 2 (ER-6: the tool gets an input schema of its own); seam=none
test('the input schema of codebook_explain says that a fact path is taken with its prefix, or alone when one captured fact has it', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)

  // Act
  const tools = await client.listTools()

  // Assert
  const schema = z
    .object({
      properties: z.object({
        valuePaths: z.object({
          items: z.object({ description: z.string() }),
        }),
      }),
    })
    .parse(
      tools.tools.find((tool) => tool.name === 'codebook_explain')?.inputSchema,
    )
  assert.equal(
    schema.properties.valuePaths.items.description,
    'A captured fact key of this snapshot: value:<path> or type:<path>. The path alone is accepted when exactly one captured fact of the snapshot has that path, and the explanation is saved under that key.',
  )
})

/** Where a test's hand-moved service clock starts: the real time of the file's load, because the harness's source and book stores read the real clock for the preparation deadline. A test moves its own copy forward, so a bound of seconds passes without waiting for it. */
const CLOCK_START_MS = Date.now()

/**
 * Starts a run on the fixture with the service's clock in the test's hand, sends its click and returns the arguments the run resource gives for the first stop's continuation.
 * @param context - The test that owns the harness.
 * @param key - The start key of the run.
 * @param clock - Reads the test's clock, which the service uses for every deadline and bound.
 * @returns The service, the synthetic runtime, the run's receipt and record, and the first stop's continueArguments.
 * @example const { service, runtime, continueArguments } = await runPausedAtFirstStop(context, 'next', () => nowMs)
 */
const runPausedAtFirstStop = async (
  context: TestContext,
  key: string,
  clock: () => number,
) => {
  const { service, configuration, runtimes } = await configuredServiceHarness(
    context,
    clock,
  )
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key,
      configuration: {
        ...configuration,
        additionalStops: [
          {
            line: 1,
            column: 7,
            inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
          },
        ],
      },
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, action: 'repository-click', key: 'one' })
  const runtime = runtimes[0]!,
    continueArguments =
      service.state(record).participants.browser.continueArguments
  assert.ok(continueArguments)
  return { service, runtime, receipt, record, continueArguments }
}

/** Tells whether a pending answer is still waiting after three of the wait's turns (150 ms of real time). @example await isStillWaiting(continuing) // => true while the run shows no next state */
const isStillWaiting = (pending: Promise<unknown>): Promise<boolean> =>
  Promise.race([pending.then(() => false), delay(150).then(() => true)])

// Value: protects=an agent that copies continueArguments learning the next stop from the continuation's own answer; fails_when=the arguments carry no answer, the tool's schema refuses it, or the call answers accepted before the next pause is committed, so the agent polls the run resource after every continuation (8 of 24 reads in the VS Code run of the baseline round); why_new=Cycle 0045 cause 3 (ER-7); seam=the synthetic runtime, which commits its next stop when the test says so
test('a continuation sent with the arguments the run resource gave answers with the next committed observation and its inspectionUri, without a poll', async (context) => {
  // Arrange: a two-stop run is paused at its first stop.
  let nowMs = CLOCK_START_MS
  const { service, runtime, continueArguments } = await runPausedAtFirstStop(
      context,
      'answer-next-observation',
      () => nowMs,
    ),
    client = await connectMcpClient(context, service)
  nowMs += 1_000

  // Act
  const continuing = client.callTool({
    name: 'codebook_continue',
    arguments: continueArguments,
  })
  await waitUntil(
    () => runtime.status === 'running',
    'the continuation acknowledged',
    1_000,
  )
  const next = commitNextStop(runtime)
  const answered = await continuing

  // Assert
  assert.equal(continueArguments.answer, 'next')
  assert.equal(answered.isError, undefined, JSON.stringify(answered.content))
  const answer = z
    .object({
      data: z.object({
        accepted: z.boolean(),
        next: z.string(),
        state: z.object({
          runtimeState: z.string(),
          observations: z.array(
            z.object({ id: z.string(), inspectionUri: z.string() }),
          ),
          participants: z.object({
            browser: z.object({
              continueArguments: z.object({
                generation: z.number(),
                answer: z.string(),
              }),
            }),
          }),
        }),
      }),
    })
    .parse(answered.structuredContent).data
  assert.equal(answer.accepted, true)
  assert.equal(answer.next, 'observation')
  assert.equal(answer.state.runtimeState, 'paused-browser')
  assert.equal(answer.state.observations.length, 2)
  assert.equal(answer.state.observations[1]?.id, next.id)
  assert.equal(
    answer.state.observations[1]?.inspectionUri,
    `codebook://${service.instanceId}/runs/${continueArguments.runId}/snapshots/browser-session%3A2/inspection`,
  )
  assert.equal(
    JSON.stringify(answer.state.participants.browser.continueArguments),
    '{"generation":2,"answer":"next"}',
  )
})

// Value: protects=an agent learning the observed result from its last continuation; fails_when=the last continuation answers accepted only, so the agent polls for observed.afterVerified, or answers "stopped" because the service's own cleanup of the completed run came first; why_new=Cycle 0045 cause 3 (ER-7); seam=the synthetic runtime, which observes its result when the test says so
test('after the last stop a continuation sent with those arguments answers the observed result', async (context) => {
  // Arrange: a run is paused at its last stop.
  const nowMs = CLOCK_START_MS
  const { service, runtime, continueArguments } = await runPausedAtFirstStop(
    context,
    'answer-result',
    () => nowMs,
  )

  // Act
  const continuing = service.continueToNextState(continueArguments)
  await waitUntil(
    () => runtime.status === 'running',
    'the continuation acknowledged',
    1_000,
  )
  observeResult(runtime)
  // The maintenance turn that cleans a completed run up comes before the wait's next turn: that cleanup is no stop of the run.
  service.maintain()
  const answer = await continuing

  // Assert
  assert.ok('state' in answer)
  assert.equal(answer.accepted, true)
  assert.equal(answer.next, 'result')
  assert.equal(answer.state.runtimeState, 'completed')
  assert.equal(JSON.stringify(answer.state.observed), '{"afterVerified":true}')
})

// Value: protects=a caller that does not ask for the next state being answered as before; fails_when=every continuation waits, also the Study pane's Continue, which would then stay busy until the next pause; why_new=Cycle 0045 cause 3 (ER-7: without the argument nothing changes); seam=none
test('a continuation without the answer argument answers accepted at once', async (context) => {
  // Arrange: a run is paused at its first stop; the arguments are sent without their answer.
  const nowMs = CLOCK_START_MS
  const { service, runtime, receipt, continueArguments } =
    await runPausedAtFirstStop(context, 'answer-as-before', () => nowMs)
  const { answer: _answer, ...withoutAnswer } = continueArguments

  // Act
  const viaTool = await service.continueToNextState(withoutAnswer)

  // Assert
  assert.equal(
    JSON.stringify(viaTool),
    JSON.stringify({ accepted: true, runUri: receipt.runUri }),
  )
  assert.equal(runtime.status, 'running')
  assert.equal(runtime.snapshots.length, 1)
})

// The Study pane's Continue sends the run resource's arguments as they are: it must return at the acknowledgement.
test('the pane’s continuation with the run resource’s arguments answers at the acknowledgement, without waiting for the next state', async (context) => {
  // Arrange: a run is paused at its first stop.
  const nowMs = CLOCK_START_MS
  const { service, runtime, receipt, continueArguments } =
    await runPausedAtFirstStop(context, 'pane-continue', () => nowMs)

  // Act
  const acknowledged = await service.continue(continueArguments)

  // Assert
  assert.equal(
    JSON.stringify(acknowledged),
    JSON.stringify({ accepted: true, runUri: receipt.runUri }),
  )
  assert.equal(runtime.status, 'running')
})

// Value: protects=an agent reading why the run ended from the continuation's answer; fails_when=the wait ends only on a next pause or a result, so a run that fails is answered at the bound with accepted, as if it were still running; why_new=Cycle 0045 cause 3 (PC-2.7, PC-4.12, PC-5.8: the wait ends on every terminal state); seam=the synthetic runtime, which fails when the test says so
test('a run that fails while a continuation waits for its next state answers with the failure text, not with the bound', async (context) => {
  // Arrange: a run is paused at its first stop; the clock does not move during the wait.
  const nowMs = CLOCK_START_MS
  const { service, runtime, continueArguments } = await runPausedAtFirstStop(
    context,
    'answer-failure',
    () => nowMs,
  )

  // Act
  const continuing = service.continueToNextState(continueArguments)
  await waitUntil(
    () => runtime.status === 'running',
    'the continuation acknowledged',
    1_000,
  )
  runtime.failures.push(
    'Repository continuation reached no next declared pause: declared stop src/theme.ts:1 was not hit within 20 s of the preceding continuation',
  )
  runtime.status = 'failed'
  const answer = await continuing

  // Assert
  assert.ok('state' in answer)
  assert.equal(answer.next, 'failure')
  assert.equal(
    answer.state.error?.cause,
    'Repository continuation reached no next declared pause: declared stop src/theme.ts:1 was not hit within 20 s of the preceding continuation',
  )
  assert.equal(answer.state.finalOutcome, 'not-demonstrated')
})

// Value: protects=the answer of a continuation whose next stop was committed and then failed its inspection; fails_when=the committed snapshot alone ends the wait as an observation the agent tries to continue, or the failure is left for a later poll; why_new=Cycle 0045 cause 3 (PC-2.7: a failure directly after the next pause); seam=the synthetic runtime, which commits a snapshot without a pause and fails
test('a failure directly after the next pause was committed is in the continuation’s answer', async (context) => {
  // Arrange: a run is paused at its first stop.
  const nowMs = CLOCK_START_MS
  const { service, runtime, continueArguments } = await runPausedAtFirstStop(
    context,
    'answer-failure-after-commit',
    () => nowMs,
  )

  // Act: the next snapshot is committed, its required inspection fails and the run ends, as the coordinator does in one step.
  const continuing = service.continueToNextState(continueArguments)
  await waitUntil(
    () => runtime.status === 'running',
    'the continuation acknowledged',
    1_000,
  )
  const firstStop = runtime.snapshots[0]!
  runtime.snapshots.push({
    ...firstStop,
    id: 'browser-session:2',
    pause: { ...firstStop.pause, generation: 2 },
  })
  runtime.failures.push(
    'Required inspection value:nextTheme is unavailable; captured facts remain readable.',
  )
  runtime.status = 'failed'
  const answer = await continuing

  // Assert
  assert.ok('state' in answer)
  assert.equal(answer.next, 'failure')
  assert.equal(answer.state.observations.length, 2)
  assert.equal(
    answer.state.error?.cause,
    'Required inspection value:nextTheme is unavailable; captured facts remain readable.',
  )
  assert.equal(answer.state.participants.browser.continueArguments, undefined)
})

// Value: protects=a continuation that waits ending when the run is stopped from another call; fails_when=a cancelled run is none of "next pause, result, failure", so the request is held to its bound; why_new=Cycle 0045 cause 3 (PC-2.7: an explicit stop sets cancelled); seam=none
test('a run stopped by another call while a continuation waits answers at once with the stopped run', async (context) => {
  // Arrange: a run is paused at its first stop; the clock does not move during the wait.
  const nowMs = CLOCK_START_MS
  const { service, runtime, receipt, continueArguments } =
    await runPausedAtFirstStop(context, 'answer-stopped', () => nowMs)

  // Act
  const continuing = service.continueToNextState(continueArguments)
  await waitUntil(
    () => runtime.status === 'running',
    'the continuation acknowledged',
    1_000,
  )
  const stopping = service.stop(receipt)
  const answer = await continuing
  await stopping

  // Assert
  assert.ok('state' in answer)
  assert.equal(answer.next, 'stopped')
  assert.equal(['stopping', 'stopped'].includes(answer.state.state), true)
  assert.equal(answer.state.participants.browser.resumable, false)
})

// Value: protects=the answer of a continuation that waits when the run's whole-run deadline passes; fails_when=the wait runs past the run's own deadline, or ends there with accepted as if the run went on; why_new=Cycle 0045 cause 3 (PC-2.7: one bound that never passes the run's remaining deadline); seam=the service's clock, moved by the test, and its maintenance turn, switched off
test('a run whose whole-run deadline expires while a continuation waits answers with that end', async (context) => {
  // Arrange: a run is paused at its first stop, five seconds before its whole-run deadline. The maintenance turn is switched off, so only the continuation's own wait can apply the deadline.
  let nowMs = CLOCK_START_MS
  const { service, runtime, record, continueArguments } =
    await runPausedAtFirstStop(context, 'answer-deadline', () => nowMs)
  service.maintain = (): void => {}
  nowMs = record.deadlineAt - 5_000

  // Act
  const continuing = service.continueToNextState(continueArguments)
  await waitUntil(
    () => runtime.status === 'running',
    'the continuation acknowledged',
    1_000,
  )
  const waitingBeforeDeadline = await isStillWaiting(continuing)
  nowMs = record.deadlineAt
  const answer = await continuing

  // Assert
  assert.equal(waitingBeforeDeadline, true)
  assert.ok('state' in answer)
  assert.equal(answer.next, 'failure')
  assert.equal(
    answer.state.terminalReason,
    'Study wall deadline expired; history only.',
  )
})

// Value: protects=the cause an agent and the learner read for a run whose explanation was not committed and whose whole-run deadline passes before the maintenance turn released it: the run resource's terminalReason and error.message, and the reason the deadline journals as run.failed, name why the explanation's write failed; fails_when=they say only "Explanation was not committed." while the write's failure stays in error.cause alone; why_new=Cycle 0046 row 653 (StudyService.expireAtDeadline journals the run's error message); seam=the service's clock, moved by the test, its maintenance turn, switched off and then called once, runtime.evidence.save, made to reject, and runtime.fail (ConfiguredBrowserRun journals the reason it is given as run.failed, and only the first: its fail returns at once for a run that already failed). Since row 665 the explanation's failure fails the runtime itself, so the deadline's call comes second with the same reason
test('a run whose explanation was not committed and whose whole-run deadline then passes names the write failure in its terminal reason and in the reason it journals as run.failed', async (context) => {
  // Arrange: a run is paused at its first stop; the maintenance turn is switched off so that the deadline, not an earlier turn, ends the run.
  let nowMs = CLOCK_START_MS
  const { service, configuration, runtimes } = await configuredServiceHarness(
    context,
    () => nowMs,
  )
  const maintenanceTurn = service.maintain.bind(service)
  service.maintain = (): void => {}
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'deadline-after-uncommitted-explanation',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, action: 'repository-click', key: 'click' })
  const runtime = runtimes[0]!,
    failRuntime = runtime.fail.bind(runtime),
    journaledReasons: string[] = []
  runtime.fail = (reason): void => {
    journaledReasons.push(reason)
    failRuntime(reason)
  }
  runtime.evidence.save = async () => {
    throw new Error("EACCES: permission denied, open 'agent-explanation.json'")
  }
  const snapshotUri = service.state(record).participants.browser.snapshotUri!
  await assert.rejects(
    service.explain({
      ...receipt,
      key: 'explain',
      snapshotUri,
      sourceHash: configuration.source.hash,
      valuePaths: ['value:enabled'],
      interpretation: 'The actual captured flag is false.',
    }),
    { code: 'EVIDENCE_UNAVAILABLE' },
  )
  // The explanation's own failure fails the runtime first (row 665); what the deadline then gives runtime.fail is counted apart.
  const journaledByExplanation = journaledReasons.splice(0)
  nowMs = record.deadlineAt

  // Act
  maintenanceTurn()
  const resource = await readResource(service, receipt.runUri)

  // Assert
  assert.ok('text' in resource)
  const state = z
    .object({
      terminalReason: z.string(),
      error: z.object({
        code: z.string(),
        message: z.string(),
        cause: z.string(),
      }),
    })
    .parse(JSON.parse(resource.text))
  assert.deepEqual(
    {
      terminalReason: state.terminalReason,
      error: state.error,
      journaledByExplanation,
      journaledByDeadline: journaledReasons,
    },
    {
      terminalReason:
        "Explanation was not committed. Cause: EACCES: permission denied, open 'agent-explanation.json'",
      error: {
        code: 'EVIDENCE_UNAVAILABLE',
        message:
          "Explanation was not committed. Cause: EACCES: permission denied, open 'agent-explanation.json'",
        cause:
          "Error: EACCES: permission denied, open 'agent-explanation.json'",
      },
      journaledByExplanation: [
        "Explanation was not committed. Cause: EACCES: permission denied, open 'agent-explanation.json'",
      ],
      journaledByDeadline: [
        "Explanation was not committed. Cause: EACCES: permission denied, open 'agent-explanation.json'",
      ],
    },
  )
})

// Value: protects=the journal of a run that fails because its explanation could not be written: the runtime is failed with the run's error, so it journals run.failed with the write's failure as its cause and accepts no further control, as on every other failure path of a run; fails_when=the explanation's catch sets the run's error and rejects without failing the runtime, so the run ends at the next maintenance turn with no run.failed in its journal; why_new=Cycle 0046 row 665 (the 653 fork's finding 1); seam=runtime.evidence.save, made to reject, and runtime.fail (ConfiguredBrowserRun journals the reason it is given as run.failed, configuredBrowserRun.ts fail)
test('a run whose explanation cannot be written fails its runtime with the write failure, which the runtime journals as run.failed', async (context) => {
  // Arrange: a run is paused at its first stop and its explanation write is made to fail.
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'uncommitted-explanation',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, action: 'repository-click', key: 'click' })
  const runtime = runtimes[0]!,
    failRuntime = runtime.fail.bind(runtime),
    journaledReasons: string[] = []
  runtime.fail = (reason): void => {
    journaledReasons.push(reason)
    failRuntime(reason)
  }
  runtime.evidence.save = async () => {
    throw new Error('ENOSPC: no space left on device, write')
  }
  const snapshotUri = service.state(record).participants.browser.snapshotUri!

  // Act
  const refusal = await service
    .explain({
      ...receipt,
      key: 'explain',
      snapshotUri,
      sourceHash: configuration.source.hash,
      valuePaths: ['value:enabled'],
      interpretation: 'The actual captured flag is false.',
    })
    .then(
      () => undefined,
      (error: unknown) => (error instanceof StudyError ? error.code : error),
    )

  // Assert
  assert.deepEqual(
    { refusal, journaledReasons, runtimeStatus: runtime.view().status },
    {
      refusal: 'EVIDENCE_UNAVAILABLE',
      journaledReasons: [
        'Explanation was not committed. Cause: ENOSPC: no space left on device, write',
      ],
      runtimeStatus: 'failed',
    },
  )
})

// Value: protects=the journal and the outcome of a run whose explanation, accepted after the run stopped (a learning summary saved after the result), could not be written: the save's failure is journaled as explanation.failed, also past the refusal its own failed write leaves in the evidence, and the stopped run's state, terminal reason, error and final outcome stay as they were; fails_when=the explanation's catch sets the stopped run's error, which becomes its terminal reason and outcome, and leaves the journal without the cause, since a stopped ConfiguredBrowserRun's fail returns at once while it cleans up; why_new=Cycle 0046 row 699 (CodeRabbit's review of cc231f08..e6a3daeb); seam=service.stop, runtime.evidence.save, made to reject and set the evidence's failure as Evidence.save does, the run resource and runtime.evidence.events
test('an explanation of a stopped run that cannot be written journals explanation.failed with its cause and leaves the run’s outcome as it was', async (context) => {
  // Arrange: a run committed its stop and was stopped; its explanation write is made to fail as a full disk fails Evidence.save.
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'explanation-after-stop',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, action: 'repository-click', key: 'click' })
  const snapshotUri = service.state(record).participants.browser.snapshotUri!
  await service.stop(receipt)
  const runtime = runtimes[0]!
  runtime.evidence.save = async () => {
    runtime.evidence.failure ??= 'Error: ENOSPC: no space left on device, write'
    throw new Error('ENOSPC: no space left on device, write')
  }
  /** Reads what an agent reads of the run's end in its run resource. */
  const outcome = async () => {
    const resource = await readResource(service, receipt.runUri)
    assert.ok('text' in resource)
    const state = JSON.parse(resource.text)
    return {
      state: state.state,
      terminalReason: state.terminalReason,
      error: state.error,
      finalOutcome: state.finalOutcome,
    }
  }
  const before = await outcome()

  // Act
  const refusal = await service
    .explain({
      ...receipt,
      key: 'learning-summary-after-stop',
      snapshotUri,
      sourceHash: configuration.source.hash,
      valuePaths: ['value:enabled'],
      interpretation: 'The actual captured flag is false.',
    })
    .then(
      () => undefined,
      (error: unknown) =>
        error instanceof StudyError
          ? { code: error.code, message: error.message }
          : error,
    )

  // Assert
  assert.deepEqual(
    {
      refusal,
      lastJournaled: runtime.evidence.events
        .map(({ type, detail }) => ({
          type,
          detail,
        }))
        .at(-1),
      before,
      after: await outcome(),
    },
    {
      refusal: {
        code: 'EVIDENCE_UNAVAILABLE',
        message:
          'Explanation was not committed. Cause: ENOSPC: no space left on device, write',
      },
      lastJournaled: {
        type: 'explanation.failed',
        detail: {
          reason:
            'Explanation was not committed. Cause: ENOSPC: no space left on device, write',
        },
      },
      before: {
        state: 'stopped',
        terminalReason: undefined,
        error: undefined,
        finalOutcome: 'not-demonstrated',
      },
      after: {
        state: 'stopped',
        terminalReason: undefined,
        error: undefined,
        finalOutcome: 'not-demonstrated',
      },
    },
  )
})

// Value: protects=the result of a run that completed keeping its place when the whole-run deadline passes before the service released the run; fails_when=the continuation's wait applies the deadline to a completed run, answers failure and the run resource names the deadline as the run's end; why_new=Cycle 0045 local review (runtime-2 #3: the wait applied the deadline without the guard of the maintenance turn); seam=the service's clock, moved by the test, and its maintenance turn, switched off
test('a run that completes in the turn in which its whole-run deadline passes answers the continuation with its result', async (context) => {
  // Arrange: a run is paused at its first stop, five seconds before its whole-run deadline. The maintenance turn is switched off, so the completed run is not released before the wait looks at it.
  let nowMs = CLOCK_START_MS
  const { service, runtime, record, continueArguments } =
    await runPausedAtFirstStop(
      context,
      'answer-result-at-deadline',
      () => nowMs,
    )
  service.maintain = (): void => {}
  nowMs = record.deadlineAt - 5_000

  // Act: the runtime completes and the deadline passes before the wait's next look.
  const continuing = service.continueToNextState(continueArguments)
  await waitUntil(
    () => runtime.status === 'running',
    'the continuation acknowledged',
    1_000,
  )
  runtime.status = 'completed'
  nowMs = record.deadlineAt
  const answer = await continuing

  // Assert
  assert.ok('state' in answer)
  assert.equal(answer.next, 'result')
  assert.equal(answer.state.runtimeState, 'completed')
  assert.equal(answer.state.terminalReason, undefined)
  assert.equal(answer.state.error, undefined)
})

// Value: protects=the one bound of the wait: the run's active deadline plus two seconds, counted from the acknowledgement; fails_when=the wait has no end of its own, or ends before a run that fails at its 20-second deadline could say so; why_new=Cycle 0045 cause 3 (ER-7 with PC-2.7: at the bound the answer carries the latest state); seam=the service's clock, moved by the test
test('a continuation whose run shows no next state within 22 seconds of its acknowledgement answers accepted with the latest state and no next state', async (context) => {
  // Arrange: a run is paused at its first stop; after the continuation the synthetic runtime keeps running.
  let nowMs = CLOCK_START_MS
  const { service, runtime, receipt, continueArguments } =
    await runPausedAtFirstStop(context, 'answer-bound', () => nowMs)

  // Act
  const continuing = service.continueToNextState(continueArguments)
  await waitUntil(
    () => runtime.status === 'running',
    'the continuation acknowledged',
    1_000,
  )
  nowMs += 21_999
  const waitingBeforeBound = await isStillWaiting(continuing)
  nowMs += 1
  const answer = await continuing

  // Assert
  assert.equal(waitingBeforeBound, true)
  assert.ok('state' in answer)
  assert.equal(answer.accepted, true)
  assert.equal(answer.runUri, receipt.runUri)
  assert.equal('next' in answer, false)
  assert.equal(answer.state.runtimeState, 'running')
  assert.equal(answer.state.observations.length, 1)
})

// Value: protects=the whole call staying below an editor's request timeout when the runtime already took long to acknowledge the continuation; fails_when=the 22 second wait is added on top of a slow arming, so the call can pass a client's limit; why_new=Cycle 0045 cause 3 (the client-timeout rule: the whole call ends within 45 seconds of its start); seam=the synthetic runtime, whose acknowledgement takes 40 seconds of the test's clock
test('a continuation acknowledged 40 seconds after the call began waits only five more seconds for the next state', async (context) => {
  // Arrange: a run is paused at its first stop; arming the next stop and the acknowledgement take 40 seconds.
  let nowMs = CLOCK_START_MS
  const { service, runtime, continueArguments } = await runPausedAtFirstStop(
    context,
    'answer-call-budget',
    () => nowMs,
  )
  const acknowledge = runtime.continue.bind(runtime)
  runtime.continue = async (participant, pause): Promise<void> => {
    nowMs += 40_000
    await acknowledge(participant, pause)
  }

  // Act
  const continuing = service.continueToNextState(continueArguments)
  await waitUntil(
    () => runtime.status === 'running',
    'the continuation acknowledged',
    1_000,
  )
  nowMs += 4_999
  const waitingBeforeBudget = await isStillWaiting(continuing)
  nowMs += 1
  const answer = await continuing

  // Assert
  assert.equal(waitingBeforeBudget, true)
  assert.ok('state' in answer)
  assert.equal('next' in answer, false)
  assert.equal(answer.state.runtimeState, 'running')
})

// Value: protects=the service's other calls answering while a continuation waits; fails_when=the wait blocks the service, so the run resource cannot be read until the next pause; why_new=Cycle 0045 cause 3 (PC-2.7); seam=none
test('a continuation that waits for the next state does not hold other calls: the run resource is read meanwhile', async (context) => {
  // Arrange: a run is paused at its first stop.
  const nowMs = CLOCK_START_MS
  const { service, runtime, receipt, continueArguments } =
    await runPausedAtFirstStop(context, 'answer-not-blocking', () => nowMs)

  // Act
  const continuing = service.continueToNextState(continueArguments)
  await waitUntil(
    () => runtime.status === 'running',
    'the continuation acknowledged',
    1_000,
  )
  const readMeanwhile = await readResource(service, receipt.runUri)
  const waitingAfterRead = await isStillWaiting(continuing)
  commitNextStop(runtime)
  const answer = await continuing

  // Assert
  assert.ok('text' in readMeanwhile)
  assert.equal(JSON.parse(readMeanwhile.text).runtimeState, 'running')
  assert.equal(waitingAfterRead, true)
  assert.ok('state' in answer)
  assert.equal(answer.next, 'observation')
})

// Value: protects=a request its client gave up releasing the wait; fails_when=the wait keeps polling until its bound although nobody reads the answer; why_new=Cycle 0045 cause 3 (the task: a request that the client abandons releases its wait); seam=none
test('a continuation whose request is abandoned stops waiting at once', async (context) => {
  // Arrange: a run is paused at its first stop; the clock does not move, so only the abandoned request can end the wait.
  const nowMs = CLOCK_START_MS
  const { service, runtime, continueArguments } = await runPausedAtFirstStop(
      context,
      'answer-abandoned',
      () => nowMs,
    ),
    request = new AbortController()

  // Act
  const continuing = service.continueToNextState(
    continueArguments,
    request.signal,
  )
  await waitUntil(
    () => runtime.status === 'running',
    'the continuation acknowledged',
    1_000,
  )
  const waitingBeforeAbandon = await isStillWaiting(continuing)
  request.abort()
  const answer = await continuing

  // Assert
  assert.equal(waitingBeforeAbandon, true)
  assert.ok('state' in answer)
  assert.equal('next' in answer, false)
  assert.equal(answer.state.runtimeState, 'running')
})

// Value: protects=the help and the tool's own texts telling an agent that a continuation answers with the next state and when to poll; fails_when=the help still only says "After continuation, poll", or the tool's schema does not say what answer does; why_new=Cycle 0045 cause 3 (ER-7's help sentence); seam=none
test('configured help and the continue tool tell an agent that a continuation sent with continueArguments answers with the next state, and to poll when it answers accepted only', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)

  // Act
  const help = await readResource(
      service,
      'codebook://help/repository-browser',
    ),
    tools = await client.listTools()

  // Assert
  assert.ok('text' in help)
  const sequence = z
    .object({ sequence: z.array(z.string()) })
    .parse(JSON.parse(help.text)).sequence
  assert.equal(
    (sequence[4] ?? '').startsWith(
      "A continuation sent with the run resource's continueArguments answers with the next state: the next observation, the observed result or the failure. If it answers accepted only, poll. After continuation, poll for observed.afterVerified or explicit failure.",
    ),
    true,
  )
  const tool = tools.tools.find((tool) => tool.name === 'codebook_continue')
  assert.equal(
    tool?.description,
    'Continue only the current inspected pause. Copy all continueArguments from the run resource; with their answer "next" the call answers with the run\'s next state (the next observation, the observed result or the failure) in state, and next names which. An answer without next means the run has not shown its next state yet: poll the run resource. A stale/reserved/historical pause is rejected; read state before recovery.',
  )
  assert.equal(
    z
      .object({
        properties: z.object({
          answer: z.object({ const: z.string(), description: z.string() }),
        }),
        required: z.array(z.string()),
      })
      .parse(tool?.inputSchema).properties.answer.description,
    'Optional; the run resource\'s continueArguments carry it. With "next" the call answers when the run committed its next pause, observed its result or ended, and returns the run\'s state beside accepted; next names which. Without it the call answers as soon as the continuation is acknowledged.',
  )
})

/** The text of a tool result an MCP client received, as an agent reads it. @example toolText(await client.callTool({ name: 'codebook_start', arguments })) */
const toolText = (result: unknown): string =>
  z
    .object({ content: z.array(z.object({ text: z.string() })).min(1) })
    .parse(result).content[0]!.text

// Value: protects=an agent whose first stop declares an object by type only learning which stop is refused, what it declared and what to add; fails_when=the refusal is "At least one required value inspection is needed. at configuration.inspections", which the Cursor agent of the baseline round met twice in one start; why_new=Cycle 0045 cause 4 (DX-1 c, after PC-4.2 kept the rule); seam=none
test('a start whose first stop declares only type inspections is refused naming that stop, the inspections it declares and what to add', async (context) => {
  // Arrange: the first stop declares one inspection, of mode type.
  const { service, configuration, runtimes } =
      await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)

  // Act
  const refused = await client.callTool({
    name: 'codebook_start',
    arguments: {
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'type-only-first-stop',
      configuration: {
        ...configuration,
        inspections: [{ path: 'setTheme', mode: 'type', required: true }],
      },
    },
  })

  // Assert
  assert.equal(refused.isError, true)
  assert.equal(
    toolText(refused),
    'MCP error -32602: Input validation error: Invalid arguments for tool codebook_start: configuration.inspections: this stop declares only type inspections (type:setTheme). Add one required value inspection of a primitive the stop can read, for example a member of one of these objects; type inspections may stay beside it. at configuration.inspections',
  )
  assert.equal(service.records.size, 0)
  assert.equal(runtimes.length, 0)
})

// Value: protects=the refusal of a type-only later stop naming that stop's own configuration path and all its inspections; fails_when=a later stop is named by the first stop's path, or the list drops an inspection; why_new=Cycle 0045 cause 4 (the Cursor run's second refused stop was additionalStops[2]); seam=none
test('a start whose later stop declares only type inspections is refused naming that later stop and every inspection it declares', async (context) => {
  // Arrange: a cross-runtime configuration whose first stop is valid and whose later stop declares two inspections, both of mode type.
  const { service, configuration, runtimes } =
      await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)

  // Act
  const refused = await client.callTool({
    name: 'codebook_start',
    arguments: {
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'type-only-later-stop',
      configuration: {
        ...configuration,
        version: 2,
        participant: 'browser',
        additionalStops: [
          {
            participant: 'browser',
            source: { ...configuration.source, column: 7 },
            anchorIndex: 0,
            inspections: [
              { path: 'nextTheme', mode: 'type', required: true },
              { path: 'setTheme', mode: 'type', required: false },
            ],
          },
        ],
      },
    },
  })

  // Assert
  assert.equal(refused.isError, true)
  assert.equal(
    toolText(refused),
    'MCP error -32602: Input validation error: Invalid arguments for tool codebook_start: configuration.additionalStops[0].inspections: this stop declares only type inspections (type:nextTheme, type:setTheme). Add one required value inspection of a primitive the stop can read, for example a member of one of these objects; type inspections may stay beside it. at configuration.additionalStops[0].inspections',
  )
  assert.equal(service.records.size, 0)
  assert.equal(runtimes.length, 0)
})

// The other way to break the rule keeps its own sentence, with the stop's path: a value inspection is declared, but none is required.
test('a start whose stop declares a value inspection but requires none is refused with the sentence that one required value inspection is needed', async (context) => {
  // Arrange: the first stop declares one optional value inspection.
  const { service, configuration } = await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)

  // Act
  const refused = await client.callTool({
    name: 'codebook_start',
    arguments: {
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'no-required-inspection',
      configuration: {
        ...configuration,
        inspections: [{ path: 'nextTheme', mode: 'value', required: false }],
      },
    },
  })

  // Assert
  assert.equal(refused.isError, true)
  assert.equal(
    toolText(refused),
    'MCP error -32602: Input validation error: Invalid arguments for tool codebook_start: At least one required value inspection is needed. at configuration.inspections',
  )
})

// Value: protects=the Node test profile refusing a type-only stop with the same sentence; fails_when=the twin rule in the Node test configuration keeps the bare sentence; why_new=Cycle 0045 cause 4 (the twin at nodeTestConfigSchemas.ts); seam=none
test('a Node test start whose stop declares only type inspections is refused naming that stop and what to add', async (context) => {
  // Arrange: a Node test configuration whose one stop declares one inspection, of mode type.
  const { service, configuration } = await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)

  // Act
  const refused = await client.callTool({
    name: 'codebook_start',
    arguments: {
      instanceId: service.instanceId,
      profile: 'node-test',
      key: 'type-only-node-stop',
      configuration: {
        version: 1,
        adapter: 'vitest-node',
        book: configuration.book,
        testFile: 'src/theme.test.ts',
        testHash: 'a'.repeat(64),
        testTitles: ['theme', 'selects dark'],
        source: configuration.source,
        inspections: [{ path: 'nextTheme', mode: 'type', required: true }],
      },
    },
  })

  // Assert
  assert.equal(refused.isError, true)
  assert.equal(
    toolText(refused),
    'MCP error -32602: Input validation error: Invalid arguments for tool codebook_start: configuration.inspections: this stop declares only type inspections (type:nextTheme). Add one required value inspection of a primitive the stop can read, for example a member of one of these objects; type inspections may stay beside it. at configuration.inspections',
  )
})

// Value: protects=the rule standing where the agent reads last before it declares a run: the tool's input schema; fails_when=the schema of inspections carries no description (the Cursor agent read it directly before its refused start); why_new=Cycle 0045 cause 4 (DX-1 b); seam=none
test('the input schema of codebook_start states the inspection rule for the first stop and for later stops of both profiles', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)

  // Act
  const tools = await client.listTools()

  // Assert
  const variantSchema = z.object({
    properties: z.object({
      adapter: z.object({ const: z.string() }),
      version: z.object({ const: z.number() }),
      inspections: z.object({ description: z.string() }),
      additionalStops: z.object({
        items: z.object({
          properties: z.object({
            inspections: z.object({ description: z.string() }),
          }),
        }),
      }),
    }),
  })
  const [repositoryVariants, nodeTestVariant] = z
    .object({
      properties: z.object({
        configuration: z.object({
          anyOf: z.tuple([
            z.object({ anyOf: z.array(variantSchema) }),
            variantSchema,
          ]),
        }),
      }),
    })
    .parse(
      tools.tools.find((tool) => tool.name === 'codebook_start')?.inputSchema,
    ).properties.configuration.anyOf
  const described = [...repositoryVariants.anyOf, nodeTestVariant].map(
    (variant) => [
      `${variant.properties.adapter.const} ${variant.properties.version.const}`,
      variant.properties.inspections.description,
      variant.properties.additionalStops.items.properties.inspections
        .description,
    ],
  )
  const repositoryBrowserRule =
      "Every stop needs at least one inspection with mode \"value\" and required true, of a primitive the stop can read (for an object, one of its members); type inspections may be added beside it, and a stop cannot consist of type inspections only. A required value is read when the debugger pauses, before the stop's line runs, so a binding that the stop's own line declares has no value there; Codebook then requests the stop on the first line within the stop's citation that can pause after the statement that line begins, and names that line in the inspection's armed and place, so require a value that already exists before the stop's line when you want the state before that line runs; when no later line of the citation can pause, the statement does not end within the citation, Codebook does not recognize the declaration (it reads only the first const or let with an initializer on the stop's line, not a pattern over several lines or a second declarator), or the sealed map is too large to scan completely and the debugger cannot be asked where it can pause after the statement (a server stop whose module is not loaded before the input, or a debugger that lists no break locations), the stop stays on its line and its failure names the line to follow; when you know the statement spans several lines, declare the stop on a statement after it.",
    nodeTestRule =
      'Every stop needs at least one inspection with mode "value" and required true, of a primitive the stop can read (for an object, one of its members); type inspections may be added beside it, and a stop cannot consist of type inspections only. A required value is read when the debugger pauses, before the stop\'s line runs, so a binding that the stop\'s own line declares has no value there; require a value that already exists before that line, or declare the stop on a later line.'
  assert.deepEqual(described, [
    ['next-dev-webpack 1', repositoryBrowserRule, repositoryBrowserRule],
    ['next-dev-webpack 2', repositoryBrowserRule, repositoryBrowserRule],
    ['vitest-node 1', nodeTestRule, nodeTestRule],
  ])
})

// Value: protects=an agent learning, where it reads last before it declares a run, that a required value is read before the stop's line runs and, for a repository-browser stop, that Codebook then requests the stop on the next line that can pause; fails_when=the description of inspections does not say it, so an agent requires the binding the stop's own line declares and cannot tell why its stop paused a line later, or a node-test stop, which Codebook requests where it was declared, is said to move; why_new=Cycle 0045 cause 11 (DX-1 b), rewritten for N14d-15 (DX-1 a: the repository-browser profile now moves such a stop); seam=none
test("the input schema of codebook_start says that a required value is read before the stop's line runs and what Codebook and the agent do about a binding that line declares, for the first stop and for later stops of both profiles", async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)

  // Act
  const tools = await client.listTools()

  // Assert
  const variantSchema = z.object({
    properties: z.object({
      adapter: z.object({ const: z.string() }),
      version: z.object({ const: z.number() }),
      inspections: z.object({ description: z.string() }),
      additionalStops: z.object({
        items: z.object({
          properties: z.object({
            inspections: z.object({ description: z.string() }),
          }),
        }),
      }),
    }),
  })
  const [repositoryVariants, nodeTestVariant] = z
    .object({
      properties: z.object({
        configuration: z.object({
          anyOf: z.tuple([
            z.object({ anyOf: z.array(variantSchema) }),
            variantSchema,
          ]),
        }),
      }),
    })
    .parse(
      tools.tools.find((tool) => tool.name === 'codebook_start')?.inputSchema,
    ).properties.configuration.anyOf
  const movedSentence =
      "A required value is read when the debugger pauses, before the stop's line runs, so a binding that the stop's own line declares has no value there; Codebook then requests the stop on the first line within the stop's citation that can pause after the statement that line begins, and names that line in the inspection's armed and place, so require a value that already exists before the stop's line when you want the state before that line runs; when no later line of the citation can pause, the statement does not end within the citation, Codebook does not recognize the declaration (it reads only the first const or let with an initializer on the stop's line, not a pattern over several lines or a second declarator), or the sealed map is too large to scan completely and the debugger cannot be asked where it can pause after the statement (a server stop whose module is not loaded before the input, or a debugger that lists no break locations), the stop stays on its line and its failure names the line to follow; when you know the statement spans several lines, declare the stop on a statement after it.",
    declaredSentence =
      "A required value is read when the debugger pauses, before the stop's line runs, so a binding that the stop's own line declares has no value there; require a value that already exists before that line, or declare the stop on a later line."
  const saysIt = [...repositoryVariants.anyOf, nodeTestVariant].map(
    (variant) => [
      `${variant.properties.adapter.const} ${variant.properties.version.const}`,
      variant.properties.inspections.description.includes(movedSentence),
      variant.properties.additionalStops.items.properties.inspections.description.includes(
        movedSentence,
      ),
      variant.properties.inspections.description.includes(declaredSentence),
    ],
  )
  assert.deepEqual(saysIt, [
    ['next-dev-webpack 1', true, true, false],
    ['next-dev-webpack 2', true, true, false],
    ['vitest-node 1', false, false, true],
  ])
})

// Value: protects=the help an agent reads before its first start leading it to a primitive member for an object; fails_when=the help offers "declare type:<path>" as a way to capture an object, which the Cursor agent followed into a refused start; why_new=Cycle 0045 cause 4 (DX-1 b); seam=none
test('configured help says that every stop needs a required value inspection of a primitive and, for an object, to declare a primitive member with type beside it', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)

  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')

  // Assert
  assert.ok('text' in help)
  const inspections = z
    .object({ inspections: z.string() })
    .parse(JSON.parse(help.text)).inspections
  assert.equal(
    inspections.startsWith(
      'Declare unique value:<path> or type:<path> inspections; every stop needs at least one required value inspection of a primitive it can read, and a stop cannot consist of type inspections only. Paths contain one to four ASCII identifier segments',
    ),
    true,
  )
  assert.equal(
    inspections.includes(
      'A value that is an object or a function is captured as the marker {type:"object"} or {type:"function"} and the run goes on: objects are not bounded, so its members are not captured facts; for an object declare a primitive member such as value:credentials.email as the stop\'s required value inspection, add type:<path> beside it when the object\'s type is what you want to show, and read the members in the native debugger state of the observation.',
    ),
    true,
  )
  assert.doesNotMatch(inspections, /declare type:<path> or a primitive member/)
})

// Value: protects=the help an agent reads before its first start saying that a required value must already exist when the debugger pauses before the stop's line runs, and that Codebook requests a stop whose own line declares its binding on the next line that can pause; fails_when=the help's sentence on inspections does not say it; why_new=Cycle 0045 cause 11 (DX-1 b), rewritten for N14d-15 (DX-1 a); seam=none
test("configured help says that a binding the stop's own line declares has no value when the debugger pauses, so Codebook requests the stop on the first line after it that can pause", async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)

  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')

  // Assert
  assert.ok('text' in help)
  const inspections = z
    .object({ inspections: z.string() })
    .parse(JSON.parse(help.text)).inspections
  assert.equal(
    inspections.includes(
      "Required unavailable/unsafe/oversized inspections fail; optional unavailability remains explicit. A required value is read when the debugger pauses, before the stop's line runs, so a binding that the stop's own line declares has no value there; Codebook then requests the stop on the first line within the stop's citation that can pause after the statement that line begins, and names that line in the inspection's armed and place, so require a value that already exists before the stop's line when you want the state before that line runs; when no later line of the citation can pause, the statement does not end within the citation, Codebook does not recognize the declaration (it reads only the first const or let with an initializer on the stop's line, not a pattern over several lines or a second declarator), or the sealed map is too large to scan completely and the debugger cannot be asked where it can pause after the statement (a server stop whose module is not loaded before the input, or a debugger that lists no break locations), the stop stays on its line and its failure names the line to follow; when you know the statement spans several lines, declare the stop on a statement after it. DOM conditions use literals, never patterns, and all conditions must hold",
    ),
    true,
  )
})

// Value: protects=a reader of the extension README learning what the help says about a binding the stop's own line declares; fails_when=the README's inspection step does not say that Codebook requests such a stop on the next line that can pause; why_new=Cycle 0045 N14d-15 (DX-1 b); seam=none
test('the extension README says that Codebook requests a stop whose own line declares its required binding on the first line after it that can pause, as the help does', async () => {
  // Arrange
  const readme = await readFile(join(__dirname, '../../README.md'), 'utf8')

  // Act
  const saysIt = readme.includes(
    "A required value is read when the debugger pauses, before the stop's line runs, so a binding that the stop's own line declares has no value there; Codebook then requests the stop on the first line within the stop's citation that can pause after the statement that line begins, and names that line in the inspection's `armed` and `place`, so require a value that already exists before the stop's line when you want the state before that line runs; when no later line of the citation can pause, the statement does not end within the citation, Codebook does not recognize the declaration (it reads only the first const or let with an initializer on the stop's line, not a pattern over several lines or a second declarator), or the sealed map is too large to scan completely and the debugger cannot be asked where it can pause after the statement (a server stop whose module is not loaded before the input, or a debugger that lists no break locations), the stop stays on its line and its failure names the line to follow; when you know the statement spans several lines, declare the stop on a statement after it.",
  )

  // Assert
  assert.equal(saysIt, true)
})

// Value: protects=an agent that publishes an article under a book id an earlier question already took getting to a run on its own citations; fails_when=the conflict only says "read the current book", so the agent runs on the article it found, whose citations do not cover its stop (the Cursor run's second refused start); why_new=Cycle 0045 cause 5; seam=none
test('after a publish with expectedRevision 0 is refused for an existing article, the same document published with the current revision is the next revision, and a start on that revision is admitted', async (context) => {
  // Arrange: the library holds revision 1 of the book "interface"; the agent's own document cites the same sources.
  const { service, configuration, books, runtimes } =
      await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)
  const document = (await books.readDefinition('interface', 1)).revision
      .document,
    publication = {
      instanceId: service.instanceId,
      bookId: 'interface',
      document: { ...document, summary: 'The agent’s own article.' },
    }

  // Act
  const refused = await client.callTool({
    name: 'codebook_publish_book',
    arguments: { ...publication, key: 'create', expectedRevision: 0 },
  })
  const published = await client.callTool({
    name: 'codebook_publish_book',
    arguments: { ...publication, key: 'replace', expectedRevision: 1 },
  })
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'own-article',
      configuration: {
        ...configuration,
        book: { ...configuration.book, revision: 2 },
      },
    }),
    record = service.record(receipt)
  await record.preparation

  // Assert
  assert.equal(refused.isError, true)
  assert.deepEqual(
    z
      .object({
        error: z.object({
          code: z.string(),
          message: z.string(),
          recovery: z.string(),
        }),
      })
      .parse(refused.structuredContent).error,
    {
      code: 'BOOK_CONFLICT',
      message:
        "Book interface exists at revision 1. To replace it, publish the complete document again with expectedRevision 1; to keep it, publish under another book id. A run stops only on lines its article's node cites, so publish your own citations before you start.",
      recovery:
        'The message names what conflicts. For a revision conflict, publish the complete document with the current revision as expectedRevision to replace the book, or under another book id to keep it; read the latest revision when you build on its content or its learning identities. Reuse a key only with identical content and expectedRevision.',
    },
  )
  assert.equal(published.isError, undefined, JSON.stringify(published.content))
  assert.equal(
    z
      .object({ data: z.object({ revision: z.number() }) })
      .parse(published.structuredContent).data.revision,
    2,
  )
  assert.equal(record.error, undefined)
  assert.equal(record.prepared, true)
  assert.equal(runtimes.length, 1)
  assert.equal(service.state(record).nextActions[0], 'repository-click')
})

// Value: protects=an agent whose own document was refused and that then starts on its node id in an existing revision learning at once which nodes that revision has; fails_when=codebook_start accepts the run and it ends without a runtime saying only "configuration.book.nodeId does not exist in the exact selected revision." (the Cursor agent of N14-d, run 48e4a83d); why_new=Cycle 0045 N14d-16 (DX-1 c); seam=none
test('a start on a node id its selected revision does not have is refused in the answer of codebook_start, naming the revision’s nodes and the two ways on', async (context) => {
  // Arrange: revision 1 of the book "interface" has the one node "theme".
  const { service, configuration, runtimes } =
      await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)

  // Act
  const refused = await client.callTool({
    name: 'codebook_start',
    arguments: {
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'unpublished-node',
      configuration: {
        ...configuration,
        book: { ...configuration.book, nodeId: 'invalid-login-path' },
      },
    },
  })

  // Assert
  assert.equal(refused.isError, true)
  assert.deepEqual(
    z
      .object({
        error: z.object({ code: z.string(), message: z.string() }),
      })
      .parse(refused.structuredContent).error,
    {
      code: 'BOOK_UNAVAILABLE',
      message:
        'configuration.book.nodeId invalid-login-path does not exist in revision 1 of book interface, which has the node: theme. Use it, or publish your own document under its own book id and start on that revision.',
    },
  )
  assert.equal(service.records.size, 0)
  assert.equal(runtimes.length, 0)
})

// Value: protects=the codebook_start contract that a start on a revision the book lacks is refused in its own answer; fails_when=it is accepted and only its run fails, or the store's words are lost; why_new=no test starts on a missing revision; seam=none
test('a start on a revision its book does not have is refused in the answer of codebook_start with the store’s sentence, and no run begins', async (context) => {
  // Arrange: the book "interface" has revision 1 only.
  const { service, configuration, runtimes } =
      await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)

  // Act
  const refused = await client.callTool({
    name: 'codebook_start',
    arguments: {
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'unpublished-revision',
      configuration: {
        ...configuration,
        book: { ...configuration.book, revision: 7 },
      },
    },
  })

  // Assert
  assert.equal(refused.isError, true)
  assert.deepEqual(
    z
      .object({
        error: z.object({ code: z.string(), message: z.string() }),
      })
      .parse(refused.structuredContent).error,
    {
      code: 'BOOK_UNAVAILABLE',
      message:
        'Book interface revision 7 is unavailable; no other revision was selected.',
    },
  )
  assert.equal(service.records.size, 0)
  assert.equal(runtimes.length, 0)
})

// Value: protects=an agent whose start names a stored book the store cannot read learning it from the start's own answer, with the cause; fails_when=the answer is "The study operation failed." without the store's words, or the run is accepted and fails later; why_new=Cycle 0045 review of N14d-16 (LOW: which failures of the book read refuse a start); seam=none
test('a start on a stored book the store cannot read is refused in the answer of codebook_start with the store’s sentence and the read’s cause', async (context) => {
  // Arrange: the stored book "interface" is replaced by bytes that are not JSON.
  const { service, configuration, library, runtimes } =
      await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)
  await writeFile(
    join(library.directory, 'interface.book.v2.json'),
    '{ not json',
  )

  // Act
  const refused = await client.callTool({
    name: 'codebook_start',
    arguments: {
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'unreadable-book',
      configuration,
    },
  })

  // Assert
  const error = z
    .object({
      error: z.object({
        code: z.string(),
        message: z.string(),
        cause: z.string(),
      }),
    })
    .parse(refused.structuredContent).error
  assert.equal(refused.isError, true)
  assert.equal(error.code, 'BOOK_UNAVAILABLE')
  assert.equal(
    error.message,
    'Stored book interface is unavailable; no older revision was substituted.',
  )
  assert.equal(error.cause.startsWith('SyntaxError: '), true)
  assert.equal(service.records.size, 0)
  assert.equal(runtimes.length, 0)
})

// Value: protects=an agent that lost a start's answer recovering its original receipt with the identical start; fails_when=the start-time book check also runs for a repeated accepted key and refuses it; why_new=no test repeats a start through codebook_start; seam=none
test('repeating an accepted start through codebook_start answers its original receipt although its stored book can no longer be read', async (context) => {
  // Arrange: a start on the stored book "interface" is accepted, and the book's file is then replaced by bytes that are not JSON.
  const { service, configuration, library, runtimes } =
      await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)
  const startArguments = {
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'lost-answer',
    configuration,
  }
  const accepted = await client.callTool({
    name: 'codebook_start',
    arguments: startArguments,
  })
  await service.record(
    z.object({ data: receiptSchema }).parse(accepted.structuredContent).data,
  ).preparation
  await writeFile(
    join(library.directory, 'interface.book.v2.json'),
    '{ not json',
  )

  // Act
  const repeated = await client.callTool({
    name: 'codebook_start',
    arguments: startArguments,
  })

  // Assert
  assert.equal(repeated.isError, undefined, JSON.stringify(repeated.content))
  assert.deepEqual(repeated.structuredContent, accepted.structuredContent)
  assert.equal(service.records.size, 1)
  assert.equal(runtimes.length, 1)
})

// Value: protects=a start whose book read fails with an error that is not the store's own refusal keeping the run that names the cause; fails_when=the start answers "The study operation failed." and the cause is lost from the run; why_new=Cycle 0045 review of N14d-16 (LOW); seam=the harness's book store, whose read is replaced by one that fails with a plain error
test('a start whose book read fails with an error that is not the store’s refusal is accepted, and its run ends naming that cause', async (context) => {
  // Arrange
  const { service, configuration, books } =
    await configuredServiceHarness(context)
  books.readDefinition = async () => {
    throw new Error('disk read failed')
  }

  // Act
  const receipt = await service.startOnStoredBook({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'failing-read',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation

  // Assert
  assert.equal(record.error?.code, 'RUNTIME_FAILED')
  assert.equal(record.error?.describe().cause, 'Error: disk read failed')
})

// Value: protects=the source-only help agreeing with the conflict's own answer; fails_when=the help still says "Revision conflict: read the current book.", which is what the conflict used to say; why_new=Cycle 0045 cause 5; seam=none
test('repository help says that a revision conflict names the current revision and gives the two ways on', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)

  // Act
  const help = await readResource(service, 'codebook://help/repository')

  // Assert
  assert.ok('text' in help)
  assert.equal(
    z.object({ recovery: z.string() }).parse(JSON.parse(help.text)).recovery,
    'Source mismatch: reread the exact path and update citations explicitly. Revision conflict: the answer names the current revision; publish the complete document again with that expectedRevision to replace the book, or under another book id to keep it. Lost response: reuse identical key/input to recover the original receipt even after source changes. Missing history: discover saved studies in the library; never run application input as recovery.',
  )
})

/** A consistent learning summary for the fixture's one stop, which each test of a broken rule changes in one place. @example learningSummaryFor(snapshotUri, sourceHash).steps[0]?.id // 'select' */
const learningSummaryFor = (
  snapshotUri: string,
  sourceHash: string,
): LearningSummary => ({
  question: 'How does the selected theme reach the interface?',
  title: 'Theme selection',
  summary: 'The recorded stop holds the selected dark theme.',
  participants: [
    { id: 'control', label: 'Theme control' },
    { id: 'interface', label: 'Interface' },
  ],
  steps: [
    {
      id: 'select',
      from: 'control',
      to: 'interface',
      label: 'Selected theme',
      explanation: 'The stop records nextTheme as dark.',
      evidence: 'observed',
      reference: { snapshotUri, sourceHash },
    },
    {
      id: 'later',
      from: 'interface',
      to: 'interface',
      label: 'Later rendering',
      explanation: 'No later stop was captured.',
      evidence: 'unknown',
    },
  ],
})

// Value: protects=an agent whose learning summary breaks one rule learning which element breaks it and what that element needs; fails_when=all four rules answer one sentence at the path learningSummary ("Use unique participant/step IDs, declared participants and a verified reference for every observed or source-derived step."), after which the Cursor agent of the baseline round dropped the summary from every explanation; why_new=Cycle 0045 cause 6; seam=none
for (const [brokenRule, breakRule, expectedRefusal] of [
  [
    'whose source-derived step has no reference is refused naming that step and what it needs',
    (summary: LearningSummary): void => {
      summary.steps[0]!.evidence = 'source-derived'
      summary.steps[0]!.reference = undefined
    },
    'MCP error -32602: Input validation error: Invalid arguments for tool codebook_explain: learningSummary.steps[0] (select) is source-derived and has no reference. Give it the reference {snapshotUri, sourceHash} of a committed observation of this run, or label it unknown. at learningSummary.steps[0].reference',
  ],
  [
    'that uses a participant id twice is refused naming the second use',
    (summary: LearningSummary): void => {
      summary.participants.push({ id: 'control', label: 'Second control' })
    },
    'MCP error -32602: Input validation error: Invalid arguments for tool codebook_explain: learningSummary.participants[2].id "control" is used twice; participant ids are unique. at learningSummary.participants[2].id',
  ],
  [
    'that uses a step id twice is refused naming the second use',
    (summary: LearningSummary): void => {
      summary.steps[1]!.id = 'select'
    },
    'MCP error -32602: Input validation error: Invalid arguments for tool codebook_explain: learningSummary.steps[1].id "select" is used twice; step ids are unique. at learningSummary.steps[1].id',
  ],
  [
    'whose step names a participant that is not declared is refused naming that step and that participant',
    (summary: LearningSummary): void => {
      summary.steps[0]!.to = 'renderer'
    },
    'MCP error -32602: Input validation error: Invalid arguments for tool codebook_explain: learningSummary.steps[0] (select) names participant "renderer", which learningSummary.participants does not declare. at learningSummary.steps[0].to',
  ],
] as const)
  test(`a learning summary ${brokenRule}`, async (context) => {
    // Arrange: one stop is committed; the summary is consistent except for the one rule under test.
    const { service, configuration, runtimes } =
        await configuredServiceHarness(context),
      client = await connectMcpClient(context, service)
    const receipt = service.start({
        instanceId: service.instanceId,
        profile: 'repository-browser',
        key: 'summary-rule',
        configuration,
      }),
      record = service.record(receipt)
    await record.preparation
    service.action({ ...receipt, action: 'repository-click', key: 'one' })
    const snapshotUri = service.state(record).observations[0]!.snapshotUri,
      learningSummary = learningSummaryFor(
        snapshotUri,
        configuration.source.hash,
      )
    breakRule(learningSummary)

    // Act
    const refused = await client.callTool({
      name: 'codebook_explain',
      arguments: {
        instanceId: receipt.instanceId,
        runId: receipt.runId,
        key: 'explain-with-summary',
        snapshotUri,
        sourceHash: configuration.source.hash,
        valuePaths: ['value:nextTheme'],
        interpretation: 'The next theme is dark.',
        learningSummary,
      },
    })

    // Assert
    assert.equal(refused.isError, true)
    assert.equal(toolText(refused), expectedRefusal)
    assert.equal(savedExplanationEntries(runtimes[0]!).length, 0)
  })

// Value: protects=the Node test learning material answering a broken rule the same way, in its own reference kind; fails_when=the twin keeps one sentence for four rules; why_new=Cycle 0045 cause 6 (the twin at nodeTestHistorySchemas.ts); seam=none
test('Node test learning material whose observed step has no reference is refused naming that step and the references a Node history offers', async (context) => {
  // Arrange: learning material whose one step is observed and carries no reference.
  const { service } = await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)

  // Act
  const refused = await client.callTool({
    name: 'codebook_explain_node_history',
    arguments: {
      studyId:
        '11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222',
      expectedRevision: 0,
      content: {
        question: 'Which value does the test read?',
        title: 'Test value',
        summary: 'The test reads the selected theme.',
        participants: [{ id: 'test', label: 'Test' }],
        steps: [
          {
            id: 'read',
            from: 'test',
            to: 'test',
            label: 'Reads the theme',
            explanation: 'The stop holds the theme.',
            evidence: 'observed',
          },
        ],
      },
    },
  })

  // Assert
  assert.equal(refused.isError, true)
  assert.equal(
    toolText(refused),
    'MCP error -32602: Input validation error: Invalid arguments for tool codebook_explain_node_history: content.steps[0] (read) is observed and has no reference. Give it the reference of a stop, an output or the result of this history ({type, sequence}, with sourceHash for a stop and channel for an output), or label it unknown. at content.steps[0].reference',
  )
})

// Value: protects=an agent that reads the tool's input schema directly before it writes a summary learning when a step needs a reference; fails_when=the schema of reference carries no description (the Cursor agent read it and sent a source-derived step without one); why_new=Cycle 0045 cause 6 (DX-1 b); seam=none
test('the input schemas of codebook_explain and codebook_explain_node_history say when a step needs a reference and what it holds', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context),
    client = await connectMcpClient(context, service)

  // Act
  const tools = await client.listTools()

  // Assert
  const summarySchema = z.object({
    properties: z.object({
      steps: z.object({
        items: z.object({
          properties: z.object({
            reference: z.object({ description: z.string() }),
          }),
        }),
      }),
    }),
  })
  const referenceDescription = (
    toolName: string,
    summaryField: 'learningSummary' | 'content',
  ): string =>
    summarySchema.parse(
      z
        .object({ properties: z.record(z.string(), z.unknown()) })
        .parse(tools.tools.find((tool) => tool.name === toolName)?.inputSchema)
        .properties[summaryField],
    ).properties.steps.items.properties.reference.description
  assert.equal(
    referenceDescription('codebook_explain', 'learningSummary'),
    "Required for an observed or source-derived step: the snapshotUri and sourceHash of a committed observation of this run, or after the result the run's terminalReference; omit it only for an unknown step.",
  )
  assert.equal(
    referenceDescription('codebook_explain_node_history', 'content'),
    'Required for an observed or source-derived step: a stop, an output or the result of this history by its sequence number (a stop with its sourceHash, an output with its channel); omit it only for an unknown step.',
  )
})

// Value: protects=an agent that sends codebook_reveal and codebook_continue for the same stop together; fails_when=the reveal answers EVIDENCE_UNAVAILABLE ("Matching captured source is not displayed") because the continuation retired the pause the reader presents; why_new=reveal tests never ran beside a continuation (Cycle 0044 row N-13, native N12-a); seam=the synthetic runtime's reveal, which fails like the reader once the pause is gone
for (const order of ['reveal first', 'continue first'] as const)
  test(`a reveal and a continuation of the same stop issued together, ${order}, never answer an evidence failure`, async (context) => {
    // Arrange
    const { service, configuration, runtimes } =
      await configuredServiceHarness(context)
    const receipt = service.start({
        instanceId: service.instanceId,
        profile: 'repository-browser',
        key: `together-${order}`,
        configuration,
      }),
      record = service.record(receipt)
    await record.preparation
    service.action({ ...receipt, action: 'repository-click', key: 'one' })
    const runtime = runtimes[0]!,
      browser = service.state(record).participants.browser,
      snapshotUri = browser.snapshotUri!
    let release!: () => void,
      entered = false
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    // The reader presents a source only while its snapshot is the live pause.
    runtime.reveal = async (): Promise<void> => {
      entered = true
      await barrier
      if (runtime.gate.phase !== 'paused')
        throw new StudyError(
          'EVIDENCE_UNAVAILABLE',
          'Matching captured source is not displayed. Inspect the reader error and retry explicitly.',
        )
    }
    // Act
    if (order === 'reveal first') {
      const revealing = service.reveal({ ...receipt, snapshotUri })
      await waitUntil(() => entered, 'source reveal started', 1_000)
      const continuing = service.continue(browser.continueArguments!)
      await Promise.resolve()
      const statusWhileRevealing = runtime.status
      release()
      const revealed = await revealing,
        continued = await continuing
      // Assert: the continuation waited for the accepted reveal, then resumed.
      assert.equal(statusWhileRevealing, 'paused-browser')
      assert.equal(revealed.revealed, true)
      assert.equal(continued.accepted, true)
      assert.equal(runtime.status, 'running')
    } else {
      release()
      let resume!: () => void
      const resumeBarrier = new Promise<void>((resolve) => {
        resume = resolve
      })
      // The continuation reserves the pause at once and resumes it only after its own checks, as the native coordinator does while it arms the next stop.
      runtime.continue = async (_participant, pause): Promise<void> => {
        if (!runtime.gate.reserve(pause))
          throw new Error('conflict: stale or foreign pause')
        await resumeBarrier
        runtime.gate.invalidate()
        runtime.status = 'running'
      }
      const continuing = service.continue(browser.continueArguments!)
      await waitUntil(
        () => runtime.gate.phase === 'resume-requested',
        'the continuation reserved the pause',
        1_000,
      )
      // Cycle 0045 (X7-E3.1): the reveal is sent while the continuation is in flight; before, this case awaited the whole continuation first, so no reveal met a pause that is reserved and not yet resumed.
      const revealedWhileContinuing = await service
        .reveal({ ...receipt, snapshotUri })
        .then(
          () => 'revealed',
          (error: unknown) =>
            error instanceof StudyError
              ? `${error.code}: ${error.message}`
              : String(error),
        )
      const phaseAfterReveal = runtime.gate.phase
      resume()
      const continued = await continuing
      // Assert: the reveal names the retired pause and the remedy, while the continuation is in flight and after it, and the reader is never asked.
      assert.equal(
        revealedWhileContinuing,
        'STALE_PAUSE: Reveal shows only the current pause, and this snapshot is no longer it: its continuation was accepted or the debugger moved on. Reveal a stop before continuing it; its captured source stays readable at sourceUri.',
      )
      assert.equal(phaseAfterReveal, 'resume-requested')
      await assert.rejects(service.reveal({ ...receipt, snapshotUri }), {
        code: 'STALE_PAUSE',
        message:
          'Reveal shows only the current pause, and this snapshot is no longer it: its continuation was accepted or the debugger moved on. Reveal a stop before continuing it; its captured source stays readable at sourceUri.',
      })
      assert.equal(continued.accepted, true)
      assert.equal(entered, false)
    }
  })

test('a reveal whose pause the learner resumes in the debugger meanwhile answers STALE_PAUSE instead of an evidence failure', async (context) => {
  // Arrange
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
      instanceId: service.instanceId,
      profile: 'repository-browser',
      key: 'manual-resume',
      configuration,
    }),
    record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, action: 'repository-click', key: 'one' })
  const runtime = runtimes[0]!,
    snapshotUri = service.state(record).participants.browser.snapshotUri!
  runtime.reveal = async (): Promise<void> => {
    // The learner presses Continue in the native debugger while the source is being presented.
    runtime.gate.invalidate(true)
    throw new StudyError(
      'EVIDENCE_UNAVAILABLE',
      'Matching captured source is not displayed. Inspect the reader error and retry explicitly.',
    )
  }
  // Act / Assert
  await assert.rejects(service.reveal({ ...receipt, snapshotUri }), {
    code: 'STALE_PAUSE',
    causeDetail:
      'Error: Matching captured source is not displayed. Inspect the reader error and retry explicitly.',
  })
})

test('API 1.7 discovery exposes the bounded configured profile and its executable configuration schema without starting input', async (context) => {
  // Arrange
  const { service, runtimes } = await configuredServiceHarness(context)
  // Act
  const status = await service.status(),
    profile = status.profiles.find(
      (profile) => profile.id === 'repository-browser',
    ),
    help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.equal(status.apiVersion, '1.7')
  assert.ok(profile && 'requiresConfiguration' in profile)
  assert.equal(profile.requiresConfiguration, true)
  assert.equal(profile.minimumExtensionVersion, '0.2.0')
  assert.equal(profile.helpUri, 'codebook://help/repository-browser')
  assert.equal(profile.limits.runTimeoutMs, 600000)
  assert.equal(profile.limits.pauseHoldTimeoutMs, 300000)
  assert.deepEqual(JSON.parse(JSON.stringify(profile.limits)).sourceBytes, {
    typescript: 262144,
    javascript: 8388608,
    map: 16777216,
  })
  assert.deepEqual(profile.items, [])
  assert.deepEqual(profile.requiredLinks, [])
  assert.equal(profile.actions[0]?.id, 'repository-click')
  assert.ok('text' in help)
  assert.match(
    help.text,
    /checks action\.before on the fresh managed page before applying optional initialInputs/,
  )
  assert.match(
    help.text,
    /Do not require an initialInputs value in action\.before/,
  )
  const contract = z
    .object({
      configurationSchema: z.object({
        anyOf: z.array(
          z.object({
            type: z.literal('object'),
            additionalProperties: z.literal(false),
            required: z.array(z.string()),
            properties: z.record(z.string(), z.unknown()),
          }),
        ),
      }),
      sequence: z.array(z.string()),
      recovery: z.string(),
    })
    .parse(JSON.parse(help.text))
  assert.deepEqual(profile.configurationVersions, [1, 2])
  assert.deepEqual(
    contract.configurationSchema.anyOf.map((variant) => variant.required),
    [
      ['version', 'adapter', 'book', 'source', 'action', 'inspections'],
      [
        'version',
        'adapter',
        'book',
        'source',
        'action',
        'inspections',
        'participant',
      ],
    ],
  )
  assert.match(contract.sequence.join('\n'), /afterVerified/)
  assert.match(contract.sequence.join('\n'), /saved studyId/)
  assert.equal(service.records.size, 0)
  assert.equal(runtimes.length, 0)
})

// Value: protects=an agent learns that the start a full library refused is the one to repeat after the learner made room; fails_when=the help still only says to reuse a key on response loss, so the agent invents a new key or gives up; why_new=repeating a refused start used to replay the refusal; seam=none
test('configured help tells an agent that a start the library refused can be repeated with the same key and begins a new run, and that a start on a revision or node id the book lacks is refused in its own answer', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({ sequence: z.array(z.string()) })
    .parse(JSON.parse(help.text))
  assert.equal(
    contract.sequence[0],
    "codebook_start with profile repository-browser, full configuration and a stable key returns immediately. Reuse the complete identical input on response loss; never retry input with a new key. A start the library refused can be repeated with the same key after room was made; it begins a new run. A start on a revision or a node id the book does not have is refused in its own answer with BOOK_UNAVAILABLE, which names the revision's node ids; every other preparation failure is read from the run resource.",
  )
})
