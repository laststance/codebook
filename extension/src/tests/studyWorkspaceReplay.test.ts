import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { RecordingStore } from '../recordingStore'
import type { BookObservationBinding } from '../repositorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { ViewportAckTimeoutError } from '../runtimeSupport/utils/viewportAckTimeoutError'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { bookObservationHash } from '../utils/bookObservationHash'
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
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'

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
test('Play across the end of a stop’s recorded pause onto a newer frame keeps the stop’s image painted until the newer frame replaces it at the leave, without a blank, while Run and Debug, the stop’s session and its source highlight end', async () => {
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
    // The newer frame was handed to the pane at the leave (F3, D29), so it is already painted when the moment's own frame is sent for its receipt; the stop's image was never cleared in between.
    assert.deepEqual(imagePresentations, [
      {
        atMs: 900,
        shownBefore: newerPng.toString('base64'),
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

// Value: protects=the Application pane keeping its pixels while a seek's next frame is read from storage, and swapping to that frame without a blank; fails_when=the seek clears the recorded pixels (the `reset` with `clear: true`) before the frame resolves, which showed dark frames at a stop's entry (F3, D29); why_new=Cycle 0050 F3 (Cycle 0044 on Linux: 0.5 to 1.2 s of dark frames and a short Canceled); seam=a held RecordingStore.readFrame and the harness's viewport; no_claim=the webview's own decode and swap (the native check inspects every frame)
test('a seek holds the shown pixels while the next frame is read and swaps to it without clearing the pane', async () => {
  // Arrange: a stop is shown with its frame; the application sent a newer frame at 900 ms.
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
    const viewport = harness.viewportInstances.find(
      (instance) => instance.mode === 'recording',
    )!
    const clearedAtMs: Array<number | undefined> = [],
      clearImage = viewport.clearRecorded.bind(viewport)
    viewport.clearRecorded = (): void => {
      clearedAtMs.push(controller.state().requestedMs)
      clearImage()
    }
    const recordings = harness.reader['recordings']!,
      readFrame = recordings.readFrame.bind(recordings)
    let releaseRead = (): void => {}
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let reads = 0
    recordings.readFrame = async (id, hash) => {
      reads++
      await readHeld
      return readFrame(id, hash)
    }

    // Act: the seek to the newer frame waits for its bytes.
    controller.command({
      action: 'seek',
      studyId,
      expectedRevision: controller.state().revision,
      positionMs: 900,
    })
    await waitUntil(
      () => reads === 1,
      'the seek reads the next frame',
      READER_RESULT_BOUND_MS,
    )
    const shownWhileHeld = harness.displayedImage(),
      clearedWhileHeld = [...clearedAtMs]
    releaseRead()
    await controller.settle()

    // Assert
    assert.equal(shownWhileHeld, png.toString('base64'))
    assert.deepEqual(clearedWhileHeld, [])
    assert.deepEqual(clearedAtMs, [])
    assert.equal(harness.displayedImage(), newerPng.toString('base64'))
  } finally {
    await harness.close()
  }
})

// Value: protects=a seek whose preview frame the viewport drops (a required frame is pending) clearing the pane instead of leaving the earlier moment's pixels beside the next moment's source and values; fails_when=the invalidation ignores that previewRecorded returned false, so the earlier frame stays painted while the next moment's debugger and source are shown; why_new=Cycle 0050 F374 (the fake showed every preview at once and the product never read whether a preview was posted); seam=the harness's fake recorded viewport dropping previews under holdRequiredFramePending and a held paint of the required frame; no_claim=the webview's own swap
test('a seek whose preview frame is dropped clears the pane rather than keeping the earlier moment’s pixels', async () => {
  // Arrange: a stop is shown with its frame; the application sent a newer frame at 900 ms.
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
    assert.equal(harness.displayedImage(), png.toString('base64'))
    harness.holdRequiredFramePending(true)
    // The required frame of the seek's moment is held in the renderer, so what the pane shows before it paints is what the invalidation left.
    const paint = harness.holdNextImage()

    // Act
    controller.command({
      action: 'seek',
      studyId,
      expectedRevision: controller.state().revision,
      positionMs: 900,
    })
    await paint.started
    const shownBeforePaint = harness.displayedImage()
    paint.release()
    await controller.settle()

    // Assert
    assert.equal(shownBeforePaint, undefined)
    assert.equal(harness.displayedImage(), newerPng.toString('base64'))
  } finally {
    harness.holdRequiredFramePending(false)
    await harness.close()
  }
})

// Value: protects=a seek whose preview frame the viewport drops (a pause image is pinned) clearing the pane instead of leaving the earlier moment's pixels beside the next moment's source and values; fails_when=the invalidation ignores that previewRecorded returned false while a pause image is pinned, so the earlier frame stays painted; why_new=Cycle 0050 F396 (the fake dropped previews only beside a pending required frame, so a regression in the other two drop conditions could not be reproduced); seam=the harness's fake recorded viewport dropping previews under holdPausePinned and a held paint of the required frame; no_claim=the webview's own swap
test('a seek whose preview frame is dropped while a pause image is pinned clears the pane rather than keeping the earlier moment’s pixels', async () => {
  // Arrange: a stop is shown with its frame; the application sent a newer frame at 900 ms.
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
    assert.equal(harness.displayedImage(), png.toString('base64'))
    harness.holdPausePinned(true)
    // The required frame of the seek's moment is held in the renderer, so what the pane shows before it paints is what the invalidation left.
    const paint = harness.holdNextImage()

    // Act
    controller.command({
      action: 'seek',
      studyId,
      expectedRevision: controller.state().revision,
      positionMs: 900,
    })
    await paint.started
    const shownBeforePaint = harness.displayedImage()
    paint.release()
    await controller.settle()

    // Assert
    assert.equal(shownBeforePaint, undefined)
    assert.equal(harness.displayedImage(), newerPng.toString('base64'))
  } finally {
    harness.holdPausePinned(false)
    await harness.close()
  }
})

// Value: protects=a seek whose preview frame the viewport drops (the delivery has no renderer epoch) clearing the pane instead of leaving the earlier moment's pixels beside the next moment's source and values; fails_when=the invalidation ignores that previewRecorded returned false while the delivery has no renderer epoch, so the earlier frame stays painted; why_new=Cycle 0050 F396 (the fake dropped previews only beside a pending required frame, so a regression in the other two drop conditions could not be reproduced); seam=the harness's fake recorded viewport dropping previews under holdRendererEpochMissing and a held paint of the required frame; no_claim=the webview's own swap
test('a seek whose preview frame is dropped while the renderer has no epoch clears the pane rather than keeping the earlier moment’s pixels', async () => {
  // Arrange: a stop is shown with its frame; the application sent a newer frame at 900 ms.
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
    assert.equal(harness.displayedImage(), png.toString('base64'))
    harness.holdRendererEpochMissing(true)
    // The required frame of the seek's moment is held in the renderer, so what the pane shows before it paints is what the invalidation left.
    const paint = harness.holdNextImage()

    // Act
    controller.command({
      action: 'seek',
      studyId,
      expectedRevision: controller.state().revision,
      positionMs: 900,
    })
    await paint.started
    const shownBeforePaint = harness.displayedImage()
    paint.release()
    await controller.settle()

    // Assert
    assert.equal(shownBeforePaint, undefined)
    assert.equal(harness.displayedImage(), newerPng.toString('base64'))
  } finally {
    harness.holdRendererEpochMissing(false)
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
    const owner = harness.reader['replayDebuggers'].current
    assert.ok(owner)
    owner.dispose = async (): Promise<void> => {
      throw new Error('The historical debugger did not stop.')
    }
    await harness.reader['replayDebuggers'].retire(owner)
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
    const owner = harness.reader['replayDebuggers'].current
    assert.ok(owner)
    owner.dispose = async (): Promise<void> => {
      throw new Error('The historical debugger did not stop.')
    }

    // Act
    await harness.reader['replayDebuggers'].retire(owner)

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
