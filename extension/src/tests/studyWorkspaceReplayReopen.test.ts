import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { RecordingStore } from '../recordingStore'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { recordedReaderHarness, readerSeams } from './studyWorkspaceHarness'
import {
  advanceClock,
  advanceClockUntil,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'

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
      key: 'paused',
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
// Found by /qa on 2026-10-13; report: https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/cycles/0046-carried-defects-of-cycle-0045.md#original85-recording-open-cause-confirmed-on-c40-2026-10-13
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
