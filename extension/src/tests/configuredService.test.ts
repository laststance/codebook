import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'

import { readResource } from '../resources'
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
  runtimes[0]!.failInRuntime(
    'Selected server resumed outside its owned continuation',
  )
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
  runtimes[0]!.failInRuntime(longFailure)
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

test('configured help tells an agent that only the next stop is armed and that a stop binds anywhere on its declared line', async (context) => {
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
    /The line is the declaration and the column is a request: Codebook accepts the debugger's verified binding anywhere on the declared line in the sealed executed module/,
  )
  assert.match(
    contract.sourceBinding,
    /Each observation's inspection resource reports it as source \{line,column\} beside requestedSource \{line,column\}; cite source\./,
  )
  assert.match(
    contract.sourceBinding,
    /When the debugger cannot pause on the declared line it binds the first place after it\. Codebook accepts that binding when it lies on a later line within the stop's citation and no line between the two has a mapped position, and uses it like a moved column: the inspection's source names the bound line, so cite and explain source\. Let the citation cover every line of the statement the stop is in, so that a moved binding stays inside it\. A moved binding can lie in a branch the action skips; the stop then fails at the 20 second deadline, whose text names the bound place\. Any other binding on another line fails at once; declare the bound place instead, in a citation that covers it\./,
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

test('API 1.5 discovery exposes the bounded configured profile and its executable configuration schema without starting input', async (context) => {
  // Arrange
  const { service, runtimes } = await configuredServiceHarness(context)
  // Act
  const status = await service.status(),
    profile = status.profiles.find(
      (profile) => profile.id === 'repository-browser',
    ),
    help = await readResource(service, 'codebook://help/repository-browser')
  // Assert
  assert.equal(status.apiVersion, '1.5')
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
