import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { SUMMARY_FOCUS_RELEASE_WAIT_MS } from '../constants'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import type { NodeTestSourceStop } from '../ownedNodeTestRun'
import { RecordingStore } from '../recordingStore'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  workspaceHarness,
  saveOneStopNodeHistory,
  readerSeams,
  recordedReaderHarness,
  openRetainedStudy,
} from './studyWorkspaceHarness'
import { commitNextStop } from './utils/configuredServiceHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import {
  advanceClock,
  advanceClockUntilSettled,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'
test('restored Observed moments leaves its loading state after workspace initialization', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    // Act: VS Code can restore the view before any Codebook command initializes this workspace.
    await harness.resolveRestoredObservedMoments()

    // Assert
    const message = harness.playbackPanelMessages.at(-1)
    assert.ok(message)
    assert.equal(message.type, 'study')
    assert.equal(message.loading, false)
    assert.equal(message.model.currentSourceAvailable, false)
  } finally {
    await harness.close()
  }
})

test('an unreadable Node history folder is reported while the saved-study reader still opens', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const learningDirectory = join(
      harness.directory,
      'storage',
      'learning',
      harness.service.nodeHistoryStore!.workspaceKey,
    )
    await rm(join(learningDirectory, 'node-tests.v1'), {
      recursive: true,
      force: true,
    })
    await mkdir(learningDirectory, { recursive: true })
    await writeFile(
      join(learningDirectory, 'node-tests.v1'),
      'not a history folder',
    )

    // Act
    await harness.reader.open()

    // Assert
    await waitUntil(
      () =>
        Boolean(
          harness.reader
            .inspect()
            .view?.errors.some((error) => /ENOTDIR/.test(error)),
        ),
      'the Node history catalog failure is reported',
      1_000,
    )
    assert.ok(
      harness.postedMessages().slice(-1)[0]?.studies,
      'Saved studies remain available beside the reported Node history failure',
    )
  } finally {
    await harness.close()
  }
})

test('saved Node history is selectable in the reader without entering browser playback', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const initialHeader = nodeTestHistoryHeader(store.workspaceKey),
      firstSourceText = 'const nextTheme = "dark";\n',
      secondSourceText = 'return applyTheme("dark");\n'
    const secondSource = {
      path: 'src/theme-next.ts',
      hash: sha256(secondSourceText),
      line: 1,
      column: 8,
    }
    const secondConfiguration = {
      ...initialHeader.configuration,
      additionalStops: [
        {
          ...secondSource,
          anchorIndex: 0,
          inspections: initialHeader.configuration.inspections,
        },
      ],
    }
    const header = {
      ...initialHeader,
      configuration: secondConfiguration,
      configurationHash: sha256(JSON.stringify(secondConfiguration)),
    }
    const writer = await store.start(header)
    for (let sequence = 1; sequence <= 22; sequence++) {
      // Exercise the reader's bounded page boundary with ordinary captured output.
      await writer.appendOutput({
        sequence,
        elapsedMs: sequence,
        channel: 'stdout',
        text: sequence === 1 ? 'RUN src/theme.test.ts' : `output ${sequence}`,
      })
    }
    await writer.appendStop({
      index: 0,
      runId: 'test-run',
      sessionId: 'test-session',
      threadId: 1,
      elapsedMs: 23,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
      source: header.configuration.source,
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
              name: header.configuration.source.path,
              text: firstSourceText,
              hash: sha256(firstSourceText),
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
    } satisfies NodeTestSourceStop)
    await writer.appendOutput({
      sequence: 23,
      elapsedMs: 24,
      channel: 'stdout',
      text: 'between stops\n',
    })
    await writer.appendStop({
      index: 1,
      runId: 'test-run',
      sessionId: 'test-session',
      threadId: 1,
      elapsedMs: 25,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
      source: secondSource,
      frame: { id: 2, name: 'applyTheme', line: 1, column: 8 },
      variables: [{ name: 'themeName', value: 'dark', variablesReference: 0 }],
      facts: [
        { path: 'themeName', mode: 'value', display: 'dark', type: 'string' },
      ],
      debuggerSnapshot: {
        version: 1,
        frames: [
          {
            name: 'applyTheme',
            line: 1,
            column: 8,
            source: {
              name: secondSource.path,
              text: secondSourceText,
              hash: secondSource.hash,
              line: 1,
            },
            scopes: [{ name: 'Local', variables: [0] }],
          },
        ],
        variables: [
          { name: 'themeName', value: 'dark', type: 'string', children: [] },
        ],
        limitations: [],
      },
    } satisfies NodeTestSourceStop)
    await writer.appendResult(
      { exitCode: 0, signal: null, output: 'Tests 1 passed' },
      26,
    )
    await writer.finish('complete')
    await harness.reader.open()
    await waitUntil(
      () =>
        Boolean(
          harness
            .postedMessages()
            .slice(-1)[0]
            ?.studies.some(
              (entry) =>
                entry.id === header.studyId &&
                entry.format === 'node-test-history',
            ),
        ),
      'Node history appears in Saved studies',
      1_000,
    )

    // Assert: the library exposes the journal as a distinct artifact and discloses missing replay media.
    const libraryMessage = harness.postedMessages().slice(-1)[0]!
    const libraryEntry = libraryMessage.studies.find(
      (entry) => entry.id === header.studyId,
    )!
    assert.equal(libraryEntry.profile, 'node-test')
    assert.equal(
      libraryEntry.outcome,
      'Node test complete; application video and synchronized replay unavailable',
    )
    assert.equal(libraryEntry.metadata, 'validated')

    // Act: selecting the catalog entry routes to the Node journal while preserving browser-study selection.
    const revision = libraryMessage.revision
    harness.receive({ type: 'node-history', revision, studyId: header.studyId })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistory?.header.studyId ===
          header.studyId && !harness.postedMessages().slice(-1)[0]?.loading,
      'selected Node history is verified and displayed',
      1_000,
    )
    const message = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.equal(message.nodeHistory?.status, 'complete')
    assert.equal(
      message.nodeHistory?.entries.length,
      20,
      'reader messages include one bounded history page',
    )
    assert.equal(message.nodeHistoryPageCount, 2)
    assert.equal(message.nodeHistory?.entries[0]?.type, 'output')
    assert.equal(
      message.recording,
      undefined,
      'Node evidence does not masquerade as synchronized browser replay',
    )
    assert.equal(
      message.model.selection.profile,
      'repository-browser',
      'Node history does not overwrite the browser-study selection',
    )
    assert.equal(
      message.nodeHistoryLearningDecision,
      undefined,
      'a passing test never marks understanding for the learner',
    )
    const applicationHtml =
      harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')?.webview
        .html ?? ''
    assert.match(
      applicationHtml,
      /Node test history · application video unavailable/,
    )
    assert.doesNotMatch(
      applicationHtml,
      /<img alt="Application pixels captured/,
    )

    // Act: only an explicit reader action writes a choice for this Node history.
    harness.receive({
      type: 'node-history-understanding',
      revision: message.revision,
      studyId: header.studyId,
      understood: true,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryLearningDecision
          ?.understood === true,
      'learner understanding is saved',
      1_000,
    )
    const decisionMessage = harness.postedMessages().slice(-1)[0]!
    const reopenMessageIndex = harness.postedMessages().length
    harness.receiveContext({
      type: 'node-history',
      revision: decisionMessage.revision,
      studyId: header.studyId,
    })
    await waitUntil(
      () =>
        harness
          .postedMessages()
          .slice(reopenMessageIndex)
          .some((view) => view.loading),
      'reopening the Node history enters its loading state',
      1_000,
    )
    await waitUntil(
      () => {
        const view = harness.postedMessages().slice(-1)[0]!
        return (
          view.nodeHistory?.header.studyId === header.studyId &&
          view.nodeHistoryPosition?.sequence === 1 &&
          view.nodeHistoryLearningDecision?.understood === true &&
          !view.loading
        )
      },
      'learner choice and saved event are restored when the history reopens',
      1_000,
    )
    const restoredDecisionMessage = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.equal(
      restoredDecisionMessage.nodeHistoryLearningDecision?.understood,
      true,
    )
    assert.equal(
      (await (await harness.reader.learningStorage()).readProgress()).decisions
        .length,
      0,
      'Node understanding does not add a configured-study learner decision',
    )

    // Act: step across the reader's page boundary using the global journal cursor.
    const beforePageStep = harness.postedMessages().slice(-1)[0]!
    harness.receiveContext({
      type: 'node-history-event',
      revision: beforePageStep.revision,
      studyId: header.studyId,
      sequence: 20,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        20,
      'last event on the first page is selected',
      1_000,
    )
    harness.receive({
      type: 'node-history-step',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: header.studyId,
      direction: 'next',
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        21,
      'next event crosses into the second page',
      1_000,
    )
    const pageBoundaryMessage = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.equal(pageBoundaryMessage.nodeHistoryPage, 1)
    assert.equal(pageBoundaryMessage.nodeHistoryPosition?.eventIndex, 20)
    assert.equal(pageBoundaryMessage.nodeHistory?.entries[0]?.sequence, 21)

    // Act: select each recorded stop through the public reader message after reopening the history store.
    const reopenedLearningLibrary = await harness.reader.learningStorage()
    harness.reader['nodeHistoryStore'] = new NodeTestHistoryStore(
      reopenedLearningLibrary.directory,
      header.workspaceKey,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: message.revision,
      studyId: header.studyId,
      sequence: 23,
    })
    // Native presentation precedes durable cursor publication; wait for both before inspecting the reader.
    await waitUntil(
      () =>
        harness.historicalDebugPresentations.length === 1 &&
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          23,
      'first historical Node stop reaches the native debugger and reader',
      1_000,
    )
    const firstPresentation = harness.historicalDebugPresentations[0]!
    assert.equal(firstPresentation.snapshot?.variables[0]?.name, 'nextTheme')
    assert.equal(
      firstPresentation.sourceDocument?.hash,
      header.configuration.source.hash,
    )
    assert.equal(
      await harness.readCapturedSource(firstPresentation.sourceDocument.uri),
      firstSourceText,
      'source URI survives a fresh history store',
    )
    const firstStopMessage = harness.postedMessages().slice(-1)[0]!
    assert.equal(firstStopMessage.nodeHistoryPosition?.sequence, 23)
    assert.equal(firstStopMessage.nodeHistoryPosition?.index, 0)
    assert.equal(firstStopMessage.nodeHistoryPosition?.elapsedMs, 23)
    assert.match(firstStopMessage.nodeHistoryOutput!, /output 22/)
    assert.doesNotMatch(
      firstStopMessage.nodeHistoryOutput!,
      /between stops|Tests 1 passed/,
    )
    await assert.rejects(
      harness.readCapturedSource(
        firstPresentation.sourceDocument.uri.replace(
          header.configuration.source.hash,
          secondSource.hash,
        ),
      ),
      /no longer matches its sealed history/i,
    )

    // Act: an MCP-authored summary refreshes the selected Node history without moving its cursor or learner choice.
    const nodeLearningMaterial = {
      question: 'How does this test apply the theme?',
      title: 'Theme application',
      summary:
        'The first stop records the selected theme before the test continues.',
      participants: [
        { id: 'test', label: 'Theme test' },
        { id: 'function', label: 'applyTheme' },
      ],
      steps: [
        {
          id: 'read-theme',
          from: 'test',
          to: 'function',
          label: 'Read selected theme',
          explanation:
            'The captured debugger values show nextTheme is dark at this stop.',
          evidence: 'observed' as const,
          reference: {
            type: 'stop' as const,
            sequence: 23,
            sourceHash: header.configuration.source.hash,
          },
        },
      ],
    }
    await harness.service.explainNodeHistory({
      studyId: header.studyId,
      expectedRevision: 0,
      content: nodeLearningMaterial,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryLearningMaterial
          ?.revision === 1,
      'saved Node learning material refreshes the open reader',
      1_000,
    )
    const materialMessage = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.deepEqual(
      materialMessage.nodeHistoryLearningMaterial?.content,
      nodeLearningMaterial,
    )
    assert.equal(
      materialMessage.nodeHistoryPosition?.sequence,
      23,
      'saving an explanation preserves the selected stop',
    )
    assert.equal(
      materialMessage.nodeHistoryLearningDecision?.understood,
      true,
      'saving an explanation does not change the learner choice',
    )

    harness.receive({
      type: 'node-history-stop',
      revision: message.revision,
      studyId: header.studyId,
      sequence: 25,
    })
    await waitUntil(
      () =>
        harness.historicalDebugPresentations.length === 2 &&
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          25,
      'second historical Node stop replaces the selected native and reader state',
      1_000,
    )
    const secondPresentation = harness.historicalDebugPresentations[1]!
    assert.equal(secondPresentation.snapshot?.variables[0]?.name, 'themeName')
    assert.equal(secondPresentation.sourceDocument?.hash, secondSource.hash)
    assert.equal(
      await harness.readCapturedSource(secondPresentation.sourceDocument.uri),
      secondSourceText,
    )
    const secondStopMessage = harness.postedMessages().slice(-1)[0]!
    assert.equal(secondStopMessage.nodeHistoryPosition?.sequence, 25)
    assert.equal(secondStopMessage.nodeHistoryPosition?.index, 1)
    assert.equal(secondStopMessage.nodeHistoryPosition?.elapsedMs, 25)
    assert.match(secondStopMessage.nodeHistoryOutput!, /between stops/)
    assert.doesNotMatch(secondStopMessage.nodeHistoryOutput!, /Tests 1 passed/)

    // Act: moving through output-only intervals clears the previously selected native debug context.
    harness.receive({
      type: 'node-history-event',
      revision: message.revision,
      studyId: header.studyId,
      sequence: 24,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        24,
      'inter-stop output event is selected',
      1_000,
    )
    const interStopMessage = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.equal(interStopMessage.nodeHistoryPosition?.type, 'output')
    assert.match(interStopMessage.nodeHistoryOutput!, /between stops/)
    assert.doesNotMatch(interStopMessage.nodeHistoryOutput!, /Tests 1 passed/)
    assert.equal(
      harness.historicalDebugInvalidations(),
      1,
      'the previous stop is cleared during an output-only interval',
    )
    assert.equal(
      harness.historicalDebugPresentations.length,
      2,
      'an output-only interval does not claim a debugger snapshot',
    )

    // Act: step forward and back across a stop and a gap, then select the terminal result.
    harness.receive({
      type: 'node-history-step',
      revision: message.revision,
      studyId: header.studyId,
      direction: 'next',
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        25,
      'next recorded stop is restored',
      1_000,
    )
    harness.receive({
      type: 'node-history-step',
      revision: message.revision,
      studyId: header.studyId,
      direction: 'previous',
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        24,
      'backward navigation restores the output gap',
      1_000,
    )
    harness.receive({
      type: 'node-history-event',
      revision: message.revision,
      studyId: header.studyId,
      sequence: 26,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        26,
      'terminal result event is selected',
      1_000,
    )

    // Assert
    const terminalMessage = harness.postedMessages().slice(-1)[0]!
    assert.equal(terminalMessage.nodeHistoryPosition?.type, 'result')
    assert.match(terminalMessage.nodeHistoryOutput!, /between stops/)
    assert.doesNotMatch(terminalMessage.nodeHistoryOutput!, /Tests 1 passed/)
    assert.equal(
      harness.historicalDebugInvalidations(),
      3,
      'terminal events do not retain historical debugger values',
    )
    assert.equal(
      harness.historicalDebugPresentations[2]?.snapshot?.variables[0]?.name,
      'themeName',
      'revisiting a stop restores its captured values',
    )

    // Act: reopen the same history through a new store and restore the previously selected stop.
    harness.receive({
      type: 'node-history-stop',
      revision: message.revision,
      studyId: header.studyId,
      sequence: 25,
    })
    await waitUntil(
      () =>
        harness.historicalDebugPresentations.length === 4 &&
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          25,
      'second stop is selected in the reader before reopening its history',
      1_000,
    )
    const library = await harness.reader.learningStorage()
    harness.reader['nodeHistoryStore'] = new NodeTestHistoryStore(
      library.directory,
      header.workspaceKey,
    )
    const latestRevision = harness.postedMessages().slice(-1)[0]!.revision
    harness.receive({
      type: 'node-history',
      revision: latestRevision,
      studyId: header.studyId,
    })
    await waitUntil(
      () =>
        harness.historicalDebugPresentations.length === 5 &&
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          25 &&
        !harness.postedMessages().slice(-1)[0]?.loading,
      'a new history store restores the saved stop and its native snapshot',
      1_000,
    )

    // Assert
    const reopenedHistoryMessage = harness.postedMessages().slice(-1)[0]!
    assert.equal(reopenedHistoryMessage.nodeHistoryPosition?.type, 'stop')
    assert.equal(
      reopenedHistoryMessage.nodeHistoryPosition?.debuggerAvailable,
      true,
    )
    assert.equal(
      harness.historicalDebugPresentations[4]?.snapshot?.variables[0]?.name,
      'themeName',
    )
    assert.equal(
      reopenedHistoryMessage.nodeHistoryLearningMaterial?.revision,
      1,
      'a fresh history store restores the saved explanation',
    )
    assert.equal(
      reopenedHistoryMessage.nodeHistoryLearningDecision?.understood,
      true,
      'the separate learner choice survives material reload',
    )
    assert.equal(
      await harness.readCapturedSource(
        harness.historicalDebugPresentations[4].sourceDocument!.uri,
      ),
      secondSourceText,
    )

    // Act: persist an output-only interval, then reopen through another store instance.
    harness.receive({
      type: 'node-history-event',
      revision: reopenedHistoryMessage.revision,
      studyId: header.studyId,
      sequence: 24,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        24,
      'output-only position replaces the saved stop',
      1_000,
    )
    const outputPositionMessage = harness.postedMessages().slice(-1)[0]!
    assert.equal(outputPositionMessage.nodeHistoryPosition?.type, 'output')
    assert.equal(
      outputPositionMessage.nodeHistoryPosition?.debuggerAvailable,
      undefined,
    )
    assert.match(outputPositionMessage.nodeHistoryOutput!, /between stops/)
    assert.doesNotMatch(
      outputPositionMessage.nodeHistoryOutput!,
      /Tests 1 passed/,
    )
    const presentationsBeforeOutputRestore =
      harness.historicalDebugPresentations.length
    harness.reader['nodeHistoryStore'] = new NodeTestHistoryStore(
      library.directory,
      header.workspaceKey,
    )
    harness.receive({
      type: 'node-history',
      revision: outputPositionMessage.revision,
      studyId: header.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          24 && !harness.postedMessages().slice(-1)[0]?.loading,
      'a fresh history store restores the output-only cursor',
      1_000,
    )

    // Assert
    const reopenedOutputMessage = harness.postedMessages().slice(-1)[0]!
    assert.equal(reopenedOutputMessage.nodeHistoryPosition?.type, 'output')
    assert.equal(
      reopenedOutputMessage.nodeHistoryPosition?.debuggerAvailable,
      undefined,
    )
    assert.match(reopenedOutputMessage.nodeHistoryOutput!, /between stops/)
    assert.doesNotMatch(
      reopenedOutputMessage.nodeHistoryOutput!,
      /Tests 1 passed/,
    )
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsBeforeOutputRestore,
      'reopening an output event does not present a stale debugger stop',
    )

    // Assert: replay ownership blocks mixing a Node stop into a browser recording session.
    harness.reader['recordingActive'] = true
    harness.receiveContext({
      type: 'node-history-stop',
      revision: reopenedOutputMessage.revision,
      studyId: header.studyId,
      sequence: 23,
    })
    await waitUntil(
      () => Boolean(harness.reader.inspect().view?.errors.length),
      'browser playback refusal is reported to the reader',
      1_000,
    )
    assert.match(
      harness.reader.inspect().view!.errors.at(-1)!,
      /Close browser replay/,
    )
    assert.equal(harness.historicalDebugPresentations.length, 5)
    harness.reader['recordingActive'] = false

    // Act: advance the independent event page without opening browser playback.
    harness.receive({
      type: 'node-history-page',
      revision: message.revision,
      studyId: header.studyId,
      page: 1,
    })
    await waitUntil(
      () => harness.postedMessages().slice(-1)[0]?.nodeHistoryPage === 1,
      'next Node history page',
      1_000,
    )
    const lastPage = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.equal(lastPage.nodeHistory?.entries.length, 6)
    assert.equal(
      lastPage.nodeHistory?.entries[lastPage.nodeHistory.entries.length - 1]
        ?.type,
      'result',
    )

    // Arrange: a native debugger preview from this Node history can outlive its selected journal.
    const obsoletePreview = harness.addNodeHistoryPreview(header.studyId, 2)
    const pinnedPreview = harness.addNodeHistoryPreview(header.studyId, 2, {
      pinned: true,
    })
    const editedPreview = harness.addNodeHistoryPreview(header.studyId, 2, {
      dirty: true,
    })
    const otherHistoryPreview = harness.addNodeHistoryPreview(randomUUID(), 2)
    const learnerPreview = harness.addTextPreview('/private/notes.ts', 2)
    const learningLibrary = await harness.reader.learningStorage()
    const browserStudy = {
      ...createConfiguredStudy(),
      workspaceKey: learningLibrary.workspaceKey,
    }
    await learningLibrary.saveStudy(browserStudy)

    // Act: choosing browser history retires only the previous journal's disposable source preview.
    harness.receive({
      type: 'history',
      revision: lastPage.revision,
      studyId: browserStudy.id,
    })
    await waitUntil(
      () =>
        harness.reader.inspect().view?.model.selection.studyId ===
          browserStudy.id && !harness.reader.inspect().view?.loading,
      'browser study replaces the selected Node history',
      1_000,
    )

    // Assert: learner-pinned, edited and unrelated tabs remain available.
    const retainedTabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(retainedTabs.includes(obsoletePreview), false)
    assert.equal(retainedTabs.includes(pinnedPreview), true)
    assert.equal(retainedTabs.includes(editedPreview), true)
    assert.equal(retainedTabs.includes(otherHistoryPreview), true)
    assert.equal(retainedTabs.includes(learnerPreview), true)
    assert.equal(harness.reader.inspect().view?.nodeHistory, undefined)
  } finally {
    await harness.close()
  }
})

test('Node journal time seeking restores exact stops and clears debugger across output and result events', async () => {
  // Arrange: keep this playback contract isolated from unrelated reader reopen and pagination workflows.
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const header = nodeTestHistoryHeader(store.workspaceKey)
    const firstText = 'const nextTheme = "dark";\n'
    const secondText = 'return applyTheme("dark");\n'
    const secondSource = {
      path: 'src/theme-next.ts',
      hash: sha256(secondText),
      line: 1,
      column: 8,
    }
    const configuration = {
      ...header.configuration,
      additionalStops: [
        {
          ...secondSource,
          anchorIndex: 0,
          inspections: header.configuration.inspections,
        },
      ],
    }
    const history = {
      ...header,
      configuration,
      configurationHash: sha256(JSON.stringify(configuration)),
    }
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
              text: firstText,
              hash: sha256(firstText),
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
    } satisfies NodeTestSourceStop)
    await writer.appendOutput({
      sequence: 3,
      elapsedMs: 300,
      channel: 'stdout',
      text: 'between stops\n',
    })
    await writer.appendStop({
      index: 1,
      runId: 'test-run',
      sessionId: 'test-session',
      threadId: 1,
      elapsedMs: 400,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
      source: secondSource,
      frame: { id: 2, name: 'applyTheme', line: 1, column: 8 },
      variables: [{ name: 'themeName', value: 'dark', variablesReference: 0 }],
      facts: [
        { path: 'themeName', mode: 'value', display: 'dark', type: 'string' },
      ],
      debuggerSnapshot: {
        version: 1,
        frames: [
          {
            name: 'applyTheme',
            line: 1,
            column: 8,
            source: {
              name: secondSource.path,
              text: secondText,
              hash: secondSource.hash,
              line: 1,
            },
            scopes: [{ name: 'Local', variables: [0] }],
          },
        ],
        variables: [
          { name: 'themeName', value: 'dark', type: 'string', children: [] },
        ],
        limitations: [],
      },
    } satisfies NodeTestSourceStop)
    await writer.appendResult(
      { exitCode: 0, signal: null, output: 'Tests 1 passed' },
      500,
    )
    await writer.finish('complete')
    await harness.reader.open()
    const initial = harness.postedMessages().slice(-1)[0]!
    harness.receiveContext({
      type: 'node-history',
      revision: initial.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () => {
        const view = harness.postedMessages().slice(-1)[0]!
        return (
          view.nodeHistory?.header.studyId === history.studyId &&
          view.nodeHistoryPosition?.sequence === 1 &&
          !view.loading
        )
      },
      'the sealed Node history and its initial event are loaded',
      1_000,
    )

    // Act: seek to the second stop through the same message sent by the time slider.
    harness.receiveContext({
      type: 'node-history-playback',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      action: 'seek',
      positionMs: 400,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPlayback
          ?.positionMs === 400,
      'time seek presents the second verified stop',
      1_000,
    )

    // Assert: the historical debugger, output prefix and durable cursor all identify the same event.
    const secondStop = harness.postedMessages().slice(-1)[0]!
    assert.equal(secondStop.nodeHistoryPosition?.sequence, 4)
    assert.equal(secondStop.nodeHistoryPosition?.type, 'stop')
    assert.equal(secondStop.nodeHistoryPosition?.debuggerAvailable, true)
    assert.equal(
      harness.historicalDebugPresentations.at(-1)?.snapshot?.variables[0]?.name,
      'themeName',
    )
    assert.match(secondStop.nodeHistoryOutput!, /between stops/)
    assert.doesNotMatch(secondStop.nodeHistoryOutput!, /Tests 1 passed/)
    assert.equal(await store.readReaderPosition(history.studyId), 4)

    // Act: seek into the output interval and then to the final result.
    harness.receiveContext({
      type: 'node-history-playback',
      revision: secondStop.revision,
      studyId: history.studyId,
      action: 'seek',
      positionMs: 300,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        3,
      'output seek clears the second debugger stop',
      1_000,
    )
    const outputEvent = harness.postedMessages().slice(-1)[0]!
    harness.receiveContext({
      type: 'node-history-playback',
      revision: outputEvent.revision,
      studyId: history.studyId,
      action: 'seek',
      positionMs: 500,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        5,
      'result seek selects the final journal event',
      1_000,
    )

    // Assert: output and result do not imply application video or retain a stale debugger.
    const resultEvent = harness.postedMessages().slice(-1)[0]!
    assert.equal(resultEvent.nodeHistoryPosition?.type, 'result')
    assert.equal(resultEvent.nodeHistoryPlayback?.mode, 'paused')
    assert.equal(resultEvent.recording, undefined)
    assert.equal(resultEvent.nodeHistoryPosition?.debuggerAvailable, undefined)
    assert.ok(harness.historicalDebugInvalidations() >= 2)
  } finally {
    await harness.close()
  }
})

test('time seeking in a second opened Node history presents its own stop instead of reporting a changed history', async () => {
  // Arrange: two sealed one-stop histories whose captured values differ.
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const sourceText = 'const nextTheme = "dark";\n'
    const saveHistory = async (value: string) => {
      const history = nodeTestHistoryHeader(store.workspaceKey)
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
        variables: [{ name: 'nextTheme', value, variablesReference: 0 }],
        facts: [
          { path: 'nextTheme', mode: 'value', display: value, type: 'string' },
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
            { name: 'nextTheme', value, type: 'string', children: [] },
          ],
          limitations: [],
        },
      } satisfies NodeTestSourceStop)
      await writer.appendResult(
        { exitCode: 0, signal: null, output: 'Tests 1 passed' },
        300,
      )
      await writer.finish('complete')
      return history
    }
    const firstHistory = await saveHistory('"dark"'),
      secondHistory = await saveHistory('"light"')
    await harness.reader.open()
    for (const history of [firstHistory, secondHistory]) {
      harness.receiveContext({
        type: 'node-history',
        revision: harness.postedMessages().slice(-1)[0]!.revision,
        studyId: history.studyId,
      })
      await waitUntil(
        () => {
          const view = harness.postedMessages().slice(-1)[0]!
          return (
            view.nodeHistory?.header.studyId === history.studyId &&
            view.nodeHistoryPosition?.sequence === 1 &&
            !view.loading
          )
        },
        'the selected Node history and its initial event are loaded',
        1_000,
      )
    }

    // Act: seek the second history through the same message sent by the time slider.
    harness.receiveContext({
      type: 'node-history-playback',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: secondHistory.studyId,
      action: 'seek',
      positionMs: 200,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPlayback
          ?.positionMs === 200,
      'time seek presents the second history stop',
      1_000,
    )

    // Assert: the native debugger shows the second history's captured value.
    const seeked = harness.postedMessages().slice(-1)[0]!
    assert.equal(seeked.nodeHistory?.header.studyId, secondHistory.studyId)
    assert.equal(seeked.nodeHistoryPosition?.type, 'stop')
    assert.equal(
      harness.historicalDebugPresentations.at(-1)?.snapshot?.variables[0]
        ?.value,
      '"light"',
    )
  } finally {
    await harness.close()
  }
})

test('reopening a Node history after the learner stops its historical debugger restores native values', async () => {
  // Arrange: a sealed one-stop history presented once through the native debugger.
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
    } satisfies NodeTestSourceStop)
    await writer.appendResult(
      { exitCode: 0, signal: null, output: 'Tests 1 passed' },
      300,
    )
    await writer.finish('complete')
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () => harness.historicalDebugPresentations.length === 1,
      'the recorded stop reaches the native debugger',
      1_000,
    )
    // The learner ends the "Codebook · Recorded learning" session from the native debugger.
    harness.historicalDebuggers[0]!.available = false

    // Act: reopening the same history is the documented recovery.
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.historicalDebugPresentations.length === 2 &&
        !harness.postedMessages().slice(-1)[0]?.loading,
      'the reopened history presents its saved stop through a fresh historical debugger',
      1_000,
    )

    // Assert
    assert.equal(harness.historicalDebuggers.length, 2)
    assert.equal(
      harness.historicalDebugPresentations[1]?.snapshot?.variables[0]?.name,
      'nextTheme',
    )
    assert.equal(
      harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence,
      2,
    )
  } finally {
    await harness.close()
  }
})

test('returning to the current run leaves a selected Node history so its missing-video notice no longer masks the live application', async () => {
  // Arrange: the learner is reading a saved Node stop in the historical debugger; the application pane explains that no video exists.
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistory?.header.studyId ===
          history.studyId && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is displayed',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () => harness.historicalDebugPresentations.length === 1,
      'the recorded stop reaches the native debugger',
      1_000,
    )
    const preview = harness.addNodeHistoryPreview(history.studyId, 2)
    const invalidationsBefore = harness.historicalDebugInvalidations()

    // Act
    await harness.reader.action('return-current')

    // Assert
    const view = harness.postedMessages().slice(-1)[0]!
    const applicationPanel = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.equal(
      view.nodeHistory,
      undefined,
      'the Node journal is no longer the selected reader content',
    )
    assert.equal(view.model.selection.follow, true)
    assert.ok(
      applicationPanel,
      'the application pane stays open for the live run',
    )
    assert.doesNotMatch(
      applicationPanel.webview.html,
      /Node test history · application video unavailable/,
    )
    assert.equal(
      harness.groups.flatMap((group) => group.tabs).includes(preview),
      false,
      'the Node history debugger preview is closed',
    )
    assert.ok(
      harness.historicalDebugInvalidations() > invalidationsBefore,
      'the historical debugger no longer shows the Node stop',
    )
  } finally {
    await harness.close()
  }
})

test('an agent returning the reader to the current run leaves a selected Node history even while the reader still follows the run', async () => {
  // Arrange: selecting a Node journal keeps the browser selection following the current run.
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistory?.header.studyId ===
          history.studyId && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is displayed',
      1_000,
    )
    const state = harness.reader.presentationState()

    // Act
    const returned = await harness.reader.returnToCurrent({
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })

    // Assert
    assert.equal(
      state.reader.followingCurrentRun,
      false,
      'an agent reading state sees that the journal masks the current run',
    )
    assert.equal(returned.reader.followingCurrentRun, true)
    assert.equal(returned.reader.contentTab, 'live')
    assert.equal(
      harness.postedMessages().slice(-1)[0]?.nodeHistory,
      undefined,
      'the MCP return never reports following the run while the journal masks the application',
    )
  } finally {
    await harness.close()
  }
})

test('selecting a Node stop after the learner stops its historical debugger restarts it instead of freezing the reader', async () => {
  // Arrange: the stop was presented, then the learner ended "Codebook · Recorded learning" and stepped back to output.
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () => harness.historicalDebugPresentations.length === 1,
      'the recorded stop reaches the native debugger',
      1_000,
    )
    harness.historicalDebuggers[0]!.available = false
    harness.receiveContext({
      type: 'node-history-step',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      direction: 'previous',
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        1,
      'the learner steps back to the output event',
      1_000,
    )

    // Act: the learner selects the stop again from the event list.
    harness.receiveContext({
      type: 'node-history-event',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        2,
      'the explicit selection reaches the stop',
      1_000,
    )

    // Assert
    assert.equal(
      harness.historicalDebuggers.length,
      2,
      'a fresh historical debugger replaces the one the learner stopped',
    )
    assert.equal(
      harness.historicalDebugPresentations[1]?.snapshot?.variables[0]?.name,
      'nextTheme',
    )
    assert.equal(
      harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition
        ?.debuggerAvailable,
      true,
    )
  } finally {
    await harness.close()
  }
})

test('seeking a Node history onto a stop after the learner stops its historical debugger explains how to restart it', async () => {
  // Arrange: the learner ended "Codebook · Recorded learning" while the output event was selected.
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () => harness.historicalDebugPresentations.length === 1,
      'the recorded stop reaches the native debugger',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-step',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      direction: 'previous',
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        1,
      'the learner steps back to the output event',
      1_000,
    )
    harness.historicalDebuggers[0]!.available = false

    // Act: the time slider seeks onto the stop.
    harness.receiveContext({
      type: 'node-history-playback',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      action: 'seek',
      positionMs: 200,
    })
    await waitUntil(
      () =>
        Boolean(
          harness.reader
            .inspect()
            .view?.errors.some((error) =>
              /historical Node debugger was stopped/.test(error),
            ),
        ),
      'the seek reports why the stop was not presented',
      1_000,
    )

    // Assert
    assert.equal(
      harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence,
      1,
      'a stop the debugger cannot show is never reported as selected',
    )
    assert.equal(
      harness.historicalDebuggers.length,
      1,
      'a seek never relaunches the debugger the learner stopped',
    )
  } finally {
    await harness.close()
  }
})

test('moving to another Node history event while a stop still loads its native values reports no failure for the abandoned stop', async () => {
  // Arrange: native Run and Debug is still loading the recorded stop when the learner moves on.
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    const held = harness.holdHistoricalDebugPresentation()
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await held.started

    // Act: the result selection supersedes the pending stop, whose native presentation then rejects as the real owner does.
    harness.receiveContext({
      type: 'node-history-event',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 3,
    })
    held.reject(new Error('Historical debugger presentation was superseded.'))
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        3,
      'the newer result selection is displayed',
      1_000,
    )
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert
    // The reader view is built in the loaded module's realm; copy it so a leaked error appears in the failure message.
    assert.deepEqual(
      Array.from(harness.reader.inspect().view?.errors ?? []),
      [],
    )
    assert.equal(
      harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.type,
      'result',
    )
    assert.equal(harness.historicalDebugPresentations.length, 1)
  } finally {
    await harness.close()
  }
})

test('a Node history stop whose native presentation fails while still selected reports the failure and keeps the previous event', async () => {
  // Arrange: native Run and Debug is loading the only selected stop.
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    const held = harness.holdHistoricalDebugPresentation()
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await held.started

    // Act: no newer selection exists when the native presentation fails.
    held.reject(
      new Error(
        'Historical debugger closed. Reopen the learning replay to restore it.',
      ),
    )
    await waitUntil(
      () =>
        Boolean(
          harness.reader
            .inspect()
            .view?.errors.some((error) =>
              /Historical debugger closed/.test(error),
            ),
        ),
      'the selected stop reports its native failure',
      1_000,
    )

    // Assert
    assert.equal(
      harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence,
      1,
      'a stop the debugger could not show is never reported as selected',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a saved Node stop committed without native values names where to load them, and the hint leaves once they load; fails_when=the Node position omits the hint, or keeps it after Run and Debug loads values; why_new=Node stops share the soft inspection gate; seam=TestReplayDebugger models the native load notification
test('a saved Node stop whose values Run and Debug has not loaded tells the learner where to load them until they load', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    harness.setHistoricalDebugInspection('uninspected')
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        2,
      'the recorded Node stop is selected',
      1_000,
    )
    const withoutValues = harness.postedMessages().slice(-1)[0]!

    // Act
    harness.loadHistoricalDebugValues()
    const withValues = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.equal(
      withoutValues.nodeHistoryPosition?.nativeValuesUninspected,
      true,
    )
    assert.equal(withValues.nodeHistoryPosition?.sequence, 2)
    assert.equal(withValues.nodeHistoryPosition?.nativeValuesUninspected, false)
  } finally {
    await harness.close()
  }
})

// Value: protects=opening a browser recording while a Node stop still loads its native values; fails_when=the abandoned Node presentation reports its supersession as a Study error; why_new=openRecording now supersedes pending Node selections; seam=none
test('opening a recording while a Node history stop still loads its native values reports no failure for the abandoned stop', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    const held = harness.holdHistoricalDebugPresentation()
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await held.started

    // Act: the recording supersedes the pending stop, whose native presentation then rejects as the real owner does.
    const opening = harness.reader.openRecording(harness.studyId)
    held.reject(new Error('Historical debugger presentation was superseded.'))
    await opening
    await harness.controller.settle()
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert: the mocked editor may refuse the replay layout, so only a historical debugger failure is attributed to the abandoned stop.
    // The reader view is built in the loaded module's realm; copy it so a leaked error appears in the failure message.
    assert.deepEqual(
      Array.from(harness.reader.inspect().view?.errors ?? []).filter((error) =>
        /Historical debugger/.test(error),
      ),
      [],
    )
    assert.equal(harness.controller.state().studyId, harness.studyId)
  } finally {
    await harness.close()
  }
})

// Value: protects=a reopened reader never tells the learner to load values from a native session that closing disposed; fails_when=closing keeps the Node stop's Run and Debug hint; why_new=the session-end notification is ignored while the reader closes; seam=none
test('closing the reader drops the Run and Debug hint of a saved Node stop', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    harness.setHistoricalDebugInspection('uninspected')
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition
          ?.nativeValuesUninspected === true,
      'the stop shows the Run and Debug hint',
      1_000,
    )

    // Act
    await harness.reader.close()
    await harness.reader.open()
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        2,
      'the reopened reader restores the Node stop',
      1_000,
    )

    // Assert
    assert.equal(
      harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition
        ?.nativeValuesUninspected,
      false,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=one click from the Run and Debug hint to the recorded values; fails_when=Show Variables stops opening Run and Debug, expanding Variables or expanding its first scope, so the learner must do each by hand again; why_new=Cycle 0044 (0031-U1 / 0031-D4a); seam=vscode.commands.executeCommand, recorded by the harness
test('Show Variables opens Run and Debug with Variables expanded and then expands its first scope', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    await harness.reader.open()
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.action('show-variables')

    // Assert: Variables is focused once to open it and once more directly before the list commands.
    assert.deepEqual(harness.commands.slice(commandsBefore), [
      'workbench.debug.action.focusVariablesView',
      'workbench.debug.action.focusVariablesView',
      'list.focusFirst',
      'list.expand',
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=Show Variables on a host that registers no command that focuses Variables; fails_when=the reader runs a command without asking the host, so the button does nothing and "command … not found" stays in the Learning summary and the panel; why_new=Cycle 0044 (row 0031-U1: `workbench.debug.variablesView.focus`, which no host has, left that error in Cursor 3.23.12); seam=vscode.commands.getCommands and executeCommand, modelled by the harness
test('Show Variables on a host without a Variables focus command opens Run and Debug and leaves no error', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.removeHostCommands('workbench.debug.action.focusVariablesView')
    await harness.reader.open()
    const commandsBefore = harness.commands.length

    // Act
    harness.receiveContext({
      type: 'action',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      action: 'show-variables',
    })
    await waitUntil(
      () =>
        harness.commands.length > commandsBefore ||
        Boolean(harness.reader.inspect().view?.errors.length),
      'Show Variables ran a command or reported an error',
      1_000,
    )

    // Assert
    assert.deepEqual(
      Array.from(harness.reader.inspect().view?.errors ?? []),
      [],
    )
    assert.deepEqual(harness.commands.slice(commandsBefore), [
      'workbench.view.debug',
    ])
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=Show Variables on a host that focuses Variables but lacks a later step; fails_when=the reader runs a list command the host does not register, so the click ends in "command … not found", or it leaves Variables for the Run and Debug fallback; why_new=Cycle 0044 (row 0031-U1 in Cursor: the host is asked which commands exist); seam=vscode.commands.getCommands and executeCommand, modelled by the harness
test('Show Variables on a host with the Variables focus command runs only the steps that host registers', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.removeHostCommands('list.expand')
    await harness.reader.open()
    const commandsBefore = harness.commands.length

    // Act
    harness.receiveContext({
      type: 'action',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      action: 'show-variables',
    })
    await waitUntil(
      () =>
        harness.commands.length >= commandsBefore + 3 ||
        Boolean(harness.reader.inspect().view?.errors.length),
      'Show Variables ran its commands or reported an error',
      1_000,
    )

    // Assert
    assert.deepEqual(
      Array.from(harness.reader.inspect().view?.errors ?? []),
      [],
    )
    assert.deepEqual(harness.commands.slice(commandsBefore), [
      'workbench.debug.action.focusVariablesView',
      'workbench.debug.action.focusVariablesView',
      'list.focusFirst',
    ])
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner knowing what to do when the host can open neither Variables nor Run and Debug; fails_when=Show Variables shows a raw "command … not found" error or nothing at all on such a host; why_new=Cycle 0044 (row 0031-U1 in Cursor); seam=vscode.commands.getCommands and window.showInformationMessage, modelled by the harness
test('Show Variables on a host with neither a Variables nor a Run and Debug command tells the learner the manual step in one sentence', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.removeHostCommands(
      'workbench.debug.action.focusVariablesView',
      'workbench.view.debug',
    )
    await harness.reader.open()
    const commandsBefore = harness.commands.length

    // Act
    harness.receiveContext({
      type: 'action',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      action: 'show-variables',
    })
    await waitUntil(
      () =>
        harness.informationMessages.length > 0 ||
        Boolean(harness.reader.inspect().view?.errors.length),
      'Show Variables told the learner the manual step or reported an error',
      1_000,
    )

    // Assert
    assert.deepEqual(
      Array.from(harness.reader.inspect().view?.errors ?? []),
      [],
    )
    assert.deepEqual(harness.informationMessages, [
      {
        message:
          'Open Run and Debug and expand Variables to see the recorded values.',
        items: [],
      },
    ])
    assert.deepEqual(harness.commands.slice(commandsBefore), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=one press of Show Variables listing the recorded values when Run and Debug was not opened before; fails_when=the list commands run before the just-opened Variables tree holds the stop's rows, so nothing is expanded, the hint stays and the learner must press again; why_new=Cycle 0044 (0031-U1 in VS Code 1.140: with Explorer in front and Variables never shown, the first press left every scope collapsed); seam=the harness's fake Variables view, which fills its tree 60 ms after it asked for the scopes
test('Show Variables lists the recorded values on its first press when Run and Debug was not opened in the editor session', async () => {
  // Arrange: a recorded stop presented while the host's Variables view was never shown, so its values are not loaded.
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.setHistoricalDebugInspection('uninspected')
    harness.hideNativeVariables('never-opened')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const hintBefore = harness.postedMessages().slice(-1)[0]
      ?.recording?.nativeValuesUninspected
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.action('show-variables')

    // Assert
    assert.equal(hintBefore, true)
    assert.deepEqual(harness.nativeVariablesView(), {
      firstScopeFocused: true,
      valuesListed: true,
    })
    assert.equal(
      harness.postedMessages().slice(-1)[0]?.recording?.nativeValuesUninspected,
      false,
    )
    assert.deepEqual(harness.commands.slice(commandsBefore), [
      'workbench.debug.action.focusVariablesView',
      'workbench.debug.action.focusVariablesView',
      'list.focusFirst',
      'list.expand',
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=Show Variables leaving a Variables view alone that loads the stop by itself; fails_when=the list commands run while that view's tree is still empty (they then act on whichever list last held the focus), or the press ends before the values are listed; why_new=Cycle 0044 (0031-U1 in VS Code 1.140: a Variables view hidden while the recording moved on loads the stop 400 ms after it is shown and expands the first scope itself); seam=the harness's fake Variables view and its deferred refresh
test('Show Variables waits for a Variables view that missed the stop while hidden and sends it no list command once it listed the values itself', async () => {
  // Arrange: a recorded stop presented while the host's Variables view, which showed an earlier stop, was hidden.
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.setHistoricalDebugInspection('uninspected')
    harness.hideNativeVariables('missed-the-stop')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.action('show-variables')

    // Assert
    assert.deepEqual(harness.nativeVariablesView(), {
      firstScopeFocused: false,
      valuesListed: true,
    })
    assert.equal(
      harness.postedMessages().slice(-1)[0]?.recording?.nativeValuesUninspected,
      false,
    )
    assert.deepEqual(harness.commands.slice(commandsBefore), [
      'workbench.debug.action.focusVariablesView',
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=Show Variables ending when the host's Variables view never loads the recorded stop; fails_when=the press waits without a bound, reports an error, or stops trying the list commands a host without that signal still needs; why_new=Cycle 0044 (0031-U1: the wait for the view must not hang or fail when its signal never comes); seam=the harness's fake Variables view showing another debug session, and a faked clock
test('Show Variables finishes without an error when Run and Debug keeps showing another debug session', async (context) => {
  // Arrange: a recorded stop whose values the host's Variables view never asks for.
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.setHistoricalDebugInspection('uninspected')
    harness.hideNativeVariables('shows-another-session')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const commandsBefore = harness.commands.length
    enableFakeClock(context)

    // Act
    const press = harness.reader.action('show-variables').then(
      () => 'completed',
      (error: unknown) => String(error),
    )
    const elapsedMs = await advanceClockUntilSettled(context, press, 10_000)

    // Assert: 2,000 ms for the scopes, then 200 ms before each of the two attempts.
    assert.equal(await press, 'completed')
    assert.equal(elapsedMs, 2_400)
    assert.deepEqual(harness.commands.slice(commandsBefore), [
      'workbench.debug.action.focusVariablesView',
      'workbench.debug.action.focusVariablesView',
      'list.focusFirst',
      'list.expand',
      'workbench.debug.action.focusVariablesView',
      'list.focusFirst',
      'list.expand',
    ])
    assert.deepEqual(harness.nativeVariablesView(), {
      firstScopeFocused: false,
      valuesListed: false,
    })
    assert.equal(
      harness.postedMessages().slice(-1)[0]?.recording?.nativeValuesUninspected,
      true,
    )
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

// Value: protects=the keyboard focus of whatever list the learner went on to after closing the reader during a Show Variables press; fails_when=the press runs its list commands although the reader is closing, so list.focusFirst and list.expand act on a list that is not Variables; why_new=every other Show Variables test keeps the reader open until the press ends; seam=none
test('Show Variables on a reader that is closed while the press waits for Variables sends no list command', async (context) => {
  // Arrange: a recorded stop whose values the host's Variables view never asks for, and an editor slow to stop the recorded session.
  const harness = await recordedReaderHarness(true, true)
  let releaseDisposal = (): void => {}
  let closing: Promise<void> | undefined
  try {
    harness.setHistoricalDebugInspection('uninspected')
    harness.hideNativeVariables('shows-another-session')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const commandsBefore = harness.commands.length
    const disposal = harness.holdHistoricalDebugDisposal()
    releaseDisposal = disposal.release
    enableFakeClock(context)
    const press = harness.reader.action('show-variables').then(
      () => 'completed',
      (error: unknown) => String(error),
    )
    await advanceClock(context, 1_000)

    // Act: the learner closes the reader one second into the press's wait for the scopes.
    closing = harness.reader.close()
    await advanceClockUntilSettled(context, press, 10_000)

    // Assert
    assert.equal(await press, 'completed')
    assert.deepEqual(
      harness.commands
        .slice(commandsBefore)
        .filter((command) => command.startsWith('list.')),
      [],
    )
  } finally {
    resetFakeClock(context)
    releaseDisposal()
    await closing
    await harness.close()
  }
})

// Value: protects=no enabled Inspect on a Node stop that can never be shown natively; fails_when=the reader is told about a source mismatch only for the selected stop, so an unselected stop with edited captured text keeps an Inspect that fails on every press; why_new=Cycle 0044 (0033-F3a / 0034-C3); seam=the loaded journal entry replaced in memory by one with edited captured text
test('a shown Node stop whose captured text no longer matches its hash is reported to the reader even while another event is selected', async () => {
  // Arrange: a loaded Node history whose first event (test output) is selected.
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    const verifiedBefore =
      harness.reader.inspect().view!.nodeHistoryUnverifiedStops
    const loaded = harness.reader['selectedNodeHistory']!
    const stopIndex = loaded.entries.findIndex((entry) => entry.type === 'stop')
    const stop = loaded.entries[stopIndex]!
    assert.ok(stop.type === 'stop')

    // Act: the stop's captured text differs from the text its hash sealed.
    loaded.entries[stopIndex] = {
      ...stop,
      debuggerSnapshot: {
        ...stop.debuggerSnapshot,
        frames: stop.debuggerSnapshot.frames.map((frame, index) =>
          index === 0 && frame.source
            ? {
                ...frame,
                source: {
                  ...frame.source,
                  text: `${frame.source.text}// edited`,
                },
              }
            : frame,
        ),
      },
    }

    // Assert
    assert.deepEqual([...(verifiedBefore ?? [])], [])
    assert.deepEqual(
      [...(harness.reader.inspect().view!.nodeHistoryUnverifiedStops ?? [])],
      [stop.sequence],
    )
    assert.equal(
      harness.reader.inspect().view!.nodeHistoryPosition?.sequence,
      1,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Inspect offered again for a saved Node stop after closing disposed its native session; fails_when=close() keeps the stop's debugger availability, so the reopened reader hides Inspect although no session shows the stop; why_new=Cycle 0044 (0032-T6d / 0033-S7c); seam=none
test('a saved Node stop shown in Run and Debug before the reader closed offers Inspect again after the reader reopens', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition
          ?.debuggerAvailable === true,
      'the Node stop shows its values in Run and Debug',
      1_000,
    )

    // Act
    await harness.reader.close()
    await harness.reader.open()
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        2,
      'the reopened reader restores the Node stop',
      1_000,
    )

    // Assert: no native session shows the stop, so Inspect (offered while debuggerAvailable is false) is back.
    const reopened = harness.postedMessages().slice(-1)[0]!
    assert.equal(reopened.nodeHistoryPosition?.sourceAvailable, true)
    assert.equal(reopened.nodeHistoryPosition?.debuggerAvailable, false)
  } finally {
    await harness.close()
  }
})

// Value: protects=the two debugger notifications keeping their own meaning for a saved Node stop; fails_when=a values-loaded notification is handled like an ended session, so the stop that Run and Debug now shows is marked unavailable and offers Inspect again; why_new=Cycle 0044 (0032-T6h, "the reason mapping": only the session-ended branch had a failing control); seam=TestReplayDebugger models the native load notification
test('native values loading for a saved Node stop drops its Run and Debug hint and keeps the stop shown in the native debugger', async () => {
  // Arrange: a selected Node stop committed without native values.
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    harness.setHistoricalDebugInspection('uninspected')
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition
          ?.nativeValuesUninspected === true,
      'the stop shows the Run and Debug hint',
      1_000,
    )
    const beforeValuesLoad = harness.postedMessages().slice(-1)[0]!
      .nodeHistoryPosition

    // Act
    harness.loadHistoricalDebugValues()

    // Assert
    const afterValuesLoad = harness.postedMessages().slice(-1)[0]!
      .nodeHistoryPosition
    assert.equal(beforeValuesLoad?.debuggerAvailable, true)
    assert.equal(afterValuesLoad?.nativeValuesUninspected, false)
    assert.equal(afterValuesLoad?.debuggerAvailable, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a refused recording open leaves a Node stop that is still loading its native values to finish; fails_when=openRecording abandons the Node selection before its own admission checks pass; why_new=the supersede test only covers an admitted recording; seam=none
test('a refused recording open lets a loading Node history stop finish its selection', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    const held = harness.holdHistoricalDebugPresentation()
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await held.started

    // Act
    await assert.rejects(harness.reader.openRecording('not a saved study'))
    held.release()

    // Assert
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        2,
      'the Node stop finishes its selection',
      1_000,
    )
  } finally {
    await harness.close()
  }
})

test('sealed repository source remains restorable before the first debugger observation', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  try {
    const library = await harness.reader.learningStorage(),
      fixture = createConfiguredStudy()
    const study = {
      ...fixture,
      workspaceKey: library.workspaceKey,
      state: 'ready',
      terminal: false,
      finalOutcome: 'pending-teardown' as const,
      operation: undefined,
      observations: [],
      captures: [],
    }
    await library.saveStudy(study)
    await harness.reader.open()
    harness.receive({
      type: 'history',
      revision: harness.reader.inspect().view!.revision,
      studyId: study.id,
    })
    await waitUntil(
      () =>
        harness.reader.inspect().view!.model.selection.studyId === study.id &&
        !harness.reader.inspect().view!.loading,
      'sealed repository source',
      1_000,
    )
    const uri = harness.reader['sourceUri']
    assert.ok(uri)
    // Act: an editor restart must resolve this URI from persisted bytes, without its transient cache.
    harness.reader['documents'].clear()
    const restored = await harness.reader['provideSource'](uri)
    // Assert
    assert.ok(uri.path.startsWith(`/${study.id}/`))
    assert.equal(restored, 'const nextTheme = "dark";\n')
    assert.equal(harness.reader.inspect().view!.model.observation, undefined)
  } finally {
    await harness.close()
  }
})

test('saving without a captured session leaves the learning status hidden', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    // Act / Assert
    await assert.rejects(
      harness.reader.saveLearningReplay(),
      /No recorded Codebook session/,
    )
    assert.equal(harness.saveStatus.visible, false)
  } finally {
    await harness.close()
  }
})

test('explicit learning save verifies durable context and labels missing summary and debugger history as partial', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    const library = await harness.reader.learningStorage(),
      progress = await library.readProgress()
    // Act
    await harness.reader.saveLearningReplay(harness.studyId)
    // Assert
    await harness.store.readContext(harness.studyId)
    assert.equal(
      harness.saveStatus.text,
      '$(warning) Learning partially saved · Open replay',
    )
    assert.match(harness.saveStatus.tooltip, /learning summary and sequence/)
    assert.match(harness.saveStatus.tooltip, /recorded debugger history/)
    assert.deepEqual(structuredClone(harness.saveStatus.command), {
      title: 'Open learning replay',
      command: 'codebook.openLearningReplay',
      arguments: [harness.studyId],
    })
    assert.deepEqual(await library.readProgress(), progress)
  } finally {
    await harness.close()
  }
})

test('a stale save button cannot finalize a different recorded session', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    const receipt = harness.record.historyReceipt
    // Act / Assert
    await assert.rejects(
      harness.reader.saveLearningReplay('another-session'),
      /recorded session changed/,
    )
    assert.equal(harness.record.historyReceipt, receipt)
  } finally {
    await harness.close()
  }
})

test('failed explicit learning context save stays retryable without replacing durable history with success', async (context) => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    const failure = context.mock.method(
      RecordingStore.prototype,
      'saveContext',
      async () => {
        throw new Error('Disk unavailable')
      },
    )
    // Act
    await assert.rejects(
      harness.reader.saveLearningReplay(harness.studyId),
      /Disk unavailable/,
    )
    // Assert
    assert.equal(
      harness.saveStatus.text,
      '$(error) Learning save failed · Retry',
    )
    assert.deepEqual(structuredClone(harness.saveStatus.command), {
      title: 'Save learning replay',
      command: 'codebook.saveLearningReplay',
      arguments: [harness.studyId],
    })
    failure.mock.restore()
    await harness.reader.saveLearningReplay(harness.studyId)
    await harness.store.readContext(harness.studyId)
    assert.equal(
      harness.saveStatus.text,
      '$(warning) Learning partially saved · Open replay',
    )
  } finally {
    await harness.close()
  }
})

test('repeated save clicks share finalization and keep the pending status non-actionable', async (context) => {
  // Arrange
  const harness = await recordedReaderHarness()
  let release!: () => void, entered!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const original = harness.service.stop.bind(harness.service)
  let stops = 0
  context.mock.method(
    harness.service,
    'stop',
    async (input: Parameters<typeof harness.service.stop>[0]) => {
      stops++
      entered()
      await hold
      return original(input)
    },
  )
  try {
    // Act
    const first = harness.reader.saveLearningReplay(harness.studyId)
    await started
    const second = harness.reader.saveLearningReplay(harness.studyId)
    // Assert
    assert.equal(harness.saveStatus.text, '$(sync~spin) Saving learning…')
    assert.equal(harness.saveStatus.command, undefined)
    assert.equal(stops, 1)
    release()
    await Promise.all([first, second])
    assert.equal(stops, 1)
    assert.equal(
      harness.saveStatus.text,
      '$(warning) Learning partially saved · Open replay',
    )
  } finally {
    release()
    await harness.close()
  }
})

test('saving an active explanation stops only its owned capture and retains the recorded learning', async () => {
  // Arrange
  const harness = await workspaceHarness(true, true)
  try {
    harness.acknowledgeContext()
    harness.service.environment.build.sourceHash = sha256('active-save-build')
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: 'save-active',
    })
    const record = [...harness.service.records.values()][0]!
    await record.preparation
    harness.clock(100)
    await harness.reader.action('click')
    assert.equal(record.stopped, false)
    assert.match(harness.saveStatus.text, /Recording explanation/)
    // Act
    await harness.reader.saveLearningReplay(
      `${harness.service.instanceId}_${record.id}`,
    )
    // Assert
    assert.equal(record.stopped, true)
    assert.equal(record.historyReceipt?.status, 'saved')
    assert.equal(record.recordingReceipt?.status, 'saved')
    assert.equal(
      harness.saveStatus.text,
      '$(warning) Learning partially saved · Open replay',
    )
  } finally {
    await harness.close()
  }
})

test('a later explanation invalidates the earlier save label until its new content is explicitly saved', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.saveLearningReplay(harness.studyId)
    const snapshotUri = harness.service.state(harness.record).participants
      .browser.snapshotUri!
    const archive = await (
      await harness.reader.learningStorage()
    ).readCheckpoint(harness.studyId)
    // Act
    await harness.service.explain({
      instanceId: harness.service.instanceId,
      runId: harness.record.id,
      key: 'later-explanation',
      snapshotUri,
      sourceHash: archive.study.observations[0]!.source.hash,
      valuePaths: ['value:nextTheme'],
      interpretation:
        'The recorded selected theme is dark; no additional execution is claimed.',
    })
    harness.reader['publish']()
    // Assert
    assert.equal(
      harness.saveStatus.text,
      '$(save) Recording finished · Save learning replay',
    )
  } finally {
    await harness.close()
  }
})

test('editor Settings changes recover full study and recording storage without recreating the workspace', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.setSavedStudyCapacity(1)
    const library = await harness.reader.learningStorage(),
      recordings = harness.service.recordings!
    const study = createConfiguredStudy()
    study.workspaceKey = library.workspaceKey
    const binding = {
      workspaceKey: library.workspaceKey,
      studyId: study.id,
      instanceId: study.instanceId,
      runId: study.runId,
      runtimeId: randomUUID(),
      profile: study.profile,
      sourceBuild: {
        revision: 'settings-test',
        dirty: false,
        sourceHash: '1'.repeat(64),
      },
    }
    await library.saveStudy(study)
    await (await recordings.start(binding, 0)).finish(1)
    const next = structuredClone(study),
      runId = randomUUID()
    for (const observation of next.observations)
      observation.snapshotUri = observation.snapshotUri.replace(
        next.runId,
        runId,
      )
    next.runId = runId
    next.id = `${next.instanceId}_${runId}`
    const nextBinding = {
      ...binding,
      runId,
      studyId: next.id,
      runtimeId: randomUUID(),
    }
    await assert.rejects(library.saveStudy(next), /full/)
    await assert.rejects(recordings.start(nextBinding, 0), /full/)
    // Act
    harness.setSavedStudyCapacity(2)
    await library.saveStudy(next)
    await (await recordings.start(nextBinding, 0)).finish(1)
    // Assert
    assert.equal((await library.list()).length, 2)
    assert.equal((await recordings.list()).length, 2)
    assert.equal((await harness.service.status()).recording?.capacity.limit, 2)
    harness.setSavedStudyCapacity('invalid')
    assert.match(
      (await harness.service.status()).recording?.capacity.error ?? '',
      /codebook.savedStudyLimit/,
    )
    assert.equal((await recordings.list()).length, 2)
  } finally {
    await harness.close()
  }
})

for (const separateChat of [false, true])
  test(`live explanation reserves app and source without a custom explanation pane${separateChat ? ' while preserving a separate chat' : ''}`, async () => {
    // Arrange
    const harness = await workspaceHarness()
    try {
      harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
      const chat = separateChat ? harness.addSeparateEditorPart() : undefined
      const chatLayout = chat?.layout()
      harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      const record = [...harness.service.records.values()][0]!
      await record.preparation
      // Act
      await harness.reader.open()
      // Assert
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(harness.reader.inspect().presentation.panes.sourceColumn, 2)
      assert.equal(harness.reader.inspect().presentation.layoutConfirmed, true)
      assert.equal(harness.nativePanels().length, 1)
      assert.equal(harness.groups.length, separateChat ? 3 : 2)
      assert.deepEqual(harness.editorLayout(), {
        orientation: 1,
        groups: [{ size: 0.5 }, { size: 0.5 }],
      })
      assert.deepEqual(chat?.layout(), chatLayout)
      assert.equal(harness.runtimes[0]!.dispatches, 0)
    } finally {
      await harness.close()
    }
  })

test('live Restore refuses a late native receipt loss instead of claiming recovery', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    const chat = harness.addSeparateEditorPart()
    const chatLayout = chat.layout()
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await [...harness.service.records.values()][0]!.preparation
    await harness.reader.open()
    harness.reader['layoutReceipt'] = undefined
    harness.reader['presentationConfirmed'] = false
    const arrange = harness.reader['arrange'].bind(harness.reader)
    harness.reader['arrange'] = async (...args): Promise<void> => {
      await arrange(...args)
      harness.reader['layoutReceipt'] = undefined
    }
    chat.focus()
    const current = harness.reader.presentationState()
    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: current.presentationId,
        expectedRevision: current.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        causeDetail: /native editor layout receipt/,
      },
    )
    // Assert
    assert.deepEqual(chat.layout(), chatLayout)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.runtimes[0]!.dispatches, 0)
  } finally {
    await harness.close()
  }
})

test('starting live explanation retires only its previous empty explanation group', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    const chat = harness.addSeparateEditorPart()
    await harness.reader.open()
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await [...harness.service.records.values()][0]!.preparation
    // Act
    await harness.reader.open()
    // Assert
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.groups.at(-1)!.tabs[0], chat.tab)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 0.25 }, { size: 0.25 }],
    })
    assert.equal(harness.reader.inspect().presentation.layoutConfirmed, true)
  } finally {
    await harness.close()
  }
})

test('a normal chat run retires the explanation pane without reopening the reader', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    const chat = harness.addSeparateEditorPart()
    await harness.reader.open()
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await [...harness.service.records.values()][0]!.preparation
    // Act: the ordinary chat starts execution without requesting another Open.
    await harness.reader.action('click')
    // Assert
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.groups.at(-1)!.tabs[0], chat.tab)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 0.25 }, { size: 0.25 }],
    })
    assert.equal(harness.reader.inspect().presentation.layoutConfirmed, true)
  } finally {
    await harness.close()
  }
})

test('saved replay restores its summary after a native-chat-only live explanation', async () => {
  // Arrange
  const harness = await workspaceHarness(true, true)
  try {
    harness.service.environment.build.sourceHash = sha256(
      'live-composition-build',
    )
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    harness.acknowledgeContext()
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = [...harness.service.records.values()][0]!
    await record.preparation
    await harness.reader.open()
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
      'base64',
    )
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
    harness.clock(100)
    await harness.reader.action('click')
    harness.clock(200)
    await harness.reader.action('stop')
    // Act
    await harness.reader.openRecording(record.recording!.header.studyId)
    await harness.service.playbackController!.settle()
    // Assert
    assert.equal(harness.service.playbackController!.state().readiness, 'ready')
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.reader.inspect().view!.contentTab, 'recording')
    assert.equal(harness.nativePanels().length, 1)
    assert.equal(harness.summary.visible, true)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 0.5 }, { size: 0.5 }],
    })
    const playback = harness.service.playbackController!
    harness.hideSummary()
    playback.command({
      action: 'seek',
      studyId: record.recording!.header.studyId,
      expectedRevision: playback.state().revision,
      positionMs: 100,
    })
    await playback.settle()
    assert.equal(playback.state().readiness, 'ready')
    const revision = playback.state().revision,
      position = playback.state().presentedMs
    await harness.reader.showLearningSummary()
    assert.equal(harness.summary.visible, true)
    assert.equal(playback.state().revision, revision)
    assert.equal(playback.state().presentedMs, position)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await harness.close()
  }
})

test('live entry preserves a learner document sharing the former explanation group', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    await harness.reader.open()
    const draft = harness.focusMutableDraft('my-notes.txt', 3)
    draft.replaceContent('Keep my unsaved notes.')
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await [...harness.service.records.values()][0]!.preparation
    // Act
    await harness.reader.open()
    // Assert
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.groups[2]!.tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Keep my unsaved notes.')
    assert.equal(draft.tab.isDirty, true)
    assert.equal(
      harness.focusedSource()?.document.uri.toString(),
      draft.document.uri.toString(),
    )
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(harness.reader.inspect().presentation.layoutConfirmed, true)
  } finally {
    await harness.close()
  }
})

for (const departure of ['draft', 'window round trip'] as const)
  test(`replay Restore preserves newer ${departure} intent during native unmaximize`, async () => {
    // Arrange
    const harness = await recordedReaderHarness()
    let release = (): void => {}
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      await harness.reader.action('read-source')
      const state = harness.reader.presentationState(),
        playback = harness.controller.state()
      const layouts = harness.commands.filter(
        (command) => command === 'vscode.setEditorLayout',
      ).length
      const held = harness.holdNextCommand(
        'workbench.action.minimizeOtherEditors',
      )
      release = held.release
      const restoring = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      const rejected = assert.rejects(
        restoring,
        /learner changed native tab focus/,
      )
      await held.started
      // Act
      const draft =
        departure === 'draft' ? harness.focusMutableDraft() : undefined
      if (departure === 'window round trip') {
        harness.changeWindowFocus(false)
        harness.changeWindowFocus(true)
      }
      held.release()
      await rejected
      // Assert
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        layouts,
      )
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      assert.deepEqual(harness.controller.state(), playback)
      if (draft) {
        assert.equal(
          harness.focusedSource()?.document.uri.toString(),
          draft.document.uri.toString(),
        )
        assert.equal(draft.document.getText(), 'Original learner draft.\n')
      }
    } finally {
      release()
      harness.changeWindowFocus(true)
      await harness.close()
    }
  })

test('reading the replay summary leaves an unfocused work window and historical position untouched', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.hideSummary()
    harness.changeWindowFocus(false)
    const commands = harness.commands.length,
      playback = harness.controller.state()
    // Act / Assert
    await assert.rejects(
      harness.reader.action('read-context'),
      /Focus the Codebook work window/,
    )
    assert.equal(harness.commands.length, commands)
    assert.equal(harness.summary.visible, false)
    assert.deepEqual(harness.controller.state(), playback)
  } finally {
    harness.changeWindowFocus(true)
    await harness.close()
  }
})

test('a window round trip during summary opening cannot confirm an obsolete focus request', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  let release = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const playback = harness.controller.state(),
      subscriptions = harness.windowFocusListeners()
    const held = harness.holdNextCommand('codebook.learningSummary.focus')
    release = held.release
    const opening = harness.reader.showLearningSummary(),
      rejected = assert.rejects(opening, /work window lost focus/)
    await held.started
    // Act
    harness.changeWindowFocus(false)
    harness.changeWindowFocus(true)
    held.release()
    await rejected
    // Assert
    assert.deepEqual(harness.controller.state(), playback)
    assert.equal(harness.windowFocusListeners(), subscriptions)
  } finally {
    release()
    harness.changeWindowFocus(true)
    await harness.close()
  }
})

// Value: protects=Cursor's learner being told how to keep the Learning summary on the right; fails_when=the reader shows the summary where Cursor put it (the primary side bar) and never says so, or offers the move again on every replay; why_new=Cycle 0044 (0031-U2: Cursor rejects the secondarySidebar container and its chat containers refuse added views); seam=vscode.env.appName, showInformationMessage and executeCommand stubs
test('in Cursor the first shown Learning summary offers the Move View step once, and choosing it opens the move list for the summary', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    harness.useHostAppName('Cursor')
    harness.answerInformationMessages(async ([move]) => move)
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Act
    await harness.reader.showLearningSummary()
    await waitUntil(
      () => harness.commands.includes('workbench.action.moveFocusedView'),
      'the Move View list for the Learning summary',
      1_000,
    )
    await harness.reader.showLearningSummary()
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert
    assert.deepEqual(harness.informationMessages, [
      {
        message:
          'Cursor opens the Codebook Learning summary in its primary side bar. To keep it on the right, move it once: choose "New Secondary Side Bar Entry" in the list that opens.',
        items: ['Move Learning Summary…'],
      },
    ])
    assert.equal(
      harness.commands.filter(
        (command) => command === 'workbench.action.moveFocusedView',
      ).length,
      1,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=Cursor's learner being offered the move again after an offer nobody answered; fails_when=the offer is recorded as made before it is shown, so a notification Cursor removed after 15 s is never offered again in that workspace; why_new=Cycle 0045 NF-25 (the stored key meant "offered", not "answered"); seam=a second reader over the same workspace state stands for the next editor session
test('an unanswered Move Learning Summary offer is made again in the next editor session', async () => {
  // Arrange: in Cursor the offer was made after the summary was shown, and its notification went away unanswered.
  const harness = await recordedReaderHarness()
  let nextSession: ReturnType<typeof harness.createReader> | undefined
  try {
    harness.useHostAppName('Cursor')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await waitUntil(
      () => harness.informationMessages.length === 1,
      'the offer of the first editor session',
      1_000,
    )
    await harness.reader.showLearningSummary()
    const offersInFirstSession = harness.informationMessages.length
    await harness.reader.dispose()

    // Act: the editor is started again and the same recording is opened.
    nextSession = harness.createReader()
    await nextSession.attach(harness.service)
    await nextSession.openRecording(harness.studyId)
    await harness.service.playbackController!.settle()
    await waitUntil(
      () => harness.informationMessages.length > offersInFirstSession,
      'the offer of the next editor session',
      1_000,
    ).catch(() => undefined)

    // Assert: once per session, and again in the next one. Between them the first session's reader was disposed while its Application pane was the active editor, so the active editor group got the keyboard and the learner was told (Cycle 0046 row 342).
    assert.equal(offersInFirstSession, 1)
    assert.deepEqual(harness.informationMessages, [
      {
        message:
          'Cursor opens the Codebook Learning summary in its primary side bar. To keep it on the right, move it once: choose "New Secondary Side Bar Entry" in the list that opens.',
        items: ['Move Learning Summary…'],
      },
      {
        message:
          'Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.',
        items: [],
      },
      {
        message:
          'Cursor opens the Codebook Learning summary in its primary side bar. To keep it on the right, move it once: choose "New Secondary Side Bar Entry" in the list that opens.',
        items: ['Move Learning Summary…'],
      },
    ])
  } finally {
    await nextSession?.dispose()
    await harness.close()
  }
})

// Value: protects=a way to move the Learning summary that stays after Cursor removed the offer's notification; fails_when=the reader does not turn on, from activation on, the context key that shows "Move Learning Summary…" in the summary's title and the Command Palette, or the command behind it no longer opens the editor's Move View list for the summary; why_new=Cycle 0045 NF-25 as DR-9 (Cursor removes an information notification with a button after 15 s, so a notification cannot be the only way); seam=the harness keeps the context keys set with setContext, and a reader created after the host was named stands for Cursor's activation
test("in Cursor the Learning summary offers Move Learning Summary… in its title after the offer's notification is gone", async () => {
  // Arrange: Cursor activates the extension, which constructs the reader.
  const harness = await recordedReaderHarness()
  let cursorSession: ReturnType<typeof harness.createReader> | undefined
  try {
    await harness.reader.dispose()
    harness.useHostAppName('Cursor')
    const controlBeforeActivation = harness.contextKey(
      'codebook.learningSummaryMovable',
    )
    cursorSession = harness.createReader()
    const controlAtActivation = harness.contextKey(
      'codebook.learningSummaryMovable',
    )
    await cursorSession.attach(harness.service)
    await cursorSession.openRecording(harness.studyId)
    await harness.service.playbackController!.settle()
    await waitUntil(
      () => harness.informationMessages.length === 1,
      'the offer, which goes away unanswered',
      1_000,
    )
    const moveListsBefore = harness.commands.filter(
      (command) => command === 'workbench.action.moveFocusedView',
    ).length

    // Act: the learner presses the title action, which runs the contributed command, and shows the summary again.
    await cursorSession.moveLearningSummary()
    await cursorSession.showLearningSummary()
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert: the control is on from activation, it opens the Move View list, and the step once taken is not offered again.
    assert.equal(controlBeforeActivation, undefined)
    assert.equal(controlAtActivation, true)
    assert.equal(harness.contextKey('codebook.learningSummaryMovable'), true)
    assert.equal(moveListsBefore, 0)
    assert.equal(
      harness.commands.filter(
        (command) => command === 'workbench.action.moveFocusedView',
      ).length,
      1,
    )
    assert.equal(harness.informationMessages.length, 1)
  } finally {
    await cursorSession?.dispose()
    await harness.close()
  }
})

// Value: protects=Cursor's learner being told why the Learning summary left the screen at Show Variables and how to keep both in view; fails_when=Run and Debug takes the summary's place in the shared side bar and nothing is offered, so the summary and the recorded values are never on screen together; why_new=Cycle 0045 NF-9 as DR-9 (second native round, candidate 14: after one press Run and Debug stayed in front and no Move offer appeared); seam=the harness's Variables focus command hides the summary, as Cursor's shared side bar does
test("in Cursor, Show Variables that took the Learning summary's place in the side bar offers the Move View step", async () => {
  // Arrange: Cursor, where the summary shares its side bar with Run and Debug; the recording is open with its summary in front, and the offer made at the open went away unanswered.
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.useHostAppName('Cursor')
    harness.shareSummarySideBarWithRunAndDebug()
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await waitUntil(
      () => harness.informationMessages.length === 1,
      'the unanswered offer made at the open',
      1_000,
    )
    const summaryInFrontBeforeThePress = harness.summary.visible
    harness.answerInformationMessages(async ([move]) => move)

    // Act: one press of Show Variables, which the learner answers with the offered step, and a second press.
    await harness.reader.action('show-variables')
    await waitUntil(
      () => harness.commands.includes('workbench.action.moveFocusedView'),
      'the Move View list for the Learning summary',
      1_000,
    )
    await harness.reader.action('show-variables')
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert: the offer says what happened, is made once in the session, and its button opens the Move View list.
    assert.equal(summaryInFrontBeforeThePress, true)
    assert.equal(harness.summary.visible, false)
    assert.deepEqual(harness.informationMessages.slice(1), [
      {
        message:
          "Run and Debug took the Learning summary's place in Cursor's side bar. Move the summary to the right once to keep both in view.",
        items: ['Move Learning Summary…'],
      },
    ])
    assert.equal(
      harness.commands.filter(
        (command) => command === 'workbench.action.moveFocusedView',
      ).length,
      1,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's source highlight standing, before the first pause, where the run requested its stop; fails_when=the reader does not hand the run's planned line to the pane's model, so the highlight stays on a declared line the debugger cannot pause on and jumps at the pause; why_new=Cycle 0045 SD-16 (the projection read the configuration's declared line and the reader passed nothing of the run's journal); seam=the fake runtime's view gains the journal entry a run writes when it requests a stop after its declared line
test('before the first pause of a run whose stop was requested after its declared line, the Study pane and the source highlight stand on the requested line', async () => {
  // Arrange: a prepared run that has not paused, whose journal says its stop, declared on line 1, was requested on line 2.
  const harness = await workspaceHarness()
  try {
    await harness.reader.open()
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await [...harness.service.records.values()][0]!.preparation
    await waitUntil(
      () =>
        harness.reader.inspect().view?.model.selection.studyId !== undefined,
      'the reader to select the live run',
      2_000,
    )
    /** The line of the source editor the reader showed last. */
    const highlightedLine = (): number | undefined =>
      harness.displayedSourceLines().at(-1)
    const declaredLine = harness.configuration.source.line
    await waitUntil(
      () => highlightedLine() === declaredLine,
      'the source shown at its declared line',
      2_000,
    )
    const modelLineBeforeTheRequestIsKnown =
      harness.reader.inspect().view!.model.source.line
    const runtime = harness.runtimes[0]!,
      view = runtime.view.bind(runtime)

    // Act: the run journals the request, and the reader's periodic refresh follows it.
    runtime.view = () => ({
      ...view(),
      events: [
        ...view().events,
        {
          sequence: view().events.length + 1,
          elapsedMs: 0,
          wallTime: new Date(0).toISOString(),
          type: 'breakpoint.armed-after-declared-line',
          detail: {
            participant: 'browser',
            declared: { line: declaredLine, column: 1 },
            armed: { line: declaredLine + 1, column: 1 },
          },
        },
      ],
    })
    await waitUntil(
      () => highlightedLine() !== declaredLine,
      'the source highlight to follow the requested line',
      2_000,
    ).catch(() => undefined)

    // Assert: the model and the source editor's highlight both stand on the requested line, without a pause.
    assert.equal(harness.reader.inspect().view!.model.observation, undefined)
    assert.equal(modelLineBeforeTheRequestIsKnown, declaredLine)
    assert.equal(
      harness.reader.inspect().view!.model.source.line,
      declaredLine + 1,
    )
    assert.equal(highlightedLine(), declaredLine + 1)
  } finally {
    await harness.close()
  }
})

/** Counts how often the reader ran the editor's command that focuses the active editor group. @example focusEditorGroupRuns(harness.commands) // => 1 */
function focusEditorGroupRuns(commands: readonly string[]): number {
  return commands.filter(
    (command) => command === 'workbench.action.focusActiveEditorGroup',
  ).length
}

/** Waits past the bound in which a hidden summary's report that it lost the focus can still arrive, so a focus command that was going to run has run. @example await pastSummaryFocusRelease() */
function pastSummaryFocusRelease(): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, SUMMARY_FOCUS_RELEASE_WAIT_MS + 150),
  )
}

// Value: protects=the keyboard staying usable after the learner closes the side bar from the Learning summary in Cursor; fails_when=the summary's view is hidden while its document holds the focus and nothing moves the focus, so it stays in the hidden webview and no visible element has it; why_new=Cycle 0045 NF-17 as DR-20 (native observation of 2026-10-04, Cursor 3.23.12: the active element was still the summary's hidden iframe after its side bar closed); seam=the pane's focus report is delivered as its message, and the fake summary view is hidden as the editor hides it
test('closing the side bar while the Learning summary holds the keyboard focus moves the focus to the active editor group', async () => {
  // Arrange: a recording is open with its summary in front, and the summary's document reported that it gained the focus.
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.receive({ type: 'pane-focus', focused: true })
    const runsBefore = focusEditorGroupRuns(harness.commands)

    // Act: the learner closes the side bar and the document reports nothing more; later the view is hidden once more without a new report.
    harness.hideSummary()
    const runsAtTheHideEvent = focusEditorGroupRuns(harness.commands)
    await pastSummaryFocusRelease()
    const runsAfterClosing = focusEditorGroupRuns(harness.commands)
    harness.hideSummary()
    await pastSummaryFocusRelease()

    // Assert: one focus command for the summary that held the focus, after the wait for its report, and none for the repeated event.
    assert.equal(runsAtTheHideEvent, runsBefore)
    assert.equal(runsAfterClosing, runsBefore + 1)
    assert.equal(focusEditorGroupRuns(harness.commands), runsBefore + 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=the focus of a chat, a terminal or Run and Debug the learner went on to; fails_when=the reader runs the editor-group focus command for every hidden summary, also after its document reported that it lost the focus; why_new=Cycle 0045 NF-17 as DR-20 (package S2 found the host had no focus signal and did not ship a rule that would take the focus from where the learner types); seam=the pane's two focus reports are delivered as its messages
test('closing it after the learner went to another part leaves the focus where it is', async () => {
  // Arrange: the summary's document gained the focus and lost it again when the learner went to another part of the editor.
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.receive({ type: 'pane-focus', focused: true })
    harness.receive({ type: 'pane-focus', focused: false })
    const runsBefore = focusEditorGroupRuns(harness.commands)

    // Act
    harness.hideSummary()
    await pastSummaryFocusRelease()

    // Assert
    assert.equal(focusEditorGroupRuns(harness.commands), runsBefore)
  } finally {
    await harness.close()
  }
})

// Value: protects=the view the learner opened in the summary's place keeping the keyboard (the Explorer in Cursor's side bar, the chat in VS Code's secondary side bar); fails_when=the reader acts at the visibility event, before the summary's document could report that it lost the focus, and pulls the focus out of the view the learner just opened; why_new=Cycle 0045 NF-17 (the hide is the editor's event and the report a message from the webview, so the report can arrive second); seam=the fake summary view is hidden first and the pane's report delivered after it
test('opening another view in the Learning summary’s place leaves the keyboard focus in that view when the summary reports the lost focus after it was hidden', async () => {
  // Arrange: the summary's document holds the focus.
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.receive({ type: 'pane-focus', focused: true })
    const runsBefore = focusEditorGroupRuns(harness.commands)

    // Act: the editor hides the summary's view, and only then the document's report that it lost the focus arrives.
    harness.hideSummary()
    harness.receive({ type: 'pane-focus', focused: false })
    await pastSummaryFocusRelease()

    // Assert
    assert.equal(focusEditorGroupRuns(harness.commands), runsBefore)
  } finally {
    await harness.close()
  }
})

// Value: protects=Show Variables ending with the keyboard focus in Run and Debug in Cursor; fails_when=the summary that Run and Debug displaced in the shared side bar is taken for a closed side bar and the focus is sent to the editor group, away from Variables; why_new=Cycle 0045 NF-17 with DR-24 (the Variables focus command hides the summary on purpose there, and the document's blur report can arrive after the view was hidden); seam=the harness's Variables focus command hides the summary, as Cursor's shared side bar does
test('in Cursor, Show Variables pressed in the Learning summary leaves the keyboard focus in Run and Debug when its view takes the summary’s place', async () => {
  // Arrange: Cursor's shared side bar, a recording open with its summary in front, and the summary's document holding the focus.
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.useHostAppName('Cursor')
    harness.shareSummarySideBarWithRunAndDebug()
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.receive({ type: 'pane-focus', focused: true })
    const summaryInFrontBeforeThePress = harness.summary.visible,
      runsBefore = focusEditorGroupRuns(harness.commands)

    // Act: the press, with no report of the summary's document arriving at all.
    await harness.reader.action('show-variables')
    await pastSummaryFocusRelease()

    // Assert: Run and Debug took the summary's place, and no command moved the focus out of it.
    assert.equal(summaryInFrontBeforeThePress, true)
    assert.equal(harness.summary.visible, false)
    assert.equal(focusEditorGroupRuns(harness.commands), runsBefore)
  } finally {
    await harness.close()
  }
})

test('in VS Code, which accepts the secondary side bar container, showing the Learning summary offers no move', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Act
    await harness.reader.showLearningSummary()
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert: no notification, and no Move Learning Summary… control in the summary's title.
    assert.deepEqual(harness.informationMessages, [])
    assert.equal(
      harness.contextKey('codebook.learningSummaryMovable'),
      undefined,
    )
  } finally {
    await harness.close()
  }
})

test('closing replay rejects late summary controls and leaves saved learning unchanged', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    assert.equal(harness.controller.state().readiness, 'ready')
    await harness.reader.close()
    const before = harness.reader.inspect(),
      playback = harness.controller.state(),
      preference = await harness.store.readPreference()
    const library = await harness.reader.learningStorage(),
      progress = await library.readProgress()

    // Act: a queued renderer message cannot renew a closed reader, even with its latest revision.
    harness.receive({
      type: 'tab',
      tab: 'overview',
      revision: before.view!.revision,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(harness.controller.state().mode, 'paused')
    assert.equal(harness.controller.state().cleared, true)
    assert.deepEqual(harness.controller.state(), playback)
    assert.deepEqual(harness.reader.inspect().view, before.view)
    assert.deepEqual(await harness.store.readPreference(), preference)
    assert.deepEqual(await library.readProgress(), progress)
    assert.match(harness.summary.webview.html, /Open saved learning/)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await harness.close()
  }
})

test('restoring the live layout cannot recreate a custom explanation pane or select a retired variant', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] })
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await [...harness.service.records.values()][0]!.preparation
    await harness.reader.open()
    const state = harness.reader.presentationState()
    // Act
    const restored = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })
    // Assert
    assert.equal(restored.state, 'open')
    assert.equal(restored.layoutConfirmed, true)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.throws(
      () =>
        harness.reader.changePresentation({
          presentationId: restored.presentationId,
          expectedRevision: restored.presentationControlRevision,
          mode: 'living-book',
          action: 'select',
        }),
      /one app\/source layout/,
    )
    assert.equal(harness.groups.length, 2)
  } finally {
    await harness.close()
  }
})

test('bottom playback remains available with the summary collapsed and restores fallback when hidden', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const original = harness.controller.state()
    // Act
    harness.hideSummary()
    // Assert
    assert.equal(harness.playbackPanel.visible, true)
    assert.equal(
      harness.playbackPanelMessages.at(-1)?.playbackPanelVisible,
      true,
    )
    assert.deepEqual(harness.controller.state(), original)
    // Act: the still-visible panel remains the only playback controller while summary is hidden.
    const view = harness.playbackPanelMessages.at(-1)!
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'seek',
      positionMs: 150,
      revision: view.revision,
      expectedRevision: original.revision,
    })
    await new Promise((resolve) => setImmediate(resolve))
    await harness.controller.settle()
    assert.equal(harness.controller.state().presentedMs, 150)
    const moved = harness.controller.state()
    // Act
    harness.hidePlaybackPanel()
    // Assert
    assert.equal(
      harness.playbackPanelMessages.at(-1)?.playbackPanelVisible,
      false,
    )
    assert.deepEqual(harness.controller.state(), moved)
  } finally {
    await harness.close()
  }
})

test('disposed bottom playback documents cannot move the selected recorded moment', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const playback = harness.controller.state(),
      view = harness.playbackPanelMessages.at(-1)!
    harness.disposePlaybackPanel()
    // Act
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'seek',
      positionMs: 150,
      revision: view.revision,
      expectedRevision: playback.revision,
    })
    await harness.controller.settle()
    // Assert
    assert.deepEqual(harness.controller.state(), playback)
  } finally {
    await harness.close()
  }
})

test('inspecting a Node stop whose captured source differs from its recorded position refuses native debugging', async () => {
  // Arrange: a sealed one-stop history whose debugger snapshot carries another source text.
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = nodeTestHistoryHeader(store.workspaceKey),
      unrelatedText = 'const nextTheme = "light";\n'
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
              text: unrelatedText,
              hash: sha256(unrelatedText),
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
    } satisfies NodeTestSourceStop)
    await writer.appendResult(
      { exitCode: 0, signal: null, output: 'Tests 1 passed' },
      300,
    )
    await writer.finish('complete')
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )

    // Act
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view?.errors.some((error) =>
            /no matching verified captured source/.test(error),
          ),
      'the refused native stop is reported to the reader',
      1_000,
    )

    // Assert
    assert.equal(harness.historicalDebugPresentations.length, 0)
    assert.equal(
      harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence,
      1,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the reader still saying "captured source unavailable" for a Node stop whose captured source really differs; fails_when=the reader payload reports every selected stop's source as available, for example once it stops using the verified match; why_new=Cycle 0033 T1 workspace tests assert only matching stops, and the mismatch is covered only in the helper and the renderer; seam=none
test('a Node stop selected on the timeline whose captured source differs from its recorded position is reported with unavailable captured source', async () => {
  // Arrange: a sealed one-stop history whose debugger snapshot carries another source text.
  const harness = await workspaceHarness()
  try {
    const store = harness.service.nodeHistoryStore!
    const history = nodeTestHistoryHeader(store.workspaceKey),
      unrelatedText = 'const nextTheme = "light";\n'
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
              text: unrelatedText,
              hash: sha256(unrelatedText),
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
    } satisfies NodeTestSourceStop)
    await writer.appendResult(
      { exitCode: 0, signal: null, output: 'Tests 1 passed' },
      300,
    )
    await writer.finish('complete')
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )

    // Act: the learner selects the stop on the timeline, which needs no native debugger.
    harness.receiveContext({
      type: 'node-history-event',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
        2,
      'the mismatched Node stop is selected',
      1_000,
    )
    const selectedStop = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.equal(selectedStop.nodeHistoryPosition?.type, 'stop')
    assert.equal(selectedStop.nodeHistoryPosition?.sourceAvailable, false)
    assert.equal(selectedStop.nodeHistoryPosition?.debuggerAvailable, false)
    assert.equal(harness.historicalDebugPresentations.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a truthful Run and Debug hint once browser replay takes the shared historical debugger; fails_when=opening a recording keeps the Node stop's hint and disabled Inspect although the stop no longer owns Run and Debug; why_new=Cycle 0032 H1; seam=none
test('opening a recording drops the Run and Debug hint of a saved Node stop and re-enables its Inspect', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    harness.setHistoricalDebugInspection('uninspected')
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition
          ?.nativeValuesUninspected === true,
      'the Node stop shows the Run and Debug hint',
      1_000,
    )

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    const view = harness.postedMessages().slice(-1)[0]!
    assert.equal(view.nodeHistoryPosition?.sequence, 2)
    assert.equal(view.nodeHistoryPosition?.nativeValuesUninspected, false)
    assert.equal(view.nodeHistoryPosition?.debuggerAvailable, false)
    // The stop no longer owns Run and Debug, but its captured source is still verified (Cycle 0033 T1).
    assert.equal(view.nodeHistoryPosition?.sourceAvailable, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the Node timeline and its selected event agreeing after browser replay supersedes a loading stop; fails_when=the abandoned Node presentation later commits its event in the Node timeline only; why_new=Cycle 0032 H1 (typed supersession deferred as D4); seam=none
test('a Node stop still loading when a recording opens never becomes the Node timeline position', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    const held = harness.holdHistoricalDebugPresentation()
    harness.receiveContext({
      type: 'node-history-playback',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      action: 'seek',
      positionMs: 200,
    })
    await held.started

    // Act
    await harness.reader.openRecording(harness.studyId)
    held.release()
    await harness.controller.settle()
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert
    const view = harness.postedMessages().slice(-1)[0]!
    assert.equal(view.nodeHistoryPosition?.sequence, 1)
    assert.equal(view.nodeHistoryPlayback?.sequence, 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=a reopened reader after Node Play; fails_when=Node Play keeps ticking while close() drains, starts another Node stop and leaves its hint for the reopen; why_new=Cycle 0032 H2; seam=none
test('closing the reader stops Node Play at once, so no Node stop starts while closing drains', async () => {
  // Arrange
  const harness = await workspaceHarness()
  const store = harness.service.nodeHistoryStore!,
    list = store.list.bind(store)
  let releaseList = (): void => {}
  try {
    const history = await saveOneStopNodeHistory(store)
    harness.setHistoricalDebugInspection('uninspected')
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    // The next periodic refresh stays pending, so closing drains while a running Node Play timer could still tick.
    let listed = (): void => {}
    const listing = new Promise<void>((resolve) => {
      listed = resolve
    })
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve
    })
    store.list = async () => {
      listed()
      await listGate
      return list()
    }
    await listing
    harness.receiveContext({
      type: 'node-history-playback',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      action: 'play',
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPlayback?.mode ===
        'playing',
      'Node Play starts',
      1_000,
    )
    const presentationsBeforeClose = harness.historicalDebugPresentations.length

    // Act
    const closing = harness.reader.close()
    await new Promise<void>((resolve) => setTimeout(resolve, 400))
    releaseList()
    await closing
    const presentationsAfterClose = harness.historicalDebugPresentations.length
    store.list = list
    await harness.reader.open()
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition !==
        undefined,
      'the reopened reader restores the Node history',
      1_000,
    )

    // Assert
    const view = harness.postedMessages().slice(-1)[0]!
    assert.equal(presentationsAfterClose, presentationsBeforeClose)
    assert.equal(view.nodeHistoryPosition?.sequence, 1)
    assert.equal(view.nodeHistoryPosition?.nativeValuesUninspected, undefined)
  } finally {
    releaseList()
    store.list = list
    await harness.close()
  }
})

// Value: protects=restarting native inspection of a Node stop after the learner stopped Codebook's session; fails_when=Inspect stays disabled because the ended session is only reported when a hint was showing; why_new=Cycle 0032 H3 and review clarification CQ1; seam=none
test('ending the historical session re-enables Inspect for the selected Node stop, and Inspect restarts the session', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition
          ?.debuggerAvailable === true,
      'the Node stop shows its values in Run and Debug',
      1_000,
    )
    const withValues = harness.postedMessages().slice(-1)[0]!

    // Act
    harness.endHistoricalDebugSession()
    const afterSessionEnded = harness.postedMessages().slice(-1)[0]!
    harness.receiveContext({
      type: 'node-history-stop',
      revision: afterSessionEnded.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition
          ?.debuggerAvailable === true,
      'Inspect restarts the historical session',
      1_000,
    )

    // Assert
    assert.equal(withValues.nodeHistoryPosition?.nativeValuesUninspected, false)
    assert.equal(
      afterSessionEnded.nodeHistoryPosition?.debuggerAvailable,
      false,
    )
    // Ending the session never makes the label claim the captured source is unavailable (Cycle 0033 T1).
    assert.equal(afterSessionEnded.nodeHistoryPosition?.sourceAvailable, true)
    assert.equal(harness.historicalDebuggers.length, 2)
    assert.equal(harness.historicalDebuggers[1]!.available, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=no historical session starting on a closed reader; fails_when=a Node stop selection that waited for the old debugger's disposal creates a new owner without checking that it is still current; why_new=Cycle 0034 O1 adds a wait before creation (plan review P2); seam=TestReplayDebugger models a held disposal
test('a Node stop selection that was waiting for the stopped historical debugger when the reader closed starts no new session', async () => {
  // Arrange
  const harness = await workspaceHarness()
  let releaseDisposal = (): void => {}
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition
          ?.debuggerAvailable === true,
      'the Node stop shows its values in Run and Debug',
      1_000,
    )
    harness.endHistoricalDebugSession()
    const disposal = harness.holdHistoricalDebugDisposal()
    releaseDisposal = disposal.release
    const presentationsBeforeClose = harness.historicalDebugPresentations.length
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await disposal.started

    // Act
    const closing = harness.reader.close()
    disposal.release()
    await closing

    // Assert
    assert.equal(harness.historicalDebuggers.length, 1)
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsBeforeClose,
    )
  } finally {
    releaseDisposal()
    await harness.close()
  }
})

// Value: protects=the selected Node stop's label after the reader was closed and opened again; fails_when=the reopened reader forgets that the stop's captured source matches and labels it "captured source unavailable"; why_new=Cycle 0034 T4 (Cycle 0033 plan partial T1); seam=none
test('a Node stop selected before the reader closed keeps its matching captured source when its history is selected again', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition
          ?.debuggerAvailable === true,
      'the Node stop shows its values in Run and Debug',
      1_000,
    )

    // Act
    await harness.reader.close()
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          2 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the reopened reader restores the selected Node stop',
      1_000,
    )

    // Assert
    const reopened = harness.postedMessages().slice(-1)[0]!
    assert.equal(reopened.nodeHistoryPosition?.type, 'stop')
    assert.equal(reopened.nodeHistoryPosition?.sourceAvailable, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=Inspect pressed twice while the editor is still stopping the ended historical session; fails_when=the second press creates the next owner while the first press's disposal still holds the debug type; why_new=Cycle 0034 O1 tests cover the browser route and a closed reader only; seam=none
test('pressing Inspect again while the editor is still stopping the ended historical session shows the Node stop through one new session', async () => {
  // Arrange: the learner ended the historical session, and the first Inspect press is waiting for the editor to stop it.
  const harness = await workspaceHarness()
  let releaseDisposal = (): void => {}
  try {
    const history = await saveOneStopNodeHistory(
      harness.service.nodeHistoryStore!,
    )
    await harness.reader.open()
    harness.receiveContext({
      type: 'node-history',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence ===
          1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded',
      1_000,
    )
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await waitUntil(
      () =>
        harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition
          ?.debuggerAvailable === true,
      'the Node stop shows its values in Run and Debug',
      1_000,
    )
    harness.endHistoricalDebugSession()
    const disposal = harness.holdHistoricalDebugDisposal()
    releaseDisposal = disposal.release
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await disposal.started

    // Act: the learner presses Inspect a second time, then the editor finishes stopping the old session.
    harness.receiveContext({
      type: 'node-history-stop',
      revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId,
      sequence: 2,
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    const sessionsWhileStopping = harness.historicalDebuggers.length
    disposal.release()
    await waitUntil(
      () => {
        const view = harness.reader.inspect().view
        return (
          view?.nodeHistoryPosition?.debuggerAvailable === true ||
          Boolean(view?.errors.length)
        )
      },
      'the second Inspect press settles',
      1_000,
    )

    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.errors.join(' | '), '')
    assert.equal(sessionsWhileStopping, 1)
    assert.equal(harness.historicalDebuggers.length, 2)
    assert.equal(harness.historicalDebuggers[1]!.available, true)
    assert.equal(harness.historicalDebugPresentations.length, 2)
    assert.equal(view.nodeHistoryPosition?.sequence, 2)
    assert.equal(view.nodeHistoryPosition?.debuggerAvailable, true)
  } finally {
    releaseDisposal()
    await harness.close()
  }
})

for (const situation of [
  'the debugger focused that file at a pause',
  'no debug session is paused',
  'the session runs again after a pause and the editor reports its thread',
  'the learner turned off debug.focusEditorOnBreak',
  "the learner went back to Cursor's chat after the pause and the editor names the chat's group",
  "the learner went back to Cursor's chat after the pause and the editor still names the paused file's tab, with no active text editor",
] as const) {
  const takesFocus = situation === 'the debugger focused that file at a pause'
  // Value: protects=the keyboard focus after a capture when the debugger opened its file in the source group: the captured source that replaces that file takes the focus it had, and takes none in every other state; fails_when=the source is shown over the focused file while preserving the focus, which hides the focused editor and leaves the keyboard focus on the document body until the learner clicks, or the source takes the focus from a learner who went back to the chat; why_new=Cycle 0045 NF-4, the source group's half (0037-F6's native run; `352287f` fixed the Application group only), with X7-A.4 for Cursor's two chat states; seam=workspace harness with the controlled runtime, focusMutableDraft, pauseDebugger, textDocumentShows
  test(
    takesFocus
      ? 'the captured source takes the keyboard focus when it replaces the file the debugger focused at a pause in the source group'
      : `the captured source leaves the keyboard focus where it is when it replaces a file in the source group while ${situation}`,
    async () => {
      // Arrange: the reader follows a live run in its two panes; the paused file is the tab in front of the source group, with the keyboard focus unless the learner went back to the chat.
      const harness = await workspaceHarness()
      harness.useNativeLayout({ orientation: 0, groups: [{}] })
      const chat = situation.includes("Cursor's chat")
        ? harness.addSeparateEditorPart()
        : undefined
      try {
        const receipt = harness.service.start({
          instanceId: harness.service.instanceId,
          profile: 'repository-browser',
          configuration: harness.configuration,
          key: randomUUID(),
        })
        const record = harness.service.record(receipt)
        await record.preparation
        await harness.reader.open()
        const sourceColumn =
          harness.reader.presentationState().panes.sourceColumn
        harness.focusMutableDraft('actions.ts', 2)
        if (situation !== 'no debug session is paused')
          harness.pauseDebugger({
            focusesEditorOnBreak:
              situation === 'the learner turned off debug.focusEditorOnBreak'
                ? false
                : undefined,
          })
        if (situation.includes('runs again')) harness.resumeDebugger()
        if (situation.includes("names the chat's group")) chat!.focusTab()
        if (situation.includes('no active text editor')) chat!.focus()
        const showsBefore = harness.textDocumentShows().length

        // Act: the run reaches its stop and the reader shows the stop's captured source in the source group.
        harness.service.action({
          instanceId: harness.service.instanceId,
          runId: record.id,
          key: randomUUID(),
          action: 'repository-click',
        })
        await readerSeams(harness).refresh()

        // Assert
        assert.equal(sourceColumn, 2)
        assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [
          {
            name: 'Captured-theme.ts',
            viewColumn: 2,
            preserveFocus: !takesFocus,
          },
        ])
      } finally {
        await harness.close()
      }
    },
  )
}

for (const host of ['Visual Studio Code', 'Cursor'] as const)
  // Value: protects=a learner whose chat is a side view (VS Code, and Cursor with its Agent chat in the secondary side bar) told once where the keyboard is when the captured source took it from the file the debugger opened at a pause, with what to do if they were typing in the chat; fails_when=the keyboard leaves the chat input at a pause without a word, as in Cursor while the sentence was withheld there by the host's name, or the sentence comes again at every pause; why_new=Cycle 0046 row 5 (Cycle 0045 NF-4b with the limit X7-A.4; runs r5a and r5b of 2026-10-05 showed that Cursor reads like VS Code while its chat is a pane of the secondary side bar); seam=workspace harness with the controlled runtime, focusMutableDraft, pauseDebugger, useHostAppName, the information messages
  test(`the captured source that takes the keyboard from the file the debugger focused at a pause says once in an editor session where the keyboard is, in ${host} with a side-view chat`, async () => {
    // Arrange: the reader follows a live run in its two panes; the editor names an active text editor before the pause, as it does while a side-view chat has the keyboard; the debugger opened the paused file in front of the source group with the keyboard focus.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.useHostAppName(host)
    let live: { close(): void } | undefined
    try {
      const receipt = harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      const record = harness.service.record(receipt)
      await record.preparation
      await harness.reader.open()
      live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      harness.focusMutableDraft('actions.ts', 2)
      harness.pauseDebugger()
      const showsBefore = harness.textDocumentShows().length

      // Act: the run reaches its stop and the reader shows the stop's captured source over the paused file; at a later pause the Application pane takes the keyboard from the paused file.
      harness.service.action({
        instanceId: harness.service.instanceId,
        runId: record.id,
        key: randomUUID(),
        action: 'repository-click',
      })
      await readerSeams(harness).refresh()
      const sentencesAfterPause = harness.informationMessages.map(
        (message) => message.message,
      )
      const revealsBefore = harness.panelReveals().length
      await harness.revealApplicationPaneOverPausedFile()

      // Assert: the sentence follows the capture, and is shown once in an editor session for both panes together.
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [
        { name: 'Captured-theme.ts', viewColumn: 2, preserveFocus: false },
      ])
      // The captured source already took the keyboard; an App that stayed visible needs no second native reveal.
      assert.equal(harness.panelReveals().length, revealsBefore)
      assert.equal(
        harness
          .focusedSource()
          ?.document.uri.path.endsWith('/Captured-theme.ts'),
        true,
      )
      assert.equal(harness.keyboardOnBody(), false)
      assert.deepEqual(sentencesAfterPause, [
        'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
      ])
      assert.equal(harness.informationMessages.length, 1)
      assert.equal(harness.commands.includes('composer.focusComposer'), false)
    } finally {
      live?.close()
      await harness.close()
    }
  })

// Value: protects=once-only notice for actual captured-source takeovers while an isolated App preserves native input; fails_when=source settlement omits or repeats the pause notice; why_new=Cycle 0046 row 5, reconciled with dedicated App ownership; seam=declared two-stop run, native opensWithKeyboard, real captures and reader refresh
test('an isolated App preserves closed-reader native input and actual source replacements tell the learner once in Cursor', async () => {
  // Arrange: a live lease exists while the reader is closed; native debug respects the locked App group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: {
        ...harness.configuration,
        additionalStops: [
          {
            line: 1,
            column: 1,
            inspections: harness.configuration.inspections,
          },
        ],
      },
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    const readerState = harness.reader.presentationState().state,
      revealsBefore = harness.panelReveals().length
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'login-form.tsx', column: 1 },
    })
    await harness.revealApplicationPaneOverPausedFile()
    const closedReader = {
      column: harness.editor.window.activeTextEditor?.viewColumn,
      notices: harness.informationMessages.map((message) => message.message),
    }

    // Act: the actual capture opens its source; after continuation a second capture replaces the next native file.
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await harness.reader.open()
    const afterFirstCapture = harness.informationMessages.map(
      (message) => message.message,
    )
    await harness.runtimes[0]!.continue(
      'browser',
      harness.runtimes[0]!.snapshots.at(-1)!.pause,
    )
    harness.resumeDebugger()
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    commitNextStop(harness.runtimes[0]!)
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: a notice describes a real source takeover, never an already-visible App.
    assert.equal(readerState, 'closed')
    assert.deepEqual(closedReader, { column: 2, notices: [] })
    assert.deepEqual(afterFirstCapture, [
      'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
    ])
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
      ],
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.toString(),
      harness.reader.inspect().sourceUri,
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.getText(),
      'const nextTheme = "dark";\n',
    )
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(harness.commands.includes('composer.focusComposer'), false)
    assert.equal(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .some((reveal) => !reveal.preserveFocus),
      false,
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=once-only pause notice across reader replacement in the same loaded editor session; fails_when=reader construction clears the shared notice mark; why_new=Cycle 0046 row 174; seam=createReader, ordinary live runs before and after disposal, captured-source settlement and preserved dirty draft
test('actual captured-source takeovers tell the learner once across reader replacement in the same editor session', async () => {
  // Arrange: the first reader shows one real controlled capture with a native paused file holding the keyboard.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let replacement: ReturnType<typeof harness.createReader> | undefined,
    live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    const first = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'login-form.tsx', column: 1 },
    })
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await harness.reader.open()
    const firstNotices = harness.informationMessages.map(
      (message) => message.message,
    )
    harness.resumeDebugger()
    first.close()
    // Disposal preserves the learner's own focused draft; no unrelated Close keyboard notice is part of this test.
    const draft = harness.focusMutableDraft('between-readers.txt', 2)
    await harness.reader.dispose()

    // Act: the next reader belongs to the same loaded module and acquires a new live run after explicitly leaving the restored saved reading.
    replacement = harness.createReader()
    await replacement.attach(harness.service)
    await replacement.action('return-current')
    const nextReceipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const nextRecord = harness.service.record(nextReceipt)
    await nextRecord.preparation
    live = await replacement.presentation.createViewport(
      nextReceipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: nextRecord.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await replacement.open()

    // Assert
    assert.deepEqual(firstNotices, [
      'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
    ])
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
      ],
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.toString(),
      replacement.inspect().sourceUri,
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.getText(),
      'const nextTheme = "dark";\n',
    )
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(draft.tab.isDirty, true)
  } finally {
    live?.close()
    await replacement?.dispose()
    await harness.close()
  }
})

for (const chatState of [
  "the editor named the chat's group",
  "the editor named the learner's file without an active text editor",
] as const)
  // Value: protects=the keyboard of a learner who was typing in Cursor's Agent chat (a tab of another editor part) when a live run paused: the chat has it again right after the captured source is shown at that pause, at the first pause and at the next one, and nothing is told; fails_when=the debugger opens the paused file with the keyboard, the reader's pane takes it from that file, and it stays in the editor until the run ends, as in the focus log of Cycle 0045's N14-d from the first pause on; why_new=Cycle 0046 row 5, Cursor half (the return of an arrangement happened after an arrangement only; a pause has none); seam=workspace harness with the controlled runtime, addSeparateEditorPart, focusMutableDraft, pauseDebugger, holdNextCommand on Cursor's Focus Agent command
  test(`the chat that had the keyboard before a pause of a live run has it again after the captured source is shown, at that pause and at the next, when ${chatState}`, async () => {
    // Arrange: Cursor with the Agent chat as a tab of another editor part; the reader follows a live run and the learner types in the chat.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.useHostAppName('Cursor')
    const chat = harness.addSeparateEditorPart()
    let release = (): void => {}
    let live: { close(): void } | undefined
    try {
      const receipt = harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: {
          ...harness.configuration,
          additionalStops: [
            {
              line: 1,
              column: 1,
              inspections: harness.configuration.inspections,
            },
          ],
        },
        key: randomUUID(),
      })
      const record = harness.service.record(receipt)
      await record.preparation
      await harness.reader.open()
      live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      const revealsBefore = harness.panelReveals().length
      if (chatState === "the editor named the chat's group") chat.focusTab()
      else {
        harness.focusMutableDraft('learner-notes.ts', 2)
        chat.focus()
      }
      // The pause: the debugger opens the paused file in front of the source group with the keyboard, then selects the stack item.
      const held = harness.holdNextCommand('composer.focusComposer')
      release = held.release
      harness.pauseDebugger({
        focusesEditorOnBreak: true,
        opensWithKeyboard: { filename: 'actions.ts', column: 1 },
      })
      const chatFocusedAtPause = chat.focused()
      const showsBefore = harness.textDocumentShows().length

      // Act: capture the first pause, continue the declared run and capture the next native source.
      harness.service.action({
        instanceId: harness.service.instanceId,
        runId: record.id,
        key: randomUUID(),
        action: 'repository-click',
      })
      const shown = readerSeams(harness).refresh()
      await held.started
      const showsBeforeReturn = harness.textDocumentShows().slice(showsBefore)
      held.release()
      await shown
      const afterFirstPause = {
        chatFocused: chat.focused(),
        sourceShows: harness.textDocumentShows().slice(showsBefore),
        returns: harness.commands.filter(
          (command) => command === 'composer.focusComposer',
        ).length,
      }
      await harness.runtimes[0]!.continue(
        'browser',
        harness.runtimes[0]!.snapshots.at(-1)!.pause,
      )
      harness.resumeDebugger()
      harness.pauseDebugger({
        focusesEditorOnBreak: true,
        opensWithKeyboard: { filename: 'auth.ts', column: 1 },
      })
      commitNextStop(harness.runtimes[0]!)
      const chatFocusedAtSecondPause = chat.focused()
      await readerSeams(harness).refresh()
      await harness.revealApplicationPaneOverPausedFile()

      assert.equal(harness.keyboardOnBody(), false)
      // Assert: chat returns before delayed capture; source refresh and the visible App preserve it.
      assert.deepEqual(harness.panelReveals().slice(revealsBefore), [])
      assert.equal(chatFocusedAtPause, false)
      assert.deepEqual(showsBeforeReturn, [])
      assert.deepEqual(afterFirstPause, {
        chatFocused: true,
        sourceShows: [
          { name: 'Captured-theme.ts', viewColumn: 2, preserveFocus: true },
        ],
        returns: 1,
      })
      assert.equal(chatFocusedAtSecondPause, false)
      assert.equal(chat.focused(), true)
      assert.equal(
        harness.commands.filter(
          (command) => command === 'composer.focusComposer',
        ).length,
        2,
      )
      assert.deepEqual(harness.informationMessages, [])
    } finally {
      release()
      live?.close()
      await harness.close()
    }
  })

// Value: protects=the keyboard of a learner who clicked from the Application pane into Cursor's Agent chat (a tab of another editor part) before a live run paused: the chat has it again after the captured source is shown; fails_when=the chat's record is read on tab, group and active-editor events only, the editor reports the pane's view state after them, the reading still sees an active pane, and no record is made, so the keyboard stays in the editor at every pause; why_new=Cycle 0046 row 140, item 7 (the pane's `active` flag comes on its own channel); seam=workspace harness with the controlled runtime, addSeparateEditorPart, holdPaneDeactivation, focusMutableDraft, pauseDebugger
test("the chat that took the keyboard from the Application pane has it again at a pause of a live run, also when the editor reports the pane's view state after the tab events of that click", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the reader follows a live run and the Application pane has the keyboard.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.action('focus-app')
    const paneBeforeClick = harness.focusedPanel(),
      revealsBefore = harness.panelReveals().length
    // The learner clicks into the chat: the tab and group events arrive while the pane's flag still reads active, and the pane's view state after them.
    const heldFlag = harness.holdPaneDeactivation('codebook.scopedBrowser')
    chat.focusTab()
    heldFlag.release()
    // The pause: the debugger opens the paused file in front of the source group with the keyboard, then selects the stack item.
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })

    // Act: the run reaches its stop and the reader shows the stop's captured source over the paused file.
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()

    // Assert
    assert.deepEqual(harness.panelReveals().slice(revealsBefore), [])
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(paneBeforeClick, 'codebook.scopedBrowser')
    assert.equal(chat.focused(), true)
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      ['composer.focusComposer'],
    )
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner who clicked from the Study pane into Cursor's Agent chat (a tab of another editor part) beside a live run: the chat's record is made although the editor reports the pane's view state after the tab events of that click, so a stop that ends unsettled gives the chat the keyboard back; fails_when=the Study pane's view state is not a reading of the chat's record, the last reading still sees an active pane, and no record is made; why_new=Cycle 0046 row 140, item 7 (the Study pane's half; the Application pane's is the test above); seam=workspace harness in the three-pane Study layout, a live run's viewport made through the reader's presentation, addSeparateEditorPart, holdPaneDeactivation, focusMutableDraft, pauseDebugger
test("the chat that took the keyboard from the Study pane has it again when a stop of a live run ends, also when the editor reports the pane's view state after the tab events of that click", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the Study workspace is open in its three panes, a live run has its Application pane, and the Study pane has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      randomUUID(),
      () => {},
      () => {},
      'normal',
    )
    const paneBeforeClick = harness.focusedPanel()
    // The learner clicks into the chat: the tab and group events arrive while the pane's flag still reads active, and the pane's view state after them.
    const heldFlag = harness.holdPaneDeactivation('codebook.studyContext')
    chat.focusTab()
    heldFlag.release()

    // Act: the debugger opens a paused file with the keyboard and the run resumes that stop by itself.
    harness.focusMutableDraft('actions.ts', 1)
    harness.pauseDebugger()
    harness.resumeDebugger()
    await waitUntil(
      () => chat.focused(),
      'the chat to have the keyboard again after the stop ended',
      2_000,
    )

    // Assert
    assert.equal(paneBeforeClick, 'codebook.studyContext')
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      ['composer.focusComposer'],
    )
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner who was typing in Cursor's Agent chat when a live run paused and went on before the reader had shown anything for that pause: the chat has it again when that pause ends, and at the next pause; fails_when=the end of a pause reads the file the debugger itself opened as the learner's choice of an editor and ends the chat's record, so the keyboard stays in that file and no later pause of the run gives it back; why_new=Cycle 0046 row 140, item 9 (a stop the runtime resumes by itself, or a continuation that arrives before the captured source was shown); seam=workspace harness with the controlled runtime, addSeparateEditorPart, focusMutableDraft, pauseDebugger, holdNextCommand
test('the chat that had the keyboard before a pause of a live run has it again when that pause ends before the reader showed its captured source, and at the next pause', async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the reader follows a live run and the learner types in the chat.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()

    // Act: the debugger opens the paused file with the keyboard and the pause ends at once; then the run pauses again and the reader shows that stop's captured source.
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    harness.resumeDebugger()
    await waitUntil(
      () => chat.focused(),
      'the chat to have the keyboard again after the pause that ended at once',
      2_000,
    )
    const returnsAfterFirstPause = harness.commands.filter(
      (command) => command === 'composer.focusComposer',
    ).length
    harness.focusMutableDraft('auth.ts', 2)
    harness.pauseDebugger()
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()

    // Assert
    assert.equal(returnsAfterFirstPause, 1)
    assert.equal(chat.focused(), true)
    assert.equal(
      harness.commands.filter((command) => command === 'composer.focusComposer')
        .length,
      2,
    )
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor who debugs a program of their own beside the Agent chat's tab while the Study workspace shows a saved study and no run is live: when the reader shows that study's captured source, the keyboard is not sent to the chat; fails_when=the return at a render asks only that no recording is open, while the return at a pause's end asks for a live run, so with a paused session of the learner's own every render that leaves the keyboard where it is runs the chat's focus command; why_new=Cycle 0046 row 254 (delegated review, finding 7: both returns run only beside a live run); seam=workspace harness with a retained study, addSeparateEditorPart, focusMutableDraft, pauseDebugger for a session of the learner's own, the reader's Retry
test("a render of a saved study while a debug session of the learner's own is paused, with no live run of Codebook, does not send the keyboard to Cursor's chat", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the Study workspace shows a saved study and no run is live; the learner typed in the chat, and a breakpoint of the learner's own session opened its file with the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  try {
    await openRetainedStudy(harness)
    chat.focusTab()
    const pausedFile = harness.focusMutableDraft('server.ts', 1)
    harness.pauseDebugger({ session: 'learners-own-session' })
    const showsBefore = harness.textDocumentShows().length

    // Act: the reader renders the saved study once more, leaving the keyboard where it is.
    await harness.reader.action('retry')

    // Assert: the source was shown without the keyboard, and no chat command ran.
    assert.equal(
      harness.textDocumentShows().length > showsBefore &&
        harness
          .textDocumentShows()
          .slice(showsBefore)
          .every((shown) => shown.preserveFocus),
      true,
    )
    assert.equal(chat.focused(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.toString(),
      pausedFile.document.uri.toString(),
    )
    assert.equal(harness.commands.includes('composer.focusComposer'), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor who debugs a program of their own beside the Agent chat's tab, with no live run of Codebook: when a stop of that session ends, the keyboard stays in the file the debugger opened; fails_when=the return made for a stop that Codebook's run resumes by itself also runs without a live run, so every continue of the learner's own debugging throws the keyboard into the chat input; why_new=Cycle 0046 row 140, item 9 (the other side: the reader moves no keyboard outside its own runs); seam=workspace harness, addSeparateEditorPart, focusMutableDraft, pauseDebugger
test("a learner in Cursor whose own debug session stops and goes on, with no live run of Codebook, keeps the keyboard in the file the debugger opened, and the chat's tab does not take it", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the Study workspace is open, no run is live, and the learner typed in the chat.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  try {
    await harness.reader.open()
    chat.focusTab()

    // Act: a breakpoint of the learner's own session opens its file with the keyboard, and the learner continues; then longer than the reader's steps take passes.
    const pausedFile = harness.focusMutableDraft('server.ts', 1)
    harness.pauseDebugger({ session: 'learners-own-session' })
    harness.resumeDebugger()
    await delay(50)

    // Assert
    assert.equal(chat.focused(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document,
      pausedFile.document,
    )
    assert.equal(harness.commands.includes('composer.focusComposer'), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=recorded playhead and external native source input when a live viewport exists beside saved history; fails_when=an external pause returns to chat despite recording being selected; why_new=Cycle 0046 row 166; seam=recordedReaderHarness, actual controller seek, live lease and native pause
test('a stop reported beside an actual recording preserves its playhead and external source without returning to Cursor chat', async () => {
  // Arrange: open saved history through its controller, with a separate live lease as the return guard's prerequisite.
  const harness = await recordedReaderHarness(true, true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const opened = harness.controller.state()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: opened.revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    live = await harness.reader.presentation.createViewport(
      randomUUID(),
      () => {},
      () => {},
      'normal',
    )
    await harness.controller.settle()
    chat.focusTab()
    const commandsBefore = harness.commands.length

    // Act: another real native frame opens in the unlocked source group while history stays selected.
    harness.pauseDebugger({
      session: 'external-live-session',
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'external-actions.ts', column: 1 },
    })
    await harness.revealApplicationPaneOverPausedFile()
    await delay(50)

    // Assert
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(chat.focused(), false)
    assert.equal(
      harness.commands.slice(commandsBefore).includes('composer.focusComposer'),
      false,
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.fsPath,
      join(harness.directory, 'external-actions.ts'),
    )
    assert.equal(harness.editor.window.activeTextEditor?.viewColumn, 2)
    assert.equal(harness.keyboardOnBody(), false)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor who went from the Agent chat's tab to a file while no debug session is paused: it stays in that file when the reader shows a captured source; fails_when=the return made for a pause runs at every reveal of a captured source, so a learner who left the chat for a file is thrown back into the chat input whenever the reader shows a source; why_new=Cycle 0046 row 140 (the return's bound: only at a pause beside a live run; no test held it); seam=workspace harness with the controlled runtime, addSeparateEditorPart, focusMutableDraft
test("a learner in Cursor who went from the chat to a file while no debug session is paused keeps the keyboard in that file when the reader shows a captured source, and the chat's tab does not take it", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the reader follows a live run, the learner typed in the chat and then went to a file.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    chat.focusTab()
    const learnerFile = harness.focusMutableDraft('learner-notes.ts', 1)
    const showsBefore = harness.textDocumentShows().length

    // Act: the run reaches its stop with no debug session paused, and the reader shows the stop's captured source.
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()

    // Assert
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [
      { name: 'Captured-theme.ts', viewColumn: 2, preserveFocus: true },
    ])
    assert.equal(chat.focused(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document,
      learnerFile.document,
    )
    assert.equal(harness.commands.includes('composer.focusComposer'), false)
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=chat input after a real captured-source update when webview focus can arrive late; fails_when=an unnecessary activating App reveal steals the returned keyboard later; why_new=Cycle 0046 row 140 item 10; seam=controlled capture, native pause, delayed pane focus and actual source refresh
test('the chat keeps the keyboard after native source capture without a delayed App focus', async () => {
  // Arrange: Cursor chat owns the keyboard; native debug opens unlocked Source and pane focus can arrive 30 ms late.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  harness.focusRevealedPanesLater()
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    const revealsBefore = harness.panelReveals().length
    chat.focusTab()
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })

    // Act: render the actual captured source and wait beyond the modeled late webview-focus delay.
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()
    const chatFocusedAfterReveal = chat.focused()
    await delay(100)

    assert.equal(harness.keyboardOnBody(), false)
    // Assert: chat retains input and the already-visible App issues no delayed activating reveal.
    assert.equal(chatFocusedAfterReveal, true)
    assert.deepEqual(harness.panelReveals().slice(revealsBefore), [])
    assert.equal(chat.focused(), true)
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor who left the Agent chat's tab for a file between two pauses of a live run: at the second pause it stays in the editor; fails_when=every active stack item is taken for a pause, although both editors report the session's thread from about 200 ms after it went on running, so nothing is read between the pauses, the first pause never ends, and the second throws the learner back into the chat input; why_new=Cycle 0046 row 165 (delegated review, finding 1, read in both editors' workbench bundles); seam=workspace harness with the controlled runtime and the three stack item states of an editor (pauseDebugger, resumeDebugger), a live run's viewport, addSeparateEditorPart, focusMutableDraft, the clock of performance.now held for the editor events
test("a learner in Cursor who left the chat for a file between two pauses of a live run keeps the keyboard in the editor at the second pause, and the chat's tab does not take it", async (t) => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the learner typed in the chat when the run first paused, and the chat got the keyboard back after the captured source was shown.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: {
        ...harness.configuration,
        additionalStops: [
          {
            line: 1,
            column: 1,
            inspections: harness.configuration.inspections,
          },
        ],
      },
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    const revealsBefore = harness.panelReveals().length
    chat.focusTab()
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const chatFocusedAfterFirstPause = chat.focused()

    // Act: resume, choose a file, advance the held clock by a minute and capture the next native pause.
    await harness.runtimes[0]!.continue(
      'browser',
      harness.runtimes[0]!.snapshots.at(-1)!.pause,
    )
    harness.resumeDebugger()
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.focusMutableDraft('learner-notes.ts', 2)
    clockMs += 60_000
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'auth.ts', column: 1 },
    })
    commitNextStop(harness.runtimes[0]!)
    clock.mock.restore()
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(harness.panelReveals().slice(revealsBefore), [])
    // Assert: one return, at the first pause only; at the second the keyboard stays and the learner is told where it is.
    assert.equal(chatFocusedAfterFirstPause, true)
    assert.equal(chat.focused(), false)
    assert.equal(
      harness.commands.filter((command) => command === 'composer.focusComposer')
        .length,
      1,
    )
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
      ],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner who was typing in Cursor's Agent chat when a live run stopped twice in a row on one thread, the second time before the editor reported that the session runs: the chat has it again at both stops; fails_when=the second frame is taken for another frame of the first pause, which the reader settled already, so the keyboard stays in the file the debugger opened at every stop that follows a continue within the editor's 200 ms (two breakpoints of one request on the server), and the learner is told a sentence instead; why_new=Cycle 0046 row 165 (both editors report the thread only 200 ms after a continue, and not at all when the thread stops again before that: a frame follows a frame); seam=workspace harness with the controlled runtime and the stack item states of an editor (pauseDebugger twice, with no resumeDebugger between), a live run's viewport, addSeparateEditorPart, focusMutableDraft
test('the chat that had the keyboard before a pause of a live run has it again at the next stop, also when the run stops again before the editor reports that it runs', async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the learner typed in the chat when the run first paused, and the chat got the keyboard back after the captured source was shown.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: {
        ...harness.configuration,
        additionalStops: [
          {
            line: 1,
            column: 1,
            inspections: harness.configuration.inspections,
          },
        ],
      },
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    const revealsBefore = harness.panelReveals().length
    chat.focusTab()
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const chatFocusedAfterFirstStop = chat.focused()

    // Act: continue and capture the next pause, with two native frames and no intervening thread event.
    await harness.runtimes[0]!.continue(
      'browser',
      harness.runtimes[0]!.snapshots.at(-1)!.pause,
    )
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'auth.ts', column: 1 },
    })
    commitNextStop(harness.runtimes[0]!)
    const chatFocusedAtSecondStop = chat.focused()
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(harness.panelReveals().slice(revealsBefore), [])
    // Assert: one return for each stop, and no sentence.
    assert.equal(chatFocusedAfterFirstStop, true)
    assert.equal(chatFocusedAtSecondStop, false)
    assert.equal(chat.focused(), true)
    assert.equal(
      harness.commands.filter((command) => command === 'composer.focusComposer')
        .length,
      2,
    )
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor who went to the Agent chat's tab between two pauses of a live run: the chat has it again at the second pause; fails_when=the editor's thread item between the pauses is taken for a pause, so the chat that took the keyboard meanwhile is never read and the keyboard stays in the editor at the second pause; why_new=Cycle 0046 row 165 (the record is sampled again once a pause is over); seam=workspace harness with the controlled runtime and the three stack item states of an editor, a live run's viewport, addSeparateEditorPart, focusMutableDraft
test('a learner in Cursor who went from a file to the chat between two pauses of a live run has the keyboard in the chat again at the second pause', async (t) => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the learner worked in a file for a minute when the run first paused, so the captured source kept the keyboard there and the sentence was told.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: {
        ...harness.configuration,
        additionalStops: [
          {
            line: 1,
            column: 1,
            inspections: harness.configuration.inspections,
          },
        ],
      },
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    const revealsBefore = harness.panelReveals().length
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.focusMutableDraft('learner-notes.ts', 2)
    clockMs += 60_000
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    clock.mock.restore()
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const afterFirstPause = {
      chatFocused: chat.focused(),
      sentences: harness.informationMessages.length,
    }

    // Act: resume, move from the file to chat and capture the next native pause.
    await harness.runtimes[0]!.continue(
      'browser',
      harness.runtimes[0]!.snapshots.at(-1)!.pause,
    )
    harness.resumeDebugger()
    chat.focusTab()
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'auth.ts', column: 1 },
    })
    commitNextStop(harness.runtimes[0]!)
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(harness.panelReveals().slice(revealsBefore), [])
    // Assert
    assert.deepEqual(afterFirstPause, { chatFocused: false, sentences: 1 })
    assert.equal(chat.focused(), true)
    assert.equal(
      harness.commands.filter((command) => command === 'composer.focusComposer')
        .length,
      1,
    )
    assert.equal(harness.informationMessages.length, 1)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor who went from a file to the Agent chat's tab while a live run was paused: the chat has it again at the next stop, also when that stop follows before the editor reports that the session runs; fails_when=nothing is read from the editor while a stack frame is reported, so the chat the learner went to during the pause is never noted, and with a frame after a frame there is no moment between the stops at which it could be; why_new=Cycle 0046 row 165 (the record is read during pauses too: both editors report a frame after a frame for a thread that stops again within 200 ms); seam=workspace harness with the controlled runtime and the stack item states of an editor (pauseDebugger twice, with no resumeDebugger between), a live run's viewport, addSeparateEditorPart, focusMutableDraft, the clock of performance.now held for the editor events
test('a learner in Cursor who went from a file to the chat during a pause of a live run has the keyboard in the chat again at the next stop, also when the run stops again before the editor reports that it runs', async (t) => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the learner worked in a file for a minute when the run first paused, so the captured source kept the keyboard there and the sentence was told.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: {
        ...harness.configuration,
        additionalStops: [
          {
            line: 1,
            column: 1,
            inspections: harness.configuration.inspections,
          },
        ],
      },
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    const revealsBefore = harness.panelReveals().length
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.focusMutableDraft('learner-notes.ts', 2)
    clockMs += 60_000
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    clock.mock.restore()
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const afterFirstStop = {
      chatFocused: chat.focused(),
      sentences: harness.informationMessages.length,
    }

    // Act: move into chat during the pause, then capture a second pause without an intervening thread event.
    chat.focusTab()
    await harness.runtimes[0]!.continue(
      'browser',
      harness.runtimes[0]!.snapshots.at(-1)!.pause,
    )
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'auth.ts', column: 1 },
    })
    commitNextStop(harness.runtimes[0]!)
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(harness.panelReveals().slice(revealsBefore), [])
    // Assert
    assert.deepEqual(afterFirstStop, { chatFocused: false, sentences: 1 })
    assert.equal(chat.focused(), true)
    assert.equal(
      harness.commands.filter((command) => command === 'composer.focusComposer')
        .length,
      1,
    )
    assert.equal(harness.informationMessages.length, 1)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor who, at a pause of a live run at which the chat got the keyboard back, presses "Focus source" in the Study pane and then reads the source enlarged: the captured source has the keyboard and keeps it, and the Read passes its own check; fails_when=the return to the chat runs at every render of a pause, so the source the learner asked for loses the keyboard to the chat at once and Read Source fails with "The selected captured source is not visible in its native pane."; why_new=Cycle 0046 row 166 (delegated review, finding 2: a pause is settled once, and a render the learner asked for with the keyboard is never followed by a return); seam=workspace harness with the controlled runtime, a live run's viewport, addSeparateEditorPart, focusMutableDraft, pauseDebugger, the reader's Source and Read Source actions
test('a learner in Cursor who presses Focus source at a pause of a live run keeps the keyboard in the captured source, and Read Source then shows it enlarged', async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the learner typed in the chat when the run paused, and the chat got the keyboard back after the captured source was shown.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const chatFocusedAfterPause = chat.focused()

    // Act: the learner asks for the source with the keyboard, and then for the source enlarged.
    await harness.reader.action('source')
    const afterFocusSource = {
      chatFocused: chat.focused(),
      activeDocument:
        harness.editor.window.activeTextEditor?.document.uri.scheme,
    }
    await harness.reader.action('read-source')

    // Assert: one return, when the pause was settled; the source keeps the keyboard afterwards.
    assert.equal(chatFocusedAfterPause, true)
    assert.deepEqual(afterFocusSource, {
      chatFocused: false,
      activeDocument: 'codebook-source',
    })
    assert.equal(chat.focused(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.scheme,
      'codebook-source',
    )
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(
      harness.commands.filter((command) => command === 'composer.focusComposer')
        .length,
      1,
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor who presses "Focus source" before the reader showed anything for a pause of a live run: the captured source has the keyboard and keeps it through the reader's next render of that pause; fails_when=a render the learner asked for with the keyboard leaves the pause unsettled, so the reader's next render of the same pause sends the keyboard from the source to the chat; why_new=Cycle 0046 row 166 (a render asked for with the keyboard ends the chat's record); seam=workspace harness with the controlled runtime, a live run's viewport, addSeparateEditorPart, focusMutableDraft, pauseDebugger, the reader's Source and Retry actions
test('a learner in Cursor who presses Focus source before the reader showed a pause of a live run keeps the keyboard in the captured source through the next render of that pause', async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the learner typed in the chat, the run paused, and its stop is committed but not shown yet.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })

    // Act: the learner asks for the source with the keyboard; then the reader renders the same pause again.
    await harness.reader.action('source')
    await harness.reader.action('retry')

    // Assert
    assert.equal(chat.focused(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.scheme,
      'codebook-source',
    )
    assert.equal(harness.commands.includes('composer.focusComposer'), false)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor who clicks into a file during a pause of a live run, after the chat got the keyboard back: it stays in that file through every later render of the pause; fails_when=the return to the chat runs again at the next render of the same pause, because a record exists and a text editor is active, and takes the keyboard from the file the learner chose; why_new=Cycle 0046 row 166 (delegated review, finding 2 (c): a pause is settled once, at the first reveal after its frame appears); seam=workspace harness with the controlled runtime, a live run's viewport, addSeparateEditorPart, focusMutableDraft, pauseDebugger, the reader's Retry action
test("a learner in Cursor who clicks into a file during a pause of a live run keeps the keyboard in that file through the reader's next render of the pause, and the chat's tab does not take it", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the learner typed in the chat when the run paused, and the chat got the keyboard back after the captured source was shown.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const chatFocusedAfterPause = chat.focused()

    // Act: the learner clicks into a file; then the reader renders the same pause again.
    const learnerFile = harness.focusMutableDraft('learner-notes.ts', 1)
    await harness.reader.action('retry')

    // Assert: one return, when the pause was settled.
    assert.equal(chatFocusedAfterPause, true)
    assert.equal(chat.focused(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document,
      learnerFile.document,
    )
    assert.equal(
      harness.commands.filter((command) => command === 'composer.focusComposer')
        .length,
      1,
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the render of a pause of a live run when the editor refuses the return of the keyboard to Cursor's chat: the captured source is shown and committed, no reader error is reported, and the learner is told where the keyboard is; fails_when=the return is awaited inside the render without a guard, so a rejected focus command ends the render after the source was shown and reports a reader error for a keyboard courtesy; why_new=Cycle 0046 row 171 (delegated review, finding 8); seam=workspace harness with the controlled runtime, addSeparateEditorPart, focusMutableDraft, pauseDebugger, failNextCommand on Cursor's Focus Agent command
test("a pause of a live run is shown and committed when the editor refuses to give the keyboard back to Cursor's chat, and the learner is told where the keyboard is", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the learner typed in the chat when the run paused; the editor will reject Cursor's command that focuses the chat.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    harness.failNextCommand('composer.focusComposer')

    // Act: the run reaches its stop and the reader shows the stop's captured source over the paused file.
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()

    // Assert
    assert.equal(readerSeams(harness).isSourceShown(), true)
    assert.equal(readerSeams(harness).isLoading(), false)
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(chat.focused(), false)
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
      ],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

for (const moment of [
  "while the reader's return of the keyboard to the chat is still running",
  'right after that return, before the editor reports the chat',
] as const)
  // Value: protects=one shared chat return and no false takeover notice during actual source settlement; fails_when=another source-settlement caller ignores the pending or completed return; why_new=Cycle 0046 row 249; seam=held Composer response, passthrough source-settlement observer and public Retry
  test(`captured-source refresh shares chat return ${moment} without another App reveal`, async () => {
    // Arrange: native Source takes input at the pause while the actual Composer response is held.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.useHostAppName('Cursor')
    const chat = harness.addSeparateEditorPart()
    let live: { close(): void } | undefined
    let release = (): void => {},
      notifySourceSettling = (): void => {}
    const sourceSettling = new Promise<void>((resolve) => {
      notifySourceSettling = resolve
    })
    const settleKeyboard = harness.reader['settleKeyboardAtPause']
    try {
      const receipt = harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      const record = harness.service.record(receipt)
      await record.preparation
      await harness.reader.open()
      live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      const revealsBefore = harness.panelReveals().length
      // Observe the actual source-settlement call without replacing its result; the native chat response remains independently held.
      harness.reader['settleKeyboardAtPause'] = async (
        tookKeyboard,
      ): Promise<void> => {
        notifySourceSettling()
        await settleKeyboard.call(harness.reader, tookKeyboard)
      }
      chat.focusTab()
      const held = harness.holdNextCommand('composer.focusComposer')
      release = held.release
      harness.pauseDebugger({
        focusesEditorOnBreak: true,
        opensWithKeyboard: { filename: 'actions.ts', column: 1 },
      })
      const showsBefore = harness.textDocumentShows().length

      // Act: observe real source settlement while the same pause returns to chat, then exercise the pending or settled path.
      harness.service.action({
        instanceId: harness.service.instanceId,
        runId: record.id,
        key: randomUUID(),
        action: 'repository-click',
      })
      const shown = readerSeams(harness).refresh()
      await held.started
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
      await sourceSettling
      assert.equal(
        harness.editor.window.activeTextEditor?.document.uri.scheme,
        'codebook-source',
      )
      assert.equal(
        harness.editor.window.activeTextEditor?.document.getText(),
        'const nextTheme = "dark";\n',
      )
      assert.equal(harness.keyboardOnBody(), false)
      if (moment.startsWith('right after')) {
        held.release()
        await shown
        await harness.reader.action('retry')
      }
      const revealed = harness.revealApplicationPaneOverPausedFile()
      held.release()
      await Promise.all([shown, revealed])

      assert.equal(harness.keyboardOnBody(), false)
      // Assert: the real source update shares the pause's return, while the already-visible App needs no native reveal.
      assert.equal(harness.textDocumentShows().length > showsBefore, true)
      assert.deepEqual(
        harness
          .textDocumentShows()
          .slice(showsBefore)
          .map((shown) => shown.preserveFocus),
        moment.startsWith('right after') ? [false, true] : [false],
      )
      assert.deepEqual(harness.panelReveals().slice(revealsBefore), [])
      assert.equal(chat.focused(), true)
      assert.deepEqual(
        harness.commands.filter(
          (command) => command === 'composer.focusComposer',
        ),
        ['composer.focusComposer'],
      )
      assert.deepEqual(harness.informationMessages, [])
    } finally {
      release()
      harness.reader['settleKeyboardAtPause'] = settleKeyboard
      live?.close()
      await harness.close()
    }
  })

// Value: protects=newer learner input placed explicitly in the App group after chat return; fails_when=background App display replaces that dirty input or repeats chat focus; why_new=Cycle 0046 row 249 reconciled with final App admission; seam=actual capture, explicit learner file, background refusal and public focus-app recovery
test('a learner file explicitly placed in App after chat return rejects background replacement and permits explicit App recovery', async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the run paused, the reader showed the captured source and gave the keyboard back to the chat; then the learner clicked into a file in the Application pane's group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    const revealsBefore = harness.panelReveals().length
    chat.focusTab()
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const chatFocusedAfterReturn = chat.focused()
    const learnerFile = harness.focusMutableDraft('learner-notes.ts', 1)

    // Act
    await assert.rejects(
      harness.revealApplicationPaneOverPausedFile(),
      /Application ownership changed/,
    )

    // Assert: the learner file retains input and bytes without another chat return or App reveal.
    assert.equal(chatFocusedAfterReturn, true)
    assert.deepEqual(harness.panelReveals().slice(revealsBefore), [])
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.toString(),
      learnerFile.document.uri.toString(),
    )
    assert.equal(learnerFile.document.getText(), 'Original learner draft.\n')
    assert.equal(learnerFile.tab.isDirty, true)
    assert.equal(chat.focused(), false)
    assert.equal(harness.keyboardOnBody(), false)
    // Explicit recovery may front App, preserving the learner's file without another chat return.
    await harness.reader.action('focus-app')
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(learnerFile.tab)),
      true,
    )
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      ['composer.focusComposer'],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor who, after the chat got the keyboard back at a pause, clicks into the paused file and steps through it: it stays in that file at every step and when the run goes on; fails_when=the stop after a step is judged like a stop that happens by itself, so a step made within the look-back of the click leaves the chat's record in place, every further step renews it, and the next render or the continue runs the chat's focus command and takes the keyboard from the file the learner steps in; why_new=Cycle 0046 row 250 (delegated review, finding 3: a stop the learner starts from an editor ends the record, told by the reason the debug adapter gives); seam=workspace harness with the controlled runtime, a live run's viewport, addSeparateEditorPart, focusMutableDraft, pauseDebugger with the adapter's reason, resumeDebugger, the reader's Retry
test("a learner in Cursor who clicks into the paused file and steps through it keeps the keyboard in that file at every step and when the run goes on, and the chat's tab does not take it", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the learner typed in the chat when the run paused, and the chat got the keyboard back after the captured source was shown.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    harness.focusMutableDraft('actions.ts', 1)
    harness.pauseDebugger()
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const chatFocusedAfterPause = chat.focused()

    // Act: the learner clicks into the paused file and at once steps three times (the adapter reports each stop with the reason "step", and the editor a frame after a frame); the reader renders the pause once more; then the learner lets the run go on, and longer than the reader's steps take passes.
    const pausedFile = harness.focusMutableDraft('actions.ts', 1)
    harness.pauseDebugger({ reason: 'step' })
    harness.pauseDebugger({ reason: 'step' })
    await harness.reader.action('retry')
    harness.pauseDebugger({ reason: 'step' })
    harness.resumeDebugger()
    await delay(50)

    // Assert: one return, when the pause was settled; none afterwards.
    assert.equal(chatFocusedAfterPause, true)
    assert.equal(chat.focused(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.toString(),
      pausedFile.document.uri.toString(),
    )
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      ['composer.focusComposer'],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner who was typing in Cursor's Agent chat when the debugger was stepped from elsewhere (the debug toolbar, with the keyboard still in the chat): the chat has it again when that stop ends; fails_when=every stop with the reason "step" ends the chat's record, also while no text editor has the keyboard, so a step that nobody made from an editor leaves the keyboard in the file the debugger opened; why_new=Cycle 0046 row 250 (the bound of the new rule: only a step made while a text editor has the keyboard is the learner's work in that editor); seam=workspace harness with a live run's viewport, addSeparateEditorPart, focusMutableDraft, pauseDebugger with the adapter's reason, resumeDebugger
test('the chat that had the keyboard when the debugger was stepped from outside an editor has it again when that stop ends', async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; a live run has its Application pane and the learner types in the chat.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      randomUUID(),
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()

    // Act: the adapter reports a stop with the reason "step" while the chat has the keyboard; the debugger then opens the file with the keyboard and the editor reports the frame; the session goes on.
    harness.pauseDebugger({
      reason: 'step',
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    harness.resumeDebugger()
    await waitUntil(
      () => chat.focused(),
      'the chat to have the keyboard again after the stop ended',
      2_000,
    )

    // Assert
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      ['composer.focusComposer'],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner who works in a file in Cursor beside the Agent chat's tab when a live run pauses: it stays in the editor, and the chat does not take it; fails_when=the return to the chat runs at a pause without a record that the chat had the keyboard, so that every pause throws a learner who edits a file into the chat input; why_new=Cycle 0046 row 5, Cursor half (the other side of the return); seam=workspace harness with the controlled runtime, addSeparateEditorPart, focusMutableDraft, pauseDebugger, the clock of performance.now held for the editor events
test("a learner in Cursor who worked in a file for a minute before a pause of a live run keeps the keyboard in the editor at that pause, and the chat's tab does not take it", async (t) => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part, which never had the keyboard; the reader follows a live run and the learner works in a file.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    // On a held clock: the learner's file is the active editor; a minute later the debugger opens the paused file in front of the source group with the keyboard and Run and Debug names the stack item.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.focusMutableDraft('learner-notes.ts', 1)
    clockMs += 60_000
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    clock.mock.restore()

    // Act: the run reaches its stop and the reader shows the stop's captured source over the paused file.
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()

    // Assert: no return to the chat; the learner is told once where the keyboard is.
    assert.equal(chat.focused(), false)
    assert.equal(harness.commands.includes('composer.focusComposer'), false)
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner who was typing in Cursor's Agent chat (a tab of another editor part) when a live run paused, at the longest time the editor's own opening of the paused file may lie before the pause is named: the chat still gets the keyboard back; fails_when=the bound that tells the debugger's opening of the paused file from a learner's own move to a file is shortened or dropped, so that the file the debugger opens with the keyboard a moment before it selects the stack item ends the chat's record and the keyboard stays in the editor at every pause; why_new=Cycle 0046 row 5, Cursor half: the near side of PAUSE_FOCUS_LOOKBACK_MS (Cursor 3.23.12's debugger awaits the file's opening and selects the stack item after it); seam=workspace harness with the controlled runtime, addSeparateEditorPart, focusMutableDraft, pauseDebugger, the clock of performance.now held for the two editor events
test("the chat that had the keyboard gets it back at a pause of a live run when the paused file became the active editor one second before Run and Debug named the pause, the longest the debugger's own opening of that file is given", async (t) => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the reader follows a live run and the learner types in the chat.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    // The pause, on a held clock: the debugger opens the paused file with the keyboard, and Run and Debug names the stack item exactly 1,000 ms later.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.focusMutableDraft('actions.ts', 2)
    clockMs += 1_000
    harness.pauseDebugger()
    clock.mock.restore()

    // Act: the run reaches its stop and the reader shows the stop's captured source over the paused file.
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()

    // Assert: the chat has the keyboard again through Cursor's own command, and nothing is told.
    assert.equal(chat.focused(), true)
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      ['composer.focusComposer'],
    )
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor who left the Agent chat's tab for a file shortly before a live run paused: it stays in the editor, and the chat does not take it; fails_when=the bound that tells the debugger's opening of the paused file from a learner's own move to a file is lengthened or dropped, so that a learner who went from the chat to a file is thrown back into the chat input at the next pause; why_new=Cycle 0046 row 5, Cursor half: the far side of PAUSE_FOCUS_LOOKBACK_MS; seam=workspace harness with the controlled runtime, addSeparateEditorPart, focusMutableDraft, pauseDebugger, the clock of performance.now held for the editor events
test("a learner in Cursor who left the chat for a file 1.001 seconds before Run and Debug named a pause of a live run keeps the keyboard in the editor, and the chat's tab does not take it", async (t) => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the reader follows a live run and the learner types in the chat.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    chat.focusTab()
    // On a held clock: the learner goes to a file; 1,001 ms later the debugger opens the paused file with the keyboard and Run and Debug names the stack item.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.focusMutableDraft('learner-notes.ts', 1)
    clockMs += 1_001
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    clock.mock.restore()

    // Act: the run reaches its stop and the reader shows the stop's captured source over the paused file.
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()

    // Assert: no return to the chat; the learner is told once where the keyboard is.
    assert.equal(chat.focused(), false)
    assert.equal(harness.commands.includes('composer.focusComposer'), false)
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor who went from the Agent chat's tab to a file while a live run was paused: at the next pause it stays in the editor, and the learner is told where it is; fails_when=the chat's record outlives a pause during which the learner chose an editor (nothing is read from the editor while a session is paused), so that the next pause throws the learner back into the chat input; why_new=Cycle 0046 row 5, Cursor half (the end of a pause is the one moment at which the record can learn of a choice made during the pause); seam=workspace harness with the controlled runtime, the run's viewport made through the reader's presentation, addSeparateEditorPart, focusMutableDraft, pauseDebugger, revealApplicationPaneOverPausedFile
test("a learner in Cursor who went from the chat to a file during a pause of a live run keeps the keyboard in the editor at the next pause, and the chat's tab does not take it", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the learner typed in the chat when the run paused, and the chat got the keyboard back after the captured source was shown.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: {
        ...harness.configuration,
        additionalStops: [
          {
            line: 1,
            column: 1,
            inspections: harness.configuration.inspections,
          },
        ],
      },
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    const revealsBefore = harness.panelReveals().length
    chat.focusTab()
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const chatFocusedAfterFirstPause = chat.focused()

    // Act: during that pause the learner goes to a file; the run continues and pauses again, and the Application pane takes the keyboard from the next paused file.
    harness.focusMutableDraft('learner-notes.ts', 2)
    await harness.runtimes[0]!.continue(
      'browser',
      harness.runtimes[0]!.snapshots.at(-1)!.pause,
    )
    harness.resumeDebugger()
    harness.pauseDebugger({
      focusesEditorOnBreak: true,
      opensWithKeyboard: { filename: 'auth.ts', column: 1 },
    })
    commitNextStop(harness.runtimes[0]!)
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(harness.panelReveals().slice(revealsBefore), [])
    // Assert: one return, at the first pause only; at the second the keyboard stays and the learner is told where it is.
    assert.equal(chatFocusedAfterFirstPause, true)
    assert.equal(chat.focused(), false)
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      ['composer.focusComposer'],
    )
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
      ],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor whose settings page (a tab of the main editor) was in front before a live run paused, while the editor's layout cannot be read: Cursor's chat is not focused for that page; fails_when=an unknown group count is answered like "the group is in another editor part", so the chat's focus command runs for a remembered tab of the main editor and the keyboard lands in a chat the learner was not in; why_new=Cycle 0046 row 173 (delegated review, finding 10: nothing is guessed); seam=workspace harness with the controlled runtime, addSeparateEditorPart, addOpaqueTab, focusOpaqueTab, hideGridWhileMaximized with the editor's maximize command, focusMutableDraft, pauseDebugger
test("a settings page of the main editor that was in front before a pause of a live run does not get Cursor's chat focused while the editor's group count cannot be read", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the reader follows a live run in its two panes beside a third editor group, whose settings page is in front; a maximized group makes the editor answer no layout.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  harness.useHostAppName('Cursor')
  harness.hideGridWhileMaximized()
  harness.addSeparateEditorPart()
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    harness.focusOpaqueTab(harness.addOpaqueTab('Cursor Settings', 3))
    await harness.editor.commands.executeCommand(
      'workbench.action.toggleMaximizeEditorGroup',
    )
    const layoutWhileMaximized = await harness.editor.commands.executeCommand(
      'vscode.getEditorLayout',
    )
    // The pause: the debugger opens the paused file in front of the source group with the keyboard, then selects the stack frame.
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()

    // Act: the run reaches its stop and the reader shows the stop's captured source over the paused file.
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()

    // Assert: neither the chat's command nor a group's ran, and the learner is told where the keyboard is.
    assert.equal(layoutWhileMaximized, undefined)
    assert.equal(harness.commands.includes('composer.focusComposer'), false)
    assert.equal(
      harness.commands.includes('workbench.action.focusThirdEditorGroup'),
      false,
    )
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in Cursor whose settings page (a tab of the main editor) is to get the focus back, while the editor's layout read is no proof of the main editor because neither a text editor nor a pane is reported as active: nothing is run for that page's group, and the chat's group still gets Cursor's own command; fails_when=a group count without proof is answered like "the group is in another editor part" for every group, so the chat's focus command runs for a remembered tab of the main editor, against the rule that nothing is guessed; why_new=Cycle 0046 row 173 (delegated review, finding 10: the count is unknown whenever the main editor's focus is not proven, not only when the layout cannot be read); seam=the workspace harness's addSeparateEditorPart, addOpaqueTab, focusOpaqueTab, and the reader's choice of the return's command
test("the focus return runs no command for a group of the main editor, and Cursor's own for the chat's group, while the editor's layout read is no proof of which editor part answered", async () => {
  // Arrange: Cursor with two groups of the main editor and the Agent chat as a tab of another editor part; a settings page in the first group has the keyboard, so no text editor and no pane is reported as active.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  try {
    harness.focusOpaqueTab(harness.addOpaqueTab('Cursor Settings', 1))
    const groups = harness.editor.window.tabGroups.all
    const settingsGroup = groups.find((group) => group.viewColumn === 1)
    const chatGroup = groups.find((group) => group.tabs.includes(chat.tab))
    assert.ok(settingsGroup && chatGroup)

    // Act
    const commands = {
      settingsPageAfterAnArrangement: await readerSeams(
        harness,
      ).focusReturnCommand(settingsGroup, false),
      chatAfterAnArrangement: await readerSeams(harness).focusReturnCommand(
        chatGroup,
        false,
      ),
      chatAtAPause: await readerSeams(harness).focusReturnCommand(
        chatGroup,
        true,
      ),
    }

    // Assert
    assert.equal(harness.editor.window.activeTextEditor, undefined)
    assert.deepEqual(commands, {
      settingsPageAfterAnArrangement: undefined,
      chatAfterAnArrangement: 'composer.focusComposer',
      chatAtAPause: 'composer.focusComposer',
    })
  } finally {
    await harness.close()
  }
})

for (const layout of [
  'a side-view chat',
  "Cursor's chat as an editor tab",
] as const)
  // Value: protects=the keyboard of a learner who walks the frames of one pause with the arrow keys in the Call Stack view: it stays in that view, nothing of the reader is shown with the keyboard, no notice is told and no return to the chat runs, at each frame and when the pause ends; fails_when=a frame the learner selects is taken for a new stop, because the editor reports it the same way, so the file the editor opened for that frame without the keyboard counts as focused by the debugger: the captured source or the Application pane then takes the keyboard from the Call Stack view, the pause notice is told for a pause that took nothing, or Cursor's chat is focused when the pause ends; why_new=Cycle 0046 row 225 (the limit named under row 165: only the debug adapter tells a stop from a selection, by its stopped event); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger (the adapter's stopped event and the frame), focusView, selectStackFrame, resumeDebugger, the reader's refresh and Retry, revealApplicationPaneOverPausedFile
  test(`a learner who selects other frames of one pause in the Call Stack view keeps the keyboard in that view beside ${layout}: nothing is shown with the keyboard, no notice is told and no return runs`, async () => {
    // Arrange: a live run paused; the reader showed the stop's captured source, which settled the keyboard for that stop (beside a side-view chat the source took it and the notice was told; beside Cursor's chat tab the chat got it back). Then the learner clicked into the Call Stack view.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const chat =
      layout === "Cursor's chat as an editor tab"
        ? harness.addSeparateEditorPart()
        : undefined
    if (chat) harness.useHostAppName('Cursor')
    let live: { close(): void } | undefined
    try {
      const receipt = harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      const record = harness.service.record(receipt)
      await record.preparation
      await harness.reader.open()
      live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      chat?.focusTab()
      harness.focusMutableDraft('actions.ts', 2)
      harness.pauseDebugger()
      harness.service.action({
        instanceId: harness.service.instanceId,
        runId: record.id,
        key: randomUUID(),
        action: 'repository-click',
      })
      await readerSeams(harness).refresh()
      harness.focusView()
      const before = {
        sentences: harness.informationMessages.length,
        shows: harness.textDocumentShows().length,
        reveals: harness.panelReveals().length,
        commands: harness.commands.length,
      }

      // Act: with the arrow keys the learner selects the caller's frame, whose file the editor opens over the captured source, and then a third frame, whose file it opens over the Application pane; the reader's timer runs after each and the reader renders the pause once more, the Application pane comes to the front again, and the run goes on.
      harness.selectStackFrame('login-form.tsx', 2)
      await readerSeams(harness).refresh()
      await harness.reader.action('retry')
      harness.selectStackFrame('page.tsx', 1)
      await harness.revealApplicationPaneOverPausedFile()
      await readerSeams(harness).refresh()
      harness.resumeDebugger()
      await delay(50)

      // Assert: the keyboard is still in the Call Stack view; whatever was shown was shown without the keyboard.
      assert.equal(harness.keyboardInView(), true)
      assert.deepEqual(
        harness
          .textDocumentShows()
          .slice(before.shows)
          .filter((shown) => !shown.preserveFocus),
        [],
      )
      assert.deepEqual(
        harness
          .panelReveals()
          .slice(before.reveals)
          .filter((reveal) => !reveal.preserveFocus),
        [],
      )
      assert.deepEqual(
        harness.commands
          .slice(before.commands)
          .filter((command) =>
            /^workbench\.action\.focus|^composer\./.test(command),
          ),
        [],
      )
      assert.equal(harness.informationMessages.length, before.sentences)
      assert.equal(chat?.focused() ?? false, false)
    } finally {
      live?.close()
      await harness.close()
    }
  })

// Value: protects=the keyboard of a learner in Cursor who, at a stop of a live run that the reader has not shown yet, goes from the chat to the Call Stack view and selects another frame in the same file: when the run goes on, the keyboard stays in that view; fails_when=the pause still counts as one whose keyboard the debugger's file holds, because the selected frame's file is the same document, and the end of the pause focuses the chat; why_new=Cycle 0046 row 225 (a selected frame leaves the pause to the learner: no return is owed for it any more); seam=workspace harness with a live run's viewport, addSeparateEditorPart, pauseDebugger, focusView, selectStackFrame, resumeDebugger
test("a learner in Cursor who selects another frame of a stop the reader has not shown yet keeps the keyboard in the Call Stack view when the run goes on, and the chat's tab does not take it", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the learner typed in the chat when a live run stopped, and the debugger opened the paused file with the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      randomUUID(),
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    harness.focusMutableDraft('actions.ts', 1)
    harness.pauseDebugger()

    // Act: the learner clicks into the Call Stack view and selects the caller's frame, which lies in the same file; then the run goes on, and longer than the reader's steps take passes.
    harness.focusView()
    harness.selectStackFrame('actions.ts', 1)
    harness.resumeDebugger()
    await delay(50)

    // Assert
    assert.equal(harness.keyboardInView(), true)
    assert.equal(chat.focused(), false)
    assert.equal(harness.commands.includes('composer.focusComposer'), false)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard at a stop of a debug session that started before the reader did (the extension was activated or its reader made anew while the session ran), whose adapter the reader does not hear: the captured source that replaces the file the debugger focused takes the keyboard it had; fails_when=a frame without a stop event is always taken for one the learner selected, so for such a session the source is shown over the focused file while preserving the focus, which leaves the keyboard on the page body (the defect of Cycle 0045 NF-4); why_new=Cycle 0046 row 225 (the bound of the new rule: a session without messages is judged as before); seam=workspace harness with the controlled runtime, focusMutableDraft, pauseDebugger with startedBeforeTheReader, textDocumentShows
test('the captured source takes the keyboard focus when it replaces the file the debugger focused at a stop of a debug session that started before the reader, whose stop events the reader does not hear', async () => {
  // Arrange: the reader follows a live run in its two panes; the session's adapter is not heard; the debugger opened the paused file in front of the source group with the keyboard.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger({ startedBeforeTheReader: true })
    const showsBefore = harness.textDocumentShows().length

    // Act: the run reaches its stop and the reader shows the stop's captured source in the source group.
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()

    // Assert
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [
      { name: 'Captured-theme.ts', viewColumn: 2, preserveFocus: false },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner who types in Cursor's Agent chat while another frame of the same pause is selected (a click of the mouse into the Call Stack that the chat answers with its own focus, or the editor's own change of the frame): the chat keeps it, and nothing of the reader moves; fails_when=the selected frame is taken for a new stop and the reader settles a keyboard nobody took; why_new=Cycle 0046 row 225 (the keyboard in the chat's tab while the frame changes); seam=workspace harness with the controlled runtime, addSeparateEditorPart, pauseDebugger, selectStackFrame, the reader's refresh
test("a frame selected at a pause while the learner types in Cursor's chat tab leaves the keyboard in the chat: nothing is shown with the keyboard and no notice is told", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the run paused and the chat got the keyboard back after the captured source was shown.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    const before = {
      chatFocused: chat.focused(),
      shows: harness.textDocumentShows().length,
      commands: harness.commands.length,
    }

    // Act: another frame is selected, whose file the editor opens over the captured source without the keyboard; the reader's timer runs.
    harness.selectStackFrame('login-form.tsx', 2)
    await readerSeams(harness).refresh()

    // Assert
    assert.equal(before.chatFocused, true)
    assert.equal(chat.focused(), true)
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(before.shows)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.deepEqual(
      harness.commands
        .slice(before.commands)
        .filter((command) =>
          /^workbench\.action\.focus|^composer\./.test(command),
        ),
      [],
    )
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=a learner whose settings page (a tab of the main editor that is no text editor) was in front before a live run paused: the keyboard is not moved to that page at the pause, and the learner is told where it is, as a learner in a file is; fails_when=the return made for Cursor's chat at a pause also runs the editor's numbered group focus command for any tab without a text editor, which moves the keyboard without a word for a learner who was typing in a side-view chat, the terminal or a view beside that page; why_new=Cycle 0046 row 5, found while its controls were prepared (the return of an arrangement gives such a group the keyboard back; at a pause only the chat gets it); seam=workspace harness with the controlled runtime, addOpaqueTab, focusOpaqueTab, focusMutableDraft, pauseDebugger
test('a settings page that was in front before a pause of a live run does not get the keyboard at that pause, and the learner is told once where the keyboard is', async () => {
  // Arrange: the reader follows a live run in its two panes beside a third editor group; a settings page is the tab in front of that group and no text editor is active.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    await harness.reader.open()
    const panes = harness.reader.presentationState().panes
    harness.focusOpaqueTab(harness.addOpaqueTab('Settings', 3))
    // The pause: the debugger opens the paused file in front of the source group with the keyboard, then selects the stack item.
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    const commandsBefore = harness.commands.length

    // Act: the run reaches its stop and the reader shows the stop's captured source over the paused file.
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()

    // Assert: the settings page's group is no pane's; no group focus command ran for it, and the sentence was told.
    assert.deepEqual(
      { appColumn: panes.appColumn, sourceColumn: panes.sourceColumn },
      { appColumn: 1, sourceColumn: 2 },
    )
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.focusThirdEditorGroup'),
      false,
    )
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'The debugger opened the paused file with the keyboard, and the Codebook pane shown in its place (the Application pane or the captured source) has the keyboard now. If you were typing in the chat, click its input to continue there: this editor does not tell Codebook whether the chat had the keyboard.',
      ],
    )
  } finally {
    await harness.close()
  }
})
