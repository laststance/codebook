import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { StudyError } from '../errors'
import { NodeServerHistorySinkImpl } from '../nodeServerHistorySink'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import {
  readyHarness,
  RESPONSE_200,
  until,
  type Harness,
} from './utils/nodeServerRunHarness'
import { realProcessStart } from './utils/realProcessStart'
import { debuggerCapture } from './utils/serverRunCapture'

before(async () => {
  await realProcessStart(process.pid)
})

/** A real run over fakes whose history sink feeds a real writer of a two-stop server history. */
async function runWithHistory(
  context: Parameters<typeof openServerRepository>[0],
) {
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops: 2,
  })
  const writer = await repository.serverHistories.start(header)
  const sink = new NodeServerHistorySinkImpl({
    writer,
    sanitize: (text) => text,
  })
  const harness = await readyHarness({
    stops: 2,
    history: sink,
    capture: (pause) =>
      debuggerCapture({ line: 2 + (pause.declaredStopIndex ?? 0) }),
  })
  return { harness, writer, store: repository.serverHistories, header }
}

/** Runs the request through two stops to its response on a harness. */
async function driveRequest(harness: Harness): Promise<void> {
  await harness.run.sendRequest('key-1')
  harness.debug.hit(0)
  const first = await until(harness, (view) => view.state === 'paused')
  await harness.run.continue(first.pause!)
  harness.debug.hit(1)
  const second = await until(
    harness,
    (view) => view.state === 'paused' && view.stopsReached.length === 2,
  )
  await harness.run.continue(second.pause!)
  harness.sender.response.resolve(RESPONSE_200)
  await until(harness, (view) => view.state === 'responded')
}

// protects=a live run writes its output, request, send mark, two stops and response to the history as they happen, before the run ends; fails_when=the run does not feed its sink at the output, the request window, the capture or the response; no_claim=a real debugger
test('a run writes output, request, stops and response to its history in order while it is still live', async (context) => {
  // Arrange
  const { harness, writer, store, header } = await runWithHistory(context)

  // Act
  await driveRequest(harness)
  await writer.appendEntry({
    type: 'output-truncated',
    elapsedMs: 999,
    limit: 'queue',
  })
  const live = await store.read(header.studyId)
  await writer.seal({ elapsedMs: 1_000, reason: 'stopped' })
  const sealed = await store.read(header.studyId)

  // Assert
  assert.deepEqual(
    live.entries.map((entry) => entry.type),
    [
      'output',
      'request',
      'request-sent',
      'source',
      'stop',
      'stop',
      'response',
      'output-truncated',
    ],
  )
  assert.equal(live.status, 'recording')
  assert.equal(sealed.status, 'partial')
})

// protects=a send refused before its bytes left is a withdrawn attempt in the history, with the refusal's code; fails_when=the withdrawal is not recorded or carries another code; no_claim=the retry policy of the service
test('a send refused before its bytes left is a withdrawn attempt in the history', async (context) => {
  // Arrange
  const { harness, writer, store, header } = await runWithHistory(context)
  const refused = new StudyError('LISTENER_NOT_OWNED', 'not the server')

  // Act
  const sending = harness.run.sendRequest('key-1')
  harness.sender.written.reject(refused)
  harness.sender.response.reject(refused)
  await sending.catch(() => undefined)
  await writer.seal({ elapsedMs: 100, reason: 'stopped' })
  const withdrawn = (await store.read(header.studyId)).entries.filter(
    (entry) => entry.type === 'request' || entry.type === 'request-withdrawn',
  )

  // Assert
  assert.deepEqual(
    withdrawn.map((entry) => entry.type),
    ['request', 'request-withdrawn'],
  )
  assert.equal(
    withdrawn[1]?.type === 'request-withdrawn' && withdrawn[1].code,
    'LISTENER_NOT_OWNED',
  )
})
