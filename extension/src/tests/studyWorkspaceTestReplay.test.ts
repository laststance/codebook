import assert from 'node:assert/strict'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { NODE_TEST_HISTORY_DIRECTORY } from '../constants'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import {
  readerSeams,
  recordedReaderHarness,
  saveOneStopNodeHistory,
  workspaceHarness,
} from './studyWorkspaceHarness'

/** The last view the reader posted to its panes. */
function lastView(harness: Awaited<ReturnType<typeof workspaceHarness>>) {
  return harness.postedMessages().slice(-1)[0]
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

// Value: protects=a test replay's saved reader position, which wins over the landing on its first verified stop; fails_when=a replay the learner left on its result reopens on a stop; why_new=DS1 keeps the saved position first (AC4); seam=none; no_claim=a position saved in another window
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
    assert.equal(harness.historicalDebugPresentations.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=the landing of a test replay without a verified stop: its first event; fails_when=the open selects an unverified stop and presents another moment's source; why_new=DS1's fallback (AC4); seam=a stop whose captured text was edited after the seal; no_claim=none beyond protects
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
    assert.equal(harness.historicalDebugPresentations.length, 0)
  } finally {
    context.mock.restoreAll()
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
