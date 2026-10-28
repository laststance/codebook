import assert from 'node:assert/strict'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { before, test } from 'node:test'

import {
  NodeServerHistorySinkImpl,
  type NodeServerHistorySinkInput,
} from '../nodeServerHistorySink'
import { captureProcessOutput } from '../utils/captureProcessOutput'
import {
  createNodeServerJournal,
  type JournaledEvent,
} from '../utils/createNodeServerJournal'
import {
  createRootHider,
  hidePrivateRoots,
  type CauseRoots,
} from '../utils/sanitizeCause'

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
async function startSink(
  context: Parameters<typeof openServerRepository>[0],
  options: {
    sanitize?: (text: string) => string
    roots?: CauseRoots
    schedule?: NonNullable<NodeServerHistorySinkInput['schedule']>
    onAppendFailed?: () => void
  } = {},
) {
  const { repository, learningDirectory } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops: 2,
  })
  const writer = await repository.serverHistories.start(header)
  let fire: (() => void) | undefined
  const sink = new NodeServerHistorySinkImpl({
    writer,
    sanitize: options.sanitize ?? ((text) => text),
    roots: options.roots,
    onAppendFailed: options.onAppendFailed,
    schedule:
      options.schedule ??
      ((callback) => {
        fire = callback
        return (): void => {
          fire = undefined
        }
      }),
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

// protects=a stop whose capture finishes after the response was recorded is dropped without failing the writer, so the history seals complete with request, response and end; fails_when=the late hit marks the writer failed and the seal reads partial with an append failure; no_claim=what the run does with a hit it dropped
test('a stop captured after the response is not written and the history still seals complete', async (context) => {
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
  assert.deepEqual(
    history.entries.map((entry) => entry.type),
    ['request', 'request-sent', 'response', 'end'],
  )
  assert.equal(
    history.seal?.reasons.some(
      (reason) => reason.code === 'SERVER_HISTORY_APPEND_FAILED',
    ),
    false,
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

const PRIVATE_ROOTS: CauseRoots = {
  storage: [],
  workspace: ['/Users/ada/app'],
  home: ['/Users/ada'],
}

/** Lets the stream callbacks of a capture run after a write. */
async function settleStreams(): Promise<void> {
  for (let round = 0; round < 3; round++)
    await new Promise<void>((resolve) => setImmediate(resolve))
}

// protects=a private root split between two output chunks 80 ms apart, or across the 4,096-character event split, is stored in no history file and appears in no live journal entry; fails_when=roots are hidden per chunk or per event after the cut (a split root survives in the sink and the journal); no_claim=storage roots (the run knows the workspace and home only) and roots of a shape hidePrivateRoots does not know
test('a private root split across two chunks 80 ms apart or across the event split reaches no history file and no journal entry', async (context) => {
  // Arrange
  const { sink, writer, folder } = await startSink(context, {
    sanitize: (text) => hidePrivateRoots(text, PRIVATE_ROOTS),
  })
  const journalEvents: JournaledEvent[] = []
  const record = createNodeServerJournal(journalEvents, {
    sanitize: (text) => hidePrivateRoots(text, PRIVATE_ROOTS),
  })
  const stdout = new PassThrough()
  captureProcessOutput(
    { stdout, stderr: new PassThrough() },
    {
      startedAt: process.hrtime.bigint(),
      onOutput: (event) => {
        sink.output(event.elapsedMs, event.channel, event.text)
        record('node-server.output', {
          sequence: event.sequence,
          elapsedMs: event.elapsedMs,
          channel: event.channel,
          text: event.text,
        })
      },
      pendingLimitBytes: 1_048_576,
      overflowMessage: 'unused',
      failurePrefix: 'test capture failed',
      privateRoots: PRIVATE_ROOTS,
    },
  )

  // Act
  stdout.write('cwd is /Users/ada/')
  await settleStreams()
  await new Promise<void>((resolve) => setTimeout(resolve, 80))
  stdout.write('app/src/server.ts\n')
  await settleStreams()
  // The root starts 6 characters before the 4,096-character event split.
  stdout.write(`${'x'.repeat(4_090)}/Users/ada/app/b.ts\n`)
  await settleStreams()
  stdout.end()
  await settleStreams()
  sink.openRequest(9_000, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  await writer.seal({ elapsedMs: 9_100, reason: 'stopped' })
  const files = await readHistoryFolderText(folder)

  // Assert
  assert.doesNotMatch(files, /Users\/ada/)
  assert.match(files, /<workspace>\/src\/server\.ts/)
  assert.doesNotMatch(JSON.stringify(journalEvents), /Users\/ada/)
  assert.match(JSON.stringify(journalEvents), /<workspace>\/src\/server\.ts/)
})

// protects=every free text of a captured snapshot (frame, scope and variable names, values, types, unavailable reasons, source name, limitations) loses the private root and the bearer token while the executed source text stays as it ran; fails_when=any one of those fields is stored as captured; no_claim=the source text's own content
test('a private root and a bearer token in any snapshot text reach no history file', async (context) => {
  // Arrange
  const { sink, writer, folder } = await startSink(context, {
    sanitize: (text) => hidePrivateRoots(text, PRIVATE_ROOTS),
  })
  const base = debuggerCapture({ line: 2 })
  const frame = base.snapshot.frames[0]
  assert.ok(frame?.source)
  const leak = '/Users/ada/app'
  const token = 'Bearer canarycanary123456'
  const capture = {
    ...base,
    snapshot: {
      ...base.snapshot,
      frames: [
        {
          ...frame,
          name: `handler ${leak}`,
          source: { ...frame.source, name: `${leak}/src/handler.ts` },
          sourceUnavailable: `no source in ${leak}`,
          unavailable: `frame ${token} ${leak}`,
          scopes: [
            {
              name: `Local ${leak}`,
              variables: [0],
              unavailable: `scope ${token} ${leak}`,
            },
          ],
        },
      ],
      variables: [
        {
          name: `path ${leak}`,
          value: leak,
          type: `typeof ${leak}`,
          children: [],
          unavailable: `value ${token} ${leak}`,
        },
      ],
      limitations: [`limited ${token} ${leak}`],
    },
  }

  // Act
  sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.markRequestSent(11)
  sink.stop(12, { declaredStopIndex: 0 }, 1, capture)
  sink.response(20, RESPONSE)
  await writer.seal({ elapsedMs: 30, reason: 'stopped' })
  const files = await readHistoryFolderText(folder)

  // Assert
  assert.doesNotMatch(files, /Users\/ada/)
  assert.doesNotMatch(files, /canarycanary123456/)
  assert.match(files, /Local <workspace>/)
  assert.match(files, /value Bearer \[masked\] <workspace>/)
})

// protects=a failed request closes the open attempt and every later report of the sink (second failure, send mark, response, withdrawal) is dropped, so the writer holds no failure and the history keeps its four entries; fails_when=a late report reaches the writer, whose rules refuse it and mark the history failed; no_claim=the run's own order of reports
test('reports after a request failure are dropped and leave the writer unfailed', async (context) => {
  // Arrange
  const { sink, writer, store, studyId } = await startSink(context)
  sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.markRequestSent(11)
  sink.failRequest(20, 'ECONNRESET', 'socket hang up')

  // Act
  sink.failRequest(21, 'ECONNREFUSED', 'second failure')
  sink.markRequestSent(22)
  sink.response(23, RESPONSE)
  sink.withdrawRequest(24, 'LATE')
  await writer.seal({ elapsedMs: 30, reason: 'stopped' })
  const history = await store.read(studyId)

  // Assert
  assert.equal(writer.appendFailure, undefined)
  assert.deepEqual(
    history.entries.map((entry) => entry.type),
    ['request', 'request-sent', 'request-failed', 'end'],
  )
})

// protects=a withdrawal reported after the bytes were sent is dropped, the answer is still recorded and the history seals complete; fails_when=the late withdrawal reaches the writer and marks it failed; no_claim=the run's own retry rule
test('a withdrawal reported after the send mark is dropped and the response still seals complete', async (context) => {
  // Arrange
  const { sink, writer, store, studyId } = await startSink(context)
  sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.markRequestSent(11)

  // Act
  sink.withdrawRequest(12, 'LISTENER_NOT_OWNED')
  sink.response(20, RESPONSE)
  await writer.seal({ elapsedMs: 30, reason: 'stopped' })
  const history = await store.read(studyId)

  // Assert
  assert.equal(writer.appendFailure, undefined)
  assert.deepEqual(
    history.entries.map((entry) => entry.type),
    ['request', 'request-sent', 'response', 'end'],
  )
})

// protects=a stop captured after a withdrawal is dropped without failing the writer, while a stop before any request still marks it failed; fails_when=the late stop is written or faults the history, or the stop with no request at all is silently accepted; no_claim=what the run does with the dropped hit
test('a stop after a withdrawal is dropped and a stop before any request still fails the history', async (context) => {
  // Arrange
  const afterWithdrawal = await startSink(context)
  afterWithdrawal.sink.openRequest(10, {
    method: 'GET',
    path: '/api/x',
    bodyBytes: 0,
  })
  afterWithdrawal.sink.withdrawRequest(11, 'LISTENER_NOT_OWNED')
  const beforeAnyRequest = await startSink(context)

  // Act
  afterWithdrawal.sink.stop(
    12,
    { declaredStopIndex: 0 },
    1,
    debuggerCapture({ line: 2 }),
  )
  beforeAnyRequest.sink.stop(
    12,
    { declaredStopIndex: 0 },
    1,
    debuggerCapture({ line: 2 }),
  )

  await afterWithdrawal.writer.seal({ elapsedMs: 30, reason: 'stopped' })
  await beforeAnyRequest.writer.seal({ elapsedMs: 30, reason: 'stopped' })

  // Assert
  assert.equal(afterWithdrawal.writer.appendFailure, undefined)
  assert.equal(
    beforeAnyRequest.writer.appendFailure?.message,
    'A stop was captured outside an open request.',
  )
})

// protects=a request that failed after its bytes were sent, then Stop, ends with reason stopped, capture partial and one reason: no response because the request failed; fails_when=the failure code is lost, an extra reason appears or the end reason is not stopped; no_claim=the service's read of the same verdict (its own test)
test('a request failure after the send mark followed by Stop seals stopped and partial with only the failed-request reason', async (context) => {
  // Arrange
  const { sink, writer, store, studyId } = await startSink(context)
  sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.markRequestSent(11)
  sink.stop(12, { declaredStopIndex: 0 }, 1, debuggerCapture({ line: 2 }))
  sink.stop(13, { declaredStopIndex: 1 }, 2, debuggerCapture({ line: 3 }))
  sink.failRequest(20, 'ECONNRESET', 'socket hang up')

  // Act
  await writer.seal({ elapsedMs: 900, reason: 'stopped' })
  const history = await store.read(studyId)

  // Assert
  const end = history.entries.at(-1)
  assert.equal(end?.type === 'end' && end.reason, 'stopped')
  assert.equal(history.status, 'partial')
  assert.deepEqual(
    history.seal?.reasons.map((reason) => reason.code),
    ['SERVER_HISTORY_NO_RESPONSE_REQUEST_FAILED'],
  )
})

// protects=after the output budget cut, further chunks cost no sanitizer call and no timer; fails_when=each later chunk is still sanitized, queued and scheduled; no_claim=the budget's own thresholds
test('after the output cut 100 more chunks neither sanitize nor schedule anything', async (context) => {
  // Arrange
  let sanitizeCalls = 0
  let scheduleCalls = 0
  const { sink, writer, folder } = await startSink(context, {
    sanitize: (text) => {
      sanitizeCalls++
      return text
    },
    schedule: () => {
      scheduleCalls++
      return (): void => {}
    },
  })
  const chunk = 'y'.repeat(4_000)
  // A history with no request holds nothing to replay and is not kept.
  sink.openRequest(0, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  // Chunks 100 ms apart each become their own entry until the byte budget cuts.
  for (let index = 0; index < 700; index++)
    sink.output(index * 100, 'stdout', chunk)
  sink.flush()
  assert.equal(writer.outputCut, true)
  const sanitizeBefore = sanitizeCalls
  const scheduleBefore = scheduleCalls

  // Act
  for (let index = 0; index < 100; index++)
    sink.output(80_000 + index * 100, 'stdout', chunk)
  await writer.seal({ elapsedMs: 90_000, reason: 'stopped' })
  const files = await readHistoryFolderText(folder)

  // Assert
  assert.equal(sanitizeCalls - sanitizeBefore, 0)
  assert.equal(scheduleCalls - scheduleBefore, 0)
  assert.equal(files.split('"type":"output-truncated"').length - 1, 1)
})

// protects=a 5,000-character failure message and response location are stored at exactly 2,048 characters and the history seals complete; fails_when=the entry is refused for exceeding its schema bound, or cut at another length; no_claim=the shape of the cut text beyond its length
test('a 5,000-character failure message and location are stored at 2,048 characters and seal complete', async (context) => {
  // Arrange
  const long = 'z'.repeat(5_000)
  const failing = await startSink(context)
  const answering = await startSink(context)

  // Act
  failing.sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  failing.sink.markRequestSent(11)
  failing.sink.failRequest(20, 'ECONNRESET', long)
  await failing.writer.seal({ elapsedMs: 30, reason: 'stopped' })
  answering.sink.openRequest(10, {
    method: 'GET',
    path: '/api/x',
    bodyBytes: 0,
  })
  answering.sink.markRequestSent(11)
  answering.sink.response(20, { ...RESPONSE, location: `/next/${long}` })
  await answering.writer.seal({ elapsedMs: 30, reason: 'stopped' })
  const failed = (await failing.store.read(failing.studyId)).entries.find(
    (entry) => entry.type === 'request-failed',
  )
  const answered = (await answering.store.read(answering.studyId)).entries.find(
    (entry) => entry.type === 'response',
  )

  // Assert
  assert.equal(
    failed?.type === 'request-failed' && failed.message.length,
    2_048,
  )
  assert.equal(
    answered?.type === 'response' && answered.location?.length,
    2_048,
  )
  assert.equal(failing.writer.appendFailure, undefined)
  assert.equal(answering.writer.appendFailure, undefined)
})

// protects=a surrogate pair that straddles the 2,048 bound is dropped whole, never split into a lone surrogate; fails_when=the message is cut between the two halves of an astral character; no_claim=other bounded fields (same helper)
test('an astral character at the message bound is not split', async (context) => {
  // Arrange
  const { sink, writer, store, studyId } = await startSink(context)
  const message = `${'a'.repeat(2_047)}\u{1F600}tail`

  // Act
  sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.markRequestSent(11)
  sink.failRequest(20, 'ECONNRESET', message)
  await writer.seal({ elapsedMs: 30, reason: 'stopped' })
  const failed = (await store.read(studyId)).entries.find(
    (entry) => entry.type === 'request-failed',
  )

  // Assert
  assert.equal(
    failed?.type === 'request-failed' && failed.message,
    'a'.repeat(2_047),
  )
})

// protects=a synchronous refusal of the sink (a stop captured with no open request) tells the status item once that recording stopped, as a rejected queued append does; fails_when=the item keeps reading Recording explanation after a synchronous fault, or is told twice; no_claim=the status bar drawing
test('a synchronous sink fault tells the status item once that recording stopped', async (context) => {
  // Arrange
  let told = 0
  const { sink } = await startSink(context, {
    onAppendFailed: () => {
      told++
    },
  })

  // Act
  sink.stop(12, { declaredStopIndex: 0 }, 1, debuggerCapture({ line: 2 }))
  sink.stop(13, { declaredStopIndex: 1 }, 2, debuggerCapture({ line: 3 }))

  // Assert
  assert.equal(told, 1)
})

// protects=a debugger value cut by the capture inside a private root (its marker closes the cut text) never stores the root's visible start, while an uncut value stays as captured; fails_when=the stored value keeps the start of the home path or the learner's name from a cut root, or an uncut value is changed; no_claim=cuts that are not at the end of a text
test('a debugger value cut inside a private root stores no part of the root', async (context) => {
  // Arrange
  const { sink, writer, folder } = await startSink(context, {
    sanitize: (text) => hidePrivateRoots(text, PRIVATE_ROOTS),
    roots: PRIVATE_ROOTS,
  })
  const base = debuggerCapture({ line: 2 })
  const capture = {
    ...base,
    snapshot: {
      ...base.snapshot,
      variables: [
        {
          name: 'cut',
          value: `${'x'.repeat(4_073)} /Users/ad… [truncated]`,
          children: [],
        },
        { name: 'plain', value: 'path /Users/x is only text', children: [] },
      ],
    },
  }

  // Act
  sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.markRequestSent(11)
  sink.stop(12, { declaredStopIndex: 0 }, 1, capture)
  sink.response(20, RESPONSE)
  await writer.seal({ elapsedMs: 30, reason: 'stopped' })
  const files = await readHistoryFolderText(folder)

  // Assert
  assert.doesNotMatch(files, /\/Users\/ad/)
  assert.doesNotMatch(files, /\bada\b/)
  assert.ok(files.includes(`${'x'.repeat(4_073)} ~… [truncated]`))
  assert.ok(files.includes('path /Users/x is only text'))
})

// protects=one frozen root snapshot hides both a whole workspace path and a path the capture cut inside that workspace root in a stop's values, so the saved history never shows less than the live output hides; fails_when=the cut-fragment hiding reads another root set than the whole-root hiding (the whole path is hidden but its cut start stays, or the reverse); no_claim=the service's own root set and a folder added after the run began (hidden from the next run on)
test('a stop hides a whole root and a cut root fragment with the same frozen snapshot', async (context) => {
  // Arrange
  const frozenRoots: CauseRoots = {
    storage: [],
    home: ['/Users/ada'],
    workspace: ['/srv/project'],
  }
  const { sink, writer, folder } = await startSink(context, {
    sanitize: createRootHider(frozenRoots),
    roots: frozenRoots,
  })
  const base = debuggerCapture({ line: 2 })
  const capture = {
    ...base,
    snapshot: {
      ...base.snapshot,
      variables: [
        { name: 'whole', value: 'at /srv/project/a.ts', children: [] },
        { name: 'cut', value: 'at /srv/proj… [truncated]', children: [] },
      ],
    },
  }

  // Act
  sink.openRequest(10, { method: 'GET', path: '/api/x', bodyBytes: 0 })
  sink.markRequestSent(11)
  sink.stop(12, { declaredStopIndex: 0 }, 1, capture)
  sink.response(20, RESPONSE)
  await writer.seal({ elapsedMs: 30, reason: 'stopped' })
  const files = await readHistoryFolderText(folder)

  // Assert
  assert.doesNotMatch(files, /\/srv\/proj/)
  assert.ok(files.includes('at <workspace>/a.ts'))
  assert.ok(files.includes('at <workspace>… [truncated]'))
})
