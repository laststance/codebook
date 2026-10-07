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

for (const sign of [
  'clicks into its file',
  'presses a key in its file after the Navigate Call Stack command',
  'opens it with a double click',
  'goes to another file in that group',
] as const)
  // Value: protects=the keyboard of a learner who, at a frame that came without a stop, works in the text editor the Application pane then covers: the pane takes the keyboard, so it is on an element; fails_when=after a frame without a stop the reader holds for the rest of the pause that the covered editor has no keyboard, whatever the editor reports afterwards (a selection made with the mouse or the keyboard in it, a text editor that becomes active, the frame's preview tab kept open by the second click), so the pane comes without the keyboard over the editor the learner types in and the keyboard is on no element; why_new=Cycle 0046 rows 263 (second limit: a double click) and 273 (delegated review, finding 6: a click into the file, the navigation command); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger, focusView, selectStackFrame with its three gestures, workInActiveTextEditor, focusMutableDraft, revealApplicationPaneOverPausedFile
  test(`a learner who selects a frame and then ${sign} has the keyboard in that editor: the Application pane that covers it takes the keyboard`, async () => {
    // Arrange: a live run paused; the debugger opened the paused file in the Application pane's group, and the learner clicked into the Call Stack view.
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
        opensWithKeyboard: { filename: 'actions.ts', column: 1 },
      })
      harness.focusView()
      const revealsBefore = harness.panelReveals().length

      // Act: the learner selects the caller's frame, whose file the editor opens in the same group, and gives the sign; then the Application pane comes to the front over that group.
      if (sign === 'clicks into its file') {
        harness.selectStackFrame('page.tsx', 1)
        harness.workInActiveTextEditor('mouse')
      }
      if (
        sign ===
        'presses a key in its file after the Navigate Call Stack command'
      ) {
        harness.selectStackFrame('page.tsx', 1, 'navigation-command')
        harness.workInActiveTextEditor('keyboard')
      }
      if (sign === 'opens it with a double click')
        harness.selectStackFrame('page.tsx', 1, 'double-click')
      if (sign === 'goes to another file in that group') {
        harness.selectStackFrame('page.tsx', 1)
        harness.focusMutableDraft('learner-notes.ts', 1)
      }
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

// Value: protects=the keyboard of a learner who, at a frame selected in the Call Stack view, clicks into that frame's file in the captured source's group: the captured source the reader shows in its place takes the keyboard, so it is on an element; fails_when=only the Application pane heeds the learner's sign, and the captured source is shown preserving the focus over the editor the learner clicked into; why_new=Cycle 0046 row 273 (the source covers a frame's file as the pane does); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger, the reader's refresh and Retry, focusView, selectStackFrame, workInActiveTextEditor, the text documents shown
test('a learner who selects a frame and then clicks into its file has the keyboard in that editor: the captured source shown in its place takes the keyboard', async () => {
  // Arrange: a live run paused; the reader showed the stop's captured source in the source group, and the learner clicked into the Call Stack view.
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
    const showsBefore = harness.textDocumentShows().length

    // Act: the learner selects the caller's frame, whose file the editor opens over the captured source, clicks into that file, and the reader renders the pause once more.
    harness.selectStackFrame('login-form.tsx', 2)
    harness.workInActiveTextEditor('mouse')
    await harness.reader.action('retry')

    // Assert: the captured source was shown with the keyboard.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .map((shown) => shown.preserveFocus),
      [false],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in the Call Stack view at a selected frame while the reader renders the pause again: the reader's own showing of the captured source over the frame's file, and the selection it sets there, are no sign of the learner, and the Application pane that then comes to the front leaves the keyboard in the view; fails_when=every text editor that becomes active after a frame, or every change of a selection, counts as the learner's choice of that editor, so the reader's own render makes the pane take the keyboard from the Call Stack view at its next reveal; why_new=Cycle 0046 row 273 (the bound of its fix: only what the learner did is a sign); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger, focusView, selectStackFrame, the reader's Retry, revealApplicationPaneOverPausedFile
test("the reader's own showing of the captured source at a selected frame is no sign of the learner: the Application pane that comes to the front afterwards leaves the keyboard in the Call Stack view", async () => {
  // Arrange: a live run paused, its captured source shown; the learner clicked into the Call Stack view and selected the caller's frame, whose file the editor opened over the captured source.
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
    harness.selectStackFrame('login-form.tsx', 2)
    const before = {
      shows: harness.textDocumentShows().length,
      reveals: harness.panelReveals().length,
    }

    // Act: the reader renders the pause once more, which shows the captured source over the frame's file, and the Application pane comes to the front.
    await harness.reader.action('retry')
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: the source was shown and the pane revealed, both without the keyboard, which is still in the Call Stack view.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(before.shows)
        .map((shown) => shown.preserveFocus),
      [true],
    )
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(before.reveals)
        .filter((reveal) => !reveal.preserveFocus),
      [],
    )
    assert.equal(harness.keyboardInView(), true)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in the Call Stack view at a selected frame when a command moves the selection in that frame's file (the editor's own jump to a line, another extension): that is no sign of the learner, and the Application pane that comes to the front leaves the keyboard in the view; fails_when=every change of a selection counts as the learner's work in that editor, whatever the editor says about how it changed, so the pane takes the keyboard from the Call Stack view; why_new=Cycle 0046 row 273 (the bound of its fix: a selection is a sign only when the editor names the mouse or the keyboard as its cause); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger, focusView, selectStackFrame, jumpInActiveTextEditor, revealApplicationPaneOverPausedFile
test("a selection that a command moves in a selected frame's file is no sign of the learner: the Application pane that comes to the front leaves the keyboard in the Call Stack view", async () => {
  // Arrange: a live run paused; the learner clicked into the Call Stack view and selected the caller's frame.
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
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    harness.focusView()
    harness.selectStackFrame('page.tsx', 1)
    const revealsBefore = harness.panelReveals().length

    // Act: a command moves the selection in the frame's file, and the Application pane comes to the front.
    harness.jumpInActiveTextEditor()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: the pane came without the keyboard, which is still in the Call Stack view.
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [true],
    )
    assert.equal(harness.keyboardInView(), true)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner who clicked into a frame's file and then went back to the Call Stack view and selected another frame: the sign belonged to the frame before, and the Application pane that comes to the front leaves the keyboard in the view; fails_when=a sign of the learner outlives the frame it was given at, so every later frame of the pause counts as one whose file has the keyboard, and the pane takes the keyboard from the Call Stack view; why_new=Cycle 0046 row 273 (the bound of its fix: a sign holds until the next stack item); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger, focusView, selectStackFrame, workInActiveTextEditor, revealApplicationPaneOverPausedFile
test("a learner who clicked into a frame's file and then selects another frame in the Call Stack view has the keyboard in that view: the Application pane that comes to the front leaves it there", async () => {
  // Arrange: a live run paused; the learner selected the caller's frame in the Call Stack view and clicked into its file.
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
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    harness.focusView()
    harness.selectStackFrame('page.tsx', 1)
    harness.workInActiveTextEditor('mouse')
    const revealsBefore = harness.panelReveals().length

    // Act: the learner clicks into the Call Stack view again and selects a third frame; then the Application pane comes to the front.
    harness.focusView()
    harness.selectStackFrame('layout.tsx', 1)
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: the pane came without the keyboard, which is still in the Call Stack view.
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [true],
    )
    assert.equal(harness.keyboardInView(), true)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner at a pause whose stacks the debug adapter declares invalid: the editor handles the stop again and opens the paused file with the keyboard, and the Application pane that covers the file takes it, so the keyboard is on an element; fails_when=only a stopped event counts as a stop, so the frame the editor reports after an invalidated event is taken for one the learner selected and the pane comes without the keyboard over the file that has it; why_new=Cycle 0046 row 273 (delegated review, finding 6, case c); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger, focusView, selectStackFrame, invalidateStacks, revealApplicationPaneOverPausedFile
test('a pause whose stacks the adapter declares invalid gives the paused file the keyboard again: the Application pane that covers it takes the keyboard', async () => {
  // Arrange: a live run paused; the learner clicked into the Call Stack view and selected the caller's frame.
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
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    harness.focusView()
    harness.selectStackFrame('page.tsx', 1)
    const revealsBefore = harness.panelReveals().length

    // Act: the adapter declares the stacks invalid, the editor handles the stop again, and the Application pane comes to the front over the paused file.
    harness.invalidateStacks({ filename: 'actions.ts', column: 1 })
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

for (const learner of [
  'clicks into the paused file',
  'leaves the keyboard in the view',
] as const)
  // Value: protects=the keyboard of a learner who turned debug.focusEditorOnBreak off, at a stop of a live run: the debugger opens the paused file without the keyboard, so the Application pane that covers it leaves the keyboard where it is; once the learner clicked into that file the pane takes the keyboard, so it is on an element, and Codebook says where it is with the sentence for a file the learner worked in; fails_when=with the setting off nothing the learner does counts, so the pane covers the file the learner clicked into without taking the keyboard, which is then on no element; or the reader takes every stop for one that gave the file the keyboard, takes the keyboard from the view and tells that the debugger opened the file with it; why_new=Cycle 0046 row 293 (the setting was read by the viewport alone, which knows nothing of the learner's signs); seam=workspace harness with the controlled runtime, a live run's viewport, focusMutableDraft, focusView, openFileWithoutKeyboard, pauseDebugger with the setting off, workInActiveTextEditor, revealApplicationPaneOverPausedFile, the information messages
  test(`at a stop with debug.focusEditorOnBreak off, a learner who ${learner} ${learner === 'clicks into the paused file' ? 'has the keyboard in that file: the Application pane that covers it takes the keyboard and Codebook says so' : 'keeps it there: the Application pane that covers the paused file comes without the keyboard and nothing is told'}`, async () => {
    // Arrange: a live run; the Application pane's group is the active one, the learner works in a view, and the debugger opens the paused file there without the keyboard and reports the stop.
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
      harness.focusMutableDraft('learner-notes.ts', 1)
      harness.focusView()
      harness.openFileWithoutKeyboard('actions.ts', 1)
      harness.pauseDebugger({ focusesEditorOnBreak: false })
      const revealsBefore = harness.panelReveals().length

      // Act: the learner clicks into the paused file, or does not; then the Application pane comes to the front over it.
      if (learner === 'clicks into the paused file')
        harness.workInActiveTextEditor('mouse')
      await harness.revealApplicationPaneOverPausedFile()

      // Assert
      assert.deepEqual(
        harness
          .panelReveals()
          .slice(revealsBefore)
          .map((reveal) => reveal.preserveFocus),
        [learner !== 'clicks into the paused file'],
      )
      assert.deepEqual(
        harness.informationMessages.map((message) => message.message),
        learner === 'clicks into the paused file'
          ? [
              'A Codebook pane (the Application pane or the captured source) came to the front over the file you were working in and has the keyboard now: a hidden file cannot keep it. Click where you want to type.',
            ]
          : [],
      )
      assert.equal(
        harness.keyboardInView(),
        learner !== 'clicks into the paused file',
      )
    } finally {
      live?.close()
      await harness.close()
    }
  })

// Value: protects=the keyboard of a learner who clicks into a file in the Application pane's group while a live run's session runs: the pane that comes to the front over that file takes the keyboard, so it is on an element, and Codebook says where it is; fails_when=while no frame is shown the pane always comes preserving the focus, because the keyboard "cannot be told", so it covers the editor the learner just clicked into and the keyboard is on no element; why_new=Cycle 0046 row 293 (the learner's own selection tells it); seam=workspace harness with the controlled runtime, a live run's viewport, focusMutableDraft, pauseDebugger and resumeDebugger (the session's thread), workInActiveTextEditor, revealApplicationPaneOverPausedFile, the information messages
test('a learner who clicks into a file while the session runs has the keyboard in that file: the Application pane that covers it takes the keyboard and Codebook says so', async () => {
  // Arrange: a live run whose session stopped once and runs again; a file of the learner's is in front of the Application pane's group.
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
    harness.focusMutableDraft('actions.ts', 1)
    harness.pauseDebugger()
    harness.resumeDebugger()
    harness.focusView()
    const revealsBefore = harness.panelReveals().length

    // Act: the learner clicks into the file, and the Application pane comes to the front over it.
    harness.workInActiveTextEditor('mouse')
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: the pane took the keyboard, and the sentence for a file the learner worked in was told.
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [false],
    )
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'A Codebook pane (the Application pane or the captured source) came to the front over the file you were working in and has the keyboard now: a hidden file cannot keep it. Click where you want to type.',
      ],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

for (const since of [
  'clicked into that file four seconds ago',
  'had the file opened from the Explorer with one click',
] as const)
  // Value: protects=the keyboard of a learner who types in a side-view chat, the terminal or a view while a live run's session runs and the Application pane comes to the front over a file: the keyboard stays where it is and nothing is told; fails_when=a click into the file counts for the rest of the run, although nothing reports that the learner went on to the chat, or every text editor that becomes active counts, although the Explorer, Quick Open and an agent that opens the files it edits make one active without the keyboard, so the pane takes the keyboard from the chat input; why_new=Cycle 0046 row 293 (the bounds of its fix while a session runs: only the learner's own selection counts, and only for three seconds); seam=workspace harness with the controlled runtime, a live run's viewport, focusMutableDraft, pauseDebugger and resumeDebugger, workInActiveTextEditor, focusView, openFileWithoutKeyboard, the clock of performance.now held for the editor events, revealApplicationPaneOverPausedFile
  test(`a learner who ${since} while the session runs is not taken to have the keyboard in it: the Application pane that covers the file leaves the keyboard in the view and nothing is told`, async (t) => {
    // Arrange: a live run whose session stopped once and runs again; a file of the learner's is in front of the Application pane's group.
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
      harness.focusMutableDraft('actions.ts', 1)
      harness.pauseDebugger()
      harness.resumeDebugger()
      const revealsBefore = harness.panelReveals().length

      // Act: on a held clock the learner clicks into the file and then into a view, and four seconds pass; or the learner, in a view, opens another file from the Explorer with one click. Then the Application pane comes to the front over that group.
      let clockMs = Math.floor(performance.now())
      const clock = t.mock.method(performance, 'now', () => clockMs)
      if (since === 'clicked into that file four seconds ago') {
        harness.workInActiveTextEditor('mouse')
        harness.focusView()
        clockMs += 4_000
      } else {
        harness.focusView()
        harness.openFileWithoutKeyboard('page.tsx', 1)
      }
      await harness.revealApplicationPaneOverPausedFile()
      clock.mock.restore()

      // Assert: the pane came without the keyboard, which is still in the view, and nothing was told.
      assert.deepEqual(
        harness
          .panelReveals()
          .slice(revealsBefore)
          .map((reveal) => reveal.preserveFocus),
        [true],
      )
      assert.equal(harness.keyboardInView(), true)
      assert.deepEqual(harness.informationMessages, [])
    } finally {
      live?.close()
      await harness.close()
    }
  })
