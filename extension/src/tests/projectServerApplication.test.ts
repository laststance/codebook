import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { buildServerReplayModel } from '../utils/buildServerReplayModel'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { modelOf, VERDICTS, viewAt } from './utils/serverReplayModelOf'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=the response region shows no response before the response entry, the response at it and clears it again when the playhead moves back; fails_when=a later response is visible at an earlier moment; no_claim=colors, which carry no status
test('the response region reads no response yet at the stop, the response at the answer and no response again after moving back', async (context) => {
  // Arrange
  const { model, sequences } = await modelOf(context, {
    output: ['created\n'],
  })

  // Act
  const atStop = viewAt(model, sequences.stops[0]!)
  const atResponse = viewAt(model, sequences.response!)
  const backAtStop = viewAt(model, sequences.stops[0]!)

  // Assert
  assert.equal(
    atStop.response?.state,
    'No response recorded yet at this moment.',
  )
  assert.equal(atResponse.response?.state, 'Response 201 · application/json')
  assert.equal(atResponse.response?.body, '{"id":7}')
  assert.deepEqual(backAtStop.response, atStop.response)
})

// protects=the request region says Request sent by Codebook only with the send mark and shows the declared request line; fails_when=the claim or the line is missing from any moment; no_claim=that the server received the request
test('the request region shows the request line, opening before the send mark and sent from it', async (context) => {
  // Arrange
  const { model, sequences } = await modelOf(context, {})

  // Act
  const atRequest = viewAt(model, sequences.request)
  const atResponse = viewAt(model, sequences.response!)

  // Assert
  assert.deepEqual(atRequest.request, {
    line: 'POST /api/items',
    claim: 'Request opened by Codebook; not sent yet at this moment.',
  })
  assert.deepEqual(atResponse.request, {
    line: 'POST /api/items',
    claim: 'Request sent by Codebook',
  })
})

// protects=an empty body, a cut body and a response that never came are worded apart; fails_when=an empty body shows a block, a cut body hides its size, or the missing answer is not given its reason at the last event; no_claim=the body bound itself
test('the response region words an empty body, a cut body and a run stopped before its answer', async (context) => {
  // Arrange
  const empty = await modelOf(context, {
    response: { status: 204, body: '', contentType: 'text/plain' },
  })
  const stopped = await modelOf(context, { response: null })
  const cut = await modelOf(context, {
    response: { status: 200, body: '{"id":7}', bodyBytes: 9000, readCut: true },
  })
  const reason =
    'No response was recorded: the run was stopped before the server answered.'

  // Act
  const emptyView = viewAt(empty.model, empty.sequences.response!)
  const cutView = viewAt(cut.model, cut.sequences.response!)
  const earlier = viewAt(stopped.model, stopped.sequences.request, reason)
  const lastEvent = stopped.model.events.at(-1)!
  const atEnd = viewAt(stopped.model, lastEvent.sequence, reason)

  // Assert
  assert.deepEqual(emptyView.response, {
    state: 'Response 204 · text/plain',
    note: 'Response body is empty.',
  })
  assert.equal(cutView.response?.note, 'Body shown cut at 8 bytes.')
  assert.equal(
    earlier.response?.state,
    'No response recorded yet at this moment.',
  )
  assert.equal(atEnd.response?.state, reason)
  assert.equal(atEnd.end, 'Recording ended before the server answered.')
})

// protects=the output log up to the moment reuses the test replay's window: lines before the selected event only; fails_when=output recorded after the selected moment shows; no_claim=the 4,096-character window's cut line
test('the output log shows only the lines recorded up to the selected moment', async (context) => {
  // Arrange
  const { model, sequences } = await modelOf(context, {
    output: ['first\n', 'second\n'],
  })

  // Act
  const afterFirst = viewAt(model, sequences.output[0]!)
  const afterSecond = viewAt(model, sequences.output[1]!)
  const atStop = viewAt(model, sequences.stops[0]!)

  // Assert
  assert.deepEqual(
    afterFirst.lines.map((line) => line.text),
    ['first'],
  )
  assert.deepEqual(
    afterSecond.lines.map((line) => line.text),
    ['first', 'second'],
  )
  assert.deepEqual(atStop.lines, [])
  assert.equal(
    atStop.placeholder,
    'No server output recorded up to this moment.',
  )
})

// protects=a withdrawn attempt reads Request not sent with its code; fails_when=the region claims the bytes were sent; no_claim=a later successful attempt
test('a request withdrawn before its bytes left reads Request not sent with its code', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/api/items',
    bodyBytes: 14,
  })
  await writer.appendRequestWithdrawn({
    elapsedMs: 2,
    attempt: 1,
    code: 'RUN_BUSY',
  })
  await writer.appendRequestFailed({
    elapsedMs: 3,
    code: 'RUN_BUSY',
    message: 'The run was busy.',
  })
  await writer.seal({ elapsedMs: 4, reason: 'failed' })
  const model = buildServerReplayModel(
    await repository.serverHistories.read(header.studyId),
    VERDICTS,
  )

  // Act
  const view = viewAt(model, model.events[0]!.sequence)
  const atWithdrawal = viewAt(model, model.events[1]!.sequence)
  const atFailure = viewAt(model, model.terminal!.sequence)

  // Assert
  assert.equal(view.request?.claim, 'Request not sent: unknown')
  assert.equal(atWithdrawal.request?.claim, 'Request not sent: RUN_BUSY')
  assert.equal(atFailure.response?.state, 'Request failed: RUN_BUSY')
})
