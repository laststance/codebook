import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { readerSeams, workspaceHarness } from './studyWorkspaceHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'

// Cycle 0046 task5: a verified built-in chat command must not wait for another native catalog reply at each pause.
// Value: protects=subsequent chat keyboard restoration; fails_when=every pause reacquires a stalled catalog; why_new=existing cases hold layout or capture, not repeated catalog discovery; seam=none; no_claim=continuous native focus (controlled editor fixture).
test('Cursor chat regains keyboard at a later pause while a redundant command catalog reply is stalled', async (context) => {
  // Arrange: the first real return confirms the command in this host session.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  let release = (): void => {}
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.focusMutableDraft('actions.ts', 2)
    chat.focus()
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    await waitUntil(() => chat.focused(), 'first verified chat return', 300)
    const originalCommands = harness.editor.commands.getCommands
    const heldCatalog = new Promise<void>((resolve) => {
      release = resolve
    })
    context.mock.method(harness.editor.commands, 'getCommands', async () => {
      await heldCatalog
      return originalCommands()
    })

    // Act: the next real pause must not wait for a catalog the host already answered.
    harness.focusMutableDraft('auth.ts', 2)
    harness.pauseDebugger()
    await waitUntil(
      () => chat.focused(),
      'subsequent chat keyboard while redundant catalog reply is stalled',
      300,
    )

    // Assert
    assert.equal(chat.focused(), true)
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      ['composer.focusComposer', 'composer.focusComposer'],
    )
  } finally {
    release()
    context.mock.restoreAll()
    live?.close()
    await harness.close()
  }
})

test('Cursor chat regains keyboard when its command becomes available after an earlier pause could not return it', async (context) => {
  // Arrange: this host has not registered its chat command at the first pause.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  let isChatCommandRegistered = false
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    const originalCommands = harness.editor.commands.getCommands
    context.mock.method(harness.editor.commands, 'getCommands', async () => {
      const commands = await originalCommands()
      return isChatCommandRegistered
        ? commands
        : commands.filter((command) => command !== 'composer.focusComposer')
    })
    harness.focusMutableDraft('actions.ts', 2)
    chat.focus()
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    await harness.reader['returnsKeyboardToChatAtPause']()
    assert.equal(chat.focused(), false)

    // Act: a later registered command must remain discoverable in the same reader.
    isChatCommandRegistered = true
    harness.focusMutableDraft('auth.ts', 2)
    harness.pauseDebugger()
    await waitUntil(() => chat.focused(), 'newly available chat keyboard', 300)

    // Assert
    assert.equal(chat.focused(), true)
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      ['composer.focusComposer'],
    )
  } finally {
    context.mock.restoreAll()
    live?.close()
    await harness.close()
  }
})

test('Cursor chat regains keyboard at a pause despite a stalled layout query when its source tab report is stale', async () => {
  // Arrange: Cursor names a visible source tab while its separate chat holds the keyboard.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  let release = (): void => {}
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.focusMutableDraft('actions.ts', 2)
    chat.focus()
    assert.equal(chat.focused(), true)
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release

    // Act: a debugger pause must return the known chat without waiting for another part's layout.
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    await waitUntil(
      () => chat.focused(),
      'known chat keyboard while the native layout reply is held',
      300,
    )

    // Assert
    assert.equal(chat.focused(), true)
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      ['composer.focusComposer'],
    )
  } finally {
    release()
    live?.close()
    await harness.close()
  }
})

// Cycle 0046 task5: historical capture can occupy its full bound before any captured-source render reaches the reader.
test('Cursor chat is usable at a debugger pause before historical capture publishes its observation', async () => {
  // Arrange: retain the chat while a prepared live run has not published a pause.
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
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()

    // Act: the native debugger opens the stopped file while capture remains unpublished.
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    await waitUntil(
      () => chat.focused(),
      'chat keyboard before the historical capture is published',
      300,
    )

    // Assert: rendering the eventual capture does not perform a second return.
    assert.equal(chat.focused(), true)
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    assert.equal(chat.focused(), true)
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

test('a file chosen while the early chat return waits keeps native keyboard ownership through the next pause', async (t) => {
  // Arrange: the stopped file is known, but command discovery has not answered.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  let release = (): void => {}
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    await held.started
    // This second observer joins the existing pending return; it creates no new return.
    const returning = harness.reader['returnsKeyboardToChatAtPause']()

    // Act: a later learner choice wins before native command discovery settles.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    const chosen = harness.focusMutableDraft('learner-notes.ts', 2)
    held.release()
    await returning

    // Assert
    assert.equal(chat.focused(), false)
    assert.equal(
      harness.focusedSource()?.document.uri.toString(),
      chosen.document.uri.toString(),
    )
    // A second frame can arrive without an intermediate running-thread event.
    clockMs += 3_000
    harness.focusMutableDraft('auth.ts', 2)
    harness.pauseDebugger()
    clock.mock.restore()
    await harness.revealApplicationPaneOverPausedFile()
    assert.equal(chat.focused(), false)
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      [],
    )
  } finally {
    release()
    live?.close()
    await harness.close()
  }
})

test('Read Source revokes a pending chat return when the captured source is already ready', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  let release = (): void => {}
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release
    harness.focusMutableDraft('actions.ts', 1)
    harness.pauseDebugger()
    await held.started
    const returning = harness.reader['returnsKeyboardToChatAtPause']()
    assert.equal(harness.reader['sourceReady'](), true)

    // Act: this ready-source path does not render a new source document.
    await harness.reader.action('read-source')
    held.release()
    await returning

    // Assert
    assert.equal(chat.focused(), false)
    assert.equal(
      harness.focusedSource()?.document.uri.scheme,
      'codebook-source',
    )
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      [],
    )
  } finally {
    release()
    live?.close()
    await harness.close()
  }
})

test('a newly displayed capture retains its pending chat return before its source identity is published', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  let release = (): void => {}
  try {
    await harness.reader.open()
    readerSeams(harness).stopOwnTimer()
    const previousSource = harness.reader['sourceUri']?.toString()
    assert.equal(typeof previousSource, 'string')
    const nextSource = createConfiguredStudy().descriptor?.sources[1]
    assert.ok(nextSource)
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: {
        ...harness.configuration,
        book: { ...harness.configuration.book, anchorIndex: 1 },
        source: {
          path: nextSource.path,
          hash: nextSource.hash,
          line: 1,
          column: 1,
        },
      },
      key: randomUUID(),
    })
    const record = harness.service.record(receipt)
    await record.preparation
    live = harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    const commandsBeforePause = harness.commands.length
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release
    harness.focusMutableDraft('mode.ts', 2)
    harness.pauseDebugger()
    await held.started

    // Act: capture finishes while native command discovery is still pending.
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    const rendered = readerSeams(harness).refresh()
    await waitUntil(
      () =>
        harness.focusedSource()?.document.uri.scheme === 'codebook-source' &&
        harness.focusedSource()?.document.uri.toString() !== previousSource,
      'new capture displayed before its pending return settles',
      2_000,
    )
    assert.notEqual(
      harness.reader['sourceUri']?.toString(),
      harness.focusedSource()?.document.uri.toString(),
    )
    held.release()
    await rendered

    // Assert
    assert.equal(chat.focused(), true)
    // The pause and the first live arrangement each return their own borrowed focus.
    assert.deepEqual(
      harness.commands
        .slice(commandsBeforePause)
        .filter((command) => command === 'composer.focusComposer'),
      ['composer.focusComposer', 'composer.focusComposer'],
    )
  } finally {
    release()
    live?.close()
    await harness.close()
  }
})

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

for (const arrival of [
  {
    afterStoppedMs: 468,
    name: '468 ms after its stopped event, the longest time measured',
  },
  {
    afterStoppedMs: 779,
    name: '779 ms after its stopped event, one millisecond before the editor can pass the focus',
  },
] as const)
  // Value: protects=the keyboard of a learner at a stop that is read right after another session went on, while the editor still shows that session's frame (the last browser stop of a run, read 17 to 23 ms after the server session went on): the editor's own handling of the stop brings its frame at its second try, when the rest of the call stack is loaded, with the keyboard in the paused file, and the Application pane that covers the file takes the keyboard, so it is on an element; fails_when=such a stop counts only for a frame within 500 ms of its stopped event, which lies 32 to 50 ms above the 450 to 468 ms the editor needs on an idle machine, so that on a slower one the frame is taken for a passed focus, the pane comes without the keyboard over the file that has it, the keyboard is on no element and nothing is told; why_new=Cycle 0046 row 321 (native round in VS Code 1.140.0, check V-08, nine runs of nine); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger for two sessions with staysInBackground, continueDebugSession, resumeDebugger, the clock of performance.now held for the editor events, revealApplicationPaneOverPausedFile
  test(`a browser stop read 20 ms after the server session went on, behind the server's frame, gives the paused file the keyboard when its frame arrives ${arrival.name}: the Application pane that covers it takes the keyboard`, async (t) => {
    // Arrange: a live run whose server session stopped; the debugger opened the paused file with the keyboard.
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
        opensWithKeyboard: { filename: 'actions.ts', column: 2 },
      })
      const revealsBefore = harness.panelReveals().length

      // Act: on a held clock the server session goes on, the browser's adapter reports its stop 20 ms later while the editor still shows the server's frame, the editor reports the server's thread 204 ms after the server went on, and the browser's frame arrives with the paused file opened with the keyboard; then the Application pane comes to the front over that file.
      let clockMs = Math.floor(performance.now())
      const clock = t.mock.method(performance, 'now', () => clockMs)
      harness.continueDebugSession('live-next-server')
      clockMs += 20
      harness.pauseDebugger({
        session: 'live-next-browser',
        staysInBackground: true,
      })
      clockMs += 184
      harness.resumeDebugger()
      clockMs += arrival.afterStoppedMs - 184
      harness.pauseDebugger({
        session: 'live-next-browser',
        startedBeforeTheReader: true,
        opensWithKeyboard: { filename: 'login-form.tsx', column: 1 },
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

// Value: protects=the keyboard of a learner in the Call Stack view while two sessions are paused: a stop that was read behind the frame of a session that is still paused is not brought to the front by the editor, so a frame of it that arrives is one the learner selected, and nothing takes the keyboard from the view; fails_when=every frame within half a second of a stop counts as that stop's own, also while another session's frame keeps the focus, so the pane takes the keyboard from the Call Stack view and tells a sentence about a file the debugger never gave the keyboard; why_new=Cycle 0046 row 321 (the other side of the rule that replaced the time since the stop: before the other session goes on, the editor's own handling of the stop brings nothing); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger for two sessions with staysInBackground, passFocusToStoppedSession for a frame that is opened without the keyboard, focusView, revealApplicationPaneOverPausedFile
test('a server stop read while the browser session is paused again is not shown by its own handling: a frame of it that arrives 300 ms later leaves the keyboard in the Call Stack view, and no notice is told', async (t) => {
  // Arrange: a live run whose browser session stopped; the debugger opened the paused file with the keyboard.
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

    // Act: on a held clock the browser session goes on and stops again 100 ms later, and the learner clicks into the Call Stack view; the server stops while the browser session stays paused; 300 ms later the learner selects the server's frame in the Call Stack view, which opens its file without the keyboard; then the run's capture is rendered and the Application pane comes to the front.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.continueDebugSession('live-next-browser')
    clockMs += 100
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'login-form.tsx', column: 2 },
    })
    harness.focusView()
    const before = {
      shows: harness.textDocumentShows().length,
      reveals: harness.panelReveals().length,
    }
    harness.pauseDebugger({ staysInBackground: true })
    clockMs += 300
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
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner at a stop that was read behind the frame of a debug session the reader does not hear (it started before the reader): nothing tells the reader when that session went on, so the stop counts as shown by its own handling, and the Application pane that covers the paused file takes the keyboard; fails_when=the reader takes such a frame for a passed focus, the pane comes without the keyboard over a file that may have it, and the keyboard is on no element without a word, which is the worse of the two errors; why_new=Cycle 0046 row 321 (what the reader does when it cannot tell, stated in the docstring of cameBeforeFocusPass); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger with startedBeforeTheReader for a session without a tracker and with staysInBackground, resumeDebugger, the clock of performance.now held for the editor events, revealApplicationPaneOverPausedFile
test('a server stop read behind the frame of a session the reader does not hear counts as shown by its own handling however late its frame arrives: the Application pane that covers the paused file takes the keyboard', async (t) => {
  // Arrange: a live run; a browser session that started before the reader is paused, and the editor shows its frame.
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
      startedBeforeTheReader: true,
      opensWithKeyboard: { filename: 'login-form.tsx', column: 2 },
    })
    const revealsBefore = harness.panelReveals().length

    // Act: on a held clock the server's adapter reports its stop behind that frame; the browser session goes on unheard, the editor reports its thread, and two seconds later the server's frame arrives with the paused file opened with the keyboard; then the Application pane comes to the front over that file.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.pauseDebugger({ staysInBackground: true })
    clockMs += 200
    harness.resumeDebugger()
    clockMs += 1_800
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
  'opens it with a double click after the editor sent its whole tab model again',
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
      // Cursor's extension host makes every tab object anew with such an update (Cycle 0046 row 356): the kept tab is known by its file and group, not by the object.
      if (
        sign ===
        'opens it with a double click after the editor sent its whole tab model again'
      )
        harness.selectStackFrame(
          'page.tsx',
          1,
          'double-click-after-tab-model-update',
        )
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

for (const course of [
  {
    name: 'is reported as a new object while it is a preview tab still',
    state: { isPreview: true, isDirty: false },
  },
  {
    name: 'is reported as a new object kept open by an edit with unsaved text',
    state: { isPreview: false, isDirty: true },
  },
  {
    name: 'is replaced by a kept tab of another file in the same column',
    state: { isPreview: false, isDirty: false, filename: 'another-frame.tsx' },
  },
  {
    name: 'is reported as a kept tab in another column',
    state: { isPreview: false, isDirty: false, column: 2 },
  },
] as const)
  // Value: protects=the keyboard of a learner in the Call Stack view after one click on a frame whose file opens as a preview tab: the tab as the editor shows it now decides, so a tab that is still a preview tab, and one that is kept only because its file was edited, are no sign that the learner works in that file, and the Application pane comes without the keyboard; fails_when=the reader does not read the current tab's preview and unsaved state, so any later tab event, or an agent's edit, makes the pane take the keyboard from the Call Stack view and tell a sentence about a file the learner never worked in; why_new=Cycle 0046 row 356 (the current tab's values, read from the tab in front and not from an object noted earlier); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger, focusView, selectStackFrame with a click on an unopened file, with a repeated report of its tab and with an edit, revealApplicationPaneOverPausedFile
  test(`a frame's file that the learner opened with one click and that ${course.name} is no sign of the learner: the Application pane that comes to the front leaves the keyboard in the Call Stack view`, async () => {
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

      // Act: the learner selects the caller's frame with one click, which opens its file as a preview tab without the keyboard; then the tab's course, and the Application pane comes to the front over it.
      harness.selectStackFrame(
        'page.tsx',
        1,
        'click-on-unopened-file-then-tab-update',
      )
      const oldTab = harness.reportActiveTextTab(course.state)
      await harness.revealApplicationPaneOverPausedFile()

      // Assert: the pane came without the keyboard, which is still in the Call Stack view, and nothing was told.
      assert.deepEqual(
        harness
          .panelReveals()
          .slice(revealsBefore)
          .map((reveal) => reveal.preserveFocus),
        [true],
      )
      assert.equal(harness.keyboardInView(), true)
      assert.deepEqual(harness.informationMessages, [])
      assert.deepEqual(
        { isPreview: oldTab.isPreview, isDirty: oldTab.isDirty },
        { isPreview: true, isDirty: false },
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
