import assert from 'node:assert/strict'
import fsPromises from 'node:fs/promises'
import { join } from 'node:path'
import { before, test } from 'node:test'

import {
  NODE_SERVER_OUTPUT_TEXT_LIMIT_CHARS,
  NODE_SERVER_RESPONSE_BODY_LIMIT_CHARS,
} from '../constants'
import { NodeServerHistorySinkImpl } from '../nodeServerHistorySink'
import { NodeServerLearningSave } from '../nodeServerLearningSave'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { describeServerReplayRow } from '../utils/describeNodeServerReplay'
import { presentServerHistory } from '../utils/presentServerHistory'

import { createHarness } from './helpers'
import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
  serverStopCapture,
} from './utils/nodeServerHistoryFixture'
import {
  createHarness as createRunHarness,
  readyHarness,
  RESPONSE_200,
  until,
} from './utils/nodeServerRunHarness'
import { realProcessStart } from './utils/realProcessStart'
import { debuggerCapture } from './utils/serverRunCapture'
import { startHistoryServerRun } from './utils/startHistoryServerRun'

before(async () => {
  await realProcessStart(process.pid)
})

/** A sink over a real writer of a one-stop server history, as the run feeds it. */
async function sinkOverHistory(
  context: Parameters<typeof openServerRepository>[0],
  declaredStops = 1,
) {
  const { repository, learningDirectory } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops,
  })
  const writer = await repository.serverHistories.start(header)
  const sink = new NodeServerHistorySinkImpl({
    writer,
    sanitize: (text) => text,
  })
  return {
    sink,
    writer,
    repository,
    learningDirectory,
    store: repository.serverHistories,
    studyId: header.studyId,
  }
}

/**
 * Makes text of exactly `length` UTF-16 units that is heavy in escapes and astral characters: a control character, a quote, a backslash and an emoji per five units.
 * @param length - The length in UTF-16 units, at least 5.
 * @returns The text.
 * @example heavyText(10) // => '😀\u0001"\\😀\u0001"\\'
 */
function heavyText(length: number): string {
  const unit = '😀\u0001"\\'
  return (
    unit.repeat(Math.floor(length / unit.length)) +
    'x'.repeat(length % unit.length)
  )
}

// protects=a run whose launch took long and whose response came fast keeps every elapsedMs of the history non-decreasing, with the request duration its own field; fails_when=the response's own short duration is used as a journal time and the history reads time moving back; no_claim=the real clock
test('a long start followed by a fast response keeps the history monotonic', async (context) => {
  // Arrange
  const { sink, writer, store, studyId } = await sinkOverHistory(context)
  const harness = await readyHarness({
    history: sink,
    capture: () => debuggerCapture({ line: 2 }),
  })
  // The server has been up for 4.9 s when the request goes out; the response itself took 21 ms.
  let launchedMs = 4_900
  harness.server.elapsedMs = () => launchedMs

  // Act
  await harness.run.sendRequest('key-1')
  launchedMs = 4_925
  harness.sender.response.resolve(RESPONSE_200)
  await until(harness, (view) => view.state === 'responded')
  await writer.seal({ elapsedMs: 5_000, reason: 'stopped' })
  const history = await store.read(studyId)

  // Assert
  const times = history.entries.map((entry) => entry.elapsedMs)
  assert.deepEqual(
    times,
    [...times].sort((left, right) => left - right),
  )
  const request = history.entries.find((entry) => entry.type === 'request')
  assert.equal(request?.elapsedMs, 4_900)
  assert.equal(
    history.entries.some((entry) => entry.type === 'response'),
    true,
  )
  const response = history.entries.find((entry) => entry.type === 'response')
  assert.equal(
    response?.type === 'response' ? response.requestDurationMs : undefined,
    21,
  )
})

// protects=a Stop while the run is still preparing (its readiness and ownership checks not done) leaves the run stopped and, once the history seals, no history folder; fails_when=a history with no request is kept as a saved replay or the run reads another state; no_claim=the service's own receipts
test('a Stop before the launch completes seals no history and leaves the run stopped', async (context) => {
  // Arrange
  const { sink, writer, store, learningDirectory, studyId } =
    await sinkOverHistory(context)
  const harness = createRunHarness({
    history: sink,
    waitForReadiness: ({ signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        }),
      ),
  })
  const preparing = harness.run.prepare().catch(() => undefined)
  await harness.readinessStarted

  // Act
  await harness.run.stop()
  await preparing
  await writer.seal({ elapsedMs: 1, reason: 'stopped' })
  const listed = await store.list()
  const folderExists = await fsPromises
    .stat(join(learningDirectory, 'node-servers.v1', studyId))
    .then(
      () => true,
      () => false,
    )

  // Assert
  assert.equal(harness.run.view().state, 'stopped')
  assert.deepEqual(listed, [])
  assert.equal(folderExists, false)
})

// protects=with a slow fsync, output offered while 4 MiB of stops are pending is dropped under SERVER_HISTORY_OUTPUT_TRUNCATED while the request, every stop and the response are written; fails_when=a slow disk makes the queue refuse a structural entry or the code is missing; no_claim=the exact number of dropped chunks
test('a slow fsync with output past its bound drops output under the truncation code and still writes the request, the stops and the response', async (context) => {
  // Arrange
  const { writer, store, studyId } = await sinkOverHistory(context, 8)
  const openBefore = fsPromises.open
  context.mock.method(
    fsPromises,
    'open',
    async (...input: Parameters<typeof openBefore>) => {
      const handle = await openBefore(...input)
      const syncBefore = handle.sync.bind(handle)
      handle.sync = async (): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return syncBefore()
      }
      return handle
    },
  )
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/api/items',
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  // Eight distinct sources of 512 KiB each hold 4 MiB in the queue while the disk is slow.
  const largeStops = Array.from({ length: 8 }, (_, index) => {
    const text = `${String(index)}${'x'.repeat(524_287)}`
    const capture = serverStopCapture({
      declaredStopIndex: index,
      hit: 1,
      line: 2,
      elapsedMs: 10 + index,
      text,
    })
    return { ...capture, source: { ...capture.source, hash: sha256(text) } }
  })

  // Act
  const stops = largeStops.map((capture) => writer.appendStop(capture))
  const output = writer.appendOutput({
    elapsedMs: 30,
    channel: 'stdout',
    text: 'dropped while the queue is full\n',
  })
  const response = writer.appendResponse({
    elapsedMs: 31,
    status: 200,
    contentType: null,
    body: '',
    bodyBytes: 0,
    readCut: false,
    location: null,
    requestDurationMs: 9,
  })
  await Promise.all([...stops, output, response])
  await writer.seal({ elapsedMs: 40, reason: 'stopped' })
  context.mock.restoreAll()
  const opened = await store.read(studyId)

  // Assert
  const types = opened.entries.map((entry) => entry.type)
  assert.equal(types.includes('request'), true)
  assert.equal(types.filter((type) => type === 'stop').length, 8)
  assert.equal(types.includes('response'), true)
  assert.equal(types.filter((type) => type === 'output').length, 0)
  assert.equal(
    opened.seal?.reasons.some(
      (reason) => reason.code === 'SERVER_HISTORY_OUTPUT_TRUNCATED',
    ),
    true,
  )
})

// protects=entries at their maximum size and heavy in escapes and astral characters stay within the journal's bounds and read back exactly; fails_when=a maximal output, frame name, location or body is cut, re-encoded or refused; no_claim=terminal safety of what the panes print
test('maximal Unicode- and escape-heavy entries are written within bounds and read back unchanged', async (context) => {
  // Arrange
  const { writer, store, studyId } = await sinkOverHistory(context)
  const output = heavyText(NODE_SERVER_OUTPUT_TEXT_LIMIT_CHARS)
  const body = heavyText(NODE_SERVER_RESPONSE_BODY_LIMIT_CHARS)
  const location = heavyText(2_048)
  const frameName = heavyText(2_048)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/api/items',
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })

  // Act
  await writer.appendOutput({ elapsedMs: 3, channel: 'stderr', text: output })
  await writer.appendStop({
    ...serverStopCapture({
      declaredStopIndex: 0,
      hit: 1,
      line: 2,
      elapsedMs: 4,
    }),
    frameName,
  })
  await writer.appendResponse({
    elapsedMs: 5,
    status: 302,
    contentType: 'text/plain; charset=utf-8',
    body,
    bodyBytes: Buffer.byteLength(body),
    readCut: false,
    location,
    requestDurationMs: 3,
  })
  await writer.seal({ elapsedMs: 6, reason: 'stopped' })
  const opened = await store.read(studyId)

  // Assert
  const byType = (type: string) =>
    opened.entries.find((entry) => entry.type === type)
  const outputEntry = byType('output')
  const stopEntry = byType('stop')
  const responseEntry = byType('response')
  assert.equal(outputEntry?.type === 'output' ? outputEntry.text : '', output)
  assert.equal(
    stopEntry?.type === 'stop' ? stopEntry.frame.name : '',
    frameName,
  )
  assert.equal(
    responseEntry?.type === 'response' ? responseEntry.body : '',
    body,
  )
  assert.equal(
    responseEntry?.type === 'response' ? responseEntry.location : '',
    location,
  )
  assert.equal(opened.status, 'complete')
})

// protects=Save before the response seals a partial history whose reasons survive a restart: the row and the replay name why no response was recorded and the stop still replays; fails_when=the reasons are lost with the window, the row reads complete, or the stop is missing from the replay; no_claim=the editor's rendering of the row
test('Save before the response seals partial and, after a restart, the row and the replay show the reasons and the stop replays', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const opened = await openServerRepository(context)
  const started = await startHistoryServerRun(harness, context, {
    repository: opened.repository,
  })
  const { service, record, run, repository } = started
  const save = new NodeServerLearningSave({
    service: () => service,
    store: () => repository.serverHistories,
    ask: async () => 'Save and stop',
    notify: async () => undefined,
    materialRevision: () => undefined,
    open: async () => undefined,
    log: () => undefined,
    changed: () => undefined,
  })
  await run.sendRequest('k1')
  run.pauseAt(0)
  const studyId = `${service.instanceId}_${record.id}`

  // Act
  await save.save(record)
  const restarted = (
    await openServerRepository(context, {
      learningDirectory: opened.learningDirectory,
    })
  ).repository.serverHistories
  const [summary] = await restarted.list()
  const replay = presentServerHistory(
    await restarted.read(studyId),
    await restarted.summarize(studyId),
  )

  // Assert
  assert.equal(summary?.status, 'partial')
  assert.match(
    describeServerReplayRow(summary),
    /Server replay · GET \/api\/healthz → no response · Partial/,
  )
  assert.equal(
    replay.captureReasons.some((reason) =>
      /No response was recorded/.test(reason),
    ),
    true,
  )
  assert.equal(
    replay.model.events.filter((event) => event.type === 'stop').length,
    1,
  )
})
