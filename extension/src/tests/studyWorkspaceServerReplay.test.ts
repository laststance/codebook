import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import http from 'node:http'
import { join } from 'node:path'
import { before, test } from 'node:test'

import {
  NODE_SERVER_HISTORY_DIRECTORY,
  NODE_SERVER_SOURCE_TEXT_LIMIT_BYTES,
} from '../constants'
import { HISTORY_JOURNAL_FILE } from '../nodeHistoryJournalWriter'
import type { NodeHistoryRepository } from '../nodeHistoryRepository'
import type { ReplayDebugSnapshot } from '../replayDebugSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
import {
  HANDLER_SOURCE_TEXT,
  nodeServerHistoryHeader,
  openServerRepository,
  serverStopCapture,
} from './utils/nodeServerHistoryFixture'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'
import { shownApplicationView } from './utils/shownTestOutput'
import { lastView, saveTwoStopNodeHistory } from './utils/twoStopNodeHistory'

before(async () => {
  await realProcessStart(process.pid)
})

type Harness = Awaited<ReturnType<typeof workspaceHarness>>

/** The workspace's history repository, over the learning directory the fixture writer shares. */
function repositoryOf(harness: Harness): NodeHistoryRepository {
  return harness.reader['nodeHistoryRepository']!
}

/** The workspace key every history of the harness's workspace carries. */
function workspaceKeyOf(harness: Harness): string {
  return harness.service.nodeHistoryStore!.workspaceKey
}

/**
 * Finds the address of the replay's recorded-source slot document.
 * @param harness - The workspace harness.
 * @returns The slot's address.
 * @example harness.documentTextOf(slotUri(harness))
 */
function slotUri(harness: Harness): string {
  return harness.historicalDebugPresentations.find(
    (presentation) => presentation.sourceDocument,
  )!.sourceDocument!.uri
}

/**
 * Opens a saved server replay from the library and waits until the pane shows it settled.
 * @param harness - The workspace harness.
 * @param studyId - The server history's study id.
 * @example await openServerReplay(harness, header.studyId)
 */
async function openServerReplay(
  harness: Harness,
  studyId: string,
): Promise<void> {
  await harness.reader.action('retry')
  await harness.reader.openLearningReplay(studyId)
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistory?.header.studyId === studyId &&
      !lastView(harness)?.loading,
    'the server replay is shown',
    READER_RESULT_BOUND_MS,
  )
}

/**
 * Presses a transport move as the Study pane's button does and waits until the playhead has committed at `sequence`.
 * @param harness - The workspace harness.
 * @param studyId - The shown history.
 * @param move - Which way and by what unit.
 * @param sequence - The sequence the move must commit.
 * @example await moveTo(harness, studyId, { direction: 'next', unit: 'stop' }, 5)
 */
async function moveTo(
  harness: Harness,
  studyId: string,
  move: { direction: 'previous' | 'next'; unit: 'event' | 'stop' },
  sequence: number,
): Promise<void> {
  harness.receiveContext({
    type: 'node-history-step',
    revision: lastView(harness)!.revision,
    studyId,
    ...move,
  })
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistoryPosition?.sequence === sequence &&
      !lastView(harness)?.nodeHistoryPosition?.pending,
    `the playhead commits at ${sequence}`,
    READER_RESULT_BOUND_MS,
  )
}

/**
 * Selects one event as a summary step's link or the event list's control does.
 * @param harness - The workspace harness.
 * @param studyId - The shown history.
 * @param sequence - The event to select.
 * @param stepId - The step the link names, when it is a step's.
 * @example await selectEvent(harness, studyId, 6, 'response')
 */
async function selectEvent(
  harness: Harness,
  studyId: string,
  sequence: number,
  stepId?: string,
): Promise<void> {
  harness.receiveContext({
    type: 'node-history-event',
    revision: lastView(harness)!.revision,
    studyId,
    sequence,
    ...(stepId ? { stepId } : {}),
  })
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistoryPosition?.sequence === sequence &&
      !lastView(harness)?.nodeHistoryPosition?.pending,
    `the playhead commits at ${sequence}`,
    READER_RESULT_BOUND_MS,
  )
}

/**
 * Builds a learning material that cites a request, a stop, an output and a response of a fixture history, each by its journal sequence.
 * @param sequences - The sequences the fixture writer returned.
 * @returns The material's content.
 * @example await store.saveLearningMaterial(studyId, 0, serverMaterial(sequences))
 */
function serverMaterial(sequences: {
  request: number
  stops: number[]
  output: number[]
  response?: number
}) {
  const step = (
    id: string,
    explanation: string,
    reference: Record<string, unknown>,
  ) => ({
    id,
    from: 'server',
    to: 'server',
    label: id,
    explanation,
    evidence: 'observed' as const,
    reference,
  })
  return {
    question: 'How does the server create an item?',
    title: 'Creating an item',
    summary: 'The handler creates the item and answers.',
    participants: [{ id: 'server', label: 'Handler' }],
    steps: [
      step('request', 'Codebook sends the request.', {
        type: 'request',
        sequence: sequences.request,
      }),
      step('stop', 'The handler stops at its first line.', {
        type: 'stop',
        sequence: sequences.stops[0],
        sourceHash: sha256(HANDLER_SOURCE_TEXT),
      }),
      step('response', 'The server answers with the item.', {
        type: 'response',
        sequence: sequences.response,
      }),
    ],
  } as never
}

// protects=a sealed server history opens from the library on its first recorded stop with the executed source stored in the history and its snapshot in the debugger, worded with the server catalog; fails_when=the replay opens on the request, shows the test catalog, or the slot and debugger lack the stored source; no_claim=the native editor's drawing of the slot
test('Open replay of a sealed server history lands on its first stop with the stored source in the slot and the snapshot in the debugger', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header, sequences } = await writeServerHistory(
      repositoryOf(harness),
      { workspaceKey: workspaceKeyOf(harness), output: ['listening\n'] },
    )

    // Act
    await openServerReplay(harness, header.studyId)
    const view = lastView(harness)
    const presented = harness.historicalDebugPresentations.at(-1)

    // Assert
    assert.equal(view?.nodeReplayProfile, 'node-server')
    assert.equal(view?.nodeHistoryPosition?.sequence, sequences.stops[0])
    assert.equal(view?.nodeHistorySection?.position, 'Stop 1 · 0.01 s')
    assert.equal(
      view?.nodeHistorySection?.status,
      'Response 201 · capture complete · 0 of 1 stops explained',
    )
    assert.equal(
      presented?.snapshot?.frames[0]?.source?.text,
      HANDLER_SOURCE_TEXT,
    )
    assert.equal(
      harness.documentTextOf(presented.sourceDocument!.uri),
      HANDLER_SOURCE_TEXT,
    )
    assert.deepEqual(
      view?.nodeServerEvents?.map((event) => event.heading),
      [
        'Request · 0.00 s',
        'Stop 1 · src/handler.ts:2:1 · 0.01 s',
        'Output · stdout · 0.02 s',
        'Response 201 · application/json · 0.03 s',
      ],
    )
  } finally {
    await harness.close()
  }
})

// protects=a server replay's Application pane has two fixed regions, the request line with the claim only a sent request earns and the response state that reads "No response recorded yet" before the response; fails_when=the request is worded as received, the response shows before its entry, or a region is missing; no_claim=the pane's document markup
test('the Application pane of a server replay shows the sent request and no response yet at the first stop', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: workspaceKeyOf(harness),
    })

    // Act
    await openServerReplay(harness, header.studyId)
    const application = shownApplicationView(harness)

    // Assert
    assert.equal(application?.profile, 'node-server')
    assert.deepEqual(application?.request, {
      line: 'POST /api/items',
      claim: 'Request sent by Codebook',
    })
    assert.equal(
      application?.response?.state,
      'No response recorded yet at this moment.',
    )
  } finally {
    await harness.close()
  }
})

// protects=a server history with a request and a response but no stop opens at its request, and Next stop is refused in server words; fails_when=the replay opens elsewhere, Next stop moves, or the refusal calls it a test replay; no_claim=the refusal's place in the transport
test('a server history without a stop opens at its request and Next stop answers that there is no next stop in this server replay', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header, sequences } = await writeServerHistory(
      repositoryOf(harness),
      { workspaceKey: workspaceKeyOf(harness), hits: [] },
    )
    await openServerReplay(harness, header.studyId)

    // Act
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: header.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await waitUntil(
      () => (lastView(harness)?.errors.length ?? 0) > 0,
      'the move is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.sequence,
      sequences.request,
    )
    assert.equal(
      lastView(harness)?.errors[0],
      'Error: There is no next stop in this server replay.',
    )
  } finally {
    await harness.close()
  }
})

// protects=a server journal damaged mid-file opens its verified prefix as an interrupted replay that lists its capture reason; fails_when=the replay refuses to open, reads complete, or hides the reason; no_claim=the wording of the reason beyond naming the server replay
test('a server history whose journal is damaged opens its verified prefix as an interrupted replay with its reason', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header, sequences } = await writeServerHistory(
      repositoryOf(harness),
      { workspaceKey: workspaceKeyOf(harness), seal: false },
    )
    await appendFile(
      join(
        harness.service.nodeHistoryStore!.learningDirectory,
        NODE_SERVER_HISTORY_DIRECTORY,
        header.studyId,
        HISTORY_JOURNAL_FILE,
      ),
      '{"type":"output","sequence":99,\n',
    )

    // Act
    await openServerReplay(harness, header.studyId)
    const view = lastView(harness)

    // Assert
    assert.equal(view?.nodeHistory?.status, 'interrupted')
    assert.equal(view?.nodeHistoryPosition?.sequence, sequences.stops[0])
    assert.match(
      view?.nodeHistorySection?.captureReason ?? '',
      /^Capture interrupted: Interrupted server replay after its verified prefix:/,
    )
  } finally {
    await harness.close()
  }
})

// protects=a server history another window is still recording refuses to open and opens once its recording is interrupted; fails_when=the replay opens while it is recorded, or stays closed afterwards; no_claim=another window's own writer (the harness keeps both writers in one process)
test('a server history that is still being recorded opens only once its recording is interrupted', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const repository = repositoryOf(harness)
    const header = nodeServerHistoryHeader(workspaceKeyOf(harness))
    const writer = await repository.serverHistories.start(header)
    await writer.appendRequest({
      elapsedMs: 1,
      attempt: 1,
      method: 'POST',
      path: header.declaredRequest.path,
      bodyBytes: 14,
    })
    await harness.reader.action('retry')

    // Act
    await harness.reader.openLearningReplay(header.studyId)
    await waitUntil(
      () => (lastView(harness)?.errors.length ?? 0) > 0,
      'the open is refused',
      READER_RESULT_BOUND_MS,
    )
    const whileRecording = lastView(harness)
    writer.abandon()
    await openServerReplay(harness, header.studyId)

    // Assert
    assert.equal(whileRecording?.nodeHistory, undefined)
    assert.equal(lastView(harness)?.nodeHistory?.status, 'interrupted')
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 1)
  } finally {
    await harness.close()
  }
})

// protects=a stop's lower frames reach the debugger with the reason their source is unavailable, so the Call Stack lists them as it does for a test replay; fails_when=the lower frame or its reason is dropped; no_claim=the Call Stack's own drawing
test('a stop with a lower frame presents it with its unavailable source reason', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const repository = repositoryOf(harness)
    const header = nodeServerHistoryHeader(workspaceKeyOf(harness))
    const capture = serverStopCapture({
      declaredStopIndex: 0,
      hit: 1,
      line: 2,
      elapsedMs: 10,
    })
    const snapshot: ReplayDebugSnapshot = {
      ...capture.snapshot,
      frames: [
        ...capture.snapshot.frames,
        {
          name: 'dispatch',
          line: 9,
          column: 1,
          sourceUnavailable: 'not captured',
          scopes: [],
        },
      ],
    }
    const writer = await repository.serverHistories.start(header)
    await writer.appendRequest({
      elapsedMs: 1,
      attempt: 1,
      method: 'POST',
      path: header.declaredRequest.path,
      bodyBytes: 14,
    })
    await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
    await writer.appendStop({ ...capture, snapshot })
    await writer.appendResponse({
      elapsedMs: 30,
      status: 201,
      contentType: 'application/json',
      body: '{}',
      bodyBytes: 2,
      readCut: false,
      location: null,
      requestDurationMs: 28,
    })
    await writer.seal({ elapsedMs: 40, reason: 'stopped' })

    // Act
    await openServerReplay(harness, header.studyId)
    const frames = harness.historicalDebugPresentations.at(-1)?.snapshot?.frames

    // Assert
    assert.deepEqual(
      frames?.map((frame) => [frame.name, frame.sourceUnavailable]),
      [
        ['handler', undefined],
        ['dispatch', 'not captured'],
      ],
    )
  } finally {
    await harness.close()
  }
})

// protects=a stop whose executed source was too large to store opens as a stop with no recorded source: the debugger shows nothing for the moment and the Study section names the reason; fails_when=the stop presents another source or the section hides why the source is unavailable; no_claim=the 512 KiB bound itself (the writer's own tests)
test('a stop whose executed source was too large to store says its recorded source is unavailable and why', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const repository = repositoryOf(harness)
    const header = nodeServerHistoryHeader(workspaceKeyOf(harness))
    const capture = serverStopCapture({
      declaredStopIndex: 0,
      hit: 1,
      line: 2,
      elapsedMs: 10,
      text: `// ${'x'.repeat(NODE_SERVER_SOURCE_TEXT_LIMIT_BYTES)}\n`,
    })
    const writer = await repository.serverHistories.start(header)
    await writer.appendRequest({
      elapsedMs: 1,
      attempt: 1,
      method: 'POST',
      path: header.declaredRequest.path,
      bodyBytes: 14,
    })
    await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
    await writer.appendStop(capture)
    await writer.seal({ elapsedMs: 40, reason: 'stopped' })

    // Act
    await openServerReplay(harness, header.studyId)
    const section = lastView(harness)?.nodeHistorySection

    // Assert
    assert.equal(
      section?.unverified,
      'Recorded source unavailable for this stop (too large).',
    )
    assert.equal(
      section?.notRecorded,
      'Source and debugger not recorded at this moment.',
    )
    assert.equal(
      harness.historicalDebugPresentations.at(-1)?.snapshot,
      undefined,
    )
  } finally {
    await harness.close()
  }
})

// protects=Next and Previous stop visit every recorded hit of a stop hit twice, and Next and Previous event move over the output and the response; fails_when=a hit is skipped, the second hit is not told apart as `Stop 1 · hit 2`, or an event move leaves the journal order; no_claim=Play's pacing
test('Next and Previous stop visit each hit of a repeated stop and Next event moves on to the output and the response', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header, sequences } = await writeServerHistory(
      repositoryOf(harness),
      {
        workspaceKey: workspaceKeyOf(harness),
        hits: [
          [0, 1],
          [0, 2],
        ],
        output: ['saved\n'],
      },
    )
    await openServerReplay(harness, header.studyId)
    const [firstHit, secondHit] = sequences.stops

    // Act
    await moveTo(
      harness,
      header.studyId,
      { direction: 'next', unit: 'stop' },
      secondHit!,
    )
    const atSecondHit = lastView(harness)?.nodeHistorySection?.position
    await moveTo(
      harness,
      header.studyId,
      { direction: 'previous', unit: 'stop' },
      firstHit!,
    )
    const atFirstHit = lastView(harness)?.nodeHistorySection?.position
    await moveTo(
      harness,
      header.studyId,
      { direction: 'next', unit: 'event' },
      secondHit!,
    )
    await moveTo(
      harness,
      header.studyId,
      { direction: 'next', unit: 'event' },
      sequences.output[0]!,
    )
    await moveTo(
      harness,
      header.studyId,
      { direction: 'next', unit: 'event' },
      sequences.response!,
    )

    // Assert
    assert.equal(atFirstHit, 'Stop 1 · hit 1 · 0.01 s')
    assert.equal(atSecondHit, 'Stop 1 · hit 2 · 0.02 s')
    assert.equal(
      shownApplicationView(harness)?.response?.state,
      'Response 201 · application/json',
    )
  } finally {
    await harness.close()
  }
})

// protects=a seek to a non-adjacent moment and back presents the same source slot and snapshot as the first visit, and moving back from the response clears it from the Application pane; fails_when=the return shows another stop's bytes or snapshot, or the response stays after moving back; no_claim=the slider's pixel position
test('seeking to the response and back to the stop presents the same snapshot and source and clears the response', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header, sequences } = await writeServerHistory(
      repositoryOf(harness),
      {
        workspaceKey: workspaceKeyOf(harness),
        hits: [
          [0, 1],
          [0, 2],
        ],
        output: ['saved\n'],
      },
    )
    await openServerReplay(harness, header.studyId)
    const firstVisit = harness.historicalDebugPresentations.at(-1)

    // Act
    await selectEvent(harness, header.studyId, sequences.response!)
    const atResponse = shownApplicationView(harness)?.response
    await selectEvent(harness, header.studyId, sequences.stops[0]!)
    const secondVisit = harness.historicalDebugPresentations.at(-1)
    const backAtStop = shownApplicationView(harness)?.response

    // Assert
    assert.equal(atResponse?.state, 'Response 201 · application/json')
    assert.equal(atResponse?.body, '{"id":7}')
    assert.equal(backAtStop?.state, 'No response recorded yet at this moment.')
    assert.equal(backAtStop?.body, undefined)
    assert.deepEqual(secondVisit?.snapshot, firstVisit?.snapshot)
    assert.equal(
      secondVisit?.sourceDocument?.hash,
      firstVisit?.sourceDocument?.hash,
    )
  } finally {
    await harness.close()
  }
})

// protects=a moment that is not a stop (the output, the response) clears the source highlight and the debugger and says so in the 4A line; fails_when=the debugger keeps the earlier stop at an output, or the line is missing; no_claim=the Run and Debug view's own text
test('a non-stop moment clears the debugger and says source and debugger are not recorded at this moment', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header, sequences } = await writeServerHistory(
      repositoryOf(harness),
      { workspaceKey: workspaceKeyOf(harness), output: ['saved\n'] },
    )
    await openServerReplay(harness, header.studyId)

    // Act
    const invalidationsBefore = harness.historicalDebugInvalidations()
    const presentationsBefore = harness.historicalDebugPresentations.length
    await selectEvent(harness, header.studyId, sequences.output[0]!)

    // Assert
    assert.equal(
      harness.historicalDebugInvalidations() - invalidationsBefore,
      1,
    )
    assert.equal(
      harness.historicalDebugInvalidationLabels().at(-1),
      'Not recorded at this moment',
    )
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsBefore,
    )
    assert.equal(
      lastView(harness)?.nodeHistorySection?.notRecorded,
      'Source and debugger not recorded at this moment.',
    )
    assert.match(
      harness.documentTextOf(slotUri(harness))!,
      /The server journal holds no source state for this moment\./,
    )
  } finally {
    await harness.close()
  }
})

// protects=understanding is saved only by the checkbox and returns with the playhead after the replay is opened again; fails_when=a move or a response marks understanding, or the decision or the playhead is lost at reopen; no_claim=the checkbox's markup
test('understanding is saved only by the checkbox, and the playhead and understanding return when the replay is opened again', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header, sequences } = await writeServerHistory(
      repositoryOf(harness),
      { workspaceKey: workspaceKeyOf(harness), output: ['saved\n'] },
    )
    await openServerReplay(harness, header.studyId)
    await selectEvent(harness, header.studyId, sequences.response!)
    const afterMoves = lastView(harness)?.nodeHistoryLearningDecision

    // Act
    harness.receiveContext({
      type: 'node-history-understanding',
      revision: lastView(harness)!.revision,
      studyId: header.studyId,
      understood: true,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryLearningDecision?.understood === true,
      'the decision is saved',
      READER_RESULT_BOUND_MS,
    )
    await harness.reader.close()
    await harness.reader.openLearningReplay(header.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === header.studyId &&
        !lastView(harness)?.loading,
      'the replay is shown again',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(afterMoves, undefined)
    assert.equal(
      lastView(harness)?.nodeHistoryLearningDecision?.understood,
      true,
    )
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.sequence,
      sequences.response,
    )
  } finally {
    await harness.close()
  }
})

// protects=a saved playhead on a storage-only entry (the source entry the first stop needs) restores the nearest earlier learner event, here the request; fails_when=the replay refuses the position or jumps to a later stop; no_claim=a position another window wrote
test('a saved playhead on a source entry restores the request before it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header, sequences } = await writeServerHistory(
      repositoryOf(harness),
      { workspaceKey: workspaceKeyOf(harness) },
    )
    // The fixture journal is request 1, send mark 2, source 3, stop 4: the position names the source entry.
    await repositoryOf(harness).serverHistories.saveReaderPosition(
      header.studyId,
      sequences.stops[0]! - 1,
    )

    // Act
    await openServerReplay(harness, header.studyId)

    // Assert
    assert.equal(
      lastView(harness)?.nodeHistoryPosition?.sequence,
      sequences.request,
    )
  } finally {
    await harness.close()
  }
})

// protects=two stop hits at the same recorded time keep their journal order and the timeline ends at the history's end entry, which comes after the response; fails_when=the hits swap, or the slider ends at the response; no_claim=the slider's pixel range
test('two hits at one time keep journal order and the slider ends at the end entry after the response', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const repository = repositoryOf(harness)
    const header = nodeServerHistoryHeader(workspaceKeyOf(harness))
    const writer = await repository.serverHistories.start(header)
    await writer.appendRequest({
      elapsedMs: 1,
      attempt: 1,
      method: 'POST',
      path: header.declaredRequest.path,
      bodyBytes: 14,
    })
    await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
    for (const hit of [1, 2])
      await writer.appendStop(
        serverStopCapture({
          declaredStopIndex: 0,
          hit,
          line: 2,
          elapsedMs: 50,
        }),
      )
    await writer.appendResponse({
      elapsedMs: 80,
      status: 200,
      contentType: 'text/plain',
      body: 'ok',
      bodyBytes: 2,
      readCut: false,
      location: null,
      requestDurationMs: 70,
    })
    await writer.seal({ elapsedMs: 900, reason: 'stopped' })

    // Act
    await openServerReplay(harness, header.studyId)
    const headings = lastView(harness)?.nodeServerEvents?.map(
      (event) => event.heading,
    )

    // Assert
    assert.deepEqual(headings?.slice(1, 3), [
      'Stop 1 · hit 1 · src/handler.ts:2:1 · 0.05 s',
      'Stop 1 · hit 2 · src/handler.ts:2:1 · 0.05 s',
    ])
    assert.equal(lastView(harness)?.nodeHistoryPlayback?.endMs, 900)
  } finally {
    await harness.close()
  }
})

// protects=a summary step that cites the request or the response moves the playhead to it, the explanation arriving while the replay is open keeps the playhead and shows the step, and an event the material cites reads its own step action; fails_when=the link does nothing, the explanation resets the playhead, or the action labels are missing; no_claim=the diagram's drawing
test('a step citing the response moves the playhead there, and the explanation arriving while the replay is open keeps the playhead', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const repository = repositoryOf(harness)
    const { header, sequences } = await writeServerHistory(repository, {
      workspaceKey: workspaceKeyOf(harness),
    })
    await openServerReplay(harness, header.studyId)
    const withoutMaterial = lastView(harness)?.nodeHistoryLearningSummary

    // Act
    const material = await repository.serverHistories.saveLearningMaterial(
      header.studyId,
      0,
      serverMaterial(sequences),
    )
    harness.reader.nodeHistoryLearningMaterialSaved(header.studyId, material)
    const keptPlayhead = lastView(harness)?.nodeHistoryPosition?.sequence
    await selectEvent(harness, header.studyId, sequences.response!, 'response')
    const atResponse = lastView(harness)?.nodeHistorySection
    await selectEvent(harness, header.studyId, sequences.request, 'request')
    const atRequest = lastView(harness)?.nodeHistorySection

    // Assert
    assert.equal(withoutMaterial, undefined)
    assert.equal(keptPlayhead, sequences.stops[0])
    assert.equal(atResponse?.selectedStepId, 'response')
    assert.equal(atResponse?.explanation, 'The server answers with the item.')
    assert.equal(atRequest?.selectedStepId, 'request')
    assert.deepEqual(atRequest?.stepActions, {
      request: 'Show request · 0.00 s',
      stop: 'Inspect Stop 1 · 0.01 s',
      response: 'Show response · 0.02 s',
    })
  } finally {
    await harness.close()
  }
})

// protects=moving through a server replay never calls the launcher or the HTTP sender, so no request is sent and no server starts; fails_when=any replay move reaches a child process or an HTTP request; no_claim=the run's own request path
test('moving through a server replay sends no request and starts no server', async (context) => {
  // Arrange
  const refused = (name: string) => () => {
    throw new Error(`${name} must not be called by a replay`)
  }
  const sender = context.mock.method(http, 'request', refused('HTTP sender'))
  const launcher = context.mock.method(
    childProcess,
    'spawn',
    refused('launcher'),
  )
  const harness = await workspaceHarness()
  try {
    const { header, sequences } = await writeServerHistory(
      repositoryOf(harness),
      { workspaceKey: workspaceKeyOf(harness), output: ['saved\n'] },
    )
    const sendersBefore = sender.mock.callCount()
    const launchersBefore = launcher.mock.callCount()

    // Act
    await openServerReplay(harness, header.studyId)
    await selectEvent(harness, header.studyId, sequences.request)
    await selectEvent(harness, header.studyId, sequences.response!)

    // Assert
    assert.equal(sender.mock.callCount(), sendersBefore)
    assert.equal(launcher.mock.callCount(), launchersBefore)
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// protects=a test replay, a server replay and a browser recording opened one after the other, while the first one's native presentation is still loading, leave only the last one shown: the late presentation of the earlier replay commits nothing over it; fails_when=the server replay's words or events survive the browser recording, or the finished presentation of the test replay brings its output back; no_claim=the native Run and Debug view itself (the harness holds the presentation)
test('opening a server replay and then a browser recording while a test replay presentation is still loading leaves only the recording shown', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const testHistory = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: workspaceKeyOf(harness),
    })
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(testHistory.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const held = harness.holdHistoricalDebugPresentation(true)
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: testHistory.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await held.started

    // Act
    await harness.reader.openLearningReplay(header.studyId)
    const whileServerShown = lastView(harness)
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    held.release()
    await harness.controller.settle()
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')

    // Assert
    assert.equal(whileServerShown?.nodeReplayProfile, 'node-server')
    assert.equal(whileServerShown?.nodeHistory?.header.studyId, header.studyId)
    assert.equal(lastView(harness)?.nodeHistory, undefined)
    assert.equal(lastView(harness)?.nodeReplayProfile, undefined)
    assert.equal(lastView(harness)?.nodeServerEvents, undefined)
    assert.equal(lastView(harness)?.contentTab, 'recording')
    assert.doesNotMatch(application!.webview.html, /id="test-output"/)
  } finally {
    await harness.close()
  }
})

// protects=an explanation another window saved reaches this window's library on its next refresh and its replay when it is opened; fails_when=the row stays Partial or the opened replay carries no learning summary; no_claim=a Trash move of a server replay, which Saved studies refuses (studyWorkspaceServerLibrary.test.ts) so no save can race it here
test('an explanation saved from another window shows in this window as Saved and in the replay it opens', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const learningDirectory =
      harness.service.nodeHistoryStore!.learningDirectory
    const { header, sequences } = await writeServerHistory(
      repositoryOf(harness),
      { workspaceKey: workspaceKeyOf(harness) },
    )
    const otherWindow = await openServerRepository(context, {
      learningDirectory,
      workspaceKey: workspaceKeyOf(harness),
    })

    // Act
    await otherWindow.repository.serverHistories.saveLearningMaterial(
      header.studyId,
      0,
      serverMaterial(sequences),
    )
    await harness.reader.action('retry')
    const row = harness.reader
      .inspect()
      .view!.studies.find((entry) => entry.id === header.studyId)
    await openServerReplay(harness, header.studyId)

    // Assert
    assert.equal(
      row?.outcome,
      'Creating an item · Server replay · POST /api/items → 201 · Saved',
    )
    assert.deepEqual(
      lastView(harness)?.nodeHistoryLearningSummary?.positions.map(
        (position) => position.stepId,
      ),
      ['request', 'stop', 'response'],
    )
  } finally {
    await harness.close()
  }
})
