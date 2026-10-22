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

// Value: protects=the Application pane of a test replay is one document per history: opening writes it once, each later moment reaches it as a posted view with a newer generation and that moment's time and output, and the result's view ends with the verdict; fails_when=a moment of the same history writes the document again (the learner's scroll, selection and focus there are lost), a moment posts no view, or a later view carries an older generation; why_new=EN3 replaces a document written per event; seam=the harness records the Application panel's document and posted views; no_claim=the document's own application of a view, which the Reader DOM check covers
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
