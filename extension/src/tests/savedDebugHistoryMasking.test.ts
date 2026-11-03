import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { before, test, type TestContext } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'

import type { ChromeExtensionHistorySink } from '../chromeExtensionHistorySink'
import { CHROME_EXTENSION_PROFILE } from '../constants'
import { LearningLibrary } from '../learningLibrary'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import type { RecordingBinding } from '../recordingSchemas'
import { RecordingStore } from '../recordingStore'
import { ReplayDebugAdapter } from '../replayDebugAdapter'
import type { ReplayDebugSnapshot } from '../replayDebugSchemas'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { buildRecordingContext } from '../utils/buildRecordingContext'
import { maskSavedDebugSnapshot } from '../utils/maskSavedDebugSnapshot'

import { createHarness } from './helpers'
import {
  capturedStop,
  extensionHistoryHeader,
  extensionIdentity,
} from './utils/chromeExtensionHistoryFixture'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { FakeChromeExtensionRuntime } from './utils/fakeChromeExtensionRuntime'
import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
  serverStopCapture,
} from './utils/nodeServerHistoryFixture'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { chromeExtensionConfigurationOf } from './utils/startFakeChromeExtensionRun'

before(async () => {
  await realProcessStart(process.pid)
})

// The values below are what a study saved by 0.2.73.1 or earlier holds: a made-up opaque cookie value and a made-up peer address.
const COOKIE_VALUE = ['SESSION', 'COOKIE', 'VALUE', 'opaque', '8f3a91c2'].join(
  '-',
)
const PEER_ADDRESS = '10.1.2.3'
const SECRETS = [COOKIE_VALUE, PEER_ADDRESS]
/** The executed source of the stop: a comment that quotes a Cookie header, which the mask must leave as recorded. */
const SOURCE_TEXT =
  'export function handler(req) {\n  // Cookie: a=1; b=2\n  return req\n}\n'
const SOURCE_HASH = sha256(SOURCE_TEXT)

// The facts below are what a study saved by 0.2.73.1 or earlier holds: made-up opaque values that only the shape of their string marks as credentials.
const FACT_COOKIE_VALUE = [
  'FACT',
  'COOKIE',
  'VALUE',
  'opaque',
  '5d7e20b4',
].join('-')
const FACT_AUTH_CODE = ['FACT', 'OAUTH', 'CODE', '71c9a3e8'].join('-')
const FACT_BASIC_CREDENTIAL = ['Zm9v', 'YmFy', 'b3BhcXVl'].join('')
const FACT_SECRETS = [FACT_COOKIE_VALUE, FACT_AUTH_CODE, FACT_BASIC_CREDENTIAL]
/**
 * The declared string facts an older version saved as the debugger previews them (quotes included): three credential shapes under names no rule reads as secret, and two plain strings that must stay readable.
 * Keyed `<mode>:<path>` as the Node server and Chrome extension histories keep facts.
 */
const OLD_FORMAT_FACT_DISPLAYS: Record<string, string> = {
  'value:cookieHeader': `'sid=${FACT_COOKIE_VALUE}; theme=dark'`,
  'value:basicHeader': `'Basic ${FACT_BASIC_CREDENTIAL}'`,
  'value:callbackUrl': `'https://shop.example/cb?code=${FACT_AUTH_CODE}&page=2'`,
  'value:page': "'page=2'",
  'value:note': "'Token expired'",
}

/** Fails when a scripted fact secret appears in the served text, and when a plain fact or the readable rest of the callback URL is gone. */
function assertServedFactsMasked(served: string): void {
  for (const secret of FACT_SECRETS)
    assert.equal(served.includes(secret), false, `the chat reads ${secret}`)
  assert.equal(served.includes('page=2'), true)
  assert.equal(served.includes('Token expired'), true)
  assert.equal(served.includes('shop.example/cb?code=[masked]'), true)
}

/** A snapshot with no credential in it, so an assertion about facts reads nothing the snapshot rule masks. */
function plainSnapshot(
  topFrameSource: NonNullable<ReplayDebugSnapshot['frames'][number]['source']>,
): ReplayDebugSnapshot {
  return {
    version: 1,
    frames: [
      {
        name: 'handler',
        line: topFrameSource.line,
        column: 1,
        source: topFrameSource,
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
    variables: [{ name: 'id', value: '7', type: 'string', children: [] }],
    limitations: [],
  }
}

/**
 * Builds the snapshot an older version saved for a request handler's stop: a cookie record, a Cookie header string, the flat `rawHeaders` array and a socket, all unmasked.
 * @param topFrameSource - The executed source of the top frame, with its SHA-256.
 * @returns A snapshot that passes the snapshot schema and holds {@link SECRETS} in plain text.
 * @example oldFormatSnapshot({ name: 'src/handler.ts', text, hash: sha256(text), line: 2 }).variables[2]?.value // => "'SESSION-COOKIE-VALUE-opaque-8f3a91c2'"
 */
function oldFormatSnapshot(
  topFrameSource: NonNullable<ReplayDebugSnapshot['frames'][number]['source']>,
): ReplayDebugSnapshot {
  const string = (name: string, text: string) => ({
    name,
    value: `'${text}'`,
    type: 'string',
    children: [] as number[],
  })
  return {
    version: 1,
    frames: [
      {
        name: 'handler',
        line: topFrameSource.line,
        column: 1,
        source: topFrameSource,
        scopes: [{ name: 'Local', variables: [0, 3, 4, 9] }],
      },
    ],
    variables: [
      {
        name: 'entry',
        value: `{name: 'sid', value: '${COOKIE_VALUE}'}`,
        type: 'Object',
        children: [1, 2],
      },
      string('name', 'sid'),
      string('value', COOKIE_VALUE),
      string('cookieHeader', `sid=${COOKIE_VALUE}; theme=dark`),
      {
        name: 'rawHeaders',
        value: `Array(4) ['Host', 'localhost:3000', 'Cookie', 'sid=${COOKIE_VALUE}']`,
        type: 'Array',
        children: [5, 6, 7, 8],
      },
      string('0', 'Host'),
      string('1', 'localhost:3000'),
      string('2', 'Cookie'),
      string('3', `sid=${COOKIE_VALUE}`),
      {
        name: 'socket',
        value: `Socket {connecting: false, remoteAddress: '${PEER_ADDRESS}'}`,
        type: 'Socket',
        children: [10],
      },
      string('remoteAddress', PEER_ADDRESS),
    ],
    limitations: [],
  }
}

/** Fails when any scripted secret appears in the served text, and when the harmless header the chat may read is gone. */
function assertServedMasked(served: string): void {
  for (const secret of SECRETS)
    assert.equal(served.includes(secret), false, `the chat reads ${secret}`)
  assert.equal(served.includes('localhost:3000'), true)
}

/** Reads a paged JSON resource whose content fits one page and returns the parsed content with its raw text. */
async function readPaged(
  service: Parameters<typeof readResource>[0],
  uri: string,
): Promise<{ content: string; parsed: unknown }> {
  const resource = await readResource(service, uri)
  if (!('text' in resource)) throw new Error(`${uri} did not return JSON.`)
  const page = JSON.parse(resource.text) as {
    content: string
    complete: boolean
  }
  assert.equal(page.complete, true)
  return { content: page.content, parsed: JSON.parse(page.content) }
}

// protects=the replay debug session of a study saved before the shape rules; fails_when=the session answers the cookie record's value, the Cookie header, the Cookie element of rawHeaders or the socket's members to the editor's Variables view; no_claim=the Variables tree layout (replayDebug tests)
test('the replay debug session serves a study saved with unmasked cookie values with those values masked', () => {
  // Arrange
  const messages: (DebugProtocol.Response | DebugProtocol.Event)[] = []
  const adapter = new ReplayDebugAdapter(
    (message) => messages.push(message),
    () => {},
  )
  let sequence = 0
  const request = (command: string, arguments_?: unknown) => {
    const requestSequence = ++sequence
    adapter.handleMessage({
      seq: requestSequence,
      type: 'request',
      command,
      arguments: arguments_,
    })
    return messages.find(
      (message) =>
        'request_seq' in message && message.request_seq === requestSequence,
    ) as DebugProtocol.Response
  }
  adapter.select(
    oldFormatSnapshot({
      name: 'src/handler.ts',
      text: SOURCE_TEXT,
      hash: SOURCE_HASH,
      line: 2,
    }),
    'Recorded',
  )
  request('configurationDone')

  // Act
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]
  const scope = request('scopes', { frameId: frame.id }).body.scopes[0]
  const locals = request('variables', {
    variablesReference: scope.variablesReference,
  }).body.variables as DebugProtocol.Variable[]
  const served = [locals]
  for (const local of locals)
    if (local.variablesReference > 0)
      served.push(
        request('variables', { variablesReference: local.variablesReference })
          .body.variables,
      )

  // Assert
  assertServedMasked(JSON.stringify(served))
  assert.equal(
    locals.find((local) => local.name === 'cookieHeader')?.value,
    '[masked]',
  )
  assert.equal(locals.find((local) => local.name === 'socket')?.value, 'Socket')
})

// protects=the test history detail the chat reads for one stop; fails_when=events/<sequence> of a history saved before the shape rules serves the cookie record, the Cookie header, rawHeaders or the socket's members; no_claim=the events list, which holds no snapshot
test('a test history saved with unmasked cookie values serves its stop detail masked', async () => {
  // Arrange
  const harness = await createHarness()
  try {
    const workspaceKey = '0'.repeat(64)
    const store = new NodeTestHistoryStore(
      join(harness.directory, '.learning'),
      workspaceKey,
    )
    const header = nodeTestHistoryHeader(workspaceKey)
    const writer = await store.start(header)
    await writer.appendStop({
      index: 0,
      runId: 'test-run',
      sessionId: 'test-session',
      threadId: 1,
      elapsedMs: 5,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
      source: header.configuration.source,
      frame: { id: 1, name: 'handler', line: 1, column: 1 },
      variables: [],
      facts: [],
      debuggerSnapshot: oldFormatSnapshot({
        name: header.configuration.source.path,
        text: SOURCE_TEXT,
        hash: sha256(SOURCE_TEXT),
        line: 1,
      }),
    })
    await writer.finish('partial', 'The learner stopped this run.')
    harness.service.nodeHistoryStore = store

    // Act
    const detail = await readPaged(
      harness.service,
      `codebook://node-history/${header.studyId}/events/1`,
    )

    // Assert
    assertServedMasked(detail.content)
    assert.match(detail.content, /\[masked\]/)
  } finally {
    await harness.close()
  }
})

// protects=the Node server history detail the chat reads for one stop, and the recorded source text of its top frame; fails_when=events/<sequence> of a history saved before the shape rules serves the cookie values, or masks the Cookie comment the executed source quotes; no_claim=the events list, which holds no snapshot
test('a Node server history saved with unmasked cookie values serves its stop detail masked and its recorded source text unchanged', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops: 1,
  })
  const writer = await repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: header.declaredRequest.path,
    bodyBytes: 14,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  const capture = serverStopCapture({
    declaredStopIndex: 0,
    hit: 1,
    line: 2,
    elapsedMs: 10,
    text: SOURCE_TEXT,
  })
  await writer.appendStop({
    ...capture,
    snapshot: oldFormatSnapshot({
      name: 'src/handler.ts',
      text: SOURCE_TEXT,
      hash: SOURCE_HASH,
      line: 2,
    }),
  })
  await writer.appendResponse({
    elapsedMs: 20,
    status: 201,
    contentType: 'application/json',
    body: '{"id":7}',
    bodyBytes: 8,
    readCut: false,
    location: null,
    requestDurationMs: 10,
  })
  await writer.seal({ elapsedMs: 30, reason: 'stopped' })
  harness.service.nodeHistoryStore = repository.testHistories
  harness.service.nodeHistoryRepository = repository
  const baseUri = `codebook://node-history/${header.studyId}`

  // Act
  const events = (await readPaged(harness.service, `${baseUri}/events`))
    .parsed as { sequence: number; type: string }[]
  const stopSequence = events.find((event) => event.type === 'stop')?.sequence
  const detail = await readPaged(
    harness.service,
    `${baseUri}/events/${stopSequence}`,
  )

  // Assert
  assertServedMasked(detail.content)
  const served = detail.parsed as {
    debuggerSnapshot: ReplayDebugSnapshot
  }
  assert.equal(served.debuggerSnapshot.frames[0]?.source?.text, SOURCE_TEXT)
  assert.equal(served.debuggerSnapshot.variables[2]?.value, '[masked]')
})

// protects=the Chrome extension history detail the chat reads for one capture; fails_when=events/<sequence> of a history saved before the shape rules serves the cookie values; no_claim=the events list, which holds no snapshot
test('a Chrome extension history saved with unmasked cookie values serves its capture detail masked', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context)
  harness.service.nodeHistoryRepository = repository
  harness.service.nodeHistoryStore = repository.testHistories
  class HistoryFakeRuntime extends FakeChromeExtensionRuntime {
    beginHistory?: (
      identity: ReturnType<typeof extensionIdentity>,
    ) => Promise<ChromeExtensionHistorySink | undefined>
    history?: ChromeExtensionHistorySink
    override async prepare(): Promise<void> {
      this.history = await this.beginHistory?.(extensionIdentity())
      await super.prepare()
    }
  }
  const run = new HistoryFakeRuntime()
  harness.service.environment.createChromeExtensionRun = async (input) => {
    run.beginHistory = input.beginHistory
    return run
  }
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: CHROME_EXTENSION_PROFILE,
    key: 'history',
    configuration: chromeExtensionConfigurationOf(harness),
  })
  const record = harness.service.record(receipt)
  await record.preparation
  const studyId = `${harness.service.instanceId}_${record.id}`
  const stop = capturedStop({
    stopIndex: 1,
    context: 'page',
    text: SOURCE_TEXT,
  })
  run.history?.pauseOpened({
    pauseId: `${record.id}:1:page:1`,
    generation: 1,
    context: 'page',
    stopIndex: 1,
    targetUrl: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
    workerGeneration: 0,
  })
  run.history?.captured(`${record.id}:1:page:1`, {
    ...stop,
    snapshot: oldFormatSnapshot({
      name: 'popup.js',
      text: SOURCE_TEXT,
      hash: SOURCE_HASH,
      line: 2,
    }),
  })
  await harness.service.stop({
    instanceId: harness.service.instanceId,
    runId: record.id,
  })

  // Act
  const detail = await readPaged(
    harness.service,
    `codebook://node-history/${studyId}/events/2`,
  )

  // Assert
  assert.equal((detail.parsed as { type: string }).type, 'capture')
  assertServedMasked(detail.content)
})

// protects=the test history's lean events list and stop detail, which the chat reads to cite a stop and its facts; fails_when=a history saved before the shape rules serves a Cookie header, a Basic credential or a callback code from a declared string fact, or masks the plain strings beside them; no_claim=the debugger snapshot of the stop (the detail tests above)
test('a test history saved with credential-shaped string facts serves its events list and stop detail with those facts masked', async () => {
  // Arrange
  const harness = await createHarness()
  try {
    const workspaceKey = '0'.repeat(64)
    const store = new NodeTestHistoryStore(
      join(harness.directory, '.learning'),
      workspaceKey,
    )
    const header = nodeTestHistoryHeader(workspaceKey)
    const writer = await store.start(header)
    await writer.appendStop({
      index: 0,
      runId: 'test-run',
      sessionId: 'test-session',
      threadId: 1,
      elapsedMs: 5,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
      source: header.configuration.source,
      frame: { id: 1, name: 'handler', line: 1, column: 1 },
      variables: [],
      facts: Object.entries(OLD_FORMAT_FACT_DISPLAYS).map(([key, display]) => ({
        path: key.slice('value:'.length),
        mode: 'value' as const,
        display,
      })),
      debuggerSnapshot: plainSnapshot({
        name: header.configuration.source.path,
        text: SOURCE_TEXT,
        hash: sha256(SOURCE_TEXT),
        line: 1,
      }),
    })
    await writer.finish('partial', 'The learner stopped this run.')
    harness.service.nodeHistoryStore = store
    const baseUri = `codebook://node-history/${header.studyId}`

    // Act
    const events = await readPaged(harness.service, `${baseUri}/events`)
    const detail = await readPaged(harness.service, `${baseUri}/events/1`)

    // Assert
    assertServedFactsMasked(events.content)
    assertServedFactsMasked(detail.content)
    assert.match(events.content, /"display":"\[masked\]"/)
  } finally {
    await harness.close()
  }
})

// protects=the Node server history's lean events list and stop detail, which the chat reads to cite a stop and its facts; fails_when=a history saved before the shape rules serves a Cookie header, a Basic credential or a callback code from a declared string fact, or masks the plain strings beside them; no_claim=the debugger snapshot of the stop (the detail test above)
test('a Node server history saved with credential-shaped string facts serves its events list and stop detail with those facts masked', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops: 1,
  })
  const writer = await repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: header.declaredRequest.path,
    bodyBytes: 14,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  await writer.appendStop(
    serverStopCapture({
      declaredStopIndex: 0,
      hit: 1,
      line: 2,
      elapsedMs: 10,
      facts: OLD_FORMAT_FACT_DISPLAYS,
    }),
  )
  await writer.appendResponse({
    elapsedMs: 20,
    status: 201,
    contentType: 'application/json',
    body: '{"id":7}',
    bodyBytes: 8,
    readCut: false,
    location: null,
    requestDurationMs: 10,
  })
  await writer.seal({ elapsedMs: 30, reason: 'stopped' })
  harness.service.nodeHistoryStore = repository.testHistories
  harness.service.nodeHistoryRepository = repository
  const baseUri = `codebook://node-history/${header.studyId}`

  // Act
  const events = await readPaged(harness.service, `${baseUri}/events`)
  const stopSequence = (
    events.parsed as { sequence: number; type: string }[]
  ).find((event) => event.type === 'stop')?.sequence
  const detail = await readPaged(
    harness.service,
    `${baseUri}/events/${stopSequence}`,
  )

  // Assert
  assertServedFactsMasked(events.content)
  assertServedFactsMasked(detail.content)
  assert.match(events.content, /"value:cookieHeader":"\[masked\]"/)
})

// protects=the Chrome extension history's lean events list and capture detail, which the chat reads to cite a capture and its facts; fails_when=a history saved before the shape rules serves a Cookie header, a Basic credential or a callback code from a capture's facts, or masks the plain strings beside them; no_claim=the debugger snapshot of the capture (the detail test above) and the pause's own target URL, which identifies the pause
test('a Chrome extension history saved with credential-shaped string facts serves its events list and capture detail with those facts masked', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context)
  const header = extensionHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.extensionHistories.start(header)
  const pauseId = 'old-run:1:page:1'
  const stop = capturedStop({ stopIndex: 1, context: 'page' })
  await writer.appendPauseOpen({
    pauseId,
    generation: 1,
    context: 'page',
    stopIndex: 1,
    targetUrl: stop.targetUrl,
    workerGeneration: 0,
  })
  await writer.appendCapture({
    pauseId,
    path: stop.path,
    line: stop.line,
    sourceHash: stop.sha256,
    sourceBytes: Buffer.byteLength(stop.snapshot.frames[0]?.source?.text ?? ''),
    debuggerSnapshot: stop.snapshot,
    facts: { stopIndex: 1, ...OLD_FORMAT_FACT_DISPLAYS },
  })
  await writer.appendPauseClose({ pauseId, reason: 'continue' })
  await writer.seal()
  harness.service.nodeHistoryRepository = repository
  harness.service.nodeHistoryStore = repository.testHistories
  const baseUri = `codebook://node-history/${header.studyId}`

  // Act
  const events = await readPaged(harness.service, `${baseUri}/events`)
  const detail = await readPaged(harness.service, `${baseUri}/events/2`)

  // Assert
  assert.equal((detail.parsed as { type: string }).type, 'capture')
  assertServedFactsMasked(events.content)
  assertServedFactsMasked(detail.content)
  assert.match(events.content, /"value:cookieHeader":"\[masked\]"/)
})

/** Saves a web study and its recording context in a private directory, and returns the recording store that serves them. */
async function saveWebStudy(
  context: TestContext,
  study: ReturnType<typeof createConfiguredStudy>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-web-study-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const library = new LearningLibrary(directory, study.workspaceKey)
  const store = new RecordingStore(directory, study.workspaceKey)
  await library.saveStudy(study)
  const binding: RecordingBinding = {
    workspaceKey: study.workspaceKey,
    studyId: study.id,
    instanceId: study.instanceId,
    runId: study.runId,
    runtimeId: '99999999-9999-4999-8999-999999999999',
    profile: 'repository-browser',
    sourceBuild: {
      revision: 'unit-fixture',
      dirty: false,
      sourceHash: sha256('build'),
    },
  }
  const writer = await store.start(binding, 0)
  await writer.finish(5000)
  const saved = await store.saveContext(buildRecordingContext(study, [], 1))
  return { study, store, contextHash: saved.hash }
}

/** A saved web study whose only observation holds the snapshot an older version saved, and the recording store that serves its context. */
async function webStudyWithOldSnapshot(context: TestContext) {
  const study = createConfiguredStudy()
  const observation = study.observations[0]!
  observation.debugger = oldFormatSnapshot({
    name: 'src/theme.ts',
    text: observation.source.text,
    hash: observation.source.hash,
    line: observation.source.line,
  })
  return saveWebStudy(context, study)
}

/** A saved web study whose only observation holds the declared string values an older version saved, a Cookie header and a callback URL, one of them cited by its explanation. */
async function webStudyWithOldFacts(context: TestContext) {
  const study = createConfiguredStudy()
  const observation = study.observations[0]!
  const cookieHeader = `sid=${FACT_COOKIE_VALUE}; theme=dark`
  observation.values['value:nextTheme'] = cookieHeader
  observation.values['value:selection'] =
    `https://shop.example/cb?code=${FACT_AUTH_CODE}&page=2`
  observation.interpretations[0]!.facts = [
    { path: 'value:nextTheme', value: cookieHeader },
  ]
  return saveWebStudy(context, study)
}

// protects=the recording context the chat reads for a saved web study; fails_when=the context of a study saved before the shape rules serves an observation's cookie values; no_claim=the learning resource, which lists no snapshot
test('a saved web study with unmasked cookie values serves its recording context masked', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { study, store, contextHash } = await webStudyWithOldSnapshot(context)
  harness.service.recordings = store

  // Act
  const resource = await readResource(
    harness.service,
    `codebook://${harness.service.instanceId}/studies/${study.id}/recording/context/${contextHash}`,
  )
  if (!('text' in resource)) throw new Error('The context is JSON.')

  // Assert
  assertServedMasked(resource.text)
})

// protects=the recording context and the learning resource the chat reads for a saved web study's declared values and the facts its explanations cite; fails_when=a study saved before the shape rules serves a Cookie header or a callback code from an observation's values or an explanation's facts, or masks the plain values beside them; no_claim=the debugger snapshot of the observation (the test above)
test('a saved web study with credential-shaped string values serves its recording context and learning resource with those values masked', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { study, store, contextHash } = await webStudyWithOldFacts(context)
  harness.service.recordings = store
  const contextUri = `codebook://${harness.service.instanceId}/studies/${study.id}/recording/context/${contextHash}`

  // Act
  const whole = await readResource(harness.service, contextUri)
  if (!('text' in whole)) throw new Error('The context is JSON.')
  const learning = await readPaged(harness.service, `${contextUri}/learning`)

  // Assert
  for (const served of [whole.text, learning.content]) {
    for (const secret of [FACT_COOKIE_VALUE, FACT_AUTH_CODE])
      assert.equal(served.includes(secret), false, `the chat reads ${secret}`)
    assert.equal(served.includes('shop.example/cb?code=[masked]&page=2'), true)
    assert.equal(served.includes('"value:enabled":false'), true)
  }
  assert.match(learning.content, /"value:nextTheme":"\[masked\]"/)
  assert.match(
    JSON.stringify(
      (learning.parsed as { observations: { interpretations: unknown }[] })
        .observations[0]?.interpretations,
    ),
    /"value":"\[masked\]"/,
  )
})

/** Lists the source files under `directory` that the reader scan reads, relative to it. */
async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    withFileTypes: true,
    recursive: true,
  })
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !relative(directory, join(entry.parentPath, entry.name)).startsWith(
          'tests',
        ),
    )
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort()
}

// protects=every module that reads saved debugger history applies the saved-history masks before it serves it; fails_when=a new module parses replayDebugSnapshotSchema without being classified here, a serving reader or detail resource stops calling maskSavedDebugSnapshot, a paged resource serves a debuggerSnapshot without it, or a module that serves saved facts stops calling maskSavedFacts; no_claim=that the masks are correct (the detail resource tests above)
test('every reader of saved debugger history is classified and each serving reader applies maskSavedDebugSnapshot and maskSavedFacts', async () => {
  // Arrange
  const sourceRoot = join(__dirname, '..', '..', 'src')
  const files = await listSourceFiles(sourceRoot)
  const texts = new Map<string, string>()
  for (const file of files)
    texts.set(file, await readFile(join(sourceRoot, file), 'utf8'))
  /** Declare the snapshot field of a saved shape and never serve it. */
  const schemaDeclarers = [
    'chromeExtensionHistorySchemas.ts',
    'configuredStudySchemas.ts',
    'nodeServerHistorySchemas.ts',
    'nodeTestHistorySchemas.ts',
    'replayDebugSchemas.ts',
  ]
  /** Parse what the capture just produced; the capture masks it itself. */
  const captureWriters = ['utils/captureReplayDebugSnapshot.ts']
  /** Parse a saved snapshot to serve or replay it. */
  const servingReaders = [
    'replayDebugAdapter.ts',
    'utils/rehydrateServerStopSnapshot.ts',
  ]
  /** Serve a saved snapshot, or the entry that holds it, to the chat. */
  const servingResources = [
    'resources.ts',
    'utils/readExtensionHistoryResource.ts',
    'utils/readRecordingResource.ts',
    'utils/readTestHistoryEvents.ts',
    'nodeServerHistorySink.ts',
  ]
  /** Serve the facts of a saved stop or study, in a list, a detail entry, a replay model or a recording context. */
  const factServingModules = [
    'resources.ts',
    'utils/readExtensionHistoryResource.ts',
    'utils/readRecordingResource.ts',
    'utils/readServerHistoryResource.ts',
    'utils/readTestHistoryEvents.ts',
    'utils/rehydrateServerStopSnapshot.ts',
  ]
  const classified = new Set([
    ...schemaDeclarers,
    ...captureWriters,
    ...servingReaders,
  ])

  // Act
  const schemaReaders = files.filter((file) =>
    /\breplayDebugSnapshotSchema\b/.test(texts.get(file)!),
  )
  const unmaskedServing = [...servingReaders, ...servingResources].filter(
    (file) => !/\bmaskSavedDebugSnapshot\b/.test(texts.get(file) ?? ''),
  )
  const pagedWithoutMask = files.filter((file) => {
    const text = texts.get(file)!
    return (
      /\bdebuggerSnapshot\b/.test(text) &&
      /\b(?:readJsonPage|readMaskedJsonPage)\(/.test(text) &&
      !/\bmaskSavedDebugSnapshot\b/.test(text)
    )
  })
  const unmaskedFactServing = factServingModules.filter(
    (file) => !/\bmaskSavedFacts\b/.test(texts.get(file) ?? ''),
  )
  const factsPagedWithoutMask = files.filter((file) => {
    const text = texts.get(file)!
    return (
      /\.facts\b/.test(text) &&
      /\b(?:readJsonPage|readMaskedJsonPage)\(/.test(text) &&
      !/\bmaskSavedFacts\b/.test(text)
    )
  })
  // The server history resource reaches the mask through the rehydration it calls.
  const serverResourceRehydrates = /\brehydrateNodeServerEntries\(/.test(
    texts.get('utils/readServerHistoryResource.ts')!,
  )

  // Assert
  assert.deepEqual(
    schemaReaders.filter((file) => !classified.has(file)),
    [],
    'a module parses replayDebugSnapshotSchema without being classified as a declarer, a capture writer or a serving reader',
  )
  assert.deepEqual(unmaskedServing, [])
  assert.deepEqual(pagedWithoutMask, [])
  assert.deepEqual(unmaskedFactServing, [])
  assert.deepEqual(factsPagedWithoutMask, [])
  assert.equal(serverResourceRehydrates, true)
})

// protects=every module that serves saved test or server output, a result's output tail, a request path or a redirect location applies the output masks before it serves it; fails_when=a serving reader stops calling maskSavedOutputEntries or maskSavedServerEntries, a new module pages output entries without them, or the server entries mask stops covering the output, the request path or the location; no_claim=that the masks are correct (the serving tests of savedHistoryServingMasks and maskSavedOutputEntries)
test('each module that serves saved output, a request path or a redirect location applies the output masks', async () => {
  // Arrange
  const sourceRoot = join(__dirname, '..', '..', 'src')
  const files = await listSourceFiles(sourceRoot)
  const texts = new Map<string, string>()
  for (const file of files)
    texts.set(file, await readFile(join(sourceRoot, file), 'utf8'))
  /** Serve saved output, a result's tail or a server entry's path or location to the chat or the Study pane. */
  const outputServingModules = [
    'utils/readServerHistoryResource.ts',
    'utils/readTestHistoryEvents.ts',
    'utils/rehydrateServerStopSnapshot.ts',
    'utils/sanitizeNodeTestHistory.ts',
  ]
  const outputMask = /\bmaskSaved(?:Output|Server)Entries\b/

  // Act
  const unmaskedOutputServing = outputServingModules.filter(
    (file) => !outputMask.test(texts.get(file) ?? ''),
  )
  const pagedOutputWithoutMask = files.filter((file) => {
    const text = texts.get(file)!
    return (
      /\b(?:readJsonPage|readMaskedJsonPage)\(/.test(text) &&
      /(?:case|===) 'output'/.test(text) &&
      !outputMask.test(text)
    )
  })
  const serverEntriesMask = texts.get('utils/maskSavedServerEntries.ts') ?? ''

  // Assert
  assert.deepEqual(unmaskedOutputServing, [])
  assert.deepEqual(pagedOutputWithoutMask, [])
  assert.match(serverEntriesMask, /\bmaskSavedOutputEntries\(/)
  assert.match(serverEntriesMask, /\bmaskSecretQueryValues\(entry\.path\)/)
  assert.match(serverEntriesMask, /\bmaskSecretQueryValues\(entry\.location\)/)
})

// protects=the recorded source text, which the replay checks by SHA-256; fails_when=a source whose text quotes a Cookie header is changed by the mask, so its hash no longer matches and the replay refuses it; no_claim=a secret written into the source text itself, which is the learner's own code
test('a recorded source text that quotes a Cookie header is kept byte for byte while the values beside it are masked', () => {
  // Arrange
  const snapshot = oldFormatSnapshot({
    name: 'src/handler.ts',
    text: SOURCE_TEXT,
    hash: SOURCE_HASH,
    line: 2,
  })

  // Act
  const masked = maskSavedDebugSnapshot(snapshot)

  // Assert
  assert.equal(masked.frames[0]?.source?.text, SOURCE_TEXT)
  assert.equal(sha256(masked.frames[0]?.source?.text ?? ''), SOURCE_HASH)
  assert.equal(SOURCE_TEXT.includes('Cookie: a=1; b=2'), true)
  assert.equal(JSON.stringify(masked).includes(COOKIE_VALUE), false)
})
