import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { studyHtml } from '../ui/studyHtml'
import * as terminalControls from '../utils/stripTerminalControls'

import {
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import {
  explainFirstStop,
  lastView,
  saveTwoStopNodeHistory,
} from './utils/twoStopNodeHistory'

// Value: protects=the Application pane of a test replay is one document per history: opening writes it once, each later moment reaches it as a posted view with a newer generation and that moment's time and output, and the result's view ends with the verdict; fails_when=a moment of the same history writes the document again (the learner's scroll, selection and focus there are lost), a moment posts no view, or a later view carries an older generation; why_new=EN3 replaces a document written per event; seam=none; no_claim=the document's own application of a view, which the Reader DOM check covers (stand-ins: the harness records the Application panel's document and posted views)
test('a test replay’s Application document is written once and each later moment is posted into it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    const documentAtOpen = application?.webview.html
    const updatesAtOpen = harness.applicationOutputs().length

    // Act
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 5,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 5,
      'the result is selected',
      READER_RESULT_BOUND_MS,
    )
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'previous',
      unit: 'event',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 4,
      'the second stop is selected',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.match(documentAtOpen ?? '', /<pre id="test-output"/)
    assert.equal(application?.webview.html, documentAtOpen)
    const atOpen = harness.applicationOutputs()[updatesAtOpen - 1]
    assert.equal(atOpen?.view.time, 'Recorded test output · 0.20 s')
    assert.deepEqual(
      atOpen?.view.lines.map((line) => line.text),
      ['RUN src/theme.test.ts'],
    )
    const later = harness.applicationOutputs().slice(updatesAtOpen)
    // Every later moment reaches the Application pane itself, not another pane (F126).
    assert.deepEqual(
      later.map((update) => update.panel),
      ['codebook.scopedBrowser', 'codebook.scopedBrowser'],
    )
    assert.deepEqual(
      later.map((update) => update.view.time),
      ['Recorded test output · 0.40 s', 'Recorded test output · 0.30 s'],
    )
    assert.equal(later[0]?.view.end, 'Test passed · exit code 0')
    assert.deepEqual(
      later[1]?.view.lines.map((line) => [line.channel, line.text]),
      [
        ['stdout', 'RUN src/theme.test.ts'],
        ['stderr', 'theme switched'],
      ],
    )
    assert.ok(
      (atOpen?.generation ?? 0) < (later[0]?.generation ?? 0) &&
        (later[0]?.generation ?? 0) < (later[1]?.generation ?? 0),
      'each later moment carries a newer generation',
    )
    // The Study views never carry the recorded output, which is the Application pane's alone.
    assert.equal(lastView(harness)?.nodeHistoryApplication, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=Previous stop and Next stop move from the selected event to the nearest stop, past outputs and the result, and a summary step's action selects its event and that step, which Next and Previous then leave for the event's first step; fails_when=a stop move lands on an output or the result, a chosen same-moment step is not shown, or a chosen step outlives a move; why_new=DS12 makes stop moves the transport's primary buttons and DS21 keeps the selected step apart from the event; seam=none; no_claim=the section's drawing, which the Reader DOM check covers
test('stop moves skip outputs and a summary step’s action selects its event and that step until the next move', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const sourceHash = history.configuration.source.hash
    await harness.service.explainNodeHistory({
      studyId: history.studyId,
      expectedRevision: 0,
      content: {
        question: 'Where does the test switch the theme?',
        title: 'Theme switch',
        summary: 'The test reads the next theme twice and passes.',
        participants: [
          { id: 'test', label: 'Theme test' },
          { id: 'theme', label: 'applyTheme' },
        ],
        steps: [
          {
            id: 'read',
            from: 'test',
            to: 'theme',
            label: 'Read the next theme',
            explanation: 'The first stop shows nextTheme is dark.',
            evidence: 'observed',
            reference: { type: 'stop', sequence: 2, sourceHash },
          },
          {
            id: 'keep',
            from: 'theme',
            to: 'theme',
            label: 'Keep the theme',
            explanation: 'applyTheme keeps the theme it read.',
            evidence: 'source-derived',
            reference: { type: 'stop', sequence: 2, sourceHash },
          },
        ],
      },
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.selectedStepId === 'read',
      'the saved material shows the stop’s first step',
      READER_RESULT_BOUND_MS,
    )

    // Act
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 2,
      stepId: 'keep',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.selectedStepId === 'keep',
      'the chosen step is shown',
      READER_RESULT_BOUND_MS,
    )
    const chosen = lastView(harness)?.nodeHistorySection
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 4,
      'Next stop reaches the second stop',
      READER_RESULT_BOUND_MS,
    )
    const atSecondStop = lastView(harness)?.nodeHistorySection
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'previous',
      unit: 'stop',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 2,
      'Previous stop returns to the first stop',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(chosen?.explanation, 'applyTheme keeps the theme it read.')
    assert.deepEqual(chosen?.sameMomentStepIds, ['read'])
    assert.equal(atSecondStop?.position, 'Stop 2 of 2 · 0.30 s')
    assert.equal(
      atSecondStop?.explanation,
      'No saved explanation for this stop.',
    )
    assert.equal(atSecondStop?.nextStop, false)
    assert.equal(lastView(harness)?.nodeHistorySection?.selectedStepId, 'read')
    assert.equal(
      lastView(harness)?.nodeHistorySection?.position,
      'Stop 1 of 2 · 0.20 s',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Study pane's test replay section tells the truth about the Application pane: once the learner closes the pane by hand the section says it is closed, and moving to another event still works with nothing posted into the closed pane; fails_when=the section keeps saying the output is in the Application pane after the close, the close publishes no new section, or a move with the pane closed reports an error or posts a view into the gone pane; why_new=PR-B1 wires DS7's closed-pane line to the workspace's own pane (projectNodeTestSection's test passes the flag by hand), and presentNodeHistoryApplication must not touch a pane that is gone; seam=none; no_claim=Show recorded output's restoring of the pane, which needs the native layout and which neither this test nor the Reader DOM check drives (stand-ins: the workspace harness's closeTabByHand (it closes the Application tab and tells the tab listeners), its posted messages and its recorded Application updates)
test('closing the Application pane makes the test replay section say so and moving on posts nothing into it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    const pointerWhileOpen = lastView(harness)?.nodeHistorySection?.pointer
    const updatesBeforeClose = harness.applicationOutputs().length

    // Act
    harness.closeTabByHand(application!.nativeTab)
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.applicationClosed === true,
      'the section says the Application pane is closed',
      READER_RESULT_BOUND_MS,
    )
    const whenClosed = lastView(harness)?.nodeHistorySection
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 4,
      'Next stop reaches the second stop',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      pointerWhileOpen,
      'Output up to this moment is in the Application pane.',
    )
    assert.equal(whenClosed?.pointer, 'The Application pane is closed.')
    assert.equal(
      lastView(harness)?.nodeHistorySection?.position,
      'Stop 2 of 2 · 0.30 s',
    )
    assert.equal(lastView(harness)?.errors.length, 0)
    assert.equal(harness.applicationOutputs().length, updatesBeforeClose)
  } finally {
    await harness.close()
  }
})

// Value: protects=Focus application builds a closed Application pane again only for a selected test replay: in a browser replay a pane the learner closed stays closed, as the replay owns its pane's lifecycle; fails_when=Focus application opens a new Application pane outside a test replay; why_new=Step 9 pass 2's testing review: pass 1b let focus-app rebuild a closed pane, and only a test replay's case was tested; seam=none; no_claim=what a browser replay shows after its pane closed (stand-ins: the workspace harness's closeTabByHand and its native panel list)
test('Focus application in a browser replay leaves an Application pane the learner closed closed', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const closedPane = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    harness.closeTabByHand(closedPane!.nativeTab)
    await waitUntil(
      () =>
        !harness
          .nativePanels()
          .some((panel) => panel.kind === 'codebook.scopedBrowser'),
      'the Application pane is closed',
      READER_RESULT_BOUND_MS,
    )

    // Act
    await harness.reader.action('focus-app')

    // Assert
    assert.equal(
      harness
        .nativePanels()
        .some((panel) => panel.kind === 'codebook.scopedBrowser'),
      false,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Show recorded output, the Study line under "The Application pane is closed.", brings a closed Application pane back with the selected moment's recorded output, so the learner who closed the pane by hand can read the output again without leaving the replay; fails_when=the button sends an action that needs all three Study panes (Restore Study arrangement fails with "The three retained Study panes are unavailable."), the action leaves the pane closed, or the new pane shows another moment's output or no output document; why_new=Step 7's coverage audit and Step 9's QA found the line's button bound to Restore, which cannot rebuild a closed pane (DS7); seam=none; no_claim=the native placement of the new pane, which the harness does not lay out (stand-ins: the workspace harness's closeTabByHand, its native panel list and the panel's recorded document)
test('Show recorded output brings a closed Application pane back at the selected moment', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const closedPane = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    harness.closeTabByHand(closedPane!.nativeTab)
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.applicationClosed === true,
      'the section says the Application pane is closed',
      READER_RESULT_BOUND_MS,
    )
    // The learner moves on while the pane is closed: the reopened pane shows this later moment.
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'stop',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 4,
      'Next stop reaches the second stop',
      READER_RESULT_BOUND_MS,
    )

    // Act
    // The Study line's button sends its data-action through the pane's action message, as a click does.
    harness.receiveContext({
      type: 'action',
      revision: lastView(harness)!.revision,
      action: 'focus-app',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.applicationClosed === false,
      'the section says the Application pane is back',
      READER_RESULT_BOUND_MS,
    )
    const reopened = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')

    // Assert
    assert.match(
      studyHtml('context'),
      /<div id="node-history-closed" class="row" hidden><button type="button" data-action="focus-app">Show recorded output<\/button><\/div>/,
    )
    assert.notEqual(reopened, undefined)
    assert.notEqual(reopened, closedPane)
    assert.match(reopened!.webview.html, /<pre id="test-output"/)
    assert.match(
      reopened!.webview.html,
      /<p id="test-output-time" class="status">Recorded test output · 0\.30 s<\/p>/,
    )
    assert.match(reopened!.webview.html, /theme switched/)
    assert.equal(
      lastView(harness)?.nodeHistorySection?.pointer,
      'Output up to this moment is in the Application pane.',
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 4)
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=leaving a test replay for Live releases the replay's output index with the rest of its selection, so a journal of up to 8 MiB (10,000 entries with their debugger snapshots) leaves the extension host's memory; fails_when=the index, which holds the whole history and a copy of its output lines, stays referenced after the selection is retired, until another test replay is opened; why_new=Step 9's performance review found the PR-B1 index cache outliving retireNodeHistorySelection; why_changed=F332 (PR-2 /ship Step 7 re-entry): the position map of F327 holds the history too and is released with it; seam=none; no_claim=when the garbage collector frees it (stand-ins: the workspace's private cache field, read through a type that names it)
test('returning to Live releases the test replay’s output index and event positions with its selection', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const cache = harness.reader as unknown as {
      selectedNodeHistoryOutputIndex?: unknown
      nodeHistoryPositions?: unknown
    }
    const indexWhileShown = cache.selectedNodeHistoryOutputIndex
    const positionsWhileShown = cache.nodeHistoryPositions

    // Act
    await harness.reader.action('return-current')
    await waitUntil(
      () => lastView(harness)?.nodeHistory === undefined,
      'the reader leaves the test replay',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.notEqual(indexWhileShown, undefined)
    assert.equal(cache.selectedNodeHistoryOutputIndex, undefined)
    assert.notEqual(positionsWhileShown, undefined)
    assert.equal(cache.nodeHistoryPositions, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=a step the learner chose stays only with its own moment: a seek or an Inspect that leaves the moment and comes back shows that moment's first step, as Previous stop and Next stop do (DS21); fails_when=the chosen step outlives the move and returns when the selection comes back to its event (the explanation of `keep` in place of `read`); why_new=Step 9's state-machines review found seek, Play and Inspect leaving the choice in place; seam=none; no_claim=Play's own pacing
test('a seek or an Inspect away from a chosen step and back shows the moment’s first step', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    await explainFirstStop(harness, history)
    /** Chooses `keep` on the first stop, as a click on its step action does. */
    const chooseKeep = async (): Promise<void> => {
      harness.receiveContext({
        type: 'node-history-event',
        revision: lastView(harness)!.revision,
        studyId: history.studyId,
        sequence: 2,
        stepId: 'keep',
      })
      await waitUntil(
        () => lastView(harness)?.nodeHistorySection?.selectedStepId === 'keep',
        'the chosen step is shown',
        READER_RESULT_BOUND_MS,
      )
    }
    /** Waits until the selection reaches an event. */
    const reach = (sequence: number, what: string) =>
      waitUntil(
        () =>
          lastView(harness)?.nodeHistoryPosition?.sequence === sequence &&
          !lastView(harness)?.loading,
        what,
        READER_RESULT_BOUND_MS,
      )
    await chooseKeep()

    // Act
    for (const positionMs of [300, 200]) {
      harness.receiveContext({
        type: 'node-history-playback',
        revision: lastView(harness)!.revision,
        studyId: history.studyId,
        action: 'seek',
        positionMs,
      })
      await reach(positionMs === 300 ? 4 : 2, `the seek to ${positionMs} ms`)
    }
    const afterSeeks = lastView(harness)?.nodeHistorySection?.selectedStepId
    await chooseKeep()
    for (const sequence of [4, 2]) {
      harness.receiveContext({
        type: 'node-history-stop',
        revision: lastView(harness)!.revision,
        studyId: history.studyId,
        sequence,
      })
      await reach(sequence, `Inspect stop ${sequence}`)
    }
    const afterInspects = lastView(harness)?.nodeHistorySection?.selectedStepId

    // Assert
    assert.equal(afterSeeks, 'read')
    assert.equal(afterInspects, 'read')
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection the reader refuses (a step's action naming an event the history does not hold) changes nothing the learner chose: the selected moment and the step chosen on it stay, and the refusal is said by name; fails_when=the chosen step is replaced before the selection commits, so the refused press shows another step of the same moment (here the stop's first step, `read`, in place of the chosen `keep`); why_new=Step 9's core and testing reviews found the step assigned before the selection was awaited; seam=none; no_claim=a selection superseded by a newer one, whose own choice then stands
test('a refused step action keeps the selected moment and the step the learner chose', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    await explainFirstStop(harness, history)
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 2,
      stepId: 'keep',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.selectedStepId === 'keep',
      'the chosen step is shown',
      READER_RESULT_BOUND_MS,
    )

    // Act
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 99,
      stepId: 'read',
    })
    await waitUntil(
      () => (lastView(harness)?.errors.length ?? 0) > 0,
      'the selection is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      lastView(harness)?.errors[0],
      'Error: The requested event of this test replay is unavailable.',
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
    assert.equal(lastView(harness)?.nodeHistorySection?.selectedStepId, 'keep')
    assert.equal(
      lastView(harness)?.nodeHistorySection?.explanation,
      'applyTheme keeps the theme it read.',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a step action whose native debugger presentation fails changes nothing the learner chose: the chosen step stays with its explanation, and the failure is said; fails_when=the chosen step is committed before the presentation settles, so a failed press shows the action's step (here `read` in place of the chosen `keep`); why_new=Step 9 pass 2's testing review: only a refusal before any await was tested, while the step is committed after the debugger and the reader position; seam=the workspace harness's held historical debug presentation, rejected as Run and Debug can fail; no_claim=the native debugger's own failure text
test('a step action whose debugger presentation fails keeps the step the learner chose', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    await explainFirstStop(harness, history)
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 2,
      stepId: 'keep',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.selectedStepId === 'keep',
      'the chosen step is shown',
      READER_RESULT_BOUND_MS,
    )
    const held = harness.holdHistoricalDebugPresentation(true)
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 2,
      stepId: 'read',
    })
    await held.started

    // Act
    held.reject(new Error('Run and Debug could not load the recorded values.'))
    await waitUntil(
      () => (lastView(harness)?.errors.length ?? 0) > 0,
      'the failed presentation is reported',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.match(
      lastView(harness)!.errors[0]!,
      /Run and Debug could not load the recorded values\./,
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
    assert.equal(lastView(harness)?.nodeHistorySection?.selectedStepId, 'keep')
    assert.equal(
      lastView(harness)?.nodeHistorySection?.explanation,
      'applyTheme keeps the theme it read.',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a step action overtaken before its stop is shown (its native presentation still loading) applies none of its step: a seek onto the same moment that overtakes it keeps the step the learner chose, and the overtaken press says nothing; fails_when=the overtaken action's step is committed or outlives it (the seek shows `read` in place of the chosen `keep`), or the superseded presentation is reported as an error; why_new=Step 9 pass 2's state-machines review (step-action × superseded): pass 1b passes the choice with its own selection, and no test overtook one; seam=the workspace harness's held historical debug presentation, rejected as superseded; no_claim=the other kinds of overtaken selection (Select event, Next and Previous, Play, Inspect), which share this path and are carried as tasks
test('a step action overtaken before its stop is shown leaves the step the learner chose', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    await explainFirstStop(harness, history)
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 2,
      stepId: 'keep',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.selectedStepId === 'keep',
      'the chosen step is shown',
      READER_RESULT_BOUND_MS,
    )
    const held = harness.holdHistoricalDebugPresentation(true)
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 2,
      stepId: 'read',
    })
    await held.started
    const requestsBeforeSeek = harness.reader['selectedNodeHistoryRequest']

    // Act: a seek onto the same moment overtakes the pending step action; once the seek's selection runs, the overtaken presentation ends as superseded.
    const seeking = harness.reader['nodeHistoryPlaybackController']!.seek(200)
    await waitUntil(
      () => harness.reader['selectedNodeHistoryRequest'] > requestsBeforeSeek,
      'the seek’s selection overtakes the step action',
      READER_RESULT_BOUND_MS,
    )
    held.reject(new Error('Historical debugger presentation was superseded.'))
    await seeking

    // Assert
    assert.equal(lastView(harness)?.nodeHistorySection?.selectedStepId, 'keep')
    assert.equal(
      lastView(harness)?.nodeHistorySection?.explanation,
      'applyTheme keeps the theme it read.',
    )
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a test replay that is opening keeps its loading line in the Application pane while a background render (Retry storage / refresh) settles in the middle of the open, and the pane ends on the replay's first moment; fails_when=the render's end reads as the open's end, so the pane says "No test output recorded up to this moment." of a replay whose first moment is still being shown, or keeps a loading line after the open; why_new=Step 9 pass 3's state-machines review (wrong row: the opening state read from the loading flag that renders share); seam=the workspace harness's held historical debug presentation, which keeps the open at its first stop; no_claim=the Study pane's own loading line
test('a render that settles while a test replay opens keeps its loading line until its first moment is shown', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    const held = harness.holdHistoricalDebugPresentation(true)
    const opening = harness.reader.openLearningReplay(history.studyId)
    await held.started
    const outputsBefore = harness.applicationOutputs().length

    // Act: a background render settles while the open waits for its first stop's debugger, then the open goes on.
    await harness.reader.action('retry')
    held.release()
    await opening
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    const posted = harness.applicationOutputs().slice(outputsBefore)
    assert.ok(
      posted.every(
        (update) =>
          update.view.placeholder !==
          'No test output recorded up to this moment.',
      ),
    )
    assert.doesNotMatch(
      application?.webview.html ?? '',
      /No test output recorded up to this moment\./,
    )
    assert.equal(
      posted.at(-1)?.view.time ??
        /Recorded test output · 0\.20 s/.exec(
          application?.webview.html ?? '',
        )?.[0],
      'Recorded test output · 0.20 s',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=while the selected moment of a test replay stays the same, building the Study message again (every 250 ms refresh publishes it) reuses the Application view and does not assemble the recorded output again; fails_when=each Study message projects the Application view anew, so a replay whose kept tail holds many short lines costs its whole assembly at every refresh (about 0.5 s for 65,536 lines, every 250 ms); why_new=/ship Step 11's Codex adversarial review with the carried F111; seam=none; no_claim=the cost of one assembly, which accumulateNodeTestOutput's tests bound
test('an unchanged moment of a test replay reuses its Application view at each Study message', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )

    // Act
    const first = harness.reader['message']().nodeHistoryApplication
    const second = harness.reader['message']().nodeHistoryApplication

    // Assert
    assert.ok(first)
    assert.equal(second, first)
  } finally {
    await harness.close()
  }
})

// Value: protects=a right-to-left override (U+202E) in a recorded test title, output entry or result tail reaches no replay surface: the Study section's event rows, the result's tail and the Application header read the same text in logical order as the output region; fails_when=the Study message's entries or the Application view's header lines still carry U+202E; why_new=F131 (only the output region was stripped); seam=none; no_claim=how the Study pane draws a row
test('a test replay’s Study message and Application header carry no bidirectional controls from the recording', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const header = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
      undefined,
      true,
    )
    await harness.reader.action('retry')

    // Act
    await harness.reader.openLearningReplay(header.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence !== undefined &&
        !lastView(harness)?.loading,
      'the test replay lands on its first event',
      READER_RESULT_BOUND_MS,
    )
    const message = lastView(harness)
    const application = harness.reader['message']().nodeHistoryApplication

    // Assert
    const entries = message?.nodeHistory?.entries ?? []
    const first = entries[0]
    assert.equal(
      first?.type === 'output' ? first.text : undefined,
      'RUN src/theme.test.ts\n',
    )
    const result = entries.find((entry) => entry.type === 'result')
    assert.equal(
      result?.type === 'result' ? result.outputTail.includes('\u202E') : true,
      false,
    )
    assert.deepEqual(message?.nodeHistory?.header.configuration.testTitles, [
      'suite title',
      'works',
    ])
    assert.equal(application?.test.includes('\u202E'), false)
    assert.equal(application?.name.includes('\u202E'), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=while another test replay is read, the replay still shown keeps its output: nothing is posted into its document (no empty lines, no scroll to the top, no lost selection), the loading line carries only the name of the replay being opened, and a failed open leaves the shown replay as it was; fails_when=the shown replay receives a loading view with its own name and no lines, or an open that fails posts anything into it; why_new=F143 and F150 (the opening marker was global, so the loading view was projected from the replay still selected); seam=none; no_claim=the Study pane's own loading state
test('opening another test replay leaves the shown replay’s output alone and names only the replay being opened', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const first = await saveTwoStopNodeHistory(store, [
      'first suite',
      'first works',
    ])
    const second = await saveTwoStopNodeHistory(store, [
      'second suite',
      'second works',
    ])
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(first.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === first.studyId &&
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the first test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const updatesBeforeFailure = harness.applicationOutputs().length

    // Act
    const read = store.read.bind(store)
    let failNextRead = true
    store.read = async (studyId) => {
      if (failNextRead && studyId === second.studyId) {
        failNextRead = false
        throw new Error('The replay could not be read.')
      }
      return read(studyId)
    }
    await harness.reader.openLearningReplay(second.studyId)
    const afterFailure = harness
      .applicationOutputs()
      .slice(updatesBeforeFailure)
    const updatesBeforeOpening = harness.applicationOutputs().length
    await harness.reader.openLearningReplay(second.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === second.studyId &&
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the second test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const whileOpening = harness
      .applicationOutputs()
      .slice(updatesBeforeOpening)

    // Assert
    assert.deepEqual(afterFailure, [])
    assert.ok(
      whileOpening.every((update) => !/first suite/.test(update.view.test)),
      'no view names the replay that was shown before',
    )
    assert.ok(
      whileOpening.every(
        (update) =>
          update.view.placeholder !== 'Loading recorded test output…' ||
          /second suite/.test(update.view.test),
      ),
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Application pane's presentation never throws into the reader when the pane's panel was disposed before the lease's release was seen: publish() runs inside catch and finally blocks and keeps going; fails_when=a write into the disposed panel ("Viewport lease is released" / "Webview is disposed") escapes publish(), so an open's error handling or finally block fails with it; why_new=F133: presentNodeHistoryApplication wrote the document unguarded; seam=the pane's document setter, made to throw as a disposed panel's does; no_claim=what a learner sees of a closed pane, which the section's Show recorded output line covers
test('publishing a test replay into a disposed Application panel does not throw', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    Object.defineProperty(application!.webview, 'html', {
      configurable: true,
      get: () => '',
      set: () => {
        throw new Error('Webview is disposed')
      },
    })
    const reader = harness.reader
    // The document is written again, as after a presentation change.
    reader['lastApplicationKey'] = undefined

    // Act
    const publishing = (): void => reader['publish']()

    // Assert
    assert.doesNotThrow(publishing)
  } finally {
    await harness.close()
  }
})

// Value: protects=a view the Application webview did not take (it answered `false`, as a webview that is reloading does) is posted again at the next publish, so the pane does not stay on an older moment until the moment changes; fails_when=the generation is recorded as shown before the post settles and never cleared, so no later publish posts the view again; why_new=F152: presentNodeHistoryApplication ignored the result of postMessage; why_changed=F300: the reader's own publishes (its refresh, the selection's commit) may post the refused view again before the test publishes, so the waits accept a second post that already happened instead of waiting for exactly one post, which a poll could miss for good; seam=the pane's postMessage, answering false once; no_claim=a hidden pane, which reloads from its restore copy and asks for the view itself
test('a view the Application webview did not take is posted again at the next publish', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')!
    const postMessage = application.webview.postMessage
    const attempts: number[] = []
    let refuseNext = true
    application.webview.postMessage = (message) => {
      if (message.type === 'node-history-output') {
        attempts.push(message.generation)
        if (refuseNext) {
          refuseNext = false
          return Promise.resolve(false)
        }
      }
      return postMessage(message)
    }

    // Act: the next event is posted and refused, then the reader publishes again without a new moment.
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 5,
    })
    await waitUntil(
      () => attempts.length >= 1,
      'the view is posted',
      READER_RESULT_BOUND_MS,
    )
    // The reader's own publishes may already have posted the refused view again; otherwise the refusal is forgotten first.
    await waitUntil(
      () =>
        attempts.length >= 2 ||
        harness.reader['shownNodeHistoryApplicationGeneration'] === undefined,
      'the refused view is forgotten or posted again',
      READER_RESULT_BOUND_MS,
    )
    harness.reader['publish']()

    // Assert
    assert.equal(attempts.length, 2)
    assert.equal(attempts[0], attempts[1])
  } finally {
    await harness.close()
  }
})

// Value: protects=the host files the learner's follow choice and scroll anchor under the replay the document shows and writes them into every document it writes for that replay (a presentation change, a Retry), ignores a report of another replay or a malformed one, and so a new document opens where the learner was and not where an earlier document's state left it; fails_when=the report is ignored (a rewritten pane follows the output again, F138), a report of another replay changes this replay's reading, or a malformed message throws; why_new=D22 moves the reading from the webview's state to the host; seam=none; no_claim=the document's own use of the reading, which the Reader DOM check covers
test('a rewritten Application document takes the learner’s reading the host filed, and a report of another replay changes nothing', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')!
    const reader = harness.reader

    // Act
    harness.receiveApplication({
      type: 'node-history-output-state',
      history: history.studyId,
      follow: false,
      anchor: { line: 3, offsetPx: 4 },
    })
    harness.receiveApplication({
      type: 'node-history-output-state',
      history: 'another-replay',
      follow: true,
    })
    harness.receiveApplication({ type: 'node-history-output-state', follow: 7 })
    reader['lastApplicationKey'] = undefined
    reader['publish']()

    // Assert
    assert.ok(
      application.webview.html.includes(
        '"reading":{"follow":false,"anchor":{"line":3,"offsetPx":4}}',
      ),
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the document's ready message is answered with the host's current view and reading when the document's view is older or its follow choice differs (VS Code reloaded the page in place from an earlier write), and with nothing when the document is current; fails_when=a reloaded document stays on an earlier moment until the next move, a current document is sent the view again, or a ready message of another replay is answered; why_new=F141; seam=none; no_claim=the document's drawing of the answer, which the Reader DOM check covers
test('a ready Application document that is behind is sent the current view and reading, one that is current is not', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 5,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 5,
      'the result is selected',
      READER_RESULT_BOUND_MS,
    )
    const current = harness.reader['message']().nodeHistoryApplication!
    const posted = harness.applicationOutputs().length

    // Act
    harness.receiveApplication({
      type: 'node-history-output-ready',
      history: history.studyId,
      generation: current.generation,
      follow: true,
    })
    const afterCurrent = harness.applicationOutputs().length
    harness.receiveApplication({
      type: 'node-history-output-ready',
      history: 'another-replay',
      generation: 0,
      follow: true,
    })
    const afterOther = harness.applicationOutputs().length
    harness.receiveApplication({
      type: 'node-history-output-ready',
      history: history.studyId,
      generation: current.generation - 1,
      follow: true,
    })

    // Assert
    assert.equal(afterCurrent, posted)
    assert.equal(afterOther, posted)
    const answer = harness.applicationOutputs().at(-1)
    assert.equal(harness.applicationOutputs().length, posted + 1)
    assert.equal(answer?.generation, current.generation)
    assert.equal(answer?.view.end, 'Test passed · exit code 0')
    assert.equal(JSON.stringify(answer?.reading), '{"follow":true}')
  } finally {
    await harness.close()
  }
})

// Value: protects=an open of another test replay that fails at its very start (its first publish throws, as a write into a released viewport lease can) ends its opening marker, so the replay still shown does not read as loading from then on; fails_when=the marker is set before the open's try and stays set, so every later moment of the shown replay posts "Loading recorded test output…" with no lines and removals stay refused; why_new=/ship Step 11's Claude adversarial review: a regression of 5359c28, which made the marker alone say that a replay opens; seam=the reader's publish, made to throw once; no_claim=why a publish throws, which F133 carries
test('an open that fails at its first publish leaves the shown test replay not loading', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const shown = await saveTwoStopNodeHistory(store)
    const other = await saveTwoStopNodeHistory(store)
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(shown.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the first test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const reader = harness.reader
    const publish = reader['publish'].bind(reader)
    let thrown = false
    reader['publish'] = (): void => {
      if (!thrown) {
        thrown = true
        throw new Error('Viewport lease is released')
      }
      publish()
    }

    // Act
    await reader.openLearningReplay(other.studyId).catch(() => undefined)
    reader['publish'] = publish

    // Assert
    assert.equal(thrown, true)
    assert.equal(reader['pendingNodeHistory'], undefined)
    assert.equal(
      reader['message']().nodeHistoryApplication?.placeholder,
      undefined,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a background render while a test replay is selected (Retry storage / refresh writes the Application document again) keeps the selected moment's output in the pane: the document is written with that moment and no loading view is posted; fails_when=the render's loading flag reads as the replay opening, so the pane shows "Loading recorded test output…" and loses its lines, the learner's scroll position and selection; why_new=Step 9 pass 2's state-machines review (source render × pending and settled): the opening flag's reason was untested; seam=none; no_claim=a render that fails or is superseded, which ends the same way and is carried as a task
test('a background render while a test replay is selected keeps its Application output', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const outputsBefore = harness.applicationOutputs().length

    // Act
    await harness.reader.action('retry')

    // Assert
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.match(
      application?.webview.html ?? '',
      /<p id="test-output-time" class="status">Recorded test output · 0\.20 s<\/p>/,
    )
    assert.doesNotMatch(
      application?.webview.html ?? '',
      /Loading recorded test output…<\/p>/,
    )
    assert.ok(
      harness
        .applicationOutputs()
        .slice(outputsBefore)
        .every(
          (update) =>
            update.view.placeholder !== 'Loading recorded test output…',
        ),
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a move to a stop or an event that does not exist (a press that raced ahead of the disabled button, or a keyboard repeat) is refused by name and changes nothing: Previous stop at the first stop and Next event at the result each leave one error line that names the move, and the selected moment, the step the learner chose and the Application pane stay as they were; fails_when=a refused move resets the chosen step (the explanation changes with no new moment), moves the selection, posts a view into the Application pane, says nothing, or names the wrong unit; why_new=PR-B1 adds the stop unit (DS12) and keeps the chosen step apart from the selected event (DS21), so the handler must refuse before it clears the choice; no test pressed a move past either end; seam=none; no_claim=the buttons' disabled state, which the Reader DOM check reads and which keeps a learner from pressing a move that does not exist
test('a move to a stop or event that does not exist is refused by name and keeps the moment, the chosen step and the Application pane', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    await explainFirstStop(harness, history)
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.selectedStepId === 'read',
      'the saved material shows the stop’s first step',
      READER_RESULT_BOUND_MS,
    )
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 2,
      stepId: 'keep',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.selectedStepId === 'keep',
      'the chosen step is shown',
      READER_RESULT_BOUND_MS,
    )
    const updatesAtFirstStop = harness.applicationOutputs().length

    // Act
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'previous',
      unit: 'stop',
    })
    await waitUntil(
      () => (lastView(harness)?.errors.length ?? 0) > 0,
      'the move before the first stop is refused',
      READER_RESULT_BOUND_MS,
    )
    const afterStopRefusal = lastView(harness)
    const updatesAfterStopRefusal = harness.applicationOutputs().length
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 5,
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 5,
      'the result is selected',
      READER_RESULT_BOUND_MS,
    )
    const updatesAtResult = harness.applicationOutputs().length
    harness.receiveContext({
      type: 'node-history-step',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      direction: 'next',
      unit: 'event',
    })
    await waitUntil(
      () =>
        lastView(harness)?.errors[0] ===
        'Error: There is no next event in this test replay.',
      'the move past the result is refused',
      READER_RESULT_BOUND_MS,
    )
    const afterEventRefusal = lastView(harness)

    // Assert
    // The reader builds its error lines in its own realm, so they are read as a count and strings.
    assert.equal(afterStopRefusal?.errors.length, 1)
    assert.equal(
      afterStopRefusal?.errors[0],
      'Error: There is no previous stop in this test replay.',
    )
    assert.equal(afterStopRefusal?.nodeHistoryPosition?.sequence, 2)
    assert.equal(
      afterStopRefusal?.nodeHistorySection?.position,
      'Stop 1 of 2 · 0.20 s',
    )
    assert.equal(afterStopRefusal?.nodeHistorySection?.selectedStepId, 'keep')
    assert.equal(
      afterStopRefusal?.nodeHistorySection?.explanation,
      'applyTheme keeps the theme it read.',
    )
    assert.equal(updatesAfterStopRefusal, updatesAtFirstStop)
    assert.equal(afterEventRefusal?.errors.length, 1)
    assert.equal(
      afterEventRefusal?.errors[0],
      'Error: There is no next event in this test replay.',
    )
    assert.equal(afterEventRefusal?.nodeHistoryPosition?.sequence, 5)
    assert.equal(
      afterEventRefusal?.nodeHistorySection?.position,
      'Result · Test passed · exit code 0 · 0.40 s',
    )
    assert.equal(harness.applicationOutputs().length, updatesAtResult)
  } finally {
    await harness.close()
  }
})

// Value: protects=opening another test replay never shows the learner a stale or false pane: while it opens, the Application pane never claims that no output was recorded and never empties the replay before (F150; the opening replay's own loading line is pinned by the test on F143), and the opened replay starts on its own first stop with that stop's first step, not the step the learner chose in the replay before even though both replays use the same step ids; fails_when=the pane empties the earlier replay or says no output was recorded while the replay opens, the opened replay shows the step chosen in the replay before (its explanation and its same-moment marks swap), or the pane does not end on the new replay's first moment; why_new=PR-B1 keeps the learner's chosen step in the workspace (DS21) and takes the pane's loading state from the workspace's opening flag (DS7), which the projection's own test passes by hand; why_changed=F301: a publish between the open's steps (the reader's refresh) posts the opening replay's loading line into that replay's own document, which the case counted as the earlier replay emptied, so it now tells each view by the document that received it and opens the replay while the reader publishes at every millisecond; seam=a publish timer standing for the reader's refresh, and the pane's postMessage, which records the replay of the document each view reached; no_claim=the loading line's drawing in the document (the Reader DOM check) or a replay opened while a browser replay is shown, which the host refuses
test('opening another test replay starts on its own first step, not the step chosen before, and files its document under itself', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const first = await saveTwoStopNodeHistory(store)
    const second = await saveTwoStopNodeHistory(store)
    await explainFirstStop(harness, first)
    await explainFirstStop(harness, second)
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(first.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === first.studyId &&
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        lastView(harness)?.nodeHistorySection?.selectedStepId === 'read' &&
        !lastView(harness)?.loading,
      'the first test replay lands on its first stop and its first step',
      READER_RESULT_BOUND_MS,
    )
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: first.studyId,
      sequence: 2,
      stepId: 'keep',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.selectedStepId === 'keep',
      'the step chosen in the first replay is shown',
      READER_RESULT_BOUND_MS,
    )
    const updatesBeforeOpening = harness.applicationOutputs().length
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')!
    // Each view the pane receives is recorded with the replay whose document it reached, as that document's options name it.
    const received: {
      document: string | undefined
      lines: number
      placeholder: string | undefined
    }[] = []
    const postMessage = application.webview.postMessage
    application.webview.postMessage = (message) => {
      if (message.type === 'node-history-output')
        received.push({
          document: /"history":"([^"]+)"/.exec(application.webview.html)?.[1],
          lines: message.view.lines.length,
          placeholder: message.view.placeholder,
        })
      return postMessage(message)
    }

    // Act: the reader publishes at every millisecond while the second replay opens, as its refresh can between any two steps of the open.
    const refresh = setInterval(() => harness.reader['publish'](), 1)
    try {
      await harness.reader.openLearningReplay(second.studyId)
    } finally {
      clearInterval(refresh)
    }
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === second.studyId &&
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the second test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const whileOpening = harness
      .applicationOutputs()
      .slice(updatesBeforeOpening)

    // Assert
    // The replay still shown is not emptied while the second opens (F150); the second replay's own document may read its loading line.
    assert.deepEqual(
      received.filter(
        (update) => update.document === first.studyId && update.lines === 0,
      ),
      [],
    )
    // No document says that no output was recorded while the replay opens.
    assert.deepEqual(
      received.filter(
        (update) =>
          update.placeholder === 'No test output recorded up to this moment.',
      ),
      [],
    )
    // The document is written again for the second replay, so the learner's follow choice and kept moment are filed under it, not the first (DS20).
    assert.ok(
      (application?.webview.html ?? '').includes(
        `"history":"${second.studyId}"`,
      ),
    )
    assert.equal(
      whileOpening.at(-1)?.view.time,
      'Recorded test output · 0.20 s',
    )
    assert.deepEqual(
      whileOpening.at(-1)?.view.lines.map((line) => line.text),
      ['RUN src/theme.test.ts'],
    )
    assert.equal(lastView(harness)?.nodeHistorySection?.selectedStepId, 'read')
    assert.equal(
      lastView(harness)?.nodeHistorySection?.explanation,
      'The first stop shows nextTheme is dark.',
    )
    assert.deepEqual(lastView(harness)?.nodeHistorySection?.sameMomentStepIds, [
      'keep',
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=the cost of opening a test replay: its recorded output is stripped of terminal controls once, for the history its surfaces print, and the output index reads that shown text without stripping it again; fails_when=the index strips the already-shown output a second time, a pass over up to 8 MiB of output on the extension host at every open; why_new=F315 (PR-2 /ship Step 9 performance): the Study workspace indexed the sanitized history with the index's own strip; seam=the stripping module's cross-entry export, counted; no_claim=the strip's own result (stripTerminalControls' tests)
test('opening a test replay strips its recorded output once, not again for its output index', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    const strip = context.mock.method(
      terminalControls,
      'stripTerminalControlsAcross',
    )

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )

    // Assert: one pass, one stream per channel (standard output and standard error).
    assert.equal(strip.mock.callCount(), 2)
  } finally {
    await harness.close()
  }
})

// Value: protects=a reloaded Application document that reads away from the end gets the learner's latest place back even when its view is current: the host answers its ready message with the reading that holds the newest anchor; fails_when=the host answers only a document whose view is older or whose follow choice differs, so a document VS Code reloaded from an earlier write opens at that write's anchor, not where the learner scrolled since; why_new=F343 (PR-2 /ship Step 11: Claude adversarial, Codex adversarial and Codex structured review): the ready check compared the generation and the follow choice, never the anchor; seam=none; no_claim=a document that follows, which takes no anchor
test('a ready Application document that reads away from the end is sent the host’s newest anchor, also when its view is current', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveTwoStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the test replay lands on its first stop',
      READER_RESULT_BOUND_MS,
    )
    const current = harness.reader['message']().nodeHistoryApplication!
    // The learner scrolled away from the end, to line 9, after the document was written.
    harness.receiveApplication({
      type: 'node-history-output-state',
      history: history.studyId,
      follow: false,
      anchor: { line: 9, offsetPx: 3 },
    })
    const posted = harness.applicationOutputs().length

    // Act: the reloaded document reports the current view and not following.
    harness.receiveApplication({
      type: 'node-history-output-ready',
      history: history.studyId,
      generation: current.generation,
      follow: false,
    })

    // Assert
    const answer = harness.applicationOutputs().at(-1)
    assert.equal(harness.applicationOutputs().length, posted + 1)
    assert.equal(answer?.generation, current.generation)
    assert.equal(
      JSON.stringify(answer?.reading),
      '{"follow":false,"anchor":{"line":9,"offsetPx":3}}',
    )
  } finally {
    await harness.close()
  }
})
