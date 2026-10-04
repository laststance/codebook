import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import type { NodeTestSourceStop } from '../ownedNodeTestRun'
import { RecordingStore } from '../recordingStore'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  workspaceHarness,
  saveOneStopNodeHistory,
  recordedReaderHarness,
} from './studyWorkspaceHarness'
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
      groups: [{ size: 0.5 }, { size: 0.5 }],
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
      groups: [{ size: 0.5 }, { size: 0.5 }],
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
    assert.equal(harness.reader.inspect().presentation.layoutConfirmed, false)
    assert.ok(
      harness.reader
        .inspect()
        .view!.errors.some((error) =>
          error.includes('Existing editor groups were preserved'),
        ),
    )
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

    // Assert: once per session, and again in the next one.
    assert.equal(offersInFirstSession, 1)
    assert.deepEqual(harness.informationMessages, [
      {
        message:
          'Cursor opens the Codebook Learning summary in its primary side bar. To keep it on the right, move it once: choose "New Secondary Side Bar Entry" in the list that opens.',
        items: ['Move Learning Summary…'],
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

// Value: protects=a way to move the Learning summary that stays after Cursor removed the offer's notification; fails_when=the reader never turns on the context key that shows "Move Learning Summary…" in the summary's title and the Command Palette, or the command behind it no longer opens the editor's Move View list for the summary; why_new=Cycle 0045 NF-25 as DR-9 (Cursor removes an information notification with a button after 15 s, so a notification cannot be the only way); seam=the harness keeps the context keys set with setContext
test('in Cursor the Learning summary offers Move Learning Summary… in its title after the offer’s notification is gone', async () => {
  // Arrange: in Cursor the summary was shown and its offer's notification went away unanswered.
  const harness = await recordedReaderHarness()
  try {
    harness.useHostAppName('Cursor')
    const titleActionShownBeforeTheSummary = harness.contextKey(
      'codebook.learningSummaryMovable',
    )
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await waitUntil(
      () => harness.informationMessages.length === 1,
      'the unanswered offer',
      1_000,
    )
    const moveListsBefore = harness.commands.filter(
      (command) => command === 'workbench.action.moveFocusedView',
    ).length

    // Act: the learner presses the title action, which runs the contributed command.
    await harness.reader.moveLearningSummary()
    await harness.reader.showLearningSummary()
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Assert: the control is on, it opens the Move View list, and the step once taken is not offered again.
    assert.equal(titleActionShownBeforeTheSummary, undefined)
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
    await harness.close()
  }
})

// Value: protects=Cursor's learner being told why the Learning summary left the screen at Show Variables and how to keep both in view; fails_when=Run and Debug takes the summary's place in the shared side bar and nothing is offered, so the summary and the recorded values are never on screen together; why_new=Cycle 0045 NF-9 as DR-9 (second native round, candidate 14: after one press Run and Debug stayed in front and no Move offer appeared); seam=the harness's Variables focus command hides the summary, as Cursor's shared side bar does
test('in Cursor, Show Variables that took the Learning summary’s place in the side bar offers the Move View step', async () => {
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
