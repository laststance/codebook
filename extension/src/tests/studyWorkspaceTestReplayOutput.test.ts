import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import type { NodeTestSourceStop } from '../ownedNodeTestRun'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { workspaceHarness } from './studyWorkspaceHarness'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

const SOURCE_TEXT = 'const nextTheme = "dark";\n'

/** The last view the reader posted to its panes. */
function lastView(harness: Awaited<ReturnType<typeof workspaceHarness>>) {
  return harness.postedMessages().slice(-1)[0]
}

/**
 * Saves a sealed test replay of two stops with output before and between them and a passing result: output 1, stop 2, output 3, stop 4, result 5.
 * @param store - The workspace's history store.
 * @returns The history's header.
 * @example const history = await saveTwoStopNodeHistory(harness.service.nodeHistoryStore!)
 */
async function saveTwoStopNodeHistory(store: NodeTestHistoryStore) {
  const oneStop = nodeTestHistoryHeader(store.workspaceKey)
  // The second stop is declared at the same line, as a loop's second pass stops there again.
  const configuration = {
    ...oneStop.configuration,
    additionalStops: [
      {
        ...oneStop.configuration.source,
        anchorIndex: 0,
        inspections: oneStop.configuration.inspections,
      },
    ],
  }
  const history = {
    ...oneStop,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
  }
  const writer = await store.start(history)
  const stopAt = (index: number, elapsedMs: number): NodeTestSourceStop => ({
    index,
    runId: 'test-run',
    sessionId: 'test-session',
    threadId: 1,
    elapsedMs,
    worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
    source: history.configuration.source,
    frame: { id: index + 1, name: 'applyTheme', line: 1, column: 1 },
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
            name: history.configuration.source.path,
            text: SOURCE_TEXT,
            hash: sha256(SOURCE_TEXT),
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
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 100,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts\n',
  })
  await writer.appendStop(stopAt(0, 200))
  await writer.appendOutput({
    sequence: 2,
    elapsedMs: 250,
    channel: 'stderr',
    text: 'theme switched\n',
  })
  await writer.appendStop(stopAt(1, 300))
  await writer.appendResult(
    { exitCode: 0, signal: null, output: 'Tests 1 passed' },
    400,
  )
  await writer.finish('complete')
  return history
}

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
      2_000,
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
      2_000,
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
      2_000,
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
      2_000,
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
      2_000,
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
      2_000,
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
      2_000,
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
      2_000,
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
      2_000,
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
      2_000,
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
      2_000,
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

/**
 * Saves learning material that explains a two-stop test replay's first stop (sequence 2) with two steps, so the stop shows `read` first and `keep` once the learner chooses it; the replay's step ids repeat from one replay to the next, as a chat's explanations of two runs of one test do.
 * @param harness - The workspace harness whose service saves the material.
 * @param history - The replay's header, as {@link saveTwoStopNodeHistory} returns it.
 * @example await explainFirstStop(harness, history)
 */
async function explainFirstStop(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  history: Awaited<ReturnType<typeof saveTwoStopNodeHistory>>,
): Promise<void> {
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
}

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
      2_000,
    )
    await explainFirstStop(harness, history)
    await waitUntil(
      () => lastView(harness)?.nodeHistorySection?.selectedStepId === 'read',
      'the saved material shows the stop’s first step',
      2_000,
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
      2_000,
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
      2_000,
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
      2_000,
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
        'Error: There is no next event in this Node history.',
      'the move past the result is refused',
      2_000,
    )
    const afterEventRefusal = lastView(harness)

    // Assert
    // The reader builds its error lines in its own realm, so they are read as a count and strings.
    assert.equal(afterStopRefusal?.errors.length, 1)
    assert.equal(
      afterStopRefusal?.errors[0],
      'Error: There is no previous stop in this Node history.',
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
      'Error: There is no next event in this Node history.',
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

// Value: protects=opening another test replay never shows the learner a stale or false pane: while it opens, the Application pane says the output is loading instead of keeping the replay before or claiming that no output was recorded, and the opened replay starts on its own first stop with that stop's first step, not the step the learner chose in the replay before even though both replays use the same step ids; fails_when=the pane keeps the earlier replay's output or says no output was recorded while the replay opens, the opened replay shows the step chosen in the replay before (its explanation and its same-moment marks swap), or the pane does not end on the new replay's first moment; why_new=PR-B1 keeps the learner's chosen step in the workspace (DS21) and takes the pane's loading state from the workspace's opening flag (DS7), which the projection's own test passes by hand; seam=none; no_claim=the loading line's drawing in the document (the Reader DOM check) or a replay opened while a browser replay is shown, which the host refuses
test('opening another test replay shows its loading line first and starts on its own first step, not the step chosen before', async () => {
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
      2_000,
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
      2_000,
    )
    const updatesBeforeOpening = harness.applicationOutputs().length

    // Act
    await harness.reader.openLearningReplay(second.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === second.studyId &&
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the second test replay lands on its first stop',
      2_000,
    )
    const whileOpening = harness
      .applicationOutputs()
      .slice(updatesBeforeOpening)
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')

    // Assert
    assert.equal(whileOpening[0]?.view.state, 'loading')
    assert.equal(
      whileOpening[0]?.view.placeholder,
      'Loading recorded test output…',
    )
    assert.deepEqual(whileOpening[0]?.view.lines, [])
    assert.match(
      application?.webview.html ?? '',
      /<p id="test-output-placeholder" class="muted">Loading recorded test output…<\/p>/,
    )
    assert.equal(whileOpening.at(-1)?.view.state, 'event')
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
