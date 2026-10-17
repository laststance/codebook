import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { CHAT_KEYBOARD_RETURNED_MESSAGES } from '../constants'
import { StudyError } from '../errors'
import { RecordingStore } from '../recordingStore'
import type { BookObservationBinding } from '../repositorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { ViewportAckTimeoutError } from '../runtimeSupport/utils/viewportAckTimeoutError'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { bookObservationHash } from '../utils/bookObservationHash'
import { capturedSourceUriPath } from '../utils/capturedSourceUriPath'
import { citationContext } from '../utils/citationContext'
import type { ShownInterpretation } from '../utils/projectRecording'

import {
  workspaceHarness,
  recordedReaderHarness,
  configuredWorkspaceHarness,
  articleRecordingLayoutHarness,
  readerSeams,
} from './studyWorkspaceHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import {
  advanceClock,
  advanceClockUntil,
  advanceClockUntilSettled,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'
import {
  REPLAY_MODEL_SELECTION_SCENARIO,
  selectionsThroughScenario,
  type ReplayModelSelectionDriver,
} from './utils/replayModelSelectionScenario'

// Regression: 558 — replacing the historical source cannot orphan its native keyboard.
// Found by /qa on 2026-10-15.
// Report: docs/cycles/0046-carried-defects-of-cycle-0045.md
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
      assert.deepEqual(
        harness.sourceIdentityDecorations().slice(identitiesBefore),
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
                hoverMessage:
                  'Recorded: src/theme.ts:1 · 0.10 s · declared 1 · captured SHA-256 f117f21caab18af046f2e57a64ff045dd846130ab2e86fbe6c9360cfcc275771',
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
                hoverMessage:
                  'Recorded source · Not recorded at this moment · captured SHA-256 17ded4ea5073e886425bd977a54edd857924d864f44b3c1b83d9e8aec53893e1',
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

// Regression: 466 — failed Reload must retain its initiating Summary and recovery controls.
// Found by /qa on 2026-10-11.
// Report: docs/cycles/0046-carried-defects-of-cycle-0045.md
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

// Value: protects=the fidelity of the workspace harness's historical debugger to the real owner's model selection (F6): the fake is driven through the scenario table the real owner is held to in replayDebugger.test (REPLAY_MODEL_SELECTION_SCENARIO: the same selection again, another label, another snapshot, an invalidation), so the workspace tests that rest on focusProcess's reveal of the captured source (row 721) see what the real owner does; fails_when=the fake runs focusProcess at every presentation with values, or departs from the table in another step; why_new=N8, Cycle 0046 (the harness kept the rule from before F6); TR8 (the expectations are one table for the fake and the real owner); seam=recordedReaderHarness, the reader's openRecording and a seek to the recorded stop, the fake owner's present and invalidate, and the fake editor's command log
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
    const driver: ReplayModelSelectionDriver = {
      present: async (stop, label) => {
        await debuggerView.present(
          snapshots[stop],
          label,
          new AbortController().signal,
          shown.sourceDocument,
        )
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

test('opening a recording restores its captured source after context focus covers the manually moved source group', async () => {
  // Arrange: show an actual saved observation, then put its source behind the real Context pane.
  const harness = await articleRecordingLayoutHarness(true, true)
  try {
    // Establish the learner's actual saved100ms replay position before reading its source-derived explanation.
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()
    assert.equal(harness.controller.state().presentedMs, 100)
    await harness.reader.action('return-wiki')
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(harness.sourceColumn(), 2)
    harness.moveSource(3)
    assert.equal(harness.editor.window.activeTextEditor?.viewColumn, 3)
    assert.equal(
      harness.editor.window.visibleTextEditors.some(
        (editor) => editor.viewColumn === 3,
      ),
      true,
    )
    await harness.reader.action('focus-context')
    const covered = harness.groups.find((group) => group.viewColumn === 3)!
      .activeTab?.input
    assert.ok(covered && 'viewType' in covered)
    assert.equal(covered.viewType, 'codebook.studyContext')
    assert.equal(harness.sourceColumn(), 3)

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert: the recording restores its own source/image and replaces Context with the summary.
    const state = harness.reader.inspect()
    assert.equal(
      state.view?.recording?.readiness,
      'ready',
      state.view?.recording?.reason,
    )
    const input = harness.groups.find((group) => group.viewColumn === 2)!
      .activeTab?.input
    assert.ok(input && 'uri' in input)
    assert.equal(input.uri.toString(), state.sourceUri)
    assert.equal(harness.displayedImage(), harness.png.toString('base64'))
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(harness.runtimes.length, 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined)
    assert.equal(harness.summary.visible, true)
  } finally {
    await harness.close()
  }
})
// Value: protects=the learner who opened a workspace file in the Application group during a replay being told what happened; fails_when=the reader retires the covered moment like a missing one, so Run and Debug reads "Not recorded at this moment" and the Learning summary reads "Loading the selected observation…" for as long as the file stays in front; why_new=Cycle 0045 NF-31 as DR-19; seam=the harness's fake historical debugger keeps the label of each invalidation
test('a workspace file opened over the recorded application is reported to Run and Debug and to the Learning summary as a covered recording, not as a missing or loading moment', async () => {
  // Arrange: a recorded stop is shown in the Application pane.
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

    // Act: the learner opens a workspace file in the Application group, which comes in front of the pane.
    applicationGroup.activeTab = harness.addTextPreview(
      join(harness.directory, 'app', 'notes.ts'),
      applicationGroup.viewColumn,
    )
    application.notifyViewState()
    const whileCovered = harness.postedMessages().at(-1)!
    const labelWhileCovered = harness.historicalDebugInvalidationLabels().at(-1)

    // Act: the learner brings the pane to the front again.
    applicationGroup.activeTab = application.nativeTab
    application.notifyViewState()
    await harness.controller.settle()
    const afterReturn = harness.postedMessages().at(-1)!

    // Assert
    assert.equal(
      labelWhileCovered,
      'Recorded application is covered by another tab',
    )
    assert.deepEqual(
      {
        loading: whileCovered.loading,
        applicationCovered: whileCovered.recording?.applicationCovered,
        cleared: whileCovered.recording?.cleared,
      },
      { loading: false, applicationCovered: true, cleared: true },
    )
    assert.deepEqual(
      {
        loading: afterReturn.loading,
        applicationCovered: afterReturn.recording?.applicationCovered,
        cleared: afterReturn.recording?.cleared,
        presentedMs: afterReturn.recording?.presentedMs,
      },
      {
        loading: false,
        applicationCovered: false,
        cleared: false,
        presentedMs: 100,
      },
    )
  } finally {
    await harness.close()
  }
})

test('one bottom playback seek from a hidden Application commits the requested recorded moment without another target action', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
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
    const reveal = viewport.reveal.bind(viewport)
    // Model the native visibility notification that the existing renderer port omits.
    viewport.reveal = async (): Promise<void> => {
      await reveal()
      application.reveal(undefined, true)
    }
    applicationGroup.activeTab = undefined
    application.notifyViewState()
    assert.equal(application.visible, false)
    const targetActionsBefore = harness.runtimes[0]!.dispatches
    const view = harness.playbackPanelMessages.at(-1)!

    // Act
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'seek',
      positionMs: 100,
      revision: view.revision,
      expectedRevision: harness.controller.state().revision,
    })
    await new Promise((resolve) => setImmediate(resolve))
    await harness.controller.settle()

    // Assert
    assert.equal(application.visible, true)
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(
      harness.controller.bundle()?.projection.observation?.elapsedMs,
      100,
    )
    assert.equal(harness.displayedImage(), harness.png.toString('base64'))
    assert.equal((await harness.store.readPreference())?.positionMs, 100)
    assert.equal(harness.runtimes[0]!.dispatches, targetActionsBefore)
  } finally {
    await harness.close()
  }
})

test('saved replay survives one recorded viewport paint loss without rerunning the target', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )
    assert.ok(viewport)
    const originalPresent = viewport.present.bind(viewport)
    const revealsBefore = harness.viewportEvents.filter(
      (event) => event === 'reveal:recording',
    ).length
    const targetActionsBefore = harness.runtimes[0]!.dispatches
    let presentations = 0
    viewport.present = async (image): Promise<void> => {
      presentations++
      if (presentations === 1) throw new ViewportAckTimeoutError()
      await originalPresent(image)
    }

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(presentations, 2)
    assert.equal(
      harness.viewportEvents.filter((event) => event === 'reveal:recording')
        .length,
      revealsBefore + 1,
    )
    assert.equal(harness.runtimes[0]!.dispatches, targetActionsBefore)
    assert.equal(harness.displayedImage(), harness.png.toString('base64'))
  } finally {
    await harness.close()
  }
})

// Value: protects=the replay painting a frame once more after its first paint was not acknowledged, whatever words the timeout carries, and not retrying a failure that only reads like one; fails_when=the reader recognises the timeout by comparing its text with one constant, so a reworded or wrapped timeout skips the retry and the recording shows an error for one lost receipt; why_new=Cycle 0045 local review runtime-1 #6 (the retry compared `String(error)`); seam=the recorded reader harness's viewport, whose first paint rejects
for (const first of ['a timeout in other words', 'another error'] as const)
  test(`a recorded frame whose first paint fails with ${first} is ${first === 'another error' ? 'not painted again although its text reads like the timeout' : 'painted once more'}`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      const viewport = harness.viewportInstances.find(
        (candidate) => candidate.mode === 'recording',
      )
      assert.ok(viewport)
      const originalPresent = viewport.present.bind(viewport)
      let presentations = 0
      viewport.present = async (image): Promise<void> => {
        presentations++
        if (presentations === 1)
          throw first === 'another error'
            ? new Error('Viewport frame acknowledgement timed out')
            : Object.assign(new ViewportAckTimeoutError(), {
                message: 'The renderer did not answer in time',
              })
        await originalPresent(image)
      }

      // Act
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 100,
      })
      await harness.controller.settle()

      // Assert
      assert.equal(presentations, first === 'another error' ? 1 : 2)
      assert.equal(
        harness.controller.state().readiness,
        first === 'another error' ? 'failed' : 'ready',
      )
    } finally {
      await harness.close()
    }
  })

test('saved replay reports a second viewport paint loss without advancing the saved position', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )
    assert.ok(viewport)
    let presentations = 0
    viewport.present = async () => {
      presentations++
      throw new ViewportAckTimeoutError()
    }

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(presentations, 2)
    assert.equal((await harness.store.readPreference())?.positionMs, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=one renderer handshake per seek after the learner closed a hidden Recorded application pane; fails_when=the dispose handler drops the renderer without resetting replayNeedsReveal, so the new renderer's next seek repeats its reveal; why_new=Cycle 0035 R06; seam=replayNeedsReveal set directly to stand for the hidden pane
test('a recording renderer created after the hidden Recorded application pane was closed reveals once and not again on the next seek', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.reader['replayNeedsReveal'] = true
    harness.reader['app']!.dispose()
    const revealsAfterPaneClosed = harness.viewportEvents.filter(
      (event) => event === 'reveal:recording',
    ).length

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(
      harness.viewportEvents.filter((event) => event === 'reveal:recording')
        .length,
      revealsAfterPaneClosed + 1,
    )
  } finally {
    await harness.close()
  }
})

test('saved replay does not retry a non-paint viewport failure', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )
    assert.ok(viewport)
    const revealsBefore = harness.viewportEvents.filter(
      (event) => event === 'reveal:recording',
    ).length
    let presentations = 0
    viewport.present = async () => {
      presentations++
      throw new Error('Recorded viewport is closed')
    }

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(presentations, 1)
    assert.equal(
      harness.viewportEvents.filter((event) => event === 'reveal:recording')
        .length,
      revealsBefore,
    )
  } finally {
    await harness.close()
  }
})

test('a repeated recorded paint loss names each attempt’s renderer progress in Recording error details', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )
    assert.ok(viewport)
    const originalReveal = viewport.reveal.bind(viewport)
    viewport.reveal = async (): Promise<void> => {
      await originalReveal()
      viewport.record('viewport.ready', {
        epoch: '22222222-2222-2222-2222-222222222222',
      })
    }
    let presentations = 0
    viewport.present = async () => {
      presentations++
      viewport.record('viewport.sent', {
        epoch: '11111111-1111-1111-1111-111111111111',
        id: presentations,
        hash: 'recorded-image-hash',
        phase: 'Recorded · 0.10 s',
      })
      if (presentations === 1) {
        viewport.record('viewport.frame-stage', {
          id: 1,
          stage: 'received',
          visibility: 'visible',
          hasArea: true,
        })
        viewport.record('viewport.frame-stage', {
          id: 1,
          stage: 'decoded',
          visibility: 'visible',
          hasArea: true,
        })
        viewport.record('viewport.frame-stage', {
          id: 1,
          stage: 'paint-queued',
          visibility: 'visible',
          hasArea: true,
        })
      } else
        viewport.record('viewport.frame-stage', {
          id: 2,
          stage: 'received',
          visibility: 'hidden',
          hasArea: false,
        })
      viewport.record('viewport.delivery-rejected', {
        id: presentations,
        phase: 'Recorded · 0.10 s',
        reason: 'Viewport frame acknowledgement timed out',
      })
      throw new ViewportAckTimeoutError()
    }

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(
      harness.controller.state().reason,
      'Error: Viewport frame acknowledgement timed out again after one same-frame retry. ' +
        'First attempt: sent #1; received (visible, area); decoded; paint-queued; rejected #1: Viewport frame acknowledgement timed out; panel visible. ' +
        'Retry: ready 22222222; sent #2; received (hidden, no area); rejected #2: Viewport frame acknowledgement timed out; panel visible.',
    )
    assert.equal(presentations, 2)
    assert.equal((await harness.store.readPreference())?.positionMs, 0)
  } finally {
    await harness.close()
  }
})

test('a failed renderer re-handshake after a recorded paint loss keeps the first attempt in Recording error details', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.viewportInstances.find(
      (candidate) => candidate.mode === 'recording',
    )
    assert.ok(viewport)
    viewport.reveal = async () => {
      throw new Error('Timed out waiting for owned viewport ready')
    }
    let presentations = 0
    viewport.present = async () => {
      presentations++
      viewport.record('viewport.sent', {
        epoch: '11111111-1111-1111-1111-111111111111',
        id: 1,
        hash: 'recorded-image-hash',
        phase: 'Recorded · 0.10 s',
      })
      viewport.record('viewport.frame-stage', {
        id: 1,
        stage: 'received',
        visibility: 'visible',
        hasArea: false,
      })
      viewport.record('viewport.delivery-rejected', {
        id: 1,
        phase: 'Recorded · 0.10 s',
        reason: 'Viewport frame acknowledgement timed out',
      })
      throw new ViewportAckTimeoutError()
    }

    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(
      harness.controller.state().reason,
      'Error: Viewport frame acknowledgement timed out; the same-frame retry could not re-handshake the renderer: Error: Timed out waiting for owned viewport ready. ' +
        'First attempt: sent #1; received (visible, no area); rejected #1: Viewport frame acknowledgement timed out; panel visible. ' +
        'Re-handshake: no renderer receipts; panel visible.',
    )
    assert.equal(presentations, 1)
    assert.equal((await harness.store.readPreference())?.positionMs, 0)
  } finally {
    await harness.close()
  }
})

test('Pause during a late recorded image restores the previous source and preserves only the confirmed position', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const delayed = harness.holdNextImage()
    // Act
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await delayed.started
    assert.equal(harness.reader.inspect().view?.loading, true)
    harness.controller.command({
      action: 'pause',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
    })
    delayed.release()
    await harness.controller.settle()
    // Assert
    const view = harness.reader.inspect().view!
    assert.equal(view.recording?.readiness, 'ready', view.recording?.reason)
    assert.equal(view.recording?.presentedMs, 0)
    assert.equal(view.model.observation, undefined)
    assert.equal(
      view.model.source.text,
      '// No source was observed by this recorded position.\n',
    )
    assert.equal(harness.displayedImage(), undefined)
    assert.equal((await harness.store.readPreference())?.positionMs, 0)
  } finally {
    await harness.close()
  }
})

test('a fresh reader restores the saved recording position paused and a live-runtime retirement does not exit playback', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  let reloaded: ReturnType<typeof harness.createReader> | undefined
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
    await harness.reader.dispose()
    // Act
    reloaded = harness.createReader()
    await reloaded.attach(harness.service)
    await reloaded.openRecording(harness.studyId)
    await harness.service.playbackController!.settle()
    const restored = reloaded.inspect().view!
    await reloaded.retire(harness.service)
    // Assert
    assert.equal(
      restored.recording?.readiness,
      'ready',
      restored.recording?.reason,
    )
    assert.equal(restored.recording?.presentedMs, 100)
    assert.equal(restored.recording?.mode, 'paused')
    assert.equal(reloaded.inspect().view?.contentTab, 'recording')
    assert.equal(
      reloaded.inspect().view?.model.observation?.values['value:nextTheme'],
      'dark',
    )
    assert.equal(harness.runtimes.length, 1)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    await reloaded?.dispose()
    await harness.close()
  }
})

test('saved Study sends captured facts without copying retained source bodies into its webviews', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  try {
    await harness.start()
    // Act
    await harness.reader.action('click')
    await harness.reader.action('stop')
    await harness.reader.select('repository/interface/theme')
    const posted = harness
      .postedMessages()
      .findLast(
        (message) => message.model.observation?.actionId === 'repository-click',
      )
    // Assert: native/archive source stays intact while webview metadata remains sufficient.
    assert.ok(posted?.model.observation?.actionId === 'repository-click')
    assert.equal(posted.model.source.text, '')
    assert.equal(posted.model.observation.source.text, '')
    assert.equal(posted.model.observation.values['value:enabled'], false)
    assert.equal(
      harness.reader.inspect().view!.model.source.text,
      'const nextTheme = "dark";\n',
    )
    assert.equal(
      harness.reader.inspect().view!.model.observation!.source.text,
      'const nextTheme = "dark";\n',
    )
  } finally {
    await harness.close()
  }
})

test('configured captured and current native readers accept unchanged BOM and mixed line endings without changing retained bytes', async () => {
  // Arrange
  const source =
      '\uFEFFconst nextTheme = "dark";\r\n// Retained second line.\r',
    harness = await configuredWorkspaceHarness(source)
  try {
    // Act
    const record = await harness.start()
    await harness.reader.action('source')
    await harness.reader.action('current-file')
    // Assert
    assert.equal(harness.reader.inspect().view!.loading, false)
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
    assert.equal(harness.reader.inspect().view!.model.source.text, source)
    assert.equal(
      harness.reader.inspect().view!.model.source.hash,
      sha256(source),
    )
    assert.equal(
      await readFile(join(harness.directory, 'src/theme.ts'), 'utf8'),
      source,
    )
    // Capture and persist the custom bytes too; preparation alone cannot verify fixture fidelity.
    await harness.reader.action('click')
    assert.equal(
      harness.reader.inspect().view!.model.observation!.source.text,
      '\uFEFFconst nextTheme = "dark";\r\n// Retained second line.\r',
    )
    await harness.reader.action('stop')
    const saved = await harness.library.readStudy(
      `${harness.service.instanceId}_${record.id}`,
    )
    assert.equal(
      saved.observations[0]!.source.text,
      '\uFEFFconst nextTheme = "dark";\r\n// Retained second line.\r',
    )
    assert.equal(
      saved.observations[0]!.source.hash,
      '1859ebb4deb7f0440871f8ddbc3cea090984845ce0cfde0ab648ebb493bf01f2',
    )
  } finally {
    await harness.close()
  }
})

test('failed evidence navigation preserves the previous exact article return pose in memory and after restart', async (context) => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  let restarted: ReturnType<typeof harness.createReader> | undefined
  try {
    const record = await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')
    const study = await harness.library.readStudy(
        `${harness.service.instanceId}_${record.id}`,
      ),
      observation = study.observations[0]!
    const binding: BookObservationBinding = {
      nodeId: 'theme',
      linkIndex: 0,
      studyId: study.id,
      observationId: observation.id,
      sourceHash: observation.source.hash,
      itemId: observation.itemId,
      observationHash: bookObservationHash(observation),
      elapsedMs: observation.elapsedMs,
      outcome: study.finalOutcome,
    }
    const origin = {
      bookId: 'interface',
      revision: 1,
      nodeId: 'theme',
      anchorIndex: 1,
      location: { sectionIndex: 2, fraction: 0.75, focusId: 'section-2' },
    }
    await harness.reader.openRepositoryEvidence(
      binding,
      false,
      undefined,
      origin,
    )
    context.mock.method(RecordingStore.prototype, 'readContext', async () => {
      throw new Error('Injected missing recording context')
    })
    // Act
    await assert.rejects(
      harness.reader.openRepositoryEvidence(binding, true, undefined, {
        ...origin,
        anchorIndex: 0,
        location: { sectionIndex: 0, fraction: 0, focusId: 'section-0' },
      }),
      /Injected missing/,
    )
    await harness.reader.action('return-wiki')
    await harness.reader.close()
    restarted = harness.createReader()
    await restarted.open()
    await restarted.action('return-wiki')
    // Assert
    assert.equal(
      JSON.stringify(harness.articleReturns),
      JSON.stringify([origin, origin]),
    )
    assert.equal(
      JSON.stringify((await harness.library.readProgress()).repositoryReturn),
      JSON.stringify({ studyId: study.id, selection: origin }),
    )
  } finally {
    context.mock.restoreAll()
    await restarted?.dispose()
    await harness.close()
  }
})

test('agent-configured input uses the shared reader and complete article understanding without opening or closing a raw target tab', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  try {
    const draft = harness.addForeignDraft()
    await harness.library.decide({
      id: randomUUID(),
      item: 'repository/interface/theme',
      sourceHash: harness.study.configuration.source.hash,
      context: harness.study.descriptor!.citationContext,
      understood: true,
      at: '2026-09-20T00:00:00.000Z',
    })
    const record = await harness.start()
    // Act
    harness.configuredClock(2000)
    await harness.reader.action('click')
    await harness.reader.presentation.revealSource(
      harness.configuredRuntimes[0]!.snapshots[0]!,
      'unused raw path',
    )
    const view = harness.reader.inspect().view!
    // Assert
    assert.equal(view.model.selection.itemId, 'repository/interface/theme')
    assert.equal(view.model.progressByItem.length, 1)
    assert.equal(view.nextAction, undefined)
    assert.equal(view.model.matching, true)
    assert.equal(view.model.currentItemTitle, 'Theme')
    assert.equal(view.model.selectedUnderstanding.understood, true)
    assert.equal(view.model.understoodCount, 1)
    assert.ok(view.model.observation?.actionId === 'repository-click')
    assert.equal(view.model.observation.values['value:selection'], null)
    assert.match(harness.reader.inspect().sourceUri!, /^codebook-source:/)
    assert.equal(
      harness.groups
        .flatMap((group) => group.tabs)
        .some(
          (tab) =>
            tab.input instanceof Object &&
            'uri' in tab.input &&
            tab.input.uri.fsPath === join(harness.directory, 'src/theme.ts'),
        ),
      false,
    )
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1)
    assert.equal(record.profile, 'repository-browser')
    await harness.reader.close()
    assert.equal(harness.groups[0]!.tabs.includes(draft), true)
    assert.equal(draft.isDirty, true)
  } finally {
    await harness.close()
  }
})

test('configured recording-context failure remains visible beside independently saved observation history', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  try {
    const saveContext = harness.service.recordings!.saveContext.bind(
      harness.service.recordings!,
    )
    harness.service.recordings!.saveContext = async () => {
      throw new Error('Injected recording context write failure')
    }
    // Act
    const record = await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')
    const view = harness.reader.inspect().view!
    // Assert
    assert.equal(record.recordingReceipt?.status, 'failed')
    assert.equal(view.study?.historyOutcome, 'saved')
    assert.equal(view.study?.recordingSave?.contextStatus, 'failed')
    assert.match(
      view.study?.recordingSave?.contextReason ?? '',
      /Injected recording context write failure/,
    )
    assert.ok(view.model.observation)
    assert.equal(view.model.continueArguments, undefined)
    harness.service.recordings!.saveContext = saveContext
    await harness.reader.action('retry')
    assert.equal(
      harness.reader.inspect().view?.study?.recordingSave?.contextStatus,
      'saved',
    )
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=the list the learner went on to while Show Variables waits for Run and Debug; fails_when=the list commands run on whichever list holds the focus after the wait, so a click into the Explorer during the wait gets the Explorer's first row focused and expanded and the recorded values stay collapsed; why_new=Cycle 0045 RT-4 (the commands ran after two waits without focusing Variables again); seam=the harness's fake host knows which list holds the focus
test('Show Variables expands the first scope of Variables, never the first row of a list the learner clicked during its wait', async (context) => {
  // Arrange: a recorded stop presented while Run and Debug was never opened, so the press waits 200 ms for Variables to list the values.
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
    enableFakeClock(context)
    const press = harness.reader.action('show-variables').then(
      () => 'completed',
      (error: unknown) => String(error),
    )
    await advanceClock(context, 100)

    // Act: the learner clicks into the Explorer 100 ms into that wait.
    harness.clickAnotherList()
    await advanceClockUntilSettled(context, press, 10_000)

    // Assert
    assert.equal(await press, 'completed')
    assert.deepEqual(harness.anotherListView(), {
      firstRowFocused: false,
      firstRowExpanded: false,
    })
    assert.deepEqual(harness.nativeVariablesView(), {
      firstScopeFocused: true,
      valuesListed: true,
    })
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

// Value: protects=one captured-source tab per source file across runs; fails_when=each run's observed stop opens another Captured-theme.ts tab beside the earlier run's; why_new=Cycle 0035 O4 (six Captured-auth.ts tabs piled up natively); seam=none
test('a second run stopping in the same source file replaces the first run captured-source tab instead of adding another', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  try {
    await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')

    // Act
    await harness.start()
    await harness.reader.action('click')

    // Assert
    const capturedThemeTabs = harness.groups
      .flatMap((group) => group.tabs)
      .filter(
        (tab) =>
          'uri' in tab.input &&
          tab.input.uri.path.endsWith('/Captured-theme.ts'),
      )
    assert.equal(capturedThemeTabs.length, 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=two different source files with the same name (the page.tsx of two routes) each keep their captured-source tab; fails_when=the one-tab-per-source rule compares the tab's base name instead of the declared source path, so showing one file closes the other file's captured tab (Cycle 0044 review A-M1); why_new=the one-tab test above stops in one file only; seam=none
test('a saved study that stops in another file of the same name keeps the earlier study’s captured-source tab open beside its own', async () => {
  // Arrange: two saved studies whose stops are declared in different files, both named page.tsx.
  const harness = await workspaceHarness(false)
  try {
    const library = await harness.reader.learningStorage()
    const saveStudyDeclaredAt = async (path: string, runId: string) => {
      const study = createConfiguredStudy(),
        descriptor = study.descriptor!
      for (const observation of study.observations)
        observation.snapshotUri = observation.snapshotUri.replace(
          study.runId,
          runId,
        )
      study.workspaceKey = library.workspaceKey
      study.runId = runId
      study.id = `${study.instanceId}_${runId}`
      study.configuration.source.path = path
      study.configurationHash = sha256(JSON.stringify(study.configuration))
      descriptor.anchors[0]!.path = path
      descriptor.sources[0]!.path = path
      descriptor.citationContext = citationContext(descriptor.anchors)
      await library.saveStudy(study)
      return study
    }
    const chooseStudy = async (studyId: string): Promise<void> => {
      harness.receive({
        type: 'history',
        revision: harness.reader.inspect().view!.revision,
        studyId,
      })
      await waitUntil(
        () =>
          harness.reader.inspect().view!.model.selection.studyId === studyId &&
          !harness.reader.inspect().view!.loading,
        'the chosen saved study',
        1_000,
      )
    }
    const first = await saveStudyDeclaredAt(
        'app/a/page.tsx',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
      second = await saveStudyDeclaredAt(
        'app/b/page.tsx',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      )
    await harness.reader.open()
    await chooseStudy(first.id)

    // Act
    await chooseStudy(second.id)

    // Assert
    const capturedPageTabs = harness.groups
      .flatMap((group) => group.tabs)
      .flatMap((tab) =>
        'uri' in tab.input && tab.input.uri.path.endsWith('/Captured-page.tsx')
          ? [tab.input.uri.path.split('/')[1]]
          : [],
      )
    assert.deepEqual(capturedPageTabs, [
      '11111111-1111-4111-8111-111111111111_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=one captured-source tab per source file while a learner goes through Saved studies; fails_when=only the capture shown immediately before is closed, so a capture of the same file from two studies back stays and each further study adds a tab (four studies left Captured-login-form.tsx and Captured-auth.ts twice each); why_new=Cycle 0045 NF-30; seam=none
test('a saved study that stops in a file shown two studies earlier leaves one captured-source tab for that file', async () => {
  // Arrange: three saved studies; the first and the third stop in app/a/page.tsx, the second in app/b/page.tsx.
  const harness = await workspaceHarness(false)
  try {
    const library = await harness.reader.learningStorage()
    const saveStudyDeclaredAt = async (path: string, runId: string) => {
      const study = createConfiguredStudy(),
        descriptor = study.descriptor!
      for (const observation of study.observations)
        observation.snapshotUri = observation.snapshotUri.replace(
          study.runId,
          runId,
        )
      study.workspaceKey = library.workspaceKey
      study.runId = runId
      study.id = `${study.instanceId}_${runId}`
      study.configuration.source.path = path
      study.configurationHash = sha256(JSON.stringify(study.configuration))
      descriptor.anchors[0]!.path = path
      descriptor.sources[0]!.path = path
      descriptor.citationContext = citationContext(descriptor.anchors)
      await library.saveStudy(study)
      return study
    }
    const chooseStudy = async (studyId: string): Promise<void> => {
      harness.receive({
        type: 'history',
        revision: harness.reader.inspect().view!.revision,
        studyId,
      })
      await waitUntil(
        () =>
          harness.reader.inspect().view!.model.selection.studyId === studyId &&
          !harness.reader.inspect().view!.loading,
        'the chosen saved study',
        1_000,
      )
    }
    const first = await saveStudyDeclaredAt(
        'app/a/page.tsx',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
      second = await saveStudyDeclaredAt(
        'app/b/page.tsx',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ),
      third = await saveStudyDeclaredAt(
        'app/a/page.tsx',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      )
    await harness.reader.open()
    await chooseStudy(first.id)
    await chooseStudy(second.id)

    // Act
    await chooseStudy(third.id)

    // Assert: the first study's capture of app/a/page.tsx is gone, the other file's capture stays.
    const capturedPageTabs = harness.groups
      .flatMap((group) => group.tabs)
      .flatMap((tab) => {
        if (
          !('uri' in tab.input) ||
          !tab.input.uri.path.endsWith('/Captured-page.tsx')
        )
          return []
        // The document path is the study, the item, the source hash and then the declared file.
        const [, studyId, , , ...declaredFile] = tab.input.uri.path.split('/')
        return [`${studyId}: ${declaredFile.join('/')}`]
      })
    assert.deepEqual(capturedPageTabs, [
      '11111111-1111-4111-8111-111111111111_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb: app/b/Captured-page.tsx',
      '11111111-1111-4111-8111-111111111111_cccccccc-cccc-4ccc-8ccc-cccccccccccc: app/a/Captured-page.tsx',
    ])
  } finally {
    await harness.close()
  }
})

test('configured history rejects learner Run and only a fresh agent request creates another run without dispatching input', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  try {
    const first = await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')
    // Act
    assert.equal(harness.reader.inspect().view!.canRun, false)
    await assert.rejects(
      harness.reader.action('run'),
      /agent.*prepare a study in the open repository/i,
    )
    assert.equal(harness.service.records.size, 1)
    assert.equal(harness.configuredRuntimes.length, 1)
    const second = await harness.start()
    // Assert
    assert.notEqual(second.id, first.id)
    assert.equal(second.profile, 'repository-browser')
    assert.ok(second.profile === 'repository-browser')
    assert.equal(
      JSON.stringify(second.configuration),
      JSON.stringify(harness.study.configuration),
    )
    assert.notEqual(second.key, first.key)
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1)
    assert.equal(harness.configuredRuntimes[1]!.dispatches, 0)
    assert.equal(
      harness.reader.inspect().view!.model.selection.itemId,
      'repository/interface/theme',
    )
    assert.equal(harness.reader.inspect().view!.canClick, true)
  } finally {
    await harness.close()
  }
})

test('a configured article decision survives reader restart and secondary-file drift without changing its saved citation context', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  let restarted: ReturnType<typeof harness.createReader> | undefined
  try {
    await harness.start()
    await harness.reader.action('click')
    await harness.reader.understand(true)
    await harness.reader.action('stop')
    const before = (await harness.library.readProgress()).decisions
    await harness.reader.close()
    restarted = harness.createReader()
    await restarted.open()
    assert.equal(restarted.inspect().view!.model.understoodCount, 1)
    // Act
    await writeFile(
      join(harness.directory, 'src/mode.ts'),
      'export const mode = "contrast";\n',
    )
    await restarted.action('retry')
    const view = restarted.inspect().view!
    // Assert
    assert.equal(view.model.sourceChanged, true)
    assert.equal(view.model.reviewCount, 1)
    assert.equal(view.model.understoodCount, 0)
    assert.equal(view.model.selectedUnderstanding.understood, true)
    assert.equal(view.model.selectedUnderstanding.context?.anchors.length, 2)
    assert.equal(view.model.source.text, 'const nextTheme = "dark";\n')
    assert.equal(view.model.continueArguments, undefined)
    assert.equal(
      JSON.stringify((await harness.library.readProgress()).decisions),
      JSON.stringify(before),
    )
    assert.equal(harness.configuredRuntimes.length, 1)
  } finally {
    await restarted?.dispose()
    await harness.close()
  }
})

test('a configured outline cannot write historical understanding after a secondary citation changes', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  try {
    await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')
    assert.equal(
      harness.outlineItem('repository/interface/theme').checkboxState,
      0,
    )
    harness.changeOutlineCheckbox('repository/interface/theme', true)
    await waitUntil(
      () => harness.reader.inspect().view!.model.understoodCount === 1,
      'current citation understanding',
      1_000,
    )
    assert.equal(
      harness.outlineItem('repository/interface/theme').checkboxState,
      1,
    )
    const before = JSON.stringify(
      (await harness.library.readProgress()).decisions,
    )
    // Act
    await writeFile(
      join(harness.directory, 'src/mode.ts'),
      'export const mode = "contrast";\n',
    )
    await harness.reader.action('retry')
    const item = harness.outlineItem('repository/interface/theme')
    assert.equal(item.checkboxState, undefined)
    assert.equal(item.description, 'Review needed')
    harness.changeOutlineCheckbox('repository/interface/theme', false)
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.errors.some((error) =>
            error.includes('Current citations differ'),
          ),
      'rejected stale outline event',
      1_000,
    )
    // Assert
    assert.equal(
      JSON.stringify((await harness.library.readProgress()).decisions),
      before,
    )
    assert.equal(
      harness.reader.inspect().view!.model.selectedUnderstanding.understood,
      true,
    )
    assert.equal(harness.reader.inspect().view!.model.understoodCount, 0)
    await harness.reader.understand(false)
    assert.equal(
      harness.reader.inspect().view!.model.selectedUnderstanding.understood,
      false,
    )
    const decisions = (await harness.library.readProgress()).decisions
    assert.equal(decisions.length, 2)
    assert.equal(decisions[1]!.understood, false)
    assert.equal(
      JSON.stringify(decisions[1]!.context),
      JSON.stringify(decisions[0]!.context),
    )
  } finally {
    await harness.close()
  }
})

test('direct configured entry opens its article at the beginning while actual article origins restore their exact pose after restart', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  let restarted: ReturnType<typeof harness.createReader> | undefined
  try {
    await harness.library.selectRepository({
      bookId: 'unrelated',
      revision: 3,
      nodeId: 'other',
      anchorIndex: 0,
      location: { sectionIndex: 2, fraction: 0.9, focusId: 'section-2' },
    })
    const record = await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')
    assert.equal(
      harness.reader.inspect().view!.repositoryReturnAvailable,
      false,
    )
    assert.equal(
      harness.reader.inspect().view!.repositoryArticleAvailable,
      true,
    )
    await assert.rejects(
      harness.reader.action('return-wiki'),
      /No article return/,
    )
    await harness.reader.action('open-article')
    assert.equal(
      JSON.stringify(harness.articleOpens),
      JSON.stringify([
        { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 },
      ]),
    )
    const study = await harness.library.readStudy(
        `${harness.service.instanceId}_${record.id}`,
      ),
      observation = study.observations[0]!
    const binding: BookObservationBinding = {
      nodeId: 'theme',
      linkIndex: 0,
      studyId: study.id,
      observationId: observation.id,
      sourceHash: observation.source.hash,
      itemId: observation.itemId,
      observationHash: bookObservationHash(observation),
      elapsedMs: observation.elapsedMs,
      outcome: study.finalOutcome,
    }
    const origin = {
      bookId: 'interface',
      revision: 1,
      nodeId: 'theme',
      anchorIndex: 1,
      location: { sectionIndex: 1, fraction: 0.65, focusId: 'section-1' },
    }
    // Act
    await harness.reader.openRepositoryEvidence(
      binding,
      false,
      undefined,
      origin,
    )
    await harness.reader.close()
    restarted = harness.createReader()
    await restarted.open()
    await restarted.action('return-wiki')
    // Assert
    assert.equal(restarted.inspect().view!.repositoryReturnAvailable, true)
    assert.equal(
      JSON.stringify(harness.articleReturns),
      JSON.stringify([origin]),
    )
    assert.equal(
      JSON.stringify((await harness.library.readProgress()).repositoryReturn),
      JSON.stringify({ studyId: study.id, selection: origin }),
    )
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1)
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
  } finally {
    await restarted?.dispose()
    await harness.close()
  }
})

test('configured recording seeks actual facts through the shared reader after runtime exit with no future source or execution authority', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness()
  try {
    const record = await harness.start(),
      png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
        'base64',
      )
    assert.ok(record.recording)
    record.recording.frame({ bytes: png, elapsedMs: 100, kind: 'stream' })
    harness.configuredClock(2000)
    await harness.reader.action('click')
    record.recording.frame({ bytes: png, elapsedMs: 2100, kind: 'stream' })
    harness.configuredClock(4000)
    await harness.reader.action('stop')
    const controller = harness.service.playbackController!,
      studyId = record.recording.header.studyId
    // Act
    await harness.reader.openRecording(studyId)
    await controller.settle()
    const before = harness.reader.inspect().view!
    controller.command({
      action: 'seek',
      studyId,
      expectedRevision: controller.state().revision,
      positionMs: 2100,
    })
    await controller.settle()
    const paused = harness.reader.inspect().view!
    // Assert
    assert.equal(before.recording?.readiness, 'ready', before.recording?.reason)
    assert.equal(before.model.observation, undefined)
    assert.equal(
      before.model.source.text,
      '// No source was observed by this recorded position.\n',
    )
    assert.equal(before.model.selectedUnderstanding.known, false)
    assert.equal(paused.recording?.readiness, 'ready', paused.recording?.reason)
    assert.equal(paused.recording?.presentedMs, 2100)
    assert.ok(paused.model.observation?.actionId === 'repository-click')
    assert.equal(paused.model.observation.values['value:enabled'], false)
    assert.equal(paused.model.observation.values['value:selection'], null)
    assert.equal(paused.model.continueArguments, undefined)
    assert.equal(paused.model.matching, false)
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1)
    assert.equal(harness.displayedImage(), png.toString('base64'))
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=the Learning summary of a reopened recording showing, at a recorded stop, that stop's explanation with when it was saved, and keeping only the later revision apart; fails_when=the message the Study pane renders loses the note on its way from the projection, lists the stop's own explanation under Later annotations as well, or shows no explanation at the stop (what both hosts showed in the second native round); why_new=Cycle 0045 cause 10; seam=none
test('at a recorded stop the Study pane receives that stop’s explanation with when it was saved, and Later annotations hold only the revision saved after it', async () => {
  // Arrange: one stop committed at 100 ms and continued at 900 ms in a film that ended at 1,000 ms; the agent explained it at 1,500 ms and revised that at 1,600 ms.
  const harness = await recordedReaderHarness(true, true)
  try {
    const { service, record, controller, studyId } = harness,
      stop = harness.runtimes[0]!.snapshots[0]!,
      explanation = {
        instanceId: service.instanceId,
        runId: record.id,
        snapshotUri: service.state(record).observations[0]!.snapshotUri,
        sourceHash: stop.source.hash,
        valuePaths: ['value:nextTheme'],
      }
    harness.clock(1_500)
    await service.explain({
      ...explanation,
      key: 'explanation',
      interpretation: 'This stop holds the dark theme before it is applied.',
    })
    harness.clock(1_600)
    await service.explain({
      ...explanation,
      key: 'revision',
      interpretation: 'The complete path ended with the dark theme applied.',
    })
    // The reader's refresh, which its timer runs, saves both explanations with the recording context.
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        service.state(record).historyOutcome.status === 'saved' &&
        service.state(record).recording.contextStatus === 'saved',
      'both explanations saved with the recording context',
      2_000,
    )

    // Act: the learner opens the recording and steps onto the stop.
    await harness.reader.openRecording(studyId)
    await controller.settle()
    controller.command({
      action: 'seek',
      studyId,
      expectedRevision: controller.state().revision,
      positionMs: 100,
    })
    await controller.settle()
    const atStop = harness.postedMessages().slice(-1)[0]!

    // Assert
    const shown: ShownInterpretation[] =
      atStop.model.observation?.interpretations ?? []
    assert.equal(atStop.recording?.presentedMs, 100)
    assert.deepEqual(
      shown.map((interpretation) => [
        interpretation.text,
        interpretation.savedLater,
      ]),
      [
        [
          'This stop holds the dark theme before it is applied.',
          'after-recording-ended',
        ],
      ],
    )
    assert.deepEqual(
      atStop.recording?.laterInterpretations.map((interpretation) => [
        interpretation.text,
        interpretation.availableMs,
      ]),
      [['The complete path ended with the dark theme applied.', 1_600]],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the recorded application image and Run and Debug staying as they are while Play passes the time the agent explained the stop on screen; fails_when=the reader presents the same image and stop again when only the shown explanations change (native check F18 of NF-13 looked for exactly this); why_new=Cycle 0045 FXU; seam=duringStop saves the explanation at 150 ms of the recording, and the test counts the recording viewport's image presentations and clears
test('Play across the time the stop on screen was explained leaves the recorded image and Run and Debug untouched, and the Study pane gains the explanation', async () => {
  // Arrange: a stop without recorded debugger state committed at 100 ms of a film that ended at 200 ms; the agent explained it at 150 ms.
  const harness = await recordedReaderHarness(
    true,
    false,
    1,
    async (stopped) => {
      const { service } = stopped,
        record = [...service.records.values()][0]!
      stopped.clock(150)
      await service.explain({
        instanceId: service.instanceId,
        runId: record.id,
        snapshotUri: service.state(record).observations[0]!.snapshotUri,
        sourceHash: stopped.runtimes[0]!.snapshots[0]!.source.hash,
        valuePaths: ['value:nextTheme'],
        key: 'explanation',
        interpretation: 'The theme is read before the click applies it.',
      })
    },
  )
  try {
    const { service, record, controller, studyId } = harness
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        service.state(record).historyOutcome.status === 'saved' &&
        service.state(record).recording.contextStatus === 'saved',
      'the explanation saved with the recording context',
      2_000,
    )
    await harness.reader.openRecording(studyId)
    await controller.settle()
    controller.command({
      action: 'seek',
      studyId,
      expectedRevision: controller.state().revision,
      positionMs: 120,
    })
    await controller.settle()
    const beforePlay = harness.postedMessages().slice(-1)[0]!
    const viewport = harness.viewportInstances.find(
      (instance) => instance.mode === 'recording',
    )!
    const imagePresentedAtMs: Array<number | undefined> = [],
      imageClearedAtMs: Array<number | undefined> = []
    const presentImage = viewport.present.bind(viewport),
      clearImage = viewport.clearRecorded.bind(viewport)
    viewport.present = async (image: string): Promise<void> => {
      imagePresentedAtMs.push(controller.state().requestedMs)
      await presentImage(image)
    }
    viewport.clearRecorded = (): void => {
      imageClearedAtMs.push(controller.state().requestedMs)
      clearImage()
    }
    const debugPresentationsBeforePlay =
        harness.historicalDebugPresentations.length,
      debugInvalidationsBeforePlay = harness.historicalDebugInvalidations()

    // Act: Play runs from 120 ms to the end of the recording.
    controller.command({
      action: 'play',
      studyId,
      expectedRevision: controller.state().revision,
    })
    await waitUntil(
      () =>
        controller.state().mode === 'paused' &&
        controller.state().presentedMs === 200,
      'Play reaches the end of the recording',
      2_000,
    )
    await controller.settle()

    // Assert
    const shownAt = (positionMs: number) =>
      harness
        .postedMessages()
        .findLast((message) => message.recording?.presentedMs === positionMs)
        ?.model.observation?.interpretations.map(
          (interpretation) => interpretation.text,
        )
    assert.equal(beforePlay.recording?.presentedMs, 120)
    assert.deepEqual(
      beforePlay.model.observation?.interpretations.map(
        (interpretation) => interpretation.text,
      ),
      [],
    )
    assert.deepEqual(shownAt(150), [
      'The theme is read before the click applies it.',
    ])
    assert.deepEqual(shownAt(200), [
      'The theme is read before the click applies it.',
    ])
    assert.deepEqual(imagePresentedAtMs, [])
    assert.deepEqual(imageClearedAtMs, [])
    assert.equal(
      harness.historicalDebugPresentations.length,
      debugPresentationsBeforePlay,
    )
    assert.equal(
      harness.historicalDebugInvalidations(),
      debugInvalidationsBeforePlay,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the recorded image and Run and Debug staying as they are while Play passes the saved time of an explanation inside the stop's recorded pause, where only its saved-while-held note leaves; fails_when=the note's change re-presents the stop, or the Study pane keeps the note after the explanation's saved time; why_new=Cycle 0045 FXU: native check F18 crossed such a time (152.78 s, inside the pause 144.11 to 153.24 s); seam=duringStop saves the explanation at 500 ms of the recording, and the test counts the recording viewport's image presentations and clears
test('Play across an explanation’s saved time inside the stop’s recorded pause keeps the image and Run and Debug until the pause ends, and the Study pane drops the saved-while-held note at that time', async () => {
  // Arrange: a stop with recorded debugger state committed at 100 ms and paused until 900 ms of a film that ended at 1,000 ms; the agent explained it at 500 ms.
  const harness = await recordedReaderHarness(
    true,
    true,
    1,
    async (stopped) => {
      const { service } = stopped,
        record = [...service.records.values()][0]!
      stopped.clock(500)
      await service.explain({
        instanceId: service.instanceId,
        runId: record.id,
        snapshotUri: service.state(record).observations[0]!.snapshotUri,
        sourceHash: stopped.runtimes[0]!.snapshots[0]!.source.hash,
        valuePaths: ['value:nextTheme'],
        key: 'explanation',
        interpretation: 'This stop holds the dark theme before it is applied.',
      })
    },
  )
  try {
    const { service, record, controller, studyId } = harness
    await readerSeams(harness).refresh()
    await waitUntil(
      () =>
        service.state(record).historyOutcome.status === 'saved' &&
        service.state(record).recording.contextStatus === 'saved',
      'the explanation saved with the recording context',
      2_000,
    )
    await harness.reader.openRecording(studyId)
    await controller.settle()
    controller.command({
      action: 'seek',
      studyId,
      expectedRevision: controller.state().revision,
      positionMs: 100,
    })
    await controller.settle()
    const atStop = harness.postedMessages().slice(-1)[0]!
    const viewport = harness.viewportInstances.find(
      (instance) => instance.mode === 'recording',
    )!
    const imagePresentedAtMs: Array<number | undefined> = [],
      imageClearedAtMs: Array<number | undefined> = []
    const presentImage = viewport.present.bind(viewport),
      clearImage = viewport.clearRecorded.bind(viewport)
    viewport.present = async (image: string): Promise<void> => {
      imagePresentedAtMs.push(controller.state().requestedMs)
      await presentImage(image)
    }
    viewport.clearRecorded = (): void => {
      imageClearedAtMs.push(controller.state().requestedMs)
      clearImage()
    }
    const debugPresentationsAtStop = harness.historicalDebugPresentations.length

    // Act: Play runs from the stop to the end of the recording.
    controller.command({
      action: 'play',
      studyId,
      expectedRevision: controller.state().revision,
    })
    await waitUntil(
      () =>
        controller.state().mode === 'paused' &&
        controller.state().presentedMs === 1_000,
      'Play reaches the end of the recording',
      5_000,
    )
    await controller.settle()

    // Assert
    const shownAt = (positionMs: number) =>
      harness
        .postedMessages()
        .findLast((message) => message.recording?.presentedMs === positionMs)
        ?.model.observation?.interpretations.map(
          (interpretation: ShownInterpretation) => [
            interpretation.text,
            interpretation.savedLater,
          ],
        )
    assert.deepEqual(
      atStop.model.observation?.interpretations.map(
        (interpretation: ShownInterpretation) => [
          interpretation.text,
          interpretation.savedLater,
        ],
      ),
      [
        [
          'This stop holds the dark theme before it is applied.',
          'while-pause-held',
        ],
      ],
    )
    assert.deepEqual(shownAt(500), [
      ['This stop holds the dark theme before it is applied.', undefined],
    ])
    assert.deepEqual(imagePresentedAtMs, [900])
    assert.deepEqual(imageClearedAtMs, [])
    assert.deepEqual(
      harness.historicalDebugPresentations
        .slice(debugPresentationsAtStop)
        .map((presentation) => presentation.label),
      ['Not recorded at this moment'],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the recorded application image staying on screen when Play reaches the end of a stop's recorded pause on the same frame, while Run and Debug, the stop's native session and its source highlight end there; fails_when=the pause end clears the Application pane to "Loading recorded position…" (native check F18: 17 to 35 dark frames at 153.24, 168.80 and 183.56 s), or the stop's values or highlight stay after the recording says the application continued; why_new=Cycle 0045 NF-13c; seam=the test counts the recording viewport's image presentations and clears and the fake historical debugger's retirements
test('Play across the end of a stop’s recorded pause on the same frame keeps the recorded image while Run and Debug, the stop’s session and its source highlight end', async () => {
  // Arrange: a stop with recorded debugger state committed at 100 ms and paused until 900 ms of a film that ended at 1,000 ms, with no new frame after the stop.
  const harness = await recordedReaderHarness(true, true)
  try {
    const { controller, studyId, png } = harness
    await harness.reader.openRecording(studyId)
    await controller.settle()
    controller.command({
      action: 'seek',
      studyId,
      expectedRevision: controller.state().revision,
      positionMs: 100,
    })
    await controller.settle()
    const atStop = harness.postedMessages().slice(-1)[0]!
    const imageAtStop = harness.displayedImage()
    const viewport = harness.viewportInstances.find(
      (instance) => instance.mode === 'recording',
    )!
    const imagePresentedAtMs: Array<number | undefined> = [],
      imageClearedAtMs: Array<number | undefined> = [],
      retiredAtMs: Array<[number | undefined, boolean]> = []
    const presentImage = viewport.present.bind(viewport),
      clearImage = viewport.clearRecorded.bind(viewport)
    viewport.present = async (image: string): Promise<void> => {
      imagePresentedAtMs.push(controller.state().requestedMs)
      await presentImage(image)
    }
    viewport.clearRecorded = (): void => {
      imageClearedAtMs.push(controller.state().requestedMs)
      clearImage()
    }
    const historicalDebugger = harness.historicalDebuggers[0]!,
      retire = historicalDebugger.retire.bind(historicalDebugger)
    historicalDebugger.retire = async (snapshot, signal): Promise<void> => {
      retiredAtMs.push([controller.state().requestedMs, Boolean(snapshot)])
      await retire(snapshot, signal)
    }
    const debugPresentationsAtStop =
        harness.historicalDebugPresentations.length,
      debugInvalidationsAtStop = harness.historicalDebugInvalidations(),
      highlightsAtStop = harness.decoratedRangeCounts().length

    // Act: Play runs from the stop to the end of the recording.
    controller.command({
      action: 'play',
      studyId,
      expectedRevision: controller.state().revision,
    })
    await waitUntil(
      () =>
        controller.state().mode === 'paused' &&
        controller.state().presentedMs === 1_000,
      'Play reaches the end of the recording',
      5_000,
    )
    await controller.settle()

    // Assert
    const atEnd = harness.postedMessages().slice(-1)[0]!
    assert.equal(atStop.model.observation?.id, 'browser-session:1')
    assert.equal(imageAtStop, png.toString('base64'))
    assert.equal(atEnd.model.observation, undefined)
    assert.deepEqual(imagePresentedAtMs, [900])
    assert.deepEqual(imageClearedAtMs, [])
    assert.equal(harness.displayedImage(), png.toString('base64'))
    assert.deepEqual(retiredAtMs, [[900, false]])
    assert.equal(
      harness.historicalDebugInvalidations() - debugInvalidationsAtStop,
      1,
    )
    assert.deepEqual(
      harness.historicalDebugPresentations
        .slice(debugPresentationsAtStop)
        .map((presentation) => [
          presentation.label,
          Boolean(presentation.snapshot),
        ]),
      [['Not recorded at this moment', false]],
    )
    // The pause end clears the stop's line in both visible captured-source editors of the harness and marks no line again.
    assert.deepEqual(
      harness.decoratedRangeCounts().slice(highlightsAtStop),
      [0, 0],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the recorded application image staying painted when Play reaches the end of a stop's recorded pause and the application has already sent a newer frame, until that frame replaces it, while Run and Debug, the stop's native session and its source highlight end there; fails_when=the pause end clears the Application pane because the next moment's frame differs (native check F18 on candidate 20: 0.6 s dark at 153.19 and 183.46 s, where the next frame arrived 49 and 14 ms after the pause ended), or the stop's values or highlight stay; why_new=Cycle 0045 NF-13d; seam=duringStop records a newer frame at the 900 ms continuation, and the test reads the displayed image when the newer frame is sent
test('Play across the end of a stop’s recorded pause onto a newer frame keeps the stop’s image painted until the newer frame replaces it, while Run and Debug, the stop’s session and its source highlight end', async () => {
  // Arrange: a stop with recorded debugger state committed at 100 ms and paused until 900 ms of a film that ended at 1,000 ms; the application sent a new frame at 900 ms.
  const newerPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
    'base64',
  )
  const harness = await recordedReaderHarness(
    true,
    true,
    1,
    async (stopped) => {
      const recording = [...stopped.service.records.values()][0]!.recording!
      recording.frame({ bytes: newerPng, elapsedMs: 900, kind: 'stream' })
    },
  )
  try {
    const { controller, studyId, png } = harness
    await harness.reader.openRecording(studyId)
    await controller.settle()
    controller.command({
      action: 'seek',
      studyId,
      expectedRevision: controller.state().revision,
      positionMs: 100,
    })
    await controller.settle()
    const imageAtStop = harness.displayedImage()
    const viewport = harness.viewportInstances.find(
      (instance) => instance.mode === 'recording',
    )!
    const imagePresentations: Array<{
        atMs: number | undefined
        shownBefore: string | undefined
        sent: string
      }> = [],
      imageClearedAtMs: Array<number | undefined> = [],
      retiredAtMs: Array<[number | undefined, boolean]> = []
    const presentImage = viewport.present.bind(viewport),
      clearImage = viewport.clearRecorded.bind(viewport)
    viewport.present = async (image: string): Promise<void> => {
      imagePresentations.push({
        atMs: controller.state().requestedMs,
        shownBefore: harness.displayedImage(),
        sent: image,
      })
      await presentImage(image)
    }
    viewport.clearRecorded = (): void => {
      imageClearedAtMs.push(controller.state().requestedMs)
      clearImage()
    }
    const historicalDebugger = harness.historicalDebuggers[0]!,
      retire = historicalDebugger.retire.bind(historicalDebugger)
    historicalDebugger.retire = async (snapshot, signal): Promise<void> => {
      retiredAtMs.push([controller.state().requestedMs, Boolean(snapshot)])
      await retire(snapshot, signal)
    }
    const debugInvalidationsAtStop = harness.historicalDebugInvalidations(),
      highlightsAtStop = harness.decoratedRangeCounts().length

    // Act: Play runs from the stop to the end of the recording.
    controller.command({
      action: 'play',
      studyId,
      expectedRevision: controller.state().revision,
    })
    await waitUntil(
      () =>
        controller.state().mode === 'paused' &&
        controller.state().presentedMs === 1_000,
      'Play reaches the end of the recording',
      5_000,
    )
    await controller.settle()

    // Assert
    assert.equal(imageAtStop, png.toString('base64'))
    assert.deepEqual(imagePresentations, [
      {
        atMs: 900,
        shownBefore: png.toString('base64'),
        sent: newerPng.toString('base64'),
      },
    ])
    assert.deepEqual(imageClearedAtMs, [])
    assert.equal(harness.displayedImage(), newerPng.toString('base64'))
    assert.deepEqual(retiredAtMs, [[900, false]])
    assert.equal(
      harness.historicalDebugInvalidations() - debugInvalidationsAtStop,
      1,
    )
    // The pause end clears the stop's line in both visible captured-source editors of the harness and marks no line again.
    assert.deepEqual(
      harness.decoratedRangeCounts().slice(highlightsAtStop),
      [0, 0],
    )
  } finally {
    await harness.close()
  }
})

for (const failure of ['corrupt', 'future', 'missing'] as const)
  test(`a ${failure} configured recording keeps the real article return pose, learner ledger and input count intact`, async () => {
    // Arrange
    const harness = await configuredWorkspaceHarness()
    try {
      const record = await harness.start()
      await harness.reader.action('click')
      await harness.reader.understand(true)
      await harness.reader.action('stop')
      const study = await harness.library.readStudy(
          `${harness.service.instanceId}_${record.id}`,
        ),
        observation = study.observations[0]!
      const binding: BookObservationBinding = {
        nodeId: 'theme',
        linkIndex: 0,
        studyId: study.id,
        observationId: observation.id,
        sourceHash: observation.source.hash,
        itemId: observation.itemId,
        observationHash: bookObservationHash(observation),
        elapsedMs: observation.elapsedMs,
        outcome: study.finalOutcome,
      }
      const origin = {
        bookId: 'interface',
        revision: 1,
        nodeId: 'theme',
        anchorIndex: 1,
        location: { sectionIndex: 2, fraction: 0.75, focusId: 'section-2' },
      }
      await harness.reader.openRepositoryEvidence(
        binding,
        false,
        undefined,
        origin,
      )
      const ledger = JSON.stringify(
          (await harness.library.readProgress()).decisions,
        ),
        store = new RecordingStore(
          harness.library.directory,
          harness.library.workspaceKey,
        )
      const path = join(store.path(study.id, 2), 'header.json'),
        header = await readFile(path)
      // Act
      if (failure === 'missing') await unlink(path)
      else
        await writeFile(
          path,
          failure === 'corrupt'
            ? '{broken'
            : JSON.stringify({ ...JSON.parse(header.toString()), version: 99 }),
        )
      await harness.reader.openRecording(study.id)
      await harness.service.playbackController!.settle()
      const failed = harness.reader.inspect().view!
      await harness.reader.action('return-wiki')
      // Assert
      assert.equal(failed.recording?.readiness, 'failed')
      assert.equal(failed.repositoryReturnAvailable, true)
      assert.equal(failed.model.continueArguments, undefined)
      assert.equal(
        JSON.stringify(harness.articleReturns),
        JSON.stringify([origin]),
      )
      assert.equal(
        JSON.stringify((await harness.library.readProgress()).decisions),
        ledger,
      )
      assert.equal(harness.configuredRuntimes[0]!.dispatches, 1)
      assert.equal(harness.service.playbackController!.state().mode, 'paused')
      if (failure !== 'missing')
        assert.equal(
          await readFile(path, 'utf8'),
          failure === 'corrupt'
            ? '{broken'
            : JSON.stringify({ ...JSON.parse(header.toString()), version: 99 }),
        )
      await writeFile(path, header)
    } finally {
      await harness.close()
    }
  })

// Value: protects=a reopened reader never pointing at Run and Debug values from the native session that closing disposed; fails_when=closing keeps the replay moment's hint, which the reopened reader shows for the retained moment; why_new=Cycle 0032 T2, the close reset had no replay test; seam=none
test('a reader reopened after closing never shows the Run and Debug hint of the replay moment it showed before', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  let release = (): void => {}
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
    const beforeClose = harness.postedMessages().slice(-1)[0]!

    // Act: observe the reopened reader while its new session is still presenting the retained moment.
    await harness.reader.close()
    const presenting = harness.holdHistoricalDebugPresentation()
    release = presenting.release
    const reopening = harness.reader.open()
    await presenting.started
    const whilePresenting = harness.postedMessages().slice(-1)[0]!
    presenting.release()
    await reopening
    await harness.controller.settle()

    // Assert
    assert.equal(beforeClose.recording?.nativeValuesUninspected, true)
    assert.equal(whilePresenting.recording?.presentedMs, 100)
    assert.equal(whilePresenting.recording?.nativeValuesUninspected, false)
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=the reader showing why native values did not update, then dropping that stale error once a notification is handled; fails_when=the failed callback stops reaching report, or the 'replay-debugger' error is never cleared; why_new=Cycle 0033 M1 (d) and S7 failed→report wiring; seam=none
test('a native values notification the reader failed to handle is shown, and the next handled notification clears it', async () => {
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

    // Act
    harness.failHistoricalDebugNotification(new Error('Reader update failed'))
    const afterFailure = harness.postedMessages().slice(-1)[0]!
    harness.loadHistoricalDebugValues()
    const afterValuesLoaded = harness.postedMessages().slice(-1)[0]!

    // Assert
    assert.ok(afterFailure.errors.includes('Error: Reader update failed'))
    assert.equal(
      afterValuesLoaded.errors.includes('Error: Reader update failed'),
      false,
    )
    assert.equal(afterValuesLoaded.recording?.nativeValuesUninspected, false)
  } finally {
    await harness.close()
  }
})

// Value: protects=the first Recording open from flashing a recovery instruction while the reader itself is still placing the captured source; fails_when=presentationState reports "not ready in its native pane" during the reader's own pending presentation; why_new=Cycle 0044 (0034-H1); seam=none
test('opening a recording never tells the learner the captured source is not ready while its own first frame is still presenting', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.open()
    const publishedBefore = harness.postedMessages().length

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    const reasons = harness
      .postedMessages()
      .slice(publishedBefore)
      .map((message) => message.presentation?.reason ?? '')
    assert.equal(
      reasons.some((reason) => reason.includes('not ready in its native pane')),
      false,
    )
    assert.equal(
      reasons.includes('The recorded source is opening in its native pane.'),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the 5 s paint bound for a settle that begins while a frame is already painting (Restore layout or an evidence navigation during a slow paint); fails_when=the bound is armed only for paints that begin after the settle started, so the wait runs to the 23 s ceiling; why_new=Cycle 0044 (0031-U7b / 0031-S3 / 0032-T6a / 0033-PA3 / 0033-S7a / 0034-T5: no test reached that arm); seam=node:test setTimeout mock and the reader's settleOwnedPlayback
test('a replay settle that starts while a frame is already painting fails 5 s after that paint began, not 5 s after the settle began', async (context) => {
  // Arrange: a learner seek whose frame has been painting for 3 s.
  const harness = await recordedReaderHarness(true)
  let releasePaint = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const stuckPaint = harness.holdNextImage()
    releasePaint = stuckPaint.release
    enableFakeClock(context)
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await advanceClockUntilSettled(context, stuckPaint.started, 2_000)
    await advanceClock(context, 3_000)

    // Act
    let outcome = 'still settling'
    void harness.reader['settleOwnedPlayback']().then(
      () => {
        outcome = 'settled'
      },
      (error: unknown) => {
        outcome =
          error instanceof Error && 'code' in error
            ? String(error.code)
            : String(error)
      },
    )
    await advanceClock(context, 1_750)
    const at4750msOfPainting = outcome
    await advanceClock(context, 750)
    const at5500msOfPainting = outcome

    // Assert
    assert.equal(at4750msOfPainting, 'still settling')
    assert.equal(at5500msOfPainting, 'PRESENTATION_UNAVAILABLE')
  } finally {
    resetFakeClock(context)
    releasePaint()
    await harness.close()
  }
})

// Value: protects=a newer navigation's own bounds when the frame it superseded is still waiting to paint (queued behind a native placement hold, which ignores cancellation); fails_when=the superseded frame's paint phase keeps counting, so a settle fails 5 s after that old paint began although the newer frame has not started painting; why_new=Cycle 0044 (0033-P1, Codex claim never probed); seam=the replay viewport's first present, replaced by one that never answers, and node:test setTimeout mock
test('a superseded frame that is still waiting to paint does not count against the newer frame, which settles once its own debugger wait and paint finish', async (context) => {
  // Arrange: frame A has been waiting to paint for 3 s behind a hold that ignores cancellation.
  const harness = await recordedReaderHarness(true, true)
  let releaseDebugger = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.reader['replayViewport']
    assert.ok(viewport)
    const present = viewport.present.bind(viewport)
    let paintsRequested = 0
    viewport.present = (image, label) => {
      paintsRequested++
      // Only frame A's paint never answers; later frames paint normally.
      return paintsRequested === 1
        ? new Promise(() => {})
        : present(image, label)
    }
    enableFakeClock(context)
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await advanceClockUntil(context, () => paintsRequested === 1, 2_000)
    await advanceClock(context, 3_000)
    const slowDebugger = harness.holdHistoricalDebugPresentation()
    releaseDebugger = slowDebugger.release

    // Act: the learner seeks again; frame B's native debugger takes 2.5 s, so A's paint would be 5.5 s old.
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 500,
    })
    await advanceClockUntilSettled(context, slowDebugger.started, 2_000)
    let outcome = 'still settling'
    const settling = harness.reader['settleOwnedPlayback']().then(
      () => {
        outcome = 'settled'
      },
      (error: unknown) => {
        outcome =
          error instanceof Error && 'code' in error
            ? String(error.code)
            : String(error)
      },
    )
    await advanceClock(context, 2_500)
    const whileNewerFrameWaitsForDebugger = outcome
    slowDebugger.release()
    await advanceClockUntilSettled(context, settling, 2_000)

    // Assert
    assert.equal(whileNewerFrameWaitsForDebugger, 'still settling')
    assert.equal(outcome, 'settled')
    assert.equal(harness.controller.state().presentedMs, 500)
  } finally {
    resetFakeClock(context)
    releaseDebugger()
    await harness.close()
  }
})

// Value: protects=the decided replay behaviour of "Open article" (learning-replay.md: a replay may link to repository documentation, and stays independent of it); fails_when=the link is withdrawn during replay, or opening the article leaves, reloads or moves the replay; why_new=Cycle 0044 (0033-L2: the behaviour was never decided); seam=the reader's openArticle control, recorded by the harness
test('Open article stays offered during replay and opens the article without leaving or moving the replay', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
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
    const replayBefore = harness.controller.state()
    const offered = harness.reader.inspect().view!.repositoryArticleAvailable

    // Act
    await harness.reader.action('open-article')

    // Assert
    assert.equal(offered, true)
    assert.equal(harness.articleOpens.length, 1)
    assert.deepEqual(harness.controller.state(), replayBefore)
    assert.equal(harness.reader.inspect().view!.recording?.presentedMs, 100)
  } finally {
    await harness.close()
  }
})

// Value: protects=the recording renderer handshake after abandoned reveals; fails_when=the pending reveal is cleared before it completes, so after two aborted reveals a later presentation gets the viewport without its handshake; why_new=Cycle 0044 (0034-C4); seam=the reused recording viewport's reveal, replaced to observe each handshake
test('after two abandoned recording reveals the next presentation still waits for the renderer handshake', async () => {
  // Arrange: a reused recording viewport whose reveal is still owed, and a reveal that finishes only after its caller left.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const viewport = harness.reader['replayViewport']
    assert.ok(viewport)
    const handshakes: string[] = []
    viewport.reveal = async (signal?: AbortSignal): Promise<void> => {
      await new Promise<void>((resolve) => setImmediate(resolve))
      signal?.throwIfAborted()
      handshakes.push('completed')
    }
    harness.reader['replayNeedsReveal'] = true
    const abandon = async (): Promise<string> => {
      const request = new AbortController()
      const revealing = harness.reader['ensureReplayViewport'](request.signal)
      request.abort(new Error('Superseded presentation'))
      return revealing.then(
        () => 'handed over',
        (error: unknown) => String(error),
      )
    }

    // Act
    const first = await abandon()
    const second = await abandon()
    await harness.reader['ensureReplayViewport'](new AbortController().signal)

    // Assert
    assert.equal(first, 'Error: Superseded presentation')
    assert.equal(second, 'Error: Superseded presentation')
    assert.deepEqual(handshakes, ['completed'])
  } finally {
    await harness.close()
  }
})

// Value: protects=the reader still telling the learner that the historical debugger failed to stop; fails_when=the disposal failure shares the notification key, so the next values-loaded notification silently clears it; why_new=Cycle 0044 (0034-PL2); seam=ReplayDebugger.dispose replaced on the live owner
test('a historical debugger that failed to stop stays reported after native values load', async () => {
  // Arrange: an opened recording whose historical debugger then fails to stop.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const owner = harness.reader['replayDebugger']
    assert.ok(owner)
    owner.dispose = async (): Promise<void> => {
      throw new Error('The historical debugger did not stop.')
    }
    await harness.reader['retireReplayDebugger'](owner)
    const afterFailure = harness.reader.inspect().view!.errors

    // Act
    harness.reader['replayDebuggerChanged']('values-loaded')

    // Assert
    const afterValuesLoaded = harness.reader.inspect().view!.errors
    assert.equal(
      afterFailure.includes('Error: The historical debugger did not stop.'),
      true,
    )
    assert.equal(
      afterValuesLoaded.includes(
        'Error: The historical debugger did not stop.',
      ),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the Study pane not offering Retry storage / refresh for a line that Retry cannot retire; fails_when=the line of a historical debugger that failed to stop counts as retryable, so the pane shows Retry and pressing it leaves the line; why_new=Cycle 0045 SM-9 (the kind was missing from the unretryable set, which was a list of free strings); seam=ReplayDebugger.dispose replaced on the live owner
test('a historical debugger that failed to stop is reported without offering Retry storage', async () => {
  // Arrange: an opened recording without another error line, whose historical debugger will fail to stop.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    readerSeams(harness).dropErrorOfKind('layout')
    const owner = harness.reader['replayDebugger']
    assert.ok(owner)
    owner.dispose = async (): Promise<void> => {
      throw new Error('The historical debugger did not stop.')
    }

    // Act
    await harness.reader['retireReplayDebugger'](owner)

    // Assert: the one line shown is one Retry cannot answer, which is what keeps the pane from offering Retry.
    const posted = harness.postedMessages().at(-1)!
    assert.deepEqual(
      [...posted.errors],
      ['Error: The historical debugger did not stop.'],
    )
    assert.equal(posted.unretryableErrorCount, 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=a stale "native values did not update" error leaving the reader once the debugger notifies again, even with no Run and Debug hint showing; fails_when=the reader is published only when a hint or a Node stop changes, so the cleared error stays on screen; why_new=Cycle 0034 T3 (the failureCleared publish had no test without a hint); seam=none
test('a handled native values notification clears an earlier notification failure while no Run and Debug hint is showing', async () => {
  // Arrange: native values are loaded, so no hint is showing, and one notification failed to be handled.
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
    harness.failHistoricalDebugNotification(new Error('Reader update failed'))
    const afterFailure = harness.postedMessages().slice(-1)[0]!
    const publishedBefore = harness.postedMessages().length

    // Act
    harness.loadHistoricalDebugValues()

    // Assert
    const afterHandled = harness.postedMessages().slice(-1)[0]!
    assert.equal(afterFailure.recording?.nativeValuesUninspected, false)
    assert.ok(afterFailure.errors.includes('Error: Reader update failed'))
    assert.equal(harness.postedMessages().length, publishedBefore + 1)
    assert.equal(
      afterHandled.errors.includes('Error: Reader update failed'),
      false,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=closing the reader while a recorded frame never paints, for example behind a hidden replay panel; fails_when=close() waits on the presentation loop without a bound, or the loop waits on a frame whose presentation was retired; why_new=Cycle 0033 L2/O2/O4 (the close settle had no bound); seam=none
test(
  'closing the reader while a recorded frame never paints still finishes',
  { timeout: 30_000 },
  async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    let release = (): void => {}
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      const neverPainted = harness.holdNextImage()
      release = neverPainted.release
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 100,
      })
      await neverPainted.started

      // Act
      let stillClosing: ReturnType<typeof setTimeout> | undefined
      const outcome = await Promise.race([
        harness.reader.close().then(
          () => 'closed',
          (error: unknown) => String(error),
        ),
        new Promise<string>((resolve) => {
          stillClosing = setTimeout(() => resolve('still closing'), 7_000)
        }),
      ]).finally(() => clearTimeout(stillClosing))

      // Assert
      assert.equal(outcome, 'closed')
    } finally {
      release()
      await harness.close()
    }
  },
)

// Value: protects=closing the reader while native Run and Debug never answers a recorded stop; fails_when=close() waits on the presentation loop without a bound while that loop waits on a debugger presentation that ignores its cancellation; why_new=Cycle 0033 O4 (the never-painting close test passes on b9c846b, so the close bound had no failing-first test); seam=none
test(
  'closing the reader while the native debugger never answers a recorded stop still finishes',
  { timeout: 30_000 },
  async () => {
    // Arrange
    const harness = await recordedReaderHarness(true, true)
    const stuckDebugger = harness.holdHistoricalDebugPresentation(true)
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 100,
      })
      await stuckDebugger.started

      // Act
      let stillClosing: ReturnType<typeof setTimeout> | undefined
      const outcome = await Promise.race([
        harness.reader.close().then(
          () => 'closed',
          (error: unknown) => String(error),
        ),
        new Promise<string>((resolve) => {
          stillClosing = setTimeout(() => resolve('still closing'), 7_000)
        }),
      ]).finally(() => clearTimeout(stillClosing))

      // Assert
      assert.equal(outcome, 'closed')
    } finally {
      stuckDebugger.release()
      await harness.close()
    }
  },
)

// Value: protects=the learner's replay position being stored before the reader finishes closing; fails_when=close() bounds the presentation wait and no longer waits for queued position saves; why_new=Cycle 0033 O4 split the close wait into a bounded frame wait plus saved(), and no close test holds a save; seam=none
test(
  'closing the reader waits for a replay position save that storage still holds',
  { timeout: 30_000 },
  async (context) => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    let releaseSave = (): void => {},
      saveEntered = (): void => {}
    const storageHeld = new Promise<void>((resolve) => {
        releaseSave = resolve
      }),
      saveStarted = new Promise<void>((resolve) => {
        saveEntered = resolve
      })
    const order: string[] = []
    try {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      const storePreference = RecordingStore.prototype.savePreference
      context.mock.method(
        RecordingStore.prototype,
        'savePreference',
        async function heldSave(
          this: RecordingStore,
          preference: Parameters<RecordingStore['savePreference']>[0],
        ): Promise<void> {
          saveEntered()
          await storageHeld
          await storePreference.call(this, preference)
          order.push(`saved ${preference.positionMs}`)
        },
      )
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 100,
      })
      await saveStarted

      // Act
      enableFakeClock(context)
      const closing = harness.reader.close().then(() => {
        order.push('closed')
      })
      await advanceClock(context, 2_000)
      const whileStorageHeld = [...order]
      releaseSave()
      await advanceClockUntilSettled(context, closing, 2_000)
      await closing
      resetFakeClock(context)

      // Assert: the seek's save and the one close() queues when it hides the frame both finish before the reader is closed.
      assert.deepEqual(whileStorageHeld, [])
      assert.deepEqual(order, ['saved 100', 'saved 100', 'closed'])
    } finally {
      releaseSave()
      await harness.close()
    }
  },
)

// Value: protects=the explicit reopen the reader asks for after the historical session ended; fails_when=pressing Recording on a displayed replay returns the loaded state and leaves the stopped debugger in place; why_new=Cycle 0034 O5 (no test opened a recording after its session ended); seam=TestReplayDebugger models the ended session
test('pressing Recording after the historical session ended presents the saved moment again through a new session', async () => {
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
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const presentationsWhileSessionLives =
      harness.historicalDebugPresentations.length
    harness.endHistoricalDebugSession()

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    const view = harness.postedMessages().slice(-1)[0]!
    assert.equal(harness.historicalDebuggers.length, 2)
    assert.equal(harness.historicalDebuggers[1]!.available, true)
    assert.equal(view.recording?.presentedMs, 100)
    assert.equal(view.recording?.readiness, 'ready')
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsWhileSessionLives + 1,
    )
    // With no live run on the panel the displayed recording renderer is kept, so the frame does not reload.
    assert.equal(
      harness.viewportInstances.filter(
        (viewport) => viewport.mode === 'recording',
      ).length,
      1,
    )
    assert.equal(
      view.errors.some((error) => error.includes('Historical debugger closed')),
      false,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a second explicit open while the editor is still stopping the replaced historical debugger; fails_when=the replacement clears its owner before the disposal ends, so the newer open registers a second descriptor factory for the debug type; why_new=Cycle 0034 O1 (the harness never rejected a second live registration); seam=TestReplayDebugger models the one-factory rule and a held disposal
test('another explicit open while the editor is still stopping the replaced historical debugger waits for it and then presents', async (context) => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  let releaseDisposal = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.endHistoricalDebugSession()
    // A seek on the stopped debugger fails, so the next explicit open reloads the recording.
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const disposal = harness.holdHistoricalDebugDisposal()
    releaseDisposal = disposal.release
    await harness.reader.openRecording(harness.studyId)
    await disposal.started

    // Act: the learner pauses the stuck open and opens the recording again; 200 faked ms pass while the editor is still stopping.
    enableFakeClock(context)
    harness.controller.command({
      action: 'pause',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
    })
    await harness.reader.openRecording(harness.studyId)
    await advanceClockUntil(
      context,
      () => harness.controller.state().readiness !== 'loading',
      200,
    )
    const whileStopping = harness.controller.state()
    disposal.release()
    const committedAfterFakeMs = await advanceClockUntilSettled(
      context,
      harness.controller.settle(),
      250,
    )
    resetFakeClock(context)

    // Assert: the commit takes one 50 ms poll for the Context pane's receipt and no wait of its own.
    const view = harness.postedMessages().slice(-1)[0]!
    assert.equal(whileStopping.readiness, 'loading')
    assert.equal(committedAfterFakeMs, 50)
    assert.equal(view.recording?.readiness, 'ready')
    assert.equal(harness.historicalDebuggers.length, 2)
    assert.equal(harness.historicalDebuggers[1]!.available, true)
    assert.equal(
      view.errors.some((error) => error.includes('registered once')),
      false,
    )
  } finally {
    resetFakeClock(context)
    releaseDisposal()
    await harness.close()
  }
})

// Value: protects=a different recording opened while the editor is still stopping the replaced historical debugger; fails_when=the newer open registers a second descriptor factory during that disposal, or waits on a timer of its own before it commits once the stop is released; why_new=Cycle 0044 (0034-PA1: the O1 tests reopened only the same recording and never timed the commit); seam=TestReplayDebugger models the one-factory rule and a held disposal, and node:test setTimeout mock
test('a different recording opened while the editor is still stopping the replaced historical debugger commits as soon as the stop is released', async (context) => {
  // Arrange: two saved recordings; the first is open and its historical debugger ended.
  const harness = await recordedReaderHarness(true, true)
  let releaseDisposal = (): void => {}
  try {
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const otherRecord = [...harness.service.records.values()].at(-1)!
    await otherRecord.preparation
    assert.ok(otherRecord.recording)
    otherRecord.recording.frame({
      bytes: harness.png,
      elapsedMs: 20,
      kind: 'stream',
    })
    harness.clock(1_100)
    await harness.reader.action('click')
    harness.clock(1_200)
    await harness.reader.action('stop')
    const otherStudyId = otherRecord.recording.header.studyId
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.endHistoricalDebugSession()
    // A seek on the stopped debugger fails, so the next explicit open reloads the recording.
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const disposal = harness.holdHistoricalDebugDisposal()
    releaseDisposal = disposal.release
    await harness.reader.openRecording(harness.studyId)
    await disposal.started

    // Act: the learner pauses the stuck open and opens the other recording; 200 faked ms pass while the editor is still stopping.
    enableFakeClock(context)
    harness.controller.command({
      action: 'pause',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
    })
    await harness.reader.openRecording(otherStudyId)
    await advanceClockUntil(
      context,
      () => harness.controller.state().readiness !== 'loading',
      200,
    )
    const whileStopping = harness.controller.state()
    disposal.release()
    const committedAfterFakeMs = await advanceClockUntilSettled(
      context,
      harness.controller.settle(),
      250,
    )
    resetFakeClock(context)

    // Assert: the commit takes one 50 ms poll for the Context pane's receipt and no wait of its own.
    const view = harness.postedMessages().slice(-1)[0]!
    assert.equal(otherStudyId === harness.studyId, false)
    assert.equal(whileStopping.readiness, 'loading')
    assert.equal(committedAfterFakeMs, 50)
    assert.equal(view.recording?.readiness, 'ready')
    assert.equal(view.model.selection.studyId, otherStudyId)
    assert.equal(
      view.errors.some((error) => error.includes('registered once')),
      false,
    )
  } finally {
    resetFakeClock(context)
    releaseDisposal()
    await harness.close()
  }
})

// Value: protects=the reader closing only after a replaced historical debugger has been stopped; fails_when=close() awaits only the owner still held in its field, so a reopen registers a second descriptor factory during that disposal; why_new=Cycle 0034 O1 (plan review P5); seam=TestReplayDebugger models the one-factory rule and a held disposal
test('closing the reader waits for a replaced historical debugger that the editor is still stopping, and the next open presents', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  let releaseDisposal = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.endHistoricalDebugSession()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    const disposal = harness.holdHistoricalDebugDisposal()
    releaseDisposal = disposal.release
    await harness.reader.openRecording(harness.studyId)
    await disposal.started

    // Act
    let closed = false
    const closing = harness.reader.close().then(() => {
      closed = true
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
    const closedWhileStopping = closed
    disposal.release()
    await closing
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    const view = harness.postedMessages().slice(-1)[0]!
    assert.equal(closedWhileStopping, false)
    assert.equal(view.recording?.readiness, 'ready')
    assert.equal(harness.historicalDebuggers.length, 2)
    assert.equal(
      view.errors.some((error) => error.includes('registered once')),
      false,
    )
  } finally {
    releaseDisposal()
    await harness.close()
  }
})

// Value: protects=an agent's open of a recording whose reader the learner closed; fails_when=the same-study open re-reveals the committed frame without opening the reader; why_new=Cycle 0034 O4 (the playback route skips openRecording's closed-reader guard); seam=none
test('an agent opening the same recording after the reader closed opens the reader and presents the saved moment', async () => {
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
    await harness.reader.close()
    const openedAfterClose = harness.reader.inspect().opened

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert
    const state = harness.controller.state()
    assert.equal(openedAfterClose, false)
    assert.equal(harness.reader.inspect().opened, true)
    assert.equal(state.readiness, 'ready')
    assert.equal(state.presentedMs, 100)
    assert.equal(state.reason, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard when an agent opens a recording through codebook_playback while the Study workspace is closed and VS Code's chat view, in front of the secondary side bar, has the keyboard: the replay's Application group is placed without a focus, no file gets the keyboard, the Learning summary's container is not brought in front of the chat (VS Code would remove the chat's element with the keyboard inside, even with the focus kept), and the learner is told once where the summary waits; fails_when=the replay's preparation shows the learner's active file with the keyboard, or the summary's reveal replaces the chat in the secondary side bar, so the chat input loses the keyboard and the agent's answer is hidden without a word; why_new=Cycle 0046 row 613 (an agent's replay open: loadPlayback -> open) and the finding on the summary's reveal beside VS Code's chat (1.140.0 workbench.desktop.main.js 1639:157175, 1106:186495, 1106:190002); seam=recordedReaderHarness, the reader's close, useNativeLayout, focusMutableDraft, focusChatInSecondarySideBar (VS Code's chat view), the service's playback (the codebook_playback tool's handler), textDocumentShows, viewFocusCommands, keyboardInView and the information messages
test('an agent’s replay open while the chat view has the keyboard leaves the keyboard in the chat and keeps the Learning summary behind the chat with a word', async () => {
  // Arrange: a saved recording, the reader closed; the learner's actions.ts is the active editor of the first group, and the learner typed the request into VS Code's chat in the secondary side bar.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusChatInSecondarySideBar()
    const showsBefore = harness.textDocumentShows().length,
      viewFocusBefore = harness.viewFocusCommands.length

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: no document was shown with the keyboard, no view was brought to the front (the moments' view was not shown, row 621), and the chat view still has it; the sentence the editor's ambiguity calls for (row 614) says that a view keeps it, and the next one says where the replay's controls wait.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.deepEqual(harness.viewFocusCommands.slice(viewFocusBefore), [])
    assert.equal(harness.keyboardInView(), true)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
        'Codebook showed the replay an agent asked for without bringing its controls to the front, so a chat or a terminal there keeps its place and your keyboard. To play it, click Learning summary at the top of the secondary side bar (View: Toggle Secondary Side Bar Visibility shows the bar) or the codebook tab of the bottom panel (View: Toggle Panel Visibility shows the panel).',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own replay open after an agent's codebook_playback open was refused for a stale revision: it is the learner's open, so the learner's active file gets the keyboard back after the Application group's placement, the Learning summary comes to the front with the keyboard, and no agent sentence is told; fails_when=the refused open leaves its mark (StudyService.playback's catch does not forget it), so the learner's next open of the same study, which the controller gives the revision the mark names, enters as the agent's: the chat view keeps the keyboard, the summary stays behind it and the agent's two sentences are told (row 613); why_new=T2, Cycle 0046 /ship review: no test reached the forget of a refused agent open; seam=recordedReaderHarness, the reader's close, useNativeLayout, leaveEmptyGroup, focusMutableDraft, focusChatInSecondarySideBar, the service's playback (the codebook_playback tool's handler) with a stale expectedRevision, the reader's openRecording (the learner's open), textDocumentShows, viewFocusCommands, keyboardInView and the information messages
test('a learner’s replay open after an agent’s open was refused for a stale revision is the learner’s own: the learner’s file gets the keyboard back, the Learning summary comes to the front, and no agent sentence is told', async () => {
  // Arrange: a saved recording, the reader closed, actions.ts the active editor of the first group and the chat view with the keyboard; an agent's open names a revision the controller does not have and is refused.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusChatInSecondarySideBar()
    let refusal: unknown
    try {
      harness.service.playback({
        instanceId: harness.service.instanceId,
        studyId: harness.studyId,
        action: 'open',
        expectedRevision: harness.controller.state().revision + 5,
      })
    } catch (error) {
      refusal = error
    }
    const showsBefore = harness.textDocumentShows().length,
      viewFocusBefore = harness.viewFocusCommands.length,
      messagesBefore = harness.informationMessages.length

    // Act: the learner opens the same recording.
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    assert.deepEqual(
      {
        refusal: refusal instanceof StudyError ? refusal.code : refusal,
        shownWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus),
        viewFocus: harness.viewFocusCommands.slice(viewFocusBefore),
        keyboardInView: harness.keyboardInView(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal: 'STALE_PLAYBACK',
        shownWithKeyboard: [
          { name: 'actions.ts', viewColumn: 2, preserveFocus: false },
        ],
        viewFocus: [
          { command: 'codebook.observedMoments.focus', preserveFocus: false },
          { command: 'codebook.learningSummary.focus', preserveFocus: false },
        ],
        keyboardInView: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own reopen of a recording that an agent's codebook_playback open found already shown: the controller answered that open without a load, so the learner's later reopen, after the learner stopped the historical debugger session, is the learner's and brings the Learning summary to the front with the keyboard, telling no agent sentence; fails_when=the open answered without a load leaves its mark (StudyService.playback does not forget it when the controller's revision stays the expected one), so the reload the learner's reopen starts, which the controller gives the revision the mark names, enters as the agent's: the summary is focused without the keyboard (row 613); why_new=T2, Cycle 0046 /ship review: no test reached the forget of an agent open answered without a load; seam=recordedReaderHarness, useNativeLayout, leaveEmptyGroup, focusMutableDraft, the reader's openRecording (the learner's opens), the service's playback (the codebook_playback tool's handler) with the current revision, endHistoricalDebugSession (the learner's Stop on the historical session, after which an open reloads), viewFocusCommands and the information messages
test('a learner’s reopen of a recording an agent’s open found already shown is the learner’s own: the Learning summary comes to the front with the keyboard and no agent sentence is told', async () => {
  // Arrange: the learner opened a saved recording; an agent's open of the same recording is answered without a load; the learner then stops the historical debugger session, so the next open reloads the recording.
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const revisionBeforeAgent = harness.controller.state().revision
    const agentAnswer = harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: revisionBeforeAgent,
    })
    harness.endHistoricalDebugSession()
    await harness.controller.settle()
    const viewFocusBefore = harness.viewFocusCommands.length,
      messagesBefore = harness.informationMessages.length

    // Act: the learner opens the same recording again.
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert: the agent's open was answered at the revision it named, so it started no load.
    assert.deepEqual(
      {
        agentAnswerRevision: agentAnswer.revision - revisionBeforeAgent,
        readiness: harness.controller.state().readiness,
        viewFocus: harness.viewFocusCommands.slice(viewFocusBefore),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        agentAnswerRevision: 0,
        readiness: 'ready',
        viewFocus: [
          { command: 'codebook.learningSummary.focus', preserveFocus: false },
        ],
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard when an agent selects the Study workspace through codebook_presentation while a replay stays loaded behind the closed workspace and VS Code's chat view, in front of the secondary side bar, has the keyboard: the entry is an agent's (open with forAgent), so its Application preparation gives no file the keyboard and the Learning summary is not brought in front of the chat, and the learner is told where each is; fails_when=the selection's entry prepares as the learner's and gives the active file the keyboard, or the summary's reveal replaces the chat and its keyboard without a word; why_new=Cycle 0046 coverage of an agent's select into a replay (no test reached open's forAgent through a selection with a recording loaded); seam=recordedReaderHarness, openRecording and the reader's close, hideSummary (the learner brought the chat to the front again), useNativeLayout, focusMutableDraft, focusChatInSecondarySideBar (VS Code's chat view), the service's selectPresentation (the codebook_presentation handler), textDocumentShows, viewFocusCommands, keyboardInView and the information messages
test('an agent’s Study selection while a replay stays loaded and the chat view has the keyboard gives no file the keyboard and keeps the Learning summary behind the chat with a word', async () => {
  // Arrange: the learner opened a saved recording and closed the Study workspace, brought the chat to the front of the secondary side bar again, and typed the request there; actions.ts is the active editor of the first group.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.close()
    harness.hideSummary()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusChatInSecondarySideBar()
    const state = harness.reader.presentationState(),
      showsBefore = harness.textDocumentShows().length,
      viewFocusBefore = harness.viewFocusCommands.length,
      messagesBefore = harness.informationMessages.length

    // Act
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: no document was shown with the keyboard, only the moments' view, which the learner's own open had shown already, was focused again (without the keyboard, no container switch), the chat view still has the keyboard, and the two sentences say where the Application group and the replay's controls are.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.deepEqual(harness.viewFocusCommands.slice(viewFocusBefore), [
      { command: 'codebook.observedMoments.focus', preserveFocus: true },
    ])
    assert.equal(harness.keyboardInView(), true)
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
        'Codebook showed the replay an agent asked for without bringing its controls to the front, so a chat or a terminal there keeps its place and your keyboard. To play it, click Learning summary at the top of the secondary side bar (View: Toggle Secondary Side Bar Visibility shows the bar) or the codebook tab of the bottom panel (View: Toggle Panel Visibility shows the panel).',
      ],
    )
  } finally {
    await harness.close()
  }
})

for (const host of ['VS Code', 'Cursor'] as const)
  // Value: protects=the learner's knowledge of where the keyboard is when an agent's Study selection (codebook_presentation) reopens a replay an agent had opened earlier, while the learner's file has the keyboard without a fresh sign of the learner's hand: the Application's new group takes the keyboard from the editor area (VS Code 1.140.0 workbench.desktop.main.js 990:31740), and the arrangement's layout command gives it to the Application pane in front of that group (1106:112155 with 1106:112962, group focus 1106:74902, the webview editor's focus 705:66733; Cursor 3.23.12 17501:57509); row 613 gives an unproven file nothing back, so the selection tells once where the keyboard is, also when the preparation's own sentence was told for the earlier replay open; fails_when=the preparation's sentence, told once in the session already, is the only one the selection has, so the Application pane takes the learner's keyboard without a word (C57 2a: page focus BODY, then the Application pane's webview, no information message); why_new=Cycle 0046 row 640; seam=recordedReaderHarness, the service's playback (codebook_playback open) and the reader's close, useNativeLayout, leaveEmptyGroup, focusMutableDraft, Cursor's host name (its chat in the side bar, one editor part), the service's selectPresentation (codebook_presentation), focusedPanel and innerFocusedPanel (the fake editor gives the active group the keyboard after a layout command when the page body had it), textDocumentShows and the information messages
  test(`in ${host}, an agent’s Study selection that reopens a replay an agent opened earlier, while the learner’s file has the keyboard, says once that the Application pane has it`, async () => {
    // Arrange: an agent opened a saved recording while the learner worked in login-form.tsx in the first group, and the Study workspace was closed; the learner's file has the keyboard again, put there without a key press.
    const harness = await recordedReaderHarness(true, true)
    if (host === 'Cursor') harness.useHostAppName('Cursor')
    try {
      await harness.reader.close()
      harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
      harness.leaveEmptyGroup(1)
      harness.focusMutableDraft('login-form.tsx', 1)
      harness.service.playback({
        instanceId: harness.service.instanceId,
        studyId: harness.studyId,
        action: 'open',
        expectedRevision: harness.controller.state().revision,
      })
      await harness.controller.settle()
      await harness.reader.close()
      harness.focusMutableDraft('login-form.tsx', 1)
      const state = harness.reader.presentationState(),
        showsBefore = harness.textDocumentShows().length,
        messagesBefore = harness.informationMessages.length

      // Act
      const answer = await harness.service.selectPresentation({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      await harness.controller.settle()

      // Assert: the replay's arrangement is confirmed, the Application pane has the keyboard, no file was shown with it, and the sentence says once where it is.
      assert.deepEqual(
        {
          layoutConfirmed: answer.layoutConfirmed,
          contentTab: answer.reader.contentTab,
          activePane: harness.focusedPanel(),
          paneWithKeyboard: harness.innerFocusedPanel(),
          shownWithKeyboard: harness
            .textDocumentShows()
            .slice(showsBefore)
            .filter((shown) => !shown.preserveFocus)
            .map((shown) => shown.name),
          messages: harness.informationMessages
            .slice(messagesBefore)
            .map((message) => message.message),
        },
        {
          layoutConfirmed: true,
          contentTab: 'recording',
          activePane: 'codebook.scopedBrowser',
          paneWithKeyboard: 'codebook.scopedBrowser',
          shownWithKeyboard: [],
          messages: [
            'Codebook arranged the Study workspace an agent asked for with its Application pane in a new editor group. If you were typing in a file or another editor tab, the Application pane has the keyboard now: click where you want to type. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
          ],
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner's knowledge of where the keyboard is when an agent's Study selection (codebook_presentation) beside Cursor's Agent chat part reopens a replay an agent opened earlier while the learner's file had the keyboard: the main editor was then the active part, and Cursor reads its file the same while the terminal or a view has the keyboard (Cursor 3.23.12 workbench.desktop.main.js 17501:84373, 17501:88693), so row 612's rule of the only editor part holds: no unproven file gets the keyboard back, the Application pane keeps it, and the learner is told once; fails_when=the selection gives the learner's file its keyboard back and the replay's captured source then covers that file in its group with nothing told (the 640 fixer's reading of the model); why_new=Cycle 0046 row 656; seam=recordedReaderHarness, the service's playback (codebook_playback open) and the reader's close, useNativeLayout, addSeparateEditorPart (Cursor's chat part), leaveEmptyGroup, focusMutableDraft, the service's selectPresentation, the editor's active text editor and the first group's front tab, textDocumentShows and the information messages
test('in Cursor beside its chat part, an agent’s Study selection that reopens a replay an agent opened earlier while the learner’s file has the keyboard gives that file nothing back and says once that the Application pane has the keyboard', async () => {
  // Arrange: an agent opened a saved recording while the learner worked in login-form.tsx in the first group, and the Study workspace was closed; Cursor's Agent chat stands in its own editor part, and the learner's file has the keyboard again, put there without a key press.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.addSeparateEditorPart()
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    await harness.reader.close()
    harness.focusMutableDraft('login-form.tsx', 1)
    const state = harness.reader.presentationState(),
      showsBefore = harness.textDocumentShows().length,
      messagesBefore = harness.informationMessages.length

    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    await harness.controller.settle()

    // Assert: the replay's arrangement is confirmed, the Application pane in front of its new group has the keyboard, no learner file was shown with it, and the sentence says once where it is.
    assert.deepEqual(
      {
        layoutConfirmed: answer.layoutConfirmed,
        contentTab: answer.reader.contentTab,
        activePane: harness.focusedPanel(),
        paneWithKeyboard: harness.innerFocusedPanel(),
        shownWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus)
          .map((shown) => shown.name),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        layoutConfirmed: true,
        contentTab: 'recording',
        activePane: 'codebook.scopedBrowser',
        paneWithKeyboard: 'codebook.scopedBrowser',
        shownWithKeyboard: [],
        messages: [
          'Codebook arranged the Study workspace an agent asked for with its Application pane in a new editor group, and the Application pane has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard at an agent's cold Study selection that reopens a replay beside Cursor's Agent chat part while Cursor names the Repository Wiki's group: Cursor's Focus Agent gave the chat input the keyboard and changed no group, so the Wiki's tab stays the named one with its panel not active, and the selection gives the chat its keyboard back with Focus Agent and tells the arrangement's sentence once; fails_when=the Wiki's tab is taken for the place of the keyboard, the selection runs the numbered focus command of the Wiki's group (workbench.action.focusThirdEditorGroup here, the fourth in C59) and the chat gets nothing back, as in C59 c59-5-cu-cold, where the keyboard stayed outside the chat for 34.7 s (the same at the C58 build 465a6834, so no regression of rows 647 to 662: C58's round began with the chat's group named, C59's with the Wiki's); why_new=Cycle 0046 row 680; seam=recordedReaderHarness, the service's playback (codebook_playback open) and the reader's close, useNativeLayout, addSeparateEditorPart and its focus (Focus Agent), leavePaneFocusUnreportedBesideChat, focusExistingWebviewTab (the Wiki's tab named), the service's selectPresentation, the command log and the information messages
test('in Cursor, an agent’s cold Study selection that reopens a replay while the editor names the Repository Wiki’s group and the chat input has the keyboard gives the chat its keyboard back and says so once', async () => {
  // Arrange: an agent opened a saved recording and the Study workspace was closed; the learner read the Wiki last, so its group is the named one, and Focus Agent gave the chat input the keyboard without changing a group.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    await harness.reader.close()
    const wiki = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label === 'codebook · Repository Wiki')!
    harness.focusExistingWebviewTab(wiki)
    chat.focus()
    const namedBefore =
        harness.editor.window.tabGroups.activeTabGroup.activeTab?.label,
      state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length

    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    await harness.controller.settle()

    // Assert: the replay is arranged, Focus Agent gave the chat its keyboard back last, no numbered focus ran for the Wiki's group, and the sentence was told once.
    assert.deepEqual(
      {
        namedBefore,
        layoutConfirmed: answer.layoutConfirmed,
        contentTab: answer.reader.contentTab,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        namedBefore: 'codebook · Repository Wiki',
        layoutConfirmed: true,
        contentTab: 'recording',
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
        messages: [
          'Codebook placed its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard at an agent's Return Current right after its cold Study selection beside Cursor's Agent chat part (the five-stop flow's cold order): the selection gave the chat its keyboard back with Focus Agent, which changes no group, so the editor names the Application pane's tab with that pane not active, which is the chat's place for a request no pane's control made (row 628's rule for an agent's Restore); the Return gives the chat its keyboard back after its measurement took it through the captured source; fails_when=the agent's Return remembers no chat, its measurement shows the captured source with the keyboard and the chat gets nothing back, so the keyboard stays outside the chat until a pause (C59 c59-5-cu-cold: the captured source shown with preserveFocus false, then a numbered focus of the Wiki's group, 34.7 s outside the chat); why_new=Cycle 0046 row 680; seam=recordedReaderHarness, the service's playback, selectPresentation and returnToCurrent, useNativeLayout, addSeparateEditorPart and its focus (Focus Agent), leavePaneFocusUnreportedBesideChat, focusExistingWebviewTab, the command log, textDocumentShows and the information messages
test('in Cursor, an agent’s Return Current right after its cold Study selection from the chat gives the chat its keyboard back, also after its measurement showed the captured source with the keyboard', async () => {
  // Arrange: as above; the agent's cold selection gave the chat its keyboard back.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    await harness.reader.close()
    const wiki = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label === 'codebook · Repository Wiki')!
    harness.focusExistingWebviewTab(wiki)
    chat.focus()
    const state = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    await harness.controller.settle()
    const selected = harness.reader.presentationState(),
      chatAfterSelection = chat.focused(),
      commandsBefore = harness.commands.length,
      showsBefore = harness.textDocumentShows().length

    // Act
    const returned = await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: selected.presentationId,
      expectedRevision: selected.reader.contentRevision,
    })
    await harness.controller.settle()

    // Assert: the live panes are confirmed; the measurement showed the captured source with the keyboard, and Focus Agent gave the chat its keyboard back last, with no numbered group focus.
    assert.deepEqual(
      {
        chatAfterSelection,
        layoutConfirmed: returned.layoutConfirmed,
        contentTab: returned.reader.contentTab,
        shownWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus)
          .map((shown) => `${shown.name}@${shown.viewColumn}`),
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
      },
      {
        chatAfterSelection: true,
        layoutConfirmed: true,
        contentTab: 'live',
        shownWithKeyboard: ['Captured-theme.ts@2'],
        keyboardCommands: ['composer.focusComposer'],
        chatHasKeyboard: true,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=row 5's cold order beside Cursor's Agent chat part when the reader holds a saved replay (C61 c61-5-cu-cold): the agent's select reopens the replay and gives the chat its keyboard back; its Return Current leaves the replay for the live run, whose captured source opens quietly in place of the replay's, which closes, while the chat input has the keyboard, so Cursor names its chat part's group (rows 696 and 702); the measurement then borrows through the captured source (readMainEditorGrid's sourceBorrow, the Application pane in front of the first group), and the Return gives the chat its keyboard back with Focus Agent, the arrangement's sentence told once in the session, so the run that starts next finds the chat with the keyboard; fails_when=the give-back reads the chat part's group the editor names as a move of the keyboard away from where the measurement left it, so no Focus Agent runs and the captured source keeps the keyboard, which the Live entry's source view then drops to the page body (C61: 3,037 samples on BODY, every stop of the five-stop flow on BODY); why_new=Cycle 0046 row 711; seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus (the click into the chat input), leavePaneFocusUnreportedBesideChat, focusMutableDraft, focusExistingWebviewTab, the service's playback, selectPresentation and returnToCurrent, the command log, textDocumentShows and the information messages
test('in Cursor, an agent’s Return Current from the saved replay its cold select reopened gives the chat its keyboard back after borrowing through the captured source, while Cursor names its chat part’s group', async () => {
  // Arrange: the reader holds a saved replay, the learner's login-form.tsx is in front of the first group, and the learner clicked into the chat input; the agent's cold select reopened the replay and gave the chat its keyboard back.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    await harness.reader.close()
    const wiki = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label === 'codebook · Repository Wiki')!
    harness.focusExistingWebviewTab(wiki)
    chat.focus()
    const messagesBefore = harness.informationMessages.length
    const state = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    await harness.controller.settle()
    const selected = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      showsBefore = harness.textDocumentShows().length

    // Act
    const returned = await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: selected.presentationId,
      expectedRevision: selected.reader.contentRevision,
    })
    await harness.controller.settle()

    // Assert: the measurement borrowed through the captured source, Focus Agent ran last, and the arrangement's sentence was told once over the select and the Return.
    assert.deepEqual(
      {
        layoutConfirmed: returned.layoutConfirmed,
        contentTab: returned.reader.contentTab,
        shownWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus)
          .map((shown) => `${shown.name}@${shown.viewColumn}`),
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        arrangementSentences: harness.informationMessages
          .slice(messagesBefore)
          .filter(
            (message) =>
              message.message === CHAT_KEYBOARD_RETURNED_MESSAGES.arrangement,
          ).length,
      },
      {
        layoutConfirmed: true,
        contentTab: 'live',
        shownWithKeyboard: ['Captured-theme.ts@2'],
        keyboardCommands: ['composer.focusComposer'],
        chatHasKeyboard: true,
        arrangementSentences: 1,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard at an agent's Return Current from a replay beside Cursor's Agent chat part when the learner's file is in front of the first group, the Application pane behind it: the learner opened login-form.tsx there and clicked into the chat input, so the editor names that file's group with no active text editor; the Return shows the live captured source quietly in place of the replay's, which closes, while the chat input has the keyboard, so Cursor names its chat part's group (rows 696 and 702); the measurement then borrows the first group with workbench.action.focusFirstEditorGroup, after which Cursor reports login-form.tsx as the active text editor and keeps naming the chat part's group (row 673); the Return gives the chat its keyboard back with Focus Agent and tells the arrangement's sentence once, as after row 711's borrow through the captured source; fails_when=the give-back reads the chat part's group the editor names as a move of the keyboard away from the first group the measurement left it in (leftByMeasurement asked for the first column or the column named at the capture), so no Focus Agent runs and the learner's login-form.tsx keeps the keyboard the measurement gave it, untold; why_new=Cycle 0046 row 723; seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus (the click into the chat input), leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and returnToCurrent, the command log, textDocumentShows and the information messages
test('in Cursor, an agent’s Return Current from a replay while the learner’s file is in front of the first group gives the chat its keyboard back after borrowing the first group, while Cursor names its chat part’s group', async () => {
  // Arrange: an agent's replay open arranged the Study workspace; the learner opened login-form.tsx in front of the first group, over the Application pane, and clicked into the chat input.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const namedBefore = `${harness.editor.window.tabGroups.activeTabGroup.viewColumn}:${harness.editor.window.tabGroups.activeTabGroup.activeTab?.label}`,
      state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      showsBefore = harness.textDocumentShows().length,
      messagesBefore = harness.informationMessages.length

    // Act
    const returned = await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })
    await harness.controller.settle()

    // Assert: the measurement borrowed the first group while the chat part's group stayed the named one, Focus Agent ran last, and the arrangement's sentence was told once.
    assert.deepEqual(
      {
        namedBefore,
        layoutConfirmed: returned.layoutConfirmed,
        contentTab: returned.reader.contentTab,
        shownWithKeyboard: harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus)
          .map((shown) => `${shown.name}@${shown.viewColumn}`),
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        namedAfter:
          harness.editor.window.tabGroups.activeTabGroup.activeTab?.label,
        chatHasKeyboard: chat.focused(),
        arrangementSentences: harness.informationMessages
          .slice(messagesBefore)
          .filter(
            (message) =>
              message.message === CHAT_KEYBOARD_RETURNED_MESSAGES.arrangement,
          ).length,
      },
      {
        namedBefore: '1:login-form.tsx',
        layoutConfirmed: true,
        contentTab: 'live',
        shownWithKeyboard: [],
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        namedAfter: 'New Agent',
        chatHasKeyboard: true,
        arrangementSentences: 1,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer choice during an agent's Return Current from the saved replay beside Cursor's Agent chat part (row 711's order): right after the measurement showed the captured source with the keyboard, the learner opens a terminal in the editor area of the Wiki's group, and the editor goes on reporting the captured source as the active text editor (an editor that is no code editor leaves that report, rows 659 and 671); the terminal keeps the keyboard, and the chat gets none back; fails_when=namesAnotherEditorPartsTab takes any front tab that is no text tab and no webview for the chat's tab, so isCapturedSourceUnderAnotherPartsName reads the terminal's group as Cursor's chat part's group and Focus Agent gives the chat the keyboard over the learner's terminal; why_new=Cycle 0046 row 727 (both final reviews of 8ac142df..b5f8bf97, rows 711 and 723's test of the chat's tab); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft, focusExistingWebviewTab, the service's playback, selectPresentation and returnToCurrent, changeAfterNextSourceDisplay with focusEditorTerminal keeping the text editor report, the command log and the information messages
test('in Cursor, an agent’s Return Current from the saved replay leaves the keyboard in the terminal the learner opened in another group after the measurement showed the captured source, while the editor still reports that source', async () => {
  // Arrange: as in row 711's test; the agent's cold select reopened the replay and gave the chat its keyboard back. The learner will open a terminal in the Wiki's group (column 3) once the captured source has the keyboard.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    await harness.reader.close()
    const wiki = harness.groups
      .flatMap((group) => group.tabs)
      .find((tab) => tab.label === 'codebook · Repository Wiki')!
    harness.focusExistingWebviewTab(wiki)
    chat.focus()
    const state = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    await harness.controller.settle()
    const selected = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    /** Opens the learner's terminal at the first display after which the captured source is the active text editor. */
    const chooseTerminalOnceSourceHasKeyboard = (): void => {
      if (
        harness.editor.window.activeTextEditor?.document.uri.path.endsWith(
          '/Captured-theme.ts',
        )
      )
        harness.focusEditorTerminal(3, true)
      else
        harness.changeAfterNextSourceDisplay(
          chooseTerminalOnceSourceHasKeyboard,
        )
    }
    harness.changeAfterNextSourceDisplay(chooseTerminalOnceSourceHasKeyboard)

    // Act
    const returned = await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: selected.presentationId,
      expectedRevision: selected.reader.contentRevision,
    })
    await harness.controller.settle()

    // Assert: the live panes are confirmed; the terminal's group is named with the terminal in front, the captured source is still reported, no Focus Agent ran, the chat has no keyboard, and nothing was told.
    const named = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        layoutConfirmed: returned.layoutConfirmed,
        named: `${named.viewColumn}:${named.activeTab?.label}`,
        reportedTextEditor:
          harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        keyboardOnBody: harness.keyboardOnBody(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        layoutConfirmed: true,
        named: '3:bash',
        reportedTextEditor: 'Captured-theme.ts',
        keyboardCommands: [],
        chatHasKeyboard: false,
        keyboardOnBody: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer choice during an agent's Return Current from a replay beside Cursor's Agent chat part (row 723's order): right after the measurement borrowed the first group with workbench.action.focusFirstEditorGroup, the learner opens a terminal in the editor area of the Wiki's group, and the editor goes on reporting login-form.tsx, the first group's file the borrow focused (an editor that is no code editor leaves that report, rows 659 and 671); the Return is refused for the learner's change, the terminal keeps the keyboard, and the chat gets none back; fails_when=namesAnotherEditorPartsTab takes any front tab that is no text tab and no webview for the chat's tab, so isFirstGroupEditorUnderAnotherPartsName reads the terminal's group as Cursor's chat part's group, the borrow counts as left where the measurement left it, and Focus Agent gives the chat the keyboard over the learner's terminal; why_new=Cycle 0046 row 727 (both final reviews of 8ac142df..b5f8bf97); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and returnToCurrent, holdNextCommand on workbench.action.focusFirstEditorGroup and on the layout read after it, focusEditorTerminal keeping the text editor report, the command log and the information messages
test('in Cursor, an agent’s Return Current from a replay leaves the keyboard in the terminal the learner opened in another group after the borrow of the first group, while the editor still reports the first group’s file', async () => {
  // Arrange: as in row 723's test; the learner will open a terminal in the Wiki's group (column 3) right after the measurement's borrow of the first group.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        harness.focusEditorTerminal(3, true)
        readAfterBorrow.release()
      })
      borrow.release()
    })

    // Act
    const refusal = await harness.service
      .returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await harness.controller.settle()

    // Assert: refused for the learner's change; the terminal's group is named with the terminal in front, login-form.tsx is still reported, no Focus Agent ran after the borrow, the chat has no keyboard, and nothing was told.
    const named = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        refusal,
        named: `${named.viewColumn}:${named.activeTab?.label}`,
        reportedTextEditor:
          harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        keyboardOnBody: harness.keyboardOnBody(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal:
          'Error: Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.',
        named: '3:bash',
        reportedTextEditor: 'login-form.tsx',
        keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
        chatHasKeyboard: false,
        keyboardOnBody: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer place during an agent's Return Current from a replay beside Cursor's Agent chat part (row 723's order): after the measurement borrowed the first group and the editor applied the Study layout, while it answers the arrangement's receipt read, the learner opens a new empty group right of the main editor's last group (workbench.action.newGroupRight), which the editor names with no active tab and no active text editor; the Return answers, the empty group keeps the keyboard as the learner's place and is not taken for the chat's tab, the chat gets none back and nothing is told; fails_when=namesAnotherEditorPartsTab asks of the named group's front tab without its guard for a group that has none, so the chat return (the function retainForeignTabFocus answers, from finishCurrentReturn) breaks on the empty group and the agent's Return answers with "TypeError: Cannot destructure property 'input' of 'undefined' …"; why_new=Cycle 0046 row 727 (the coverage audit of /ship: the guard active.activeTab !== undefined had no test; the read right after the borrow is no such order, since the arrangement's own guard refuses the Return there before the chat return is asked); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and returnToCurrent, holdNextCommand on the layout's runCommands and on the receipt read after it, focusEmptyGroup (the new seam), the command log and the information messages; no_claim=what Cursor does with the keyboard of a learner's new empty group beyond root's probe (named in its own column, no tab, no active text editor, the page focus in the group's container), and whether the layout the Return applied is confirmed
test('in Cursor, an agent’s Return Current from a replay leaves the keyboard in the empty group the learner opened while the arrangement’s receipt was read, and the chat gets none back', async () => {
  // Arrange: as in row 723's test; after the editor applied the Study layout, while it answers the receipt read, the learner opens a new empty group right of the main editor's last group.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const layoutCommands = harness.holdNextCommand('runCommands')
    void layoutCommands.started.then(() => {
      const receiptRead = harness.holdNextCommand('vscode.getEditorLayout')
      void receiptRead.started.then(() => {
        harness.focusEmptyGroup(4)
        receiptRead.release()
      })
      layoutCommands.release()
    })

    // Act
    const refusal = await harness.service
      .returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await harness.controller.settle()

    // Assert: the Return answered; the empty group is named with no tab in front and no text editor is active, only the borrow's focus command ran, the chat has no keyboard, and nothing was told.
    const named = harness.editor.window.tabGroups.activeTabGroup
    assert.deepEqual(
      {
        refusal,
        named: `${named.viewColumn}:${named.tabs.length}:${named.activeTab?.label}`,
        activeTextEditor: harness.editor.window.activeTextEditor,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal: undefined,
        named: '4:0:undefined',
        activeTextEditor: undefined,
        keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
        chatHasKeyboard: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

for (const host of ['VS Code', 'Cursor'] as const)
  // Value: protects=the fidelity of the workspace harness's new empty group, on which the tests of rows 714 and 727 with a learner's empty group rest: from the moment the editor tells its group and tab listeners, the new group is named in its own column right of the main editor's last group, shows no tab and no active tab, and no text editor is reported active, as root's probe of Cursor 3.23.12 saw after workbench.action.newGroupRight; fails_when=the fake names the new group only after its group event, keeps a tab in it, or keeps reporting the text editor that had the keyboard, so a reader test of a learner's empty group passes by another path; why_new=Cycle 0046 rows 714 and 727 (the coverage audit of /ship); seam=workspaceHarness's two columns, Cursor's chat part (addSeparateEditorPart, leavePaneFocusUnreportedBesideChat, which rebuilds the group objects), focusMutableDraft, the editor's onDidChangeTabs and onDidChangeTabGroups, focusEmptyGroup; no_claim=VS Code's own answer to newGroupRight, which the fake models the same way
  test(`the fake editor names the learner’s new empty group with no tab and reports no active text editor already while it tells its group and tab listeners (${host})`, async () => {
    // Arrange: auth.ts in the second group has the keyboard; a listener of groups and one of tabs read the named group and the active text editor.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    if (host === 'Cursor') {
      harness.addSeparateEditorPart()
      harness.leavePaneFocusUnreportedBesideChat()
    }
    try {
      harness.focusMutableDraft('auth.ts', 2)
      const readInListeners: string[] = []
      /** Names the named group's column, tab count and front tab, and the active text editor's file, as a listener reads them. */
      const readNamedGroup = (listener: string): void => {
        const named = harness.editor.window.tabGroups.activeTabGroup
        readInListeners.push(
          `${listener}:${named.viewColumn}:${named.tabs.length}:${named.activeTab?.label}:${harness.editor.window.activeTextEditor?.document.uri.path.split('/').at(-1)}`,
        )
      }
      const tabGroups = harness.editor.window.tabGroups.onDidChangeTabGroups(
          () => readNamedGroup('groups'),
        ),
        tabs = harness.editor.window.tabGroups.onDidChangeTabs(() =>
          readNamedGroup('tabs'),
        )

      // Act: the learner opens a new empty group right of the second group.
      harness.focusEmptyGroup(3)
      tabGroups.dispose()
      tabs.dispose()

      // Assert: every listener read the empty third group with no text editor, and so it stays after them, with the page focus in that group's container.
      const named = harness.editor.window.tabGroups.activeTabGroup
      assert.deepEqual(
        {
          readInListeners,
          namedAfter: `${named.viewColumn}:${named.tabs.length}:${named.activeTab?.label}`,
          activeTextEditorAfter: harness.editor.window.activeTextEditor,
          keyboardOnBody: harness.keyboardOnBody(),
        },
        {
          readInListeners: [
            'groups:3:0:undefined:undefined',
            'tabs:3:0:undefined:undefined',
          ],
          namedAfter: '3:0:undefined',
          activeTextEditorAfter: undefined,
          keyboardOnBody: true,
        },
      )
    } finally {
      await harness.close()
    }
  })

for (const host of ['VS Code', 'Cursor'] as const)
  // Value: protects=the fidelity of the workspace harness's terminal in the editor area that keeps the text editor report, on which row 727's tests rest: the text editor that had the keyboard stays reported as the active text editor from the moment the editor tells its tab and group listeners of the terminal, as focusWebviewTabKeepingTextEditorReport keeps it for a webview; fails_when=the fake sets the kept report only after it told the listeners, so a reader that reads the active text editor in them finds none and a test of the stale report passes by another path; why_new=Cycle 0046 row 733 (CodeRabbit on b5f8bf97..ec8a8ec3); seam=workspaceHarness's two columns, Cursor's chat part (addSeparateEditorPart, leavePaneFocusUnreportedBesideChat, which rebuilds the group objects), focusMutableDraft, the editor's onDidChangeTabs and onDidChangeTabGroups, focusEditorTerminal with keepsTextEditorReport
  test(`the fake editor reports the text editor that had the keyboard behind a terminal opened in the editor area already while it tells its tab and group listeners (${host})`, async () => {
    // Arrange: auth.ts in the second group has the keyboard; a listener of tabs and one of groups read the active text editor.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    if (host === 'Cursor') {
      harness.addSeparateEditorPart()
      harness.leavePaneFocusUnreportedBesideChat()
    }
    try {
      harness.focusMutableDraft('auth.ts', 2)
      const readInListeners: string[] = []
      /** Names the active text editor's file as a listener reads it. */
      const readActiveTextEditor = (listener: string): void => {
        readInListeners.push(
          `${listener}:${harness.editor.window.activeTextEditor?.document.uri.path.split('/').at(-1)}`,
        )
      }
      const tabs = harness.editor.window.tabGroups.onDidChangeTabs(() =>
          readActiveTextEditor('tabs'),
        ),
        tabGroups = harness.editor.window.tabGroups.onDidChangeTabGroups(() =>
          readActiveTextEditor('groups'),
        )

      // Act: the learner opens a terminal in the editor area of the first group; the editor keeps reporting auth.ts.
      harness.focusEditorTerminal(1, true)
      tabs.dispose()
      tabGroups.dispose()

      // Assert: every listener read auth.ts, and the report stays after them.
      assert.deepEqual(
        {
          readInListeners,
          reportedAfter:
            harness.editor.window.activeTextEditor?.document.uri.path
              .split('/')
              .at(-1),
        },
        {
          readInListeners: ['tabs:auth.ts', 'groups:auth.ts'],
          reportedAfter: 'auth.ts',
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the truth of what the learner is told when an agent's Return Current from a replay beside Cursor's Agent chat part (row 723's order) is refused right after its measurement borrowed the first group: the chat gets its keyboard back with Focus Agent, and the sentence says that Codebook could not finish arranging its panes; fails_when=finishCurrentReturn gives the chat its keyboard back with no cause after the refusal, so the return's own rule after a borrow tells "Codebook placed its panes and gave the keyboard back to the chat. …" although nothing was placed; why_new=Cycle 0046 row 731 (the fixer of rows 725 to 730, found beside row 727; row 718 fixed the same sentence for performPresentation's refusal); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus (the click into the chat input), leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and returnToCurrent, holdNextCommand on workbench.action.focusFirstEditorGroup with failNextCommand on the layout read after it, the command log and the information messages
test('in Cursor, an agent’s Return Current from a replay refused right after its borrow of the first group gives the chat its keyboard back and says that nothing was arranged', async () => {
  // Arrange: as in row 723's test; the layout read right after the measurement's borrow of the first group will fail.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      harness.failNextCommand('vscode.getEditorLayout')
      borrow.release()
    })

    // Act
    const refusal = await harness.service
      .returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await harness.controller.settle()

    // Assert: refused after the borrow; Focus Agent gave the chat its keyboard back, and the one sentence says that nothing was arranged.
    assert.deepEqual(
      {
        refusal,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal: 'Error: Native layout command failed',
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
        messages: [
          'Codebook could not finish arranging its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer input when an agent's Return Current from a replay beside Cursor's Agent chat part (row 723's order) is refused for it: during the layout read right after the measurement borrowed the first group, the learner changed login-form.tsx there, and the Return is refused with "The primary editor content or selection changed during scope measurement; the newer learner focus was preserved."; the chat gets no keyboard back over the learner's edit and nothing is told; fails_when=finishCurrentReturn gives the chat its keyboard back after any refusal, so Focus Agent takes the keyboard from the file the learner works in and the refusedArrangement sentence is told; why_new=Cycle 0046 row 735 (the OCR delegate's review of b5f8bf97..ec8a8ec3: Return Current lacked row 732's rule); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft and its replaceContent, the service's playback and returnToCurrent, holdNextCommand on workbench.action.focusFirstEditorGroup and on the layout read after it, the command log and the information messages
test('in Cursor, an agent’s Return Current from a replay refused for the learner’s change of the first group’s file during its layout read gives the chat no keyboard and tells nothing', async () => {
  // Arrange: as in row 723's test; the learner will change login-form.tsx during the layout read right after the measurement's borrow of the first group.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    const loginForm = harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        loginForm.replaceContent('export const changedByLearner = true\n')
        readAfterBorrow.release()
      })
      borrow.release()
    })

    // Act
    const refusal = await harness.service
      .returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await harness.controller.settle()

    // Assert: refused for the learner's change after the borrow; only the borrow's focus command ran, the chat has no keyboard, and nothing was told.
    assert.deepEqual(
      {
        refusal,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal:
          'Error: The primary editor content or selection changed during scope measurement; the newer learner focus was preserved.',
        keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
        chatHasKeyboard: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

/**
 * Opens the recorded reader's harness as Cursor beside its Agent chat part for row 736's replay opens: the reader closed, two main groups with the learner's login-form.tsx in front of the first, and the chat input holding the keyboard (row 678's setup).
 * @returns The harness, its chat part and login-form.tsx's draft.
 * @example const { harness, chat, loginForm } = await cursorReplayOpenFromChat()
 */
async function cursorReplayOpenFromChat() {
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  await harness.reader.close()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  const loginForm = harness.focusMutableDraft('login-form.tsx', 1)
  chat.focus()
  return { harness, chat, loginForm }
}

// Value: protects=the truth of what the learner is told when an agent's replay open (codebook_playback open) beside Cursor's Agent chat part is refused right after its measurement borrowed the first group (measureBeforePanesBesideForeignTab): the chat gets its keyboard back with Focus Agent and the one sentence says that Codebook could not finish arranging its panes; fails_when=open's refusal path gives the chat its keyboard back with no cause, so the return's own rule after a borrow tells "Codebook placed its panes and gave the keyboard back to the chat. …" for an entry that placed nothing; why_new=Cycle 0046 row 736 (the OCR delegate's review of b5f8bf97..ec8a8ec3, row 731's root); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and the controller's state, holdNextCommand on workbench.action.focusFirstEditorGroup with failNextCommand on the layout read after it, the command log and the information messages
test('in Cursor, an agent’s replay open refused right after its borrow of the first group gives the chat its keyboard back and says that nothing was arranged', async () => {
  // Arrange: row 678's setup; the layout read right after the measurement's borrow of the first group will fail.
  const { harness, chat } = await cursorReplayOpenFromChat()
  try {
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      harness.failNextCommand('vscode.getEditorLayout')
      borrow.release()
    })

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: the replay's open failed after the borrow; Focus Agent gave the chat its keyboard back, and the one sentence says that nothing was arranged.
    assert.deepEqual(
      {
        reason: harness.controller.state().reason,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        reason: 'Error: Native layout command failed',
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
        messages: [
          'Codebook could not finish arranging its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard and the truth of what the learner is told when an agent's replay open beside Cursor's Agent chat part is refused right after its borrow of the first group, after an earlier presentation focus request (codebook_presentation focus) was refused for the learner's newer choice: that request is no owner of presentationYieldedToLearner, so its refusal (retainPresentationPlacement's yieldFocusToLearner) leaves the flag set through the Study's close; the open notes its own refusal from its start, so the chat still gets its keyboard back with Focus Agent and the one sentence says that nothing was arranged; fails_when=an owning entry of open does not clear the flag when it begins, so the earlier request's flag reads as the open's own refusal for the learner and the chat gets nothing back and nothing is told; why_new=Cycle 0046 row 736 (the coverage audit of /ship: the reset when an owning open() entry begins had no test); seam=recordedReaderHarness, useHostAppName, the reader's open, changePresentation with action focus, holdPanelActivity on the Study pane with the learner's focusMutableDraft draft taking the keyboard during it, the reader's close, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and the controller's state, holdNextCommand on workbench.action.focusFirstEditorGroup with failNextCommand on the layout read after it, the command log and the information messages; no_claim=whether a refused focus request should clear the flag itself (each owner clears it when it begins and when it ends, and only owners read it)
test('in Cursor, an agent’s replay open refused right after its borrow still gives the chat its keyboard back and says that nothing was arranged after an earlier focus request was refused for the learner’s newer choice', async () => {
  // Arrange: the Study is open; a focus request for the Study pane is refused because the learner's draft took the keyboard while the pane's activity was held; the Study is closed, and row 678's setup follows with the chat input holding the keyboard; the layout read right after the open's borrow of the first group will fail.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.open()
    const opened = harness.reader.presentationState()
    const draft = harness.focusMutableDraft()
    const held = harness.holdPanelActivity('codebook.studyContext')
    const focusRefusal = Promise.resolve()
      .then(() =>
        harness.reader.changePresentation({
          presentationId: opened.presentationId,
          expectedRevision: opened.presentationControlRevision,
          mode: opened.mode,
          action: 'focus',
        }),
      )
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await held.started
    draft.focus()
    held.release()
    const refusedFocus = await focusRefusal
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      harness.failNextCommand('vscode.getEditorLayout')
      borrow.release()
    })

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: the focus request was refused; the replay's open failed after the borrow, Focus Agent gave the chat its keyboard back, and the one sentence says that nothing was arranged.
    assert.deepEqual(
      {
        refusedFocus,
        reason: harness.controller.state().reason,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusedFocus:
          'Error: Study focus could not be confirmed. Read current presentation state before retrying.',
        reason: 'Error: Native layout command failed',
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
        messages: [
          'Codebook could not finish arranging its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer input when an agent's replay open beside Cursor's Agent chat part is refused for it: during the layout read right after the measurement borrowed the first group, the learner changed login-form.tsx there, and the open is refused with "The primary editor content or selection changed during scope measurement; the newer learner focus was preserved."; the chat gets no keyboard back over the learner's edit and nothing is told; fails_when=open's refusal path gives the chat its keyboard back after any refusal, so Focus Agent takes the keyboard from the file the learner works in; why_new=Cycle 0046 row 736 (its learner-change half, row 732's rule); seam=as above, with focusMutableDraft's replaceContent and holdNextCommand on the layout read after the borrow
test('in Cursor, an agent’s replay open refused for the learner’s change of the first group’s file during its layout read gives the chat no keyboard and tells nothing', async () => {
  // Arrange: row 678's setup; the learner will change login-form.tsx during the layout read right after the measurement's borrow.
  const { harness, chat, loginForm } = await cursorReplayOpenFromChat()
  try {
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        loginForm.replaceContent('export const changedByLearner = true\n')
        readAfterBorrow.release()
      })
      borrow.release()
    })

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: refused for the learner's change; only the borrow's focus command ran, the chat has no keyboard, and nothing was told.
    assert.deepEqual(
      {
        reason: harness.controller.state().reason,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        reason:
          'Error: The primary editor content or selection changed during scope measurement; the newer learner focus was preserved.',
        keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
        chatHasKeyboard: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer place when, during an agent's replay open beside Cursor's Agent chat part, the learner clicks into login-form.tsx, the first group's file the measurement's borrow focused, during the layout read right after that borrow (the click moves no caret): the replay opens, the keyboard stays in that file, the chat gets nothing back and no keyboard sentence is told; fails_when=the chat return (the function retainForeignTabFocus answers) asks only where the measurement left the keyboard and not whether the learner clicked or typed there since, so open's last step runs Focus Agent and tells the arrangement's sentence; why_new=Cycle 0046 row 741 (open is one of the entries that share the return); seam=cursorReplayOpenFromChat, holdNextCommand on workbench.action.focusFirstEditorGroup and on the layout read after it, workInActiveTextEditor('mouse'), the service's playback and the controller's state, the command log and the information messages
test('in Cursor, an agent’s replay open after the learner’s click into the first group’s file during its layout read keeps the keyboard there, gives the chat nothing and tells no keyboard sentence', async () => {
  // Arrange: row 678's setup; during the layout read right after the measurement's borrow of the first group, the learner clicks into login-form.tsx there.
  const { harness, chat } = await cursorReplayOpenFromChat()
  try {
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        harness.workInActiveTextEditor('mouse')
        readAfterBorrow.release()
      })
      borrow.release()
    })

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: the replay opened; only the measurements' focus commands ran, the chat has no keyboard, and the one sentence told is the summary's placement, not a keyboard sentence.
    assert.deepEqual(
      {
        reason: harness.controller.state().reason,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        reason: undefined,
        keyboardCommands: [
          'workbench.action.focusFirstEditorGroup',
          'workbench.action.focusFirstEditorGroup',
        ],
        chatHasKeyboard: false,
        messages: [
          'Cursor opens the Codebook Learning summary in its primary side bar. To keep it on the right, move it once: choose "New Secondary Side Bar Entry" in the list that opens.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's newer place when, during an agent's Return Current from a replay beside Cursor's Agent chat part (row 723's order), the learner clicks into login-form.tsx, the first group's file the measurement's borrow focused, during the layout read right after that borrow (the click moves no caret): the Return answers, the keyboard stays in that file, the chat gets nothing back and nothing is told; fails_when=the chat return (the function retainForeignTabFocus answers) asks only where the measurement left the keyboard and not whether the learner clicked or typed there since, so finishCurrentReturn runs Focus Agent and tells the arrangement's sentence; why_new=Cycle 0046 row 741 (Return Current is one of the entries that share the return); seam=recordedReaderHarness, useHostAppName, useNativeLayout, addSeparateEditorPart and its focus, leavePaneFocusUnreportedBesideChat, focusMutableDraft, the service's playback and returnToCurrent, holdNextCommand on workbench.action.focusFirstEditorGroup and on the layout read after it, workInActiveTextEditor('mouse'), the command log and the information messages
test('in Cursor, an agent’s Return Current from a replay after the learner’s click into the first group’s file during its layout read keeps the keyboard there, gives the chat nothing and tells nothing', async () => {
  // Arrange: as in row 723's test; during the layout read right after the measurement's borrow of the first group, the learner clicks into login-form.tsx there.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focus()
    const state = harness.reader.presentationState(),
      commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length
    const borrow = harness.holdNextCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    void borrow.started.then(() => {
      const readAfterBorrow = harness.holdNextCommand('vscode.getEditorLayout')
      void readAfterBorrow.started.then(() => {
        harness.workInActiveTextEditor('mouse')
        readAfterBorrow.release()
      })
      borrow.release()
    })

    // Act
    const refusal = await harness.service
      .returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      .then(
        () => undefined,
        (error: unknown) => String(error),
      )
    await harness.controller.settle()

    // Assert: the Return answered; only the borrow's focus command ran, the chat has no keyboard, and nothing was told.
    assert.deepEqual(
      {
        refusal,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          ),
        chatHasKeyboard: chat.focused(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal: undefined,
        keyboardCommands: ['workbench.action.focusFirstEditorGroup'],
        chatHasKeyboard: false,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's knowledge of where the keyboard is after an agent's replay open (codebook_playback open) beside Cursor's Agent chat part while the chat tab has the keyboard: the preparation's measurement borrows the first group, Focus Agent gives the chat its keyboard back, and the arrangement's sentence is told the first time in an editor session only, so the next replay open in that session says nothing (C59 c59-cu-656a told nothing because round c59-cu-650 had told the sentence in the same extension host, after its reload: the notification shows in that round's recording at 7 to 8.5 s, and both rounds' observers share the host's time origin 1792204656982); fails_when=the replay open gives the chat its keyboard back without the sentence the first time, or tells it again each time; why_new=Cycle 0046 row 678 (evidence: not a defect; this test holds the rule the native rounds followed); seam=recordedReaderHarness, useNativeLayout, addSeparateEditorPart and its focusTab, leavePaneFocusUnreportedBesideChat, the service's playback and the reader's close, the command log and the information messages
test('in Cursor, an agent’s replay open from the chat tab gives the chat its keyboard back and says so the first time in an editor session only', async () => {
  // Arrange: Cursor's Agent chat as a tab of its own editor part has the keyboard; the learner's login-form.tsx is in front of the first group, and the reader is closed.
  const harness = await recordedReaderHarness(true, true)
  harness.useHostAppName('Cursor')
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focusTab()
    const arrangementSentence =
      'Codebook placed its panes and gave the keyboard back to the chat. Beside the chat the editor reads and changes the layout of its groups only while one of them has the focus, so a file or pane of the main editor had the keyboard for a moment. The editor does not tell Codebook whether you were typing in that chat or in the terminal or another view: if you were typing elsewhere, click there to type again.'
    const openReplay = async () => {
      const commandsBefore = harness.commands.length,
        messagesBefore = harness.informationMessages.length
      harness.service.playback({
        instanceId: harness.service.instanceId,
        studyId: harness.studyId,
        action: 'open',
        expectedRevision: harness.controller.state().revision,
      })
      await harness.controller.settle()
      return {
        lastKeyboardCommand: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
              command,
            ),
          )
          .at(-1),
        chatHasKeyboard: chat.focused(),
        toldArrangement: harness.informationMessages
          .slice(messagesBefore)
          .filter((message) => message.message === arrangementSentence).length,
      }
    }

    // Act: the agent opens the replay, closes the reader and opens it again from the chat.
    const first = await openReplay()
    await harness.reader.close()
    chat.focusTab()
    const second = await openReplay()

    // Assert
    assert.deepEqual(
      { first, second },
      {
        first: {
          lastKeyboardCommand: 'composer.focusComposer',
          chatHasKeyboard: true,
          toldArrangement: 1,
        },
        second: {
          lastKeyboardCommand: 'composer.focusComposer',
          chatHasKeyboard: true,
          toldArrangement: 0,
        },
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's terminal and its keyboard in the bottom panel when an agent opens a recording through codebook_playback in VS Code: the Observed moments view's focus command opens its container in place of the terminal even with the focus kept (1.140.0 workbench.desktop.main.js 1639:157156 -> openView 1639:152215 -> doOpenComposite 1106:186495, hideActiveComposite 1106:190002), which hides the terminal and drops its keyboard; the agent's entry leaves the panel as it is, and the one sentence told once names both places where the replay's controls wait; fails_when=the agent's replay open still focuses the moments view while it is not shown, or tells nothing about where the controls wait; why_new=Cycle 0046 row 621; seam=recordedReaderHarness, the reader's close, useNativeLayout, focusMutableDraft, focusTerminalInBottomPanel (the panel's terminal with the keyboard), the service's playback (the codebook_playback handler), viewFocusCommands, keyboardInView, terminalInFrontOfPanel and the information messages
test('an agent’s replay open in VS Code while the learner types in the bottom panel’s terminal keeps the terminal in front with its keyboard and says where the replay controls wait', async () => {
  // Arrange: a saved recording, the reader closed; the learner's actions.ts is the active editor of the first group, and the learner types in the terminal of the bottom panel.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusTerminalInBottomPanel()
    const viewFocusBefore = harness.viewFocusCommands.length

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: neither view was brought to the front, the terminal still stands in front of the panel with the keyboard, and the learner is told where the Application group and the replay's controls are.
    assert.deepEqual(harness.viewFocusCommands.slice(viewFocusBefore), [])
    assert.equal(harness.terminalInFrontOfPanel(), true)
    assert.equal(harness.keyboardInView(), true)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
        'Codebook showed the replay an agent asked for without bringing its controls to the front, so a chat or a terminal there keeps its place and your keyboard. To play it, click Learning summary at the top of the secondary side bar (View: Toggle Secondary Side Bar Visibility shows the bar) or the codebook tab of the bottom panel (View: Toggle Panel Visibility shows the panel).',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's terminal and its keyboard in the bottom panel when an agent opens a recording through codebook_playback in Cursor: the Observed moments view's focus command switches the bottom panel's container there too (Cursor 3.23.12 18332:33062 -> 17501:95332, 17501:98812), while the Learning summary, which Cursor puts in the primary side bar, brings the replay's controls to the front without touching the panel; fails_when=the agent's replay open still focuses the moments view while it is not shown, so the terminal is hidden and its keyboard dropped; why_new=Cycle 0046 row 621; seam=recordedReaderHarness, useHostAppName('Cursor'), the reader's close, useNativeLayout, focusMutableDraft, focusTerminalInBottomPanel, the service's playback, viewFocusCommands, keyboardInView and terminalInFrontOfPanel
test('an agent’s replay open in Cursor while the learner types in the bottom panel’s terminal shows the Learning summary and keeps the terminal in front with its keyboard', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.useHostAppName('Cursor')
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusTerminalInBottomPanel()
    const viewFocusBefore = harness.viewFocusCommands.length

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()

    // Assert: only the summary, with its transport, was brought to the front without the keyboard; the terminal keeps the panel and the keyboard.
    assert.deepEqual(harness.viewFocusCommands.slice(viewFocusBefore), [
      { command: 'codebook.learningSummary.focus', preserveFocus: true },
    ])
    assert.equal(harness.terminalInFrontOfPanel(), true)
    assert.equal(harness.keyboardInView(), true)
    assert.equal(harness.controller.state().readiness, 'ready')
  } finally {
    await harness.close()
  }
})

// Value: protects=a newer recording open while the reader's first entry, already abandoned, is still inside a native layout call; fails_when=the newer open meets the abandoned entry's reservation and reports busy; why_new=Cycle 0034 O2 (a load that leaves on abort lets its successor reach the cold entry); seam=none
test('a recording opened again after its first reader entry was abandoned waits for that entry instead of reporting busy', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  let releaseEntry = (): void => {}
  try {
    await harness.reader.close()
    const entry = harness.holdNextCommand('vscode.getEditorLayout')
    releaseEntry = entry.release
    await harness.reader.openRecording(harness.studyId)
    await entry.started

    // Act: the learner pauses the stuck open and opens the recording again.
    harness.controller.command({
      action: 'pause',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
    })
    await harness.reader.openRecording(harness.studyId)
    await new Promise<void>((resolve) => setTimeout(resolve, 300))
    const whileEntryHeld = harness.controller.state()
    entry.release()
    await harness.controller.settle()

    // Assert
    const state = harness.controller.state()
    assert.equal(whileEntryHeld.reason, undefined)
    assert.equal(whileEntryHeld.readiness, 'loading')
    assert.equal(state.readiness, 'ready')
    assert.equal(state.reason, undefined)
  } finally {
    releaseEntry()
    await harness.close()
  }
})

// Value: protects=a newer presentation that adopted the recorded-application viewport while its abandoned creator was still queued behind a native placement hold; fails_when=the creator closes the viewport once its queued reveal notices the cancellation; why_new=Cycle 0034 O3 (a load that leaves on abort lets its successor adopt the viewport); seam=WorkspaceViewport models the queued reveal and the paint rejected by a close
test('a recording opened again while its first recorded-application reveal is still queued keeps that viewport and paints the next frame', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  let releaseReveal = (): void => {},
    releasePaint = (): void => {}
  try {
    await harness.reader.close()
    const reveal = harness.holdNextRecordingReveal()
    releaseReveal = reveal.release
    await harness.reader.openRecording(harness.studyId)
    await reveal.started
    harness.controller.command({
      action: 'pause',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
    })
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const paint = harness.holdNextImage()
    releasePaint = paint.release
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await paint.started

    // Act: the abandoned first open's reveal leaves its queue while the newer frame is painting.
    reveal.release()
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    paint.release()
    await harness.controller.settle()

    // Assert
    const state = harness.controller.state()
    assert.equal(state.reason, undefined)
    assert.equal(state.readiness, 'ready')
    assert.equal(state.presentedMs, 100)
  } finally {
    releaseReveal()
    releasePaint()
    await harness.close()
  }
})

// Value: protects=a successor of an abandoned first entry that never returns still getting an answer; fails_when=the successor waits for the abandoned entry without a bound, or stops waiting at once; why_new=Cycle 0034 O2 adds that wait (plan review P4); seam=none
test(
  'a recording opened again after an abandoned first reader entry that never returns reports busy after the presentation bound',
  { timeout: 30_000 },
  async (context) => {
    // Arrange
    const harness = await recordedReaderHarness(true, true)
    let releaseEntry = (): void => {}
    try {
      await harness.reader.close()
      const entry = harness.holdNextCommand('vscode.getEditorLayout')
      releaseEntry = entry.release
      await harness.reader.openRecording(harness.studyId)
      await entry.started
      harness.controller.command({
        action: 'pause',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
      })

      // Act: the 5 s presentation bound passes on a faked clock.
      enableFakeClock(context)
      await harness.reader.openRecording(harness.studyId)
      await advanceClock(context, 4_750)
      const readinessBeforeBound = harness.controller.state().readiness
      const gaveUpAfterMs = await advanceClockUntil(
        context,
        () => harness.controller.state().readiness === 'failed',
        2_000,
      )
      resetFakeClock(context)

      // Assert
      assert.equal(readinessBeforeBound, 'loading')
      assert.notEqual(gaveUpAfterMs, undefined)
      assert.match(
        harness.controller.state().reason ?? '',
        /Study workspace is opening/,
      )
    } finally {
      resetFakeClock(context)
      releaseEntry()
      await harness.close()
    }
  },
)

// Value: protects=a repeated Recording press on a healthy replay keeping its moment and control revision; fails_when=a replay whose historical debugger was never created counts as not presentable and reloads; why_new=Cycle 0034 O4/O5 tests cover only the reload, and the controller test stubs presentable; seam=none
test('pressing Recording again on a displayed replay without recorded debugger state keeps its moment without reloading it', async () => {
  // Arrange: the recording has no recorded debugger state, so no historical debugger was ever started for it.
  const harness = await recordedReaderHarness(true)
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
    const displayed = harness.controller.state()
    const publishedBefore = harness.postedMessages().length

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    const state = harness.controller.state()
    assert.equal(harness.historicalDebuggers.length, 0)
    assert.equal(displayed.revision, 2)
    assert.equal(state.revision, 2)
    assert.equal(state.presentationRevision, displayed.presentationRevision)
    assert.equal(state.presentedMs, 100)
    assert.equal(state.readiness, 'ready')
    assert.deepEqual(
      harness
        .postedMessages()
        .slice(publishedBefore)
        .map((message) => message.recording?.readiness)
        .filter((readiness) => readiness !== 'ready'),
      [],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an explicit reopen still presenting, with the failure shown, when stopping the ended historical debugger fails; fails_when=the shared retirement rejects, so the open fails or the rejection is unhandled; why_new=Cycle 0034 O1 moved disposal into a shared retirement whose error path had no test; seam=none
test('pressing Recording after the historical session ended still presents the saved moment when the editor fails to release the old debugger', async () => {
  // Arrange: the editor will end the old owner's registration and then fail its disposal.
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
    const endedDebugger = harness.historicalDebuggers[0]!,
      dispose = endedDebugger.dispose.bind(endedDebugger)
    endedDebugger.dispose = async (): Promise<void> => {
      await dispose()
      throw new Error('The editor failed to release the historical debugger')
    }
    harness.endHistoricalDebugSession()

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    const view = harness.postedMessages().slice(-1)[0]!
    assert.equal(view.recording?.readiness, 'ready')
    assert.equal(view.recording?.presentedMs, 100)
    assert.equal(harness.controller.state().reason, undefined)
    assert.equal(harness.historicalDebuggers.length, 2)
    assert.equal(harness.historicalDebuggers[1]!.available, true)
    assert.equal(
      view.errors
        .filter((error) => error.includes('historical debugger'))
        .join(' | '),
      'Error: The editor failed to release the historical debugger',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=recovering a stopped replay while a live run's viewport still holds the shared Application panel; fails_when=the reload lets the live viewport's loading page replace the recording renderer that is then reused, so no frame is acknowledged; why_new=Cycle 0035 H1 (the harness acknowledged paints whatever document the panel held); seam=WorkspaceViewport models the renderer document
test('pressing Recording after the historical session ended presents the saved moment again while a live run is still attached', async () => {
  // Arrange: a live run leases the Application panel before the recording is displayed.
  const harness = await recordedReaderHarness(true, true)
  const liveFailures: string[] = []
  try {
    await harness.reader.presentation.createViewport(
      'attached-live',
      () => {},
      (reason) => liveFailures.push(reason),
      'normal',
    )
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    harness.endHistoricalDebugSession()

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    const state = harness.controller.state()
    assert.equal(state.reason, undefined)
    assert.equal(state.readiness, 'ready')
    assert.equal(state.presentedMs, 100)
    assert.equal(
      harness.displayedImage(),
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
    )
    assert.equal(harness.historicalDebuggers.length, 2)
    assert.deepEqual(liveFailures, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=the workspace harness refusing recorded paints, gaps and handshakes once another writer replaced the recording renderer in the shared Application panel; fails_when=the harness acknowledges a recording viewport whatever document its panel holds, so a reload that reuses a replaced renderer passes unnoticed; why_new=Cycle 0035 AC3 (the model's rejection was shown only by the private red run on the base source); seam=WorkspaceViewport models the renderer document
test('the workspace harness answers a recording viewport only while its own renderer is the document in the shared Application panel', async () => {
  // Arrange: a live viewport and the recording viewport share one Application panel, and the recording renderer was written last.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.presentation.createViewport(
      'attached-live',
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const live = harness.viewportInstances.find(
        (candidate) => candidate.mode !== 'recording',
      ),
      recording = harness.viewportInstances.find(
        (candidate) => candidate.mode === 'recording',
      )
    assert.ok(live)
    assert.ok(recording)
    assert.equal(recording.panel, live.panel)
    await recording.present('renderer-in-place')
    const acknowledgedInPlace = harness.displayedImage()

    // Act: the live lease writes its history page into the shared panel.
    live.showHistory('<p>Loading recording</p>')

    // Assert
    assert.equal(acknowledgedInPlace, 'renderer-in-place')
    await assert.rejects(recording.present('renderer-replaced'), {
      message: 'Viewport frame acknowledgement timed out',
    })
    await assert.rejects(recording.presentMissing(), {
      message: 'Timed out waiting for recorded gap presentation',
    })
    await assert.rejects(recording.reveal(), {
      message: 'Timed out waiting for owned viewport ready',
    })
    assert.equal(harness.displayedImage(), 'renderer-in-place')
  } finally {
    await harness.close()
  }
})

// Value: protects=the workspace harness live viewport matching the real BrowserViewport.showLive; fails_when=the harness rewrites an attached live renderer's panel or leaves history without a renderer handshake, so the renderer-document model passes where the product fails; why_new=Cycle 0035 R07f; seam=WorkspaceViewport models the renderer document
test('the workspace harness live viewport leaves an attached renderer panel alone and re-handshakes only when it leaves history, like the real viewport', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.presentation.createViewport(
      'attached-live',
      () => {},
      () => {},
      'normal',
    )
    const live = harness.viewportInstances.find(
      (candidate) => candidate.mode !== 'recording',
    )
    assert.ok(live)
    const liveReveals = (): number =>
      harness.viewportEvents.filter((event) => event === 'reveal:live').length
    live.panel.webview.html = '<p>Another writer</p>'
    const revealsBefore = liveReveals()

    // Act
    await live.showLive()
    const htmlAfterAttachedShowLive = live.panel.webview.html
    const revealsAfterAttachedShowLive = liveReveals()
    live.showHistory('<p>Loading recording</p>')
    await live.showLive()

    // Assert
    assert.equal(htmlAfterAttachedShowLive, '<p>Another writer</p>')
    assert.equal(revealsAfterAttachedShowLive, revealsBefore)
    assert.equal(liveReveals(), revealsBefore + 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=the first open of a recording while a live run holds the Application panel; fails_when=the recording renderer is not the last document written into the shared panel; why_new=Cycle 0035 H1 changes who writes that panel during a load, and no test asserted this open's outcome; seam=WorkspaceViewport models the renderer document
test('opening a recording while a live run is attached presents its saved frame', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  const liveFailures: string[] = []
  try {
    await harness.reader.presentation.createViewport(
      'attached-live',
      () => {},
      (reason) => liveFailures.push(reason),
      'normal',
    )

    // Act: the open itself presents the opening moment, then one seek reaches the captured frame.
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

    // Assert
    const state = harness.controller.state()
    assert.equal(opened.reason, undefined)
    assert.equal(opened.readiness, 'ready')
    assert.equal(opened.presentedMs, 0)
    assert.equal(state.reason, undefined)
    assert.equal(state.readiness, 'ready')
    assert.equal(state.presentedMs, 100)
    assert.equal(
      harness.displayedImage(),
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
    )
    assert.equal(
      harness.viewportInstances.filter(
        (viewport) => viewport.mode === 'recording',
      ).length,
      1,
    )
    assert.deepEqual(liveFailures, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=reopening, through Recording, a study whose stop the debugger bound at another column than declared; fails_when=the reader's own validation or presentation still requires the declared column, so the recording fails to open or shows the declared position; why_new=Cycle 0036 C07e (the moved-column rule was tested through the study decoder only); seam=recordedReaderHarness commits the stop at column 7
test('a study whose stop the debugger bound at column 7 of its declared line opens through Recording and presents that stop at the bound column', async () => {
  // Arrange: the stop was declared at 1:1 and committed, with its native top frame, at 1:7.
  const harness = await recordedReaderHarness(true, true, 7)
  try {
    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    const state = harness.controller.state(),
      observation = harness.controller.bundle()?.projection.observation
    assert.equal(state.reason, undefined)
    assert.equal(state.readiness, 'ready')
    assert.equal(state.presentedMs, 100)
    assert.equal(observation?.source.line, 1)
    assert.equal(observation?.source.column, 7)
    assert.equal(observation?.debugger?.frames[0]?.column, 7)
  } finally {
    await harness.close()
  }
})

// Value: protects=the recorded frame staying on screen while Recording reloads the same recording; fails_when=the reload clears the frame before the reloaded moment is ready, so the Recorded application pane is blank for about a second; why_new=Cycle 0037 N6e; seam=holdHistoricalDebugPresentation keeps the reload from finishing
test('pressing Recording again on the same recording keeps its displayed frame until the reloaded moment is presented', async () => {
  // Arrange: the captured frame is displayed and the historical session ended, so Recording reloads.
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
    const displayedBeforeReload = harness.displayedImage()
    harness.endHistoricalDebugSession()
    const reload = harness.holdHistoricalDebugPresentation()

    // Act
    await harness.reader.openRecording(harness.studyId)
    await reload.started
    const displayedDuringReload = harness.displayedImage()
    reload.release()
    await harness.controller.settle()

    // Assert
    assert.equal(
      displayedBeforeReload,
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
    )
    assert.equal(
      displayedDuringReload,
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
    )
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.state().presentedMs, 100)
  } finally {
    await harness.close()
  }
})

// Value: protects=the 2.0 s recovery of Recording pressed again with a live run attached; fails_when=every load drops the recording renderer and waits for a new renderer handshake; why_new=Cycle 0035 R02 (P1 "Latency"); seam=none
test('pressing Recording again while a live run is attached presents the saved frame through the same recording renderer', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  const liveFailures: string[] = []
  try {
    await harness.reader.presentation.createViewport(
      'attached-live',
      () => {},
      (reason) => liveFailures.push(reason),
      'normal',
    )
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.endHistoricalDebugSession()

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    const state = harness.controller.state()
    assert.equal(state.reason, undefined)
    assert.equal(state.readiness, 'ready')
    assert.equal(harness.historicalDebuggers.length, 2)
    assert.equal(
      harness.viewportInstances.filter(
        (viewport) => viewport.mode === 'recording',
      ).length,
      1,
    )
    assert.deepEqual(liveFailures, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=pressing Recording after the editor closed the Application panel a live run had leased; fails_when=the closed live lease is treated as attached, its history page write throws and the load fails; why_new=Cycle 0035 R11; seam=WorkspaceViewport refuses showHistory after its panel closed, like the real viewport
test('pressing Recording after the editor closed the Application panel of an attached live run presents the saved frame', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  const liveFailures: string[] = []
  try {
    await harness.reader.presentation.createViewport(
      'attached-live',
      () => {},
      (reason) => liveFailures.push(reason),
      'normal',
    )
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()
    harness.reader['app']!.dispose()
    harness.endHistoricalDebugSession()

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    const state = harness.controller.state()
    assert.equal(state.reason, undefined)
    assert.equal(state.readiness, 'ready')
    assert.equal(state.presentedMs, 100)
    assert.equal(
      harness.displayedImage(),
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
    )
    assert.deepEqual(liveFailures, ['Owned viewport closed before cleanup'])
  } finally {
    await harness.close()
  }
})

// Value: protects=the held pause of a live run while the learner reads a replay; fails_when=presenting replay moments does not renew the pause hold of the run that is paused now, so that pause is released after five minutes of reading; why_new=Cycle 0035 O3, rewritten in Cycle 0045 (finding X7-E3.2: the count was taken on the stopped run of the recording itself, whose real renewal does nothing, so the test did not show that a paused run is held); seam=renewPauseHold spy on the paused run's runtime
test('reading a recording while a live run is paused renews that run’s pause hold for each presented moment', async () => {
  // Arrange: a saved recording of a stopped run, and a second run that is paused at its stop.
  const harness = await recordedReaderHarness(true, true)
  let renewals = 0
  try {
    harness.service.environment.build.sourceHash = sha256('paused-live-build')
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: 'paused-live-run',
    })
    const pausedRun = [...harness.service.records.values()].at(-1)!
    await pausedRun.preparation
    harness.clock(1_100)
    await harness.reader.action('click')
    pausedRun.runtime!.renewPauseHold = (): void => {
      renewals++
    }
    const pausedRunBeforeReading = {
      isAnotherRunThanTheRecording: pausedRun !== harness.record,
      stopped: pausedRun.stopped,
      status: pausedRun.runtime!.view().status,
    }

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const renewalsAfterOpen = renewals
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    await harness.controller.settle()

    // Assert
    assert.deepEqual(pausedRunBeforeReading, {
      isAnotherRunThanTheRecording: true,
      stopped: false,
      status: 'paused-browser',
    })
    assert.equal(renewalsAfterOpen, 1)
    assert.equal(renewals, 2)
    assert.equal(pausedRun.stopped, false)
  } finally {
    await harness.close()
  }
})

// Value: protects=the moment the learner confirmed last when Recording is pressed before its position save has landed; fails_when=the reload reads the older stored position and presents and saves it; why_new=Cycle 0035 H2 (the workspace reload tests let every save land first); seam=holdPositionSaves holds the store's saves
test('pressing Recording after the historical session ended keeps the moment whose position save is still held by storage', async () => {
  // Arrange: storage holds the opening position; the save of the confirmed 100 ms waits behind the storage lock.
  const harness = await recordedReaderHarness(true, true)
  let releaseSave = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const storedBeforeSeek = (await harness.store.readPreference())?.positionMs
    releaseSave = harness.holdPositionSaves().release
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 100,
    })
    // Bounded: an unbounded settle also waits for the held position save, which lands only after release.
    await harness.controller.settle(new AbortController().signal, 2_000)
    harness.endHistoricalDebugSession()

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle(new AbortController().signal, 2_000)
    const presentedWhileSaveHeld = harness.controller.state().presentedMs
    const storedWhileSaveHeld = (await harness.store.readPreference())
      ?.positionMs
    releaseSave()
    await harness.controller.saved()

    // Assert
    assert.equal(storedBeforeSeek, 0)
    assert.equal(storedWhileSaveHeld, 0)
    assert.equal(presentedWhileSaveHeld, 100)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal((await harness.store.readPreference())?.positionMs, 100)
  } finally {
    releaseSave()
    await harness.close()
  }
})

// Value: protects=tests that hold one reader's position saves measuring only that reader; fails_when=the hold patches every recording store of the process, so another harness's saves wait as well, or a second hold replaces the first and its release leaves saves held; why_new=Cycle 0045 D-L9 (the hold patched the store's prototype and its restore was not re-entrant); seam=holdPositionSaves holds the saves of the store the reader owns
test('holding position saves in one workspace harness does not hold the saves of another, and a second hold while one is active is refused', async () => {
  // Arrange: two readers, each showing its own recording at the opening position.
  const holding = await recordedReaderHarness(true, true),
    other = await recordedReaderHarness(true, true)
  let releaseSaves = (): void => {}
  try {
    for (const harness of [holding, other]) {
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
    }

    // Act: the first harness holds its saves and is asked to hold them again; then both readers confirm the moment at 100 ms.
    releaseSaves = holding.holdPositionSaves().release
    let secondHoldRefusal = ''
    try {
      holding.holdPositionSaves().release()
    } catch (error) {
      secondHoldRefusal = String(error)
    }
    for (const harness of [holding, other]) {
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs: 100,
      })
      // Bounded: an unbounded settle also waits for a held position save.
      await harness.controller.settle(new AbortController().signal, 2_000)
    }
    // Bounded: a hold that reached the other reader's store would keep its save from ever landing.
    const otherSaveLanded = await Promise.race([
      other.controller.saved().then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(resolve, 2_000, false).unref()
      }),
    ])
    const storedByHoldingWhileHeld = (await holding.store.readPreference())
        ?.positionMs,
      storedByOther = (await other.store.readPreference())?.positionMs
    releaseSaves()
    await holding.controller.saved()

    // Assert
    assert.equal(
      secondHoldRefusal,
      'Error: Position saves of this workspace harness are already held. Release that hold before holding them again.',
    )
    assert.equal(otherSaveLanded, true)
    assert.equal(storedByOther, 100)
    assert.equal(storedByHoldingWhileHeld, 0)
    assert.equal((await holding.store.readPreference())?.positionMs, 100)
  } finally {
    releaseSaves()
    await holding.close()
    await other.close()
  }
})

// Value: protects=a closed reader staying closed when an agent sends playback controls; fails_when=a seek or play after Close presents through the hidden controller and recreates the Application panel without the reader; why_new=Cycle 0035 H4 (Cycle 0034 O4 covers open only); seam=none
test('an agent seeking or playing a recording after the reader closed is refused and nothing opens', async () => {
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
    await harness.reader.close()
    const debuggersAtClose = harness.historicalDebuggers.length
    const control = (
      input:
        | { action: 'seek'; positionMs: number }
        | { action: 'play' }
        | { action: 'pause' },
    ): string => {
      try {
        return harness.service.playback({
          instanceId: harness.service.instanceId,
          studyId: harness.studyId,
          expectedRevision: harness.controller.state().revision,
          ...input,
        }).mode
      } catch (error) {
        return `${(error as { code?: string }).code}: ${(error as Error).message}`
      }
    }

    // Act
    const seek = control({ action: 'seek', positionMs: 0 })
    const play = control({ action: 'play' })
    const pause = control({ action: 'pause' })
    await harness.controller.settle()

    // Assert
    assert.equal(
      seek,
      'PLAYBACK_UNAVAILABLE: Error: The replay reader is closed; open the recording before another control.',
    )
    assert.equal(
      play,
      'PLAYBACK_UNAVAILABLE: Error: The replay reader is closed; open the recording before another control.',
    )
    assert.equal(pause, 'paused')
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(harness.reader['app'], undefined)
    assert.equal(harness.historicalDebuggers.length, debuggersAtClose)
    assert.equal(harness.controller.state().presentedMs, 100)
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent learning from the playback resource that the reader closed and that only open recovers; fails_when=the resource keeps saying ready with no reader-open field and the refusal's hint sends the agent back to read that resource; why_new=Cycle 0035 R04; seam=none
test('after the reader closed the playback state says the reader is closed and a refused seek tells the agent to send open', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const readerOpenBeforeClose = harness.controller.state().readerOpen
    await harness.reader.close()

    // Act
    const readerOpenAfterClose = harness.controller.state().readerOpen
    let refusalCause = ''
    try {
      harness.service.playback({
        instanceId: harness.service.instanceId,
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        action: 'seek',
        positionMs: 0,
      })
    } catch (error) {
      refusalCause = (error as { causeDetail: string }).causeDetail
    }

    // Assert
    assert.equal(readerOpenBeforeClose, true)
    assert.equal(readerOpenAfterClose, false)
    assert.equal(
      refusalCause,
      `The replay reader is closed (readerOpen is false). Send codebook_playback with action open and studyId ${harness.studyId} to reopen it before another control. No application input was sent.`,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a closed reader staying closed when the learner seeks or plays from the Learning replay panel, and the panel saying why; fails_when=the closed-reader refusal covers only the agent's playback route, so the panel's control presents and recreates the Application panel alone; why_new=Cycle 0035 H4's test sends controls through the service only, and the panel calls the controller directly; seam=none
test('a learner seeking or playing from the Learning replay panel after the reader closed is refused, told why, and nothing opens', async () => {
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
    await harness.reader.close()
    const debuggersAtClose = harness.historicalDebuggers.length,
      revisionAtClose = harness.controller.state().revision,
      errorsAtClose = harness.playbackPanelMessages.at(-1)!.errors

    // Act: the panel outlives the reader, so its controls still reach the workspace.
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'seek',
      positionMs: 0,
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      expectedRevision: harness.controller.state().revision,
    })
    await waitUntil(
      () =>
        harness.playbackPanelMessages
          .at(-1)!
          .errors.some((error) => error.includes('replay reader is closed')),
      'the refused seek reaching the Learning replay panel',
      1_000,
    )
    await harness.controller.settle()
    const afterSeek = harness.controller.state()
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'play',
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      expectedRevision: harness.controller.state().revision,
    })
    await new Promise((resolve) => setImmediate(resolve))
    await harness.controller.settle()

    // Assert
    const afterPlay = harness.controller.state()
    assert.equal(
      harness.playbackPanelMessages
        .at(-1)!
        .errors.filter((error) => !errorsAtClose.includes(error))
        .join('\n'),
      'Error: The replay reader is closed; open the recording before another control.',
    )
    assert.equal(afterSeek.presentedMs, 100)
    assert.equal(afterSeek.revision, revisionAtClose)
    assert.equal(afterPlay.mode, 'paused')
    assert.equal(afterPlay.presentedMs, 100)
    assert.equal(afterPlay.revision, revisionAtClose)
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(harness.reader['app'], undefined)
    assert.equal(harness.historicalDebuggers.length, debuggersAtClose)
  } finally {
    await harness.close()
  }
})

// Value: protects=the reader's close from being met by a new presentation; fails_when=a playback control is admitted while Close is still draining; why_new=Cycle 0035 R1 review (the service refuses it as a pending close, and no test sent a control during Close); seam=TestReplayDebugger models a held disposal
test('an agent seek that arrives while the reader is closing is refused', async () => {
  // Arrange: Close is waiting for the editor to stop the historical session.
  const harness = await recordedReaderHarness(true, true)
  let releaseDisposal = (): void => {}
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
    const disposal = harness.holdHistoricalDebugDisposal()
    releaseDisposal = disposal.release
    const closing = harness.reader.close()
    await disposal.started

    // Act
    let seek: string
    try {
      seek = harness.service.playback({
        instanceId: harness.service.instanceId,
        studyId: harness.studyId,
        action: 'seek',
        positionMs: 0,
        expectedRevision: harness.controller.state().revision,
      }).mode
    } catch (error) {
      seek = `${(error as { code?: string }).code}: ${(error as Error).message}`
    }
    disposal.release()
    await closing

    // Assert
    assert.equal(
      seek,
      'PRESENTATION_UNAVAILABLE: A presentation change or reader close is pending. Read its state before another control.',
    )
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(harness.reader['app'], undefined)
    assert.equal(harness.controller.state().presentedMs, 100)
  } finally {
    releaseDisposal()
    await harness.close()
  }
})

// Value: protects=a repeated Recording press on a healthy replay with a live historical session; fails_when=an available historical debugger counts as not presentable, so the press reloads the recording and restarts the session; why_new=Cycle 0035 H5a (the no-reload workspace test has no recorded debugger state, and the reload tests end the session first); seam=none
test('pressing Recording again on a displayed replay whose historical session is still running keeps its moment and its session', async () => {
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
    const displayed = harness.controller.state(),
      presentationsBefore = harness.historicalDebugPresentations.length,
      publishedBefore = harness.postedMessages().length

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    const state = harness.controller.state()
    assert.equal(harness.historicalDebuggers.length, 1)
    assert.equal(harness.historicalDebuggers[0]!.available, true)
    assert.equal(displayed.revision, 2)
    assert.equal(state.revision, 2)
    assert.equal(state.presentationRevision, displayed.presentationRevision)
    assert.equal(state.presentedMs, 100)
    assert.equal(
      harness.historicalDebugPresentations.length,
      presentationsBefore,
    )
    assert.deepEqual(
      harness
        .postedMessages()
        .slice(publishedBefore)
        .map((message) => message.recording?.readiness)
        .filter((readiness) => readiness !== 'ready'),
      [],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=recovering a recording whose recorded-application renderer never became ready; fails_when=the renderer that failed its first reveal stays in place and the next open reuses it; why_new=Cycle 0035 H5d (the failure arm that is not a cancellation had no test); seam=holdNextRecordingReveal fails the reveal as a renderer that never answers
test('a recording whose recorded-application renderer never became ready opens again through a new renderer', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    const reveal = harness.holdNextRecordingReveal()
    await harness.reader.openRecording(harness.studyId)
    await reveal.started
    reveal.fail(new Error('The recorded application renderer did not start'))
    await harness.controller.settle()
    const failed = harness.controller.state()

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert
    const state = harness.controller.state(),
      recordingRenderers = harness.viewportInstances.filter(
        (viewport) => viewport.mode === 'recording',
      )
    assert.equal(failed.readiness, 'failed')
    assert.equal(
      failed.reason,
      'Error: The recorded application renderer did not start',
    )
    assert.equal(state.readiness, 'ready')
    assert.equal(state.reason, undefined)
    assert.equal(recordingRenderers.length, 2)
    assert.equal(harness.reader['replayViewport'], recordingRenderers[1])
  } finally {
    await harness.close()
  }
})

// Value: protects=the non-abort arm of ensureReplayViewport on its own; fails_when=a renderer whose first reveal failed without a cancellation stays as the replay renderer, which the H5d test cannot see because the failed-readiness handler also drops it; why_new=Cycle 0035 R07d; seam=ensureReplayViewport called directly, without the playback controller
test('a recording renderer whose first reveal fails without a cancellation is released by the renderer setup itself', async () => {
  // Arrange: a recording is selected and no recording renderer exists yet.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.reader['dropReplayViewport']()
    const reveal = harness.holdNextRecordingReveal()

    // Act
    const setup = harness.reader['ensureReplayViewport'](
      new AbortController().signal,
    ).then(
      () => 'ready',
      (error: unknown) => String(error),
    )
    await reveal.started
    reveal.fail(new Error('The recorded application renderer did not start'))
    const outcome = await setup

    // Assert
    assert.equal(
      outcome,
      'Error: The recorded application renderer did not start',
    )
    assert.equal(harness.reader['replayViewport'], undefined)
  } finally {
    await harness.close()
  }
})

const CLOSED_READER_REFUSAL =
  'Error: The replay reader is closed; open the recording before another control.'
const STALE_VIEW_REFUSAL =
  'Error: The displayed study changed. Inspect the current view before acting.'
const PENDING_CHANGE_REFUSAL =
  'Error: A presentation change or reader close is pending. Read its state before another control.'

const panelErrors = (
  harness: Awaited<ReturnType<typeof recordedReaderHarness>>,
): string[] => harness.playbackPanelMessages.at(-1)!.errors

// Value: protects=the Learning replay panel no longer showing a refusal after replay works again; fails_when=a refused panel control is reported under the key only a live-run action clears, so it stays after the recording reopens; why_new=Cycle 0036 R1 (the Codex cloud review's P2 on PR #64); seam=none
test('a replay control refused on a closed reader is no longer shown in the Learning replay panel once the recording is opened again', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.close()
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'seek',
      positionMs: 0,
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      expectedRevision: harness.controller.state().revision,
    })
    await waitUntil(
      () => panelErrors(harness).includes(CLOSED_READER_REFUSAL),
      'the refused seek reaching the Learning replay panel',
      1_000,
    )

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the reopened recording',
      2_000,
    )

    // Assert
    assert.equal(panelErrors(harness).includes(CLOSED_READER_REFUSAL), false)
    assert.equal(harness.reader.inspect().opened, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the Learning replay panel no longer showing a refused control once an agent's control was accepted; fails_when=only the panel's own accepted control retires the refusal, so a line stays after codebook_playback moved the replay; why_new=Cycle 0036 C03c (and 0036 I "replay-control not cleared by service"); seam=none
test('a replay control refused in the Learning replay panel is no longer shown once an agent seek is accepted', async () => {
  // Arrange: the panel sends a seek with a playback revision that is no longer current.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const currentRevision = harness.controller.state().revision,
      staleRefusal = `Error: Stale playback revision; current revision is ${currentRevision}.`
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'seek',
      positionMs: 0,
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      expectedRevision: currentRevision + 1,
    })
    await waitUntil(
      () => panelErrors(harness).includes(staleRefusal),
      'the refused seek reaching the Learning replay panel',
      1_000,
    )

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'seek',
      positionMs: 100,
      expectedRevision: currentRevision,
    })
    await harness.controller.settle()

    // Assert
    assert.equal(panelErrors(harness).includes(staleRefusal), false)
    assert.equal(harness.controller.state().presentedMs, 100)
  } finally {
    await harness.close()
  }
})

// Value: protects=other panel failures keeping their status line, and one line per refused replay control; fails_when=every panel failure moves to the replay key, or the refusal is reported under both keys; why_new=Cycle 0036 R6; seam=none
test('a failed panel message that is not a replay control stays reported after the recording is opened again, and a refused seek is listed once', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.receivePlaybackPanel({
      type: 'understanding',
      understood: true,
      revision: harness.playbackPanelMessages.at(-1)!.revision + 100,
    })
    await waitUntil(
      () => panelErrors(harness).includes(STALE_VIEW_REFUSAL),
      'the stale understanding message reaching the panel',
      1_000,
    )
    await harness.reader.close()
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'seek',
      positionMs: 0,
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      expectedRevision: harness.controller.state().revision,
    })
    await waitUntil(
      () => panelErrors(harness).includes(CLOSED_READER_REFUSAL),
      'the refused seek reaching the panel',
      1_000,
    )
    const refusalsWhileClosed = panelErrors(harness).filter(
      (error) => error === CLOSED_READER_REFUSAL,
    ).length

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the reopened recording',
      2_000,
    )

    // Assert
    assert.equal(refusalsWhileClosed, 1)
    assert.equal(panelErrors(harness).includes(CLOSED_READER_REFUSAL), false)
    assert.equal(panelErrors(harness).includes(STALE_VIEW_REFUSAL), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a replay control sent from an outdated panel view being reported once and retired by the next accepted control; fails_when=the revision check, which runs before the playback branch, reports under the key a replay never clears; why_new=Cycle 0036 R6 (outside voice O2); seam=none
test('a replay control refused for an outdated panel view is listed once and is gone after the next accepted replay control', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'seek',
      positionMs: 100,
      revision: harness.playbackPanelMessages.at(-1)!.revision + 100,
      expectedRevision: harness.controller.state().revision,
    })
    await waitUntil(
      () => panelErrors(harness).includes(STALE_VIEW_REFUSAL),
      'the outdated seek reaching the panel',
      1_000,
    )
    const refusals = panelErrors(harness).filter(
      (error) => error === STALE_VIEW_REFUSAL,
    ).length
    const presentedAfterRefusal = harness.controller.state().presentedMs

    // Act
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'seek',
      positionMs: 100,
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      expectedRevision: harness.controller.state().revision,
    })
    await waitUntil(
      () => harness.controller.state().presentedMs === 100,
      'the accepted seek presenting its moment',
      2_000,
    )
    await harness.controller.settle()

    // Assert
    assert.equal(refusals, 1)
    assert.equal(presentedAfterRefusal, 0)
    assert.equal(panelErrors(harness).includes(STALE_VIEW_REFUSAL), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=a replay control refused during a pending reader change being reported once and retired when replay works again; fails_when=the idle check, which runs before the playback branch, reports under the key a replay never clears; why_new=Cycle 0036 R6 (outside voice O2); seam=none
test('a play sent from the Learning replay panel while the reader is closing is listed once and is gone after the recording is opened again', async () => {
  // Arrange: Close is waiting for the editor to stop the historical session.
  const harness = await recordedReaderHarness(true, true)
  let releaseDisposal = (): void => {}
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const disposal = harness.holdHistoricalDebugDisposal()
    releaseDisposal = disposal.release
    const closing = harness.reader.close()
    await disposal.started
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'play',
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      expectedRevision: harness.controller.state().revision,
    })
    await waitUntil(
      () => panelErrors(harness).includes(PENDING_CHANGE_REFUSAL),
      'the refused play reaching the panel',
      1_000,
    )
    const refusals = panelErrors(harness).filter(
      (error) => error === PENDING_CHANGE_REFUSAL,
    ).length
    disposal.release()
    await closing

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the reopened recording',
      2_000,
    )

    // Assert
    assert.equal(refusals, 1)
    assert.equal(panelErrors(harness).includes(PENDING_CHANGE_REFUSAL), false)
    assert.equal(harness.controller.state().mode, 'paused')
  } finally {
    releaseDisposal()
    await harness.close()
  }
})

// Value: protects=the Learning replay panel dropping a closed-reader refusal once an agent reopens the recording through playback control; fails_when=only the editor's own open command retires the refusal, so a recording reloaded through the service keeps showing it; why_new=every other replay-control test reopens through openRecording, which retires the refusal before the load starts; seam=none
test('a replay control refused on a closed reader is no longer shown in the Learning replay panel once an agent opens the recording again', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.close()
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'seek',
      positionMs: 0,
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      expectedRevision: harness.controller.state().revision,
    })
    await waitUntil(
      () => panelErrors(harness).includes(CLOSED_READER_REFUSAL),
      'the refused seek reaching the Learning replay panel',
      1_000,
    )

    // Act
    harness.service.playback({
      instanceId: harness.service.instanceId,
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    await waitUntil(
      () => harness.controller.state().readiness === 'ready',
      'the recording reopened by the agent',
      2_000,
    )

    // Assert
    assert.equal(panelErrors(harness).includes(CLOSED_READER_REFUSAL), false)
    assert.equal(harness.reader.inspect().opened, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a refused replay control leaving the panel once the learner's next live-run action succeeds; fails_when=the refusal sits under a key that only a replay event retires, so it stays listed through a later live run; why_new=the replay-control tests retire the refusal through replay events only, and base retired it on any successful live action; seam=none
// Regression proof: fails at a75942d (panel replay failures moved from the `control` key to `replay-control`, which a live-run action does not retire), passes on origin/main dceea3f.
test('a replay control refused on a closed reader is no longer shown in the Learning replay panel once a later live-run action succeeds', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.close()
    harness.receivePlaybackPanel({
      type: 'playback',
      action: 'seek',
      positionMs: 0,
      revision: harness.playbackPanelMessages.at(-1)!.revision,
      expectedRevision: harness.controller.state().revision,
    })
    await waitUntil(
      () => panelErrors(harness).includes(CLOSED_READER_REFUSAL),
      'the refused seek reaching the Learning replay panel',
      1_000,
    )
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    const nextRun = [...harness.service.records.values()].at(-1)!
    await nextRun.preparation

    // Act
    await harness.reader.action('click')

    // Assert
    assert.equal(harness.runtimes.at(-1)!.dispatches, 1)
    assert.equal(panelErrors(harness).includes(CLOSED_READER_REFUSAL), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=the summary and transport of a recording of this session's own run showing no foreign error line; fails_when=the recording's study is selected before its item, so a reader update during the load pairs the study with the item shown before and reports "Selected item belongs to another configured article.", which nothing retires; why_new=native run of 2026-10-04 (the line stayed for as long as the recording was open, r-l1.json); seam=RecordingStore.read held, reader seams
test('opening the recording of this session’s own run while no study is selected shows no "another configured article" error during or after the load', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true),
    seams = readerSeams(harness),
    read = RecordingStore.prototype.read
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let releaseRead = (): void => {},
    readEntered = (): void => {}
  const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve
    }),
    readStarted = new Promise<void>((resolve) => {
      readEntered = resolve
    })
  RecordingStore.prototype.read = async function (
    this: RecordingStore,
    studyId,
  ) {
    readEntered()
    await readHeld
    return read.call(this, studyId)
  }
  try {
    seams.selectNoStudy()
    await harness.reader.openRecording(harness.studyId)
    await readStarted

    // Act: the reader updates its panes while the recording is still being read, as its timer and its panes' messages do.
    const updateFailures: string[] = []
    try {
      seams.reportPlaybackChange()
    } catch (error) {
      updateFailures.push(String(error))
    }
    await seams.refresh().catch((error: unknown) => {
      updateFailures.push(String(error))
    })
    const linesDuringLoad = seams.errorLines()
    releaseRead()
    await harness.controller.settle()

    // Assert
    assert.deepEqual(updateFailures, [])
    assert.deepEqual(linesDuringLoad, [])
    assert.deepEqual(seams.errorLines(), [])
    assert.equal(harness.controller.state().readiness, 'ready')
  } finally {
    RecordingStore.prototype.read = read
    releaseRead()
    await harness.close()
  }
})

// Regression: Cycle0046 original85 — a native recording open leaves bottom Saved studies for Summary BODY.
// Found by /qa on 2026-10-13; report: docs/cycles/0046-carried-defects-of-cycle-0045.md#original85-recording-open-cause-confirmed-on-c40-2026-10-13
// Value: protects=bottom replay-control keyboard across recording entry; fails_when=native Summary reveal forces focus; why_new=DOM cases omit host focus commands; seam=existing view-focus port; no_claim=native input or pixel proof.
test('opening a recording while the bottom pane holds keyboard reveals Summary without taking that keyboard', async () => {
  // Arrange: both contributed views exist, and the general bottom pane reports its real input ownership.
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.action('return-current')
    await harness.reader.open()
    harness.receivePlaybackPanel({ type: 'pane-focus', focused: true })
    const commandsBefore = harness.viewFocusCommands.length

    // Act: the public recording loader enters the same existing bottom view.
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert: both native reveals preserve the input the bottom renderer already owns.
    assert.deepEqual(harness.viewFocusCommands.slice(commandsBefore), [
      { command: 'codebook.observedMoments.focus', preserveFocus: true },
      { command: 'codebook.learningSummary.focus', preserveFocus: true },
    ])
    assert.equal(harness.controller.state().readiness, 'ready')
  } finally {
    await harness.close()
  }
})

test('an explicit Summary entry still focuses Summary after a recording preserved the bottom keyboard', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.receivePlaybackPanel({ type: 'pane-focus', focused: true })
    const commandsBefore = harness.viewFocusCommands.length

    // Act: a deliberate Summary command is a new learner choice.
    await harness.reader.showLearningSummary()

    // Assert
    assert.deepEqual(harness.viewFocusCommands.slice(commandsBefore), [
      { command: 'codebook.learningSummary.focus', preserveFocus: false },
    ])
  } finally {
    await harness.close()
  }
})

test('a hidden bottom pane never claims keyboard preservation for a later recording entry', async () => {
  // Arrange: a delayed focus report cannot make an invisible view an input owner.
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.action('return-current')
    await harness.reader.open()
    harness.hidePlaybackPanel()
    harness.receivePlaybackPanel({ type: 'pane-focus', focused: true })
    const commandsBefore = harness.viewFocusCommands.length

    // Act
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()

    // Assert: ordinary explicit entry retains its default native focus behavior.
    assert.deepEqual(harness.viewFocusCommands.slice(commandsBefore), [
      { command: 'codebook.observedMoments.focus', preserveFocus: false },
      { command: 'codebook.learningSummary.focus', preserveFocus: false },
    ])
  } finally {
    await harness.close()
  }
})
