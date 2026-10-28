import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { sha256 } from '../runtimeSupport/utils/sha256'

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

// protects=the writer queue's 4 MiB pending-byte bound: when accepted structural entries hold more than 4 MiB, output offered in the same turn is dropped under the queue code while the stops still reach the journal; fails_when=output is queued behind the megabytes or a stop is dropped; no_claim=slow-disk timing
test('output offered while more than 4 MiB of stops are pending is dropped under the queue code and the stops are written', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops: 8,
  })
  const writer = await repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/api/items',
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  // Eight distinct sources of 512 KiB each (the largest a source entry stores): their `source` entries alone hold 4 MiB in the queue.
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
  await Promise.all([...stops, output])
  await writer.seal({ elapsedMs: 40, reason: 'stopped' })
  const opened = await repository.serverHistories.read(header.studyId)

  // Assert
  const truncation = opened.entries.find(
    (entry) => entry.type === 'output-truncated',
  )
  assert.equal(
    truncation?.type === 'output-truncated' ? truncation.limit : '',
    'queue',
  )
  assert.equal(
    opened.entries.filter((entry) => entry.type === 'stop').length,
    8,
  )
  assert.equal(
    opened.entries.some((entry) => entry.type === 'output'),
    false,
  )
})
