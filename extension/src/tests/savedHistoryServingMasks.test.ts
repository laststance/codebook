import assert from 'node:assert/strict'
import { join } from 'node:path'
import { before, test } from 'node:test'

import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import type { ReplayDebugSnapshot } from '../replayDebugSchemas'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { buildServerReplayModel } from '../utils/buildServerReplayModel'

import { createHarness } from './helpers'
import {
  capturedStop,
  extensionHistoryHeader,
} from './utils/chromeExtensionHistoryFixture'
import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
  serverStopCapture,
} from './utils/nodeServerHistoryFixture'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

// The values below are what a history saved by 0.2.73.1 or earlier holds: made-up opaque values that only the shape of their line, string or URL marks as credentials.
const SESSION_VALUE = ['opaque', 'session', 'value', '4f9c2d71'].join('-')
const BASIC_CREDENTIAL = ['dXNlcjpw', 'YXNzd29y', 'ZHZhbHVl'].join('')
const CALLBACK_CODE = ['callback', 'code', '8e1b3a65'].join('-')
const RESET_TOKEN = ['reset', 'token', '27d0c5ab'].join('-')
const CREDENTIALS = [
  SESSION_VALUE,
  BASIC_CREDENTIAL,
  CALLBACK_CODE,
  RESET_TOKEN,
]
/** The first line a saved output holds, in two halves so that no saved entry holds the whole Cookie line. */
const COOKIE_LINE_FIRST_HALF = `Cookie: sid=${SESSION_VALUE.slice(0, 8)}`
const COOKIE_LINE_SECOND_HALF = `${SESSION_VALUE.slice(8)}; theme=dark\n`
const AUTHORIZATION_LINE = `Authorization: Basic ${BASIC_CREDENTIAL}\n`
const SOURCE_TEXT = 'const nextTheme = "dark";\n'

/** Fails when any scripted credential appears in the served text. */
function assertNoCredential(served: string): void {
  for (const credential of CREDENTIALS)
    assert.equal(
      served.includes(credential),
      false,
      `the chat reads ${credential}`,
    )
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

/** A snapshot with no credential in it, so an assertion about output reads nothing the snapshot rule masks. */
function plainSnapshot(path: string): ReplayDebugSnapshot {
  return {
    version: 1,
    frames: [
      {
        name: 'applyTheme',
        line: 1,
        column: 1,
        source: {
          name: path,
          text: SOURCE_TEXT,
          hash: sha256(SOURCE_TEXT),
          line: 1,
        },
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
    variables: [
      { name: 'nextTheme', value: 'dark', type: 'string', children: [] },
    ],
    limitations: [],
  }
}

// protects=the test history's events list and every entry detail the chat reads for a history saved before the shape rules, with the Cookie line split over two output entries, an Authorization line, a Cookie fact and a result output tail; fails_when=any list row or detail serves the Cookie value, the Basic credential or the tail's lines as saved; no_claim=the debugger snapshot of the stop (savedDebugHistoryMasking tests)
test('a test history saved with Cookie and Authorization output serves its events list and every entry detail without them', async () => {
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
    await writer.appendOutput({
      sequence: 1,
      elapsedMs: 1,
      channel: 'stdout',
      text: COOKIE_LINE_FIRST_HALF,
    })
    await writer.appendOutput({
      sequence: 2,
      elapsedMs: 2,
      channel: 'stdout',
      text: `${COOKIE_LINE_SECOND_HALF}${AUTHORIZATION_LINE}ready\n`,
    })
    await writer.appendStop({
      index: 0,
      runId: 'test-run',
      sessionId: 'test-session',
      threadId: 1,
      elapsedMs: 5,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
      source: header.configuration.source,
      frame: { id: 1, name: 'applyTheme', line: 1, column: 1 },
      variables: [],
      facts: [
        {
          path: 'cookieHeader',
          mode: 'value',
          display: `'sid=${SESSION_VALUE}; theme=dark'`,
        },
      ],
      debuggerSnapshot: plainSnapshot(header.configuration.source.path),
    })
    await writer.appendResult(
      {
        exitCode: 1,
        signal: null,
        output: `not ok 1\n${AUTHORIZATION_LINE}Cookie: sid=${SESSION_VALUE}; theme=dark\n`,
      },
      9,
    )
    await writer.finish('partial', 'The learner stopped this run.')
    harness.service.nodeHistoryStore = store
    const baseUri = `codebook://node-history/${header.studyId}`

    // Act
    const events = await readPaged(harness.service, `${baseUri}/events`)
    const details = []
    for (let sequence = 1; sequence <= 4; sequence++)
      details.push(
        await readPaged(harness.service, `${baseUri}/events/${sequence}`),
      )

    // Assert
    assertNoCredential(events.content)
    for (const detail of details) assertNoCredential(detail.content)
    const outputTexts = (
      events.parsed as { type: string; text?: string }[]
    ).flatMap((event) => (event.type === 'output' ? [event.text] : []))
    assert.equal(
      outputTexts.join(''),
      'Cookie: [masked]\nAuthorization: [masked]\nready\n',
    )
    assert.equal(
      (details[3]?.parsed as { outputTail: string }).outputTail,
      'not ok 1\nAuthorization: [masked]\nCookie: [masked]\n',
    )
  } finally {
    await harness.close()
  }
})

// protects=the Node server history's events list, every entry detail and the Study pane's replay model for a history saved before the shape rules, with a Cookie line split over two outputs, a request path and a redirect location holding a callback code or a token, and a Cookie fact; fails_when=any list row, detail or model event serves a credential as saved; no_claim=the response body, which keeps the live run's own redaction
test('a Node server history saved with Cookie output and code or token URLs serves its events list, every entry detail and its replay model without them', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops: 1,
  })
  const writer = await repository.serverHistories.start(header)
  await writer.appendOutput({
    elapsedMs: 1,
    channel: 'stdout',
    text: COOKIE_LINE_FIRST_HALF,
  })
  await writer.appendOutput({
    elapsedMs: 2,
    channel: 'stdout',
    text: `${COOKIE_LINE_SECOND_HALF}${AUTHORIZATION_LINE}listening\n`,
  })
  // The entries are appended as an older version saved them: the writer masks a new path and location itself.
  await writer.appendEntry({
    type: 'request',
    elapsedMs: 3,
    attempt: 1,
    method: 'GET',
    path: `/login/callback?code=${CALLBACK_CODE}&state=xyz`,
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 4, attempt: 1 })
  await writer.appendStop(
    serverStopCapture({
      declaredStopIndex: 0,
      hit: 1,
      line: 2,
      elapsedMs: 10,
      facts: { 'value:cookieHeader': `'sid=${SESSION_VALUE}; theme=dark'` },
    }),
  )
  await writer.appendEntry({
    type: 'response',
    elapsedMs: 20,
    status: 302,
    contentType: null,
    body: '',
    bodyBytes: 0,
    readCut: false,
    // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every served text.
    location: `/welcome?token=${RESET_TOKEN}&page=2`,
    requestDurationMs: 10,
  })
  await writer.seal({ elapsedMs: 30, reason: 'stopped' })
  harness.service.nodeHistoryStore = repository.testHistories
  harness.service.nodeHistoryRepository = repository
  const baseUri = `codebook://node-history/${header.studyId}`
  const stored = await repository.serverHistories.read(header.studyId)

  // Act
  const events = await readPaged(harness.service, `${baseUri}/events`)
  const details = []
  for (const entry of stored.entries)
    details.push(
      await readPaged(harness.service, `${baseUri}/events/${entry.sequence}`),
    )
  const model = buildServerReplayModel(stored, {
    saved: true,
    captureComplete: true,
    learningCoverage: 'complete',
  })

  // Assert
  assertNoCredential(events.content)
  for (const detail of details) assertNoCredential(detail.content)
  assertNoCredential(JSON.stringify(model.events))
  const servedEvents = events.parsed as {
    type: string
    text?: string
    path?: string
  }[]
  assert.equal(
    servedEvents
      .flatMap((event) => (event.type === 'output' ? [event.text] : []))
      .join(''),
    'Cookie: [masked]\nAuthorization: [masked]\nlistening\n',
  )
  assert.equal(
    servedEvents.find((event) => event.type === 'request')?.path,
    '/login/callback?code=[masked]&state=xyz',
  )
  const response = details.find(
    (detail) => (detail.parsed as { type: string }).type === 'response',
  )
  assert.equal(
    (response?.parsed as { location: string }).location,
    // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every served text.
    '/welcome?token=[masked]&page=2',
  )
})

// protects=the Chrome extension history's events list and result detail for a history saved before the shape rules, whose before and after reads and cause hold a Cookie-shaped string, a Basic credential and a callback code; fails_when=the list or the detail serves a result's observed value or cause as saved; no_claim=the capture's own facts and snapshot (savedDebugHistoryMasking tests)
test('a Chrome extension history saved with Cookie-shaped observed values serves its events list and result detail without them', async (context) => {
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
    facts: { stopIndex: 1 },
  })
  await writer.appendPauseClose({ pauseId, reason: 'continue' })
  await writer.appendResult({
    outcome: 'changed',
    before: { value: `sid=${SESSION_VALUE}; theme=dark` },
    after: {
      value: {
        header: `Basic ${BASIC_CREDENTIAL}`,
        callback: `https://shop.example/cb?code=${CALLBACK_CODE}&page=2`,
        preference: 'theme=dark',
      },
    },
    cause: `reload https://shop.example/cb?code=${CALLBACK_CODE}&page=2`,
  })
  await writer.seal()
  harness.service.nodeHistoryRepository = repository
  harness.service.nodeHistoryStore = repository.testHistories
  const baseUri = `codebook://node-history/${header.studyId}`

  // Act
  const events = await readPaged(harness.service, `${baseUri}/events`)
  const detail = await readPaged(harness.service, `${baseUri}/events/4`)

  // Assert
  assert.equal((detail.parsed as { type: string }).type, 'result')
  assertNoCredential(events.content)
  assertNoCredential(detail.content)
  const result = detail.parsed as {
    before: unknown
    after: unknown
    cause: string
  }
  assert.deepEqual(result.before, { value: '[masked]' })
  assert.deepEqual(result.after, {
    value: {
      header: '[masked]',
      callback: 'https://shop.example/cb?code=[masked]&page=2',
      preference: 'theme=dark',
    },
  })
  assert.equal(
    result.cause,
    'reload https://shop.example/cb?code=[masked]&page=2',
  )
})
