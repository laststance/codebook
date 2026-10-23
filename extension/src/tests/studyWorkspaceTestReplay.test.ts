import assert from 'node:assert/strict'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { NODE_TEST_HISTORY_DIRECTORY, NODE_TEST_PROFILE } from '../constants'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import type { NodeTestSourceStop } from '../ownedNodeTestRun'
import type { NodeTestRuntime } from '../runtime'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import {
  readerSeams,
  recordedReaderHarness,
  saveOneStopNodeHistory,
  workspaceHarness,
} from './studyWorkspaceHarness'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'

/** The last view the reader posted to its panes. */
function lastView(harness: Awaited<ReturnType<typeof workspaceHarness>>) {
  return harness.postedMessages().slice(-1)[0]
}

/**
 * Builds a fake owned Node run with two declared stops and a passing result, as a live test run the workspace's Save acts on.
 * @param source - The cited source of both stops.
 * @param sourceText - The cited source's text, which each stop's debugger snapshot holds so the stop verifies.
 * @returns The run, which pauses at its first stop and reaches the second one when it advances.
 * @example const run = twoStopOwnedRun(configuration.source, sourceText)
 */
function twoStopOwnedRun(
  source: NodeTestConfiguration['source'],
  sourceText: string,
): NodeTestRuntime {
  const stops = [0, 1].map(
    (index) =>
      ({
        index,
        runId: 'node-run',
        sessionId: 'owned-session',
        threadId: 7,
        elapsedMs: 10 + index * 10,
        worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
        source,
        frame: {
          id: 10 + index,
          name: 'schedule',
          line: source.line,
          column: source.column,
        },
        variables: [{ name: 'delayMs', value: '5000', variablesReference: 0 }],
        facts: [
          { path: 'delayMs', mode: 'value', display: '5000', type: 'number' },
        ],
        debuggerSnapshot: {
          version: 1,
          frames: [
            {
              name: 'schedule',
              line: source.line,
              column: source.column,
              source: {
                name: source.path,
                text: sourceText,
                hash: sha256(sourceText),
                line: source.line,
              },
              scopes: [{ name: 'Local', variables: [0] }],
            },
          ],
          variables: [
            { name: 'delayMs', value: '5000', type: 'number', children: [] },
          ],
          limitations: [],
        },
      }) satisfies NodeTestSourceStop,
  )
  let cursor = 0
  return {
    id: 'node-run',
    async prepare() {
      return stops[cursor]!
    },
    hasNextStop() {
      return cursor < stops.length - 1
    },
    async advance() {
      return stops[++cursor]!
    },
    async complete() {
      return {
        exitCode: 0,
        signal: null,
        output: 'Tests 1 passed',
        elapsedMs: 40,
      }
    },
    async stop(): Promise<void> {},
  }
}

// Value: protects=Open replay of a sealed test replay while the Study pane is closed: the pane opens and the replay lands on its first verified stop with the replay debugger presented; fails_when=Open replay goes to the browser replay's controller, the closed pane stays closed, or the replay lands on the output banner; why_new=Open replay opened only browser recordings (C49-2, DS1, DS10, AC4); seam=the editor and the debugger are fakes; no_claim=the host's own pane arrangement (N49)
test('Open replay opens a sealed test replay in a closed Study pane on its first verified stop', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === history.studyId &&
        !lastView(harness)?.loading,
      'the test replay is shown',
      2_000,
    )

    // Assert
    assert.equal(harness.reader.inspect().view?.nodeHistory?.status, 'complete')
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
    assert.equal(harness.historicalDebugPresentations.length, 1)
    assert.equal(harness.service.playbackController?.state().studyId, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=a test replay's saved reader position, which wins over the landing on its first verified stop, and the replay debugger that opens on that moment with no recorded stack; fails_when=a replay the learner left on its result reopens on a stop, or opens with no "Not recorded at this moment" thread or with a stop's frames; why_new=DS1 keeps the saved position first (AC4); PR-B2 (Design 4) starts the debugger on the "Not recorded" thread when a replay opens on an output or the result; seam=none; no_claim=a position saved in another window
test('Open replay opens a test replay at its saved reader position', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await store.saveReaderPosition(history.studyId, 3)
    await harness.reader.action('retry')

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === history.studyId &&
        !lastView(harness)?.loading,
      'the test replay is shown',
      2_000,
    )

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 3)
    assert.deepEqual(
      harness.historicalDebugPresentations.map(({ snapshot, label }) => ({
        snapshot,
        label,
      })),
      [{ snapshot: undefined, label: 'Not recorded at this moment' }],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the landing of a test replay without a verified stop: its first event, with the debugger on the "Not recorded at this moment" thread; fails_when=the open selects an unverified stop and presents another moment's source; why_new=DS1's fallback (AC4); PR-B2 (Design 4) starts the debugger on the "Not recorded" thread at such a moment; seam=a stop whose captured text was edited after the seal; no_claim=none beyond protects
test('a test replay whose stop does not verify opens on its first event', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    const read = NodeTestHistoryStore.prototype.read
    // The stop's captured text no longer hashes to its sealed hash.
    context.mock.method(
      store,
      'read',
      async function (this: NodeTestHistoryStore, studyId: string) {
        const index = await read.call(this, studyId)
        return {
          ...index,
          entries: index.entries.map((entry) =>
            entry.type === 'stop'
              ? {
                  ...entry,
                  debuggerSnapshot: {
                    ...entry.debuggerSnapshot,
                    frames: entry.debuggerSnapshot.frames.map((frame) => ({
                      ...frame,
                      source: frame.source && {
                        ...frame.source,
                        text: 'const nextTheme = "light";\n',
                      },
                    })),
                  },
                }
              : entry,
          ),
        }
      },
    )
    await harness.reader.action('retry')

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === history.studyId &&
        !lastView(harness)?.loading,
      'the test replay is shown',
      2_000,
    )

    // Assert
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 1)
    assert.deepEqual(
      harness.historicalDebugPresentations.map(({ snapshot, label }) => ({
        snapshot,
        label,
      })),
      [{ snapshot: undefined, label: 'Not recorded at this moment' }],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=Open retained history after a failed seal: the recorded part of the test history opens read-only as an interrupted history, on its recorded stop; fails_when=the unsealed prefix cannot be opened, or opens as if the run were still recording; why_new=X6's Open retained history (AC3, AC4); seam=the history's writer is abandoned after its stop, as the service abandons it when the seal throws; no_claim=a journal no read can verify, which the load-failure test covers
test('Open retained history opens the recorded part of a test history whose seal failed, read-only', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = nodeTestHistoryHeader(store.workspaceKey),
      sourceText = 'const nextTheme = "dark";\n'
    const writer = await store.start(history)
    await writer.appendOutput({
      sequence: 1,
      elapsedMs: 100,
      channel: 'stdout',
      text: 'RUN src/theme.test.ts\n',
    })
    await writer.appendStop({
      index: 0,
      runId: 'test-run',
      sessionId: 'test-session',
      threadId: 1,
      elapsedMs: 200,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
      source: history.configuration.source,
      frame: { id: 1, name: 'notifyManager', line: 1, column: 1 },
      variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
      facts: [
        { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
      ],
      debuggerSnapshot: {
        version: 1,
        frames: [
          {
            name: 'notifyManager',
            line: 1,
            column: 1,
            source: {
              name: history.configuration.source.path,
              text: sourceText,
              hash: sha256(sourceText),
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
    // The seal threw: the service abandons the writer, and its journal stays an unsealed prefix.
    writer.abandon()
    await harness.reader.action('retry')

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === history.studyId &&
        !lastView(harness)?.loading,
      'the retained history is shown',
      2_000,
    )

    // Assert
    assert.equal(
      harness.reader.inspect().view?.nodeHistory?.status,
      'interrupted',
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
    assert.deepEqual(harness.errorMessages, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=Open replay of a test replay during a browser replay: one notification that one replay shows at a time, with Close browser replay, and nothing opened while the learner keeps the browser replay; fails_when=the test replay opens over the browser replay or the refusal is silent; why_new=the refusal was an error line in the pane only (DS10, AC4); seam=the learner dismisses the notification; no_claim=the host's notification look
test('Open replay of a test replay during a browser replay tells the learner one replay shows at a time', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    const warningsBefore = harness.warningDialogs.length

    // Act
    await harness.reader.openLearningReplay(nodeHistory.studyId)

    // Assert
    const warnings = harness.warningDialogs.slice(warningsBefore)
    assert.equal(warnings.length, 1)
    assert.equal(
      warnings[0]?.title,
      'Codebook shows one replay at a time. Close the browser replay to open this test replay.',
    )
    assert.equal(harness.reader.inspect().view?.nodeHistory, undefined)
    assert.equal(harness.controller.state().studyId, harness.studyId)
  } finally {
    await harness.close()
  }
})

// Value: protects=Retry pressed while a browser replay holds the reader leaves the shared debugger and source with that replay: it never presents the stop of a test replay that was selected before the recording opened; fails_when=Retry re-selects the earlier test replay's moment, which puts its recorded stop on the shared debugger beside the browser replay's frame; why_new=/ship Step 11 (Codex structured review P2: Retry bypassed the browser replay's refusal); seam=none; no_claim=what Retry does for the browser replay's own rows
test('Retry during a browser replay presents no stop of the test replay selected before it', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(nodeHistory.studyId)
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 2,
      'the test replay on its stop',
      2_000,
    )
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    const testStopPresentations = () =>
      harness.historicalDebugPresentations.filter((presentation) =>
        presentation.label.startsWith('Recorded test stop'),
      ).length
    const presentationsBeforeRetry = testStopPresentations()

    // Act
    await harness.reader.action('retry')

    // Assert
    assert.equal(testStopPresentations(), presentationsBeforeRetry)
    assert.equal(harness.controller.state().studyId, harness.studyId)
  } finally {
    await harness.close()
  }
})

// Value: protects=the status bar's Save learning replay item of a live test run while the Study pane was never opened, the usual state of a chat-driven test run; fails_when=the item is drawn only when the reader publishes, so it stays hidden until the learner opens the Study pane and Save learning replay cannot be clicked; why_new=the live Save test opens the reader first (Red Team, Step 9 of PR-A's ship); seam=none; no_claim=the host's status bar drawing (the harness's status item stands in)
test('the Save item of a live test run is drawn in the status bar while the Study pane is closed', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const { service, configuration } = harness
    const sourceText = await readFile(
      join(harness.directory, configuration.source.path),
      'utf8',
    )
    service.environment.build.sourceHash = 'f'.repeat(64)
    service.environment.createNodeTestRun = async () =>
      twoStopOwnedRun(configuration.source, sourceText)
    // The start's idempotency key, named by what this run is for.
    const runName = 'closed-pane-save-item'
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: NODE_TEST_PROFILE,
      key: runName,
      configuration: {
        version: 1,
        adapter: 'vitest-node',
        book: configuration.book,
        testFile: 'src/scheduler.test.ts',
        testHash: 'a'.repeat(64),
        testTitles: ['job scheduler', 'runs a delayed job after its timer'],
        source: configuration.source,
        inspections: configuration.inspections.slice(0, 1),
        additionalStops: [
          {
            ...configuration.source,
            anchorIndex: 0,
            inspections: configuration.inspections.slice(0, 1),
          },
        ],
      },
    })
    const record = service.record(receipt)
    await record.preparation
    const studyId = `${service.instanceId}_${record.id}`

    // Act
    await readerSeams(harness).refresh()

    // Assert
    assert.equal(harness.reader.inspect().opened, false)
    assert.deepEqual(
      {
        text: harness.saveStatus.text,
        command: structuredClone(harness.saveStatus.command),
      },
      {
        text: '$(record) Recording explanation · stop 1 of 2 · Save learning replay',
        command: {
          title: 'Save learning replay',
          command: 'codebook.saveLearningReplay',
          arguments: [studyId],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's answer Close browser replay to the one-replay-at-a-time notice: the browser replay closes and the test replay opens in its place; fails_when=the answer closes nothing, or the test replay stays unopened after the browser replay closed; why_new=the refusal test only dismisses the notice (DS10, AC4); seam=none; no_claim=the host's notification look (the learner's answer is scripted)
test('choosing Close browser replay in the one-replay-at-a-time notice closes the browser replay and opens the test replay', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    const nodeHistory = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      2_000,
    )
    harness.answerWarningDialogs(async () => 'Close browser replay')

    // Act
    await harness.reader.openLearningReplay(nodeHistory.studyId)

    // Assert
    assert.equal(
      harness.reader.inspect().view?.nodeHistory?.header.studyId,
      nodeHistory.studyId,
    )
    assert.equal(harness.controller.state().studyId, undefined)
    assert.deepEqual(harness.errorMessages, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a test replay whose history cannot be read: the load-failure notification names the replay and its cause, and one Output › Codebook entry is written; fails_when=the failure is silent outside the pane, names no replay, or writes no entry; why_new=X4 (AC4, AC17); seam=a journal edited after its seal; no_claim=Show details, which the notification's button runs
test('a test replay whose history cannot be read raises the load-failure notification and writes an Output entry', async () => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await harness.reader.action('retry')
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
    assert.equal(harness.errorMessages.length, 1)
    assert.match(
      harness.errorMessages[0]!,
      /^Codebook could not open the test replay "src\/theme\.test\.ts": .*Sealed Node history journal is corrupt.*\. The saved history is unchanged; open it again from Saved studies\.$/,
    )
    assert.deepEqual(
      logged.map((entry) => [entry.surface, entry.studyId, entry.profile]),
      [['open:test-replay', history.studyId, 'node-test']],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=one request counter for host and pane opens (EN19): a pane open sent while a host open still reads its history wins, and a double click shows one replay; fails_when=the earlier open's writes land after the later one and the reader shows the first history; why_new=a host open is new beside the pane's node-history message (EN19, AC4); seam=the store's read of the first history is held; no_claim=an open during Play (PR-B2)
test('a pane open sent while a host open still reads its history wins, and a double click shows one replay', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const first = await saveOneStopNodeHistory(store)
    const second = await saveOneStopNodeHistory(store)
    await harness.reader.open()
    await harness.reader.action('retry')
    const read = NodeTestHistoryStore.prototype.read
    let releaseFirst!: () => void
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    context.mock.method(
      store,
      'read',
      async function (this: NodeTestHistoryStore, studyId: string) {
        if (studyId === first.studyId) await firstHeld
        return read.call(this, studyId)
      },
    )

    // Act
    const hostOpen = harness.reader.openLearningReplay(first.studyId)
    const doubleClick = harness.reader.openLearningReplay(first.studyId)
    await readerSeams(harness).receive(
      {
        type: 'node-history',
        revision: lastView(harness)!.revision,
        studyId: second.studyId,
      },
      'context',
    )
    releaseFirst()
    await Promise.all([hostOpen, doubleClick])

    // Assert
    assert.equal(
      harness.reader.inspect().view?.nodeHistory?.header.studyId,
      second.studyId,
    )
    assert.equal(lastView(harness)?.loading, false)
    assert.deepEqual(harness.errorMessages, [])
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=Save of a live test run in the real workspace: live item, modal question, Save now ending the run, partial item, and the notice's Open replay showing the replay; fails_when=the question is not modal, Save now leaves the run running, the item is not redrawn or Open replay shows no replay; why_new=NodeLearningSave tests use a fake host and no test joins it to the workspace (C49-2, AC3, AC4); seam=none; no_claim=the host's dialogs and status bar (a fake owned Node run and fake editor stand in)
test('Save learning replay of a live test run asks first, ends the run on Save now, and its partial notice opens the test replay', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await harness.reader.open()
    const { service, configuration } = harness
    const sourceText = await readFile(
      join(harness.directory, configuration.source.path),
      'utf8',
    )
    service.environment.build.sourceHash = 'f'.repeat(64)
    service.environment.createNodeTestRun = async () =>
      twoStopOwnedRun(configuration.source, sourceText)
    // The start's idempotency key, named by what this run is for.
    const runName = 'save-flow'
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: NODE_TEST_PROFILE,
      key: runName,
      configuration: {
        version: 1,
        adapter: 'vitest-node',
        book: configuration.book,
        testFile: 'src/scheduler.test.ts',
        testHash: 'a'.repeat(64),
        testTitles: ['job scheduler', 'runs a delayed job after its timer'],
        source: configuration.source,
        inspections: configuration.inspections.slice(0, 1),
        additionalStops: [
          {
            ...configuration.source,
            anchorIndex: 0,
            inspections: configuration.inspections.slice(0, 1),
          },
        ],
      },
    })
    const record = service.record(receipt)
    await record.preparation
    const studyId = `${service.instanceId}_${record.id}`
    // The learner answers the modal question with Save now, and the partial notice with Open replay.
    let itemWhenNoticeAppeared: string | undefined
    harness.answerWarningDialogs(async (items) => {
      if (items.includes('Save now')) return 'Save now'
      itemWhenNoticeAppeared = harness.saveStatus.text
      return 'Open replay'
    })
    await readerSeams(harness).refresh()
    const liveItem = {
      text: harness.saveStatus.text,
      command: structuredClone(harness.saveStatus.command),
    }

    // Act
    await harness.reader.saveLearningReplay(studyId)
    await waitUntil(
      () =>
        harness.reader.inspect().view?.nodeHistory?.header.studyId ===
          studyId && !harness.reader.inspect().view?.loading,
      'the partial test replay is shown',
      2_000,
    )

    // Assert
    assert.deepEqual(liveItem, {
      text: '$(record) Recording explanation · stop 1 of 2 · Save learning replay',
      command: {
        title: 'Save learning replay',
        command: 'codebook.saveLearningReplay',
        arguments: [studyId],
      },
    })
    assert.equal(
      harness.warningDialogs[0]?.title,
      'Saving ends the test run before its result (1 of 2 stops reached). Save now?',
    )
    assert.equal(
      JSON.stringify(harness.warningDialogs[0]?.options),
      '{"modal":true}',
    )
    assert.equal(record.stopped, true)
    assert.equal(
      itemWhenNoticeAppeared,
      '$(warning) Learning partially saved · Open replay',
    )
    assert.equal(
      harness.saveStatus.text,
      '$(warning) Learning partially saved · Open replay',
    )
    assert.equal(
      harness.saveStatus.tooltip,
      'Saved available learning · No result recorded · Missing: learning summary and sequence, an explanation step for stop 1, complete execution evidence. Open replay to inspect retained evidence.',
    )
    assert.equal(
      harness.warningDialogs[1]?.title,
      'Learning partially saved. Ask the chat for learning summary and sequence, an explanation step for stop 1, then save again. Not recorded: complete execution evidence. An explanation cannot add them; only a new test run records them.',
    )
    assert.equal(harness.reader.inspect().view?.nodeHistory?.status, 'partial')
    assert.deepEqual(harness.errorMessages, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=opening a saved test replay whose learner decision, learning material or reader position cannot be read: it still opens on its first verified stop and each failure is shown as an error line; fails_when=an unreadable extra fails the open, loses its error line, or the replay lands elsewhere than its first verified stop; why_new=the open tests read healthy files and the load-failure test breaks the journal itself; seam=none; no_claim=real file errors (the store's three reads reject)
test('a saved test replay still opens when its learner decision, learning material and reader position cannot be read, and each failure is shown', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await harness.reader.action('retry')
    context.mock.method(store, 'readLearningDecision', async () => {
      throw new Error('learner decision file unreadable')
    })
    context.mock.method(store, 'readLearningMaterial', async () => {
      throw new Error('learning material file unreadable')
    })
    context.mock.method(store, 'readReaderPosition', async () => {
      throw new Error('reader position file unreadable')
    })

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === history.studyId &&
        !lastView(harness)?.loading,
      'the test replay is shown',
      2_000,
    )

    // Assert
    // A later reload of the learner's ledger retires the decision's line, so the lines the panes were sent are read, not only the last ones.
    const errorLinesSent = new Set(
      harness.postedMessages().flatMap((message) => message.errors),
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
    assert.deepEqual(
      {
        decision: errorLinesSent.has('learner decision file unreadable'),
        material: errorLinesSent.has('learning material file unreadable'),
        position: errorLinesSent.has('reader position file unreadable'),
      },
      { decision: true, material: true, position: true },
    )
    assert.deepEqual(harness.errorMessages, [])
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a saved test replay open in the Study pane keeps its Saved studies current: a history sealed meanwhile is listed after the refresh while the replay stays on its stop; fails_when=a refresh with a replay selected updates the catalog but publishes nothing, so the pane lists the new history only after the learner touches it; why_new=the EN9 test asserts the replay is not rendered over, not that the refresh publishes the catalog; seam=none; no_claim=the pane's own drawing of the list
test('a refresh while a saved test replay is open lists the history sealed meanwhile and leaves the replay on its stop', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const store = harness.service.nodeHistoryStore!
    const shown = await saveOneStopNodeHistory(store)
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(shown.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === shown.studyId &&
        !lastView(harness)?.loading,
      'the saved test replay is shown',
      2_000,
    )
    const sealedMeanwhile = await saveOneStopNodeHistory(store)
    const presentationsBefore = harness.historicalDebugPresentations.length

    // Act
    await readerSeams(harness).refresh()

    // Assert
    assert.deepEqual(
      lastView(harness)
        ?.nodeHistoryCatalog?.map((history) => history.studyId)
        .sort(),
      [shown.studyId, sealedMeanwhile.studyId].sort(),
    )
    assert.equal(lastView(harness)?.nodeHistory?.header.studyId, shown.studyId)
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsBefore,
    )
  } finally {
    await harness.close()
  }
})

/**
 * Starts a live test run of two declared stops on a workspace harness and waits for its preparation, so the status bar item and Save act on a run paused at its first stop.
 * @param harness - The workspace harness whose service runs it.
 * @param runName - The start's idempotency key, named by what the run is for.
 * @returns The run's record and its study id.
 * @example const { record, studyId } = await startLiveTestRun(harness, 'closed-pane-save-item')
 */
async function startLiveTestRun(
  harness: Pick<
    Awaited<ReturnType<typeof workspaceHarness>>,
    'service' | 'configuration' | 'directory'
  >,
  runName: string,
) {
  const { service, configuration } = harness
  const sourceText = await readFile(
    join(harness.directory, configuration.source.path),
    'utf8',
  )
  service.environment.build.sourceHash = 'f'.repeat(64)
  service.environment.createNodeTestRun = async () =>
    twoStopOwnedRun(configuration.source, sourceText)
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: NODE_TEST_PROFILE,
    key: runName,
    configuration: {
      version: 1,
      adapter: 'vitest-node',
      book: configuration.book,
      testFile: 'src/scheduler.test.ts',
      testHash: 'a'.repeat(64),
      testTitles: ['job scheduler', 'runs a delayed job after its timer'],
      source: configuration.source,
      inspections: configuration.inspections.slice(0, 1),
      additionalStops: [
        {
          ...configuration.source,
          anchorIndex: 0,
          inspections: configuration.inspections.slice(0, 1),
        },
      ],
    },
  })
  const record = service.record(receipt)
  await record.preparation
  return { record, studyId: `${service.instanceId}_${record.id}` }
}

// Value: protects=a delayed Save click for an earlier test run: it is refused with the session-changed sentence and the current run is neither asked about nor stopped; fails_when=a stale status item click saves or stops the run now owned by the workspace; why_new=the stale-click guard was tested for browser recordings only (F23, gap E6); seam=a fake owned Node run; no_claim=the browser save's own test
test('a delayed Save click for an earlier test run is refused and leaves the current run running', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const { record } = await startLiveTestRun(harness, 'delayed-save-click')
    await readerSeams(harness).refresh()

    // Act
    const click = harness.reader.saveLearningReplay(
      `${harness.service.instanceId}_earlier-run`,
    )

    // Assert
    await assert.rejects(
      click,
      /The recorded session changed\. Use the current Save learning replay control\./,
    )
    assert.equal(record.stopped, false)
    assert.deepEqual(harness.warningDialogs, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=Show details of the load-failure notification: the learner's click opens the Output › Codebook channel; fails_when=the button is offered and does nothing, or opens the channel without a click; why_new=the notification was only read, never answered (F26, gap E9); seam=the notification's answer is scripted; no_claim=the channel's contents
test('choosing Show details on the load-failure notification opens the Output channel', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let shown = 0
  harness.reader.diagnostics = { log: () => undefined, show: () => shown++ }
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    await appendFile(
      join(
        (await harness.reader.learningStorage()).directory,
        NODE_TEST_HISTORY_DIRECTORY,
        history.studyId,
        'events.jsonl',
      ),
      '{"type":"forged"}\n',
    )
    const shownBeforeAnswer = shown
    harness.answerErrorDialogs(async (buttons) =>
      buttons.includes('Show details') ? 'Show details' : undefined,
    )

    // Act
    await harness.reader.openLearningReplay(history.studyId)

    // Assert
    assert.equal(shownBeforeAnswer, 0)
    assert.equal(shown, 1)
    assert.equal(harness.errorMessages.length, 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=the Study pane's archive line of a failed test replay open: it shows the cause with the storage folder replaced, as the notification beside it does; fails_when=the pane shows the learner's storage path; why_new=the open wrote the raw cause into the pane and the sanitized one into the notification (F73); seam=the store's read rejects with a path in its message; no_claim=the notification's words (the load-failure test)
test('a failed test replay open shows its cause without the storage folder on the Study pane', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await harness.reader.action('retry')
    context.mock.method(store, 'read', async () => {
      throw new Error(
        `cannot read '${store.learningDirectory}/${NODE_TEST_HISTORY_DIRECTORY}/events.jsonl'`,
      )
    })

    // Act
    await harness.reader.openLearningReplay(history.studyId)

    // Assert
    const linesSent = harness
      .postedMessages()
      .flatMap((message) => message.errors)
    assert.ok(
      linesSent.includes(
        `cannot read '<storage>/${NODE_TEST_HISTORY_DIRECTORY}/events.jsonl'`,
      ),
      'the archive line names <storage>',
    )
    assert.equal(
      linesSent.some((line) => line.includes(store.learningDirectory)),
      false,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the Study pane's lines for a learner decision, learning material and reader position that could not be read at an open: each shows its cause with the storage folder replaced; fails_when=any of the three lines shows the learner's storage path; why_new=the three lines took the raw cause (F73); seam=the store's three reads reject with paths in their messages; no_claim=the lines' wording beyond the folder
test('the lines of an unreadable decision, material and position show their causes without the storage folder', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await harness.reader.action('retry')
    for (const method of [
      'readLearningDecision',
      'readLearningMaterial',
      'readReaderPosition',
    ] as const)
      context.mock.method(store, method, async () => {
        throw new Error(`${method} failed at '${store.learningDirectory}/x'`)
      })

    // Act
    await harness.reader.openLearningReplay(history.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === history.studyId &&
        !lastView(harness)?.loading,
      'the test replay is shown',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    const linesSent = new Set(
      harness.postedMessages().flatMap((message) => message.errors),
    )
    assert.deepEqual(
      [
        'readLearningDecision failed at ' + "'<storage>/x'",
        'readLearningMaterial failed at ' + "'<storage>/x'",
        'readReaderPosition failed at ' + "'<storage>/x'",
      ].map((line) => linesSent.has(line)),
      [true, true, true],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=an open of a saved test replay that the reader's close overtakes while the history is read: nothing is selected, nothing is presented and no error is told; fails_when=the open commits its replay into a reader that closed; why_new=historyOpenSuperseded's close term was untested (F75); seam=the store's read is held; no_claim=a newer open (the double-click test)
test('an open of a saved test replay overtaken by the reader’s close selects nothing', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    await harness.reader.open()
    await harness.reader.action('retry')
    const read = NodeTestHistoryStore.prototype.read
    let releaseRead!: () => void
    const held = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let readStarted!: () => void
    const started = new Promise<void>((resolve) => {
      readStarted = resolve
    })
    context.mock.method(
      store,
      'read',
      async function (this: NodeTestHistoryStore, studyId: string) {
        readStarted()
        await held
        return read.call(this, studyId)
      },
    )
    const opening = harness.reader.openLearningReplay(history.studyId)
    await started

    // Act
    const closing = harness.reader.close()
    releaseRead()
    await Promise.all([opening, closing])

    // Assert
    assert.equal(harness.reader['selectedNodeHistory'], undefined)
    assert.equal(harness.historicalDebugPresentations.length, 0)
    assert.deepEqual(harness.errorMessages, [])
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=the Save item of a live test run drawn by a refresh while the Study pane is open but shows a browser replay: the refresh renders nothing of the run, so it draws the item itself; fails_when=the item stays hidden or stale while a browser replay holds the open pane; why_new=only a closed pane was tested (F76); seam=a fake owned Node run beside a recorded browser study; no_claim=the host's status bar drawing
test('a refresh draws the Save item of a live test run while a browser replay holds the open Study pane', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await harness.reader.openRecording(harness.studyId)
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the opened recording',
      READER_RESULT_BOUND_MS,
    )
    const { studyId } = await startLiveTestRun(harness, 'browser-replay-save')

    // Act
    await readerSeams(harness).refresh()

    // Assert
    assert.equal(harness.reader.inspect().opened, true)
    assert.deepEqual(
      {
        text: harness.saveStatus.text,
        command: structuredClone(harness.saveStatus.command),
      },
      {
        text: '$(record) Recording explanation · stop 1 of 2 · Save learning replay',
        command: {
          title: 'Save learning replay',
          command: 'codebook.saveLearningReplay',
          arguments: [studyId],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the status item of a test run while the Study pane is closed: the refresh every 250 ms sends the status bar nothing while the item is unchanged, and one redraw once it changes; fails_when=every refresh assigns the text, tooltip and visibility again; why_new=each refresh redrew the item, about four status bar messages a second (F83); seam=the harness's status item counts every assignment, show and hide; no_claim=the editor's own coalescing
test('a refresh redraws the status item of a test run only when it changed', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const { record } = await startLiveTestRun(harness, 'unchanged-status-item')
    await readerSeams(harness).refresh()
    const redrawsAfterFirst = harness.saveStatus.redraws

    // Act
    await readerSeams(harness).refresh()
    await readerSeams(harness).refresh()
    const redrawsAfterUnchanged = harness.saveStatus.redraws
    await harness.service.stop({
      instanceId: harness.service.instanceId,
      runId: record.id,
    })
    await readerSeams(harness).refresh()

    // Assert
    assert.equal(redrawsAfterUnchanged, redrawsAfterFirst)
    assert.ok(harness.saveStatus.redraws > redrawsAfterUnchanged)
    assert.equal(
      harness.saveStatus.text,
      '$(save) Recording finished · Save learning replay',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a first open whose replay debugger cannot start (a declined workspace trust, the capture timeout): the open completes on its landing moment, the failure is told on the replay-debugger row with its restart hint, the pane stays open, and Retry presents the debugger again; fails_when=the whole open fails while the pane shows the replay, no row tells why the debugger is missing, or Retry cannot present the stop; why_new=the open failed as a whole and every retry failed the same way (F98, D13); seam=the harness's historical debugger rejects the first presentation; no_claim=the real debug session start (native trials)
test('a first open whose replay debugger cannot start lands on its moment, tells the failure on the debugger row, and Retry presents the debugger again', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.action('retry')
    const held = harness.holdHistoricalDebugPresentation()

    // Act
    const opening = harness.reader.openLearningReplay(history.studyId)
    await held.started
    held.reject(new Error('Workspace trust was declined.'))
    await opening
    const afterOpen = lastView(harness)
    const presentationsAfterOpen = harness.historicalDebugPresentations.length
    await harness.reader.action('retry')

    // Assert
    assert.equal(afterOpen?.nodeHistory?.header.studyId, history.studyId)
    assert.equal(afterOpen?.nodeHistoryPosition?.sequence, 2)
    assert.equal(afterOpen?.loading, false)
    assert.equal(
      JSON.stringify(afterOpen?.errors),
      JSON.stringify([
        'The replay debugger could not start: Workspace trust was declined. Select this stop or use Inspect in native debugger to restart it.',
      ]),
    )
    assert.deepEqual(harness.errorMessages, [])
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsAfterOpen + 1,
    )
    assert.notEqual(
      harness.historicalDebugPresentations.at(-1)?.snapshot,
      undefined,
    )
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a first open whose replay debugger failed to start while another moment is selected before the failed owner is disposed: the old open reports nothing and selects and saves nothing, so only the newer selection shows its moment, its position and no replay-debugger row; fails_when=the old open still reports its failure row and commits its moment after the disposal, over the newer selection; why_new=the failure path awaited the disposal without checking that its request was still current (F237); seam=the harness's held presentation (rejected) and held debugger disposal; no_claim=the real debug session
test('a failed first debugger start overtaken by a newer selection while the owner is disposed reports nothing', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    // The reader left the replay on its result, a moment without a recorded stop.
    await store.saveReaderPosition(history.studyId, 3)
    await harness.reader.action('retry')
    const heldPresentation = harness.holdHistoricalDebugPresentation()
    const heldDisposal = harness.holdHistoricalDebugDisposal()
    const opening = harness.reader.openLearningReplay(history.studyId)
    await heldPresentation.started
    heldPresentation.reject(new Error('Workspace trust was declined.'))
    await heldDisposal.started

    // Act
    harness.receiveContext({
      type: 'node-history-event',
      revision: lastView(harness)!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    heldDisposal.release()
    await opening
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistoryPosition?.sequence === 2 &&
        !lastView(harness)?.loading,
      'the newer selection is shown',
      READER_RESULT_BOUND_MS,
    )
    await waitUntil(
      async () => (await store.readReaderPosition(history.studyId)) === 2,
      'the newer position is saved',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    const linesEverSent = harness
      .postedMessages()
      .flatMap((message) => message.errors)
    assert.equal(
      linesEverSent.some((line) => line.includes('could not start')),
      false,
    )
    assert.equal(lastView(harness)?.errors.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=Retry after a first open whose replay debugger failed to start on a moment without a recorded stop: a Retry whose start fails again keeps the replay-debugger row (with the new cause) and a Retry whose start succeeds removes it only after the debugger was started again; fails_when=Retry empties the failed debugger object, reports success without starting anything and drops the row; why_new=the retry found the failed debugger object, invalidated it and cleared the row (F226, D13); seam=the harness's historical debugger rejects the held presentations; no_claim=the real debug session start (native trials)
test('Retry after a failed first start keeps the debugger row until the debugger starts again', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = await saveOneStopNodeHistory(store)
    // The reader left the replay on its result, a moment without a recorded stop.
    await store.saveReaderPosition(history.studyId, 3)
    await harness.reader.action('retry')
    const firstHold = harness.holdHistoricalDebugPresentation()
    const opening = harness.reader.openLearningReplay(history.studyId)
    await firstHold.started
    firstHold.reject(new Error('Workspace trust was declined.'))
    await opening
    const rowAfterOpen = JSON.stringify(lastView(harness)?.errors)
    const presentationsAtOpen = harness.historicalDebugPresentations.length
    const secondHold = harness.holdHistoricalDebugPresentation()

    // Act
    const failingRetry = harness.reader.action('retry')
    await waitUntil(
      () => harness.historicalDebugPresentations.length > presentationsAtOpen,
      'the debugger starting again on Retry',
      READER_RESULT_BOUND_MS,
    )
    secondHold.reject(new Error('The debug session did not start.'))
    await failingRetry
    const rowAfterFailedRetry = JSON.stringify(lastView(harness)?.errors)
    const presentationsBeforeRetry = harness.historicalDebugPresentations.length
    await harness.reader.action('retry')

    // Assert
    assert.equal(
      rowAfterOpen,
      JSON.stringify([
        'The replay debugger could not start: Workspace trust was declined. Select this stop or use Inspect in native debugger to restart it.',
      ]),
    )
    assert.equal(
      rowAfterFailedRetry,
      JSON.stringify([
        'The replay debugger could not start: The debug session did not start. Select this stop or use Inspect in native debugger to restart it.',
      ]),
    )
    assert.equal(lastView(harness)?.errors.length, 0)
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsBeforeRetry + 1,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an Open replay while another test replay plays: Play ends, the new replay lands on its own first stop with its debugger, and the learner is told nothing is wrong; fails_when=the earlier replay's timer goes on writing over the new replay, or the new replay opens playing; why_new=EN19 had no test of an open during Play (F16); seam=none; no_claim=Play's pacing (the timeline tests)
test('Open replay while another test replay plays stops Play and lands the new replay on its first stop', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const first = await saveOneStopNodeHistory(store)
    const second = await saveOneStopNodeHistory(store)
    await harness.reader.action('retry')
    await harness.reader.openLearningReplay(first.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === first.studyId &&
        !lastView(harness)?.loading,
      'the first test replay is shown',
      READER_RESULT_BOUND_MS,
    )
    harness.receiveContext({
      type: 'node-history-playback',
      revision: lastView(harness)!.revision,
      studyId: first.studyId,
      action: 'play',
    })
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPlayback?.mode === 'playing',
      'the first test replay plays',
      READER_RESULT_BOUND_MS,
    )

    const playingController = harness.reader['nodeHistoryPlaybackController']!

    // Act
    await harness.reader.openLearningReplay(second.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === second.studyId &&
        !lastView(harness)?.loading,
      'the second test replay is shown',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    // The earlier replay's timer is gone with its controller: nothing of it ticks over the new replay.
    assert.equal(playingController.state().mode, 'paused')
    assert.notEqual(
      harness.reader['nodeHistoryPlaybackController'],
      playingController,
    )
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 2)
    assert.equal(lastView(harness)?.nodeHistoryPlayback?.mode, 'paused')
    assert.equal(lastView(harness)?.errors.length, 0)
    assert.deepEqual(harness.errorMessages, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=Previous event from the landing of a test replay: it reaches the replay's start (its first event, the debugger on "Not recorded at this moment"), and a further Previous is refused by name; fails_when=Previous skips the start, lands on an unverified stop, or moves past the first event; why_new=DS1's landing had no test of Previous reaching the start (F16); seam=none; no_claim=the button's disabled state (the Reader DOM check)
test('Previous event from the landing reaches the start of the replay, and a further Previous is refused', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
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
    /** Presses Previous event, as the transport's button does. */
    const previousEvent = (): void =>
      harness.receiveContext({
        type: 'node-history-step',
        revision: lastView(harness)!.revision,
        studyId: history.studyId,
        direction: 'previous',
        unit: 'event',
      })

    // Act
    previousEvent()
    await waitUntil(
      () => lastView(harness)?.nodeHistoryPosition?.sequence === 1,
      'the start is selected',
      READER_RESULT_BOUND_MS,
    )
    const labelAtStart = harness.historicalDebugInvalidationLabels().at(-1)
    previousEvent()
    await waitUntil(
      () => (lastView(harness)?.errors.length ?? 0) > 0,
      'the move before the start is refused',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(labelAtStart, 'Not recorded at this moment')
    assert.equal(lastView(harness)?.nodeHistoryPosition?.sequence, 1)
    assert.equal(
      JSON.stringify(lastView(harness)?.errors),
      JSON.stringify([
        'Error: There is no previous event in this Node history.',
      ]),
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Save item of a test run whose launch failed after its history began: Preparing the test run… while it starts, then no item, and a run resource that reads partial with no replay; fails_when=a stale Preparing item stays, the item turns into Recording finished · Save learning replay for a run that recorded nothing, or the run offers a replay; why_new=the unit tests fabricate a sealed-with-no-entry record and no test joins the real seal to the status item (F8); seam=none; no_claim=how a real Vitest launch fails (the owned run is a fake that throws)
test('a test run whose launch failed after its history began shows Preparing and then no Save item, and offers no replay', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let launchIsHeld = false,
    letLaunchFail!: () => void
  const launchMayFail = new Promise<void>((resolve) => {
    letLaunchFail = resolve
  })
  try {
    readerSeams(harness).stopOwnTimer()
    const { service, configuration } = harness
    service.environment.build.sourceHash = 'f'.repeat(64)
    // The history has begun when the owned run is created: held there, the run is preparing with an empty journal; failing there, it never records an entry.
    service.environment.createNodeTestRun = async () => {
      launchIsHeld = true
      await launchMayFail
      throw new Error('Vitest could not be launched.')
    }
    // The start's idempotency key, named by what this run is for.
    const runName = 'launch-fails-after-history'
    const receipt = service.start({
      instanceId: service.instanceId,
      profile: NODE_TEST_PROFILE,
      key: runName,
      configuration: {
        version: 1,
        adapter: 'vitest-node',
        book: configuration.book,
        testFile: 'src/scheduler.test.ts',
        testHash: 'a'.repeat(64),
        testTitles: ['job scheduler', 'runs a delayed job after its timer'],
        source: configuration.source,
        inspections: configuration.inspections.slice(0, 1),
      },
    })
    const record = service.record(receipt)
    await waitUntil(
      () => launchIsHeld,
      'the owned run is being created after the history began',
      2_000,
    )
    await readerSeams(harness).refresh()
    const whileStarting = {
      visible: harness.saveStatus.visible,
      text: harness.saveStatus.text,
      command: harness.saveStatus.command,
    }

    // Act
    letLaunchFail()
    await record.preparation
    await waitUntil(() => record.stopped, 'the failed run released', 2_000)
    await readerSeams(harness).refresh()

    // Assert
    assert.deepEqual(whileStarting, {
      visible: true,
      text: '$(sync~spin) Preparing the test run…',
      command: undefined,
    })
    assert.equal(harness.saveStatus.visible, false)
    const state = service.state(record)
    assert.deepEqual(
      [
        state.finalOutcome,
        state.recording.status,
        state.nodeTest?.historyStatus,
        state.nodeTest?.replayAvailable,
      ],
      ['not-demonstrated', 'partial', 'partial', false],
    )
    assert.equal(harness.reader.inspect().opened, false)
  } finally {
    letLaunchFail()
    await harness.close()
  }
})
