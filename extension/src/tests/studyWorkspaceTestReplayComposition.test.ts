import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  NODE_TEST_HISTORY_DIRECTORY,
  REPOSITORY_BROWSER_PROFILE as PROFILE_ID,
} from '../constants'
import { ReplayDebuggerStartError, StudyError } from '../errors'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { StudyViewMessage } from '../ui/studyHtml'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import {
  readerSeams,
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { saveOtherBrowserStudy } from './utils/saveOtherBrowserStudy'
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

// Value: protects=N55-F4 refusal 2: a test replay chosen in a Study pane that sits in the learner's own group opens, although Cursor reports the group's next tab as active before it closes the disposed Study tab; fails_when=the entry reads the grid while the disposed Study tab is still listed and refuses with "Native pane, group or focus changed while presentation waited"; why_new=Cycle 0056 task 17 (the refusal came from Codebook's own disposal, not from the learner); seam=workspaceHarness with activateNextTabBeforeDisposedPaneTabCloses and addForeignDraft in the Study pane's group; no_claim=Cursor's own event order (N56 step 1 checks it natively)
test('a test replay chosen in a Study pane that shares the learner’s group opens without a placement refusal', async () => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.activateNextTabBeforeDisposedPaneTabCloses()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()
    const studyColumn = harness.panelColumn('codebook.studyContext')
    assert.notEqual(studyColumn, undefined)
    // The learner's own tab shares the Study pane's group, so the group is no one Codebook created.
    harness.addForeignDraft(studyColumn)

    // Act
    harness.receiveContext({
      type: 'node-history',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
    })
    // A refusal ends the entry without a landing, so the wait ends on either result.
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 ||
        logged.some(
          (entry) => entry.surface === 'presentation:placement-refused',
        ),
      'the Saved studies choice lands on the first stop or is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      logged.filter(
        (entry) => entry.surface === 'presentation:placement-refused',
      ),
      [],
    )
    await landsOn(
      harness,
      2,
      'the Saved studies choice lands on the first stop',
    )
    assert.deepEqual(compositionOf(harness), {
      studyPane: false,
      application: true,
      summary: true,
      family: 'test',
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=N55-F4's silent drop: a Saved studies choice sent from the Learning summary after Close Study Workspace is recorded in Output › Codebook with its study, and the sending pane gets its open-request-settled reply; fails_when=the reader drops the choice with no Output entry and no reply, so the learner sees nothing and the pane keeps its opening choice; why_new=Cycle 0056 task 17 (receive's owner gate returned silently for the Learning summary of a closed workspace); seam=workspaceHarness (VS Code), the Learning summary view's listener, the diagnostics log, the harness's recorded open-request replies; no_claim=the wording the learner reads in a real Output channel
test('a Saved studies choice sent from the Learning summary after the Study workspace closed is recorded and releases the pane', async () => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  try {
    const history = await openByOpenReplay(harness)
    const revision = lastView(harness)!.revision
    await harness.reader.close()

    // Act
    harness.receive({
      type: 'node-history',
      revision,
      studyId: history.studyId,
      openRequest: 5,
    })
    await waitUntil(
      () => harness.openRequestReplies().length === 1,
      'the Learning summary gets the reply to its dropped choice',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(harness.openRequestReplies(), [
      { webview: 'summary', openRequest: 5 },
    ])
    // The entry is copied into this realm's plain objects: the reader runs in the harness's own realm.
    assert.deepEqual(
      logged.map((entry) => ({ ...entry })),
      [
        {
          surface: 'choice:dropped',
          studyId: history.studyId,
          cause:
            'The "node-history" choice from the Learning summary was not carried out: the Study workspace is closed. Open Study Workspace, then choose it again.',
        },
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=N55-F4 H2-a: a test replay chosen while the Application stands alone in its group opens although the editor reports the group active a moment after Codebook's reveal of the Application; fails_when=the entry arms a guard while the editor's late report of Codebook's own placement is still on its way, reads the report as the learner's focus change and refuses with "Native pane, group or focus changed while presentation waited"; why_new=Cycle 0056 task 17 stage 2 (N55-F4 refusal 1 is a rare race, hardened against both hypotheses); seam=workspaceHarness with activateApplicationGroupLateAfterReveal, the diagnostics log; no_claim=that Cursor reports it this way (N56 step 1 checks natively)
test('a test replay chosen while the Application is alone in its group opens without a placement refusal', async () => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.activateApplicationGroupLateAfterReveal()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()

    // Act
    harness.receiveContext({
      type: 'node-history',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
    })
    // A refusal ends the entry without a landing, so the wait ends on either result.
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 ||
        logged.some(
          (entry) => entry.surface === 'presentation:placement-refused',
        ),
      'the Saved studies choice lands on the first stop or is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      logged.filter(
        (entry) => entry.surface === 'presentation:placement-refused',
      ),
      [],
    )
    await landsOn(
      harness,
      2,
      'the Saved studies choice lands on the first stop',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=N55-F4 H2-b: a test replay opens although the editor reports the Application's new group active only after newGroupAbove answered; fails_when=the entry arms a guard while the editor's late report of Codebook's own placement is still on its way, reads the report as the learner's focus change and refuses with "Native pane, group or focus changed while presentation waited"; why_new=Cycle 0056 task 17 stage 2 (N55-F4 refusal 1 is a rare race, hardened against both hypotheses); seam=workspaceHarness with activateNewGroupLateAfterInsertion, the diagnostics log; no_claim=that Cursor reports it this way (N56 step 1 checks natively)
test('a test replay whose Application group the editor activates late opens without a placement refusal', async () => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.activateNewGroupLateAfterInsertion()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()

    // Act
    harness.receiveContext({
      type: 'node-history',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
    })
    // A refusal ends the entry without a landing, so the wait ends on either result.
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 ||
        logged.some(
          (entry) => entry.surface === 'presentation:placement-refused',
        ),
      'the Saved studies choice lands on the first stop or is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      logged.filter(
        (entry) => entry.surface === 'presentation:placement-refused',
      ),
      [],
    )
    await landsOn(
      harness,
      2,
      'the Saved studies choice lands on the first stop',
    )
  } finally {
    await harness.close()
  }
})

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
            (notice) =>
              notice.message ===
              'Cursor opens the Codebook Learning summary in its primary side bar. To keep it on the right, move it once: choose "New Secondary Side Bar Entry" in the list that opens.',
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
    const summaryFamilies = recordStudyFamilies(harness.summary),
      bottomPanelFamilies = recordStudyFamilies(harness.playbackPanel)

    // Act
    await harness.reader.action('return-current')

    // Assert: the bottom panel, which every publish reaches, observed the return.
    assert.equal(bottomPanelFamilies.length > 0, true)
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

    // Assert: the bottom panel, which every publish reaches, observed the return.
    assert.equal(bottomPanelFamilies.length > 0, true)
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

// Value: protects=a move whose replay debugger does not start: the transport's sentence carries the open path's recovery clause and says the last moment is still shown, and following it (selecting that stop again) reaches the target; fails_when=the bare cause is shown, the failed moment is shown as new, or the stop cannot be reached again; why_new=Cycle 0051 DS-G (AC14), the DX review's finding; seam=the harness's held historical debug presentation, rejected with a ReplayDebuggerStartError as the real owner's session wait rejects a refused start (Cycle 0052 task 17); no_claim=a real DAP failure
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

    // Act: the replay debugger's start is refused.
    held.reject(
      new ReplayDebuggerStartError(new Error('Workspace trust was declined.')),
    )
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
    const firstPlayback = harness.reader['nodeHistoryPlaybackController']!
    await waitUntil(
      () => firstPlayback.state().mode === 'playing',
      'the first replay plays',
      READER_RESULT_BOUND_MS,
    )

    // Act
    await harness.reader.openLearningReplay(second.studyId)
    await landsOn(harness, 2, 'the second replay lands on its first stop')
    const shownAfterOpen = lastView(harness)?.nodeHistory?.header.studyId
    // The first replay's playback is retired: its timer stops with its controller, which holds no event any more (Cycle 0052 task 8: no fixed wait).
    await waitUntil(
      () =>
        firstPlayback['timer'] === undefined &&
        firstPlayback.state().mode === 'paused' &&
        firstPlayback.state().endMs === undefined,
      "the first replay's playback is retired",
      READER_RESULT_BOUND_MS,
    )

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
    const playback = harness.reader['nodeHistoryPlaybackController']!
    await waitUntil(
      () => playback.state().mode === 'playing',
      'the test replay plays',
      READER_RESULT_BOUND_MS,
    )

    // Act
    await harness.reader.action('return-current')
    const messagesAtReturn = harness.playbackPanelMessages.length
    // The retired replay's timer stops with its controller, which holds no event any more (Cycle 0052 task 8: no fixed wait).
    await waitUntil(
      () =>
        playback['timer'] === undefined &&
        playback.state().mode === 'paused' &&
        playback.state().endMs === undefined,
      "the test replay's playback is retired",
      READER_RESULT_BOUND_MS,
    )

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
      'Test replays cannot be deleted here yet.',
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
    const supersededMove = harness.receivePlaybackPanelHandled({
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
    // The superseded move's own handling ends after its presentation's rejection (Cycle 0052 task 8: no fixed wait).
    await supersededMove

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

// Value: protects=Close retires every test replay entry still waiting for its turn, so a reader the learner closed is never reopened by an earlier Open replay; fails_when=dismissing a one-replay-at-a-time notice after Close lets the waiting entry open the closed reader (Codex P2 in Cycle 0051's /ship, N51 carried); why_new=Cycle 0052 task 12: neither Close nor Return to Live bumped the entry ticket; seam=recordedReaderHarness, answerWarningDialogs holding the first notice; no_claim=the native notification's own dismissal
test('Close retires a waiting Open replay entry, so dismissing its notice reopens nothing', async () => {
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
    let noticesShown = 0
    harness.answerWarningDialogs(() => {
      noticesShown++
      return answers.length === 0
        ? new Promise((resolve) => {
            answers.push(resolve)
          })
        : Promise.resolve(undefined)
    })
    const firstEntry = harness.reader.openLearningReplay(first.studyId)
    await waitUntil(
      () => answers.length === 1,
      'the first notice is shown',
      READER_RESULT_BOUND_MS,
    )
    const secondEntry = harness.reader.openLearningReplay(second.studyId)

    // Act: the learner closes the reader, then dismisses the first notice.
    await harness.reader.close()
    answers[0]!(undefined)
    await Promise.all([firstEntry, secondEntry])

    // Assert
    assert.deepEqual(
      {
        noticesShown,
        opened: harness.reader.inspect().opened,
        testReplay: harness.reader.inspect().view?.nodeHistory?.header.studyId,
      },
      { noticesShown: 1, opened: false, testReplay: undefined },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Return to Live retires every test replay entry still waiting for its turn, so the learner's return is not undone by an earlier Open replay; fails_when=dismissing the notice after Return to Live lets the waiting entry enter the summary composition again; why_new=Cycle 0052 task 12; seam=recordedReaderHarness, answerWarningDialogs holding the first notice; no_claim=the native notification's own dismissal
test('Return to Live retires a waiting Open replay entry, so dismissing its notice opens no test replay', async () => {
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
    harness.answerWarningDialogs(() =>
      answers.length === 0
        ? new Promise((resolve) => {
            answers.push(resolve)
          })
        : Promise.resolve(undefined),
    )
    const firstEntry = harness.reader.openLearningReplay(first.studyId)
    await waitUntil(
      () => answers.length === 1,
      'the first notice is shown',
      READER_RESULT_BOUND_MS,
    )
    const secondEntry = harness.reader.openLearningReplay(second.studyId)

    // Act: the learner returns to Live, then dismisses the first notice.
    await harness.reader.action('return-current')
    answers[0]!(undefined)
    await Promise.all([firstEntry, secondEntry])

    // Assert
    assert.deepEqual(
      {
        testReplay: harness.reader.inspect().view?.nodeHistory?.header.studyId,
        bottomPanelFamily: harness.playbackPanelMessages.at(-1)?.replayFamily,
      },
      { testReplay: undefined, bottomPanelFamily: undefined },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a Saved studies choice of a test replay whose open a newer reader revision supersedes while it enters the summary composition, with no newer replay to show, gives the Study pane back instead of an empty summary composition; fails_when=the superseded open counts as success and the reader stays in a summary composition that shows no replay (Cycle 0051 /ship review); why_new=Cycle 0052 task 13: openNodeHistoryFromHost left the composition only after a failed open; seam=the reader's revision advanced once the entry stood in the composition, as a repository navigation or another reader change does meanwhile; no_claim=which change advances it natively
test('a Saved studies choice of a test replay superseded while it enters the composition gives the Study pane back', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()
    const reader = harness.reader as unknown as {
      enterSummaryCompositionForReplay: (
        entry: number,
        overtaken: AbortSignal,
      ) => Promise<void>
      revision: number
    }
    const enter = reader.enterSummaryCompositionForReplay.bind(harness.reader)
    let entered!: () => void
    let messagesAtSupersession = 0
    const standsInComposition = new Promise<void>((resolve) => {
      entered = resolve
    })
    reader.enterSummaryCompositionForReplay = async (
      entry: number,
      overtaken: AbortSignal,
    ): Promise<void> => {
      await enter(entry, overtaken)
      // Another reader change lands while the entry stands in the composition.
      reader.revision++
      messagesAtSupersession = harness.playbackPanelMessages.length
      entered()
    }

    // Act
    harness.receiveContext({
      type: 'node-history',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
    })
    await standsInComposition
    await waitUntil(
      () =>
        harness.panelColumn('codebook.studyContext') !== undefined &&
        harness.reader.inspect().view?.nodeHistory === undefined,
      'the Study pane comes back with no test replay selected',
      READER_RESULT_BOUND_MS,
    )

    // Assert: the reader published again after the supersession, and its last message names no replay family.
    const publishedAfter = harness.playbackPanelMessages.slice(
      messagesAtSupersession,
    )
    assert.equal(publishedAfter.length > 0, true)
    assert.equal(publishedAfter.at(-1)?.replayFamily, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=Open replay always ends with the Learning summary shown, also when the learner had hidden the summary and the bottom panel while another test replay was shown; fails_when=the entry finds the reader in the summary composition, skips its reveal and leaves no visible UI for the replay it opened (Cycle 0051 /ship review); why_new=Cycle 0052 task 14: enterSummaryCompositionForReplay returned early without showing the summary; seam=hideSummary and hidePlaybackPanel; no_claim=the native views' placement
test('Open replay with the Learning summary and the bottom panel hidden shows the summary again', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const second = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openByOpenReplay(harness)
    harness.hideSummary()
    harness.hidePlaybackPanel()

    // Act
    await harness.reader.openLearningReplay(second.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === second.studyId &&
        !lastView(harness)?.loading,
      'the second replay is shown',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(harness.summary.visible, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a Learning summary reveal that a newer replay selection supersedes ends quietly: the learner's newer choice wins and no failure is told for the older reveal; fails_when=Show Learning Summary rejects with STALE_PRESENTATION ('The selected learning changed while opening its summary.') because the learner chose another replay while the reveal waited (Cycle 0051 /ship Red Team); why_new=Cycle 0052 task 16: assertCurrent threw out of the reveal on any identity change; seam=holdNextCommand on codebook.learningSummary.focus; no_claim=the native view's timing
test('a Learning summary reveal superseded by another replay’s open ends without an error', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let release = (): void => {}
  try {
    const second = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openByOpenReplay(harness)
    harness.hideSummary()
    const held = harness.holdNextCommand('codebook.learningSummary.focus')
    release = held.release
    const reveal = harness.reader.showLearningSummary()
    await held.started

    // Act: the learner opens another replay while the reveal waits for the view.
    const secondEntry = harness.reader.openLearningReplay(second.studyId)
    await waitUntil(
      () =>
        harness.reader.inspect().view?.nodeHistory?.header.studyId ===
        second.studyId,
      'the second replay is selected',
      READER_RESULT_BOUND_MS,
    )
    held.release()
    const revealOutcome = await reveal.then(
      () => 'ended',
      (error: unknown) => String(error),
    )
    await secondEntry

    // Assert
    assert.equal(revealOutcome, 'ended')
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=a first entry that fails after the Learning summary received the replay's document withdraws that document, so no summary with controls that answer nothing stays beside the chat on a closed reader; fails_when=forgetUnopenedComposition drops the composition but leaves the replay's document in the summary (Cycle 0051 /ship review); why_new=Cycle 0052 task 18; seam=the reader's summary placement offer made to fail once, after the summary got its document; no_claim=which native step fails after the reveal
test('a first Open replay that fails after the summary got its document leaves the summary placeholder', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    const reader = harness.reader as unknown as {
      offerSummaryPlacement: (...args: unknown[]) => void
    }
    const offer = reader.offerSummaryPlacement.bind(harness.reader)
    let failed = false
    reader.offerSummaryPlacement = (...args: unknown[]): void => {
      if (failed) return offer(...args)
      failed = true
      throw new Error('The editor refused the summary placement.')
    }

    // Act
    await harness.reader.openLearningReplay(history.studyId)

    // Assert
    assert.deepEqual(
      {
        failed,
        opened: harness.reader.inspect().opened,
        placeholder: harness.summary.webview.html.includes(
          'Open saved learning from Codebook to view its summary.',
        ),
      },
      { failed: true, opened: false, placeholder: true },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a same-study Reload keeps its Learning summary while it loads, also when another open of the reader (Restore, Arrange) runs in that gap; fails_when=the other open sees no recording and no test replay, leaves the summary composition and blanks the summary the Reload kept for its loading and retry messages (Cycle 0051 /ship review); why_new=Cycle 0052 task 18; seam=the reload held at its debugger replacement, the reader's own open() during the hold; no_claim=which native action opens the reader in that gap
test('another open during a same-study Reload keeps the Reload’s Learning summary', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  let release = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const seams = readerSeams(harness)
    const replace = seams.debuggerReplacement
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered = (): void => {}
    const reloadWaits = new Promise<void>((resolve) => {
      entered = resolve
    })
    seams.debuggerReplacement = async (signal?: AbortSignal): Promise<void> => {
      entered()
      await held
      return replace(signal)
    }

    // Act
    const reload = harness.reader.action('reload-recording')
    await reloadWaits
    await harness.reader.open()
    const summaryDuringReload = harness.summary.webview.html
    release()
    await reload
    await harness.controller.settle()

    // Assert
    assert.equal(
      summaryDuringReload.includes(
        'Open saved learning from Codebook to view its summary.',
      ),
      false,
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=a test replay opened from the Study composition leaves no empty editor group behind when the Study pane closes, in an editor that removes emptied groups as VS Code does by default; fails_when=the composition keeps the Study pane's emptied group, or an empty group of its own; why_new=Cycle 0052 task 24 (Cycle 0051 /ship review: the harness never removed an emptied group, so one would go unnoticed); seam=closeDisposedPanelTabsLater and closeEmptyGroupsAfterPanelMove (closeEmptyGroups on, VS Code's default); no_claim=an editor with closeEmptyGroups off, which keeps emptied groups by the learner's setting
test('a test replay opened from the Study composition leaves no empty editor group when the editor closes emptied groups', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    // The editor removes a group its last tab left, by a close or by a move, as VS Code does with `workbench.editor.closeEmptyGroups` on (its default).
    harness.closeDisposedPanelTabsLater()
    harness.closeEmptyGroupsAfterPanelMove()
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await landsOn(harness, 2, 'Open replay lands on the first stop')
    await waitUntil(
      () => harness.panelColumn('codebook.studyContext') === undefined,
      'the Study pane closed',
      READER_RESULT_BOUND_MS,
    )
    harness.closePendingDisposedPanelTabs()

    // Assert
    assert.deepEqual(
      harness.groups
        .filter((group) => group.tabs.length === 0)
        .map((group) => group.viewColumn),
      [],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's Return to Live that supersedes a test replay entry already entering the summary composition, while the reader shows Live with its source ready, leaves no empty summary composition behind; fails_when=the superseded entry's open builds the summary composition and the entry ends without leaving it, so the summary shows a replay document with no replay (local CodeRabbit round 2, major); why_new=Cycle 0052 task 12; seam=the entry held at enterSummaryCompositionForReplay, a configured live run, the agent's returnToCurrent; no_claim=the native timing of the agent's call
test('an agent’s Return to Live that supersedes an entering test replay leaves no empty summary composition', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let release = (): void => {}
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    const reader = harness.reader as unknown as {
      enterSummaryCompositionForReplay: (
        entry: number,
        overtaken: AbortSignal,
      ) => Promise<void>
    }
    const enter = reader.enterSummaryCompositionForReplay.bind(harness.reader)
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered = (): void => {}
    const entering = new Promise<void>((resolve) => {
      entered = resolve
    })
    reader.enterSummaryCompositionForReplay = async (
      entry: number,
      overtaken: AbortSignal,
    ): Promise<void> => {
      entered()
      await held
      return enter(entry, overtaken)
    }

    // Act
    const entry = harness.reader.openLearningReplay(history.studyId)
    await entering
    const state = harness.reader.presentationState()
    await harness.reader.returnToCurrent(
      {
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      },
      'agent',
    )
    release()
    await entry

    // Assert
    // The summary holds no reader document: an entry superseded before its open builds nothing (Cycle 0052 task 44), and one superseded after it leaves the placeholder.
    assert.deepEqual(
      {
        testReplay: harness.reader.inspect().view?.nodeHistory?.header.studyId,
        summaryHoldsReaderDocument:
          harness.summary.webview.html.includes('acquireVsCodeApi'),
      },
      { testReplay: undefined, summaryHoldsReaderDocument: false },
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=a test replay opened while a same-study Reload of a browser replay still loads asks to close that browser replay first, and closing it cancels the pending load, so the load never comes back over the test replay; fails_when=the entry treats the reloading replay as gone, opens the test replay, and the resumed load retires it for the browser replay (local CodeRabbit round 5, major); why_new=Cycle 0052 task 18's Reload mark; seam=the reload held at its debugger replacement, answerWarningDialogs choosing Close browser replay; no_claim=the native notification
test('a test replay opened during a same-study Reload closes the reloading browser replay and stays shown', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  let release = (): void => {}
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const seams = readerSeams(harness)
    const replace = seams.debuggerReplacement
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered = (): void => {}
    const reloadWaits = new Promise<void>((resolve) => {
      entered = resolve
    })
    seams.debuggerReplacement = async (signal?: AbortSignal): Promise<void> => {
      entered()
      await held
      return replace(signal)
    }
    let noticesShown = 0
    harness.answerWarningDialogs(async () => {
      noticesShown++
      return 'Close browser replay'
    })
    const reload = harness.reader.action('reload-recording')
    await reloadWaits

    // Act: the learner opens the test replay while the Reload still loads; the load goes on afterwards.
    const entry = harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () => noticesShown === 1,
      'the one-replay-at-a-time notice is shown',
      READER_RESULT_BOUND_MS,
    )
    release()
    await Promise.all([entry, reload])
    await harness.controller.settle()
    await landsOn(harness, 2, 'the test replay stays on its first stop')

    // Assert
    assert.deepEqual(
      {
        noticesShown,
        testReplay: harness.reader.inspect().view?.nodeHistory?.header.studyId,
        recording: harness.controller.state().studyId,
      },
      { noticesShown: 1, testReplay: history.studyId, recording: undefined },
    )
  } finally {
    release()
    await harness.close()
  }
})

for (const ending of ['held', 'failed'] as const) {
  // Value: protects=the reader's periodic refresh during a same-study Reload, loading or failed, leaves the Application pane on the recording it reloads: no Live or Study content is drawn there while the summary still shows the browser replay; fails_when=refreshPresentation renders the selection during the Reload and presentApplication writes non-recording content into the pane (local CodeRabbit round 6, major); why_new=Cycle 0052 task 18's Reload mark; seam=the reload held at, or failed at, its debugger replacement, the reader's refresh; no_claim=the native pane's pixels
  test(`a refresh during a same-study Reload${ending === 'held' ? '' : ' that failed'} keeps the Application pane on the recording`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    let load: Awaited<ReturnType<typeof reloadHeldOrFailed>>['load'] | undefined
    try {
      const reloading = await reloadHeldOrFailed(harness, ending)
      load = reloading.load
      const application = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')!
      const documentBeforeRefresh = application.webview.html

      // Act
      await readerSeams(harness).refresh()
      const documentAfterRefresh = application.webview.html
      load.release()
      await reloading.reload

      // Assert
      assert.equal(documentAfterRefresh, documentBeforeRefresh)
    } finally {
      load?.release()
      await harness.close()
    }
  })
}

// Value: protects=an agent's Return to Live that supersedes one test replay entry entering the summary composition and a second one waiting for its turn leaves no empty summary composition, whichever of them ends last; fails_when=the entering one skips the leave because the waiting one is still counted, and the waiting one ends at its ticket check without leaving (local CodeRabbit round 7, minor); why_new=Cycle 0052 task 12; seam=the first entry held at enterSummaryCompositionForReplay, a configured live run, the agent's returnToCurrent; no_claim=the native timing of the agent's call
test('an agent’s Return to Live that supersedes an entering and a waiting test replay entry leaves no empty summary composition', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let release = (): void => {}
  try {
    const store = harness.service.nodeHistoryStore!
    const first = await saveTwoStopNodeHistory(store)
    const second = await saveTwoStopNodeHistory(store)
    await harness.reader.action('retry')
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    const reader = harness.reader as unknown as {
      enterSummaryCompositionForReplay: (
        entry: number,
        overtaken: AbortSignal,
      ) => Promise<void>
    }
    const enter = reader.enterSummaryCompositionForReplay.bind(harness.reader)
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered = (): void => {}
    const entering = new Promise<void>((resolve) => {
      entered = resolve
    })
    reader.enterSummaryCompositionForReplay = async (
      entry: number,
      overtaken: AbortSignal,
    ): Promise<void> => {
      entered()
      await held
      return enter(entry, overtaken)
    }

    // Act
    const firstEntry = harness.reader.openLearningReplay(first.studyId)
    await entering
    const secondEntry = harness.reader.openLearningReplay(second.studyId)
    const state = harness.reader.presentationState()
    await harness.reader.returnToCurrent(
      {
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      },
      'agent',
    )
    release()
    await Promise.all([firstEntry, secondEntry])

    // Assert
    // The summary holds no reader document: an entry superseded before its open builds nothing (Cycle 0052 task 44), and one superseded after it leaves the placeholder.
    assert.deepEqual(
      {
        testReplay: harness.reader.inspect().view?.nodeHistory?.header.studyId,
        summaryHoldsReaderDocument:
          harness.summary.webview.html.includes('acquireVsCodeApi'),
      },
      { testReplay: undefined, summaryHoldsReaderDocument: false },
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=Open replay made while another test replay is shown and the work window has lost the desktop focus waits for the focus before showing the summary, as an open from a closed reader does, instead of failing at once; fails_when=the entry into the standing composition reveals the summary unfocused and is told as a failed open (local CodeRabbit round 8, minor); why_new=Cycle 0052 task 14's reveal; seam=changeWindowFocus, the harness's count of unfocused window reads; no_claim=the native window manager
test('Open replay into a standing composition waits for the work window’s focus before showing the summary', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const second = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openByOpenReplay(harness)
    harness.hideSummary()
    harness.changeWindowFocus(false)

    // Act: the learner clicks back into the window a moment after Open replay.
    const readsBefore = harness.unfocusedWindowReads()
    const entry = harness.reader.openLearningReplay(second.studyId)
    await waitUntil(
      () => harness.unfocusedWindowReads() > readsBefore,
      'the entry waits for the window focus',
      READER_RESULT_BOUND_MS,
    )
    harness.changeWindowFocus(true)
    await entry
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === second.studyId &&
        !lastView(harness)?.loading,
      'the second replay is shown',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      { errors: harness.errorMessages, summaryShown: harness.summary.visible },
      { errors: [], summaryShown: true },
    )
  } finally {
    harness.changeWindowFocus(true)
    await harness.close()
  }
})

// Value: protects=a learner's Return to Live that supersedes a test replay entry entering the summary composition arranges the reader itself, and the superseded entry's end tells no control error; fails_when=the entry's leave of the empty composition runs open() during the Return, which refuses as busy and reports a control error the learner caused nothing for (local CodeRabbit round 8, minor); why_new=Cycle 0052 task 12; seam=the entry held at enterSummaryCompositionForReplay, a configured live run, the learner's return-current action; no_claim=the native timing
test('a learner’s Return to Live that supersedes an entering test replay tells no control error', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let release = (): void => {}
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    const reader = harness.reader as unknown as {
      enterSummaryCompositionForReplay: (
        entry: number,
        overtaken: AbortSignal,
      ) => Promise<void>
    }
    const enter = reader.enterSummaryCompositionForReplay.bind(harness.reader)
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered = (): void => {}
    const entering = new Promise<void>((resolve) => {
      entered = resolve
    })
    reader.enterSummaryCompositionForReplay = async (
      entry: number,
      overtaken: AbortSignal,
    ): Promise<void> => {
      entered()
      await held
      return enter(entry, overtaken)
    }

    // Act
    const entry = harness.reader.openLearningReplay(history.studyId)
    await entering
    const returning = harness.reader.action('return-current')
    release()
    await Promise.all([entry, returning])

    // Assert
    assert.deepEqual(
      structuredClone({
        errors: harness.reader.inspect().view?.errors,
        testReplay: harness.reader.inspect().view?.nodeHistory?.header.studyId,
      }),
      { errors: [], testReplay: undefined },
    )
  } finally {
    release()
    await harness.close()
  }
})

for (const ending of ['held', 'failed'] as const) {
  // Value: protects=Close ends a same-study Reload's mark, loading or failed, so a reader the learner opens again afterwards stands in the Study composition and not in a summary composition for a recording that is gone; fails_when=close() keeps the Reload mark and the reopened reader closes its Study pane for a browser replay nobody shows (Cycle 0052 task 18); why_new=the Reload tests only end the mark through the load or a Return, none through Close; seam=the reload held at, or failed at, its debugger replacement, the reader's close and open; no_claim=the native pane's pixels
  test(`a reader closed during a same-study Reload${ending === 'held' ? '' : ' that failed'} opens again in the Study composition`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    let load: Awaited<ReturnType<typeof reloadHeldOrFailed>>['load'] | undefined
    try {
      const reloading = await reloadHeldOrFailed(harness, ending)
      load = reloading.load

      // Act: the learner closes the reader during the Reload, then opens it again.
      await harness.reader.close()
      load.release()
      await reloading.reload
      await harness.reader.open()

      // Assert
      assert.deepEqual(
        {
          studyPane: harness.panelColumn('codebook.studyContext') !== undefined,
          replayFamily: lastView(harness)?.replayFamily,
        },
        { studyPane: true, replayFamily: undefined },
      )
    } finally {
      load?.release()
      await harness.close()
    }
  })
}

// Value: protects=a test replay open that fails while an agent's presentation change is in flight tells its failure once and adds no control error: the failed open's leave of the empty summary composition waits for the presentation change, which arranges the reader itself; fails_when=leaveEmptySummaryComposition runs open() during the presentation change, which refuses as pending and reports a control error beside the told failure (Cycle 0052 task 12); why_new=the Return guard test covers returningCurrent only, none holds a presentation change; seam=readerSeams.debuggerReplacement held then failed, the agent's Restore of the Study workspace (changePresentation) admitted while the replay opens; no_claim=the native layout of the presentation change
test('a test replay open that fails during an agent’s presentation change adds no control error', async () => {
  // Arrange
  const harness = await workspaceHarness()
  const seams = readerSeams(harness)
  let releaseOpen = (): void => {}
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()
    const openWaits = new Promise<void>((resolve) => {
      releaseOpen = resolve
    })
    let openEntered = (): void => {}
    const opening = new Promise<void>((resolve) => {
      openEntered = resolve
    })
    seams.debuggerReplacement = async (): Promise<void> => {
      openEntered()
      await openWaits
      throw new Error('The historical debugger did not start.')
    }
    const entry = harness.reader.openLearningReplay(history.studyId)
    await opening

    // Act: the agent's Restore is admitted while the replay opens and still runs when the open fails.
    const state = harness.reader.presentationState()
    const change = harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      .then(
        () => undefined,
        () => undefined,
      )
    releaseOpen()
    await entry
    await change

    // Assert
    assert.deepEqual(
      {
        toldFailures: [...harness.errorMessages],
        pendingErrorLines: seams
          .errorLines()
          .filter((line) => line.includes('pending')),
      },
      {
        toldFailures: [
          'Codebook could not open the test replay "src/theme.test.ts": The historical debugger did not start. The saved history is unchanged; open it again from Saved studies.',
        ],
        pendingErrorLines: [],
      },
    )
  } finally {
    releaseOpen()
    await harness.close()
  }
})

type RecordedHarness = Awaited<ReturnType<typeof recordedReaderHarness>>

/**
 * Holds the next recording load of the reader at its debugger replacement (later loads run unheld), so a test ends that load by its own choice: resumed, or failed.
 * @param harness - The recorded reader harness.
 * @returns `hasEntered` settles once the load reached the hold; `release` lets the load go on; `fail` makes it fail as a debugger that does not start.
 * @example const load = holdNextRecordingLoad(harness); const reload = harness.reader.action('reload-recording'); await load.hasEntered; load.fail()
 */
function holdNextRecordingLoad(harness: RecordedHarness) {
  const seams = readerSeams(harness)
  const replace = seams.debuggerReplacement
  let finish = (_failure: boolean): void => {}
  const finished = new Promise<boolean>((resolve) => {
    finish = resolve
  })
  let entered = (): void => {}
  const hasEntered = new Promise<void>((resolve) => {
    entered = resolve
  })
  seams.debuggerReplacement = async (signal?: AbortSignal): Promise<void> => {
    // Only the next load is held: later loads start the debugger as usual.
    seams.debuggerReplacement = replace
    entered()
    if (await finished)
      throw new Error('The historical debugger did not start.')
    return replace(signal)
  }
  return {
    hasEntered,
    release: (): void => finish(false),
    fail: (): void => finish(true),
  }
}

/**
 * Saves a second browser study beside the harness's recorded one, so the learner has another Saved studies entry to choose.
 * @param harness - The recorded reader harness.
 * @returns The saved study.
 * @example const other = await saveOtherBrowserStudyShown(harness)
 */
async function saveOtherBrowserStudyShown(harness: RecordedHarness) {
  const study = await saveOtherBrowserStudy(
    await harness.reader.learningStorage(),
  )
  // Retry storage reloads the catalog the reader shows.
  await harness.reader.action('retry')
  return study
}

/**
 * Opens a recorded study, then starts a same-study Reload whose load is held, optionally failing it.
 * @param harness - The recorded reader harness.
 * @param ending - `held` leaves the load held; `failed` fails it and waits for the failed readiness.
 * @returns The hold, and the Reload's promise (settled whatever its outcome).
 * @example const { load, reload } = await reloadHeldOrFailed(harness, 'failed')
 */
async function reloadHeldOrFailed(
  harness: RecordedHarness,
  ending: 'held' | 'failed',
) {
  await harness.reader.openRecording(harness.studyId)
  await harness.controller.settle()
  const load = holdNextRecordingLoad(harness)
  const reload = harness.reader.action('reload-recording').then(
    () => undefined,
    () => undefined,
  )
  await load.hasEntered
  if (ending === 'failed') {
    load.fail()
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the Reload’s load fails',
      READER_RESULT_BOUND_MS,
    )
    await reload
  }
  return { load, reload }
}

// Value: protects=a Saved studies choice made after a same-study Reload's load failed opens the chosen recording, as it does during a browser replay, instead of leaving the learner on the failed replay; fails_when=openChosenStudy treats the failed Reload as no browser replay and the chosen study is never opened (Cycle 0052 task 18); why_new=the Reload mark's loading and failed cells had no Saved studies choice test; seam=a Reload whose debugger replacement is held then failed, the bottom panel's history message; no_claim=the chosen study's own recording content, which the saved configured study does not carry
test('a Saved studies choice after a failed same-study Reload opens the chosen recording', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const other = await saveOtherBrowserStudyShown(harness)
    await reloadHeldOrFailed(harness, 'failed')

    // Act
    harness.receivePlaybackPanel({
      type: 'history',
      revision: harness.reader.inspect().view!.revision,
      studyId: other.id,
    })
    await waitUntil(
      () => harness.controller.state().studyId === other.id,
      'the chosen recording is opened',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()

    // Assert
    assert.deepEqual(
      {
        recording: harness.controller.state().studyId,
        ...compositionOf(harness),
      },
      {
        recording: other.id,
        studyPane: false,
        application: true,
        summary: true,
        family: 'browser',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a Saved studies choice made while a same-study Reload still loads opens the chosen recording and the held Reload, once it ends, does not come back over it; fails_when=the choice is dropped while the Reload is loading, or the resumed Reload retires the chosen recording for the old one (Cycle 0052 task 18); why_new=the Reload mark's loading cell had no Saved studies choice test; seam=a Reload held at its debugger replacement, the bottom panel's history message; no_claim=the chosen study's own recording content
test('a Saved studies choice during a same-study Reload opens the chosen recording and the Reload does not come back', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  let load: Awaited<ReturnType<typeof reloadHeldOrFailed>>['load'] | undefined
  try {
    const other = await saveOtherBrowserStudyShown(harness)
    const held = await reloadHeldOrFailed(harness, 'held')
    load = held.load

    // Act: the learner chooses another saved study while the Reload loads; the Reload's load then ends.
    harness.receivePlaybackPanel({
      type: 'history',
      revision: harness.reader.inspect().view!.revision,
      studyId: other.id,
    })
    await waitUntil(
      () => harness.controller.state().studyId === other.id,
      'the chosen recording is opened',
      READER_RESULT_BOUND_MS,
    )
    load.release()
    await held.reload
    await harness.controller.settle()

    // Assert
    assert.deepEqual(
      {
        recording: harness.controller.state().studyId,
        ...compositionOf(harness),
      },
      {
        recording: other.id,
        studyPane: false,
        application: true,
        summary: true,
        family: 'browser',
      },
    )
  } finally {
    load?.release()
    await harness.close()
  }
})

for (const ending of ['held', 'failed'] as const) {
  // Value: protects=a step selected while a same-study Reload has no loaded recording is refused with the sentence that says when to select it, and changes neither the reader's selection nor its composition; fails_when=select() moves the selection and renders a Study item while the Learning summary still shows the browser replay (Cycle 0052 task 18); why_new=the Reload mark's select row was untested; seam=a Reload whose debugger replacement is held or failed, the reader's select; no_claim=the step list's native rendering
  test(`selecting a step while a same-study Reload is ${ending === 'held' ? 'loading' : 'failed'} is refused and changes nothing`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    let load: Awaited<ReturnType<typeof reloadHeldOrFailed>>['load'] | undefined
    try {
      const reloading = await reloadHeldOrFailed(harness, ending)
      load = reloading.load
      const itemBefore = harness.reader.inspect().view!.model.selection.itemId
      const compositionBefore = compositionOf(harness)

      // Act
      const refusal = await harness.reader
        .select('repository/interface/theme')
        .then(
          () => undefined,
          (error: unknown) =>
            // The reader's errors come from its own module context, so `instanceof Error` cannot tell them.
            typeof error === 'object' && error !== null && 'message' in error
              ? String(error.message)
              : '',
        )

      // Assert
      assert.deepEqual(
        {
          refusal,
          itemChanged:
            harness.reader.inspect().view!.model.selection.itemId !==
            itemBefore,
          compositionChanged:
            JSON.stringify(compositionOf(harness)) !==
            JSON.stringify(compositionBefore),
        },
        {
          refusal:
            'The recording is not loaded. Select this step once it has loaded again.',
          itemChanged: false,
          compositionChanged: false,
        },
      )
    } finally {
      load?.release()
      await harness.close()
    }
  })
}

// Value: protects=an agent reading the presentation state during a same-study Reload is told the browser replay is shown (tab recording, not following the run) and, once the load failed, the failed recording's reason; fails_when=presentationState reads the selection's tab, can say it follows the current run, or gives the captured-source reason for a recording that did not load (Cycle 0052 task 18); why_new=the Reload mark's presentation row was untested; seam=a Reload whose debugger replacement is held then failed, presentationState; no_claim=the agent's next call
test('the presentation state during a same-study Reload reads the recording tab and, once failed, the failed recording’s reason', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  let load: Awaited<ReturnType<typeof reloadHeldOrFailed>>['load'] | undefined
  try {
    const reloading = await reloadHeldOrFailed(harness, 'held')
    load = reloading.load

    // Act
    const whileLoading = harness.reader.presentationState().reader
    load.fail()
    await reloading.reload
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the Reload’s load fails',
      READER_RESULT_BOUND_MS,
    )
    const afterFailure = harness.reader.presentationState()

    // Assert
    assert.deepEqual(
      {
        whileLoading: {
          contentTab: whileLoading.contentTab,
          followingCurrentRun: whileLoading.followingCurrentRun,
        },
        afterFailure: {
          contentTab: afterFailure.reader.contentTab,
          followingCurrentRun: afterFailure.reader.followingCurrentRun,
          reason: afterFailure.reason,
        },
      },
      {
        whileLoading: { contentTab: 'recording', followingCurrentRun: false },
        afterFailure: {
          contentTab: 'recording',
          followingCurrentRun: false,
          reason:
            'The recording is not shown: it could not be loaded (The historical debugger did not start.). Open the recording again, then restore the layout.',
        },
      },
    )
  } finally {
    load?.release()
    await harness.close()
  }
})

// Value: protects=Return to Live after a same-study Reload's load failed ends the failed replay: the summary reads its placeholder and a step can be selected again; fails_when=the Reload mark outlives the Return, so selecting a step is refused as if the recording were still reloading (Cycle 0052 task 18); why_new=the Reload mark's failed cell was only left through a retry or Close; seam=a Reload whose debugger replacement is held then failed, the learner's return-current action; no_claim=the Live composition's panes, which need a paused live run
test('Return to Live after a failed same-study Reload ends the failed replay', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await reloadHeldOrFailed(harness, 'failed')

    // Act
    await harness.reader.action('return-current')
    await harness.controller.settle()
    const selectionRefusal = await harness.reader
      .select('repository/interface/theme')
      .then(
        () => undefined,
        (error: unknown) =>
          // The reader's errors come from its own module context, so `instanceof Error` cannot tell them.
          typeof error === 'object' && error !== null && 'message' in error
            ? String(error.message)
            : '',
      )

    // Assert
    assert.deepEqual(
      {
        recording: harness.controller.state().studyId,
        summaryPlaceholder: harness.summary.webview.html.includes(
          'Open saved learning from Codebook to view its summary.',
        ),
        selectionRefusal,
      },
      {
        recording: undefined,
        summaryPlaceholder: true,
        selectionRefusal: undefined,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a test replay opened after a same-study Reload's load failed asks to close the failed browser replay first, and answering Close browser replay opens the test replay; fails_when=the failed Reload counts as no browser replay and no notice is shown, or the answer leaves the browser replay in place (Cycle 0052 task 18); why_new=the Reload mark's failed cell had only the loading cell tested for the test replay entry; seam=a Reload whose debugger replacement is held then failed, answerWarningDialogs choosing Close browser replay; no_claim=the native notification
test('a test replay opened after a failed same-study Reload asks to close the browser replay and then opens', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await reloadHeldOrFailed(harness, 'failed')
    let noticesShown = 0
    harness.answerWarningDialogs(async () => {
      noticesShown++
      return 'Close browser replay'
    })

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await landsOn(harness, 2, 'the test replay lands on its first stop')

    // Assert
    assert.deepEqual(
      {
        noticesShown,
        testReplay: harness.reader.inspect().view?.nodeHistory?.header.studyId,
        recording: harness.controller.state().studyId,
        family: lastView(harness)?.replayFamily,
      },
      {
        noticesShown: 1,
        testReplay: history.studyId,
        recording: undefined,
        family: 'test',
      },
    )
  } finally {
    await harness.close()
  }
})

/**
 * Reads the parts of the composition that show whether a closed or reopened reader holds a replay: the panes, and whether the Learning summary shows a replay's transport (the summary view's own visibility is kept by the host after a Close).
 * @param harness - The workspace harness.
 * @returns Whether the Study pane and the Application pane show, and whether the summary shows a replay's transport.
 * @example replayFreeComposition(harness) // => { studyPane: true, application: true, summaryShowsReplay: false }
 */
function replayFreeComposition(harness: Harness) {
  const { studyPane, application } = compositionOf(harness)
  return {
    studyPane,
    application,
    summaryShowsReplay: harness.summary.webview.html.includes(
      'id="recording-transport"',
    ),
  }
}

// Value: protects=Close while an Open replay entry into a standing summary composition waits for the work window's focus ends that entry: the reader closes, the entry neither reopens it nor tells a failure, and the reader the learner opens again shows the replay it showed before Close, never the entry's; fails_when=the entry resumes after Close and reopens the closed reader, shows its own replay, or tells a failed open (Cycle 0052 task 12); why_new=Close was tested against waiting entries (the notice) but not against an entry already entering; seam=changeWindowFocus(false) holding the entry in its focus wait, the harness's count of unfocused window reads; no_claim=the native window manager
test('Close during an Open replay entry that waits for the window focus ends the entry, and the reopened reader shows the earlier replay', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const second = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    const first = await openByOpenReplay(harness)
    harness.changeWindowFocus(false)
    const readsBefore = harness.unfocusedWindowReads()
    const entry = harness.reader.openLearningReplay(second.studyId)
    await waitUntil(
      () => harness.unfocusedWindowReads() > readsBefore,
      'the entry waits for the window focus',
      READER_RESULT_BOUND_MS,
    )

    // Act: the learner closes the reader while the entry waits, the window gets its focus back, and the learner opens the reader again.
    await harness.reader.close()
    harness.changeWindowFocus(true)
    await entry
    const afterClose = {
      opened: harness.reader.inspect().opened,
      ...replayFreeComposition(harness),
    }
    await harness.reader.open()

    // Assert
    assert.deepEqual(
      {
        afterClose,
        reopened: replayFreeComposition(harness),
        testReplay: harness.reader.inspect().view?.nodeHistory?.header.studyId,
        toldFailures: [...harness.errorMessages],
        controlErrors: readerSeams(harness).errorLines(),
      },
      {
        afterClose: {
          opened: false,
          studyPane: false,
          application: false,
          summaryShowsReplay: false,
        },
        reopened: {
          studyPane: false,
          application: true,
          summaryShowsReplay: true,
        },
        testReplay: first.studyId,
        toldFailures: [],
        controlErrors: [],
      },
    )
  } finally {
    harness.changeWindowFocus(true)
    await harness.close()
  }
})

/**
 * Starts a test replay entry whose open is held at the reader's debugger replacement, with a live run current.
 * @param harness - The workspace harness.
 * @returns The entry, and `release` to let its open go on.
 * @example const opening = await startHeldTestReplayOpen(harness); opening.release()
 */
async function startHeldTestReplayOpen(harness: Harness) {
  const history = await saveTwoStopNodeHistory(
    harness.service.nodeHistoryStore!,
  )
  await harness.reader.action('retry')
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: randomUUID(),
  })
  await harness.service.record(receipt).preparation
  await harness.reader.open()
  const seams = readerSeams(harness)
  const replace = seams.debuggerReplacement
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let entered = (): void => {}
  const opening = new Promise<void>((resolve) => {
    entered = resolve
  })
  seams.debuggerReplacement = async (signal?: AbortSignal): Promise<void> => {
    // Only this open is held: later loads start the debugger as usual.
    seams.debuggerReplacement = replace
    entered()
    await held
    return replace(signal)
  }
  const entry = harness.reader.openLearningReplay(history.studyId)
  await opening
  return { entry, release, studyId: history.studyId }
}

// Value: protects=Close while a test replay entry is already opening its history leaves the reader closed, and the reader the learner opens again shows no test replay and no summary composition; fails_when=the opening entry resumes after Close, selects the replay and builds a composition for a closed reader (Cycle 0052 task 12); why_new=Close was tested against waiting entries, not an entry inside openNodeHistory; seam=the open held at the debugger replacement, the learner's close and open; no_claim=the native pane's pixels
test('Close during a test replay open leaves the reader closed and it opens again with no replay', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let release = (): void => {}
  try {
    const opening = await startHeldTestReplayOpen(harness)
    release = opening.release

    // Act
    await harness.reader.close()
    opening.release()
    await opening.entry
    const afterClose = {
      opened: harness.reader.inspect().opened,
      ...replayFreeComposition(harness),
    }
    await harness.reader.open()

    // Assert
    assert.deepEqual(
      {
        afterClose,
        reopened: replayFreeComposition(harness),
        testReplay: harness.reader.inspect().view?.nodeHistory?.header.studyId,
        errors: [...harness.errorMessages],
      },
      {
        afterClose: {
          opened: false,
          studyPane: false,
          application: false,
          summaryShowsReplay: false,
        },
        reopened: {
          studyPane: true,
          application: true,
          summaryShowsReplay: false,
        },
        testReplay: undefined,
        errors: [],
      },
    )
  } finally {
    release()
    await harness.close()
  }
})

for (const requester of ['learner', 'agent'] as const) {
  // Value: protects=a Return to Live (the learner's action or an agent's returnToCurrent) while a test replay entry is already opening its history ends that open at once: the reader leaves the summary composition for Live, ends its loading state, gives the Learning summary its placeholder, selects no replay and tells no failure or control error; fails_when=the opening marker keeps the summary composition through the Return, so the reader stays loading with the opening replay's summary in Live after the open ends superseded (Cycle 0052 task 30, found by the pt1 /ship state-machine cell entry-opening × Return); why_new=the Return was tested against entering and waiting entries, not an entry inside openNodeHistory; seam=the open held at the debugger replacement, a configured live run; no_claim=the Live composition's native panes
  test(`${requester === 'agent' ? 'an agent' : 'a learner'}’s Return to Live during a test replay open ends the open in Live with no replay`, async () => {
    // Arrange
    const harness = await workspaceHarness()
    let release = (): void => {}
    try {
      const opening = await startHeldTestReplayOpen(harness)
      release = opening.release

      // Act
      if (requester === 'learner') await harness.reader.action('return-current')
      else {
        const state = harness.reader.presentationState()
        await harness.reader.returnToCurrent(
          {
            presentationId: state.presentationId,
            expectedRevision: state.reader.contentRevision,
          },
          'agent',
        )
      }
      opening.release()
      await opening.entry

      // Assert
      assert.deepEqual(
        {
          loading: readerSeams(harness).isLoading(),
          contentTab: harness.reader.presentationState().reader.contentTab,
          testReplay:
            harness.reader.inspect().view?.nodeHistory?.header.studyId,
          summaryPlaceholder: harness.summary.webview.html.includes(
            'Open saved learning from Codebook to view its summary.',
          ),
          controlErrors: readerSeams(harness).errorLines(),
          toldFailures: [...harness.errorMessages],
        },
        {
          loading: false,
          contentTab: 'live',
          testReplay: undefined,
          summaryPlaceholder: true,
          controlErrors: [],
          toldFailures: [],
        },
      )
    } finally {
      release()
      await harness.close()
    }
  })
}

/**
 * Says what an error thrown out of the reader reads, or `undefined` when nothing was thrown.
 * @param operation - The reader call whose refusal is observed.
 * @returns The error's message, `''` for a throw without one, `undefined` when the call succeeded.
 * @example await refusalOf(() => harness.reader.select('repository/interface/theme')) // => undefined
 */
async function refusalOf(
  operation: () => Promise<unknown>,
): Promise<string | undefined> {
  return operation().then(
    () => undefined,
    (error: unknown) =>
      // The reader's errors come from its own module context, so `instanceof Error` cannot tell them.
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : '',
  )
}

/**
 * Reads what the browser replay shows now: the recording's readiness, whether the Learning summary draws its transport, and the replay family told.
 * @param harness - The recorded reader harness.
 * @returns The observations.
 * @example browserReplayObservations(harness) // => { readiness: 'ready', transport: true, family: 'browser' }
 */
function browserReplayObservations(harness: RecordedHarness) {
  return {
    readiness: harness.controller.state().readiness,
    transport: harness.summary.webview.html.includes(
      'id="recording-transport"',
    ),
    family: lastView(harness)?.replayFamily,
  }
}

/**
 * Opens the Reload fixture and ends the hold, so a test can look at the browser replay once every load has ended.
 * @param harness - The recorded reader harness.
 * @example await settleReload(harness, reloading)
 */
async function settleReload(
  harness: RecordedHarness,
  reloading: Awaited<ReturnType<typeof reloadHeldOrFailed>>,
): Promise<void> {
  reloading.load.release()
  await reloading.reload
  await harness.controller.settle()
}

/** The Learning summary's text while the reader shows no replay. */
const SUMMARY_PLACEHOLDER =
  'Open saved learning from Codebook to view its summary.'

// Value: protects=Reload pressed again after a same-study Reload's load failed loads the recording again, so the learner is not stuck on the failed replay with a refusal; fails_when=the Reload action refuses with "Select a recording first." because no recording is active after the failed load (Cycle 0052 task 31); why_new=the Reload mark's failed cell had no second Reload; seam=a Reload whose debugger replacement is failed once, then the Reload action again; no_claim=the native pane's pixels
test('Reload pressed again after a failed same-study Reload loads the recording', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const reloading = await reloadHeldOrFailed(harness, 'failed')

    // Act
    const refusal = await refusalOf(() =>
      harness.reader.action('reload-recording'),
    )
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the second Reload loads the recording',
      READER_RESULT_BOUND_MS,
    )
    await settleReload(harness, reloading)

    // Assert
    assert.deepEqual(
      { refusal, ...browserReplayObservations(harness) },
      {
        refusal: undefined,
        readiness: 'ready',
        transport: true,
        family: 'browser',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Reload pressed again while a same-study Reload still loads is not refused and restarts the load, so the recording ends loaded and shown once; fails_when=the Reload action refuses with "Select a recording first." while no recording is active, or the held first load comes back over the second (Cycle 0052 task 31); why_new=the Reload mark's loading cell had no second Reload; seam=the first load held at its debugger replacement, the Reload action again; no_claim=the native pane's pixels
test('Reload pressed again during a same-study Reload is not refused and ends with the recording shown once', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const reloading = await reloadHeldOrFailed(harness, 'held')

    // Act
    const refusal = await refusalOf(() =>
      harness.reader.action('reload-recording'),
    )
    await settleReload(harness, reloading)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the recording is loaded',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      {
        refusal,
        ...browserReplayObservations(harness),
        transportsDrawn:
          harness.summary.webview.html.split('id="recording-transport"')
            .length - 1,
      },
      {
        refusal: undefined,
        readiness: 'ready',
        transport: true,
        family: 'browser',
        transportsDrawn: 1,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Retry storage after a same-study Reload's load failed loads the recording again and never draws a Study selection under the browser summary; fails_when=the retry renders the selection while the replay is shown, so the presentation leaves the recording tab and the recording stays failed (Cycle 0052 task 31); why_new=the Reload mark's failed cell had no Retry; seam=a Reload whose debugger replacement is failed once, the retry action; no_claim=the native pane's pixels
test('Retry after a failed same-study Reload loads the recording and keeps the recording tab', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const reloading = await reloadHeldOrFailed(harness, 'failed')

    // Act
    const refusal = await refusalOf(() => harness.reader.action('retry'))
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the retry loads the recording',
      READER_RESULT_BOUND_MS,
    )
    await settleReload(harness, reloading)

    // Assert
    assert.deepEqual(
      {
        refusal,
        ...browserReplayObservations(harness),
        contentTab: harness.reader.presentationState().reader.contentTab,
      },
      {
        refusal: undefined,
        readiness: 'ready',
        transport: true,
        family: 'browser',
        contentTab: 'recording',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=choosing the Live tab after a same-study Reload's load failed leaves the summary composition: the Study pane is back, the summary reads its placeholder and the presentation reads the Live tab; fails_when=the tab message sees no recording and leaves the reader arranged for a browser replay that is gone (Cycle 0052 task 31); why_new=the Reload mark's failed cell had no tab choice; seam=a Reload whose debugger replacement is failed once, the Study pane's tab message; no_claim=the Live composition's native panes
test('choosing the Live tab after a failed same-study Reload leaves the summary composition', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await reloadHeldOrFailed(harness, 'failed')

    // Act
    harness.receive({
      type: 'tab',
      tab: 'live',
      revision: harness.reader.inspect().view!.revision,
    })
    await waitUntil(
      () => harness.panelColumn('codebook.studyContext') !== undefined,
      'the Study pane is back',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()

    // Assert
    assert.deepEqual(
      {
        studyPane: harness.panelColumn('codebook.studyContext') !== undefined,
        family: lastView(harness)?.replayFamily,
        summaryPlaceholder:
          harness.summary.webview.html.includes(SUMMARY_PLACEHOLDER),
        contentTab: harness.reader.presentationState().reader.contentTab,
      },
      {
        studyPane: true,
        family: undefined,
        summaryPlaceholder: true,
        contentTab: 'live',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's Return to Live after a same-study Reload's load failed ends the failed replay: the presentation reads the Live tab, the summary its placeholder, and a step can be selected again; fails_when=the Return leaves the Reload mark, so the presentation keeps the recording tab or the step selection is still refused as not loaded (Cycle 0052 task 31); why_new=the failed cell was tested with the learner's Return only; seam=a Reload whose debugger replacement is failed once, the agent's returnToCurrent; no_claim=the Live composition's panes
test('an agent’s Return to Live after a failed same-study Reload ends the failed replay', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await reloadHeldOrFailed(harness, 'failed')
    const state = harness.reader.presentationState()

    // Act
    const refusal = await refusalOf(() =>
      harness.reader.returnToCurrent(
        {
          presentationId: state.presentationId,
          expectedRevision: state.reader.contentRevision,
        },
        'agent',
      ),
    )
    await harness.controller.settle()
    const selectionRefusal = await refusalOf(() =>
      harness.reader.select('repository/interface/theme'),
    )

    // Assert
    assert.deepEqual(
      {
        refusal,
        contentTab: harness.reader.presentationState().reader.contentTab,
        readiness: harness.controller.state().readiness,
        summaryPlaceholder:
          harness.summary.webview.html.includes(SUMMARY_PLACEHOLDER),
        selectionRefusal,
      },
      {
        refusal: undefined,
        contentTab: 'live',
        readiness: 'idle',
        summaryPlaceholder: true,
        selectionRefusal: undefined,
      },
    )
  } finally {
    await harness.close()
  }
})

for (const requester of ['learner', 'agent'] as const) {
  // Value: protects=a Return to Live, the learner's or an agent's, while a same-study Reload still loads cancels that load: once it is released the recording does not come back over Live; fails_when=the resumed Reload makes the recording active again after the Return (Cycle 0052 task 18); why_new=the Reload mark's loading cell was left through a Return in no test; seam=the reload held at its debugger replacement, the return-current action or returnToCurrent; no_claim=the Live composition's panes
  test(`${requester === 'agent' ? 'an agent' : 'a learner'}’s Return to Live during a same-study Reload keeps the recording from coming back`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    try {
      const reloading = await reloadHeldOrFailed(harness, 'held')
      const state = harness.reader.presentationState()

      // Act
      const refusal = await refusalOf(() =>
        requester === 'learner'
          ? harness.reader.action('return-current')
          : harness.reader.returnToCurrent(
              {
                presentationId: state.presentationId,
                expectedRevision: state.reader.contentRevision,
              },
              'agent',
            ),
      )
      // The released load's own work ends within the controller's settle: a recording that came back would be active by then.
      await settleReload(harness, reloading)

      // Assert
      assert.deepEqual(
        {
          refusal,
          readiness: harness.controller.state().readiness,
          transport: harness.summary.webview.html.includes(
            'id="recording-transport"',
          ),
          contentTab: harness.reader.presentationState().reader.contentTab,
        },
        {
          refusal: undefined,
          readiness: 'idle',
          transport: false,
          contentTab: 'live',
        },
      )
    } finally {
      await harness.close()
    }
  })
}

for (const ending of ['held', 'failed'] as const) {
  // Value: protects=a runtime release (the run's service retiring) during a same-study Reload, loading or failed, leaves the browser replay shown: no Study selection is drawn in the Application pane under it; fails_when=retire() renders the selection because no recording is active yet, and the pane stops showing the recording the Reload loads (Cycle 0052 task 33); why_new=the Reload mark's release row was untested; seam=a Reload held at, or failed at, its debugger replacement, the reader's retire(service); no_claim=the native pane's pixels
  test(`a runtime release during a same-study Reload${ending === 'held' ? '' : ' that failed'} keeps the Application pane on the recording`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    let load: Awaited<ReturnType<typeof reloadHeldOrFailed>>['load'] | undefined
    try {
      const reloading = await reloadHeldOrFailed(harness, ending)
      load = reloading.load
      const application = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')!
      const documentBeforeRelease = application.webview.html

      // Act
      await harness.reader.retire(harness.service)
      const afterRelease = {
        applicationUnchanged:
          application.webview.html === documentBeforeRelease,
        contentTab: harness.reader.presentationState().reader.contentTab,
      }
      await settleReload(harness, reloading)

      // Assert
      assert.deepEqual(afterRelease, {
        applicationUnchanged: true,
        contentTab: 'recording',
      })
    } finally {
      load?.release()
      await harness.close()
    }
  })
}

// Value: protects=deleting the study of a failed same-study Reload is refused with the Recording-open sentence and the study is not moved to the Trash, since the replay's Reload and Retry need it; fails_when=the failed Reload counts as no open recording and the study is removed under the replay (Cycle 0052 task 33); why_new=the Reload mark's removal row was untested; seam=a Reload failed at its debugger replacement, the Study pane's delete-study message; no_claim=the native Trash
test('deleting the study of a failed same-study Reload is refused and keeps the study', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await reloadHeldOrFailed(harness, 'failed')

    // Act
    await readerSeams(harness).receive(
      {
        type: 'delete-study',
        revision: harness.reader.inspect().view!.revision,
        studyId: harness.studyId,
      },
      'context',
    )

    // Assert
    assert.deepEqual(
      {
        studyRemoval: structuredClone(
          harness.reader.inspect().view!.studyRemoval,
        ),
        trashMoves: harness.trashMoves,
        archiveKept:
          (await readerSeams(harness).readSavedArchive(harness.studyId)) !==
          undefined,
      },
      {
        studyRemoval: {
          status: 'refused',
          studyId: harness.studyId,
          text: 'Choose Overview or Live to leave Recording before deleting this study.',
        },
        trashMoves: [],
        archiveKept: true,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a test replay open A that fails after a newer Open replay B has entered the standing summary composition and waits for the work window's focus does not dismantle that composition: once the focus returns, B is shown in the summary composition; fails_when=A's failed or superseded open leaves the "empty" summary composition while B is still under way, so B enters a Study composition (Codex C1 / Claude F1 of the pt1 /ship review, Cycle 0052 task 35); why_new=the leave of an empty composition was tested against Return and Close, not against a newer entry under way; seam=the first open held then failed at the debugger replacement, changeWindowFocus(false) with unfocusedWindowReads; no_claim=the native window manager
test('a failed test replay open does not dismantle the composition a newer Open replay waits to fill', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let release = (): void => {}
  try {
    const store = harness.service.nodeHistoryStore!
    const first = await saveTwoStopNodeHistory(store)
    const second = await saveTwoStopNodeHistory(store)
    await harness.reader.action('retry')
    await harness.reader.open()
    const seams = readerSeams(harness)
    const replace = seams.debuggerReplacement
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered = (): void => {}
    const opening = new Promise<void>((resolve) => {
      entered = resolve
    })
    seams.debuggerReplacement = async (): Promise<void> => {
      // Only the first open is held and then failed: the second replay starts its debugger as usual.
      seams.debuggerReplacement = replace
      entered()
      await held
      throw new Error('The historical debugger did not start.')
    }
    const firstEntry = harness.reader.openLearningReplay(first.studyId)
    await opening

    // Act: the second entry waits for the window's focus inside the composition; then the first open fails and the focus returns.
    harness.changeWindowFocus(false)
    const readsBefore = harness.unfocusedWindowReads()
    const secondEntry = harness.reader.openLearningReplay(second.studyId)
    await waitUntil(
      () => harness.unfocusedWindowReads() > readsBefore,
      'the second entry waits for the window focus',
      READER_RESULT_BOUND_MS,
    )
    release()
    await firstEntry
    harness.changeWindowFocus(true)
    await secondEntry
    await landsOn(harness, 2, 'the second test replay lands on its first stop')

    // Assert
    assert.deepEqual(
      {
        testReplay: harness.reader.inspect().view?.nodeHistory?.header.studyId,
        ...compositionOf(harness),
      },
      {
        testReplay: second.studyId,
        studyPane: false,
        application: true,
        summary: true,
        family: 'test',
      },
    )
  } finally {
    release()
    harness.changeWindowFocus(true)
    await harness.close()
  }
})

// Value: protects=a browser recording opened over a shown test replay whose read fails leaves the Learning summary the reader's document, so the failure and its recovery show there and not the closed replay's placeholder; fails_when=loadPlayback retires the test replay and leaves the summary its placeholder while the recording loads and fails (Codex structured S1, Cycle 0052 task 35); why_new=the failed-read row was tested for a Reload (a browser replay already shown), not for a recording over a test replay; seam=a test replay opened by Open replay, the recording's header.json broken as the Reload recovery test does; no_claim=the native pane's pixels
test('a browser recording that fails to read over a shown test replay gives the Learning summary its recovery document', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  const headerPath = join(harness.store.path(harness.studyId), 'header.json')
  const header = await readFile(headerPath)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await landsOn(harness, 2, 'the test replay lands on its first stop')
    await writeFile(headerPath, '{broken')

    // Act
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the recording read fails',
      READER_RESULT_BOUND_MS,
    )
    await harness.controller.settle()

    // Assert
    assert.deepEqual(
      {
        transport: harness.summary.webview.html.includes(
          'id="recording-transport"',
        ),
        placeholder: harness.summary.webview.html.includes(SUMMARY_PLACEHOLDER),
      },
      { transport: true, placeholder: false },
    )
  } finally {
    await writeFile(headerPath, header)
    await harness.close()
  }
})

// Value: protects=a second Reload pressed while the first Reload's load is held starts a new load, and the first load, released afterwards and failing, does not decide the outcome: the recording ends ready; fails_when=the controller keeps the pending load of the same study and starts none, so the second Reload restarts nothing and the first load's failure ends the replay failed (Codex structured S2, Cycle 0052 task 35); why_new=the second-Reload test only checked the refusal and the end state, not that a load restarted; seam=the first load held then failed at the debugger replacement, a counting wrapper for the second load; no_claim=the native pane's pixels
test('a second Reload during a held Reload restarts the load and the first load’s failure does not decide the outcome', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const reloading = await reloadHeldOrFailed(harness, 'held')
    const seams = readerSeams(harness)
    const replace = seams.debuggerReplacement
    let secondLoadsStarted = 0
    seams.debuggerReplacement = async (signal?: AbortSignal): Promise<void> => {
      secondLoadsStarted++
      return replace(signal)
    }

    // Act
    await harness.reader.action('reload-recording')
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the second Reload loads the recording',
      READER_RESULT_BOUND_MS,
    ).catch(() => undefined)
    const startedBeforeFirstEnds = secondLoadsStarted
    reloading.load.fail()
    await reloading.reload
    await harness.controller.settle()

    // Assert
    assert.deepEqual(
      {
        startedBeforeFirstEnds,
        ...browserReplayObservations(harness),
      },
      {
        startedBeforeFirstEnds: 1,
        readiness: 'ready',
        transport: true,
        family: 'browser',
      },
    )
  } finally {
    await harness.close()
  }
})

for (const ending of ['held', 'failed'] as const) {
  // Value: protects=while a same-study Reload is loading or has failed, the views the reader sends read the browser replay with its recording state (loading, or the failure and its reason) and the recording tab, so the summary's status, failure and recovery are current; fails_when=message() projects the reader as having no recording because recordingActive is false during the Reload, so the views keep a stale recording status under the browser family (Cycle 0052 task 36, local CodeRabbit round 11, minor); why_new=the Reload tests read presentationState, not the views' message; seam=a Reload whose debugger replacement is held, or held then failed; no_claim=the webview's rendering of the status
  test(`the views read the recording while a same-study Reload ${ending === 'held' ? 'is loading' : 'has failed'}`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    let release = (): void => {}
    try {
      // Act
      const reloading = await reloadHeldOrFailed(harness, ending)
      release = reloading.load.release

      // Assert
      const view = harness.reader.inspect().view
      assert.deepEqual(
        {
          contentTab: view?.contentTab,
          readiness: view?.recording?.readiness,
          studyId: view?.recording?.studyId,
        },
        {
          contentTab: 'recording',
          readiness: ending === 'held' ? 'loading' : 'failed',
          studyId: harness.studyId,
        },
      )
    } finally {
      release()
      await harness.close()
    }
  })
}

for (const ending of ['held', 'failed'] as const) {
  // Value: protects=Focus source during a same-study Reload, loading or failed, leaves the browser replay's Application pane as it is: no Study selection is drawn there and its title is not renamed; fails_when=renderSelection reaches presentApplication, which checks only recordingActive, and the pane shows the Study selection under the replay's loading or failure (Cycle 0052 task 37, local CodeRabbit round 12, minor); why_new=the Reload tests released the runtime and refreshed, none pressed Focus source; seam=a Reload held at, or failed at, its debugger replacement, the reader's source action; no_claim=the native pane's pixels
  test(`Focus source during a same-study Reload${ending === 'held' ? '' : ' that failed'} keeps the Application pane on the recording`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    let load: Awaited<ReturnType<typeof reloadHeldOrFailed>>['load'] | undefined
    try {
      const reloading = await reloadHeldOrFailed(harness, ending)
      load = reloading.load
      const application = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')!
      const documentBefore = application.webview.html,
        titleBefore = application.title

      // Act
      await harness.reader.action('source').catch(() => undefined)
      const afterSource = {
        applicationUnchanged: application.webview.html === documentBefore,
        titleUnchanged: application.title === titleBefore,
      }
      await settleReload(harness, reloading)

      // Assert
      assert.deepEqual(afterSource, {
        applicationUnchanged: true,
        titleUnchanged: true,
      })
    } finally {
      load?.release()
      await harness.close()
    }
  })
}

// Value: protects=Retry storage / refresh after a failed same-study Reload that meets a presentation change begun while it read the storage is refused before it leaves the replay, so the failed recording and its reason stay as they were; fails_when=reloadShownRecording leaves the playback and sets the Reload mark before openRecording refuses the pending presentation change, so the replay's failure is gone and no load starts (hosted CodeRabbit on PR #125, Cycle 0052 task 39); why_new=the Reload's refusals were only tested from the Reload button, which action() checks before anything changes; seam=recordedReaderHarness, a Reload failed at the debugger replacement, an agent's restore held at its layout response while Retry reads the storage; no_claim=which presentation change the agent asks for
test('Retry after a failed same-study Reload that meets a pending presentation change keeps the failed replay as it was', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  let releaseArrangement = (): void => {}
  try {
    await reloadHeldOrFailed(harness, 'failed')
    const failedReplay = harness.controller.state()
    const arrangement = harness.holdNextLayoutResponse()
    releaseArrangement = arrangement.release

    // Act: Retry starts reading the storage, and an agent's restore begins and waits for its layout meanwhile.
    const retry = harness.reader.action('retry').then(
      () => 'retried',
      (error: unknown) => String(error),
    )
    const presentation = harness.reader.presentationState()
    const restore = harness.reader
      .changePresentation(
        {
          presentationId: presentation.presentationId,
          expectedRevision: presentation.presentationControlRevision,
          mode: presentation.mode,
          action: 'restore',
        },
        'agent',
      )
      .catch(() => undefined)
    await arrangement.started
    const retryOutcome = await retry
    const replayAfterRetry = harness.controller.state()
    arrangement.release()
    await restore

    // Assert
    assert.match(retryOutcome, /presentation change or reader close is pending/)
    assert.deepEqual(
      {
        studyId: replayAfterRetry.studyId,
        readiness: replayAfterRetry.readiness,
        reason: replayAfterRetry.reason,
      },
      {
        studyId: harness.studyId,
        readiness: 'failed',
        reason: failedReplay.reason,
      },
    )
  } finally {
    releaseArrangement()
    await harness.close()
  }
})

// Value: protects=a learner's Return to Live ends an Open replay that waits for the work window's focus at once, so it neither holds the next entry's turn for the 10 s focus bound nor tells a failure; fails_when=the overtaken entry keeps polling the window focus until its bound after the Return (hosted CodeRabbit on PR #125, Cycle 0052 task 40); why_new=task 12 tested entries waiting for their turn, not one waiting for the focus inside its turn; seam=changeWindowFocus(false), the harness's count of unfocused window reads, a bound of half the focus wait; no_claim=the native window manager
test('Return to Live ends an Open replay that waits for the work window’s focus at once', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const second = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openByOpenReplay(harness)
    harness.hideSummary()
    harness.changeWindowFocus(false)
    const readsBefore = harness.unfocusedWindowReads()
    let hasEntryEnded = false
    const entry = harness.reader
      .openLearningReplay(second.studyId)
      .finally(() => {
        hasEntryEnded = true
      })
    await waitUntil(
      () => harness.unfocusedWindowReads() > readsBefore,
      'the entry waits for the window focus',
      READER_RESULT_BOUND_MS,
    )

    // Act
    const returning = harness.reader.action('return-current')
    // Half of the 10 s focus wait: an entry still waiting for the focus would not end within it.
    await waitUntil(
      () => hasEntryEnded,
      'the overtaken entry ends before the focus wait would',
      5_000,
    )
    harness.changeWindowFocus(true)
    await returning
    await entry

    // Assert
    assert.deepEqual(
      {
        errors: harness.errorMessages,
        testReplay: harness.reader.inspect().view?.nodeHistory?.header.studyId,
      },
      { errors: [], testReplay: undefined },
    )
  } finally {
    harness.changeWindowFocus(true)
    await harness.close()
  }
})

// Value: protects=a saved study chosen in the bottom panel after a same-study Reload failed keeps the panel's open request unanswered until the chosen recording has loaded, as a choice during the replay does, so the panel's list does not fall back to the failed replay's study meanwhile; fails_when=openReplyOwedTo reads recordingActive alone, so the reply is posted while the chosen recording still loads (hosted CodeRabbit on PR #125, Cycle 0052 task 41); why_new=task 28 tested the choice's open, not its pane reply; seam=recordedReaderHarness, a Reload failed and the chosen load held at the debugger replacement, one event-loop turn for the choice's handling to end, the bottom panel's open-request replies; no_claim=the panel's list rendering
test('a Saved studies choice after a failed same-study Reload is answered once the chosen recording has loaded', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  let chosenLoad: ReturnType<typeof holdNextRecordingLoad> | undefined
  try {
    const other = await saveOtherBrowserStudyShown(harness)
    await reloadHeldOrFailed(harness, 'failed')
    chosenLoad = holdNextRecordingLoad(harness)

    // Act
    harness.receivePlaybackPanel({
      type: 'history',
      revision: harness.reader.inspect().view!.revision,
      studyId: other.id,
      openRequest: 7,
    })
    await chosenLoad.hasEntered
    // The load holds at its first step while the choice's handling still has promise steps to run; one event-loop turn lets them end.
    await new Promise<void>((resolve) => setImmediate(resolve))
    const repliesWhileLoading = harness.openRequestReplies()
    chosenLoad.release()
    await waitUntil(
      () => harness.openRequestReplies().length > 0,
      'the choice is answered',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      {
        repliesWhileLoading,
        replies: harness.openRequestReplies(),
        recording: harness.controller.state().studyId,
      },
      {
        repliesWhileLoading: [],
        replies: [{ webview: 'moments', openRequest: 7 }],
        recording: other.id,
      },
    )
  } finally {
    chosenLoad?.release()
    await harness.close()
  }
})

// Value: protects=Return to Live from a browser replay withdraws the Learning summary before the playback controller's leave publishes, so the replay's summary never redraws a departing state (its captured source not ready, its observation loading) before the placeholder; fails_when=the summary still holds the replay's document when the leave's publish reaches it (N52 Cursor take 2 on 270022c7: one frame of "The current captured source is not ready…" and "Loading the selected observation…", Cycle 0052 task 43); why_new=task 6's test counted only Study messages without a recording, and this message carries the browser family; seam=recordedReaderHarness, the summary webview's html and postMessage from the Return's start; no_claim=the native frames, which N52 (e) checks
test('Return to Live from a browser replay sends its Learning summary nothing once the departure starts', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const replayDocument = harness.summary.webview.html
    let isReturning = false
    const drawnWhileReturning: string[] = [],
      post = harness.summary.webview.postMessage.bind(harness.summary.webview)
    harness.summary.webview.postMessage = async (message: StudyViewMessage) => {
      // Only a message that reaches the replay's own document draws anything; the placeholder has no script.
      if (isReturning && harness.summary.webview.html === replayDocument)
        drawnWhileReturning.push(message.type)
      return post(message)
    }

    // Act
    isReturning = true
    await harness.reader.action('return-current')

    // Assert
    assert.deepEqual(drawnWhileReturning, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a newer Open replay ends an earlier one that waits for the work window's focus inside open() while it enters the summary composition from Live, so the earlier entry holds no turn for the 10 s focus bound and tells nothing; fails_when=open() gets no cancellation from the entry and its wait for the window goes on until the focus returns or its bound passes (hosted CodeRabbit on PR #125, outside-diff finding at studyWorkspace.ts:11951, Cycle 0052 task 44); why_new=task 40's test covered the standing composition's wait, not open()'s; seam=the first entry's layout response held while the window loses the focus, changeWindowFocus, the harness's count of unfocused window reads, a bound of half the focus wait; no_claim=the native window manager
test('a newer Open replay ends an earlier one that waits for the work window’s focus while it enters from Live', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let releaseArrangement = (): void => {}
  try {
    const first = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    const second = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()
    // The window keeps the focus while the first entry prepares the Application group, then loses it before the summary's reveal.
    const arrangement = harness.holdNextLayoutResponse()
    releaseArrangement = arrangement.release
    let hasFirstEnded = false
    const firstEntry = harness.reader
      .openLearningReplay(first.studyId)
      .finally(() => {
        hasFirstEnded = true
      })
    await arrangement.started
    harness.changeWindowFocus(false)
    const readsBefore = harness.unfocusedWindowReads()
    arrangement.release()
    await waitUntil(
      () => harness.unfocusedWindowReads() > readsBefore,
      'the first entry waits for the window focus',
      READER_RESULT_BOUND_MS,
    )

    // Act
    const secondEntry = harness.reader.openLearningReplay(second.studyId)
    // Half of the 10 s focus wait: an entry still waiting for the focus would not end within it.
    await waitUntil(
      () => hasFirstEnded,
      'the overtaken entry ends before the focus wait would',
      5_000,
    )
    harness.changeWindowFocus(true)
    await firstEntry
    await secondEntry
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === second.studyId &&
        !lastView(harness)?.loading,
      'the second replay is shown',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      {
        errors: harness.errorMessages,
        testReplay: lastView(harness)?.nodeHistory?.header.studyId,
      },
      { errors: [], testReplay: second.studyId },
    )
  } finally {
    releaseArrangement()
    harness.changeWindowFocus(true)
    await harness.close()
  }
})

// Value: protects=a newer Open replay ends an earlier one whose Learning summary reveal in the standing composition waits for the summary view, so the earlier entry holds no turn for the reveal's 5 s bound and tells nothing; fails_when=the standing composition's showLearningSummary gets no cancellation from the entry and waits for the view until its bound (hosted CodeRabbit on PR #125, outside-diff finding at studyWorkspace.ts:11946, Cycle 0052 task 45); why_new=tasks 40 and 44 covered the waits for the work window, not the summary reveal's wait for its view; seam=the first entry's codebook.learningSummary.focus held, hideSummary after it so the view stays hidden, a bound of half the reveal's wait; no_claim=the native view container
test('a newer Open replay ends an earlier one whose Learning summary reveal waits in the standing composition', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let release = (): void => {}
  try {
    const second = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    const third = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await openByOpenReplay(harness)
    harness.hideSummary()
    const held = harness.holdNextCommand('codebook.learningSummary.focus')
    release = held.release
    let hasFirstEnded = false
    const firstEntry = harness.reader
      .openLearningReplay(second.studyId)
      .finally(() => {
        hasFirstEnded = true
      })
    await held.started
    // The editor shows no summary for this reveal, so the reveal would wait for the view.
    harness.hideSummary()

    // Act
    const secondEntry = harness.reader.openLearningReplay(third.studyId)
    held.release()
    // Half of the reveal's 5 s wait for the view: an entry still waiting for it would not end within it.
    await waitUntil(
      () => hasFirstEnded,
      'the overtaken entry ends before its summary wait would',
      2_500,
    )
    await firstEntry
    await secondEntry
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === third.studyId &&
        !lastView(harness)?.loading,
      'the third replay is shown',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      {
        errors: harness.errorMessages,
        testReplay: lastView(harness)?.nodeHistory?.header.studyId,
      },
      { errors: [], testReplay: third.studyId },
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=the shared transport's status line for a refused test replay control shows its cause with the storage folder replaced by <storage>, as the replay's other failures do; fails_when=nodeHistoryRefusal publishes String(error) with the learner's storage path (Cycle 0052 task 21, /ship review); why_new=the refusal's projection only stripped "Error: "; seam=the store's saveLearningDecision rejects with a path inside the learning directory; no_claim=the status line's rendering (Reader DOM)
test('a refused test replay control shows its cause without the storage folder', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)
    const store = harness.service.nodeHistoryStore!
    context.mock.method(store, 'saveLearningDecision', async () => {
      throw new Error(
        `EACCES: permission denied, open '${store.learningDirectory}/decision.json'`,
      )
    })

    // Act: the learner marks the replay understood, and the write is refused.
    harness.receivePlaybackPanel({
      type: 'node-history-understanding',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      understood: true,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryRefusal !== undefined,
      'the refusal reaches the transport',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      lastView(harness)?.nodeHistoryRefusal,
      "EACCES: permission denied, open '<storage>/decision.json'",
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a test replay move whose moment fails to show for a cause other than the replay debugger's start reads that the recorded moment could not be shown and asks for the stop again, without the debugger restart clause; fails_when=every move failure is worded "The replay debugger could not start" whatever its cause (Cycle 0052 task 17, /ship review); why_new=describeNodeHistoryMoveFailure had one sentence; seam=the harness's held historical debug presentation, rejected with a plain Error as a presentation in a running debugger fails; no_claim=a real DAP failure
test('a move whose recorded moment fails to show for another cause asks for the stop again', async () => {
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

    // Act: the running debugger fails to show the stop.
    held.reject(new Error('The stop could not be shown in Run and Debug.'))
    await waitUntil(
      () => lastView(harness)?.nodeHistoryRefusal !== undefined,
      'the failure reaches the transport',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      {
        failure: lastView(harness)?.nodeHistoryRefusal,
        shown: lastView(harness)?.nodeHistoryPosition?.sequence,
      },
      {
        failure:
          'The recorded moment could not be shown: The stop could not be shown in Run and Debug. The last moment is still shown. Select this stop again to retry.',
        shown: 2,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a newer Open replay made while an earlier one's one-replay-at-a-time notice is still unanswered asks its own notice at once, and its answer opens its replay; the earlier notice's later answer closes nothing; fails_when=the earlier entry awaits its unanswered notice inside its turn, so every later entry waits until the learner answers it (Cycle 0052 task 11, /ship review); why_new=the overtaken-notice test answered the first notice before the second entry needed its turn; seam=recordedReaderHarness, answerWarningDialogs held per notice; no_claim=the native notification's lifetime
test('a newer Open replay asks its own notice while an earlier notice is unanswered, and the earlier answer closes nothing', async () => {
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

    // Act: a second Open replay while the first notice waits for its answer.
    const secondEntry = harness.reader.openLearningReplay(second.studyId)
    await waitUntil(
      () => answers.length === 2,
      'the second notice is shown while the first is unanswered',
      READER_RESULT_BOUND_MS,
    )
    answers[1]!('Close browser replay')
    await secondEntry
    await landsOn(
      harness,
      2,
      'the latest entry’s replay lands on its first stop',
    )
    answers[0]!('Close browser replay')
    await firstEntry

    // Assert
    assert.deepEqual(
      {
        testReplay: lastView(harness)?.nodeHistory?.header.studyId,
        recording: harness.controller.state().studyId,
      },
      { testReplay: second.studyId, recording: undefined },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Study pane's error line of a refused test replay control shows its cause with the storage folder replaced, as the transport's status line does, and keeps its error name; fails_when=the errors list carries String(error) with the learner's storage path while only nodeHistoryRefusal is sanitized (local CodeRabbit round 2 on f0c11ead, Cycle 0052 task 48); why_new=task 21's test read the transport's copy only; seam=the store's saveLearningDecision rejects with a path inside the learning directory; no_claim=the line's rendering
test('the Study pane’s line of a refused test replay control shows its cause without the storage folder', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)
    const store = harness.service.nodeHistoryStore!
    context.mock.method(store, 'saveLearningDecision', async () => {
      throw new Error(
        `EACCES: permission denied, open '${store.learningDirectory}/decision.json'`,
      )
    })

    // Act
    harness.receivePlaybackPanel({
      type: 'node-history-understanding',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      understood: true,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryRefusal !== undefined,
      'the refusal is published',
      READER_RESULT_BOUND_MS,
    )

    // Assert: the view is a clone from the webview's realm, so its lines are compared as a plain array.
    assert.deepEqual(
      [...(lastView(harness)?.errors ?? [])],
      ["Error: EACCES: permission denied, open '<storage>/decision.json'"],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a refused test replay control's cause keeps the storage folder replaced after the runtime is released, on the transport's status line and on the Study pane's line, so a later publish never shows the learner's storage path; fails_when=the line is sanitized only at publish with the service's roots, so a publish after the release (no service, no roots) carries the stored `String(error)` with the path (Cycle 0052 pt2 /ship Step 11, Claude adversarial finding 2); why_new=tasks 21 and 48 published while the service was attached; seam=the store's saveLearningDecision rejects with a path inside the learning directory, then the reader's own runtime release and a direct publish standing for any later view change; no_claim=the line's rendering
test('a refused test replay control’s cause stays without the storage folder after the runtime is released', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)
    const store = harness.service.nodeHistoryStore!
    context.mock.method(store, 'saveLearningDecision', async () => {
      throw new Error(
        `EACCES: permission denied, open '${store.learningDirectory}/decision.json'`,
      )
    })
    harness.receivePlaybackPanel({
      type: 'node-history-understanding',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      understood: true,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryRefusal !== undefined,
      'the refusal is published',
      READER_RESULT_BOUND_MS,
    )

    // Act: the runtime is released, and the reader publishes again, as any later view change makes it.
    await harness.reader.retire(harness.service)
    harness.reader['publish']()

    // Assert: the views still show the cause with the storage folder replaced; the view is a clone from the webview's realm, so its lines are compared as a plain array.
    const shown = lastView(harness)
    assert.deepEqual(
      {
        errors: [...(shown?.errors ?? [])],
        refusal: shown?.nodeHistoryRefusal,
      },
      {
        errors: [
          "Error: EACCES: permission denied, open '<storage>/decision.json'",
        ],
        refusal: "EACCES: permission denied, open '<storage>/decision.json'",
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a test replay control refused after the runtime was released still shows its cause with the storage folder replaced, because the reader words causes with the roots it holds itself once no service names them; fails_when=the reader falls back to no storage roots after the release (`{ storage: [] }`), so a control it still serves from its own history store shows the learner's storage path (Cycle 0052 pt2 /ship Step 11, Claude adversarial pass 2); why_new=the earlier release test refused the control before the release; seam=the reader's own runtime release, then the store's saveLearningDecision rejecting with a path inside the learning directory; no_claim=the line's rendering
test('a test replay control refused after the runtime is released shows its cause without the storage folder', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)
    const store = harness.service.nodeHistoryStore!
    await harness.reader.retire(harness.service)
    context.mock.method(store, 'saveLearningDecision', async () => {
      throw new Error(
        `EACCES: permission denied, open '${store.learningDirectory}/decision.json'`,
      )
    })

    // Act: the learner marks the replay understood after the release, and the write is refused.
    harness.receivePlaybackPanel({
      type: 'node-history-understanding',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      understood: true,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryRefusal !== undefined,
      'the refusal is published',
      READER_RESULT_BOUND_MS,
    )

    // Assert: the view is a clone from the webview's realm, so its lines are compared as a plain array.
    const shown = lastView(harness)
    assert.deepEqual(
      {
        errors: [...(shown?.errors ?? [])],
        refusal: shown?.nodeHistoryRefusal,
      },
      {
        errors: [
          "Error: EACCES: permission denied, open '<storage>/decision.json'",
        ],
        refusal: "EACCES: permission denied, open '<storage>/decision.json'",
      },
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a failure the reader words after the runtime was released hides the storage folder, the workspace and the home directory as the released service did; fails_when=the reader falls back to the home directory alone (the former `describeFailure`) or to roots it guesses without the released service's workspace, so the learner's storage or repository path shows (Cycle 0052 pt2 /ship Step 9, delta review of the release fallback); why_new=the release tests above cover the storage folder of a refused control only; seam=the reader's own runtime release and its public describeFailure, as the Save Learning Replay command calls it; no_claim=a workspace distinct from the storage root (the harness keeps its storage in the workspace folder) and the notification's rendering
test('a failure worded after the runtime is released hides the storage folder, the workspace and the home directory', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const storage = harness.service.nodeHistoryStore!.learningDirectory
    const workspace = harness.service.environment.workspace
    await harness.reader.retire(harness.service)

    // Act
    const worded = harness.reader.describeFailure(
      new Error(
        `EACCES: '${storage}/a.json', '${workspace}/src/b.ts', '${homedir()}/c.txt'`,
      ),
    )

    // Assert: the harness's service keeps its storage in the workspace folder, so the released service's roots word that folder `<storage>` too.
    assert.equal(
      worded,
      "EACCES: '<storage>/a.json', '<storage>/src/b.ts', '~/c.txt'",
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a failed move whose return to the committed moment fails too does not claim that the last moment is still shown: the line words the move's failure and its recovery, and the recorded-source row tells why the return failed; fails_when=the line says `The last moment is still shown.` while the slot could not show that moment again (local CodeRabbit round 5 on dba70b06, Major); why_new=the move-failure tests return to the committed moment successfully; seam=the harness's held historical debug presentation rejected with a plain Error, the learner's own close of the slot tab and the harness's failure of the next non-file document open; no_claim=a real DAP or editor failure
test('a failed move whose return to the last moment fails too does not say the last moment is still shown', async () => {
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
    // The learner closes the slot's tab, and the editor will refuse to open it again.
    const slotTab = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) =>
        (
          tab.input as { uri?: { path?: string } } | undefined
        )?.uri?.path?.includes('/node-history-slot/'),
      )!
    harness.closeTabByHand(slotTab)
    harness.failCurrentSourceOpen()

    // Act: the running debugger fails to show the stop, and the return to the last moment cannot open the slot.
    held.reject(new Error('The stop could not be shown in Run and Debug.'))
    await waitUntil(
      () => lastView(harness)?.nodeHistoryRefusal !== undefined,
      'the failure reaches the transport',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      lastView(harness)?.nodeHistoryRefusal,
      'The recorded moment could not be shown: The stop could not be shown in Run and Debug. Select this stop again to retry.',
    )
  } finally {
    harness.restoreCurrentSourceOpen()
    await harness.close()
  }
})

/**
 * Records the study ids of the test replays every Study message a view's webview receives from now on names, by wrapping its `postMessage`; the closed-reader open tests read it to prove that a view never draws another replay while a chosen one opens.
 * @param view - The harness's Learning summary view.
 * @returns The live list of each received Study message's shown test replay id (`'none'` for a message that names no test replay).
 * @example const drawn = recordDrawnTestReplays(harness.summary) // => ['none', 'node_run-b']
 */
function recordDrawnTestReplays(view: {
  webview: { postMessage: (message: StudyViewMessage) => Promise<boolean> }
}): string[] {
  const drawn: string[] = [],
    post = view.webview.postMessage.bind(view.webview)
  view.webview.postMessage = async (message: StudyViewMessage) => {
    if (message.type === 'study')
      drawn.push(message.nodeHistory?.header.studyId ?? 'none')
    return post(message)
  }
  return drawn
}

// Value: protects=Saved studies naming no study while the reader is closed, so the learner can choose the study the closed reader showed and have it open, and naming the replay again once Open Study Workspace restores it; fails_when=a closed reader's Study message omits readerClosed, or an open reader sets it (Cycle 0056 task 31, N56-F1: the list kept naming the shown replay, so choosing it fired no change); why_new=the list rule lived in the page only, with no host signal for a closed reader; seam=the reader's inspected Study message; no_claim=the list's rendering (Reader DOM check study-bootstrap-qa)
test('a closed reader tells Saved studies that it is closed, and a reopened reader that shows its replay does not', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await openByOpenReplay(harness)
    const whileOpen = harness.reader.inspect().view?.readerClosed

    // Act
    await harness.reader.close()
    const afterClose = harness.reader.inspect().view?.readerClosed
    await harness.reader.open()
    const afterReopen = harness.reader.inspect().view

    // Assert
    assert.deepEqual(
      {
        whileOpen,
        afterClose,
        afterReopen: afterReopen?.readerClosed,
        replay: afterReopen?.nodeHistory?.header.studyId,
      },
      {
        whileOpen: undefined,
        afterClose: true,
        afterReopen: undefined,
        replay: history.studyId,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Open replay from the status item after Close never draws the replay the closed reader showed in the Learning summary while the chosen one opens; fails_when=the summary receives a Study message that names the closed reader's replay once the open starts (Cycle 0056 task 32, N56-F2: 1 to 2 frames of the earlier replay's title, result and stop beside "The recorded source is opening"); why_new=Cycle 0052 task 2 covered Return to Live, not an open from a closed reader that keeps its selection; seam=the harness's summary webview postMessage; no_claim=the native frames, which the N56 rerun checks
test('Open replay of another test replay after Close never draws the replay the closed reader showed in the Learning summary', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    // Saved before the first open, whose Retry storage / refresh lists both replays in Saved studies.
    const chosenReplay = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    const closedReplay = await openByOpenReplay(harness)
    await harness.reader.close()
    const drawn = recordDrawnTestReplays(harness.summary)

    // Act
    await harness.reader.openLearningReplay(chosenReplay.studyId)
    await landsOn(harness, 2, 'the chosen replay lands on its first stop')

    // Assert
    await waitUntil(
      () => drawn.at(-1) === chosenReplay.studyId,
      'the summary draws the chosen replay',
      READER_RESULT_BOUND_MS,
    )
    assert.equal(drawn.includes(closedReplay.studyId), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=a Saved studies choice of another test replay after Close never draws the replay the closed reader showed in the Learning summary while the chosen one opens; fails_when=the summary receives a Study message that names the closed reader's replay once the choice arrives (Cycle 0056 task 32, N56-F2); why_new=the status item's Open replay and a Saved studies choice enter the closed reader through the same entry but each is its own learner path; seam=the harness's summary webview postMessage and the Study pane's node-history message; no_claim=the native frames, which the N56 rerun checks
test('a Saved studies choice of another test replay after Close never draws the replay the closed reader showed in the Learning summary', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    // Saved before the first open, whose Retry storage / refresh lists both replays in Saved studies.
    const chosenReplay = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    const closedReplay = await openByOpenReplay(harness)
    await harness.reader.close()
    const drawn = recordDrawnTestReplays(harness.summary)

    // Act
    await readerSeams(harness).receive(
      {
        type: 'node-history',
        revision: harness.reader.inspect().view!.revision,
        studyId: chosenReplay.studyId,
      },
      'context',
    )
    await landsOn(harness, 2, 'the chosen replay lands on its first stop')

    // Assert
    await waitUntil(
      () => drawn.at(-1) === chosenReplay.studyId,
      'the summary draws the chosen replay',
      READER_RESULT_BOUND_MS,
    )
    assert.equal(drawn.includes(closedReplay.studyId), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=choosing again the test replay the closed reader showed still opens it at once, with the Learning summary drawing that replay; fails_when=retiring the closed reader's selection for another replay also retires the same replay's, or the summary never draws it (Cycle 0056 task 32); why_new=the fix retires a closed reader's selection only for another replay; seam=the harness's summary webview postMessage; no_claim=the native frames
test('Open replay of the test replay the closed reader showed draws that replay in the Learning summary', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const closedReplay = await openByOpenReplay(harness)
    await harness.reader.close()
    const drawn = recordDrawnTestReplays(harness.summary)

    // Act
    await harness.reader.openLearningReplay(closedReplay.studyId)
    await landsOn(harness, 2, 'the replay lands on its first stop')

    // Assert
    await waitUntil(
      () => drawn.at(-1) === closedReplay.studyId,
      'the summary draws the replay again',
      READER_RESULT_BOUND_MS,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a browser recording chosen after Close of a test replay never draws the test replay in the Learning summary while the recording opens; fails_when=the summary receives a Study message that names the closed reader's test replay once the recording's open starts (Cycle 0056 task 32, the browser side of N56-F2); why_new=the task's fix covers a test replay entering a closed reader, and the reverse entry needed its own proof; seam=recordedReaderHarness, the summary webview's postMessage; no_claim=the native frames, which the N56 rerun checks
test('a browser recording opened after Close of a test replay never draws the test replay in the Learning summary', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await landsOn(harness, 2, 'the test replay lands on its first stop')
    await harness.reader.close()
    const drawn = recordDrawnTestReplays(harness.summary)

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert: the summary was published to, and none of it named the test replay.
    assert.equal(drawn.length > 0, true)
    assert.equal(drawn.includes(history.studyId), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=a test replay chosen after Close of a browser recording never draws the recording in the Learning summary while the replay opens; fails_when=the summary receives a Study message that carries the closed reader's recording once the test replay's open starts (Cycle 0056 task 32, the browser side of N56-F2); why_new=the task's fix covers a test replay closed before another test replay, and the reverse entry needed its own proof; seam=recordedReaderHarness, the summary webview's postMessage; no_claim=the native frames, which the N56 rerun checks
test('a test replay opened after Close of a browser recording never draws the recording in the Learning summary', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.close()
    harness.answerWarningDialogs(async () => 'Close browser replay')
    const recordingsDrawn: (string | undefined)[] = [],
      post = harness.summary.webview.postMessage.bind(harness.summary.webview)
    harness.summary.webview.postMessage = async (message: StudyViewMessage) => {
      if (message.type === 'study' && message.recording !== undefined)
        recordingsDrawn.push(message.nodeHistory?.header.studyId)
      return post(message)
    }

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await landsOn(harness, 2, 'the test replay lands on its first stop')

    // Assert
    assert.deepEqual(recordingsDrawn, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=the replay a closed reader showed surviving an entry for another replay that is refused, so Open Study Workspace still shows it; fails_when=the entry drops the closed reader's selection before its open and the refusal leaves the learner with no replay to restore (local open-code-review, Cycle 0056 pt3 OCR-L3); why_new=task 32 kept the closed reader's replay out of the summary but its first fix retired the selection for good; seam=the reader's open refused once for the second replay's entry, the diagnostics log; no_claim=the notification's wording
test('a refused Open replay of another test replay after Close leaves the closed reader’s replay for Open Study Workspace', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.reader.diagnostics = { log: () => undefined, show: () => undefined }
  try {
    const chosenReplay = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    const closedReplay = await openByOpenReplay(harness)
    await harness.reader.close()
    const open = harness.reader.open.bind(harness.reader)
    let isFirstOpen = true
    harness.reader.open = async (...openArguments): Promise<void> => {
      if (isFirstOpen) {
        isFirstOpen = false
        throw new Error('The editor refused the arrangement.')
      }
      return open(...openArguments)
    }
    const drawn = recordDrawnTestReplays(harness.summary)

    // Act: the second replay's entry is refused, then the learner opens the workspace again.
    await harness.reader.openLearningReplay(chosenReplay.studyId)
    const drawnWhileRefused = [...drawn]
    await harness.reader.open()

    // Assert
    assert.deepEqual(
      {
        replay: harness.reader.inspect().view?.nodeHistory?.header.studyId,
        drawnWhileRefused: drawnWhileRefused.includes(closedReplay.studyId),
      },
      { replay: closedReplay.studyId, drawnWhileRefused: false },
    )
  } finally {
    await harness.close()
  }
})

for (const dropped of [
  {
    reason: 'the Study workspace is closed',
    prepare: async (harness: Harness): Promise<void> => {
      await harness.reader.close()
    },
    sentence:
      'the Study workspace is closed. Open Study Workspace, then choose it again.',
  },
  {
    reason: 'the Study workspace is closing',
    prepare: async (harness: Harness): Promise<void> => {
      harness.reader['closing'] = true
    },
    sentence:
      'the Study workspace is closing. Wait until it has closed, open it with Open Study Workspace, then choose it again.',
  },
  {
    reason: 'the Learning summary no longer shows a replay',
    prepare: async (harness: Harness): Promise<void> => {
      await harness.reader.action('return-current')
    },
    sentence:
      'the Learning summary no longer shows a replay. Choose it again from Saved studies in the Study workspace.',
  },
] as const) {
  // Value: protects=a Saved studies choice the Learning summary sends that the reader does not carry out telling the learner why in the words of that reason, in one notification and in one Output › Codebook entry; fails_when=the drop is recorded only in Output, or says the Study workspace is closed when it is closing or the summary left its replay (local open-code-review OCR-L4, Cycle 0056 pt3); why_new=task 17 recorded the drop but worded every reason as a closed workspace and showed the learner nothing; seam=workspaceHarness, the Learning summary view's listener, the harness's information messages, the diagnostics log; no_claim=the notification's look in the editor
  test(`a Saved studies choice from the Learning summary that is dropped because ${dropped.reason} is told in one notification and one Output entry`, async () => {
    // Arrange
    const harness = await workspaceHarness()
    const logged: CodebookDiagnostic[] = []
    harness.reader.diagnostics = {
      log: (entry) => logged.push(entry),
      show: () => undefined,
    }
    try {
      const history = await openByOpenReplay(harness)
      const revision = lastView(harness)!.revision
      // Other notices (a Close tells where the keyboard went) are not the drop's.
      const droppedNotices = (): string[] =>
        harness.informationMessages
          .map((notice) => notice.message)
          .filter((message) =>
            message.startsWith('Codebook did not carry out your choice'),
          )
      await dropped.prepare(harness)

      // Act
      harness.receive({
        type: 'node-history',
        revision,
        studyId: history.studyId,
        openRequest: 7,
      })
      await waitUntil(
        () => droppedNotices().length === 1,
        'the learner is told the choice was not carried out',
        READER_RESULT_BOUND_MS,
      )

      // Assert
      assert.deepEqual(
        {
          notices: droppedNotices(),
          entries: logged.map((entry) => entry.cause),
        },
        {
          notices: [
            `Codebook did not carry out your choice: ${dropped.sentence}`,
          ],
          entries: [
            `The "node-history" choice from the Learning summary was not carried out: ${dropped.sentence}`,
          ],
        },
      )
    } finally {
      harness.reader['closing'] = false
      await harness.close()
    }
  })
}

// Value: protects=an Application group the editor reports active later than the preparation's 150 ms wait: the open is refused with a report of the late activation, never a half-arranged reader; fails_when=the open succeeds with no report or ends in another failure, or the report no longer lists the group change the late activation caused (local open-code-review OCR-L2, Cycle 0056 pt3); why_new=task 17's test pinned only a report that arrives within the bound; seam=workspaceHarness with activateNewGroupLateAfterInsertion(600), the diagnostics log; no_claim=that Cursor ever reports later than the bound (N56 on 5b39b767 and 02acefaa: 13 opens, no refusal)
test('a test replay whose Application group the editor activates after the preparation’s wait is refused with a placement report', async () => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.activateNewGroupLateAfterInsertion(600)
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.open()

    // Act
    harness.receiveContext({
      type: 'node-history',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 ||
        logged.some((entry) => entry.surface === 'open:test-replay'),
      'the choice lands on the first stop or is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(
      logged.map((entry) => entry.surface),
      ['presentation:placement-refused', 'open:test-replay'],
    )
  } finally {
    await harness.close()
  }
})
