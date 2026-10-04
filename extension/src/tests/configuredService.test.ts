import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'

import { ACTIVE_TIMEOUT_MS } from '../constants'
import { StudyError } from '../errors'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { actionSchema } from '../schemas'
import { startServer } from '../server'

import { configuredServiceHarness } from './utils/configuredServiceHarness'

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
    /Any other binding on another line fails, naming the condition that refused it: a browser stop at once while it is armed, a server stop when the adapter acknowledges it on that line or, while its registration is pending, only at its pause, about 3 seconds after it, and never when that line does not run \(the stop then ends at the 20 second deadline\); declare the bound place instead, in a citation that covers it\. Two declared stops that bind on one place fail when the second binds; declare that place once\./,
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
      "The binding rule is counted from the line the breakpoint is requested on: the declared line, or the first mapped line after a declared line without a mapped position. When the debugger cannot pause on the requested line it binds the first place after it. Codebook accepts that binding when it lies on a later line within the stop's citation and no line between the requested line and the bound line has a mapped position (a comment the generated module kept is not one), and uses it like a moved column: the inspection's source names the bound line, so cite and explain source. Let the citation cover every line of the statement the stop is in, so that a moved binding stays inside it.",
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

// Cycle 0045 (SM-17): red while the README kept the rule counted from the declared line and said nothing about the second request.
test('the extension README states the binding rule from the requested line, as the help does', async () => {
  // Arrange
  const readme = await readFile(join(__dirname, '../../README.md'), 'utf8')
  // Act
  const statesRule = readme.includes(
      "The binding rule is counted from the line the breakpoint is requested on: the declared line, or the first mapped line after a declared line without a mapped position. When the debugger cannot pause on the requested line it binds the first place after it. Codebook accepts that binding when it lies on a later line within the stop's citation and no line between the requested line and the bound line has a mapped position (a comment the generated module kept is not one), and uses it like a moved column: `source` names the bound line.",
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
      `the stop then fails at the ${deadlineSeconds} second deadline`,
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
    (help.text.match(new RegExp(`${deadlineSeconds} second`, 'g')) ?? [])
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
      'Any other binding on another line fails, naming the condition that refused it: a browser stop at once while it is armed, a server stop when the adapter acknowledges it on that line or, while its registration is pending, only at its pause, about 3 seconds after it, and never when that line does not run (the stop then ends at the 20 second deadline); declare the bound place instead, in a citation that covers it.',
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
test('configured help tells an agent that a run waits for the debugger’s own pauses, how a deadline names a paused place, and which journal entries record pauses', async (context) => {
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
      'A run does not complete while a pause the debugger made for itself is still open; if it stays open, the run fails at its 20 second deadline. A deadline that expires while a participant is paused with no announced stop adds where, for example "The server is paused at auth.ts:18 without a debugger stop." The place is <repository path>:<line> in a declared stop\'s module, <script URL> <line>:<column> in another announced script, "an unknown script <line>:<column>" in one never announced, and "an unknown place" for an empty stack. The journal records every pause as cdp.pause-observed (url, line, column, functionName, hitBreakpoints, stopIndex, continuation receipts) and every resume as cdp.resumed or cdp.adapter-pause-retired with pausedForMs.',
    ),
    true,
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

test('configured help tells an agent that a continuation whose next stop cannot be armed answers "Continue was not confirmed." and where the run’s reason is read', async (context) => {
  // Arrange
  const { service } = await configuredServiceHarness(context)
  // Act
  const help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.ok('text' in help)
  const contract = z
    .object({ additionalStops: z.string() })
    .parse(JSON.parse(help.text))
  assert.match(
    contract.additionalStops,
    /If a later stop cannot be armed, that codebook_continue answers 'Continue was not confirmed\.' with the arming error as its cause and sends no resume; the run ends with the reason 'Next declared stop was not armed and no resume was sent' \(read the run resource\), and earlier observations stay\./,
  )
  // The tool never answered with the run's terminal reason; the help no longer says it does.
  assert.doesNotMatch(
    contract.additionalStops,
    /that codebook_continue fails with 'Next declared stop was not armed/,
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
    'API 1.6, extension 0.2.0 or later. Read actual workspace source and publish an immutable source-only article first. Use its default repository/<bookId>/<nodeId> identity, exact revision, selected citation, path/hash and one-based source line/column. Leave learningItemId absent to preserve the article identity.',
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
      const continued = await service.continue(browser.continueArguments!)
      // Assert: the reveal names the retired pause and the remedy, and the reader is never asked.
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

test('API 1.6 discovery exposes the bounded configured profile and its executable configuration schema without starting input', async (context) => {
  // Arrange
  const { service, runtimes } = await configuredServiceHarness(context)
  // Act
  const status = await service.status(),
    profile = status.profiles.find(
      (profile) => profile.id === 'repository-browser',
    ),
    help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.equal(status.apiVersion, '1.6')
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
test('configured help tells an agent that a start the library refused can be repeated with the same key and begins a new run', async (context) => {
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
    'codebook_start with profile repository-browser, full configuration and a stable key returns immediately. Reuse the complete identical input on response loss; never retry input with a new key. A start the library refused can be repeated with the same key after room was made; it begins a new run.',
  )
})
