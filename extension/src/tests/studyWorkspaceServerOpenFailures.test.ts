import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import { readerSeams, workspaceHarness } from './studyWorkspaceHarness'
import {
  advanceClockUntilSettled,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'
import {
  openServerReplay,
  repositoryOf,
  workspaceKeyOf,
} from './utils/serverWorkspaceHarness'
import { lastView } from './utils/twoStopNodeHistory'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=a server history whose summary cannot be read at open shows the cause on the learning line; fails_when=the failure is swallowed and the replay reads as an explanation that was never saved; no_claim=what the summary would have said
test('opening a server replay whose summary cannot be read names the cause on the learning line', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: workspaceKeyOf(harness),
    })
    // The catalog lists the history before the summary starts to fail, as a summary that breaks later does.
    await harness.reader.action('retry')
    context.mock.method(
      repositoryOf(harness).serverHistories,
      'summarize',
      async () => {
        throw new Error('summary file unreadable')
      },
    )

    // Act
    await harness.reader.openLearningReplay(header.studyId)
    await waitUntil(
      () => lastView(harness)?.nodeHistory?.header.studyId === header.studyId,
      'the server replay is shown',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(
      readerSeams(harness)
        .errorLines()
        .includes(
          'Learning status of this server replay could not be read: summary file unreadable',
        ),
      true,
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// protects=closing the reader waits for the reader-position write of a server replay that is still running, as it does for a test replay; fails_when=close reports closed while a server position write is pending, so the file lands in storage that is gone; no_claim=the bound on a write that never returns
test('closing the reader waits for a server reader-position write that is still running', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const repository = repositoryOf(harness)
    const { header, sequences } = await writeServerHistory(repository, {
      workspaceKey: workspaceKeyOf(harness),
    })
    const store = repository.serverHistories
    await openServerReplay(harness, header.studyId)
    const read = store.read.bind(store)
    let releaseRead = (): void => {}
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let readEntered = (): void => {}
    const readStarted = new Promise<void>((resolve) => {
      readEntered = resolve
    })
    store.read = async (studyId): ReturnType<typeof read> => {
      readEntered()
      await readHeld
      return read(studyId)
    }
    const write = store.saveReaderPosition(header.studyId, sequences.request)
    await readStarted

    // Act
    const closing = harness.reader.close()
    const closedWhileWriting = await Promise.race([
      closing.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
    ])
    releaseRead()
    await closing
    await write
    store.read = read

    // Assert
    assert.equal(closedWhileWriting, false)
    assert.equal(
      await store.readReaderPosition(header.studyId),
      sequences.request,
    )
  } finally {
    await harness.close()
  }
})

// protects=a summary read that fails after a newer open took over reports nothing on the learning line; fails_when=the abandoned open's summary error appears; no_claim=the newer open's own result
test('a summary failure of a server replay whose open was superseded is not reported', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: workspaceKeyOf(harness),
    })
    await harness.reader.action('retry')
    const store = repositoryOf(harness).serverHistories
    const summarize = store.summarize.bind(store)
    let failSummary: () => void = () => undefined
    let held = false
    context.mock.method(store, 'summarize', async (studyId: string) => {
      // Only the replay open's own read is held and fails; the library listing's reads pass through.
      if (held || !new Error().stack?.includes('readServerHistoryOpening'))
        return summarize(studyId)
      held = true
      await new Promise<void>((resolve) => {
        failSummary = resolve
      })
      throw new Error('summary file unreadable')
    })

    // Act
    const opening = harness.reader.openLearningReplay(header.studyId)
    await waitUntil(
      () => held,
      'the summary read is held',
      READER_RESULT_BOUND_MS,
    )
    // A newer open takes the request number while this read is pending.
    harness.reader['historyRequest']++
    failSummary()
    await opening

    // Assert
    assert.deepEqual(
      readerSeams(harness)
        .errorLines()
        .filter((line) => line.includes('summary file unreadable')),
      [],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// protects=a server replay that cannot be read is logged in Output › Codebook as its own surface and profile (open:server-replay, node-server), never as a test replay; fails_when=the entry names open:test-replay or node-test for a server study; no_claim=the notification wording
test('a server replay whose journal cannot be read is logged as open:server-replay with the node-server profile', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: workspaceKeyOf(harness),
    })
    await harness.reader.action('retry')
    context.mock.method(
      repositoryOf(harness).serverHistories,
      'read',
      async () => {
        throw new Error('journal unreadable')
      },
    )

    // Act
    await harness.reader.openLearningReplay(header.studyId)

    // Assert
    assert.deepEqual(
      logged.map((entry) => [
        entry.surface,
        entry.studyId,
        entry.profile,
        entry.cause,
      ]),
      [
        [
          'open:server-replay',
          header.studyId,
          'node-server',
          'journal unreadable',
        ],
      ],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// protects=a server replay refused for a non-text preview the learner could not keep is recorded once as open:server-replay with the node-server profile; fails_when=the keep-open refusal's entry names open:test-replay or node-test; no_claim=how the open meets the preview
test('a server replay refused for a non-text preview that cannot be kept is recorded as open:server-replay with the node-server profile', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: workspaceKeyOf(harness),
    })
    await harness.reader.open()
    await harness.reader.action('retry')
    harness.focusMutableDraft('learner-notes.ts', 1)
    harness.addNonTextPreview('diagram.png', 1, false)
    harness.answerWarningDialogs(async () => 'Keep Tab Open')
    context.mock.method(
      harness.reader as unknown as { openNodeHistory: () => Promise<unknown> },
      'openNodeHistory',
      async () => ({
        status: 'failed',
        error: new Error(
          'A destination group contains a foreign preview: "diagram.png" in editor group 2. Close that tab, or keep it open (double-click its tab), then try again.',
        ),
      }),
    )

    // Act
    await harness.reader.openNodeHistoryFromHost(header.studyId)

    // Assert
    assert.deepEqual(
      logged.map((entry) => [entry.surface, entry.profile]),
      [['open:server-replay', 'node-server']],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

// protects=a server replay opened beside the chat while an empty group at column 1 has no record that proves it Codebook's is refused with the empty-group sentence and the group is left as it is; fails_when=Codebook focuses, unlocks or closes an unproven empty group, or opens the replay in it; no_claim=that the group is the leftover of an earlier window (N59 is still to be measured natively)
test('a server replay opened beside the chat while an unproven empty group stands at column 1 is refused naming that group and leaves it as it is', async () => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: workspaceKeyOf(harness),
    })
    harness.leaveEmptyLockedGroup(1)
    const emptyGroup = harness.groups.find((group) => group.viewColumn === 1)!
    harness.focusMutableDraft('learner-notes.ts', 2)
    chat.focusTab()
    await harness.reader.action('retry')

    // Act
    await harness.reader.openLearningReplay(header.studyId)

    // Assert
    assert.equal(harness.groups.includes(emptyGroup), true)
    assert.equal(emptyGroup.locked, true)
    assert.deepEqual(
      logged.map((entry) => [entry.surface, entry.profile]),
      [['open:server-replay', 'node-server']],
    )
    assert.match(
      logged[0]!.cause,
      /the first editor group \(column 1\) is empty/,
    )
  } finally {
    await harness.close()
  }
})

// protects=a server replay opened beside two learner groups records the Application group it claimed at column 1, which is what lets the window after a reload retire that group's empty leftover; fails_when=a server replay's composition leaves no record, so the next window cannot prove the group; no_claim=what Cursor restores after Reload Window (N59 is still to be measured natively)
test('a server replay opened beside two learner groups records the Application group it claimed at column 1', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: workspaceKeyOf(harness),
    })
    harness.focusMutableDraft('learner-notes.ts', 1)
    harness.focusMutableDraft('learner-readme.md', 2)
    chat.focusTab()

    // Act
    await openServerReplay(harness, header.studyId)
    await waitUntil(
      () => harness.applicationGroupMarkers.has('codebook.applicationGroup.v1'),
      'the Application group record is written',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    const marker = harness.applicationGroupMarkers.get(
      'codebook.applicationGroup.v1',
    ) as { writer?: unknown } | undefined
    assert.deepEqual(
      {
        ...marker,
        writer:
          marker?.writer === harness.reader['applicationGroupMarkerWriter'],
      },
      {
        version: 1,
        writer: true,
        column: 1,
        groupCount: 3,
        layout: {
          orientation: 0,
          groups: [
            { size: 1, groups: [{ size: 0.5 }, { size: 0.5 }] },
            { size: 1 },
          ],
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// protects=a server replay opened after a window reload retires the empty Application group the earlier window recorded and opens with no manual step; fails_when=the recorded empty group at column 1 refuses the open as an unproven group; no_claim=Cursor's own report after a reload (N59 is still to be measured natively)
test('a server replay opened after a window reload retires the empty Application group the earlier window recorded and opens', async () => {
  // Arrange
  const harness = await workspaceHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: workspaceKeyOf(harness),
    })
    harness.applicationGroupMarkers.set('codebook.applicationGroup.v1', {
      version: 1,
      writer: 'the window before the reload',
      column: 1,
      groupCount: 3,
      layout: {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      },
    })
    harness.leaveEmptyLockedGroup(1)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    chat.focusTab()
    await harness.reader.action('retry')

    // Act
    await harness.reader.openLearningReplay(header.studyId)
    await waitUntil(
      () => lastView(harness)?.nodeHistory?.header.studyId === header.studyId,
      'the server replay is shown',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(logged, [])
    assert.equal(lastView(harness)?.nodeReplayProfile, 'node-server')
  } finally {
    await harness.close()
  }
})

// protects=a server replay refused once for the main editor's unreported keyboard focus and then opened with the learner's click shows no trace of the refusal in the Study pane or the Learning summary; fails_when=the first refusal's sentence stays as an error line beside the working replay; no_claim=the focus measurement itself (N60 is measured natively)
test('a server replay that opens after a refused first open leaves no refusal sentence on the pane error lines', async (context) => {
  // Arrange
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  await harness.reader.open()
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    const { header } = await writeServerHistory(repositoryOf(harness), {
      workspaceKey: workspaceKeyOf(harness),
    })
    harness.focusOpaqueTab(harness.addOpaqueTab('Cursor Settings', 1))
    chat.focusTab()
    await harness.reader.action('retry')

    // Act: the refused entry waits five faked seconds twice, once for the open and once for its way back to the Study composition.
    const first = harness.reader.openLearningReplay(header.studyId)
    enableFakeClock(context)
    await advanceClockUntilSettled(context, first, 12_000)
    await first
    resetFakeClock(context)
    harness.focusMutableDraft('learner-notes.ts', 1)
    await harness.reader.openLearningReplay(header.studyId)
    await waitUntil(
      () =>
        lastView(harness)?.nodeHistory?.header.studyId === header.studyId &&
        !lastView(harness)?.loading,
      'the server replay is shown',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.deepEqual(readerSeams(harness).errorLines(), [])
    assert.equal(
      JSON.stringify(lastView(harness)).includes('did not report the keyboard'),
      false,
    )
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})
