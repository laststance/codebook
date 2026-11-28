import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import {
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'

// Value: protects=Keep Tab Open on a learner's non-text preview tab (an image, a custom editor) keeping that tab and retrying the open, and telling the learner when the tab cannot be kept instead of closing it; fails_when=Keep Tab Open closes the non-text preview (the learner lost the tab the dialog promised to keep), or a tab that cannot be kept is silently dropped or the open is retried into the same refusal; why_new=Cycle 0050 F363 (the Keep branch handled text tabs only and fell through to the close); seam=addNonTextPreview, the editor's focus-group and keepEditor commands in the fake, answerWarningDialogs
for (const scenario of [
  { isFront: true, keeps: true },
  { isFront: false, keeps: false },
] as const)
  test(`Open replay beside a learner's non-text preview tab: Keep Tab Open ${scenario.keeps ? 'keeps the tab and retries the open' : 'leaves a tab behind another one open, retries nothing and tells the learner'}`, async () => {
    // Arrange
    const harness = await recordedReaderHarness()
    try {
      await harness.reader.close()
      harness.useNativeLayout({ orientation: 0, groups: [{}] })
      harness.focusMutableDraft('learner-notes.ts', 1)
      const agentChat = harness.addSeparateEditorPart()
      const preview = harness.addNonTextPreview(
        'diagram.png',
        1,
        scenario.isFront,
      )
      agentChat.focus()
      const hasMainEditorFocus = harness.reader['hasMainEditorFocus'].bind(
        harness.reader,
      )
      harness.reader['hasMainEditorFocus'] = (groupCount: number): boolean =>
        groupCount === 1 && preview.isPreview
          ? false
          : hasMainEditorFocus(groupCount)
      harness.answerWarningDialogs(async () => 'Keep Tab Open')
      let openAttempts = 0
      const openRecording = harness.reader.openRecording.bind(harness.reader)
      harness.reader.openRecording = (studyId: string): Promise<void> => {
        openAttempts++
        return openRecording(studyId)
      }

      // Act
      await harness.reader.openLearningReplay(harness.studyId)
      await harness.controller.settle()

      // Assert
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(preview)),
        true,
      )
      assert.equal(preview.isPreview, !scenario.keeps)
      assert.equal(openAttempts, scenario.keeps ? 2 : 1)
      assert.deepEqual(
        harness.warningDialogs.slice(1).map((dialog) => dialog.title),
        scenario.keeps
          ? []
          : [
              'Codebook could not keep "diagram.png" open. Double-click its tab to keep it, then choose Open replay again.',
            ],
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner who chose Keep Tab Open for a non-text preview that cannot be kept being told once, by the notice that says how to keep it, and not again by a generic "could not open the learning replay" notification about the same preview; fails_when=a refused Keep Tab Open is followed by the load-failure notification of the same refusal; why_new=Cycle 0050 F394 (the keep notice returned false, so the caller told the failure again); seam=addNonTextPreview behind another tab, the fake editor's keepEditor command, answerWarningDialogs, the harness's error notifications; no_claim=the wording of the keep notice
test('Open replay beside a non-text preview that cannot be kept tells the learner once and shows no load-failure notification', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.focusMutableDraft('learner-notes.ts', 1)
    const agentChat = harness.addSeparateEditorPart()
    const preview = harness.addNonTextPreview('diagram.png', 1, false)
    agentChat.focus()
    const hasMainEditorFocus = harness.reader['hasMainEditorFocus'].bind(
      harness.reader,
    )
    harness.reader['hasMainEditorFocus'] = (groupCount: number): boolean =>
      groupCount === 1 && preview.isPreview
        ? false
        : hasMainEditorFocus(groupCount)
    harness.answerWarningDialogs(async () => 'Keep Tab Open')

    // Act
    await harness.reader.openLearningReplay(harness.studyId)
    await harness.controller.settle()

    // Assert
    assert.deepEqual(
      harness.warningDialogs.slice(1).map((dialog) => dialog.title),
      [
        'Codebook could not keep "diagram.png" open. Double-click its tab to keep it, then choose Open replay again.',
      ],
    )
    assert.deepEqual(harness.errorMessages, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=the browser replay's Open replay refused for a non-text preview that cannot be kept: the learner is told once by the keep notice, and the refusal is still recorded in one Output › Codebook open:recording entry, as a test replay's is (F407) and as every other failed browser replay open is (Cycle 0052 task 59); fails_when=the keep notice's early return skips the Output entry, so the README's promise that a failed browser replay open writes one fails for this cause (Cycle 0052 task 81); why_new=hosted CodeRabbit on PR #127 (studyWorkspace.ts:11599); seam=addNonTextPreview behind another tab, answerWarningDialogs, the diagnostics log and the harness's error notifications; no_claim=the wording of the keep notice
test('a browser replay Open replay refused for a non-text preview that cannot be kept tells the learner once and records the refusal in one Output entry', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.focusMutableDraft('learner-notes.ts', 1)
    const agentChat = harness.addSeparateEditorPart()
    const preview = harness.addNonTextPreview('diagram.png', 1, false)
    agentChat.focus()
    const hasMainEditorFocus = harness.reader['hasMainEditorFocus'].bind(
      harness.reader,
    )
    harness.reader['hasMainEditorFocus'] = (groupCount: number): boolean =>
      groupCount === 1 && preview.isPreview
        ? false
        : hasMainEditorFocus(groupCount)
    harness.answerWarningDialogs(async () => 'Keep Tab Open')

    // Act
    await harness.reader.openLearningReplay(harness.studyId)
    await harness.controller.settle()

    // Assert
    assert.deepEqual(
      {
        notices: harness.warningDialogs.slice(1).map((dialog) => dialog.title),
        errorMessages: harness.errorMessages,
        outputEntries: logged.map((entry) => [entry.surface, entry.studyId]),
      },
      {
        notices: [
          'Codebook could not keep "diagram.png" open. Double-click its tab to keep it, then choose Open replay again.',
        ],
        errorMessages: [],
        outputEntries: [['open:recording', harness.studyId]],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who chose Keep Tab Open for a non-text preview that cannot be kept, when a test replay's Open replay was refused for it, being told once by the keep notice, with no second notification, and the refusal recorded in one Output › Codebook open:test-replay entry (F407); fails_when=a refused Keep Tab Open is followed by the test replay's load-failure notification, or leaves no Output entry; why_new=Cycle 0050 F394 (openNodeHistoryFromHost told the failure after the keep notice); seam=openNodeHistory answering a foreign-preview failure, addNonTextPreview behind another tab, answerWarningDialogs, the diagnostics log and the harness's error notifications; no_claim=how the replay's open meets the preview (the F158 rounds above)
test('a test replay Open replay refused for a non-text preview that cannot be kept tells the learner once and records the refusal in one Output entry', async (context) => {
  // Arrange
  const harness = await workspaceHarness(false)
  const logged: CodebookDiagnostic[] = []
  harness.reader.diagnostics = {
    log: (entry) => logged.push(entry),
    show: () => undefined,
  }
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    harness.focusMutableDraft('learner-notes.ts', 1)
    harness.addNonTextPreview('diagram.png', 1, false)
    harness.answerWarningDialogs(async () => 'Keep Tab Open')
    // The summary composition the open enters first puts the Application pane in group 1, so the learner's group with the preview is group 2 when the open meets it (Cycle 0051, DS-A).
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
    await harness.reader.openNodeHistoryFromHost('a_b')

    // Assert
    assert.deepEqual(
      harness.warningDialogs.slice(1).map((dialog) => dialog.title),
      [
        'Codebook could not keep "diagram.png" open. Double-click its tab to keep it, then choose Open replay again.',
      ],
    )
    assert.deepEqual(harness.errorMessages, [])
    assert.deepEqual(
      logged.map((entry) => [entry.surface, entry.studyId, entry.cause]),
      [
        [
          'open:test-replay',
          'a_b',
          'A destination group contains a foreign preview: "diagram.png" in editor group 2. Close that tab, or keep it open (double-click its tab), then try again.',
        ],
      ],
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

test('a presentation selection refused for a learner preview names that tab, its group and how to clear it', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    // An unedited text preview is pinned and the selection goes on (0036-N02); one with unsaved edits cannot be pinned for the learner and still refuses.
    const learnerPreview = harness.addTextPreview(
      join(harness.directory, 'learner-notes.ts'),
      1,
      true,
    )
    const state = harness.reader.presentationState()

    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'living-book',
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'A destination group contains a foreign preview: "learner-notes.ts" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
      },
    )

    // Assert
    assert.equal(
      harness.reader.presentationState().reason,
      'Error: A destination group contains a foreign preview: "learner-notes.ts" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
    )
    assert.equal(learnerPreview.isPreview, true)
  } finally {
    await harness.close()
  }
})
