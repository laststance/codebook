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

// protects=the largest legal capture whose unreadable values have 512-character paths of escape-heavy and non-ASCII characters still seals and reads back, each reason's path cut to a byte bound; fails_when=the seal outgrows its size limit and is never written; no_claim=the wording of the cut
test('sixteen hits with ten unreadable values of 512 CJK and control characters each seal and read back with cut paths', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops: 8,
  })
  const writer = await repository.serverHistories.start(header)
  const heavyPath = (index: number): string =>
    `${'語'.repeat(250)}${'\u0001'.repeat(250)}${String(index).padStart(12, '0')}`
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/x',
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  for (let hitNumber = 0; hitNumber < 16; hitNumber++)
    await writer.appendStop(
      serverStopCapture({
        declaredStopIndex: hitNumber % 8,
        hit: Math.floor(hitNumber / 8) + 1,
        line: 2,
        elapsedMs: 10 + hitNumber,
        unavailable: Array.from({ length: 10 }, (_, index) => ({
          path: heavyPath(hitNumber * 10 + index),
          reason: 'r',
        })),
      }),
    )
  await writer.appendResponse({
    elapsedMs: 40,
    status: 200,
    contentType: 'application/json',
    body: '{}',
    bodyBytes: 2,
    readCut: false,
    location: null,
    requestDurationMs: 30,
  })

  // Act
  await writer.seal({ elapsedMs: 50, reason: 'stopped' })
  const opened = await repository.serverHistories.read(header.studyId)

  // Assert
  assert.equal(opened.seal?.reasons.length, 160)
  assert.ok(
    opened.seal?.reasons.every((reason) =>
      reason.text.endsWith('could not be read.'),
    ),
  )
  assert.ok(
    (opened.seal?.reasons[0]?.text.length ?? Infinity) < 400,
    'the path in the reason text is cut',
  )
})
