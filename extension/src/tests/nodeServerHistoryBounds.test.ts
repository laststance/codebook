import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import {
  NODE_SERVER_OUTPUT_BUDGET_ENTRIES,
  NODE_SERVER_WRITER_QUEUE_LIMIT_ENTRIES,
} from '../constants'
import type { NodeServerHistoryWriter } from '../nodeServerHistoryWriter'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
  serverStopCapture,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

/** Starts a one-stop server history and opens its request, so structural entries can follow. */
async function startOpenRequest(
  context: Parameters<typeof openServerRepository>[0],
) {
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/api/items',
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  return { writer, store: repository.serverHistories, header }
}

/** Appends `count` one-line output chunks, waiting for each batch so the writer queue never holds more than a batch. */
async function appendOutputLines(
  writer: NodeServerHistoryWriter,
  count: number,
  batch = 200,
): Promise<void> {
  for (let done = 0; done < count; done += batch) {
    const size = Math.min(batch, count - done)
    await Promise.all(
      Array.from({ length: size }, (_, index) =>
        writer.appendOutput({
          elapsedMs: 3 + (done + index) / 1000,
          channel: 'stdout',
          text: `line ${done + index}\n`,
        }),
      ),
    )
  }
}

// protects=output has its own budget so a chatty server cannot crowd out the stops and the answer; fails_when=output past 2,000 entries is written or the structural entries are refused; no_claim=the 2 MiB byte budget
test('output past 2,000 entries is dropped with one output-truncated entry while the stop and the response are still written', async (context) => {
  // Arrange
  const { writer, store, header } = await startOpenRequest(context)

  // Act
  await appendOutputLines(writer, NODE_SERVER_OUTPUT_BUDGET_ENTRIES + 50)
  await writer.appendStop(
    serverStopCapture({ declaredStopIndex: 0, hit: 1, line: 2, elapsedMs: 10 }),
  )
  await writer.appendResponse({
    elapsedMs: 11,
    status: 200,
    contentType: null,
    body: '',
    bodyBytes: 0,
    readCut: false,
    location: null,
    requestDurationMs: 9,
  })
  await writer.seal({ elapsedMs: 12, reason: 'stopped' })
  const opened = await store.read(header.studyId)
  const types = opened.entries.map((entry) => entry.type)

  // Assert
  assert.equal(types.filter((type) => type === 'output').length, 2_000)
  assert.equal(types.filter((type) => type === 'output-truncated').length, 1)
  assert.equal(types.includes('stop'), true)
  assert.equal(types.includes('response'), true)
  assert.equal(opened.status, 'partial')
  assert.equal(
    opened.seal?.reasons.some(
      (reason) => reason.code === 'SERVER_HISTORY_OUTPUT_TRUNCATED',
    ),
    true,
  )
})

// protects=output past 2 MiB is dropped the same way; fails_when=large chunks fill the journal; no_claim=exact byte counts
test('output past its 2 MiB byte budget is dropped with one output-truncated entry', async (context) => {
  // Arrange
  const { writer, store, header } = await startOpenRequest(context)
  const chunk = 'y'.repeat(4_000)

  // Act
  for (let index = 0; index < 560; index++)
    await writer.appendOutput({
      elapsedMs: 3 + index / 1000,
      channel: 'stdout',
      text: chunk,
    })
  await writer.seal({ elapsedMs: 10, reason: 'stopped' })
  const opened = await store.read(header.studyId)

  // Assert
  const outputs = opened.entries.filter(
    (entry) => entry.type === 'output',
  ).length
  assert.equal(outputs < 560 && outputs > 400, true)
  const truncation = opened.entries.find(
    (entry) => entry.type === 'output-truncated',
  )
  assert.equal(
    truncation?.type === 'output-truncated' ? truncation.limit : '',
    'bytes',
  )
})

// protects=the writer queue drops output only when it holds 1,000 entries pending; fails_when=a flood of same-turn output queues without bound or drops a structural entry; no_claim=slow-disk timing
test('output offered in one turn past the 1,000-entry queue is dropped under the same code and the structural entries still wait their turn', async (context) => {
  // Arrange
  const { writer, store, header } = await startOpenRequest(context)

  // Act
  const flood = Array.from(
    { length: NODE_SERVER_WRITER_QUEUE_LIMIT_ENTRIES + 500 },
    (_, index) =>
      writer.appendOutput({
        elapsedMs: 3 + index / 10_000,
        channel: 'stdout',
        text: `n${index}\n`,
      }),
  )
  const structural = writer.appendStop(
    serverStopCapture({ declaredStopIndex: 0, hit: 1, line: 2, elapsedMs: 9 }),
  )
  await Promise.all([...flood, structural])
  await writer.seal({ elapsedMs: 10, reason: 'stopped' })
  const opened = await store.read(header.studyId)

  // Assert
  const types = opened.entries.map((entry) => entry.type)
  assert.equal(types.filter((type) => type === 'output').length < 1_100, true)
  assert.equal(types.filter((type) => type === 'output-truncated').length, 1)
  const truncation = opened.entries.find(
    (entry) => entry.type === 'output-truncated',
  )
  assert.equal(
    truncation?.type === 'output-truncated' ? truncation.limit : '',
    'queue',
  )
  assert.equal(types.includes('stop'), true)
})
