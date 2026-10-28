import assert from 'node:assert/strict'
import { join } from 'node:path'
import { before, test } from 'node:test'

import { NodeServerHistorySinkImpl } from '../nodeServerHistorySink'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import { readHistoryFolderText } from './utils/readHistoryFolderText'
import { realProcessStart } from './utils/realProcessStart'
import { debuggerCapture } from './utils/serverRunCapture'

before(async () => {
  await realProcessStart(process.pid)
})

/** Starts a server history with two declared stops and a sink over it whose coalescing timer a test fires by hand. */
async function startSink(context: Parameters<typeof openServerRepository>[0]) {
  const { repository, learningDirectory } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops: 2,
  })
  const writer = await repository.serverHistories.start(header)
  let fire: (() => void) | undefined
  const sink = new NodeServerHistorySinkImpl({
    writer,
    sanitize: (text) => text,
    schedule: (callback) => {
      fire = callback
      return (): void => {
        fire = undefined
      }
    },
  })
  return {
    sink,
    writer,
    store: repository.serverHistories,
    studyId: header.studyId,
    folder: join(learningDirectory, 'node-servers.v1', header.studyId),
    fireTimer: () => fire?.(),
  }
}

const RESPONSE = {
  status: 200,
  contentType: 'application/json',
  body: '{"ok":true}',
  bodyBytes: 11,
  readCut: false,
  elapsedMs: 30,
}

// protects=consecutive output chunks of one channel within 50 ms become one entry while the request and the response stay their own entries; fails_when=chunks are written one by one, or a structural entry is merged into output; no_claim=real server timing
test('output chunks within 50 ms are one history entry and the request is never merged into them', async (context) => {
  // Arrange
  const { sink, writer, store, studyId } = await startSink(context)

  // Act
  sink.output(5, 'stdout', 'listening ')
  sink.output(30, 'stdout', 'on 4100\n')
  sink.output(200, 'stdout', 'later\n')
  sink.openRequest(210, { method: 'POST', path: '/api/items', bodyBytes: 14 })
  sink.markRequestSent(211)
  sink.response(240, RESPONSE)
  await writer.seal({ elapsedMs: 300, reason: 'stopped' })
  const history = await store.read(studyId)

  // Assert
  assert.deepEqual(
    history.entries.map((entry) =>
      entry.type === 'output' ? `output:${entry.text}` : entry.type,
    ),
    [
      'output:listening on 4100\n',
      'output:later\n',
      'request',
      'request-sent',
      'response',
      'end',
    ],
  )
})

// protects=a token in server output never reaches a file of the history, even when it arrives split between two chunks; fails_when=output is masked per chunk (a split token survives) or not at all; no_claim=secrets of a shape the contract does not detect
test('a bearer token split between two output chunks is masked in every file of the history', async (context) => {
  // Arrange
  const { sink, writer, folder } = await startSink(context)

  // Act
  sink.output(1, 'stdout', 'Authorization: Bearer abcdef')
  sink.output(2, 'stdout', 'ghij12345 sent\n')
  sink.openRequest(5, {
    method: 'GET',
    path: ['/api/x', 'token=canaryvalue1'].join('?'),
    bodyBytes: 0,
  })
  await writer.seal({ elapsedMs: 10, reason: 'stopped' })
  const files = await readHistoryFolderText(folder)

  // Assert
  assert.doesNotMatch(files, /abcdefghij12345/)
  assert.match(files, /Bearer \[masked\]/)
  assert.doesNotMatch(files, /canaryvalue1/)
})

// protects=one clock: an entry reported with an earlier time than the one before it carries the later time, so the journal's time never moves back and the run seals complete; fails_when=a late report writes an earlier time and the writer refuses it; no_claim=real clocks
test('a report with an earlier time than the entry before it keeps the history monotonic and complete', async (context) => {
  // Arrange
  const { sink, writer, store, studyId } = await startSink(context)

  // Act
  sink.openRequest(500, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.markRequestSent(100)
  sink.stop(90, { declaredStopIndex: 0 }, 1, debuggerCapture({ line: 2 }))
  sink.stop(80, { declaredStopIndex: 1 }, 2, debuggerCapture({ line: 3 }))
  sink.response(70, RESPONSE)
  await writer.seal({ elapsedMs: 10, reason: 'stopped' })
  const history = await store.read(studyId)

  // Assert
  const times = history.entries.map((entry) => entry.elapsedMs)
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b),
  )
  assert.equal(history.status, 'complete')
})

// protects=a refused send followed by a successful retry is two attempts in the journal and the history reads complete; fails_when=the retry reuses attempt 1 or the withdrawal is not recorded; no_claim=the run's own retry rules
test('a refused send then a successful retry records two attempts and a withdrawal', async (context) => {
  // Arrange
  const { sink, writer, store, studyId } = await startSink(context)

  // Act
  sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.withdrawRequest(11, 'LISTENER_NOT_OWNED')
  sink.openRequest(20, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.markRequestSent(21)
  sink.stop(30, { declaredStopIndex: 0 }, 1, debuggerCapture({ line: 2 }))
  sink.stop(31, { declaredStopIndex: 1 }, 2, debuggerCapture({ line: 3 }))
  sink.response(40, RESPONSE)
  await writer.seal({ elapsedMs: 50, reason: 'stopped' })
  const history = await store.read(studyId)

  // Assert
  assert.deepEqual(
    history.entries
      .filter((entry) => entry.type.startsWith('request'))
      .map((entry) => [entry.type, 'attempt' in entry ? entry.attempt : 0]),
    [
      ['request', 1],
      ['request-withdrawn', 1],
      ['request', 2],
      ['request-sent', 2],
    ],
  )
  assert.equal(history.status, 'complete')
})

// protects=the response is stored exactly as the live run shows it, a body of several KiB included, with the request's duration as its own field; fails_when=the body is cut to the 4 KiB journal detail or the duration replaces the journal time; no_claim=the shaping of the body (shapeResponseBody tests)
test('a 6 KiB response body is stored as shown with the request duration beside the journal time', async (context) => {
  // Arrange
  const { sink, writer, store, studyId } = await startSink(context)
  const body = `{"rows":"${'x'.repeat(6_000)}"}`

  // Act
  sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.markRequestSent(11)
  sink.response(90, {
    ...RESPONSE,
    body,
    bodyBytes: body.length,
    elapsedMs: 79,
  })
  await writer.seal({ elapsedMs: 95, reason: 'stopped' })
  const response = (await store.read(studyId)).entries.find(
    (entry) => entry.type === 'response',
  )

  // Assert
  assert.equal(response?.type === 'response' && response.body, body)
  assert.equal(response?.type === 'response' && response.requestDurationMs, 79)
  assert.equal(response?.elapsedMs, 90)
})

// protects=a response reported before the sent mark still gets its mark first, so the journal rule "answers only a sent request" holds; fails_when=the response is refused and the history seals partial; no_claim=the run's own order
test('a response that arrives before the sent mark is preceded by the mark', async (context) => {
  // Arrange
  const { sink, writer, store, studyId } = await startSink(context)

  // Act
  sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.response(20, RESPONSE)
  await writer.seal({ elapsedMs: 30, reason: 'stopped' })
  const history = await store.read(studyId)

  // Assert
  assert.deepEqual(
    history.entries.map((entry) => entry.type),
    ['request', 'request-sent', 'response', 'end'],
  )
})

// protects=a sink fault (a stop after the answer) never reaches the live run: nothing throws, the writer is marked failed and the seal names the cause; fails_when=the call throws into the run, or the history seals complete; no_claim=what the run does with a thrown error
test('a stop captured after the response throws nothing and seals the history partial with the cause', async (context) => {
  // Arrange
  const { sink, writer, store, studyId } = await startSink(context)
  sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.markRequestSent(11)
  sink.response(20, RESPONSE)

  // Act
  assert.doesNotThrow(() =>
    sink.stop(25, { declaredStopIndex: 0 }, 1, debuggerCapture()),
  )
  await writer.seal({ elapsedMs: 30, reason: 'stopped' })
  const history = await store.read(studyId)

  // Assert
  assert.equal(history.status, 'partial')
  assert.match(
    history.seal?.reasons.find(
      (reason) => reason.code === 'SERVER_HISTORY_APPEND_FAILED',
    )?.text ?? '',
    /A stop was captured after the request ended/,
  )
})

// protects=a secret planted in the response location, a failure message, a frame name and a fact key reaches no file; fails_when=any of those texts is stored unmasked; no_claim=a secret of a shape the contract does not detect
test('a redaction canary in location, failure message, frame name and fact key reaches no file', async (context) => {
  // Arrange
  const { sink, writer, folder } = await startSink(context)
  const canary = 'Bearer canarycanary123456'

  // Act
  sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.markRequestSent(11)
  sink.stop(
    12,
    { declaredStopIndex: 0 },
    1,
    debuggerCapture({
      frameName: `handler ${canary}`,
      facts: [{ path: `id ${canary}`, mode: 'value', display: canary }],
    }),
  )
  sink.response(20, { ...RESPONSE, location: `/next?x=${canary}` })
  await writer.seal({ elapsedMs: 30, reason: 'stopped' })
  const files = await readHistoryFolderText(folder)

  // Assert
  assert.doesNotMatch(files, /canarycanary123456/)
})

// protects=the end of a history carries the largest accepted time, so a queued later entry never makes the seal partial for time moving backward; fails_when=end takes the time of durable entries only; no_claim=none
test('a seal asked with an earlier time than a queued entry still ends the history complete', async (context) => {
  // Arrange
  const { sink, writer, store, studyId } = await startSink(context)
  sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.markRequestSent(11)
  sink.stop(12, { declaredStopIndex: 0 }, 1, debuggerCapture({ line: 2 }))
  sink.stop(13, { declaredStopIndex: 1 }, 2, debuggerCapture({ line: 3 }))

  // Act
  sink.response(900, RESPONSE)
  await writer.seal({ elapsedMs: 50, reason: 'stopped' })
  const history = await store.read(studyId)

  // Assert
  assert.equal(history.entries.at(-1)?.elapsedMs, 900)
  assert.equal(history.status, 'complete')
})
