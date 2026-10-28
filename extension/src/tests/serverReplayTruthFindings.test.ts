import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { buildServerReplayModel } from '../utils/buildServerReplayModel'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { VERDICTS, viewAt } from './utils/serverReplayModelOf'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=the request region claims only what the journal had recorded by the selected moment: a moment before a withdrawal or a send mark never shows that later outcome; fails_when=an earlier moment reads Request sent by Codebook or names a later withdrawal's code; no_claim=the wording of the not-sent line
test('the request region at an earlier moment never shows a later withdrawal or send mark', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  const request = { method: 'GET' as const, path: '/api/x', bodyBytes: 0 }
  await writer.appendRequest({ elapsedMs: 1, attempt: 1, ...request })
  await writer.appendRequestWithdrawn({
    elapsedMs: 2,
    attempt: 1,
    code: 'RUN_BUSY',
  })
  await writer.appendRequest({ elapsedMs: 3, attempt: 2, ...request })
  await writer.appendRequestSent({ elapsedMs: 4, attempt: 2 })
  await writer.appendResponse({
    elapsedMs: 5,
    status: 200,
    contentType: 'application/json',
    body: '{}',
    bodyBytes: 2,
    readCut: false,
    location: null,
    requestDurationMs: 1,
  })
  await writer.seal({ elapsedMs: 6, reason: 'stopped' })
  const model = buildServerReplayModel(
    await repository.serverHistories.read(header.studyId),
    VERDICTS,
  )
  const sequenceOf = (type: string, nth: number): number =>
    model.events.filter((event) => event.type === type)[nth]!.sequence

  // Act
  const claims = [
    viewAt(model, sequenceOf('request', 0)).request?.claim,
    viewAt(model, sequenceOf('request-withdrawn', 0)).request?.claim,
    viewAt(model, sequenceOf('request', 1)).request?.claim,
    viewAt(model, sequenceOf('response', 0)).request?.claim,
  ]

  // Assert
  assert.doesNotMatch(claims[0] ?? '', /RUN_BUSY|sent by Codebook/)
  assert.equal(claims[1], 'Request not sent: RUN_BUSY')
  assert.doesNotMatch(claims[2] ?? '', /sent by Codebook/)
  assert.equal(claims[3], 'Request sent by Codebook')
})
