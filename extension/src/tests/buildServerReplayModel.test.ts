import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import type { NodeServerHistoryEntryInput } from '../nodeServerHistorySchemas'
import {
  buildServerReplayModel,
  findServerStop,
  neighbourServerStop,
  openingServerEvent,
  restoreServerPlayhead,
} from '../utils/buildServerReplayModel'

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

const COMPLETE = {
  saved: true,
  captureComplete: true,
  learningCoverage: 'complete',
} as const

/** Reads a history written by the fixture writer back through the store and builds its replay model. */
async function modelOf(
  context: Parameters<typeof openServerRepository>[0],
  options: Parameters<typeof writeServerHistory>[1] = {},
) {
  const { repository } = await openServerRepository(context)
  const { header, sequences } = await writeServerHistory(repository, options)
  const history = await repository.serverHistories.read(header.studyId)
  return {
    model: buildServerReplayModel(history, COMPLETE),
    sequences,
    history,
  }
}

// protects=the model lists learner events only and finds each by its journal sequence although source entries leave gaps in the numbers; fails_when=a source or send-mark entry becomes an event, or a lookup by sequence lands on the neighbour; no_claim=the workspace's selection order
test('the replay model skips storage-only entries and looks events up by their non-contiguous journal sequences', async (context) => {
  // Arrange / Act
  const { model, history } = await modelOf(context, { output: ['created\n'] })

  // Assert
  assert.deepEqual(
    history.entries.map((entry) => [entry.sequence, entry.type]),
    [
      [1, 'request'],
      [2, 'request-sent'],
      [3, 'source'],
      [4, 'stop'],
      [5, 'output'],
      [6, 'response'],
      [7, 'end'],
    ],
  )
  assert.deepEqual(
    model.events.map((event) => [event.sequence, event.type]),
    [
      [1, 'request'],
      [4, 'stop'],
      [5, 'output'],
      [6, 'response'],
    ],
  )
  assert.equal(model.indexBySequence.get(4), 1)
  assert.equal(model.indexBySequence.get(3), undefined)
})

// protects=every stop carries its full rehydrated snapshot, so the replay shows the executed source; fails_when=a stop keeps the empty text marker of its stored form; no_claim=the debugger's presentation
test('the replay model rehydrates each stop snapshot with the executed source text', async (context) => {
  // Arrange / Act
  const { model } = await modelOf(context)

  // Assert
  const stop = findServerStop(model, 1, 1)
  assert.match(
    stop?.debuggerSnapshot.frames[0]?.source?.text ?? '',
    /export function handler/,
  )
})

// protects=two hits recorded at one time keep their journal order and each hit of a repeated stop is reachable by Previous and Next stop; fails_when=same-time entries are reordered or a hit is skipped; no_claim=the Play timer's tie-break
test('two hits of one stop at the same time keep journal order and Next stop visits both', async (context) => {
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
  for (const hit of [1, 2])
    await writer.appendStop(
      serverStopCapture({ declaredStopIndex: 0, hit, line: 2, elapsedMs: 20 }),
    )
  await writer.seal({ elapsedMs: 30, reason: 'stopped' })
  const model = buildServerReplayModel(
    await repository.serverHistories.read(header.studyId),
    COMPLETE,
  )

  // Act
  const first = findServerStop(model, 1, 1)!
  const second = neighbourServerStop(model, first.sequence, 'next')
  const back = neighbourServerStop(model, second!.sequence, 'previous')
  const none = neighbourServerStop(model, second!.sequence, 'next')

  // Assert
  assert.deepEqual([first.hit, second?.hit, back?.hit], [1, 2, 1])
  assert.equal(none, undefined)
  assert.deepEqual([...model.repeatedStops], [0])
  assert.equal(first.elapsedMs, second?.elapsedMs)
})

// protects=a late end after the terminal entry moves only the timeline's end; fails_when=the end becomes an event or the response is treated as missing; no_claim=the Application pane
test('a late end after the response ends the timeline there and the history still answered', async (context) => {
  // Arrange / Act
  const { model } = await modelOf(context)

  // Assert
  assert.equal(model.terminal?.type, 'response')
  assert.equal(model.endedBeforeAnswer, false)
  // gstack-timing-ok: compares two recorded journal times from the fixture, not elapsed wall time
  assert.ok(model.endedAtMs > (model.terminal?.elapsedMs ?? 0))
  assert.equal(
    model.events.some((event) => event.type === 'response'),
    true,
  )
})

// protects=a run stopped before its answer reads as ended before the answer; fails_when=the model invents a terminal or ends the timeline before the last event; no_claim=the wording of the line
test('a history stopped before its answer has no terminal and ends at its end entry', async (context) => {
  // Arrange / Act
  const { model } = await modelOf(context, { response: null })

  // Assert
  assert.equal(model.terminal, undefined)
  assert.equal(model.endedBeforeAnswer, true)
  assert.equal(model.endedAtMs, model.events.at(-1)!.elapsedMs + 10)
})

// protects=a saved playhead on a storage-only entry restores the nearest earlier learner event, and one before every event restores the opening moment; fails_when=the restore lands on the source entry, throws, or skips to a later event; no_claim=a saved sequence the journal never held
test('a saved playhead on a source entry restores the request before it and a playhead on end restores the response', async (context) => {
  // Arrange
  const { model } = await modelOf(context)

  // Act
  const onSource = restoreServerPlayhead(model, 3)
  const onEnd = restoreServerPlayhead(model, 7)
  const onStop = restoreServerPlayhead(model, 4)

  // Assert
  assert.equal(onSource?.type, 'request')
  assert.equal(onEnd?.type, 'response')
  assert.equal(onStop?.sequence, 4)
})

// protects=the opening rule: a replay opens on its first stop, else its request; fails_when=a history with a stop opens on the request or one with no stop opens on nothing; no_claim=the saved position, which wins over this rule
test('a replay opens on its first recorded stop and, with no stop, on its request', async (context) => {
  // Arrange
  const withStop = await modelOf(context)
  const noStop = await modelOf(context, { hits: [], response: null })

  // Act
  const first = openingServerEvent(withStop.model)
  const second = openingServerEvent(noStop.model)

  // Assert
  assert.equal(first?.type, 'stop')
  assert.equal(second?.type, 'request')
})

// protects=a withdrawn attempt is not claimed as sent; fails_when=the attempt reads as sent without its mark; no_claim=the refusal's code wording
test('an attempt without its send mark is not sent and keeps the code of its withdrawal', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  const entries: NodeServerHistoryEntryInput[] = [
    {
      type: 'request',
      elapsedMs: 1,
      attempt: 1,
      method: 'POST',
      path: '/api/items',
      bodyBytes: 14,
    },
    { type: 'request-withdrawn', elapsedMs: 2, attempt: 1, code: 'RUN_BUSY' },
    {
      type: 'request',
      elapsedMs: 3,
      attempt: 2,
      method: 'POST',
      path: '/api/items',
      bodyBytes: 14,
    },
    { type: 'request-sent', elapsedMs: 4, attempt: 2 },
  ]
  for (const entry of entries) await writer.appendEntry(entry)
  await writer.seal({ elapsedMs: 9, reason: 'stopped' })

  // Act
  const model = buildServerReplayModel(
    await repository.serverHistories.read(header.studyId),
    COMPLETE,
  )

  // Assert
  assert.deepEqual(model.attempts, [
    { attempt: 1, sent: false, withdrawnCode: 'RUN_BUSY' },
    { attempt: 2, sent: true },
  ])
  assert.deepEqual(
    model.events.map((event) => event.type),
    ['request', 'request-withdrawn', 'request'],
  )
})
