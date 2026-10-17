import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { NODE_TEST_PROFILE } from '../constants'
import { StudyError } from '../errors'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import type { NodeTestSourceStop } from '../ownedNodeTestRun'
import { readResource } from '../resources'
import type { NodeTestRuntime } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { assertConfiguredSourceDocuments } from '../utils/assertConfiguredSourceDocuments'

import { createHarness } from './helpers'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

test('public Node test start exposes cited ordered pauses, actual result, and the recording limitation', async () => {
  // Arrange
  const harness = await createHarness(),
    { service } = harness
  service.nodeHistoryStore = new NodeTestHistoryStore(
    join(harness.directory, '.learning'),
    '0'.repeat(64),
  )
  service.environment.build.sourceHash = 'f'.repeat(64)
  const base = harness.configuration
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: base.book,
    testFile: 'src/theme.test.ts',
    testTitles: ['theme', 'selects the dark theme'],
    testHash: 'a'.repeat(64),
    source: base.source,
    inspections: base.inspections.slice(0, 1),
    additionalStops: [
      {
        ...base.source,
        anchorIndex: 0,
        inspections: base.inspections.slice(0, 1),
      },
    ],
  }
  const stops = [0, 1].map((index) => ({
    index,
    runId: 'node-run',
    sessionId: 'owned-session',
    threadId: 7,
    elapsedMs: 10 + index * 10,
    worker: {},
    source: index ? configuration.additionalStops![0]! : configuration.source,
    frame: { id: 10 + index, name: 'notifyManager', line: 1, column: 1 },
    variables: [{ name: 'listener', value: '() => undefined' }],
    facts: [
      { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
    ],
    debuggerSnapshot: {
      version: 1,
      frames: [
        {
          name: 'notifyManager',
          line: 1,
          column: 1,
          scopes: [{ name: 'Local', variables: [0] }],
        },
      ],
      variables: [{ name: 'listener', value: '() => undefined', children: [] }],
      limitations: [],
    },
  })) as unknown as NodeTestSourceStop[]
  let cursor = 0,
    releases = 0,
    acquisitions = 0
  const runtime: NodeTestRuntime = {
    id: 'node-run',
    async prepare() {
      return stops[cursor]!
    },
    hasNextStop() {
      return cursor === 0
    },
    async advance() {
      return stops[++cursor]!
    },
    async complete() {
      return {
        exitCode: 0,
        signal: null,
        output: 'Tests 1 passed',
        elapsedMs: 30,
      }
    },
    async stop() {
      releases++
    },
  }
  service.environment.createNodeTestRun = async (_configuration, record) => {
    const reservedHistory = await service.nodeHistoryStore!.list()
    assert.equal(
      reservedHistory.length,
      1,
      'durable history exists before the environment can start test input',
    )
    assert.equal(reservedHistory[0]?.status, 'recording')
    acquisitions++
    record('node-test.started', { pid: 987, cwd: '/private/workspace' })
    record('node-test.breakpoint-ack', {
      status: 'pending',
      elapsedMs: 4,
      workspace: '/private/workspace',
    })
    record('node-test.entry-continued', { elapsedMs: 5, processGroup: 987 })
    record('node-test.frame-checked', {
      index: 0,
      requestedLine: 224,
      requestedColumn: 7,
      observedLine: 225,
      observedColumn: 5,
      sameSource: true,
      exact: false,
      elapsedMs: 6,
      sourceText: 'private source',
    })
    record('node-test.snapshot-started', {
      index: 0,
      elapsedMs: 7,
      variables: ['private value'],
    })
    await record('node-test.output', {
      sequence: 1,
      elapsedMs: 3,
      channel: 'stdout',
      text: 'RUN src/theme.test.ts',
    })
    return runtime
  }
  const input = {
    instanceId: service.instanceId,
    profile: NODE_TEST_PROFILE,
    key: 'node-public-start',
    configuration,
  }
  const receipt = service.start(input),
    record = service.record(receipt)
  try {
    // Act: the public service prepares citations before acquiring the owned Node test runtime.
    const profile = (await service.status()).profiles.find(
      (candidate) => candidate.id === NODE_TEST_PROFILE,
    )
    assert.ok(profile && 'configurationVersions' in profile)
    assert.equal(profile.helpUri, 'codebook://help/node-test')
    assert.equal(
      profile.minimumExtensionVersion,
      '0.2.12',
      'the Node test profile names the first extension release that ships it',
    )
    await record.preparation
    assert.deepEqual(
      service.start(input),
      receipt,
      'the same key recovers the first run without launching another test',
    )
    const first = service.state(record)
    const firstStop = await readResource(
      service,
      first.participants.server!.snapshotUri!,
    )
    assert.ok('text' in firstStop)
    const firstDocument = JSON.parse(JSON.parse(firstStop.text).content)
    await service.continue(first.participants.server!.continueArguments!)
    const second = service.state(record)
    await service.continue(second.participants.server!.continueArguments!)
    service.maintain()
    await waitUntil(() => record.stopped, 'Node profile cleanup', 1_000)
    const state = service.state(record),
      nodeTest = state.nodeTest!,
      source = await readResource(service, nodeTest.stops[0]!.sourceUri)
    const help = await readResource(service, 'codebook://help/node-test')
    const events = await readResource(service, state.eventsUri)
    const historyResource = await readResource(service, nodeTest.historyUri!)
    if (!('text' in historyResource))
      throw new Error('Node history did not return its JSON manifest.')
    const historyPage = JSON.parse(historyResource.text)
    const storedHistory = JSON.parse(historyPage.content)
    const historyEventsResource = await readResource(
      service,
      storedHistory.eventsUri,
    )
    if (!('text' in historyEventsResource))
      throw new Error('Node history events did not return JSON.')
    const historyEventsPage = JSON.parse(historyEventsResource.text)
    assert.match(historyEventsPage.content, /RUN src\/theme\.test\.ts/)
    const restartedStore = new NodeTestHistoryStore(
      join(harness.directory, '.learning'),
      '0'.repeat(64),
    )
    const restartedHistory = await restartedStore.read(
      storedHistory.header.studyId,
    )
    service.nodeHistoryStore = restartedStore
    const historyList = await readResource(service, 'codebook://node-history')

    // Assert
    assert.equal(
      acquisitions,
      1,
      'same-key retries and pause advances must reuse the accepted owned process',
    )
    assert.equal(firstDocument.historical, true)
    assert.equal(firstDocument.debuggerSnapshot.variables[0].name, 'listener')
    assert.ok('text' in source)
    assert.equal(source.text, 'const nextTheme = "dark";\n')
    assert.equal(nodeTest.stops.length, 2)
    assert.deepEqual(nodeTest.result, {
      exitCode: 0,
      signal: null,
      output: 'Tests 1 passed',
    })
    assert.equal(state.finalOutcome, 'partial')
    assert.equal(state.studyOutcome, 'partial')
    assert.equal(state.recording.status, 'unavailable')
    assert.equal(nodeTest.replayAvailable, false)
    assert.equal(nodeTest.historyStatus, 'complete')
    assert.deepEqual(
      restartedHistory.entries.map((entry) => entry.type),
      ['output', 'stop', 'stop', 'result'],
    )
    assert.equal(restartedHistory.status, 'complete')
    assert.equal(
      restartedHistory.entries[1]?.type === 'stop' &&
        restartedHistory.entries[1].debuggerSnapshot.variables[0]?.name,
      'listener',
    )
    assert.equal(
      restartedHistory.entries[0]?.type === 'output' &&
        restartedHistory.entries[0].outputSequence,
      1,
    )
    assert.ok('text' in historyList)
    assert.match(historyList.text, /node-test/)
    assert.ok('text' in events)
    assert.match(events.text, /RUN src\/theme\.test\.ts/)
    assert.match(events.text, /"requestedLine":224/)
    assert.match(events.text, /"observedLine":225/)
    assert.doesNotMatch(
      events.text,
      /private source|private value|"workspace"|"processGroup"/,
    )
    assert.doesNotMatch(
      JSON.stringify(JSON.parse(historyEventsPage.content)),
      /\"pid\"|\"processGroup\"|\"workspace\":/,
    )
    assert.ok('text' in historyResource)
    assert.doesNotMatch(
      JSON.stringify(storedHistory),
      /\"pid\"|\"processGroup\"|\"workspace\":/,
    )
    assert.ok('text' in help)
    assert.match(help.text, /history journal/i)
    assert.match(
      help.text,
      /not application video or synchronized application replay/i,
    )
    assert.match(
      help.text,
      /\[\\"invoice data queries\\", \\"converts stored invoice cents to dollars for the edit form\\"\]/,
      'help shows a nested test cited by its title path',
    )
    assert.match(help.text, /testName is retired and refused for new runs/)
    assert.match(
      help.text,
      /Codebook does not resume it.*node-test\.learner-paused.*continue it in the native debugger/,
      'help tells the agent a learner pause waits for the learner',
    )
    assert.match(
      state.recording.reason!,
      /application video and synchronized replay are unavailable/i,
    )
    assert.equal(releases, 1)
  } finally {
    await harness.close()
  }
})

test('the saved Node history catalog stays readable after it spans several resource pages', async () => {
  // Arrange
  const harness = await createHarness(),
    { service } = harness
  const workspaceKey = '0'.repeat(64)
  const store = new NodeTestHistoryStore(
    join(harness.directory, '.learning'),
    workspaceKey,
  )
  const studyIds: string[] = []
  for (let index = 0; index < 6; index++) {
    const header = nodeTestHistoryHeader(workspaceKey)
    const writer = await store.start(header)
    await writer.finish(
      'partial',
      `Interrupted run ${index}: ${'x'.repeat(900)}`,
    )
    studyIds.push(header.studyId)
  }
  service.nodeHistoryStore = store
  try {
    // Act: follow every returned page URI, as the catalog tells agents to.
    const pages: Array<{ content: string; nextUri?: string }> = []
    let uri: string | undefined = 'codebook://node-history'
    while (uri) {
      const resource = await readResource(service, uri)
      if (!('text' in resource))
        throw new Error('The Node history catalog did not return JSON.')
      const page = JSON.parse(resource.text) as {
        content: string
        nextUri?: string
      }
      pages.push(page)
      uri = page.nextUri
    }
    const catalog = JSON.parse(
      pages.map((page) => page.content).join(''),
    ) as Array<{ studyId: string; historyUri: string }>
    // Assert
    assert.equal(
      pages.length,
      3,
      'six long partial reasons span three catalog pages',
    )
    assert.deepEqual(
      catalog.map((entry) => entry.studyId).sort(),
      [...studyIds].sort(),
    )
    assert.deepEqual(
      catalog.map((entry) => entry.historyUri).sort(),
      studyIds.map((studyId) => `codebook://node-history/${studyId}`).sort(),
    )
  } finally {
    await harness.close()
  }
})

test('public Node start rejects cited source drift before creating a process owner', async () => {
  // Arrange
  const harness = await createHarness(),
    { service } = harness
  let acquisitions = 0
  service.environment.createNodeTestRun = async () => {
    acquisitions++
    throw new Error('must not launch')
  }
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: harness.configuration.book,
    testFile: 'src/theme.test.ts',
    testTitles: ['theme', 'selects the dark theme'],
    testHash: 'a'.repeat(64),
    source: harness.configuration.source,
    inspections: harness.configuration.inspections.slice(0, 1),
  }
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: NODE_TEST_PROFILE,
    key: 'source-drift',
    configuration,
  })
  try {
    await writeFile(
      join(harness.directory, 'src/theme.ts'),
      'const changed = true;\n',
    )
    await service.record(receipt).preparation
    // Assert
    assert.equal(acquisitions, 0)
    assert.equal(
      service.state(service.record(receipt)).error?.code,
      'SOURCE_CHANGED',
    )
  } finally {
    await harness.close()
  }
})

// Cycle 0046 (row 314): red while the service gave a Node test run nothing to compare the editor's documents with, so a test started while the editor held unsaved lines of a cited source.
test('a Node test start whose cited source is open in the editor with other text ends in its run resource with SOURCE_CHANGED and the sentence that names the file', async () => {
  // Arrange
  const harness = await createHarness(),
    { service } = harness
  service.nodeHistoryStore = new NodeTestHistoryStore(
    join(harness.directory, '.learning'),
    '0'.repeat(64),
  )
  service.environment.build.sourceHash = 'f'.repeat(64)
  let releases = 0
  // The stand-in applies the owned run's own check to the cited text the service hands it, as the owned run does before it lists or launches the test; the editor holds other text for the cited file.
  service.environment.createNodeTestRun = async (
    _configuration,
    _record,
    citedSources,
  ) => ({
    id: 'node-run',
    async prepare() {
      assertConfiguredSourceDocuments(harness.directory, citedSources, [
        {
          uri: {
            scheme: 'file',
            fsPath: join(harness.directory, 'src/theme.ts'),
          },
          getText: () => 'const nextTheme = "light";\n',
        },
      ])
      throw new Error('The check found no cited source with other text.')
    },
    hasNextStop: () => false,
    async advance() {
      throw new Error('A refused run has no next stop.')
    },
    async complete() {
      throw new Error('A refused run has no result.')
    },
    async stop(): Promise<void> {
      releases++
    },
  })
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: harness.configuration.book,
    testFile: 'src/theme.test.ts',
    testTitles: ['theme', 'selects the dark theme'],
    testHash: 'a'.repeat(64),
    source: harness.configuration.source,
    inspections: harness.configuration.inspections.slice(0, 1),
  }
  try {
    // Act
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: NODE_TEST_PROFILE,
      key: 'other-text-in-editor',
      configuration,
    })
    await service.record(receipt).preparation
    await waitUntil(() => releases === 1, 'refused Node test run released')

    // Assert
    const error = service.state(service.record(receipt)).error
    assert.deepEqual(
      { code: error?.code, message: error?.message },
      {
        code: 'SOURCE_CHANGED',
        message:
          'The cited source src/theme.ts is open in the editor with text that differs from the text the article cites, and Codebook neither saves nor reverts a document of the learner. Ask the learner to save or revert the file: after a save read the source again and publish the article again, after a revert change nothing; then start a new run.',
      },
    )
  } finally {
    await harness.close()
  }
})

// Cycle 0046 (row 324): pins what an agent reads when a Node test run ends at a continuation because the learner changed a cited source in the editor: the continuation's own answer and the run resource carry the code and the sentence, not a general failure.
test('a Node test continuation that the editor’s changed document of a cited source ends answers SOURCE_CHANGED with the sentence that names the file, and the run resource carries the same error', async () => {
  // Arrange
  const harness = await createHarness(),
    { service } = harness
  service.nodeHistoryStore = new NodeTestHistoryStore(
    join(harness.directory, '.learning'),
    '0'.repeat(64),
  )
  service.environment.build.sourceHash = 'f'.repeat(64)
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: harness.configuration.book,
    testFile: 'src/theme.test.ts',
    testTitles: ['theme', 'selects the dark theme'],
    testHash: 'a'.repeat(64),
    source: harness.configuration.source,
    inspections: harness.configuration.inspections.slice(0, 1),
    additionalStops: [
      {
        ...harness.configuration.source,
        anchorIndex: 0,
        inspections: harness.configuration.inspections.slice(0, 1),
      },
    ],
  }
  const firstStop = {
    index: 0,
    runId: 'node-run',
    sessionId: 'owned-session',
    threadId: 7,
    elapsedMs: 10,
    worker: {},
    source: configuration.source,
    frame: { id: 10, name: 'notifyManager', line: 1, column: 1 },
    variables: [{ name: 'listener', value: '() => undefined' }],
    facts: [
      { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
    ],
    debuggerSnapshot: {
      version: 1,
      frames: [
        {
          name: 'notifyManager',
          line: 1,
          column: 1,
          scopes: [{ name: 'Local', variables: [0] }],
        },
      ],
      variables: [{ name: 'listener', value: '() => undefined', children: [] }],
      limitations: [],
    },
  } as unknown as NodeTestSourceStop
  let releases = 0
  // The stand-in applies the owned run's own check at its continuation, to the cited text the service handed it; by then the editor holds other text for the cited file.
  service.environment.createNodeTestRun = async (
    _configuration,
    _record,
    citedSources,
  ) => ({
    id: 'node-run',
    async prepare() {
      return firstStop
    },
    hasNextStop: () => true,
    async advance() {
      assertConfiguredSourceDocuments(harness.directory, citedSources, [
        {
          uri: {
            scheme: 'file',
            fsPath: join(harness.directory, 'src/theme.ts'),
          },
          getText: () =>
            '// a line the learner typed\nconst nextTheme = "dark";\n',
        },
      ])
      throw new Error('The check found no cited source with other text.')
    },
    async complete() {
      throw new Error('A run that ended at a continuation has no result.')
    },
    async stop(): Promise<void> {
      releases++
    },
  })
  try {
    const receipt = service.start({
        instanceId: service.instanceId,
        profile: NODE_TEST_PROFILE,
        key: 'changed-between-stops',
        configuration,
      }),
      record = service.record(receipt)
    await record.preparation

    // Act
    const answer: unknown = await service
      .continue(service.state(record).participants.server!.continueArguments!)
      .catch((error: unknown) => error)
    await waitUntil(() => releases === 1, 'ended Node test run released')

    // Assert
    const expected = {
      code: 'SOURCE_CHANGED',
      message:
        'The cited source src/theme.ts is open in the editor with text that differs from the text the article cites, and Codebook neither saves nor reverts a document of the learner. Ask the learner to save or revert the file: after a save read the source again and publish the article again, after a revert change nothing; then start a new run.',
    }
    const error = service.state(record).error
    assert.deepEqual(
      answer instanceof StudyError
        ? { code: answer.code, message: answer.message }
        : answer,
      expected,
    )
    assert.deepEqual({ code: error?.code, message: error?.message }, expected)
    assert.equal(service.state(record).nodeTest?.stops.length, 1)
  } finally {
    await harness.close()
  }
})

test('paged Node history events follow the returned continuation URI', async () => {
  // Arrange
  const harness = await createHarness(),
    workspaceKey = '0'.repeat(64)
  const store = new NodeTestHistoryStore(
    join(harness.directory, '.learning'),
    workspaceKey,
  )
  const header = nodeTestHistoryHeader(workspaceKey)
  const writer = await store.start(header)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 1,
    channel: 'stdout',
    text: 'timeout '.repeat(500),
  })
  await writer.appendOutput({
    sequence: 2,
    elapsedMs: 2,
    channel: 'stderr',
    text: 'timed out '.repeat(400),
  })
  await writer.finish('partial', 'The selected test exceeded its timeout.')
  harness.service.nodeHistoryStore = store

  try {
    // Act: follow only the exact continuation URI returned by the event page.
    const firstResource = await readResource(
      harness.service,
      `codebook://node-history/${header.studyId}/events`,
    )
    assert.ok('text' in firstResource)
    const firstPage = JSON.parse(firstResource.text)
    assert.equal(firstPage.complete, false)
    assert.equal(
      firstPage.sourceUri,
      `codebook://node-history/${header.studyId}/events`,
    )
    const nextResource = await readResource(harness.service, firstPage.nextUri)
    assert.ok('text' in nextResource)
    const nextPage = JSON.parse(nextResource.text)

    // Assert
    assert.equal(nextPage.offset, firstPage.end)
    assert.equal(nextPage.contentHash, firstPage.contentHash)
    assert.equal(nextPage.complete, true)
    const events = JSON.parse(firstPage.content + nextPage.content)
    assert.equal(events.length, 2)
    assert.equal(events[0].text, 'timeout '.repeat(500))
    assert.equal(events[1].channel, 'stderr')
  } finally {
    await harness.close()
  }
})

test('a failed advance to the next Node stop releases the test and seals its recorded prefix as partial history', async () => {
  // Arrange
  const harness = await createHarness(),
    { service } = harness
  const store = new NodeTestHistoryStore(
    join(harness.directory, '.learning'),
    '0'.repeat(64),
  )
  service.nodeHistoryStore = store
  service.environment.build.sourceHash = 'f'.repeat(64)
  const base = harness.configuration
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: base.book,
    testFile: 'src/theme.test.ts',
    testTitles: ['theme', 'selects the dark theme'],
    testHash: 'a'.repeat(64),
    source: base.source,
    inspections: base.inspections.slice(0, 1),
    additionalStops: [
      {
        ...base.source,
        anchorIndex: 0,
        inspections: base.inspections.slice(0, 1),
      },
    ],
  }
  const firstStop = {
    index: 0,
    runId: 'node-run',
    sessionId: 'owned-session',
    threadId: 7,
    elapsedMs: 10,
    worker: {},
    source: configuration.source,
    frame: { id: 10, name: 'notifyManager', line: 1, column: 1 },
    variables: [{ name: 'listener', value: '() => undefined' }],
    facts: [
      { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
    ],
    debuggerSnapshot: {
      version: 1,
      frames: [
        {
          name: 'notifyManager',
          line: 1,
          column: 1,
          scopes: [{ name: 'Local', variables: [0] }],
        },
      ],
      variables: [{ name: 'listener', value: '() => undefined', children: [] }],
      limitations: [],
    },
  } as unknown as NodeTestSourceStop
  let releases = 0
  const runtime: NodeTestRuntime = {
    id: 'node-run',
    async prepare() {
      return firstStop
    },
    hasNextStop() {
      return true
    },
    async advance() {
      throw new Error(
        'Owned Node source pause was resumed before the next declared stop.',
      )
    },
    async complete() {
      throw new Error(
        'The final result must not be requested before the second stop.',
      )
    },
    async stop() {
      releases++
    },
  }
  service.environment.createNodeTestRun = async () => runtime
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: NODE_TEST_PROFILE,
    key: 'node-advance-failure',
    configuration,
  })
  const record = service.record(receipt)
  try {
    await record.preparation
    const paused = service.state(record)

    // Act
    const continuing = service.continue(
      paused.participants.server!.continueArguments!,
    )

    // Assert
    await assert.rejects(continuing, { code: 'RUNTIME_FAILED' })
    await waitUntil(() => record.stopped, 'Node failure cleanup', 1_000)
    const history = await store.read(`${service.instanceId}_${record.id}`)
    assert.equal(releases, 1)
    assert.equal(service.state(record).nodeTest!.historyStatus, 'partial')
    assert.equal(history.status, 'partial')
    assert.deepEqual(
      history.entries.map((entry) => entry.type),
      ['stop'],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the cause an agent and the learner read for a Node test run whose advance to the next stop failed: the continuation's error message and the run resource's terminalReason name the advance's failure; fails_when=both say only "The study operation failed." while the failure stays in error.cause alone; why_new=Cycle 0046 row 653 (the Node continuation's catch in StudyService.continue); seam=environment.createNodeTestRun, whose advance rejects
test('a failed advance to the next Node stop names that failure in the continuation error and in the run terminal reason', async () => {
  // Arrange
  const harness = await createHarness(),
    { service } = harness
  service.nodeHistoryStore = new NodeTestHistoryStore(
    join(harness.directory, '.learning'),
    '0'.repeat(64),
  )
  service.environment.build.sourceHash = 'f'.repeat(64)
  const base = harness.configuration
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: base.book,
    testFile: 'src/theme.test.ts',
    testTitles: ['theme', 'selects the dark theme'],
    testHash: 'a'.repeat(64),
    source: base.source,
    inspections: base.inspections.slice(0, 1),
    additionalStops: [
      {
        ...base.source,
        anchorIndex: 0,
        inspections: base.inspections.slice(0, 1),
      },
    ],
  }
  const firstStop = {
    index: 0,
    runId: 'node-run',
    sessionId: 'owned-session',
    threadId: 7,
    elapsedMs: 10,
    worker: {},
    source: configuration.source,
    frame: { id: 10, name: 'notifyManager', line: 1, column: 1 },
    variables: [{ name: 'listener', value: '() => undefined' }],
    facts: [
      { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
    ],
    debuggerSnapshot: {
      version: 1,
      frames: [
        {
          name: 'notifyManager',
          line: 1,
          column: 1,
          scopes: [{ name: 'Local', variables: [0] }],
        },
      ],
      variables: [{ name: 'listener', value: '() => undefined', children: [] }],
      limitations: [],
    },
  } as unknown as NodeTestSourceStop
  const runtime: NodeTestRuntime = {
    id: 'node-run',
    async prepare() {
      return firstStop
    },
    hasNextStop() {
      return true
    },
    async advance() {
      throw new Error(
        'Owned Node source pause was resumed before the next declared stop.',
      )
    },
    async complete() {
      throw new Error(
        'The final result must not be requested before the second stop.',
      )
    },
    async stop() {},
  }
  service.environment.createNodeTestRun = async () => runtime
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: NODE_TEST_PROFILE,
    key: 'node-advance-failure-cause',
    configuration,
  })
  const record = service.record(receipt)
  try {
    await record.preparation
    const paused = service.state(record)

    // Act
    const continuing = service.continue(
      paused.participants.server!.continueArguments!,
    )
    const rejection = await continuing.then(
      () => undefined,
      (error: unknown) => error,
    )
    await waitUntil(() => record.stopped, 'Node failure cleanup', 1_000)
    const state = service.state(record)

    // Assert
    assert.ok(rejection instanceof StudyError)
    assert.deepEqual(
      {
        rejection: rejection.describe(),
        terminalReason: state.terminalReason,
      },
      {
        rejection: {
          code: 'RUNTIME_FAILED',
          message:
            'The study operation failed. Cause: Owned Node source pause was resumed before the next declared stop.',
          cause:
            'Error: Owned Node source pause was resumed before the next declared stop.',
          recovery:
            'Read the terminal reason and captured history. Stop owned resources; do not retry the click automatically.',
          docs: 'codebook://help/errors',
        },
        terminalReason:
          'The study operation failed. Cause: Owned Node source pause was resumed before the next declared stop.',
      },
    )
  } finally {
    await harness.close()
  }
})
