import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import {
  buildServerReplayModel,
  type ServerReplayModel,
} from '../utils/buildServerReplayModel'
import { describeNodeLearningSave } from '../utils/describeNodeLearningSave'
import {
  indexServerOutput,
  projectServerApplication,
} from '../utils/projectServerApplication'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'

before(async () => {
  await realProcessStart(process.pid)
})

const VERDICTS = {
  saved: true,
  captureComplete: true,
  learningCoverage: 'complete',
} as const

/** The Application view of a model at one sequence. */
function viewAt(model: ServerReplayModel, sequence: number) {
  const selected = model.events[model.indexBySequence.get(sequence)!]
  return projectServerApplication(model, indexServerOutput(model), selected, {
    generation: 1,
  })
}

/** Writes a fixture history through the shared writer and returns its replay model with the sequences it holds. */
async function modelOf(
  context: Parameters<typeof openServerRepository>[0],
  options: Parameters<typeof writeServerHistory>[1] = {},
) {
  const { repository } = await openServerRepository(context)
  const { header, sequences } = await writeServerHistory(repository, options)
  const model = buildServerReplayModel(
    await repository.serverHistories.read(header.studyId),
    VERDICTS,
  )
  return { model, sequences }
}

// protects=a server replay whose open failed is worded with server words in the notification and status line; fails_when=the text says test replay for a server history; no_claim=the Show details action
test('a server replay that cannot open says server replay and never test replay', () => {
  // Arrange / Act
  const failed = describeNodeLearningSave({
    kind: 'open-failed',
    profile: 'node-server',
    title: 'Creating an item',
    cause:
      'This server replay is still being recorded in another window. It opens once the recording is sealed or interrupted.',
  })

  // Assert
  assert.equal(
    failed.text,
    'Codebook could not open the server replay "Creating an item": This server replay is still being recorded in another window. It opens once the recording is sealed or interrupted. The saved history is unchanged; open it again from Saved studies.',
  )
})

// protects=the request region shows no request at a moment before the request entry (server startup output) and the attempt from the request entry on; fails_when=the first request is shown with Request sent by Codebook before it was sent; no_claim=a withdrawn attempt's words
test('startup output recorded before the request shows no request yet and the request region appears at the request entry', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  await writer.appendOutput({
    elapsedMs: 1,
    channel: 'stdout',
    text: 'listening on 4100\n',
  })
  await writer.appendRequest({
    elapsedMs: 2,
    attempt: 1,
    method: 'POST',
    path: header.declaredRequest.path,
    bodyBytes: 14,
  })
  await writer.appendRequestSent({ elapsedMs: 3, attempt: 1 })
  await writer.seal({ elapsedMs: 4, reason: 'stopped' })
  const model = buildServerReplayModel(
    await repository.serverHistories.read(header.studyId),
    VERDICTS,
  )
  const [startup, request] = model.events

  // Act
  const atStartup = viewAt(model, startup!.sequence)
  const atRequest = viewAt(model, request!.sequence)

  // Assert
  assert.deepEqual(atStartup.request, {
    line: 'No request recorded yet at this moment.',
    claim: '',
  })
  assert.deepEqual(atRequest.request, {
    line: 'POST /api/items',
    claim: 'Request sent by Codebook',
  })
})

// protects=a body the redaction or the binary note made shorter than its byte count carries no cut note, while a read cut and a body cut at the shown bound do; fails_when=the note appears for a redacted body or is missing for a bounded one; no_claim=the redaction itself
test('the body cut note appears only for a read cut or a body cut at the shown bound', async (context) => {
  // Arrange
  const redacted = await modelOf(context, {
    response: { status: 200, body: '{"token":"[REDACTED]"}', bodyBytes: 100 },
  })
  const readCut = await modelOf(context, {
    response: { status: 200, body: '{"id":7}', bodyBytes: 9000, readCut: true },
  })
  const shownBody = `${'a'.repeat(8192)} … 808 more bytes`
  const bounded = await modelOf(context, {
    response: {
      status: 200,
      body: shownBody,
      bodyBytes: 9000,
      contentType: 'text/plain',
    },
  })

  // Act
  const redactedView = viewAt(redacted.model, redacted.sequences.response!)
  const readCutView = viewAt(readCut.model, readCut.sequences.response!)
  const boundedView = viewAt(bounded.model, bounded.sequences.response!)

  // Assert
  assert.equal(redactedView.response?.note, undefined)
  assert.equal(readCutView.response?.note, 'Body shown cut at 8 bytes.')
  assert.equal(boundedView.response?.note, 'Body shown cut at 8211 bytes.')
})

// protects=the Application pane's name never carries a bidirectional control from the header's request path; fails_when=U+202E reaches the name that titles the document and names it for a screen reader; no_claim=the request region's own path
test('the Application name strips a bidirectional control from the declared request path', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const forged = {
    ...header,
    declaredRequest: {
      method: header.declaredRequest.method,
      path: '/api/\u202Eitems',
    },
  }
  const writer = await repository.serverHistories.start(forged)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/api/items',
    bodyBytes: 14,
  })
  await writer.seal({ elapsedMs: 2, reason: 'stopped' })
  const model = buildServerReplayModel(
    await repository.serverHistories.read(forged.studyId),
    VERDICTS,
  )

  // Act
  const view = viewAt(model, model.events[0]!.sequence)

  // Assert
  assert.equal(view.name, 'Server replay · POST /api/items')
})
