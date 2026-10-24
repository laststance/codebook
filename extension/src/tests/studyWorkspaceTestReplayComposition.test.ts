import assert from 'node:assert/strict'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  NODE_TEST_HISTORY_DIRECTORY,
  STUDY_REMOVAL_REFUSALS,
  SUMMARY_PLACEMENT_OFFER,
} from '../constants'
import { StudyError } from '../errors'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { StudyViewMessage } from '../ui/studyHtml'

import {
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { lastView, saveTwoStopNodeHistory } from './utils/twoStopNodeHistory'

type Harness = Awaited<ReturnType<typeof workspaceHarness>>
type HistoryHeader = ReturnType<typeof nodeTestHistoryHeader>
type HistoryWriter = Awaited<
  ReturnType<NonNullable<Harness['service']['nodeHistoryStore']>['start']>
>

const STOP_SOURCE_TEXT = 'const nextTheme = "dark";\n'

/**
 * Appends the one stop a history's header declares, with its recorded value, so the history can be sealed with its result.
 * @param writer - The history's writer.
 * @param header - The history's header, whose configuration names the stop's source.
 * @param elapsedMs - When the stop paused.
 * @example await appendDeclaredStop(writer, header, 5)
 */
async function appendDeclaredStop(
  writer: HistoryWriter,
  header: HistoryHeader,
  elapsedMs: number,
): Promise<void> {
  await writer.appendStop({
    index: 0,
    runId: 'test-run',
    sessionId: 'test-session',
    threadId: 1,
    elapsedMs,
    worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
    source: header.configuration.source,
    frame: { id: 1, name: 'applyTheme', line: 1, column: 1 },
    variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
    facts: [
      { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
    ],
    debuggerSnapshot: {
      version: 1,
      frames: [
        {
          name: 'applyTheme',
          line: 1,
          column: 1,
          source: {
            name: header.configuration.source.path,
            text: STOP_SOURCE_TEXT,
            hash: sha256(STOP_SOURCE_TEXT),
            line: 1,
          },
          scopes: [{ name: 'Local', variables: [0] }],
        },
      ],
      variables: [
        { name: 'nextTheme', value: 'dark', type: 'string', children: [] },
      ],
      limitations: [],
    },
  })
}

const SUMMARY_MOVE = {
  viewIds: ['codebook.learningSummary'],
  destinationId: 'workbench.panel.chat',
}

/**
 * Waits until the selected test replay shows one committed moment.
 * @param harness - The workspace harness.
 * @param sequence - The event the replay should show.
 * @param description - What the wait is for, named in its timeout.
 * @example await landsOn(harness, 2, 'the test replay lands on its first stop')
 */
async function landsOn(
  harness: Harness,
  sequence: number,
  description: string,
): Promise<void> {
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistoryPosition?.sequence === sequence &&
      !lastView(harness)?.nodeHistoryPosition?.pending &&
      !lastView(harness)?.loading,
    description,
    READER_RESULT_BOUND_MS,
  )
}

/**
 * Opens the Study composition, then a saved two-stop test replay by the learner's Saved studies choice in the Study pane, and waits for its first stop.
 * @param harness - The workspace harness.
 * @returns The replay's header.
 * @example const history = await openFromSavedStudies(harness)
 */
async function openFromSavedStudies(harness: Harness) {
  const history = await saveTwoStopNodeHistory(
    harness.service.nodeHistoryStore!,
  )
  await harness.reader.action('retry')
  await harness.reader.open()
  harness.receiveContext({
    type: 'node-history',
    revision: lastView(harness)!.revision,
    studyId: history.studyId,
  })
  await landsOn(harness, 2, 'the Saved studies choice lands on the first stop')
  return history
}

/**
 * Opens the Study composition, then a saved two-stop test replay by the status item's Open replay, and waits for its first stop.
 * @param harness - The workspace harness.
 * @returns The replay's header.
 * @example const history = await openByOpenReplay(harness)
 */
async function openByOpenReplay(harness: Harness) {
  const history = await saveTwoStopNodeHistory(
    harness.service.nodeHistoryStore!,
  )
  await harness.reader.action('retry')
  await harness.reader.open()
  await harness.reader.openLearningReplay(history.studyId)
  await landsOn(harness, 2, 'Open replay lands on the first stop')
  return history
}

/**
 * Reads the parts of the composition a test replay's open decides.
 * @param harness - The workspace harness.
 * @returns Whether the Study pane, the Application pane and the Learning summary show, and the family the panes are told.
 * @example compositionOf(harness) // => { studyPane: false, application: true, summary: true, family: 'test' }
 */
function compositionOf(harness: Harness) {
  return {
    studyPane: harness.panelColumn('codebook.studyContext') !== undefined,
    application: harness.panelColumn('codebook.scopedBrowser') !== undefined,
    summary: harness.summary.visible,
    family: lastView(harness)?.replayFamily,
  }
}

for (const entry of ['Open replay', 'Saved studies'] as const) {
  // Value: protects=the learner's entry into a test replay in VS Code gives region 2's composition: the Study pane closes, the Application pane and the recorded source stay, and the Learning summary shows in the chat's place, moved beside the chat once per profile; fails_when=the Study pane stays open with the replay in its Test replay section, the summary keeps its placeholder, or the move does not run; why_new=Cycle 0051 DS-A (AC1): a test replay entered the Study composition; seam=workspaceHarness (VS Code), openLearningReplay and the Study pane's node-history message, the fake vscode.moveViews; no_claim=the native placement, which N51 (a) checks
  test(`${entry} in VS Code opens a test replay with the Study pane closed and the Learning summary beside the chat`, async () => {
    // Arrange
    const harness = await workspaceHarness()
    try {
      // Act
      if (entry === 'Open replay') await openByOpenReplay(harness)
      else await openFromSavedStudies(harness)

      // Assert
      assert.deepEqual(compositionOf(harness), {
        studyPane: false,
        application: true,
        summary: true,
        family: 'test',
      })
      assert.deepEqual(harness.moveViewsCalls(), [SUMMARY_MOVE])
    } finally {
      await harness.close()
    }
  })

  // Value: protects=the learner's entry into a test replay in Cursor gives the same composition with the summary in its own container and the published Move View offer, as a browser replay does (D31 of #118); fails_when=the composition differs from VS Code's, a move runs in Cursor, or no offer is made; why_new=Cycle 0051 DS-A (AC1); seam=workspaceHarness with useHostAppName('Cursor'), the harness's information messages; no_claim=Cursor's own Move View list
  test(`${entry} in Cursor opens a test replay with the Study pane closed, moves no view and offers Move View`, async () => {
    // Arrange
    const harness = await workspaceHarness()
    harness.useHostAppName('Cursor')
    try {
      // Act
      if (entry === 'Open replay') await openByOpenReplay(harness)
      else await openFromSavedStudies(harness)
      await waitUntil(
        () =>
          harness.informationMessages.some(
            (notice) => notice.message === SUMMARY_PLACEMENT_OFFER,
          ),
        'the Move View offer is made',
        READER_RESULT_BOUND_MS,
      )

      // Assert
      assert.deepEqual(compositionOf(harness), {
        studyPane: false,
        application: true,
        summary: true,
        family: 'test',
      })
      assert.deepEqual(harness.moveViewsCalls(), [])
    } finally {
      await harness.close()
    }
  })
}

// Value: protects=MCP 1.8's contract for a test replay: an agent's codebook_playback open of its study id is refused with PLAYBACK_PROFILE_UNSUPPORTED and its recovery sentence, and the refused call changes no selection, view or focus; fails_when=the agent's open enters the composition, moves a view or the keyboard, or the refusal's code or words change; why_new=Cycle 0051 DS-A (AC1), the DX review's correction that an agent cannot open a test replay; seam=the service's playback call; no_claim=the agent's own retry
test('an agent’s codebook_playback open of a test replay is refused and changes no selection, view or focus', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()
    const before = {
      messages: harness.postedMessages().length,
      focusCommands: harness.viewFocusCommands.length,
      composition: compositionOf(harness),
    }

    // Act
    let refusal: unknown
    try {
      harness.service.playback({
        instanceId: harness.service.instanceId,
        studyId: history.studyId,
        action: 'open',
        expectedRevision: 0,
      })
    } catch (error) {
      refusal = error
    }

    // Assert
    assert.ok(refusal instanceof StudyError)
    assert.equal(refusal.code, 'PLAYBACK_PROFILE_UNSUPPORTED')
    assert.equal(
      refusal.message,
      `codebook_playback cannot control study ${history.studyId}: it is a node-test replay, which the learner opens from Saved studies or Open replay.`,
    )
    assert.equal(harness.postedMessages().length, before.messages)
    assert.equal(harness.viewFocusCommands.length, before.focusCommands)
    assert.deepEqual(compositionOf(harness), before.composition)
    assert.equal(lastView(harness)?.nodeHistory, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=the presentation an agent reads for a test replay: the summary composition's pane set (the Application and the recorded source, no Study pane), as for a browser replay; fails_when=the presentation still names a Study pane column for a test replay; why_new=Cycle 0051 AC1; seam=the reader's presentation state; no_claim=the native columns
test('the presentation of a shown test replay reports the Application and the recorded source with no Study pane', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    await openByOpenReplay(harness)

    // Act
    const panes = harness.reader.inspect().presentation.panes

    // Assert
    assert.notEqual(panes.appColumn, undefined)
    assert.notEqual(panes.sourceColumn, undefined)
    assert.equal(panes.contextColumn, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=a node-history move sent from the Learning summary view moves the test replay (DS-F); fails_when=the summary view's message is dropped because the reader accepts the Study pane's alone; why_new=Cycle 0051 DS-F (AC6): the summary view's messages were dropped unless a browser recording was active; seam=the harness's summary view listener; no_claim=the view's own buttons (Reader DOM)
test('Next stop sent from the Learning summary moves the test replay', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)

    // Act
    harness.receive({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await landsOn(harness, 4, 'the summary view’s Next stop reaches stop 2')

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 4)
    assert.equal(lastView(harness)?.nodeHistoryRefusal, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=a node-history move sent from the bottom panel's transport moves the test replay (DS-F); fails_when=the bottom panel's message is dropped or refused; why_new=Cycle 0051 DS-F (AC6): the shared transport sends from the bottom panel during a test replay; seam=the harness's bottom panel listener; no_claim=the panel's own buttons (Reader DOM)
test('Next event sent from the bottom panel moves the test replay', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)

    // Act
    harness.receivePlaybackPanel({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'event',
    })
    await landsOn(
      harness,
      3,
      'the bottom panel’s Next event reaches the output after stop 1',
    )

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 3)
    assert.equal(lastView(harness)?.nodeHistoryRefusal, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=the one-replay-at-a-time rule in the shared views: during a browser replay a test replay's move from the Learning summary is refused with the existing sentence and moves nothing; fails_when=the move is accepted or refused silently; why_new=Cycle 0051 DS-F (AC6); seam=recordedReaderHarness, the harness's summary listener; no_claim=none beyond protects
test('a test replay move sent from the Learning summary during a browser replay is refused with its sentence', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const testReplayId = nodeTestHistoryHeader(
      harness.service.nodeHistoryStore!.workspaceKey,
    ).studyId

    // Act
    harness.receive({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: testReplayId,
      direction: 'next',
      unit: 'stop',
    })
    await waitUntil(
      () =>
        lastView(harness)?.errors.some((line) =>
          line.includes(
            'Close browser replay before navigating a test replay.',
          ),
        ) === true,
      'the move is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(lastView(harness)?.replayFamily, 'browser')
    assert.equal(lastView(harness)?.nodeHistory, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=5A for a paused test replay: hiding the Learning summary and pressing the Learning summary button (Codebook: Show Learning Summary) shows it again on the same moment, playhead and replay debugger presentation; fails_when=the reopen moves the replay, presents the debugger again or refuses a test replay; why_new=Cycle 0051 DS-E (AC5): Show Learning Summary refused a test replay; seam=hideSummary and the debugger stand-in's presentation list; no_claim=the scroll position and focus in the real hosts (N51 (c))
test('hiding a paused test replay’s Learning summary and showing it again keeps the moment, the playhead and the debugger presentation', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    await openByOpenReplay(harness)
    const before = {
      sequence: lastView(harness)?.nodeHistoryPosition?.sequence,
      positionMs: lastView(harness)?.nodeHistoryPlayback?.positionMs,
      presentations: harness.historicalDebugPresentations.length,
    }
    harness.hideSummary()

    // Act
    await harness.reader.showLearningSummary()

    // Assert
    assert.equal(harness.summary.visible, true)
    assert.deepEqual(
      {
        sequence: lastView(harness)?.nodeHistoryPosition?.sequence,
        positionMs: lastView(harness)?.nodeHistoryPlayback?.positionMs,
        presentations: harness.historicalDebugPresentations.length,
      },
      before,
    )
    assert.equal(
      harness.viewFocusCommands.at(-1)?.command,
      'codebook.learningSummary.focus',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=5A for a paused browser replay: the same hide and reopen keeps its moment and playhead; fails_when=the reopen seeks or reloads the recording; why_new=Cycle 0051 DS-E (AC5), both families; seam=recordedReaderHarness and hideSummary; no_claim=the scroll position and focus in the real hosts (N51 (c))
test('hiding a paused browser replay’s Learning summary and showing it again keeps its moment and playhead', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const before = {
      presentedMs: lastView(harness)?.recording?.presentedMs,
      mode: lastView(harness)?.recording?.mode,
    }
    harness.hideSummary()

    // Act
    await harness.reader.showLearningSummary()
    await harness.controller.settle()

    // Assert
    assert.equal(harness.summary.visible, true)
    assert.deepEqual(
      {
        presentedMs: lastView(harness)?.recording?.presentedMs,
        mode: lastView(harness)?.recording?.mode,
      },
      before,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=5A for a playing test replay: hiding the summary neither pauses nor resumes playback, and the reopened summary shows the moment then current; fails_when=the hide pauses the timer or the reopen restarts it; why_new=Cycle 0051 DS-E (AC5); seam=hideSummary and the host's real playback timer; no_claim=native timing
test('a playing test replay goes on playing while its Learning summary is hidden', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)
    harness.hideSummary()

    // Act
    harness.receivePlaybackPanel({
      type: 'node-history-playback',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      action: 'play',
    })
    await landsOn(
      harness,
      5,
      'playback reaches the result with the summary hidden',
    )
    await harness.reader.showLearningSummary()

    // Assert
    assert.equal(harness.summary.visible, true)
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 5)
  } finally {
    await harness.close()
  }
})

// Value: protects=Return to Live from a test replay gives the Live composition as a browser replay's Return to Live does: the replay is retired and the Study pane stays closed; fails_when=the Study pane comes back, or the replay stays selected; why_new=Cycle 0051 DS-A (AC15), the Eng review's correction; seam=the reader's return-current action; no_claim=the keyboard focus in the real hosts (N51 (e))
test('Return to Live from a test replay retires it and keeps the Study pane closed', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    await openByOpenReplay(harness)

    // Act
    await harness.reader.action('return-current')

    // Assert: the Live composition has no Study pane, so the bottom panel holds the reader's last message.
    const bottomPanelView = harness.playbackPanelMessages.at(-1)
    assert.equal(bottomPanelView?.nodeHistory, undefined)
    assert.equal(bottomPanelView?.replayFamily, undefined)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=Return to Live from a test replay withdraws the Learning summary's replay document, as a browser replay's Return to Live does, so no stale summary with controls that answer nothing stays beside the chat; fails_when=the summary keeps the test replay's document after the reader left the summary composition; why_new=Cycle 0051 /ship review pass 2 (Codex structured: leaving a test replay never cleared the summary, AC15); seam=none; no_claim=the native view's look
test('Return to Live from a test replay gives the Learning summary its placeholder, as a browser replay’s Return to Live does', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    await openByOpenReplay(harness)
    const replayDocumentShown = harness.summary.webview.html.includes(
      'id="recording-transport"',
    )

    // Act
    await harness.reader.action('return-current')

    // Assert
    assert.equal(replayDocumentShown, true)
    assert.equal(
      harness.summary.webview.html.includes(
        'Open saved learning from Codebook to view its summary.',
      ),
      true,
    )
  } finally {
    await harness.close()
  }
})

/**
 * Records the families of the Study messages a view's webview receives from now on, by wrapping its `postMessage`; the departure tests read it to prove that no message of the wrong family reaches a view while the reader leaves a replay.
 * @param view - The harness's Learning summary or bottom panel view.
 * @returns The live list of each received Study message's `replayFamily` (`undefined` for a message outside a replay).
 * @example const families = recordStudyFamilies(harness.summary)
 */
function recordStudyFamilies(view: {
  webview: { postMessage: (message: StudyViewMessage) => Promise<boolean> }
}): (StudyViewMessage['replayFamily'] | 'none')[] {
  const families: (StudyViewMessage['replayFamily'] | 'none')[] = [],
    post = view.webview.postMessage.bind(view.webview)
  view.webview.postMessage = async (message: StudyViewMessage) => {
    if (message.type === 'study') families.push(message.replayFamily ?? 'none')
    return post(message)
  }
  return families
}

// Value: protects=Return to Live from a test replay withdraws the Learning summary before the reader publishes the Live state, so the summary never draws the Live Study page beside the chat; fails_when=the summary receives any Study message after the return starts (N51 saw 1 to 3 frames of Live Study content); why_new=Cycle 0052 task 2 (N51-V2): retireNodeHistorySelection published while the summary still showed the replay's document; seam=the harness's summary webview postMessage; no_claim=the native frames, which N52 (e) checks
test('Return to Live from a test replay sends the Learning summary no Study message', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    await openByOpenReplay(harness)
    const summaryFamilies = recordStudyFamilies(harness.summary)

    // Act
    await harness.reader.action('return-current')

    // Assert
    assert.deepEqual(summaryFamilies, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=Return to Live from a browser replay never names the test replay family while it leaves, so neither the bottom panel nor the summary draws a history-less test replay transport; fails_when=any Study message posted after the return starts carries replayFamily 'test' (N51 saw 1 to 2 frames of 'Test journal playback'); why_new=Cycle 0052 task 3 (N51-V3): shownReplayFamily read the absence of a recording as a test replay; seam=recordedReaderHarness, the summary's and bottom panel's postMessage; no_claim=the native frames, which N52 (e) checks
test('Return to Live from a browser replay never shows the test replay transport', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const summaryFamilies = recordStudyFamilies(harness.summary),
      bottomPanelFamilies = recordStudyFamilies(harness.playbackPanel)

    // Act
    await harness.reader.action('return-current')

    // Assert
    assert.deepEqual(
      [...summaryFamilies, ...bottomPanelFamilies].filter(
        (family) => family === 'test',
      ),
      [],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a browser replay's Learning summary draws its replay from its first message: no Study message without the recording reaches it while the replay opens, and none reaches it while Return to Live leaves; fails_when=the summary receives a Study message with no recording (N51 saw 1 frame of Study content at the open and at the return); why_new=Cycle 0052 task 6 (N51-V6): the summary got the generic Study document and a publish inside open() before the presented bundle; seam=recordedReaderHarness, the summary webview's postMessage; no_claim=the native frames, which N52 (d) and (e) check
test('a browser replay’s Learning summary receives no Study message without its recording at the open or the return', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const withoutRecording: string[] = [],
      post = harness.summary.webview.postMessage.bind(harness.summary.webview)
    harness.summary.webview.postMessage = async (message: StudyViewMessage) => {
      if (message.type === 'study' && message.recording === undefined)
        withoutRecording.push(message.replayFamily ?? 'none')
      return post(message)
    }

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.action('return-current')

    // Assert
    assert.deepEqual(withoutRecording, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a refused test replay move shows the host's sentence in the shared transport's status line, read with the summary hidden too, and leaves the committed moment; fails_when=the refusal reaches only the Study pane's error lines, or the moment changes; why_new=Cycle 0051 DS-G (AC14); seam=the projection's nodeHistoryRefusal; no_claim=the status line's rendering (Reader DOM)
test('a refused Previous stop at the first stop shows its sentence for the transport and keeps the moment', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)
    harness.hideSummary()

    // Act
    harness.receivePlaybackPanel({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'previous',
      unit: 'stop',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryRefusal !== undefined,
      'the refusal reaches the transport',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      lastView(harness)?.nodeHistoryRefusal,
      'There is no previous stop in this test replay.',
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
  } finally {
    await harness.close()
  }
})

// Value: protects=a move whose replay debugger does not start: the transport's sentence carries the open path's recovery clause and says the last moment is still shown, and following it (selecting that stop again) reaches the target; fails_when=the bare cause is shown, the failed moment is shown as new, or the stop cannot be reached again; why_new=Cycle 0051 DS-G (AC14), the DX review's finding; seam=the harness's held historical debug presentation, rejected as a start failure; no_claim=a real DAP failure
test('a move whose replay debugger does not start names the recovery and selecting that stop again reaches it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)
    harness.hideSummary()
    const held = harness.holdHistoricalDebugPresentation(true)
    harness.receivePlaybackPanel({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await held.started

    // Act
    held.reject(new Error('Workspace trust was declined.'))
    await waitUntil(
      () => lastView(harness)?.nodeHistoryRefusal !== undefined,
      'the failure reaches the transport',
      READER_RESULT_BOUND_MS,
    )
    const failure = lastView(harness)?.nodeHistoryRefusal
    const shownAfterFailure = lastView(harness)?.nodeHistoryPosition?.sequence
    harness.receivePlaybackPanel({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 4,
    })
    await landsOn(harness, 4, 'selecting the stop again reaches it')

    // Assert
    assert.equal(
      failure,
      'The replay debugger could not start: Workspace trust was declined. The last moment is still shown. Select this stop or use Inspect in native debugger to restart it.',
    )
    assert.equal(shownAfterFailure, 2)
    assert.equal(lastView(harness)?.nodeHistoryRefusal, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=the host's first and last events by sequence: in a history whose first two events share one time, Replay from start and Home (node-history-event with firstSequence) show sequence 1, not the second event a seek to that time would select; fails_when=firstSequence is missing or is the last event at the first time; why_new=Cycle 0051 DS-C, the Eng review's finding (equal times are stored); seam=a saved history whose first two outputs share 0 ms, then its stop and result; no_claim=the page's buttons (Reader DOM)
test('Replay from start in a history whose first two events share one time reaches the first event', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const header = nodeTestHistoryHeader(store.workspaceKey)
    const writer = await store.start(header)
    for (const sequence of [1, 2])
      await writer.appendOutput({
        sequence,
        elapsedMs: 0,
        channel: 'stdout',
        text: `output ${sequence}\n`,
      })
    await appendDeclaredStop(writer, header, 5)
    await writer.appendResult(
      { exitCode: 0, signal: null, output: 'Tests 1 passed' },
      9,
    )
    await writer.finish('complete')
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(header.studyId)
    await waitUntil(
      () =>
        !lastView(harness)?.loading && Boolean(lastView(harness)?.nodeHistory),
      'the history opens',
      READER_RESULT_BOUND_MS,
    )
    harness.receive({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: header.studyId,
      sequence: 4,
    })
    await landsOn(harness, 4, 'the result is selected')

    // Act
    const firstSequence = lastView(harness)?.nodeHistoryPlayback?.firstSequence
    harness.receive({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: header.studyId,
      sequence: firstSequence,
    })
    await landsOn(harness, 1, 'Replay from start reaches the first event')

    // Assert
    assert.equal(firstSequence, 1)
    assert.equal(lastView(harness)?.nodeHistoryPlayback?.lastSequence, 4)
  } finally {
    await harness.close()
  }
})

// Value: protects=the first and last events from any page of the event list: a 41-event history on its second page still projects its whole-history first and last sequence, and End reaches the last event; fails_when=the page's own first or last entry is projected; why_new=Cycle 0051 DS-C, the Eng review's finding (pages of 20); seam=a saved history of 39 outputs, its stop and a result, the node-history-page message; no_claim=none beyond protects
test('the first and last events of a 41-event history are projected from its second page and End reaches the last', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const header = nodeTestHistoryHeader(store.workspaceKey)
    const writer = await store.start(header)
    for (let sequence = 1; sequence <= 39; sequence++)
      await writer.appendOutput({
        sequence,
        elapsedMs: sequence * 10,
        channel: 'stdout',
        text: `output ${sequence}\n`,
      })
    await appendDeclaredStop(writer, header, 395)
    await writer.appendResult(
      { exitCode: 0, signal: null, output: 'Tests 1 passed' },
      500,
    )
    await writer.finish('complete')
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(header.studyId)
    await waitUntil(
      () =>
        !lastView(harness)?.loading && Boolean(lastView(harness)?.nodeHistory),
      'the history opens',
      READER_RESULT_BOUND_MS,
    )
    harness.receive({
      type: 'node-history-page',
      revision: lastView(harness)!.revision,
      studyId: header.studyId,
      page: 1,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistory?.entries[0]?.sequence === 21,
      'the second page is shown',
      READER_RESULT_BOUND_MS,
    )

    // Act
    const playback = lastView(harness)?.nodeHistoryPlayback
    harness.receive({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: header.studyId,
      sequence: playback?.lastSequence,
    })
    await landsOn(harness, 41, 'End reaches the last event')

    // Assert
    assert.equal(playback?.firstSequence, 1)
    assert.equal(playback?.lastSequence, 41)
  } finally {
    await harness.close()
  }
})

// Value: protects=a failed open of a test replay leaves no empty summary composition: the Study composition comes back with the failure on its line, beside the load-failure notification that ends with the Saved studies sentence (DS-G); fails_when=the reader stays in the summary composition with no replay shown, or the notification loses its recovery sentence; why_new=Cycle 0051 DS-G (AC14): the open enters the composition before it reads the history; seam=a journal edited after its seal; no_claim=Show details, which the notification's button runs
test('a test replay whose history cannot be read leaves the summary composition and tells the failure with its Saved studies sentence', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()
    await appendFile(
      join(
        (await harness.reader.learningStorage()).directory,
        NODE_TEST_HISTORY_DIRECTORY,
        history.studyId,
        'events.jsonl',
      ),
      '{"type":"forged"}\n',
    )

    // Act
    await harness.reader.openLearningReplay(history.studyId)

    // Assert
    assert.equal(
      harness.panelColumn('codebook.studyContext') !== undefined,
      true,
    )
    assert.equal(lastView(harness)?.replayFamily, undefined)
    assert.equal(lastView(harness)?.nodeHistory, undefined)
    assert.equal(harness.errorMessages.length, 1)
    assert.match(
      harness.errorMessages[0]!,
      /The saved history is unchanged; open it again from Saved studies\.$/,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=choosing another saved test replay retires the shown one and stops its playback timer, also with its summary hidden: the other replay opens paused on its own first stop and the first one moves no more; fails_when=the first replay's timer keeps selecting its events, or the second opens playing; why_new=Cycle 0051 DS-A (AC15), the Eng review's retirement rule; seam=two saved histories, the host's real playback timer; no_claim=native timing
test('choosing another saved test replay while the first plays with its summary hidden stops the first one’s timer', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const first = await openByOpenReplay(harness)
    const second = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    // The library lists the second replay once it is read again.
    await harness.reader.action('retry')
    harness.hideSummary()
    harness.receivePlaybackPanel({
      type: 'node-history-playback',
      revision: lastView(harness)!.revision,
      studyId: first.studyId,
      action: 'play',
    })

    // Act
    await harness.reader.openLearningReplay(second.studyId)
    await landsOn(harness, 2, 'the second replay lands on its first stop')
    const shownAfterOpen = lastView(harness)?.nodeHistory?.header.studyId
    // gstack-timing-ok: a stopped timer is shown by nothing happening; 600 ms outlasts the whole 400 ms history's playback.
    await new Promise((resolve) => setTimeout(resolve, 600))

    // Assert
    assert.equal(shownAfterOpen, second.studyId)
    assert.equal(lastView(harness)?.nodeHistory?.header.studyId, second.studyId)
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
    assert.equal(lastView(harness)?.nodeHistoryPlayback?.mode, 'paused')
  } finally {
    await harness.close()
  }
})

// Value: protects=Return to Live while a test replay plays with its summary hidden stops its timer with the retirement, so no event is selected after the return; fails_when=the timer keeps ticking and a late selection brings the retired replay back into a message; why_new=Cycle 0051 DS-A (AC15); seam=the host's real playback timer and the bottom panel's messages; no_claim=native timing
test('Return to Live while a test replay plays with its summary hidden stops its timer', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)
    harness.hideSummary()
    harness.receivePlaybackPanel({
      type: 'node-history-playback',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      action: 'play',
    })

    // Act
    await harness.reader.action('return-current')
    const messagesAtReturn = harness.playbackPanelMessages.length
    // gstack-timing-ok: a stopped timer is shown by nothing happening; 600 ms outlasts the whole 400 ms history's playback.
    await new Promise((resolve) => setTimeout(resolve, 600))

    // Assert
    assert.equal(
      harness.playbackPanelMessages
        .slice(messagesAtReturn)
        .some((message) => message.nodeHistory !== undefined),
      false,
    )
    assert.equal(harness.reader.inspect().view?.nodeHistory, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=the shown test replay against a delete request from the Learning summary's Saved studies: test replays cannot be deleted, so the refusal is said and the replay keeps its moment (the plan's retirement by deletion does not arise); fails_when=the request removes the replay or moves it; why_new=Cycle 0051 finding 1 (a premise of the plan's AC15); seam=the summary view's delete-study message; no_claim=the removal of a browser study
test('a delete request for the shown test replay is refused and the replay keeps its moment', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)

    // Act
    harness.receive({
      type: 'delete-study',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      removalRequest: 1,
    })
    await waitUntil(
      () => lastView(harness)?.studyRemoval?.status === 'refused',
      'the delete request is answered',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      lastView(harness)?.studyRemoval?.text,
      STUDY_REMOVAL_REFUSALS.nodeHistory,
    )
    assert.equal(
      lastView(harness)?.nodeHistory?.header.studyId,
      history.studyId,
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
  } finally {
    await harness.close()
  }
})

// Value: protects=a node-history move that arrives after Return to Live retired the test replay is refused with the existing sentence and moves nothing; fails_when=the late move brings the retired replay back or is accepted silently; why_new=Cycle 0051 DS-F (AC15): the summary and the bottom panel send moves now; seam=the bottom panel's listener after the return; no_claim=none beyond protects
test('a test replay move that arrives after Return to Live is refused and moves nothing', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)
    await harness.reader.action('return-current')

    // Act: the move carries the bottom panel's current revision, so only the retirement can refuse it.
    harness.receivePlaybackPanel({
      type: 'node-history-step',
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await waitUntil(
      () =>
        harness.playbackPanelMessages
          .at(-1)
          ?.errors.some((line) =>
            line.includes(
              'Select the matching saved test replay before navigating its timeline.',
            ),
          ) === true,
      'the late move is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(harness.reader.inspect().view?.nodeHistory, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=a node-history-event naming a sequence the history does not hold is refused before any move, so the shown moment stays; fails_when=the request moves the replay or clears its moment; why_new=Cycle 0051 DS-F (AC15); seam=the summary view's listener; no_claim=none beyond protects
test('a test replay event request for a sequence the history does not hold is refused and keeps the moment', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)

    // Act
    harness.receive({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 99,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryRefusal !== undefined,
      'the request is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      lastView(harness)?.nodeHistoryRefusal,
      'The requested event of this test replay is unavailable.',
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
  } finally {
    await harness.close()
  }
})

// Value: protects=moves from two views and a held key end at the latest request: while a move is still presenting, Next event from the bottom panel and then from the summary add up from the moment being reached, and no superseded move reports a refusal; fails_when=the moves queue on the shown moment, or a superseded move's failure shows in the transport; why_new=Cycle 0051 DS-F (AC15): three views share the one selection; seam=the harness's held historical debug presentation; no_claim=real key repeat rates
test('moves from the bottom panel and the Learning summary while a move presents end at the latest request with no refusal', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)
    const held = harness.holdHistoricalDebugPresentation(true)
    harness.receivePlaybackPanel({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await held.started

    // Act
    harness.receive({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'event',
    })
    await landsOn(harness, 5, 'the latest request reaches the result')
    held.reject(new Error('Historical debugger presentation was superseded.'))
    // gstack-timing-ok: the superseded presentation's rejection settles in the next turns, and the case shows that it reports nothing.
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 5)
    assert.equal(lastView(harness)?.nodeHistoryRefusal, undefined)
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a Learning summary view the host had not resolved before the learner's first test replay entry gets the reader's document and the test replay's latest Study message when it resolves, instead of the closed replay's placeholder; fails_when=the resolved view shows the placeholder or holds no test replay message; why_new=Cycle 0051 DS-E (AC5): the test replay never used the summary view before; seam=the harness's lazily resolved summary view; no_claim=native focus timing (N51 (c))
test('a Learning summary view first resolved at a test replay entry gets the reader’s document and the replay’s message', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    const htmlBefore = harness.summary.webview.html

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await landsOn(harness, 2, 'the replay lands on its first stop')

    // Assert
    assert.equal(htmlBefore, '')
    assert.match(harness.summary.webview.html, /id="node-history"/)
    assert.equal(
      lastView(harness)?.nodeHistory?.header.studyId,
      history.studyId,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the bottom panel's title and content: "Learning replay" with the shared transport during a test replay, and "Observed moments" outside a replay (DS-D); fails_when=a test replay keeps "Observed moments" and its second copy of the Study pane, or the title stays after the replay; why_new=Cycle 0051 task 7 (the entry audit's finding); seam=the harness's bottom panel; no_claim=the panel's drawing (Reader DOM)
test('the bottom panel reads Learning replay during a test replay and Observed moments after Return to Live', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    await openByOpenReplay(harness)
    const duringReplay = {
      title: (harness.playbackPanel as { title?: string }).title,
      family: harness.playbackPanelMessages.at(-1)?.replayFamily,
    }

    // Act
    await harness.reader.action('return-current')

    // Assert
    assert.deepEqual(duringReplay, { title: 'Learning replay', family: 'test' })
    assert.equal(
      (harness.playbackPanel as { title?: string }).title,
      'Observed moments',
    )
    assert.equal(harness.playbackPanelMessages.at(-1)?.replayFamily, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=no test replay reopens by itself after a window reload, and reopening it from Saved studies enters the summary composition at its saved reader position without moving the summary again (once per profile); fails_when=the fresh reader opens a replay by itself, lands on the first stop instead of the saved one, or moves the view a second time; why_new=Cycle 0051 AC13, the Eng review's correction (the persisted selection is the browser profile's only); seam=a second reader over the same storage and profile state (harness.createReader) after the first one closed; no_claim=VS Code's own restore of the views
test('after a reload no test replay reopens by itself, and its reopen lands on the saved stop without a second summary move', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)
    harness.receive({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await landsOn(harness, 4, 'the learner moves to stop 2')
    await harness.reader.close()
    const fresh = harness.createReader()
    await fresh.attach(harness.service)

    // Act
    const shownAfterReload = fresh.inspect().view?.nodeHistory
    await fresh.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        fresh.inspect().view?.nodeHistoryPosition?.sequence === 4 &&
        !fresh.inspect().view?.loading,
      'the reopen lands on the saved stop',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(shownAfterReload, undefined)
    assert.deepEqual(harness.moveViewsCalls(), [SUMMARY_MOVE])
    await fresh.close()
  } finally {
    await harness.close()
  }
})

// Value: protects=two test replay entries made at once on a closed reader: the entries take turns entering the composition, so the latest one opens its replay instead of being refused as busy while the earlier one is cancelled and no replay shows; fails_when=both entries run open() together and neither replay is shown; why_new=Cycle 0051 local CodeRabbit CLI finding (major): the entry ticket cancelled the first entry while the second met its busy open; seam=two Open replay calls without awaiting the first; no_claim=native timing of the editor's open
test('two Open replay entries made at once on a closed reader open the latest replay', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const first = await saveTwoStopNodeHistory(store)
    const second = await saveTwoStopNodeHistory(store)
    await harness.reader.action('retry')
    const openedBefore = harness.reader.inspect().opened

    // Act
    await Promise.all([
      harness.reader.openLearningReplay(first.studyId),
      harness.reader.openLearningReplay(second.studyId),
    ])
    await landsOn(harness, 2, 'the latest replay lands on its first stop')

    // Assert
    assert.equal(openedBefore, false)
    assert.equal(lastView(harness)?.nodeHistory?.header.studyId, second.studyId)
    assert.deepEqual(harness.errorMessages, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=the one-replay-at-a-time notice closes only the browser replay it named, for the latest entry: an answer to an earlier entry's notice that a newer entry overtook closes nothing, and the newer entry's answer closes the replay and opens its test replay; fails_when=the earlier answer closes the browser replay for a stale entry; why_new=Cycle 0051 local CodeRabbit CLI findings (the notice is not modal); seam=recordedReaderHarness, answerWarningDialogs held per notice; no_claim=a second browser recording opened meanwhile (the same guard compares its study and revision)
test('an answer to an overtaken one-replay-at-a-time notice closes nothing, and the latest entry’s answer opens its replay', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const first = await saveTwoStopNodeHistory(store)
    const second = await saveTwoStopNodeHistory(store)
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      READER_RESULT_BOUND_MS,
    )
    const answers: Array<(choice: string | undefined) => void> = []
    harness.answerWarningDialogs(
      () =>
        new Promise((resolve) => {
          answers.push(resolve)
        }),
    )
    const firstEntry = harness.reader.openLearningReplay(first.studyId)
    await waitUntil(
      () => answers.length === 1,
      'the first notice is shown',
      READER_RESULT_BOUND_MS,
    )
    const secondEntry = harness.reader.openLearningReplay(second.studyId)

    // Act: the first notice is answered after the second entry was made.
    answers[0]!('Close browser replay')
    await firstEntry
    const recordingAfterStaleAnswer = harness.controller.state().studyId
    await waitUntil(
      () => answers.length === 2,
      'the second notice is shown',
      READER_RESULT_BOUND_MS,
    )
    answers[1]!('Close browser replay')
    await secondEntry
    await landsOn(
      harness,
      2,
      'the latest entry’s replay lands on its first stop',
    )

    // Assert
    assert.equal(recordingAfterStaleAnswer, harness.studyId)
    assert.equal(lastView(harness)?.nodeHistory?.header.studyId, second.studyId)
    assert.equal(harness.controller.state().studyId, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=a test replay's layout in the summary composition reads confirmed when its recorded-source tab is in front of a group other than the Study mode's source column (the learner's own group holds that column), as a browser replay's captured source does; fails_when=the slot is looked for at the source column only and the summary shows "The recorded source of the test replay is not shown in its pane." over a slot in front; why_new=Cycle 0051 native smoke in VS Code 1.142.0 (the line showed beside the slot in front); seam=the fake editor's two-group layout with the learner's file at column 2; no_claim=the native placement of the groups
test('a test replay whose recorded-source tab stands in another group than the source column reads its layout as confirmed', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()
    harness.focusMutableDraft('utils.ts', 2)

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await landsOn(harness, 2, 'the replay lands on its first stop')
    const slotColumn = harness.groups.find(
      (group) => group.activeTab?.label === 'Captured-theme.ts',
    )?.viewColumn
    const state = harness.reader.presentationState()

    // Assert
    assert.equal(slotColumn, 3)
    assert.equal(state.layoutConfirmed, true)
    assert.equal(state.reason, undefined)
  } finally {
    await harness.close()
  }
})
