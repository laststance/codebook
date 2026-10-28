import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { presentServerHistory } from '../utils/presentServerHistory'
import { projectServerSection } from '../utils/projectServerSection'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
  serverStopCapture,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'

before(async () => {
  await realProcessStart(process.pid)
})

/** Reads a fixture history back through the store and presents it as the workspace does. */
async function presentationOf(
  context: Parameters<typeof openServerRepository>[0],
  options: Parameters<typeof writeServerHistory>[1] = {},
) {
  const { repository } = await openServerRepository(context)
  const { header, sequences } = await writeServerHistory(repository, options)
  const history = await repository.serverHistories.read(header.studyId)
  return {
    replay: presentServerHistory(history, undefined),
    sequences,
  }
}

// protects=the presentation maps learner events onto the workspace's entry types in journal order, with output numbered apart and every non-stop moment a result-shaped entry; fails_when=a source or send-mark entry becomes an event, or the stop loses its position; no_claim=the workspace's selection order
test('the presentation lists the request, stop, output and response as shared-path entries and skips storage-only entries', async (context) => {
  // Arrange / Act
  const { replay } = await presentationOf(context, { output: ['created\n'] })

  // Assert
  assert.deepEqual(
    replay.history.entries.map((entry) => [entry.sequence, entry.type]),
    [
      [1, 'result'],
      [4, 'stop'],
      [5, 'output'],
      [6, 'result'],
    ],
  )
  assert.equal(replay.history.status, 'complete')
  assert.equal(replay.history.header.configuration.testFile, 'src/handler.ts')
})

// protects=a right-to-left override in a recorded output line or response body never reaches what the surfaces print, while the stored model the host verifies against keeps the recorded text; fails_when=a control survives in the shown copy, or the stored copy is changed; no_claim=how the pane prints the text
test('the shown copy of a server replay loses terminal and bidirectional controls and the stored copy keeps them', async (context) => {
  // Arrange / Act
  const { replay } = await presentationOf(context, {
    output: ['o\u202Ek\n'],
    response: { status: 200, body: '{"a":"\u202Eb"}' },
  })
  const texts = (model: typeof replay.model) =>
    model.events.flatMap((event) =>
      event.type === 'output'
        ? [event.text]
        : event.type === 'response'
          ? [event.body]
          : [],
    )

  // Assert
  assert.deepEqual(texts(replay.shownModel), ['ok\n', '{"a":"b"}'])
  assert.deepEqual(texts(replay.model), ['o\u202Ek\n', '{"a":"\u202Eb"}'])
})

// protects=the capture-reason line of a replay lists every reason in the replay's words and never names a Node server history; fails_when=a reason is dropped, cut to the first, or still says Node server history; no_claim=the library row's first-reason cut
test('an interrupted server replay words its capture reason as a server replay', async (context) => {
  // Arrange / Act
  const { replay } = await presentationOf(context, { seal: false })

  // Assert
  assert.equal(replay.model.status, 'interrupted')
  assert.deepEqual(replay.captureReasons, [
    'Server replay has no verified final seal.',
  ])
})

// protects=the Study section words a server replay's moments (request, stop with its hit, response) with the server catalog and counts the stops the chat explained; fails_when=a locator reads like a test replay's, a repeated stop is not told apart, or the status does not name the answer; no_claim=the pane's drawing
test('the server section words the request, a repeated stop and the response with server words', async (context) => {
  // Arrange
  const { replay, sequences } = await presentationOf(context, {
    hits: [
      [0, 1],
      [0, 2],
    ],
  })
  const at = (sequence: number) =>
    replay.shownModel.events[replay.shownModel.indexBySequence.get(sequence)!]
  const section = (sequence: number) =>
    projectServerSection({
      replay,
      selected: at(sequence),
      selectedStopVerified: true,
      applicationClosed: false,
    })

  // Act
  const request = section(sequences.request)
  const secondHit = section(sequences.stops[1]!)
  const response = section(sequences.response!)

  // Assert
  assert.equal(request.position, 'Request · 0.00 s')
  assert.equal(secondHit.position, 'Stop 1 · hit 2 · 0.02 s')
  assert.equal(response.position, 'Response 201 · 0.03 s')
  assert.equal(
    response.status,
    'Response 201 · capture complete · 0 of 2 stops explained',
  )
  assert.equal(
    request.notRecorded,
    'Source and debugger not recorded at this moment.',
  )
  assert.equal(response.explanation, 'No saved explanation for the response.')
  assert.equal(secondHit.explanation, 'No saved explanation for this stop.')
  assert.equal(secondHit.notRecorded, undefined)
})

// protects=a history that ended with no answer says so in its status and a failed request names its code; fails_when=the status claims a response, or the failure code is missing; no_claim=the library row's words
test('the server section says no response was recorded and names a failed request code', async (context) => {
  // Arrange
  const unanswered = await presentationOf(context, { response: null })
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: header.declaredRequest.path,
    bodyBytes: 1,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  await writer.appendStop(
    serverStopCapture({ declaredStopIndex: 0, hit: 1, line: 2, elapsedMs: 3 }),
  )
  await writer.appendRequestFailed({
    elapsedMs: 4,
    code: 'ECONNRESET',
    message: 'The connection was reset.',
  })
  await writer.seal({ elapsedMs: 5, reason: 'stopped' })
  const failed = presentServerHistory(
    await repository.serverHistories.read(header.studyId),
    undefined,
  )

  // Act
  const unansweredStatus = projectServerSection({
    replay: unanswered.replay,
    selectedStopVerified: false,
    applicationClosed: false,
  }).status
  const failedStatus = projectServerSection({
    replay: failed,
    selectedStopVerified: false,
    applicationClosed: false,
  }).status

  // Assert
  assert.match(unansweredStatus, /^No response recorded · capture partial · /)
  assert.match(failedStatus, /^Request failed: ECONNRESET · capture /)
})
