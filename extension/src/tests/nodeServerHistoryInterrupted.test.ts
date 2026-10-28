import assert from 'node:assert/strict'
import { before, test } from 'node:test'

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

// protects=a server history interrupted before any answer reads capture-incomplete with the no-response reason after a re-read; fails_when=the library reads it as a complete capture because the journal has no end and no terminal entry; no_claim=a history whose append failed (it names the append reason instead)
test('a re-read interrupted server history with no end and no terminal entry reads capture-incomplete with the no-response reason', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops: 1,
  })
  const writer = await repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/api/items',
    bodyBytes: 14,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  await writer.appendStop(
    serverStopCapture({ declaredStopIndex: 0, hit: 1, line: 2, elapsedMs: 3 }),
  )
  // The window crashes: its writer is gone and nothing sealed the folder.
  writer.abandon()

  // Act
  const [summary] = await repository.serverHistories.list()

  // Assert
  assert.equal(summary?.status, 'interrupted')
  assert.equal(summary?.captureComplete, false)
  assert.deepEqual(
    summary?.captureMissing.map((reason) => [reason.code, reason.text]),
    [
      [
        'SERVER_HISTORY_NO_RESPONSE_STOPPED',
        'No response was recorded: the recording ended before the server answered.',
      ],
    ],
  )
})

// protects=the pre-seal summary of a recording words an executed source that was not stored like the seal does; fails_when=the incremental scan drops the source entry so SERVER_HISTORY_SOURCE_UNAVAILABLE is missing before the seal; no_claim=the reason's wording for a text above the size bound
test('a server history still recording reports the source-unavailable reason of a stop whose text was not stored', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops: 1,
  })
  const writer = await repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/api/items',
    bodyBytes: 14,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  const capture = serverStopCapture({
    declaredStopIndex: 0,
    hit: 1,
    line: 2,
    elapsedMs: 3,
  })
  const [top] = capture.snapshot.frames
  // The frame's text does not hash to the stop's source hash, so the source entry holds its hash with `not captured`.
  await writer.appendStop({
    ...capture,
    snapshot: {
      ...capture.snapshot,
      frames: [
        { ...top!, source: { ...top!.source!, text: 'not the executed text' } },
      ],
    },
  })

  // Act
  const [summary] = await repository.serverHistories.list()

  // Assert
  assert.equal(summary?.status, 'recording')
  assert.deepEqual(
    summary?.captureMissing.map((reason) => reason.code),
    ['SERVER_HISTORY_SOURCE_UNAVAILABLE'],
  )
  writer.abandon()
})
