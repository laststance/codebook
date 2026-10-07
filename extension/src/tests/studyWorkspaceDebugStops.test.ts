import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { readerSeams, workspaceHarness } from './studyWorkspaceHarness'

// Value: protects=the keyboard of a learner who works in a view while a run stops in the browser and then on the server: the server stop that the editor brings to the front later, by its pass of the focus and without the keyboard, takes no keyboard and tells nothing; fails_when=every frame of a session whose adapter reported a stop counts as brought to the front by that stop, with the keyboard in the paused file, so the captured source and the Application pane take the keyboard from the view the learner works in and the notice says the debugger gave the paused file the keyboard, which it did not; why_new=Cycle 0046 row 274 (delegated review, finding 7: both editors skip a stop while a frame of another session has the focus, keep that frame for 200 ms after its session went on, and pass the focus 800 ms after it went on, preserving the focus); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger (a stop that stays in the background), continueDebugSession, resumeDebugger, passFocusToStoppedSession, focusView, the clock of performance.now held for the editor events, the reader's refresh, revealApplicationPaneOverPausedFile
test('a server stop that the editor shows 800 ms after the browser session went on leaves the keyboard where the learner has it: nothing is shown with the keyboard and no notice is told', async (t) => {
  // Arrange: a live run whose browser session stopped; the debugger opened the paused file with the keyboard, and the learner clicked into the Call Stack view.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
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
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'login-form.tsx', column: 2 },
    })
    harness.focusView()
    const before = {
      shows: harness.textDocumentShows().length,
      reveals: harness.panelReveals().length,
    }

    // Act: on a held clock the browser session goes on, the server stops 100 ms later while the editor still shows the browser's frame, the editor reports the browser's thread at 200 ms and the server's frame at 800 ms, opened without the keyboard; then the run's capture is rendered and the Application pane comes to the front.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.continueDebugSession('live-next-browser')
    clockMs += 100
    harness.pauseDebugger({ staysInBackground: true })
    clockMs += 100
    harness.resumeDebugger()
    clockMs += 600
    harness.passFocusToStoppedSession('live-next-server', 'actions.ts', 2)
    clock.mock.restore()
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: the keyboard is still in the Call Stack view; the source and the pane were shown, both without the keyboard, and nothing was told.
    assert.equal(harness.keyboardInView(), true)
    assert.equal(harness.textDocumentShows().length > before.shows, true)
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
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner at a server stop that follows a browser stop so late that the editor already shows the browser's thread, or at once in the same session: the editor's own handling of the stop opens the paused file with the keyboard, and the Application pane that covers it takes the keyboard, so it is on an element; fails_when=a stop is doubted because another session exists or went on at some time, or its frame is held against a time bound although nothing put it in doubt (an adapter that answers slowly), so the pane comes without the keyboard over the file that has it and the keyboard is on no element; why_new=Cycle 0046 row 274 (the bound of its fix: only a stop read while a frame of another session had the focus is in doubt); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger for two sessions, resumeDebugger, the clock of performance.now held for the editor events, revealApplicationPaneOverPausedFile
test("a server stop read after the editor reported the browser's thread gives the paused file the keyboard however late its frame arrives: the Application pane that covers it takes the keyboard", async (t) => {
  // Arrange: a live run whose browser session stopped and went on; the editor reports its thread.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
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
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'login-form.tsx', column: 2 },
    })
    harness.continueDebugSession('live-next-browser')
    harness.resumeDebugger()
    const revealsBefore = harness.panelReveals().length

    // Act: the server's adapter reports its stop, and answers the editor so slowly that the frame arrives two seconds later, with the paused file opened with the keyboard; then the Application pane comes to the front over that file.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.pauseDebugger({ staysInBackground: true })
    clockMs += 2_000
    harness.pauseDebugger({
      startedBeforeTheReader: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    clock.mock.restore()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: the pane took the keyboard.
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [false],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

for (const way of [
  'the session went on before the editor showed it',
  'the adapter asked the editor to keep the focus where it is',
] as const)
  // Value: protects=the keyboard of a learner in the Call Stack view who selects a frame after a stop of the same session that the editor never showed: the frame is a selected frame, and nothing takes the keyboard from the view; fails_when=the note of a stop outlives the stop (its session went on, or the adapter asked not to bring it to the front), so the first frame the learner selects afterwards is taken for that stop: the captured source and the Application pane take the keyboard and the pause notice is told for a stop nobody saw; why_new=Cycle 0046 row 263, first limit (a stop the editor does not bring to the front left its note in place); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger (a second stop that stays in the background, with or without the adapter's preserveFocusHint), continueDebugSession, focusView, selectStackFrame, the clock of performance.now held for the editor events, the reader's Retry, revealApplicationPaneOverPausedFile
  test(`a frame the learner selects after a stop the editor never showed is a selected frame (${way}): the keyboard stays in the Call Stack view and no notice is told`, async (t) => {
    // Arrange: a live run paused on the server, its stop shown; the learner clicked into the Call Stack view.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
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
      live = harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
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
      }

      // Act: on a held clock another thread of that session stops and is not shown; two seconds later the learner selects the caller's frame of the first thread, the reader renders the pause once more and the Application pane comes to the front.
      let clockMs = Math.floor(performance.now())
      const clock = t.mock.method(performance, 'now', () => clockMs)
      harness.pauseDebugger({
        staysInBackground: true,
        keepsFocus:
          way === 'the adapter asked the editor to keep the focus where it is',
      })
      if (way === 'the session went on before the editor showed it')
        harness.continueDebugSession()
      clockMs += 2_000
      harness.selectStackFrame('login-form.tsx', 2)
      clock.mock.restore()
      await harness.reader.action('retry')
      await harness.revealApplicationPaneOverPausedFile()

      // Assert: the keyboard is still in the Call Stack view; whatever was shown was shown without the keyboard, and nothing was told.
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
      assert.equal(harness.informationMessages.length, before.sentences)
    } finally {
      live?.close()
      await harness.close()
    }
  })

// Value: protects=the keyboard of a learner at a stop that the run resumes by itself before the editor showed it (the page's pause at a server stop's breakpoint): the editor's handling of that stop is still on its way and opens the paused file with the keyboard, and the Application pane that covers the file takes it, so the keyboard is on an element; fails_when=the note of a stop is dropped the moment its session goes on, so the frame that arrives right after counts as one the learner selected and the pane comes without the keyboard over the file that has it; why_new=Cycle 0046 row 263 (the bound of its fix: a session that goes on puts its stop in doubt for a later frame, and does not take the stop from the frame that is on its way); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger (the stop's event first, its frame after the resume), continueDebugSession, the clock of performance.now held for the editor events, revealApplicationPaneOverPausedFile
test('a stop that the run resumes before the editor showed it still gives the paused file the keyboard when its frame arrives right after: the Application pane that covers it takes the keyboard', async (t) => {
  // Arrange: a live run and its Application pane.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
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
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    const revealsBefore = harness.panelReveals().length

    // Act: the adapter reports the stop, the run resumes it at once, and 80 ms after the stop the editor's handling of it opens the paused file with the keyboard and reports the frame; then the Application pane comes to the front over that file.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.pauseDebugger({ staysInBackground: true })
    harness.continueDebugSession()
    clockMs += 80
    harness.pauseDebugger({
      startedBeforeTheReader: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    clock.mock.restore()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: the pane took the keyboard.
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [false],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the reader's memory over a long editor session with many debug sessions (every run's browser and server sessions, their child sessions, every replay's): it follows a session only while that session lives; fails_when=the id of every debug session that ever started is kept until the editor closes, and with it a stop the editor never showed stays noted for a session that is gone; why_new=Cycle 0046 row 275 (delegated review, finding 8); seam=workspace harness, pauseDebugger for two sessions (each makes the session's tracker, as the editor does when a session starts), endDebugSession, the reader's followed sessions
test('the reader follows a debug session only while it lives: an ended session is no longer followed, and one that starts again under the same id is followed again', async () => {
  // Arrange: a browser and a server session, both started while the reader exists.
  const harness = await workspaceHarness()
  try {
    harness.pauseDebugger({ session: 'live-next-browser' })
    harness.pauseDebugger()
    const whileBothLive = readerSeams(harness).followedDebugSessions()

    // Act: the browser session ends, and later one starts again under the same id.
    harness.endDebugSession('live-next-browser')
    const afterTheEnd = readerSeams(harness).followedDebugSessions()
    harness.pauseDebugger({ session: 'live-next-browser' })

    // Assert
    assert.deepEqual(whileBothLive, ['live-next-browser', 'live-next-server'])
    assert.deepEqual(afterTheEnd, ['live-next-server'])
    assert.deepEqual(readerSeams(harness).followedDebugSessions(), [
      'live-next-server',
      'live-next-browser',
    ])
  } finally {
    await harness.close()
  }
})
