import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { capturedSourceUriPath } from '../utils/capturedSourceUriPath'

import {
  workspaceHarness,
  recordedReaderHarness,
  readerSeams,
} from './studyWorkspaceHarness'
import {
  advanceClockUntilSettled,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'
import {
  REPLAY_MODEL_SELECTION_SCENARIO,
  selectionsThroughScenario,
  type ReplayModelSelectionDriver,
  type ReplayModelSelectionFrame,
} from './utils/replayModelSelectionScenario'

// Regression: 558 — replacing the historical source cannot orphan its native keyboard.
// Found by /qa on 2026-10-15.
// Report: https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/cycles/0046-carried-defects-of-cycle-0045.md
// Value: protects=source keyboard through a historical seek; fails_when=a replacement hides its focused input while preserving focus; why_new=recording tests omit a genuine source selection before seeking; seam=none; no_claim=native keyboard (controlled editor).
for (const scenario of [
  {
    name: 'keeps the keyboard in the historical source the learner selected',
    choosesView: false,
    focused: true,
  },
  {
    name: 'leaves the keyboard in an unreported native view after the learner left historical source',
    choosesView: true,
    focused: true,
  },
  {
    name: 'takes no keyboard from another window after a historical source choice',
    choosesView: true,
    focused: false,
  },
]) {
  test(`seeking a saved recording gap ${scenario.name}`, async () => {
    // Arrange: a saved captured stop is open and the learner clicks into its native source.
    const harness = await recordedReaderHarness(true, true)
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 100,
      })
      await harness.controller.settle()
      await harness.reader.action('source')
      harness.workInActiveTextEditor('mouse')
      // A native view can own the keyboard while the editor still reports the earlier source.
      if (scenario.choosesView) harness.focusView()
      harness.changeWindowFocus(scenario.focused)
      const selectedSourceUri = harness.reader.inspect().sourceUri,
        shownBefore = harness.textDocumentShows().length
      const captured = harness.reader.inspect().view!.model.observation
      assert.ok(captured)
      const canonicalDocument = await harness.editor.workspace.openTextDocument(
        harness.editor.Uri.from({
          scheme: 'codebook-source',
          authority: (await harness.reader.learningStorage()).workspaceKey,
          path: capturedSourceUriPath({
            owner: harness.studyId,
            itemId: captured.itemId,
            hash: captured.source.hash,
            declaredPath: 'src/theme.ts',
            fallbackName: 'theme.mts',
          }),
        }),
      )

      // Act: the prior native input must remain usable when its history becomes unavailable.
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 20,
      })
      await harness.controller.settle()

      // Assert: historical bytes change in the same input, without guessing its keyboard owner.
      assert.equal(harness.controller.state().presentedMs, 20)
      const gapEditor = harness.editor.window.visibleTextEditors.find(
        (editor) =>
          editor.document.uri.toString() === harness.reader.inspect().sourceUri,
      )
      assert.equal(
        gapEditor?.document.getText(),
        '// Not recorded at this moment.\n',
      )
      assert.equal(
        harness.historicalDebugPresentations.at(-1)?.snapshot,
        undefined,
      )
      assert.equal(harness.reader.inspect().sourceUri, selectedSourceUri)
      assert.deepEqual(harness.textDocumentShows().slice(shownBefore), [])
      assert.equal(harness.keyboardOnBody(), false)
      assert.equal(harness.keyboardInView(), scenario.choosesView)
      assert.equal(canonicalDocument.getText(), 'const nextTheme = "dark";\n')

      // Repeated backward/forward traversal restores exact captured source and clears it again in the gap.
      for (const positionMs of [100, 20, 100]) {
        harness.controller.command({
          action: 'seek',
          studyId: harness.studyId,
          expectedRevision: harness.controller.state().revision,
          positionMs,
        })
        await harness.controller.settle()
        assert.equal(harness.controller.state().presentedMs, positionMs)
        assert.equal(harness.reader.inspect().sourceUri, selectedSourceUri)
        assert.equal(
          gapEditor?.document.getText(),
          positionMs === 100
            ? 'const nextTheme = "dark";\n'
            : '// Not recorded at this moment.\n',
        )
        assert.equal(harness.keyboardInView(), scenario.choosesView)
        assert.equal(canonicalDocument.getText(), 'const nextTheme = "dark";\n')
      }
      assert.deepEqual(harness.textDocumentShows().slice(shownBefore), [])
    } finally {
      await harness.close()
    }
  })
}

for (const pinDuringOpen of [false, true]) {
  test(`a historical seek preserves pinned captured bytes ${pinDuringOpen ? 'when pinned during native document I/O' : 'when pinned before the seek'} and Unpin with Retry recovers the requested moment`, async () => {
    // Arrange: a selected historical source is visible before the learner protects its native input.
    const harness = await recordedReaderHarness(true, true)
    let releaseSource = (): void => {}
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 100,
      })
      await harness.controller.settle()
      await harness.reader.action('source')
      const sourceUri = harness.reader.inspect().sourceUri
      assert.ok(sourceUri)
      const sourceEditor = harness.editor.window.visibleTextEditors.find(
        (editor) => editor.document.uri.toString() === sourceUri,
      )
      const sourceTab = harness.groups
        .flatMap((group) => group.tabs)
        .find(
          (tab) => 'uri' in tab.input && tab.input.uri.toString() === sourceUri,
        )
      assert.ok(sourceEditor)
      assert.ok(sourceTab)
      const showsBefore = harness.textDocumentShows().length
      const identitiesBefore = harness.sourceIdentityDecorations().length
      const savedContext = await harness.store.readContext(harness.studyId)
      const held = pinDuringOpen
        ? harness.holdNextSource({ uri: sourceUri })
        : undefined
      if (held) releaseSource = held.release
      else sourceTab.isPinned = true

      // Act: a gap cannot mutate any protected copy or replace the learner's input quietly.
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 20,
      })
      if (held) {
        await held.started
        sourceTab.isPinned = true
        held.release()
      }
      await harness.controller.settle()

      // Assert: the previous labelled capture stays immutable and saved context stays canonical.
      assert.equal(harness.controller.state().readiness, 'failed')
      assert.equal(harness.controller.state().presentedMs, 100)
      assert.equal(
        sourceEditor.document.getText(),
        'const nextTheme = "dark";\n',
      )
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
      // Changed for F410: the leave now clears the label together with the stopped line, so the only calls allowed are clears; no label is drawn over the protected bytes.
      assert.deepEqual(
        harness
          .sourceIdentityDecorations()
          .slice(identitiesBefore)
          .filter((call) => call.ranges.length > 0),
        [],
      )
      assert.match(harness.reader.inspect().view!.errors.join('\n'), /pinned/)
      assert.deepEqual(
        await harness.store.readContext(harness.studyId),
        savedContext,
      )

      // The ordinary Retry must recover the requested gap after the learner unpins the capture.
      sourceTab.isPinned = false
      await harness.reader.action('retry')
      await harness.controller.settle()
      assert.equal(harness.controller.state().readiness, 'ready')
      assert.equal(harness.controller.state().presentedMs, 20)
      assert.equal(
        sourceEditor.document.getText(),
        '// Not recorded at this moment.\n',
      )
      assert.equal(harness.reader.inspect().sourceUri, sourceUri)
    } finally {
      releaseSource()
      await harness.close()
    }
  })
}

for (const closeDuringDelivery of [false, true]) {
  test(`a historical source update ${closeDuringDelivery ? 'cannot publish after Close during delayed native delivery' : 'waits for actual native bytes before committing the shared gap moment'}`, async () => {
    // Arrange: delay the real provider-to-document boundary of an already selected capture.
    const harness = await recordedReaderHarness(true, true)
    let releaseDelivery = (): void => {}
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 100,
      })
      await harness.controller.settle()
      const sourceUri = harness.reader.inspect().sourceUri
      const sourceEditor = harness.editor.window.visibleTextEditors.find(
        (editor) => editor.document.uri.toString() === sourceUri,
      )
      assert.ok(sourceEditor)
      const held = harness.holdNextSourceUpdate()
      releaseDelivery = held.release

      // Act: the requested gap cannot commit while the native input still contains the captured stop.
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 20,
      })
      await held.started
      assert.equal(harness.controller.state().presentedMs, 100)
      assert.equal(
        sourceEditor.document.getText(),
        'const nextTheme = "dark";\n',
      )
      assert.equal(readerSeams(harness).isSourceShown(), false)
      if (closeDuringDelivery) {
        // Close cancels ownership without needing the withheld document event to arrive.
        await harness.reader.close()
        held.release()
        await harness.controller.settle()
        assert.equal(harness.reader.inspect().opened, false)
        assert.equal(harness.reader.inspect().sourceUri, undefined)
        // Close retains the last confirmed playhead for normal reopening, without committing the withheld gap.
        assert.equal(harness.controller.state().studyId, harness.studyId)
        assert.equal(harness.controller.state().presentedMs, 100)
        return
      }
      held.release()
      await harness.controller.settle()

      // Assert: admission follows actual native delivery and all affected historical state is cleared.
      assert.equal(harness.controller.state().readiness, 'ready')
      assert.equal(harness.controller.state().presentedMs, 20)
      assert.equal(
        sourceEditor.document.getText(),
        '// Not recorded at this moment.\n',
      )
      assert.equal(
        harness.historicalDebugPresentations.at(-1)?.snapshot,
        undefined,
      )
      assert.equal(harness.reader.inspect().sourceUri, sourceUri)
    } finally {
      releaseDelivery()
      await harness.close()
    }
  })
}

test('a newer historical seek supersedes withheld source I/O and keeps its own captured bytes and playhead', async () => {
  // Arrange: the existing source input belongs to a captured stop.
  const harness = await recordedReaderHarness(true, true)
  let releaseSource = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const sourceUri = harness.reader.inspect().sourceUri
    assert.ok(sourceUri)
    const sourceEditor = harness.editor.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === sourceUri,
    )
    const held = harness.holdNextSource({ uri: sourceUri })
    releaseSource = held.release
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 20,
    })
    await held.started

    // Act: a newer captured point takes ownership before the old gap's native acquisition returns.
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 200,
    })
    held.release()
    await harness.controller.settle()

    // Assert: no old gap becomes the final native source or historical debugger context.
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.state().presentedMs, 200)
    assert.equal(
      sourceEditor?.document.getText(),
      'const nextTheme = "dark";\n',
    )
    assert.equal(harness.reader.inspect().sourceUri, sourceUri)
    assert.equal(
      harness.historicalDebugPresentations.at(-1)?.snapshot?.frames[0]?.name,
      'applyTheme',
    )
  } finally {
    releaseSource()
    await harness.close()
  }
})

test('a new historical seek refuses to recreate a learner-closed source until explicit Source restores its native input', async () => {
  // Arrange: the learner closes the actual source tab while retaining the saved recording.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const sourceUri = harness.reader.inspect().sourceUri
    const sourceTab = harness.groups
      .flatMap((group) => group.tabs)
      .find(
        (tab) => 'uri' in tab.input && tab.input.uri.toString() === sourceUri,
      )
    assert.ok(sourceTab)
    harness.closeTabByHand(sourceTab)
    const showsBefore = harness.textDocumentShows().length

    // Act: background time travel cannot reopen the input the learner explicitly removed.
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 20,
    })
    await harness.controller.settle()

    // Assert: the refusal precedes a native reveal and supplies the ordinary Source recovery.
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
    assert.match(
      harness.reader.inspect().view!.errors.join('\n'),
      /no longer visible/,
    )
    await harness.reader.action('source')
    assert.equal(harness.reader.inspect().sourceUri, sourceUri)
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 20,
    })
    await harness.controller.settle()
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.state().presentedMs, 20)
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's way back to a recorded source they closed: the refusal of a background seek names the command that reopens it, under the name the Command Palette and the Study pane give it, and that command does reopen it; fails_when=the refusal names controls that do not exist ("Source", "Restore Study workspace layout"), or a control that does not reopen the source (Restore and Arrange Study Workspace leave the seek refused); why_new=Cycle 0046 second /ship OCR review OCR1-15; seam=recordedReaderHarness, the controller's seeks, closeTabByHand, the view's errors and the reader action the command codebook.study.source runs (extension.ts registers codebook.study.<action> as the reader's action)
test('a seek refused because the learner closed the recorded source names Codebook: Focus Captured Source, and that command reopens the source', async () => {
  // Arrange: the learner closes the actual source tab of the saved recording; a background seek is then refused.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const sourceUri = harness.reader.inspect().sourceUri
    const sourceTab = harness.groups
      .flatMap((group) => group.tabs)
      .find(
        (tab) => 'uri' in tab.input && tab.input.uri.toString() === sourceUri,
      )
    assert.ok(sourceTab)
    harness.closeTabByHand(sourceTab)
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 20,
    })
    await harness.controller.settle()
    const refusal = structuredClone(harness.reader.inspect().view!.errors)

    // Act: the command the refusal names (codebook.study.source).
    await harness.reader.action('source')
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 20,
    })
    await harness.controller.settle()

    // Assert
    assert.deepEqual(
      {
        refusal,
        readiness: harness.controller.state().readiness,
        presentedMs: harness.controller.state().presentedMs,
      },
      {
        refusal: [
          'Error: The recorded source input is no longer visible. Run Codebook: Focus Captured Source (Focus source in the Study pane) to reopen it.',
        ],
        readiness: 'ready',
        presentedMs: 20,
      },
    )
  } finally {
    await harness.close()
  }
})

test('historical source capacity freezes every pinned display and permits explicit recovery after one older view is unpinned', async () => {
  // Arrange: each explicitly opened display is pinned at one captured historical point.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    // Owned App preparation confirms this fixture's measured main layout before pinning.
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.deepEqual([...harness.reader.inspect().view!.errors], [])
    const pinned = []
    // The existing cache bound is 34 documents; a pin freezes each display's provider bytes.
    for (let index = 0; index < 34; index++) {
      await harness.reader.action('source')
      const sourceUri = harness.reader.inspect().sourceUri
      const sourceEditor = harness.editor.window.visibleTextEditors.find(
        (editor) => editor.document.uri.toString() === sourceUri,
      )
      const sourceTab = harness.groups
        .flatMap((group) => group.tabs)
        .find(
          (tab) => 'uri' in tab.input && tab.input.uri.toString() === sourceUri,
        )
      assert.ok(sourceEditor)
      assert.ok(sourceTab)
      sourceTab.isPinned = true
      pinned.push({ tab: sourceTab, document: sourceEditor.document })
    }
    const showsBefore = harness.textDocumentShows().length

    // Act: another explicit Source entry cannot obtain room by evicting an immutable pinned view.
    await harness.reader.action('source')

    // Assert: no replacement occurs, every protected capture survives, and ordinary unpinning makes recovery possible.
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
    assert.match(
      harness.reader.inspect().view!.errors.join('\n'),
      /capacity is full/,
    )
    assert.equal(pinned.length, 34)
    for (const capture of pinned) {
      assert.equal(
        harness.groups.flatMap((group) => group.tabs).includes(capture.tab),
        true,
      )
      assert.equal(capture.document.getText(), 'const nextTheme = "dark";\n')
    }
    pinned[0]!.tab.isPinned = false
    await harness.reader.action('source')
    assert.equal(readerSeams(harness).isSourceShown(), true)
    assert.deepEqual([...harness.reader.inspect().view!.errors], [])
  } finally {
    await harness.close()
  }
})

test('a learner draft chosen during historical source I/O stays visible and receives no obsolete quiet source replacement', async () => {
  // Arrange: a recorded source is visible when the seek starts acquiring its native document.
  const harness = await recordedReaderHarness(true, true)
  let releaseSource = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const sourceUri = harness.reader.inspect().sourceUri
    assert.ok(sourceUri)
    const sourceEditor = harness.editor.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === sourceUri,
    )
    assert.ok(sourceEditor)
    const held = harness.holdNextSource({ uri: sourceUri })
    releaseSource = held.release
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 20,
    })
    await held.started
    const draft = harness.focusMutableDraft(
      'history-notes.txt',
      sourceEditor.viewColumn,
    )
    const showsBefore = harness.textDocumentShows().length

    // Act: the native source reply arrives after the learner selected another input in that group.
    held.release()
    await harness.controller.settle()

    // Assert: refuse before revealing or committing the older request, preserving the learner's draft and keyboard.
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
    assert.equal(
      harness.focusedSource()?.document.uri.toString(),
      draft.document.uri.toString(),
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.keyboardOnBody(), false)
  } finally {
    releaseSource()
    await harness.close()
  }
})

test('re-presenting a committed recording refuses to reopen a source the learner closed', async () => {
  // Arrange: the saved point remains selected after the learner closes its source input.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const sourceUri = harness.reader.inspect().sourceUri
    const sourceTab = harness.groups
      .flatMap((group) => group.tabs)
      .find(
        (tab) => 'uri' in tab.input && tab.input.uri.toString() === sourceUri,
      )
    assert.ok(sourceTab)
    harness.closeTabByHand(sourceTab)
    const showsBefore = harness.textDocumentShows().length

    // Act: an ordinary surface re-presentation is not an explicit Source or Restore request.
    harness.controller.hide()
    harness.controller.reveal()
    await harness.controller.settle()

    // Assert: preserve the last confirmed point without silently creating the removed native input.
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
    assert.match(
      harness.reader.inspect().view!.errors.join('\n'),
      /no longer visible/,
    )
  } finally {
    await harness.close()
  }
})

// Regression: 561 — an abandoned seek cannot become the provider rollback for a later pinned capture.
test('pinning the displayed capture during a newer seek preserves provider bytes after an earlier source acquisition was cancelled', async () => {
  // Arrange: capture A is displayed while seek B waits for the same native document.
  const harness = await recordedReaderHarness(true, true)
  let releaseEarlier = (): void => {},
    releaseLater = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const sourceUri = harness.reader.inspect().sourceUri
    assert.ok(sourceUri)
    const sourceEditor = harness.editor.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === sourceUri,
    )
    const sourceTab = harness.groups
      .flatMap((group) => group.tabs)
      .find(
        (tab) => 'uri' in tab.input && tab.input.uri.toString() === sourceUri,
      )
    assert.ok(sourceEditor)
    assert.ok(sourceTab)
    const earlier = harness.holdNextSource({ uri: sourceUri })
    releaseEarlier = earlier.release
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 20,
    })
    await earlier.started
    const later = harness.holdNextSource({ uri: sourceUri })
    releaseLater = later.release

    // Act: seek C cancels B; the learner pins the still-displayed A while C waits for its own native reply.
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 200,
    })
    earlier.release()
    await later.started
    sourceTab.isPinned = true
    later.release()
    await harness.controller.settle()

    // Assert: both the displayed document and the actual registered provider retain A, never the cancelled gap B.
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(sourceEditor.document.getText(), 'const nextTheme = "dark";\n')
    assert.equal(
      await harness.providedSource(sourceEditor.document.uri),
      'const nextTheme = "dark";\n',
    )
  } finally {
    releaseEarlier()
    releaseLater()
    await harness.close()
  }
})

// Regression: 559 — source annotation calls remain observable independently of execution-line highlights.
test('historical source annotations identify the recorded file, time, hash and selected line and replace that identity inside a gap', async () => {
  // Arrange: read a saved point through its actual historical native display.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Act and Assert: each selected moment replaces the native annotation without changing source bytes.
    for (const positionMs of [100, 20, 100]) {
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs,
      })
      await harness.controller.settle()
      const annotation = harness.sourceIdentityDecorations().at(-1)
      assert.ok(
        annotation,
        'The native source identity must be applied, not omitted from the observation channel.',
      )
      assert.equal(annotation.uri, harness.reader.inspect().sourceUri)
      assert.deepEqual(
        JSON.parse(JSON.stringify(annotation.ranges)),
        positionMs === 100
          ? [
              {
                range: {
                  start: { line: 0, character: 25 },
                  end: { line: 0, character: 25 },
                },
                hoverMessage: {
                  value:
                    'Recorded:&nbsp;src/theme.ts:1&nbsp;·&nbsp;0.10&nbsp;s&nbsp;·&nbsp;declared&nbsp;1&nbsp;·&nbsp;captured&nbsp;SHA\\-256&nbsp;f117f21caab18af046f2e57a64ff045dd846130ab2e86fbe6c9360cfcc275771',
                },
                renderOptions: {
                  after: {
                    contentText:
                      '  Recorded: src/theme.ts:1 · 0.10 s · declared 1',
                  },
                },
              },
            ]
          : [
              {
                range: {
                  start: { line: 0, character: 31 },
                  end: { line: 0, character: 31 },
                },
                hoverMessage: {
                  value:
                    'Recorded&nbsp;source&nbsp;·&nbsp;Not&nbsp;recorded&nbsp;at&nbsp;this&nbsp;moment&nbsp;·&nbsp;captured&nbsp;SHA\\-256&nbsp;17ded4ea5073e886425bd977a54edd857924d864f44b3c1b83d9e8aec53893e1',
                },
                renderOptions: {
                  after: {
                    contentText:
                      '  Recorded source · Not recorded at this moment',
                  },
                },
              },
            ],
      )
    }
  } finally {
    await harness.close()
  }
})

// Value: protects=the browser replay's recorded-source label leaves with the stopped line at the leave of a stop move (D29, F410): while the next stop's source read is held, the pane shows no end-of-line label; the commit then draws the new stop's label; fails_when=the leave clears the stopped line but keeps `Recorded: src/theme.ts:1 · 0.10 s · declared 1` beside the Application header of the requested moment (N50's 0.6 s of mixed moments); why_new=no test read the browser replay's source label between the leave and the commit; seam=the workspace harness's held native source read and its source-identity decoration calls; no_claim=the native frames of the transition, which the driving agent's N50 recheck reads
test('a browser replay stop move removes the recorded-source label with the stopped line before the next stop is shown', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  let releaseSource = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const sourceUri = harness.reader.inspect().sourceUri
    assert.ok(sourceUri)
    assert.equal(
      harness.sourceIdentityDecorations().at(-1)?.ranges.length,
      1,
      'The stop at 0.10 s shows its label before the move.',
    )
    const held = harness.holdNextSource({ uri: sourceUri })
    releaseSource = held.release

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 20,
    })
    await held.started

    // Assert
    assert.deepEqual(
      harness.sourceIdentityDecorations().at(-1)?.ranges,
      [],
      'The label must leave with the stopped line while the next source is still being read.',
    )
    held.release()
    await harness.controller.settle()
    assert.equal(
      harness.sourceIdentityDecorations().at(-1)?.ranges.length,
      1,
      'The commit draws the gap label for the requested moment.',
    )
  } finally {
    releaseSource()
    await harness.close()
  }
})

// Regression: 466 — failed Reload must retain its initiating Summary and recovery controls.
// Found by /qa on 2026-10-11.
// Report: https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/cycles/0046-carried-defects-of-cycle-0045.md
// Value: protects=the current Summary document through failed Reload and retry; fails_when=reload withdraws its HTML before reading the archive; why_new=existing failed-reload coverage checks Wiki Return only; seam=none
test('Reload in Learning summary keeps its recovery controls after a read failure and retries without reopening the summary', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true),
    headerPath = join(harness.store.path(harness.studyId), 'header.json'),
    header = await readFile(headerPath)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    assert.equal(harness.summary.visible, true)
    await writeFile(headerPath, '{broken')

    // Act
    harness.receive({
      type: 'action',
      revision: harness.reader.inspect().view!.revision,
      action: 'reload-recording',
    })
    await waitUntil(
      () => harness.controller.state().readiness === 'failed',
      'the Summary reload reaches its recording-read failure',
      2_000,
    )
    await harness.controller.settle()

    // Assert
    assert.equal(
      harness.summary.webview.html.includes('id="recording-transport"'),
      true,
    )
    assert.equal(
      harness.summary.webview.html.includes(
        'Open saved learning from Codebook to view its summary.',
      ),
      false,
    )
    assert.equal(harness.summary.visible, true)
    assert.equal(harness.reader.inspect().view!.recording!.readiness, 'failed')
    const failedRevision = harness.controller.state().revision

    // Retry through the same Summary after its archive is repaired.
    await writeFile(headerPath, header)
    harness.receive({
      type: 'action',
      revision: harness.reader.inspect().view!.revision,
      action: 'reload-recording',
    })
    await waitUntil(
      () =>
        harness.controller.state().revision > failedRevision &&
        harness.controller.state().readiness === 'ready',
      'the same Summary retry presents its repaired recording',
      2_000,
    )
    await harness.controller.settle()
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(
      harness.summary.webview.html.includes('id="recording-transport"'),
      true,
    )
    assert.equal(harness.reader.inspect().view!.recording!.readiness, 'ready')

    // Explicit Close still withdraws the recording controls.
    await harness.reader.close()
    assert.equal(
      harness.summary.webview.html.includes(
        'Open saved learning from Codebook to view its summary.',
      ),
      true,
    )
  } finally {
    await writeFile(headerPath, header)
    await harness.close()
  }
})

// Value: protects=a moment committed without native values names where to load them, and the hint leaves once they load; fails_when=the Study message never flags the moment, or keeps the hint after Run and Debug loads values until another seek; why_new=the soft inspection gate commits such moments; seam=TestReplayDebugger models the native load notification
test('a replay moment whose recorded values Run and Debug has not loaded tells the learner where to load them until they load', async () => {
  // Arrange: Variables stays hidden, so native Run and Debug does not load the recorded values within the grace.
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.setHistoricalDebugInspection('uninspected')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const withoutValues = harness.postedMessages().slice(-1)[0]!,
      presentationsWithoutValues = harness.historicalDebugPresentations.length

    // Act: the learner expands Variables, and the native session reports loaded values without another seek.
    harness.loadHistoricalDebugValues()
    const withValues = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.equal(
      harness.historicalDebugPresentations.at(-1)?.snapshot?.variables[0]?.name,
      'nextTheme',
    )
    assert.equal(withoutValues.recording?.presentedMs, 100)
    assert.equal(withoutValues.recording?.nativeValuesUninspected, true)
    assert.equal(withValues.recording?.presentedMs, 100)
    assert.equal(withValues.recording?.nativeValuesUninspected, false)
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsWithoutValues,
      'loading values needs no new presentation',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Run and Debug hint staying visible while Play advances within one recorded stop; fails_when=the hint disappears on the first Play tick although values are still unloaded; why_new=Play ticks replace the committed bundle without presenting the same stop again; seam=none
test('the Run and Debug hint stays while Play advances through the same recorded stop', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.setHistoricalDebugInspection('uninspected')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const presentationsAtStop = harness.historicalDebugPresentations.length

    // Act
    harness.controller.command({
      action: 'play',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
    })
    await waitUntil(
      () =>
        (harness.postedMessages().slice(-1)[0]?.recording?.presentedMs ?? 0) >
        100,
      'Play advances past the recorded stop time',
      2_000,
    )
    const advanced = harness.postedMessages().slice(-1)[0]!,
      presentationsWhilePlaying = harness.historicalDebugPresentations.length
    harness.controller.command({
      action: 'pause',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert
    assert.ok((advanced.recording?.presentedMs ?? 0) > 100)
    assert.equal(advanced.recording?.nativeValuesUninspected, true)
    assert.equal(
      presentationsWhilePlaying,
      presentationsAtStop,
      'Play ticks within one stop keep its native presentation',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the fidelity of the workspace harness's historical debugger to the real owner's model selection (F6): the fake is driven through the scenario table the real owner is held to in replayDebugger.test (REPLAY_MODEL_SELECTION_SCENARIO: the same selection again, another label, another snapshot, an invalidation), so the workspace tests that rest on focusProcess's reveal of the captured source (row 721) see what the real owner does; fails_when=the fake runs focusProcess at every presentation with values, asks the host again while a selection is in flight, settles a selection no longer shown, or departs from the table in another step; why_new=N8, Cycle 0046 (the harness kept the rule from before F6); TR8 (the expectations are one table for the fake and the real owner); Q10 (round 3, OCR: the fake had neither the real owner's answer in flight nor its check that the selection is still shown); seam=recordedReaderHarness, the reader's openRecording and a seek to the recorded stop, the fake owner's present and invalidate, the fake editor's command log, and its holds of a command, each with a promise that resolves once the command is held
test('the workspace harness’s historical debugger follows the model-selection scenario the real owner is held to', async () => {
  // Arrange: the learner opened a saved recording and sought its stop, which has recorded values; that stop is the first of the scenario's two, and a copy of it the second.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const debuggerView = harness.historicalDebuggers.at(-1)!
    const shown = harness.historicalDebugPresentations.findLast(
      (presentation) => presentation.snapshot,
    )!
    const snapshots = {
      first: shown.snapshot,
      second: structuredClone(shown.snapshot),
    }
    /** Counts the model selections the fake editor ran so far. */
    const modelSelections = (): number =>
      harness.commands.filter(
        (command) => command === 'workbench.action.debug.focusProcess',
      ).length
    const selectionsBefore = modelSelections()
    /** Presents a frame of the scenario's stops; a presentation the test abandoned ends too. */
    const presentFrame = (
      frame: ReplayModelSelectionFrame,
      signal = new AbortController().signal,
    ): Promise<unknown> =>
      debuggerView
        .present(
          snapshots[frame.stop],
          frame.label,
          signal,
          shown.sourceDocument,
        )
        .catch(() => undefined)
    const driver: ReplayModelSelectionDriver = {
      present: async (stop, label, circumstance) => {
        if (circumstance === 'host refuses')
          harness.failNextCommand('workbench.action.debug.focusProcess')
        const held =
          circumstance === 'abandoned while the host answers'
            ? harness.holdNextCommand('workbench.action.debug.focusProcess')
            : undefined
        // A live debug session of the learner's own owns the view: its stop is the frame Run and Debug shows.
        if (circumstance === 'live session owns the view') {
          harness.pauseDebugger({
            session: 'learner-node',
            staysInBackground: true,
          })
          harness.reportStopFrame('learner-node')
        }
        const abandon = new AbortController()
        const presenting = presentFrame({ stop, label }, abandon.signal)
        // The presentation is abandoned while the host still answers its selection, which it answers afterwards.
        if (held) {
          await held.started
          abandon.abort(new Error('New playback frame'))
          held.release()
        }
        await presenting
        if (circumstance === 'live session owns the view')
          harness.endDebugSession('learner-node')
      },
      presentWhileHostAnswers: async (first, next, nextIsAnotherSelection) => {
        const firstHold = harness.holdNextCommand(
          'workbench.action.debug.focusProcess',
        )
        const firstPresenting = presentFrame(first)
        await firstHold.started
        // A frame of another stop runs its own selection, which the host answers first; a frame of the same stop waits for the answer in flight from its presentation on.
        const nextHold = nextIsAnotherSelection
          ? harness.holdNextCommand('workbench.action.debug.focusProcess')
          : undefined
        const nextPresenting = presentFrame(next)
        if (nextHold) {
          await nextHold.started
          nextHold.release()
          await nextPresenting
        }
        firstHold.release()
        await Promise.all([firstPresenting, nextPresenting])
      },
      presentAgainWhileNewerAnswerHeld: async (older, newer) => {
        const olderHold = harness.holdNextCommand(
          'workbench.action.debug.focusProcess',
        )
        const olderPresenting = presentFrame(older)
        await olderHold.started
        const newerHold = harness.holdNextCommand(
          'workbench.action.debug.focusProcess',
        )
        const newerPresenting = presentFrame(newer)
        await newerHold.started
        // The older answer comes for a stop no longer shown; the fake's presentation of it ends with it.
        olderHold.release()
        await olderPresenting
        // The fake's next frame takes the answer in flight from its presentation on.
        const againPresenting = presentFrame(newer)
        newerHold.release()
        await Promise.all([newerPresenting, againPresenting])
      },
      invalidate: () => debuggerView.invalidate(),
      selections: () => modelSelections() - selectionsBefore,
    }

    // Act
    const counted = await selectionsThroughScenario(driver)

    // Assert
    assert.deepEqual(
      counted,
      REPLAY_MODEL_SELECTION_SCENARIO.map((row) => row.selectionsAfter),
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a recorded gap never tells the learner to load values it does not have; fails_when=the hint from a preceding stop stays at an interval without recorded debugger state; why_new=the hint follows the committed stop snapshot; seam=none
test('seeking from a stop without loaded values into missing history drops the Run and Debug hint', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.setHistoricalDebugInspection('uninspected')
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const atStop = harness.postedMessages().slice(-1)[0]!

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 0,
    })
    await harness.controller.settle()
    const atGap = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.equal(atStop.recording?.nativeValuesUninspected, true)
    assert.equal(atGap.recording?.presentedMs, 0)
    assert.equal(atGap.recording?.nativeValuesUninspected, false)
  } finally {
    await harness.close()
  }
})

test('replay reads app, source and sidebar summary then restores their shared layout without changing history', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.hideGridWhileMaximized()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const selection = harness.reader.inspect().view!.model.selection,
      source = harness.reader.inspect().sourceUri
    const bundle = harness.controller.bundle(),
      panels = harness.nativePanels()
    const progress = await (
      await harness.reader.learningStorage()
    ).readProgress()

    // Act
    await harness.reader.action('read-app')
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(harness.maximizedEditorGroup(), true)
    await harness.reader.action('read-source')
    assert.equal(harness.sourceColumn(), 2)
    assert.equal(harness.maximizedEditorGroup(), true)
    await harness.reader.action('read-context')
    assert.equal(harness.summary.visible, true)
    assert.equal(harness.maximizedEditorGroup(), true)
    await harness.reader.action('arrange')

    // Assert
    assert.equal(harness.summary.visible, true)
    assert.equal(harness.maximizedEditorGroup(), false)
    assert.equal(harness.reader.presentationState().state, 'open')
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.reader.presentationState().reason, undefined)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 1,
      groups: [{ size: 0.5 }, { size: 0.5 }],
    })
    assert.deepEqual(harness.nativePanels(), panels)
    assert.equal(panels.length, 1)
    assert.deepEqual(harness.reader.inspect().view!.model.selection, selection)
    assert.equal(harness.reader.inspect().sourceUri, source)
    assert.equal(harness.controller.bundle(), bundle)
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.deepEqual(
      await (await harness.reader.learningStorage()).readProgress(),
      progress,
    )
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await harness.close()
  }
})

// Regression: 492 — Restore must recover the recorded moment retired by an Application-covering tab.
test('Restore uncovers the recorded application and recovers its source without changing history or running the target again', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )
    assert.ok(viewport)
    const application = viewport.panel
    const applicationGroup = harness.groups.find(
      (group) => group.activeTab === application.nativeTab,
    )
    assert.ok(applicationGroup)
    const selection = harness.reader.inspect().view!.model.selection
    const source = harness.reader.inspect().sourceUri
    const bundle = harness.controller.bundle()
    const progress = await (
      await harness.reader.learningStorage()
    ).readProgress()
    harness.focusMutableDraft('restore-cover.ts', applicationGroup.viewColumn)
    application.notifyViewState()
    assert.equal(harness.controller.state().cleared, true)
    assert.equal(application.visible, false)
    const reveal = application.reveal.bind(application)
    const visibility = Object.getOwnPropertyDescriptor(application, 'visible')
    assert.ok(visibility?.get)
    const readVisibility = visibility.get.bind(application)
    let visibilityPending = false
    // The public panel receipt arrives after native tab notifications in the real host.
    Object.defineProperty(application, 'visible', {
      get: () => !visibilityPending && readVisibility(),
    })
    application.reveal = (column, preserveFocus): void => {
      visibilityPending = true
      reveal(column, preserveFocus)
      harness.announceTabChange()
      visibilityPending = false
      application.notifyViewState()
    }
    // Native historical debugging fronts its restored captured source after the owned App reveal.
    harness.changeAfterNextSourceDisplay((editor) => {
      harness.focusExistingSource(editor)
    })

    // Act
    await harness.reader.action('arrange')
    await harness.controller.settle()

    // Assert
    assert.equal(application.visible, true)
    assert.equal(applicationGroup.activeTab, application.nativeTab)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.reader.presentationState().reason, undefined)
    assert.equal(harness.controller.state().cleared, false)
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(harness.reader.inspect().sourceUri, source)
    assert.deepEqual(harness.reader.inspect().view!.model.selection, selection)
    assert.equal(harness.controller.bundle(), bundle)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
    assert.deepEqual(
      await (await harness.reader.learningStorage()).readProgress(),
      progress,
    )
  } finally {
    await harness.close()
  }
})

test('Restore preserves a newer source choice made while it reveals the covered recording', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )
    assert.ok(viewport)
    const application = viewport.panel
    harness.focusMutableDraft('restore-cover.ts', 1)
    application.notifyViewState()
    const reveal = application.reveal.bind(application)
    application.reveal = (column, preserveFocus): void => {
      reveal(column, preserveFocus)
      harness.announceTabChange()
      // The exact owned switch settles before the learner selects a different file.
      harness.focusMutableDraft('newer-source-choice.ts', 1)
      application.notifyViewState()
    }

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    const chosenGroup = harness.groups.find((group) => group.viewColumn === 1)
    assert.ok(chosenGroup)
    const chosenInput = chosenGroup.activeTab!.input
    assert.ok('uri' in chosenInput)
    assert.equal(
      chosenInput.uri.path.split('/').at(-1),
      'newer-source-choice.ts',
    )
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await harness.close()
  }
})

test('Restore after focused reading recovers the confirmed Study layout when native space is available', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('read-app')
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.maximizedEditorGroup(), false)
    assert.equal(harness.reader.presentationState().reason, undefined)
  } finally {
    await harness.close()
  }
})

test('Restore beside a separate editor part keeps the selected explanation after borrowing primary focus', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const chat = harness.addSeparateEditorPart()
  harness.constrainStudyGrid()
  harness.hideGridWhileMaximized()
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(harness.reader.presentationState().state, 'open')
    assert.doesNotMatch(
      harness.reader.presentationState().reason ?? '',
      /learner changed native tab focus/i,
    )
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    await harness.close()
  }
})

test('Restore beside a separate editor part preserves a learner tab chosen during its focus borrow', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const chat = harness.addSeparateEditorPart()
  harness.constrainStudyGrid()
  harness.hideGridWhileMaximized()
  let release = (): void => {}
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    const held = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    release = held.release

    // Act
    const restoring = harness.reader.action('arrange')
    await held.started
    const draft = harness.focusMutableDraft('newer-scope-notes.txt', 3)
    release()
    await restoring

    // Assert
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 3)?.activeTab,
      draft.tab,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /learner changed native tab focus/i,
    )
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    release()
    await harness.close()
  }
})

test('Restore stops after the learner leaves the work window during its primary focus borrow', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const chat = harness.addSeparateEditorPart()
  harness.constrainStudyGrid()
  harness.hideGridWhileMaximized()
  let release = (): void => {}
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    const held = harness.holdNextPrimaryFocusResponse()
    release = held.release
    const restoring = harness.reader.action('arrange')
    await held.started
    const layoutChanges = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length

    // Act
    harness.changeWindowFocus(false)
    harness.changeWindowFocus(true)
    release()
    await restoring

    // Assert
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      layoutChanges,
    )
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /learner changed native tab focus/i,
    )
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] })
  } finally {
    release()
    await harness.close()
  }
})

test('successful Study reading clears an earlier background-window reading error', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    harness.changeWindowFocus(false)
    harness.receive({
      type: 'action',
      revision: harness.reader.inspect().view!.revision,
      action: 'read-app',
    })
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.errors.some((error) =>
            error.includes('Focus the Codebook work window'),
          ),
      'background reading error',
      1_000,
    )

    // Act
    harness.changeWindowFocus(true)
    await harness.reader.action('read-app')

    // Assert
    assert.equal(
      harness.reader
        .inspect()
        .view!.errors.some((error) =>
          error.includes('Focus the Codebook work window'),
        ),
      false,
    )
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /Focused application/,
    )
  } finally {
    await harness.close()
  }
})

test('reading a Study pane does not claim focus after the learner selects a draft during native maximization', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await harness.reader.open()
    const held = harness.holdNextCommand(
      'workbench.action.maximizeEditorHideSidebar',
    )
    release = held.release

    // Act
    const reading = harness.reader.action('read-app')
    await held.started
    const draft = harness.focusMutableDraft('later-learner-notes.txt', 1)
    release()

    // Assert
    await assert.rejects(reading, /focus changed|learner.*focus/i)
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 1)?.activeTab,
      draft.tab,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.doesNotMatch(
      harness.reader.presentationState().reason ?? '',
      /Focused application/,
    )
  } finally {
    release()
    await harness.close()
  }
})

test('Read captured source keeps the learner cursor when the selected source is already displayed', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('source')
    harness.changeFocusedSourceSelection(46)
    harness.retainReadingRange(40, 50)
    await harness.reader.action('read-app')

    // Act
    await harness.reader.action('read-source')

    // Assert
    assert.equal(harness.focusedSource()?.selections[0]?.active.line, 46)
    assert.equal(harness.isReadingLineVisible(46), true)
  } finally {
    await harness.close()
  }
})

// Task399: Cursor can report the focused captured editor while its named tab group still belongs to chat.
test('Read Source enlarges the focused captured editor when Cursor still names its chat tab group', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  try {
    await harness.reader.open()
    await harness.reader.action('source')
    harness.leavePaneFocusUnreportedBesideChat()
    chat.focusTab()
    await harness.reader.action('source')
    assert.equal(
      harness.editor.window.tabGroups.activeTabGroup.activeTab?.label,
      'New Agent',
    )
    assert.equal(harness.editor.window.activeTextEditor?.viewColumn, 2)

    // Act
    await harness.reader.action('read-source')

    // Assert
    assert.equal(chat.focused(), false)
    assert.equal(
      harness.focusedSource()?.document.uri.scheme,
      'codebook-source',
    )
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(
      harness.reader.presentationState().reason,
      'Focused source. The three-pane Study split is not confirmed. Use the pane controls or Restore layout.',
    )
  } finally {
    await harness.close()
  }
})

test('Read Source accepts an unchanged chat tab model refreshed while its captured editor is still reported', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let release = (): void => {}
  let originalDescriptor: PropertyDescriptor | undefined
  try {
    await harness.reader.open()
    await harness.reader.action('source')
    const retainedSource = harness.editor.window.activeTextEditor
    originalDescriptor = Object.getOwnPropertyDescriptor(
      harness.editor.window,
      'activeTextEditor',
    )
    chat.focusTab()
    Object.defineProperty(harness.editor.window, 'activeTextEditor', {
      configurable: true,
      get: () => retainedSource,
    })
    const held = harness.holdNextSource()
    release = held.release
    const reading = harness.reader.action('read-source')
    const observed = reading.then(
      () => 'read completed',
      (error: unknown) => String(error),
    )
    await held.started

    // Act: every wrapper changes, while the tab order, labels and focused editor stay.
    harness.resyncEditorGroups(undefined, false, true)
    held.release()

    // Assert
    assert.equal(await observed, 'read completed')
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
  } finally {
    release()
    if (originalDescriptor)
      Object.defineProperty(
        harness.editor.window,
        'activeTextEditor',
        originalDescriptor,
      )
    await harness.close()
  }
})

test('Read Source preserves a newer chat choice while its focused captured editor has a stale named group', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let release = (): void => {}
  try {
    await harness.reader.open()
    await harness.reader.action('source')
    harness.leavePaneFocusUnreportedBesideChat()
    chat.focusTab()
    await harness.reader.action('source')
    const held = harness.holdNextSource()
    release = held.release
    const reading = harness.reader.action('read-source')
    const rejected = assert.rejects(reading, /learner changed native tab focus/)
    await held.started

    // Act
    chat.focusTab()
    held.release()
    await rejected

    // Assert
    assert.equal(chat.focused(), true)
    assert.equal(harness.editor.window.activeTextEditor, undefined)
  } finally {
    release()
    await harness.close()
  }
})

for (const change of ['move', 'replace'] as const)
  test(`Read Source rejects a native group ${change} instead of preserving its old chat fallback`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.useHostAppName('Cursor')
    const chat = harness.addSeparateEditorPart()
    let release = (): void => {}
    let originalDescriptor: PropertyDescriptor | undefined
    try {
      await harness.reader.open()
      await harness.reader.action('source')
      const retainedSource = harness.editor.window.activeTextEditor
      originalDescriptor = Object.getOwnPropertyDescriptor(
        harness.editor.window,
        'activeTextEditor',
      )
      chat.focusTab()
      Object.defineProperty(harness.editor.window, 'activeTextEditor', {
        configurable: true,
        get: () => retainedSource,
      })
      const held = harness.holdNextSource()
      release = held.release
      const reading = harness.reader.action('read-source')
      const rejected = assert.rejects(
        reading,
        /learner changed native tab focus|Native pane, group or focus changed while presentation waited/,
      )
      await held.started

      // Act
      harness.resyncEditorGroups(change, false, true)
      held.release()
      await rejected

      // Assert
      assert.equal(chat.focused(), true)
    } finally {
      release()
      if (originalDescriptor)
        Object.defineProperty(
          harness.editor.window,
          'activeTextEditor',
          originalDescriptor,
        )
      await harness.close()
    }
  })

test('Read captured source accepts an unchanged settings tab before focusing its owned source', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('focus-context')
    const settings = harness.addOpaqueTab('Settings', 3)
    const explanationGroup = harness.groups.find(
      (group) => group.viewColumn === 3,
    )!
    explanationGroup.activeTab = settings

    // Act
    await harness.reader.action('read-source')

    // Assert
    assert.equal(harness.sourceColumn(), 2)
    assert.equal(
      harness.focusedSource()?.document.uri.toString(),
      harness.reader.inspect().sourceUri,
    )
    assert.equal(explanationGroup.tabs.includes(settings), true)
  } finally {
    await harness.close()
  }
})

test('Read App preserves a newer tab choice when the previous source editor is still reported', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  let originalDescriptor: PropertyDescriptor | undefined
  try {
    await harness.reader.open()
    await harness.reader.action('source')
    const retainedSource = harness.editor.window.activeTextEditor
    originalDescriptor = Object.getOwnPropertyDescriptor(
      harness.editor.window,
      'activeTextEditor',
    )
    Object.defineProperty(harness.editor.window, 'activeTextEditor', {
      configurable: true,
      get: () => retainedSource,
    })
    const held = harness.holdNextCommand(
      'workbench.action.maximizeEditorHideSidebar',
    )
    release = held.release
    const reading = harness.reader.action('read-app')
    const rejected = assert.rejects(reading, /learner changed native tab focus/)
    await held.started

    // Act
    const draft = harness.focusMutableDraft('later-reader-choice.txt', 1)
    held.release()
    await rejected

    // Assert
    assert.equal(harness.groups[0]?.activeTab, draft.tab)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.editor.window.activeTextEditor, retainedSource)
  } finally {
    release()
    if (originalDescriptor)
      Object.defineProperty(
        harness.editor.window,
        'activeTextEditor',
        originalDescriptor,
      )
    await harness.close()
  }
})

test('Read captured source preserves a newer draft choice while its existing document opens', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await harness.reader.open()
    await harness.reader.action('read-app')
    const held = harness.holdNextSource()
    release = held.release

    // Act
    const reading = harness.reader.action('read-source')
    await held.started
    const draft = harness.focusMutableDraft('newer-source-notes.txt', 1)
    release()

    // Assert
    await assert.rejects(reading, /focus changed|learner.*focus/i)
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 1)?.activeTab,
      draft.tab,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.doesNotMatch(
      harness.reader.presentationState().reason ?? '',
      /Focused source/,
    )
  } finally {
    release()
    await harness.close()
  }
})

test('Read Source preserves a newer opaque tab when the old source editor is still reported', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  let originalDescriptor: PropertyDescriptor | undefined
  try {
    await harness.reader.open()
    await harness.reader.action('source')
    const retainedSource = harness.editor.window.activeTextEditor
    originalDescriptor = Object.getOwnPropertyDescriptor(
      harness.editor.window,
      'activeTextEditor',
    )
    Object.defineProperty(harness.editor.window, 'activeTextEditor', {
      configurable: true,
      get: () => retainedSource,
    })
    const otherTab = harness.addOpaqueTab('Other editor', 1)
    const held = harness.holdNextCommand(
      'workbench.action.maximizeEditorHideSidebar',
    )
    release = held.release
    const reading = harness.reader.action('read-source')
    const rejected = assert.rejects(reading, /learner changed native tab focus/)
    await held.started

    // Act
    harness.focusOpaqueTab(otherTab)
    held.release()
    await rejected

    // Assert
    assert.equal(harness.groups[0]?.activeTab, otherTab)
    assert.equal(harness.editor.window.activeTextEditor, retainedSource)
  } finally {
    release()
    if (originalDescriptor)
      Object.defineProperty(
        harness.editor.window,
        'activeTextEditor',
        originalDescriptor,
      )
    await harness.close()
  }
})

test('Read Source preserves a newer opaque choice during its own source focus handoff', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let originalDescriptor: PropertyDescriptor | undefined
  try {
    await harness.reader.open()
    await harness.reader.action('source')
    const retainedSource = harness.editor.window.activeTextEditor
    originalDescriptor = Object.getOwnPropertyDescriptor(
      harness.editor.window,
      'activeTextEditor',
    )
    Object.defineProperty(harness.editor.window, 'activeTextEditor', {
      configurable: true,
      get: () => retainedSource,
    })
    const otherTab = harness.addOpaqueTab('Later handoff choice', 1)
    harness.changeAfterNextSourceDisplay(() => harness.focusOpaqueTab(otherTab))

    // Act
    await assert.rejects(
      harness.reader.action('read-source'),
      /Focus an owned Study pane|learner changed native tab focus/,
    )

    // Assert
    assert.equal(harness.groups[0]?.activeTab, otherTab)
    assert.equal(harness.editor.window.activeTextEditor, retainedSource)
  } finally {
    if (originalDescriptor)
      Object.defineProperty(
        harness.editor.window,
        'activeTextEditor',
        originalDescriptor,
      )
    await harness.close()
  }
})

test('Restore does not rearrange Study after the learner selects a draft during native unmaximize', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await harness.reader.open()
    await harness.reader.action('read-app')
    const previousArrangements = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length
    const held = harness.holdNextCommand(
      'workbench.action.minimizeOtherEditors',
    )
    release = held.release

    // Act
    const restoring = harness.reader.action('arrange')
    await held.started
    const draft = harness.focusMutableDraft('later-restore-notes.txt', 3)
    release()
    await restoring

    // Assert
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      previousArrangements,
    )
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 3)?.activeTab,
      draft.tab,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
  } finally {
    release()
    await harness.close()
  }
})

test('constrained Restore keeps a later learner draft active while the native layout receipt settles', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.constrainStudyGrid()
  harness.hideGridWhileMaximized()
  let releaseLayout = (): void => {},
    releaseReceipt = (): void => {}
  try {
    await harness.reader.open()
    await harness.reader.action('read-app')
    const layout = harness.holdNextCommand('runCommands')
    releaseLayout = layout.release

    // Act
    const restoring = harness.reader.action('arrange')
    await layout.started
    const receipt = harness.holdNextCommand('vscode.getEditorLayout')
    releaseReceipt = receipt.release
    releaseLayout()
    await receipt.started
    const draft = harness.focusMutableDraft('later-settlement-notes.txt', 3)
    releaseReceipt()
    await restoring

    // Assert
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 3)?.activeTab,
      draft.tab,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /learner changed native tab focus/i,
    )
  } finally {
    releaseLayout()
    releaseReceipt()
    await harness.close()
  }
})

test('constrained Restore leaves the learner draft active when a later topology check completes', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.constrainStudyGrid()
  harness.hideGridWhileMaximized()
  try {
    await harness.reader.open()
    await harness.reader.action('read-app')
    const checkTopology = harness.reader['hasRetainedStudyTopology'].bind(
      harness.reader,
    )
    let newerDraft: ReturnType<typeof harness.focusMutableDraft> | undefined
    harness.reader['hasRetainedStudyTopology'] = async (
      signal,
      beforeScopeFocus,
    ) => {
      const retained = await checkTopology(signal, beforeScopeFocus)
      if (retained)
        newerDraft = harness.focusMutableDraft('later-topology-notes.txt', 3)
      return retained
    }

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.ok(newerDraft)
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 3)?.activeTab,
      newerDraft.tab,
    )
    assert.equal(newerDraft.document.getText(), 'Original learner draft.\n')
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.match(
      harness.reader.presentationState().reason ?? '',
      /learner changed native tab focus/i,
    )
  } finally {
    await harness.close()
  }
})

for (const initial of [
  { mainGroups: 1, separatePart: false, globalGroups: 1 },
  { mainGroups: 1, separatePart: true, globalGroups: 2 },
  { mainGroups: 2, separatePart: true, globalGroups: 3 },
])
  test(`failed initial pane reservation with ${initial.mainGroups} main panes and ${initial.separatePart ? 'a separate part' : 'one part'} cannot create Context before an explicit retry`, async (context) => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({
      orientation: 0,
      groups: Array.from({ length: initial.mainGroups }, () => ({})),
    })
    const chat = initial.separatePart
        ? harness.addSeparateEditorPart()
        : undefined,
      draft = harness.focusMutableDraft()
    const original = harness.editorLayout()
    harness.failNextCommand('vscode.setEditorLayout')
    try {
      // Act: the layout waits pass on a faked clock.
      enableFakeClock(context)
      const refused = assert.rejects(
        harness.reader.open(),
        /could not reserve separate Codebook panes/,
      )
      await advanceClockUntilSettled(context, refused, 10_000)
      await refused
      const refreshing = harness.reader['refresh']()
      await advanceClockUntilSettled(context, refreshing, 10_000)
      await refreshing
      resetFakeClock(context)

      // Assert
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        1,
      )
      assert.deepEqual(harness.editorLayout(), original)
      assert.equal(harness.groups.length, initial.globalGroups)
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
      assert.equal(harness.reader.inspect().sourceUri, undefined)
      assert.equal(harness.reader.inspect().opened, false)
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      if (chat) {
        assert.equal(harness.groups.at(-1)!.tabs.includes(chat.tab), true)
        assert.deepEqual(chat.layout(), {
          orientation: 1,
          groups: [{ size: 743 }],
        })
      }
      assert.equal(
        harness.reader
          .inspect()
          .view!.errors.some((error) =>
            error.includes(
              'the editor did not keep the layout Codebook applied',
            ),
          ),
        true,
      )
      // The line names why the layout was not confirmed (Cycle 0044, 0033-L1), here a grid that never settled.
      assert.equal(
        harness.reader
          .inspect()
          .view!.errors.some((error) =>
            error.includes(
              'to apply it again. Cause: Error: Timed out waiting for settled reader grid',
            ),
          ),
        true,
      )
      assert.equal(harness.runtimes.length, 0)

      await harness.reader.open()
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(harness.panelColumn('codebook.studyContext'), 3)
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      if (chat) {
        assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true)
        assert.deepEqual(chat.layout(), {
          orientation: 1,
          groups: [{ size: 743 }],
        })
      }
    } finally {
      await harness.close()
    }
  })

test('ordinary Study entry retains manually shared pane columns until the learner explicitly arranges them', async () => {
  // Arrange
  const harness = await workspaceHarness(false),
    manual = { orientation: 0, groups: [{}, {}] }
  try {
    await harness.reader.open()
    harness.movePanel('codebook.scopedBrowser', 2)
    harness.movePanel('codebook.studyContext', 2)
    harness.changeEditorLayout(manual)

    // Act
    await harness.reader.open()

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2)
    assert.equal(harness.panelColumn('codebook.studyContext'), 2)
    assert.deepEqual(harness.editorLayout(), manual)
  } finally {
    await harness.close()
  }
})
