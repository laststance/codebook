import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { codebookStopLedger } from '../runtimeSupport/codebookStopLedger'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  configuredWorkspaceHarness,
  readerSeams,
  recordedReaderHarness,
  workspaceHarness,
} from './studyWorkspaceHarness'
import { commitNextStop } from './utils/configuredServiceHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'

// Cycle0046 native552: a later frame clears the manual sign while its captured source still has the keyboard.
// Every case uses the same valid two-source capture; only the observable native focus boundary differs.
for (const scenario of [
  {
    name: 'keeps the learner source keyboard after another frame with native focus disabled',
    separatePart: true,
    returnToView: false,
    returnToChat: false,
    providerBoundary: 'ordinary',
    focused: true,
  },
  {
    name: 'leaves the keyboard in chat when the learner returned before the new frame',
    separatePart: true,
    returnToView: false,
    returnToChat: true,
    providerBoundary: 'ordinary',
    focused: true,
  },
  {
    name: 'takes no keyboard from another window after a manual source choice',
    separatePart: true,
    returnToView: false,
    returnToChat: false,
    providerBoundary: 'ordinary',
    focused: false,
  },
  {
    name: 'does not infer source keyboard ownership without a separate editor part',
    separatePart: false,
    returnToView: false,
    returnToChat: false,
    providerBoundary: 'ordinary',
    focused: true,
  },
  {
    name: 'leaves an unreported native view choice alone after the learner left captured source',
    separatePart: true,
    returnToChat: false,
    returnToView: true,
    providerBoundary: 'ordinary',
    focused: true,
  },
  {
    name: 'keeps a pinned native projection immutable when the next captured file arrives',
    separatePart: true,
    returnToChat: false,
    returnToView: false,
    providerBoundary: 'pinned',
    focused: true,
  },
  {
    name: 'keeps a projection pinned during native document I/O immutable and offers Retry',
    separatePart: true,
    returnToChat: false,
    returnToView: false,
    providerBoundary: 'pin-late',
    focused: true,
  },
  {
    name: 'waits for delayed native content delivery before the new captured moment becomes ready',
    separatePart: true,
    returnToChat: false,
    returnToView: false,
    providerBoundary: 'delivery-held',
    focused: true,
  },
  {
    name: 'does not update or commit a live source after Close during native document I/O',
    separatePart: true,
    returnToChat: false,
    returnToView: false,
    providerBoundary: 'close-late',
    focused: true,
  },
]) {
  test(`the next captured source ${scenario.name}`, async () => {
    // Arrange: the learner works in captured source beside a separately identified Cursor chat part.
    const harness = await configuredWorkspaceHarness()
    harness.useHostAppName('Cursor')
    const chat = scenario.separatePart
      ? harness.addSeparateEditorPart()
      : undefined
    let releaseNativeReceipt = (): void => {}
    let releaseSourceDelivery = (): void => {}
    try {
      const secondarySource = harness.study.descriptor!.sources[1]!
      const receipt = harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        key: randomUUID(),
        configuration: {
          ...harness.study.configuration,
          version: 2,
          participant: 'browser',
          additionalStops: [
            {
              participant: 'browser',
              anchorIndex: 1,
              source: {
                path: secondarySource.path,
                hash: secondarySource.hash,
                line: 1,
                column: 1,
              },
              inspections: [{ path: 'mode', mode: 'value', required: true }],
            },
          ],
        },
      })
      const record = harness.service.record(receipt)
      await record.preparation
      await harness.reader.open()
      readerSeams(harness).stopOwnTimer()
      await harness.reader.action('return-current')
      harness.service.action({
        instanceId: harness.service.instanceId,
        runId: record.id,
        key: randomUUID(),
        action: 'repository-click',
      })
      harness.pauseDebugger({ focusesEditorOnBreak: false })
      await readerSeams(harness).refresh()
      const immutableSource = harness.editor.window.visibleTextEditors.find(
        (editor) =>
          editor.document.uri.toString() === harness.reader.inspect().sourceUri,
      )
      assert.ok(immutableSource)
      await harness.reader.action('source')
      harness.workInActiveTextEditor('mouse')
      const runtime = harness.configuredRuntimes[0]!
      const previous = runtime.snapshots[0]!
      const source = secondarySource.text
      const showsBefore = harness.textDocumentShows().length
      const displayedBefore = harness.editor.window.visibleTextEditors.find(
        (editor) => editor.document.uri.scheme === 'codebook-source',
      )
      assert.ok(displayedBefore)
      const displayedUri = displayedBefore.document.uri.toString()
      const displayedTab = harness.groups
        .flatMap((group) => group.tabs)
        .find(
          (tab) =>
            'uri' in tab.input && tab.input.uri.toString() === displayedUri,
        )
      assert.ok(displayedTab)
      if (scenario.providerBoundary === 'pinned') displayedTab.isPinned = true

      // Act: the synthetic reader boundary receives another immutable source version after a running thread and new frame.
      harness.resumeDebugger()
      // A newer chat or window choice revokes ownership before the replacement snapshot is read.
      if (scenario.returnToChat) chat!.focusTab()
      if (scenario.returnToView) harness.focusView()
      harness.changeWindowFocus(scenario.focused)
      harness.pauseDebugger({ focusesEditorOnBreak: false })
      releaseNativeReceipt = harness.reportGroupWithRetainedEditor(1)
      // Drain the frame's old-source repaint before holding the later snapshot's native document acquisition.
      if (
        scenario.providerBoundary === 'pin-late' ||
        scenario.providerBoundary === 'close-late'
      )
        await readerSeams(harness).refresh()
      const next = commitNextStop(runtime)
      const nextSnapshotId = next.id
      const originalSource = runtime.source.bind(runtime)
      // Each synthetic snapshot keeps its own immutable source bytes, including the earlier one during final retirement.
      runtime.source = (item: string, snapshotId?: string) =>
        snapshotId === nextSnapshotId
          ? {
              source,
              javascript: 'emitted javascript',
              sourceMap: 'emitted source map',
            }
          : originalSource(item)
      next.source = {
        ...previous.source,
        text: source,
        hash: secondarySource.hash,
      }
      next.values = { 'value:mode': 'display' }
      next.unavailableValues = []
      const heldOpen =
        scenario.providerBoundary === 'pin-late' ||
        scenario.providerBoundary === 'close-late'
          ? harness.holdNextSource({ uri: displayedUri })
          : undefined
      const heldDelivery =
        scenario.providerBoundary === 'delivery-held'
          ? harness.holdNextSourceUpdate()
          : undefined
      if (heldDelivery) releaseSourceDelivery = heldDelivery.release
      const changesBefore = harness.sourceDocumentChanges().length
      const refreshed = readerSeams(harness).refresh()
      if (heldOpen) {
        await heldOpen.started
        if (scenario.providerBoundary === 'close-late') {
          const closed = harness.reader.close()
          heldOpen.release()
          await refreshed
          await closed
          assert.equal(harness.reader.inspect().opened, false)
          assert.equal(harness.reader.inspect().sourceUri, undefined)
          assert.equal(harness.sourceDocumentChanges().length, changesBefore)
          assert.equal(
            displayedBefore.document.getText(),
            'const nextTheme = "dark";\n',
          )
          return
        }
        displayedTab.isPinned = true
        heldOpen.release()
      }
      if (heldDelivery) {
        await heldDelivery.started
        assert.equal(harness.reader.inspect().view!.loading, true)
        assert.equal(readerSeams(harness).isSourceShown(), false)
        assert.equal(displayedBefore.document.getText(), previous.source.text)
        heldDelivery.release()
      }
      await refreshed
      assert.equal(
        immutableSource.document.getText(),
        'const nextTheme = "dark";\n',
      )

      // Assert: a native pin freezes its captured bytes, including a pin arriving during I/O.
      if (
        scenario.providerBoundary === 'pinned' ||
        scenario.providerBoundary === 'pin-late'
      ) {
        assert.equal(
          displayedBefore.document.getText(),
          'const nextTheme = "dark";\n',
        )
        assert.equal(
          harness.groups.flatMap((group) => group.tabs).includes(displayedTab),
          true,
        )
        if (scenario.providerBoundary === 'pin-late') {
          assert.match(
            harness.reader.inspect().view!.errors.join('\n'),
            /pinned during its update/,
          )
          displayedTab.isPinned = false
          await readerSeams(harness).refresh()
          assert.equal(displayedBefore.document.getText(), source)
        }
        return
      }

      // Assert: updated captured bytes reach the same input without replacing it or taking another context's keyboard.
      assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
      assert.equal(displayedBefore.document.getText(), source)
      assert.equal(
        harness.editor.window.visibleTextEditors.some(
          (editor) => editor.document.uri.toString() === displayedUri,
        ),
        true,
      )
      assert.equal(harness.keyboardInView(), scenario.returnToView)
      if (chat) assert.equal(chat.focused(), scenario.returnToChat)
    } finally {
      releaseSourceDelivery()
      releaseNativeReceipt()
      await harness.close()
    }
  })
}

test('captured source capacity preserves every pinned view and recovers after an older view is unpinned', async () => {
  // Arrange: one real reader boundary has captured a valid source and the learner pins each explicitly opened view.
  const harness = await configuredWorkspaceHarness()
  try {
    await harness.start()
    readerSeams(harness).stopOwnTimer()
    await harness.reader.action('click')
    const pinned = []
    // The existing provider cache has room for 34 captured documents; native pins protect their bytes.
    for (let index = 0; index < 34; index++) {
      await harness.reader.action('source')
      const sourceUri = harness.reader.inspect().sourceUri
      const displayed = harness.editor.window.visibleTextEditors.find(
        (editor) => editor.document.uri.toString() === sourceUri,
      )
      const tab = harness.groups
        .flatMap((group) => group.tabs)
        .find(
          (value) =>
            'uri' in value.input && value.input.uri.toString() === sourceUri,
        )
      assert.ok(displayed)
      assert.ok(tab)
      tab.isPinned = true
      pinned.push({ tab, document: displayed.document })
    }
    const showsBefore = harness.textDocumentShows().length

    // Act: another explicit source open cannot evict a pinned view to obtain space.
    await harness.reader.action('source')

    // Assert: the refusal happens before native replacement, retains all captured bytes and names the recovery.
    assert.equal(pinned.length, 34)
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
    assert.equal(harness.reader.inspect().view!.loading, false)
    assert.match(
      harness.reader.inspect().view!.errors.join('\n'),
      /Captured source view capacity is full/,
    )
    for (const retained of pinned) {
      assert.equal(
        harness.groups.flatMap((group) => group.tabs).includes(retained.tab),
        true,
      )
      assert.equal(retained.document.getText(), 'const nextTheme = "dark";\n')
    }
    pinned[0]!.tab.isPinned = false
    await harness.reader.action('source')
    assert.equal(readerSeams(harness).isSourceShown(), true)
    assert.deepEqual([...harness.reader.inspect().view!.errors], [])
  } finally {
    await harness.close()
  }
})

test('explicit Source in another live run reuses its unpinned native view without accumulating old live tabs', async () => {
  // Arrange: the first live run has an explicitly selected native source view.
  const harness = await configuredWorkspaceHarness()
  try {
    const first = await harness.start()
    readerSeams(harness).stopOwnTimer()
    await harness.reader.action('click')
    await harness.reader.action('source')
    const sourceUri = harness.reader.inspect().sourceUri
    assert.ok(sourceUri)
    await harness.reader.action('stop')

    // Act: the learner explicitly selects Source in the next run of the same workspace.
    const second = await harness.start()
    readerSeams(harness).stopOwnTimer()
    await harness.reader.action('click')
    await harness.reader.action('source')

    // Assert: the view identity stays a view, while the selected captured run changes and old unpinned views retire.
    assert.notEqual(second.id, first.id)
    assert.equal(harness.reader.inspect().sourceUri, sourceUri)
    assert.equal(
      harness.reader.inspect().view!.model.selection.studyId,
      `${harness.service.instanceId}_${second.id}`,
    )
    assert.equal(
      harness.groups
        .flatMap((group) => group.tabs)
        .filter(
          (tab) =>
            'uri' in tab.input &&
            tab.input.uri.path.startsWith('/source-view/'),
        ).length,
      1,
    )
    assert.equal(readerSeams(harness).isSourceShown(), true)
  } finally {
    await harness.close()
  }
})

// Cycle 0046 task5: a retained main-part membership proof must not wait for another part's layout reply.
// Value: protects=known separate-chat keyboard restoration; fails_when=return waits for redundant native layout; why_new=stale-source coverage has no named chat group; seam=none; no_claim=native continuous focus (controlled editor).
test('Cursor chat regains keyboard at a pause despite a stalled layout query when its native group membership is retained', async () => {
  // Arrange: the measured main-part receipt already separates this named chat group.
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
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release

    // Act: a real pause must restore the known foreign group without another layout response.
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger()
    await waitUntil(
      () => chat.focused(),
      'known native chat group while redundant layout reply is stalled',
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

test('a new main editor group cannot inherit the separate chat command from the previous layout receipt', async () => {
  // Arrange: the receipt placed the original chat behind two main groups.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )

    // Act: native group creation occupies the chat's former ordinal in the main part.
    await harness.editor.commands.executeCommand(
      'workbench.action.focusThirdEditorGroup',
    )
    const addedMainGroup = harness.groups.find(
      (group) => group.viewColumn === 3,
    )
    assert.ok(addedMainGroup)
    const command = await readerSeams(harness).focusReturnCommand(
      addedMainGroup,
      true,
    )

    // Assert: an at-pause return never gives a main group the chat command.
    assert.equal(command, undefined)
    assert.deepEqual(
      harness.commands.filter((value) => value === 'composer.focusComposer'),
      [],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

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
    live = await harness.reader.presentation.createViewport(
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
    live = await harness.reader.presentation.createViewport(
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
    live = await harness.reader.presentation.createViewport(
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
    live = await harness.reader.presentation.createViewport(
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
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    // A newly added main group releases the old membership receipt; this case still exercises a pending scope query.
    await harness.editor.commands.executeCommand(
      'workbench.action.focusThirdEditorGroup',
    )
    assert.equal(harness.groups.length, 4)
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
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    // A newly added main group releases the old membership receipt; this case still exercises a pending scope query.
    await harness.editor.commands.executeCommand(
      'workbench.action.focusThirdEditorGroup',
    )
    assert.equal(harness.groups.length, 4)
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

test('a newly displayed capture retains its pending chat return before its source identity is published', async (context) => {
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
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    const commandsBeforePause = harness.commands.length
    const originalCommands = harness.editor.commands.getCommands
    let noteDiscoveryStarted = (): void => {}
    const discoveryStarted = new Promise<void>((resolve) => {
      noteDiscoveryStarted = resolve
    })
    const pendingDiscovery = new Promise<void>((resolve) => {
      release = resolve
    })
    // Membership is known; the first required host-command lookup remains genuinely pending.
    context.mock.method(harness.editor.commands, 'getCommands', async () => {
      noteDiscoveryStarted()
      await pendingDiscovery
      return originalCommands()
    })
    harness.focusMutableDraft('mode.ts', 2)
    harness.pauseDebugger()
    await discoveryStarted

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
    release()
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
    context.mock.restoreAll()
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
    live = await harness.reader.presentation.createViewport(
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

    // Assert: the ambiguous native file stays open; the pane preserves the list input and the capture offers explicit recovery.
    assert.equal(harness.keyboardInView(), true)
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.path.endsWith(
        '/actions.ts',
      ),
      true,
    )
    assert.deepEqual(harness.textDocumentShows().slice(before.shows), [])
    assert.equal(harness.reader.inspect().rendered, undefined)
    assert.match(
      harness.reader.inspect().view!.errors.join('\n'),
      /The native source editor was kept open\. Choose Focus Captured Source to show the capture\./,
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

// Value: protects=the learner's file after "Navigate Down Call Stack" at a live pause in Cursor, while a capture is still being saved; fails_when=the capture's later presentation shows the captured source over that file because the editor still names the Application group as the active group, so the keyboard falls on the window body; why_new=Cycle 0046 original 273 H3 on C51 in Cursor 3.23.12 (after the capture completed, 25 of 45 page samples were BODY; the frame's file in column 2 had the TEXTAREA while tabGroups.activeTabGroup stayed the Application group in column 1); seam=the fake editor's keepNamingGroupAfterFrameNavigation
test("a capture presented after Navigate Down Call Stack keeps the frame's file and its keyboard while Cursor still names the Application group", async () => {
  // Arrange: a live run paused with the stop's file in column 2; the learner put the Application group in front and ran Navigate Down Call Stack, and Cursor kept naming the Application group.
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
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'login-form.tsx', column: 2 },
    })
    await readerSeams(harness).refresh()
    const applicationPane = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.ok(applicationPane)
    harness.focusExistingWebviewTab(applicationPane.nativeTab)
    harness.keepNamingGroupAfterFrameNavigation()
    harness.selectStackFrame('actions.ts', 2, 'navigation-command')
    const showsBefore = harness.textDocumentShows().length

    // Act: the paused capture completes and the reader presents the stop again.
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()

    // Assert: the frame's file keeps the keyboard, nothing is shown over it, and the capture offers explicit recovery.
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.path.endsWith(
        '/actions.ts',
      ),
      true,
    )
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
    assert.match(
      harness.reader.inspect().view!.errors.join('\n'),
      /The native source editor was kept open\. Choose Focus Captured Source to show the capture\./,
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the learner's file after "Navigate Down Call Stack" at a live pause in VS Code when the editor reports its window unfocused although the window has the keyboard; fails_when=Retry or a later capture presentation shows the captured source over that file because the kept-open guard also asks for the window's focus, so the keyboard falls on the window body; why_new=Cycle 0046 original 273 H1 on C52 in VS Code 1.140.0 for Linux under WSLg (after Retry the captured source replaced the frame's file and the input was BODY; `vscode.window.state.focused` was false while the page had the focus); seam=the fake editor's changeWindowFocus
test("Retry after Navigate Down Call Stack keeps the frame's file and its keyboard while VS Code reports its window unfocused", async () => {
  // Arrange: a live run paused with the stop's file in column 2; Navigate Down Call Stack gave another file the keyboard, and the editor reports its window unfocused.
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
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'login-form.tsx', column: 2 },
    })
    await readerSeams(harness).refresh()
    harness.selectStackFrame('actions.ts', 2, 'navigation-command')
    harness.changeWindowFocus(false)
    const showsBefore = harness.textDocumentShows().length

    // Act
    await harness.reader.action('retry')

    // Assert: the frame's file keeps the keyboard, nothing is shown over it, and the capture offers explicit recovery.
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.path.endsWith(
        '/actions.ts',
      ),
      true,
    )
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
    assert.match(
      harness.reader.inspect().view!.errors.join('\n'),
      /The native source editor was kept open\. Choose Focus Captured Source to show the capture\./,
    )
  } finally {
    harness.changeWindowFocus(true)
    live?.close()
    await harness.close()
  }
})

// Value: protects=the frame's file a learner opened with one Call Stack click at a live pause in Cursor while the editor still names the chat's part; fails_when=Retry shows the captured source over that file because the kept-open guard looks only at the active text editor, which Cursor does not report while it names the chat's part; why_new=Cycle 0046 original 273 H2 on C53 in Cursor 3.23.12 (after a genuine click on the renderWithHooks row the list kept the keyboard, no active text editor was reported, and Retry showed the captured source in column 2 with no kept-open message); seam=the fake editor's separate chat part and its click gesture
test("Retry after a Call Stack click keeps the frame's file in front while Cursor names its chat part", async () => {
  // Arrange: a live run paused with the stop's file in column 2; Cursor names its chat part, and one click on a Call Stack row opened that frame's file in column 2 while the list keeps the keyboard.
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
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'login-form.tsx', column: 2 },
    })
    await readerSeams(harness).refresh()
    const chat = harness.addSeparateEditorPart()
    chat.focusTab()
    harness.focusView()
    const frameFile = harness.selectStackFrame('actions.ts', 2)
    const showsBefore = harness.textDocumentShows().length

    // Act
    await harness.reader.action('retry')

    // Assert: the list keeps the keyboard, the frame's file stays in front of column 2, nothing is shown over it, and the capture offers explicit recovery.
    assert.equal(harness.keyboardInView(), true)
    const sourceGroup = harness.groups.find((group) => group.viewColumn === 2)
    assert.equal(
      sourceGroup?.activeTab?.input instanceof Object &&
        'uri' in sourceGroup.activeTab.input &&
        String(sourceGroup.activeTab.input.uri) === String(frameFile.uri),
      true,
    )
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
    assert.match(
      harness.reader.inspect().view!.errors.join('\n'),
      /The native source editor was kept open\. Choose Focus Captured Source to show the capture\./,
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the captured source's keyboard after the learner's click into the file of a frame selected without a stop while the editor names another group; fails_when=Retry shows the captured source over that file with preserveFocus true, so the keyboard falls on the window body; why_new=Cycle 0046 original 273 9a on C54 in Cursor 3.23.12 (one click into the frame's file moved the caret, then Retry showed the captured source with preserveFocus true: 80 of 131 page samples BODY); seam=the fake editor's keepNamingGroupAfterFrameNavigation and workInActiveTextEditor
test("Retry after a click into the selected frame's file gives the captured source the keyboard while Cursor names another group", async () => {
  // Arrange: a live run paused with the stop's file in column 2; Navigate Down Call Stack selected the frame without a stop, Cursor keeps naming the Application group, and the learner clicked into the frame's file.
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
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'login-form.tsx', column: 2 },
    })
    await readerSeams(harness).refresh()
    const applicationPane = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')
    assert.ok(applicationPane)
    harness.focusExistingWebviewTab(applicationPane.nativeTab)
    harness.keepNamingGroupAfterFrameNavigation()
    harness.selectStackFrame('actions.ts', 2, 'navigation-command')
    harness.workInActiveTextEditor('mouse')
    const showsBefore = harness.textDocumentShows().length

    // Act
    await harness.reader.action('retry')

    // Assert: the captured source is shown with the keyboard, and the window body has none.
    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .map((show) => show.preserveFocus),
      [false],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the captured source's keyboard after the learner's click into the file of a frame selected without a stop while VS Code reports its window unfocused although the page has the keyboard; fails_when=Retry shows the captured source with preserveFocus true because the source's keyboard decision also asks for the window's focus, so the keyboard falls on the window body; why_new=Cycle 0046 original 273 H1 on C52 in VS Code 1.140.0 for Linux under WSLg (finding 586: `vscode.window.state.focused` was false while the page had the keyboard); seam=the fake editor's changeWindowFocus and workInActiveTextEditor
test("Retry after a click into the selected frame's file gives the captured source the keyboard while VS Code reports its window unfocused", async () => {
  // Arrange: a live run paused with the stop's file in column 2; Navigate Down Call Stack selected the frame without a stop, the learner clicked into the frame's file, and the editor reports its window unfocused.
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
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'login-form.tsx', column: 2 },
    })
    await readerSeams(harness).refresh()
    harness.selectStackFrame('actions.ts', 2, 'navigation-command')
    harness.workInActiveTextEditor('mouse')
    harness.changeWindowFocus(false)
    const showsBefore = harness.textDocumentShows().length

    // Act
    await harness.reader.action('retry')

    // Assert: the captured source is shown with the keyboard, and the window body has none.
    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .map((show) => show.preserveFocus),
      [false],
    )
  } finally {
    harness.changeWindowFocus(true)
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard in Cursor's chat input after the learner's earlier click into the frame's file, while the editor reports no active text editor; fails_when=Retry takes the keyboard from the chat input and shows the captured source with the focus, because the source's keyboard decision ignores that no text editor is active; why_new=Cycle 0046 finding 588 (the fix must not take the keyboard from the chat: Cursor reports no active text editor while its chat input has the keyboard, the probe `c54/cursor/probe-chat-vs-file/result.json`); seam=the fake editor's addSeparateEditorPart, focusTab and workInActiveTextEditor
test("Retry after a click into the selected frame's file leaves the keyboard in the chat input when no text editor is active", async () => {
  // Arrange: a live run paused with the stop's file in column 2; Navigate Down Call Stack selected the frame without a stop, the learner clicked into the frame's file, and then the keyboard moved to Cursor's chat input, which leaves no active text editor.
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
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'login-form.tsx', column: 2 },
    })
    await readerSeams(harness).refresh()
    harness.selectStackFrame('actions.ts', 2, 'navigation-command')
    harness.workInActiveTextEditor('mouse')
    const chat = harness.addSeparateEditorPart()
    chat.focusTab()
    const showsBefore = harness.textDocumentShows().length

    // Act
    await harness.reader.action('retry')

    // Assert: the chat keeps the keyboard and the captured source is shown without taking it.
    assert.equal(chat.focused(), true)
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .map((show) => show.preserveFocus),
      [true],
    )
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
  // Value: protects=actual captured-source input beside the isolated App at a stop that is read right after another session went on, while the editor still shows that session's frame (the last browser stop of a run, read 17 to 23 ms after the server session went on): the editor's own handling of the stop brings its frame at its second try, when the rest of the call stack is loaded, with the keyboard in the paused file, and the Application pane that covers the file takes the keyboard, so it is on an element; fails_when=such a stop counts only for a frame within 500 ms of its stopped event, which lies 32 to 50 ms above the 450 to 468 ms the editor needs on an idle machine, so that on a slower one the frame is taken for a passed focus, the pane comes without the keyboard over the file that has it, the keyboard is on no element and nothing is told; why_new=Cycle 0046 row 321 (native round in VS Code 1.140.0, check V-08, nine runs of nine); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger for two sessions with staysInBackground, continueDebugSession, resumeDebugger, the clock of performance.now held for the editor events, revealApplicationPaneOverPausedFile
  test(`a browser stop read 20 ms after the server session went on, behind the server's frame, gives the paused file the keyboard when its frame arrives ${arrival.name}: captured source takes the keyboard while App remains visible`, async (t) => {
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
      live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      harness.pauseDebugger({
        opensWithKeyboard: { filename: 'actions.ts', column: 2 },
      })
      const revealsBefore = harness.panelReveals().length,
        showsBefore = harness.textDocumentShows().length

      // Act: on a held clock the server session goes on, the browser's adapter reports its stop 20 ms later while the editor still shows the server's frame, the editor reports the server's thread 204 ms after the server went on, and the browser's frame arrives with the paused file opened with the keyboard; then the real capture updates the isolated source.
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
        opensWithKeyboard: { filename: 'login-form.tsx', column: 2 },
      })
      clock.mock.restore()
      harness.service.action({
        instanceId: harness.service.instanceId,
        runId: record.id,
        key: randomUUID(),
        action: 'repository-click',
      })
      await readerSeams(harness).refresh()
      await harness.revealApplicationPaneOverPausedFile()

      // Assert: actual source replacement keeps usable input at the original timed stop; the isolated App stays visible.
      assert.deepEqual(
        harness
          .textDocumentShows()
          .slice(showsBefore)
          .map((shown) => shown.preserveFocus),
        [false],
      )
      assert.equal(harness.keyboardOnBody(), false)
      assert.equal(
        harness.editor.window.activeTextEditor?.document.uri.toString(),
        harness.reader.inspect().sourceUri,
      )
      assert.equal(
        harness.editor.window.activeTextEditor?.document.getText(),
        'const nextTheme = "dark";\n',
      )
      assert.deepEqual(
        harness
          .panelReveals()
          .slice(revealsBefore)
          .map((reveal) => reveal.preserveFocus),
        [],
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
    live = await harness.reader.presentation.createViewport(
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

// Value: protects=source keyboard ownership when a stop arrived behind an untracked session: the actual captured source replaces the paused file with its keyboard, while the isolated App remains visible; fails_when=an unknown session is treated as a known focus pass and the captured source is refused or loses input; why_new=Cycle0046 row321 retains its original untracked-session and two-second timing criterion after R2 removes normal App overlap; seam=native pause/tracker port plus the real controlled service action and reader refresh, with App native effects checked separately
test('a server stop read behind the frame of a session the reader does not hear counts as shown by its own handling however late its frame arrives: the captured source takes the keyboard while App remains visible', async (t) => {
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
    live = await harness.reader.presentation.createViewport(
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
    const revealsBefore = harness.panelReveals().length,
      showsBefore = harness.textDocumentShows().length

    // Act: on a held clock the server's adapter reports its stop behind that frame; the browser session goes on unheard, the editor reports its thread, and two seconds later the server's frame arrives with the paused file opened with the keyboard; the real capture then updates the separate source surface.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.pauseDebugger({ staysInBackground: true })
    clockMs += 200
    harness.resumeDebugger()
    clockMs += 1_800
    harness.pauseDebugger({
      startedBeforeTheReader: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 2 },
    })
    clock.mock.restore()
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: the real captured source takes the paused file input; the isolated App needs no native reveal.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .map((shown) => shown.preserveFocus),
      [false],
    )
    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=actual captured-source input beside the isolated App at a server stop that follows a browser stop so late that the editor already shows the browser's thread, or at once in the same session: the editor's own handling of the stop opens the paused file with the keyboard, and the Application pane that covers it takes the keyboard, so it is on an element; fails_when=a stop is doubted because another session exists or went on at some time, or its frame is held against a time bound although nothing put it in doubt (an adapter that answers slowly), so the pane comes without the keyboard over the file that has it and the keyboard is on no element; why_new=Cycle 0046 row 274 (the bound of its fix: only a stop read while a frame of another session had the focus is in doubt); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger for two sessions, resumeDebugger, the clock of performance.now held for the editor events, revealApplicationPaneOverPausedFile
test("a server stop read after the editor reported the browser's thread gives the paused file the keyboard however late its frame arrives: captured source takes the keyboard while App remains visible", async (t) => {
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
    live = await harness.reader.presentation.createViewport(
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
    const revealsBefore = harness.panelReveals().length,
      showsBefore = harness.textDocumentShows().length

    // Act: the server's adapter reports its stop, and answers the editor so slowly that the frame arrives two seconds later, with the paused file opened with the keyboard; then the real capture updates the isolated source.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.pauseDebugger({ staysInBackground: true })
    clockMs += 2_000
    harness.pauseDebugger({
      startedBeforeTheReader: true,
      opensWithKeyboard: { filename: 'actions.ts', column: 2 },
    })
    clock.mock.restore()
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: an undoubted stop keeps its source input even after two seconds, with no unnecessary App reveal.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .map((shown) => shown.preserveFocus),
      [false],
    )
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.toString(),
      harness.reader.inspect().sourceUri,
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.getText(),
      'const nextTheme = "dark";\n',
    )
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [],
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
      live = await harness.reader.presentation.createViewport(
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
test('a stop that the run resumes before the editor showed it still gives the paused file the keyboard when its frame arrives right after: captured source keeps the keyboard while App stays visible', async (t) => {
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
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    const revealsBefore = harness.panelReveals().length,
      showsBefore = harness.textDocumentShows().length

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
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: actual input stays usable beside the still-visible App.
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(
      harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')?.visible,
      true,
    )

    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .map((shown) => shown.preserveFocus),
      [false],
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.toString(),
      harness.reader.inspect().sourceUri,
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.getText(),
      'const nextTheme = "dark";\n',
    )
    // Captured source takes the keyboard; App needs no reveal.
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [],
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
  test(`a learner who selects a frame and then ${sign} has the keyboard in that editor: captured source keeps input while App stays visible`, async () => {
    // Arrange: a paused native source beside the dedicated App, with the learner in Call Stack.
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
      live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      harness.pauseDebugger({
        opensWithKeyboard: { filename: 'actions.ts', column: 2 },
      })
      harness.focusView()
      const revealsBefore = harness.panelReveals().length,
        showsBefore = harness.textDocumentShows().length

      // Act: retain the original frame/gesture ordering, then acquire and render the actual captured source.
      if (sign === 'clicks into its file') {
        harness.selectStackFrame('page.tsx', 2)
        harness.workInActiveTextEditor('mouse')
      }
      if (
        sign ===
        'presses a key in its file after the Navigate Call Stack command'
      ) {
        harness.selectStackFrame('page.tsx', 2, 'navigation-command')
        harness.workInActiveTextEditor('keyboard')
      }
      if (sign === 'opens it with a double click')
        harness.selectStackFrame('page.tsx', 2, 'double-click')
      // Cursor's extension host makes every tab object anew with such an update (Cycle 0046 row 356): the kept tab is known by its file and group, not by the object.
      if (
        sign ===
        'opens it with a double click after the editor sent its whole tab model again'
      )
        harness.selectStackFrame(
          'page.tsx',
          2,
          'double-click-after-tab-model-update',
        )
      if (sign === 'goes to another file in that group') {
        harness.selectStackFrame('page.tsx', 2)
        harness.focusMutableDraft('learner-notes.ts', 2)
      }
      harness.service.action({
        instanceId: harness.service.instanceId,
        runId: record.id,
        key: randomUUID(),
        action: 'repository-click',
      })
      await readerSeams(harness).refresh()
      await harness.revealApplicationPaneOverPausedFile()

      // Assert: this specific native learner sign still admits real captured-source input without an App reveal.
      assert.deepEqual(
        harness
          .textDocumentShows()
          .slice(showsBefore)
          .map((shown) => shown.preserveFocus),
        [false],
      )
      assert.equal(harness.keyboardOnBody(), false)
      assert.equal(
        harness.editor.window.activeTextEditor?.document.uri.toString(),
        harness.reader.inspect().sourceUri,
      )
      assert.equal(
        harness.editor.window.activeTextEditor?.document.getText(),
        'const nextTheme = "dark";\n',
      )
      assert.deepEqual(
        harness
          .panelReveals()
          .slice(revealsBefore)
          .map((reveal) => reveal.preserveFocus),
        [],
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
    live = await harness.reader.presentation.createViewport(
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

for (const scenario of [
  { opensWithKeyboard: false, duringSourceIO: false },
  { opensWithKeyboard: true, duringSourceIO: false },
  { opensWithKeyboard: false, duringSourceIO: true },
  { opensWithKeyboard: true, duringSourceIO: true },
]) {
  // Value: protects=the actual native source/view input after frame selection; fails_when=background source replacement hides an ambiguous input; why_new=the old port checked preserveFocus but missed native BODY; seam=none; no_claim=controlled native port, installed both-host proof remains required.
  test(
    (scenario.opensWithKeyboard
      ? 'Call Stack navigation keeps source input when captured source refreshes'
      : 'Call Stack frame clicks keep list input when captured source refreshes') +
      (scenario.duringSourceIO ? ' after source acquisition starts' : ''),
    async () => {
      // Arrange: equivalent native frame receipts can leave input in the list or its source.
      const harness = await workspaceHarness()
      harness.useNativeLayout({ orientation: 0, groups: [{}] })
      let live: { close(): void } | undefined
      let releaseNativeReceipt = (): void => {}
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
        live = await harness.reader.presentation.createViewport(
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
        // A later frame can arrive while the original stopped frame's source is still being acquired.
        const held = scenario.duringSourceIO
          ? harness.holdNextSource()
          : undefined
        const pendingRender = held ? harness.reader.action('retry') : undefined
        if (held) {
          releaseNativeReceipt = held.release
          await held.started
        }
        const nativeSource = harness.selectStackFrame(
          'native-caller.tsx',
          2,
          scenario.opensWithKeyboard ? 'navigation-command' : 'click',
        )
        // Both real gestures expose the same clean preview tab; an unchanged tab report is no keyboard/selection sign.
        harness.reportActiveTextTab({ isPreview: true, isDirty: false })
        const showsBefore = harness.textDocumentShows().length

        // Act: a background render must preserve either native owner instead of guessing which one has input.
        held?.release()
        await (pendingRender ?? harness.reader.action('retry'))

        // Assert: the selected native input stays usable and captured-source absence has an explicit recovery.
        assert.equal(harness.keyboardOnBody(), false)
        assert.equal(harness.keyboardInView(), !scenario.opensWithKeyboard)
        assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
        assert.equal(nativeSource.getText(), 'Original learner draft.\n')
        assert.equal(harness.reader.inspect().rendered, undefined)
        assert.match(
          harness.reader.inspect().view!.errors.join('\n'),
          /The native source editor was kept open\. Choose Focus Captured Source to show the capture\./,
        )

        // Act: the existing explicit source request can intentionally replace that native input.
        await harness.reader.action('source')

        // Assert: the captured source recovers with meaningful keyboard input and no stale protection error.
        assert.equal(harness.keyboardOnBody(), false)
        assert.equal(harness.keyboardInView(), false)
        assert.equal(
          harness.reader.inspect().sourceUri?.startsWith('codebook-source:'),
          true,
        )
        assert.deepEqual([...harness.reader.inspect().view!.errors], [])
      } finally {
        releaseNativeReceipt()
        live?.close()
        await harness.close()
      }
    },
  )
}

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
    state: { isPreview: false, isDirty: false },
    movesGroup: true,
  },
] as const)
  // Value: protects=the keyboard of a learner in the Call Stack view after one click on a frame whose file opens as a preview tab: the tab as the editor shows it now decides, so a tab that is still a preview tab, and one that is kept only because its file was edited, are no sign that the learner works in that file, and the Application pane comes without the keyboard; fails_when=the reader does not read the current tab's preview and unsaved state, so any later tab event, or an agent's edit, makes the pane take the keyboard from the Call Stack view and tell a sentence about a file the learner never worked in; why_new=Cycle 0046 row 356 (the current tab's values, read from the tab in front and not from an object noted earlier); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger, focusView, selectStackFrame with a click on an unopened file, with a repeated report of its tab and with an edit, revealApplicationPaneOverPausedFile
  test(`a frame's file that the learner opened with one click and that ${course.name} is no sign of the learner: captured-source refresh leaves the keyboard in the Call Stack view`, async () => {
    // Arrange: a live run paused; the debugger opened the paused file in the Application pane's group, and the learner clicked into the Call Stack view.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
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
      live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      harness.pauseDebugger({
        opensWithKeyboard: { filename: 'actions.ts', column: 1 },
      })
      harness.focusView()
      const revealsBefore = harness.panelReveals().length,
        showsBefore = harness.textDocumentShows().length

      // Act: the learner selects the caller's frame with one click, which opens its file as a preview tab without the keyboard; then the tab's course, and the Application pane comes to the front over it.
      harness.selectStackFrame(
        'page.tsx',
        1,
        'click-on-unopened-file-then-tab-update',
      )
      // This is a real2-to3 native group move, not the former2-to2 no-op after App isolation.
      if ('movesGroup' in course)
        harness.swapEditorGroups(
          harness.groups.find((group) => group.viewColumn === 2)!,
          harness.groups.find((group) => group.viewColumn === 3)!,
        )
      const oldTab = harness.reportActiveTextTab(course.state)
      harness.service.action({
        instanceId: harness.service.instanceId,
        runId: record.id,
        key: randomUUID(),
        action: 'repository-click',
      })
      await readerSeams(harness).refresh()
      await harness.revealApplicationPaneOverPausedFile()

      // Assert: actual input stays usable beside the still-visible App.
      assert.equal(harness.keyboardOnBody(), false)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(
        harness
          .nativePanels()
          .find((panel) => panel.kind === 'codebook.scopedBrowser')?.visible,
        true,
      )

      assert.deepEqual(
        harness
          .textDocumentShows()
          .slice(showsBefore)
          .filter((shown) => !shown.preserveFocus),
        [],
      )
      // The source refresh preserves Call Stack input and emits no false notice.
      assert.deepEqual(
        harness
          .panelReveals()
          .slice(revealsBefore)
          .map((reveal) => reveal.preserveFocus),
        [],
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

// Value: protects=the keyboard of a learner in the Call Stack view at a selected frame while the reader renders the pause again: the reader's own showing of the captured source over the frame's file, and the selection it sets there, are no sign of the learner, and the Application pane that then comes to the front leaves the keyboard in the view; fails_when=every text editor that becomes active after a frame, or every change of a selection, counts as the learner's choice of that editor, so the reader's own render makes the pane take the keyboard from the Call Stack view at its next reveal; why_new=Cycle 0046 row 273 (the bound of its fix: only what the learner did is a sign); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger, focusView, selectStackFrame, the reader's Source action, revealApplicationPaneOverPausedFile
test("the reader's own source activation is no sign of learner work after the keyboard returns to the Call Stack view", async () => {
  // Arrange: the selected native frame occupies the source group; explicit Source will report a genuine active-editor change.
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
    live = await harness.reader.presentation.createViewport(
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

    // Act: Source intentionally activates its capture; an unreported later view choice must survive the Application reveal.
    await harness.reader.action('source')
    harness.focusView()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: only the explicit Source request took input; the later pane leaves meaningful input in the Call Stack view.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(before.shows)
        .map((shown) => shown.preserveFocus),
      [false],
    )
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(before.reveals)
        .filter((reveal) => !reveal.preserveFocus),
      [],
    )
    assert.equal(harness.keyboardInView(), true)
    assert.equal(harness.keyboardOnBody(), false)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in the Call Stack view at a selected frame when a command moves the selection in that frame's file (the editor's own jump to a line, another extension): that is no sign of the learner, and the Application pane that comes to the front leaves the keyboard in the view; fails_when=every change of a selection counts as the learner's work in that editor, whatever the editor says about how it changed, so the pane takes the keyboard from the Call Stack view; why_new=Cycle 0046 row 273 (the bound of its fix: a selection is a sign only when the editor names the mouse or the keyboard as its cause); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger, focusView, selectStackFrame, jumpInActiveTextEditor, revealApplicationPaneOverPausedFile
test("a selection that a command moves in a selected frame's file is no sign of the learner: captured-source refresh leaves the keyboard in the Call Stack view", async () => {
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
    live = await harness.reader.presentation.createViewport(
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
    const revealsBefore = harness.panelReveals().length,
      showsBefore = harness.textDocumentShows().length

    // Act: a command moves the selection in the frame's file, and the Application pane comes to the front.
    harness.jumpInActiveTextEditor()
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: actual input stays usable beside the still-visible App.
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(
      harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')?.visible,
      true,
    )

    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    // The source refresh preserves Call Stack input.
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [],
    )
    assert.equal(harness.keyboardInView(), true)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner who clicked into a frame's file and then went back to the Call Stack view and selected another frame: the sign belonged to the frame before, and the Application pane that comes to the front leaves the keyboard in the view; fails_when=a sign of the learner outlives the frame it was given at, so every later frame of the pause counts as one whose file has the keyboard, and the pane takes the keyboard from the Call Stack view; why_new=Cycle 0046 row 273 (the bound of its fix: a sign holds until the next stack item); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger, focusView, selectStackFrame, workInActiveTextEditor, revealApplicationPaneOverPausedFile
test("a learner who clicked into a frame's file and then selects another frame in the Call Stack view has the keyboard in that view: captured-source refresh leaves it there", async () => {
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
    live = await harness.reader.presentation.createViewport(
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
    const revealsBefore = harness.panelReveals().length,
      showsBefore = harness.textDocumentShows().length

    // Act: the learner clicks into the Call Stack view again and selects a third frame; then the Application pane comes to the front.
    harness.focusView()
    harness.selectStackFrame('layout.tsx', 1)
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: actual input stays usable beside the still-visible App.
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(
      harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')?.visible,
      true,
    )

    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    // The source refresh preserves Call Stack input.
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [],
    )
    assert.equal(harness.keyboardInView(), true)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner at a pause whose stacks the debug adapter declares invalid: the editor handles the stop again and opens the paused file with the keyboard, and the Application pane that covers the file takes it, so the keyboard is on an element; fails_when=only a stopped event counts as a stop, so the frame the editor reports after an invalidated event is taken for one the learner selected and the pane comes without the keyboard over the file that has it; why_new=Cycle 0046 row 273 (delegated review, finding 6, case c); seam=workspace harness with the controlled runtime, a live run's viewport, pauseDebugger, focusView, selectStackFrame, invalidateStacks, revealApplicationPaneOverPausedFile
test('a pause whose stacks the adapter declares invalid gives the paused file the keyboard again: captured source keeps the keyboard while App stays visible', async () => {
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
    live = await harness.reader.presentation.createViewport(
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
    const revealsBefore = harness.panelReveals().length,
      showsBefore = harness.textDocumentShows().length

    // Act: the adapter declares the stacks invalid, the editor handles the stop again, and the Application pane comes to the front over the paused file.
    harness.invalidateStacks({ filename: 'actions.ts', column: 1 })
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: actual input stays usable beside the still-visible App.
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(
      harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')?.visible,
      true,
    )

    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .map((shown) => shown.preserveFocus),
      [false],
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.toString(),
      harness.reader.inspect().sourceUri,
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.getText(),
      'const nextTheme = "dark";\n',
    )
    // Captured source takes the keyboard; App needs no reveal.
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [],
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
  test(`at a stop with debug.focusEditorOnBreak off, a learner who ${learner} ${learner === 'clicks into the paused file' ? 'has the keyboard in that file: captured source keeps the keyboard while App stays visible and Codebook says so' : 'keeps it there: captured source comes without the keyboard and nothing is told'}`, async () => {
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
      live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      harness.focusMutableDraft('learner-notes.ts', 2)
      harness.focusView()
      harness.openFileWithoutKeyboard('actions.ts', 2)
      harness.pauseDebugger({ focusesEditorOnBreak: false })
      const revealsBefore = harness.panelReveals().length,
        showsBefore = harness.textDocumentShows().length

      // Act: the learner clicks into the paused file, or does not; then the Application pane comes to the front over it.
      if (learner === 'clicks into the paused file')
        harness.workInActiveTextEditor('mouse')
      harness.service.action({
        instanceId: harness.service.instanceId,
        runId: record.id,
        key: randomUUID(),
        action: 'repository-click',
      })
      await readerSeams(harness).refresh()
      await harness.revealApplicationPaneOverPausedFile()

      // Assert: actual input stays usable beside the still-visible App.
      assert.equal(harness.keyboardOnBody(), false)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(
        harness
          .nativePanels()
          .find((panel) => panel.kind === 'codebook.scopedBrowser')?.visible,
        true,
      )

      assert.deepEqual(
        harness
          .textDocumentShows()
          .slice(showsBefore)
          .map((shown) => shown.preserveFocus),
        [learner !== 'clicks into the paused file'],
      )
      // Assert
      assert.deepEqual(
        harness
          .panelReveals()
          .slice(revealsBefore)
          .map((reveal) => reveal.preserveFocus),
        [],
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
test('a learner who clicks into a file while the session runs has the keyboard in that file: captured source keeps the keyboard while App stays visible and Codebook says so', async () => {
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
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      opensWithKeyboard: { filename: 'actions.ts', column: 1 },
    })
    harness.resumeDebugger()
    harness.focusView()
    const revealsBefore = harness.panelReveals().length,
      showsBefore = harness.textDocumentShows().length

    // Act: the learner clicks into the file, and the Application pane comes to the front over it.
    harness.workInActiveTextEditor('mouse')
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: actual input stays usable beside the still-visible App.
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(
      harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')?.visible,
      true,
    )

    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .map((shown) => shown.preserveFocus),
      [false],
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.uri.toString(),
      harness.reader.inspect().sourceUri,
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document.getText(),
      'const nextTheme = "dark";\n',
    )
    // The captured source takes the keyboard and tells the learner where it went.
    assert.deepEqual(
      harness
        .panelReveals()
        .slice(revealsBefore)
        .map((reveal) => reveal.preserveFocus),
      [],
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
  test(`a learner who ${since} while the session runs is not taken to have the keyboard in it: captured-source refresh leaves the keyboard in the view and nothing is told`, async (t) => {
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
      live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      harness.pauseDebugger({
        opensWithKeyboard: { filename: 'actions.ts', column: 1 },
      })
      harness.resumeDebugger()
      const revealsBefore = harness.panelReveals().length,
        showsBefore = harness.textDocumentShows().length

      // Act: on a held clock the learner clicks into the file and then into a view, and four seconds pass; or the learner, in a view, opens another file from the Explorer with one click. Then the Application pane comes to the front over that group.
      let clockMs = Math.floor(performance.now())
      const clock = t.mock.method(performance, 'now', () => clockMs)
      if (since === 'clicked into that file four seconds ago') {
        harness.workInActiveTextEditor('mouse')
        harness.focusView()
        clockMs += 4_000
      } else {
        harness.focusView()
        harness.openFileWithoutKeyboard('page.tsx', 2)
      }
      harness.service.action({
        instanceId: harness.service.instanceId,
        runId: record.id,
        key: randomUUID(),
        action: 'repository-click',
      })
      await readerSeams(harness).refresh()
      await harness.revealApplicationPaneOverPausedFile()
      clock.mock.restore()

      // Assert: actual input stays usable beside the still-visible App.
      assert.equal(harness.keyboardOnBody(), false)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(
        harness
          .nativePanels()
          .find((panel) => panel.kind === 'codebook.scopedBrowser')?.visible,
        true,
      )

      assert.deepEqual(
        harness
          .textDocumentShows()
          .slice(showsBefore)
          .map((shown) => shown.preserveFocus),
        [true],
      )
      // The source refresh preserves view input and emits no false notice.
      assert.deepEqual(
        harness
          .panelReveals()
          .slice(revealsBefore)
          .map((reveal) => reveal.preserveFocus),
        [],
      )
      assert.equal(harness.keyboardInView(), true)
      assert.deepEqual(harness.informationMessages, [])
    } finally {
      live?.close()
      await harness.close()
    }
  })

// Value: protects=the keyboard of a learner who steps into another file from the captured source under Codebook's contributed debug.focusEditorOnBreak false; fails_when=the editor opens the stepped-into file preserving the focus over the captured source and Codebook gives that file no keyboard, so the keyboard falls on the window body; why_new=Cycle 0046 finding 589, C54 step1 in both hosts (one F11 from the captured source: 90 of 113 samples BODY in Cursor 3.23.12, 94 of 116 in VS Code 1.140.0); seam=the fake editor's showStopKeepingFocus and the configured run's verdict in codebookStopLedger
test("a learner's Step Into from the captured source gives the stepped-into file the keyboard", async () => {
  // Arrange: a live run paused at a stop of its own under Codebook's contributed default, with the captured source shown with the keyboard (Focus Captured Source).
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    // The configured run records the stop its own input caused.
    codebookStopLedger.recordStop('live-next-browser', true)
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'actions.ts', column: 2 },
    })
    await readerSeams(harness).refresh()
    await harness.reader.action('source')
    const showsBefore = harness.textDocumentShows().length

    // Act: the learner's F11 stops with the reason step, which the run records as no stop of its own; the editor opens the stepped-into file preserving the focus.
    harness.pauseDebugger({
      session: 'live-next-browser',
      reason: 'step',
      staysInBackground: true,
    })
    codebookStopLedger.recordStop('live-next-browser', false)
    harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)

    // Assert: the stepped-into file is shown with the keyboard, and the window body has none.
    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [
      { name: 'login-form.tsx', viewColumn: 2, preserveFocus: false },
    ])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner whose palette command made the debug adapter refresh the stack of a live pause; fails_when=the editor shows the refreshed stop by opening the paused file preserving the focus over the learner's file and Codebook gives it no keyboard, so the keyboard falls on the window body; why_new=Cycle 0046 finding 589, C54 round 9f in both hosts (Navigate Down Call Stack, then Toggle Skipping this File: js-debug sent continued and stopped 27 ms after the Enter, and 153 of 154 samples were BODY before any Codebook call); seam=the fake editor's refreshPausedStack and showStopKeepingFocus
test('a refresh the adapter makes after a palette command gives the paused file the keyboard once', async () => {
  // Arrange: a live run paused at a stop of its own under Codebook's contributed default; Navigate Down Call Stack opened the frame's file with the keyboard in column 2.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    codebookStopLedger.recordStop('live-next-browser', true)
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'actions.ts', column: 2 },
    })
    harness.selectStackFrame(
      'react-dom-client.development.js',
      2,
      'navigation-command',
    )
    const showsBefore = harness.textDocumentShows().length

    // Act: Toggle Skipping this File makes the adapter refresh the stack, which the run records as no stop of its own; the editor shows the stop again preserving the focus.
    harness.refreshPausedStack('live-next-browser')
    codebookStopLedger.recordStop('live-next-browser', false)
    harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)

    // Assert: the paused file is shown with the keyboard once, and the window body has none.
    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [
      { name: 'login-form.tsx', viewColumn: 2, preserveFocus: false },
    ])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=one keyboard hand-over per stop; fails_when=a further frame the editor reports for the same stop hands the keyboard over again, taking it from wherever the learner moved it since; why_new=Cycle 0046 decision R7 (several frames of one stop, 1313, 1314 and 1372 in the C54 9f round, must not repeat the hand-over); seam=the fake editor's reportFrameOfSameStop
test('a second frame of the same stop does not hand the keyboard over again', async () => {
  // Arrange: a live run paused at a stop of its own; the adapter refreshed its stack and the editor showed the refreshed stop preserving the focus.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    codebookStopLedger.recordStop('live-next-browser', true)
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'actions.ts', column: 2 },
    })
    const showsBefore = harness.textDocumentShows().length
    harness.refreshPausedStack('live-next-browser')
    codebookStopLedger.recordStop('live-next-browser', false)
    harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)

    // Act: the editor focuses the same stop's frame again once the rest of the stack is loaded.
    harness.reportFrameOfSameStop()

    // Assert: the stop's file was given the keyboard exactly once.
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [
      { name: 'login-form.tsx', viewColumn: 2, preserveFocus: false },
    ])
    assert.equal(harness.keyboardOnBody(), false)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the chat's keyboard at a stop the run's own continuation caused (task 5), while the editor reports the paused file as the active text editor; fails_when=the hand-over of finding 589 takes the run's own stop for the learner's and moves the keyboard from the chat into the paused file; why_new=Cycle 0046 decision R7 (A′, live-run aware: the contributed default keeps the chat's keyboard at stops Codebook causes); seam=codebookStopLedger's window and verdict as the configured run writes them, and the fake editor's focusView for VS Code's chat view
test("a stop that Codebook's own continue causes leaves the keyboard in the chat input", async () => {
  // Arrange: a live run whose continuation opened its causal window; the learner's keyboard is in VS Code's chat view while a text editor is in front of column 2.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.focusMutableDraft('actions.ts', 2)
    harness.focusView()
    codebookStopLedger.openWindow(['live-next-browser'])
    const showsBefore = harness.textDocumentShows().length

    // Act: the stop the continuation caused, which the run records as its own; the editor shows it preserving the focus.
    harness.pauseDebugger({
      session: 'live-next-browser',
      staysInBackground: true,
    })
    codebookStopLedger.recordStop(
      'live-next-browser',
      codebookStopLedger.isWindowOpen('live-next-browser'),
    )
    harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)

    // Assert: the chat view keeps the keyboard, and no file is shown with it.
    assert.equal(harness.keyboardInView(), true)
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((show) => !show.preserveFocus),
      [],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner who resumes a live run by hand and stops at the next breakpoint; fails_when=the stop after the learner's resume opens its file preserving the focus over the learner's file and Codebook gives it no keyboard, so the keyboard falls on the window body; why_new=Cycle 0046 decision R7 (a stop after a resume the run did not make is the learner's; the run ends with "Manual or competing resume invalidated live pause" as before); seam=continueDebugSession and the configured run's verdict in codebookStopLedger
test('a live run that the learner resumes by hand hands the keyboard to the paused file', async () => {
  // Arrange: a live run paused at a stop of its own, with the stop's file holding the keyboard in column 2.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    codebookStopLedger.recordStop('live-next-browser', true)
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'actions.ts', column: 2 },
    })
    const showsBefore = harness.textDocumentShows().length

    // Act: the learner's Continue, a resume the run did not make, and the next breakpoint's stop, which the editor shows preserving the focus.
    harness.continueDebugSession('live-next-browser')
    harness.pauseDebugger({
      session: 'live-next-browser',
      staysInBackground: true,
    })
    codebookStopLedger.recordStop('live-next-browser', false)
    harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)

    // Assert: the paused file is shown with the keyboard, and the window body has none.
    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [
      { name: 'login-form.tsx', viewColumn: 2, preserveFocus: false },
    ])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the learner's explicit choice of debug.focusEditorOnBreak false, which Codebook leaves to the editor; fails_when=the hand-over of finding 589 also acts on a value the learner set in the user layer and moves the keyboard into the paused file; why_new=Cycle 0046 decision R7 (do nothing when the learner set the setting explicitly in a user, workspace or folder layer); seam=pauseDebugger's focusesEditorOnBreak in the fake editor's user layer
test("an explicit false debug.focusEditorOnBreak leaves the editor's own keyboard handling", async () => {
  // Arrange: a live run paused at a stop of its own; the learner set debug.focusEditorOnBreak to false in the user layer, and the stop's file holds the keyboard in column 2.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    codebookStopLedger.recordStop('live-next-browser', true)
    harness.pauseDebugger({
      session: 'live-next-browser',
      focusesEditorOnBreak: false,
      opensWithKeyboard: { filename: 'actions.ts', column: 2 },
    })
    const showsBefore = harness.textDocumentShows().length

    // Act: the learner's Continue and the next breakpoint's stop, which the editor shows preserving the focus.
    harness.continueDebugSession('live-next-browser')
    harness.pauseDebugger({
      session: 'live-next-browser',
      staysInBackground: true,
    })
    codebookStopLedger.recordStop('live-next-browser', false)
    harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)

    // Assert: the keyboard stays where the editor's own handling left it, and nothing is shown with it.
    assert.equal(harness.keyboardOnBody(), true)
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the replay's keyboard while a saved recording is open; fails_when=the hand-over of finding 589 acts on a stop shown while a recording is replayed and moves the keyboard into a recorded file; why_new=Cycle 0046 decision R7 (do nothing while a recording is open); seam=recordedReaderHarness's openRecording and the fake editor's showStopKeepingFocus
test('a replayed recording never moves the keyboard into a recorded file', async () => {
  // Arrange: a saved recording is open, under Codebook's contributed default.
  const harness = await recordedReaderHarness(true, true)
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    harness.contributeFocusEditorOnBreakDefault(false)
    const showsBefore = harness.textDocumentShows().length

    // Act: a stop of a session that is no Codebook run, shown by the editor preserving the focus.
    harness.pauseDebugger({ session: 'learner-node', staysInBackground: true })
    harness.showStopKeepingFocus('learner-node', 'actions.ts', 2)

    // Assert: no file is shown with the keyboard.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((show) => !show.preserveFocus),
      [],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat's keyboard that Codebook gave back at a stop of its own run (task 5); fails_when=a later frame of that stop, which reveals the paused file again, is taken for a stop Codebook did not cause and the keyboard is moved from the chat into the file; why_new=Cycle 0046 decision R7 (a Codebook stop's chat return is not undone by the hand-over); seam=Cursor's separate chat part and the fake editor's reportFrameOfSameStop
test("a chat return at a Codebook stop is not undone when the editor reveals the stop's file again", async () => {
  // Arrange: Cursor's chat had the keyboard and the learner turned debug.focusEditorOnBreak on; the run's input caused a stop whose file took the keyboard, and the reader gave it back to the chat.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  harness.contributeFocusEditorOnBreakDefault(false)
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    codebookStopLedger.recordStop('live-next-browser', true)
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger({
      session: 'live-next-browser',
      focusesEditorOnBreak: true,
    })
    await waitUntil(
      () => chat.focused(),
      'the chat got the keyboard back at the stop',
      300,
    )
    const showsBefore = harness.textDocumentShows().length

    // Act: the editor focuses the same stop's frame again once the rest of the stack is loaded.
    harness.reportFrameOfSameStop()

    // Assert: the chat keeps the keyboard, and no file is shown with it.
    assert.equal(chat.focused(), true)
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((show) => !show.preserveFocus),
      [],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard Codebook handed to the paused file at a stop it did not cause; fails_when=the reader's later render of that stop still owes the chat its return and runs the chat's focus command, taking the keyboard from the file the learner is in; why_new=Cycle 0046 decision R7 (the pause is settled to the learner at the hand-over, so returnsKeyboardToChatAtPause and owedPauseOf never return it); seam=Cursor's separate chat part, the fake editor's showStopKeepingFocus and readerSeams.refresh
test('a hand-over to the paused file is not undone by a later chat return', async () => {
  // Arrange: Cursor's chat had the keyboard and the learner went into a file in column 2, under Codebook's contributed default.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  harness.contributeFocusEditorOnBreakDefault(false)
  const chat = harness.addSeparateEditorPart()
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    chat.focusTab()
    harness.focusMutableDraft('actions.ts', 2)
    harness.pauseDebugger({
      session: 'live-next-browser',
      staysInBackground: true,
    })
    codebookStopLedger.recordStop('live-next-browser', false)
    harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)

    // Act: the reader renders the stop again, the moment a chat return owed for it would run.
    await readerSeams(harness).refresh()

    // Assert: the chat's focus command never ran, and the chat did not take the keyboard.
    assert.deepEqual(
      harness.commands.filter(
        (command) => command === 'composer.focusComposer',
      ),
      [],
    )
    assert.equal(chat.focused(), false)
    assert.equal(harness.keyboardOnBody(), false)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of the paused file Codebook handed it to when the learner's Retry shows the stop's capture again; fails_when=Retry shows the captured source over that file preserving the focus because the reader's keyboard model forgets the hand-over, so the keyboard falls on the window body again; why_new=Cycle 0046 finding 589, C54 round 9f ("Retry kept BODY") and decision R7 (the reader treats the handed-over file as holding the keyboard for its stop; the active-editor restore R7 names was unreachable and is removed, finding 594); seam=the reader's Retry and the fake editor's showStopKeepingFocus
test('Retry at a stop handed to the paused file gives the captured source the keyboard instead of leaving it on the window body', async () => {
  // Arrange: a live run paused at a stop of its own with the captured source shown with the keyboard (Focus Captured Source), under Codebook's contributed default; the learner's Step Into handed the stepped-into file the keyboard.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    codebookStopLedger.recordStop('live-next-browser', true)
    harness.pauseDebugger({
      session: 'live-next-browser',
      opensWithKeyboard: { filename: 'actions.ts', column: 2 },
    })
    await readerSeams(harness).refresh()
    await harness.reader.action('source')
    harness.pauseDebugger({
      session: 'live-next-browser',
      reason: 'step',
      staysInBackground: true,
    })
    codebookStopLedger.recordStop('live-next-browser', false)
    harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)
    const showsAfterHandOver = harness.textDocumentShows().length

    // Act: the learner's Retry renders the stop's capture again.
    await harness.reader.action('retry')

    // Assert: the captured source Retry shows over the handed-over file takes the keyboard with it, and the window body has none.
    assert.deepEqual(harness.textDocumentShows().slice(showsAfterHandOver), [
      { name: 'Captured-source.mts', viewColumn: 2, preserveFocus: false },
    ])
    assert.equal(harness.keyboardOnBody(), false)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard at a stop of an owned Node test run, which Codebook caused; fails_when=the hand-over of finding 589 takes such a stop for the learner's and moves the keyboard into the paused test file; why_new=Cycle 0046 decision R7 (every stop of an owned Node test run is Codebook's); seam=codebookStopLedger.ownSession as the owned Node test run calls it when its session starts, and the fake editor's focusView
test("an owned Node test run's stop keeps the keyboard where Codebook left it", async () => {
  // Arrange: an owned Node test session under Codebook's contributed default; the keyboard is in a view while a text editor is in front of column 2.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  try {
    await harness.reader.open()
    harness.focusMutableDraft('actions.ts', 2)
    harness.focusView()
    codebookStopLedger.ownSession('owned-node-test')
    const showsBefore = harness.textDocumentShows().length

    // Act: the owned run's stop, which the editor shows preserving the focus.
    harness.pauseDebugger({
      session: 'owned-node-test',
      staysInBackground: true,
    })
    harness.showStopKeepingFocus('owned-node-test', 'data.test.ts', 2)

    // Assert: the view keeps the keyboard, and no file is shown with it.
    assert.equal(harness.keyboardInView(), true)
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((show) => !show.preserveFocus),
      [],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in the Call Stack view who single-clicks the frame of their own debug session, whose stop the editor kept in the background behind a Codebook run's paused frame; fails_when=the hand-over of finding 589 takes the file that click opens preserving the focus for the paused file of that stop and gives it the keyboard, and the reader's keyboard model then treats that file as handed over, although the editor's own default (debug.focusEditorOnBreak true) leaves the keyboard in the Call Stack list; why_new=Cycle 0046 finding 602 (decision R7 hands over only once the editor opened the paused file for its stop; row 263's first limit: a single click in the Call Stack keeps the list's keyboard); seam=pauseDebugger with staysInBackground for a session that is no Codebook run, passFocusToStoppedSession for the click (the file's opening, then the frame, as both editors report it), focusView, the run's capture and revealApplicationPaneOverPausedFile
test("a single click on the frame of a learner's stop kept behind a Codebook run's paused frame leaves the keyboard in the Call Stack view", async () => {
  // Arrange: a live run paused at a stop of its own, which the editor showed preserving the focus under Codebook's contributed default; the learner's own debug session stops meanwhile behind the run's frame, and the learner clicks into the Call Stack view.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
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
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      session: 'live-next-browser',
      staysInBackground: true,
    })
    codebookStopLedger.recordStop('live-next-browser', true)
    harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)
    harness.pauseDebugger({ session: 'learner-node', staysInBackground: true })
    harness.focusView()
    const before = {
      shows: harness.textDocumentShows().length,
      reveals: harness.panelReveals().length,
    }

    // Act: the learner single-clicks the frame of their own session in the Call Stack view, which opens its file preserving the focus and reports the frame; then the run's capture is rendered and the Application pane comes to the front.
    harness.passFocusToStoppedSession('learner-node', 'actions.ts', 2)
    harness.service.action({
      instanceId: harness.service.instanceId,
      runId: record.id,
      key: randomUUID(),
      action: 'repository-click',
    })
    await readerSeams(harness).refresh()
    await harness.revealApplicationPaneOverPausedFile()

    // Assert: the Call Stack view keeps the keyboard; nothing was shown or revealed with it, and nothing was told.
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

// Value: protects=the keyboard of a learner in the Call Stack view who single-clicks the frame of their own debug session kept behind a Codebook run's paused frame, when the extension host receives that frame before the file the click opens; fails_when=the hand-over of finding 589 takes the file that becomes active after the frame for the paused file of that stop and gives it the keyboard; why_new=Cycle 0046 finding 602 (the hand-over must hold whichever of the two reports reaches the extension host first; the reader's second sign, a text editor that becomes active after a frame, assumes the editors' own order and is not what this test covers); seam=pauseDebugger with staysInBackground for a session that is no Codebook run, passFocusToStoppedSession with the frame first, focusView
test("a single click on the frame of a learner's stop kept behind a Codebook run's paused frame gives no file the keyboard when its frame arrives before the file", async () => {
  // Arrange: a live run paused at a stop of its own, which the editor showed preserving the focus under Codebook's contributed default; the learner's own debug session stops meanwhile behind the run's frame, and the learner clicks into the Call Stack view.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      session: 'live-next-browser',
      staysInBackground: true,
    })
    codebookStopLedger.recordStop('live-next-browser', true)
    harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)
    harness.pauseDebugger({ session: 'learner-node', staysInBackground: true })
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length

    // Act: the learner single-clicks the frame of their own session; the extension host receives the frame first, then the file the click opened preserving the focus.
    harness.passFocusToStoppedSession(
      'learner-node',
      'actions.ts',
      2,
      'frame-then-file',
    )

    // Assert: the Call Stack view keeps the keyboard, and no file is shown with it.
    assert.equal(harness.keyboardInView(), true)
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in the Explorer while their own debug session reports a stop whose adapter asked the editor to keep the focus where it is; fails_when=the hand-over of finding 589 takes the next file that becomes active (one the learner opens from the Explorer with one click, which keeps the keyboard in the Explorer) for that stop's paused file and gives it the keyboard, although the editor's own handling of such a stop focuses nothing; why_new=Cycle 0046 finding 602 (decision R7 hands over only once the editor opened the paused file for its stop); seam=pauseDebugger with keepsFocus and staysInBackground for a session that is no Codebook run, focusView, openFileWithoutKeyboard, the clock of performance.now held for the editor events
test('a file opened from the Explorer after a stop whose adapter asked to keep the focus gets no keyboard from Codebook', async (t) => {
  // Arrange: the reader is open under Codebook's contributed default; the learner had a file in front of column 2 and went to the Explorer.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  try {
    await harness.reader.open()
    harness.focusMutableDraft('page.tsx', 2)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length

    // Act: on a held clock the learner's own debug session reports a stop with the adapter's preserveFocusHint, which the editor does not bring to the front; two seconds later the learner opens a file from the Explorer with one click.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.pauseDebugger({
      session: 'learner-node',
      staysInBackground: true,
      keepsFocus: true,
    })
    clockMs += 2_000
    harness.openFileWithoutKeyboard('notes.ts', 2)
    clock.mock.restore()

    // Assert: the Explorer keeps the keyboard, and no file is shown with it.
    assert.equal(harness.keyboardInView(), true)
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in the Call Stack view when the editor passes the focus to their own debug session, whose adapter asked the editor to keep the focus at its stop; fails_when=the hand-over of finding 589 takes the file the editor's focus pass opens preserving the focus for that stop's paused file and gives it the keyboard, although neither the stop's own handling nor the pass focuses it in the editor; why_new=Cycle 0046 finding 602 (decision R7 hands over only once the editor opened the paused file for its stop); seam=pauseDebugger with keepsFocus and staysInBackground, continueDebugSession, resumeDebugger, passFocusToStoppedSession, focusView, the clock of performance.now held for the editor events
test("the editor's focus pass to a learner's stop whose adapter asked to keep the focus gets no keyboard from Codebook", async (t) => {
  // Arrange: a live run paused at a stop of its own, which the editor showed preserving the focus under Codebook's contributed default; the learner clicked into the Call Stack view.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      session: 'live-next-browser',
      staysInBackground: true,
    })
    codebookStopLedger.recordStop('live-next-browser', true)
    harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length

    // Act: on a held clock the run's continue lets the browser session go on, and the editor reports its thread 200 ms later; then the learner's own session reports a stop with the adapter's preserveFocusHint, and 800 ms after the continue the editor passes the focus to it, opening its file preserving the focus.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    codebookStopLedger.openWindow(['live-next-browser'])
    harness.continueDebugSession('live-next-browser')
    clockMs += 200
    harness.resumeDebugger()
    harness.pauseDebugger({
      session: 'learner-node',
      staysInBackground: true,
      keepsFocus: true,
    })
    clockMs += 600
    harness.passFocusToStoppedSession('learner-node', 'actions.ts', 2)
    clock.mock.restore()

    // Assert: the Call Stack view keeps the keyboard, and no file is shown with it.
    assert.equal(harness.keyboardInView(), true)
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner whose own debug session stops while they work in a file, under Codebook's contributed debug.focusEditorOnBreak false; fails_when=the hand-over is narrowed so far that the stop the editor's own handling shows (its paused file opened preserving the focus over the learner's file, then its frame, the order both editors report them in) gets no keyboard, or gets it twice, so the keyboard falls on the window body or is taken again; why_new=Cycle 0046 finding 602 (the side of decision R7 the fix keeps: native parity at a stop the editor brings to the front itself); seam=pauseDebugger with staysInBackground for a session that is no Codebook run, showStopKeepingFocus, reportFrameOfSameStop
test("a stop of a learner's own debug session that the editor shows hands its paused file the keyboard once", async () => {
  // Arrange: the reader is open under Codebook's contributed default, and the learner works in a file in column 2.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  try {
    await harness.reader.open()
    harness.focusMutableDraft('page.tsx', 2)
    const showsBefore = harness.textDocumentShows().length

    // Act: the learner's session stops at a breakpoint; the editor's own handling opens the paused file preserving the focus and reports the frame, and focuses that frame again once the rest of the stack is loaded.
    harness.pauseDebugger({ session: 'learner-node', staysInBackground: true })
    harness.showStopKeepingFocus('learner-node', 'actions.ts', 2)
    harness.reportFrameOfSameStop()

    // Assert: the paused file is shown with the keyboard exactly once, and the window body has none.
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [
      { name: 'actions.ts', viewColumn: 2, preserveFocus: false },
    ])
    assert.equal(harness.keyboardOnBody(), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard at a learner's stop that was read behind a Codebook run's paused frame and that the editor's own handling still brings to the front after the run went on, before the editor's pass of the focus, where the editor's default would give its paused file the keyboard; fails_when=the fix of finding 602 refuses every stop read behind another session's frame, so the file the stop's own handling opens preserving the focus over the learner's file gets no keyboard and the keyboard falls on the window body; why_new=Cycle 0046 finding 602 (the hand-over follows the reader's own judgement of the stop, cameBeforeFocusPass); seam=pauseDebugger for two sessions with staysInBackground, continueDebugSession, resumeDebugger, showStopKeepingFocus, focusMutableDraft, the clock of performance.now held for the editor events
test("a learner's stop read behind a Codebook run's frame that the editor shows before its focus pass hands its paused file the keyboard", async (t) => {
  // Arrange: a live run paused at a stop of its own, which the editor showed preserving the focus under Codebook's contributed default; the learner works in a file in column 2.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      session: 'live-next-browser',
      staysInBackground: true,
    })
    codebookStopLedger.recordStop('live-next-browser', true)
    harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)
    harness.focusMutableDraft('page.tsx', 2)
    const showsBefore = harness.textDocumentShows().length

    // Act: on a held clock the learner's own session stops behind the run's frame; 100 ms later the run's continue lets the browser session go on, the editor reports its thread 200 ms after that, and 300 ms after the continue the stop's own handling opens its paused file preserving the focus and reports its frame.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.pauseDebugger({ session: 'learner-node', staysInBackground: true })
    clockMs += 100
    codebookStopLedger.openWindow(['live-next-browser'])
    harness.continueDebugSession('live-next-browser')
    clockMs += 200
    harness.resumeDebugger()
    clockMs += 100
    harness.showStopKeepingFocus('learner-node', 'actions.ts', 2)
    clock.mock.restore()

    // Assert: the paused file is shown with the keyboard, and the window body has none.
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [
      { name: 'actions.ts', viewColumn: 2, preserveFocus: false },
    ])
    assert.equal(harness.keyboardOnBody(), false)
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the chat's keyboard at a server stop that the run's own continue caused and that the editor brings to the front by its pass of the focus; fails_when=the hand-over takes the server's file, opened preserving the focus 800 ms after the browser session went on, for the paused file of a stop Codebook did not cause and moves the keyboard from the chat into it; why_new=Cycle 0046 finding 602 (row 274's order under decision R7: the server stop is read within 200 ms of the browser's continue while the browser's frame is still the active item, and its frame arrives by the editor's focus pass); seam=codebookStopLedger's window and verdict as the configured run writes them, pauseDebugger with staysInBackground, continueDebugSession, resumeDebugger, passFocusToStoppedSession, focusView for VS Code's chat view, the clock of performance.now held for the editor events
test("a server stop that Codebook's own continue caused leaves the keyboard in the chat when the editor's focus pass opens its file", async (t) => {
  // Arrange: a live run paused at a browser stop of its own, which the editor showed preserving the focus under Codebook's contributed default; the learner's keyboard is in VS Code's chat view.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  let live: { close(): void } | undefined
  try {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.pauseDebugger({
      session: 'live-next-browser',
      staysInBackground: true,
    })
    codebookStopLedger.recordStop('live-next-browser', true)
    harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length

    // Act: on a held clock the run's continue opens its window and lets the browser session go on; the server stops 100 ms later while the editor still shows the browser's frame, and the run records that stop as its own; the editor reports the browser's thread at 200 ms and passes the focus to the server's frame at 800 ms, opening its file preserving the focus.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    codebookStopLedger.openWindow(['live-next-browser', 'live-next-server'])
    harness.continueDebugSession('live-next-browser')
    clockMs += 100
    harness.pauseDebugger({ staysInBackground: true })
    codebookStopLedger.recordStop(
      'live-next-server',
      codebookStopLedger.isWindowOpen('live-next-server'),
    )
    clockMs += 100
    harness.resumeDebugger()
    clockMs += 600
    harness.passFocusToStoppedSession('live-next-server', 'actions.ts', 2)
    clock.mock.restore()

    // Assert: the chat view keeps the keyboard, and no file is shown with it.
    assert.equal(harness.keyboardInView(), true)
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
  } finally {
    live?.close()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner in the Explorer during a pause of their own debug session that a step within the paused file made: the editor opens nothing new for that stop, so no text editor becomes active, and a file the learner then opens from the Explorer with one click keeps the keyboard in the Explorer; fails_when=the hand-over of that stop stays armed because no active-editor change came for it, and Codebook gives the next file that becomes active in the same pause the keyboard; why_new=Cycle 0046 finding 603 (decision R7's parity with debug.focusEditorOnBreak true, which focuses the paused editor when the stop is shown: the stop's hand-over is resolved at the stop); seam=pauseDebugger with staysInBackground and showStopKeepingFocus for the first stop, continueDebugSession with the next request, pauseDebugger for the step's stop in the file already in front, focusView, openFileWithoutKeyboard, the clock of performance.now held for the editor events
test('a file opened from the Explorer two seconds after a step within the paused file gets no keyboard from Codebook', async (t) => {
  // Arrange: the reader is open under Codebook's contributed default; the learner's own debug session stopped at a breakpoint in actions.ts, which the editor showed preserving the focus over the learner's file, and Codebook gave actions.ts the keyboard.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  try {
    await harness.reader.open()
    harness.focusMutableDraft('page.tsx', 2)
    harness.pauseDebugger({ session: 'learner-node', staysInBackground: true })
    harness.showStopKeepingFocus('learner-node', 'actions.ts', 2)

    // Act: on a held clock the learner presses F10 in actions.ts: the editor sends the next request, the adapter stops on the next line of the same file, and the editor reports the frame with no active-editor change, actions.ts being in front already; the learner goes to the Explorer, and two seconds later opens a file from it with one click.
    let clockMs = Math.floor(performance.now())
    const clock = t.mock.method(performance, 'now', () => clockMs)
    harness.continueDebugSession('learner-node', 'next')
    harness.pauseDebugger({ session: 'learner-node', reason: 'step' })
    harness.focusView()
    clockMs += 2_000
    const showsBeforeOpen = harness.textDocumentShows().length
    harness.openFileWithoutKeyboard('notes.ts', 2)
    clock.mock.restore()

    // Assert: the Explorer keeps the keyboard, and the open shows no file with it.
    assert.equal(harness.keyboardInView(), true)
    assert.deepEqual(harness.textDocumentShows().slice(showsBeforeOpen), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard at a step within the paused file of a learner's own debug session that the learner started from a view (the Debug Console, the Call Stack), under Codebook's contributed debug.focusEditorOnBreak false; fails_when=Codebook hands over only at an active-editor change, so a stop whose paused file is in front already does not get the keyboard when the editor reports it, as the editor's default gives it (EditorPanes.doOpenEditor focuses the opened editor whenever preserveFocus is off, also an editor that is active already); why_new=Cycle 0046 finding 603 (decision R7 resolves the stop's hand-over at the stop: the paused editor gets the keyboard when the editor reports the stop's frame); seam=pauseDebugger with staysInBackground and showStopKeepingFocus for the first stop, focusView, continueDebugSession with the next request, pauseDebugger for the step's stop in the file already in front
test('a step within the paused file that the learner starts from a view gives the paused file the keyboard when the editor reports the stop', async () => {
  // Arrange: the reader is open under Codebook's contributed default; the learner's own debug session stopped at a breakpoint in actions.ts, which the editor showed preserving the focus over the learner's file, and Codebook gave actions.ts the keyboard; then the learner clicked into the Debug Console.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.contributeFocusEditorOnBreakDefault(false)
  try {
    await harness.reader.open()
    harness.focusMutableDraft('page.tsx', 2)
    harness.pauseDebugger({ session: 'learner-node', staysInBackground: true })
    harness.showStopKeepingFocus('learner-node', 'actions.ts', 2)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length

    // Act: the learner presses F10 in the Debug Console: the adapter stops on the next line of actions.ts, and the editor reports the frame with no active-editor change, actions.ts being in front already.
    harness.continueDebugSession('learner-node', 'next')
    harness.pauseDebugger({ session: 'learner-node', reason: 'step' })

    // Assert: the paused file is shown with the keyboard once; the Debug Console and the window body have none.
    assert.deepEqual(harness.textDocumentShows().slice(showsBefore), [
      { name: 'actions.ts', viewColumn: 2, preserveFocus: false },
    ])
    assert.equal(harness.keyboardInView(), false)
    assert.equal(harness.keyboardOnBody(), false)
  } finally {
    await harness.close()
  }
})
