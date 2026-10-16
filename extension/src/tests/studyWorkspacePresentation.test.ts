import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'

import { REPOSITORY_BROWSER_PROFILE as PROFILE_ID } from '../constants'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer } from '../server'

import {
  workspaceHarness,
  configuredWorkspaceHarness,
  openRetainedStudy,
  readerSeams,
  recordedReaderHarness,
} from './studyWorkspaceHarness'
import {
  advanceClockUntil,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'
for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext'])
  test(`a learner draft focus while ${kind} activity is delayed stops the transfer and preserves the prior preference`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let release = (): void => {},
      transfer: Promise<unknown> | undefined
    try {
      await harness.reader.open()
      const initial = harness.reader.presentationState()
      await harness.reader.changePresentation({
        presentationId: initial.presentationId,
        expectedRevision: initial.presentationControlRevision,
        mode: 'living-book',
        action: 'select',
      })
      const draft = harness.focusMutableDraft()
      await harness.reader.action(
        kind === 'codebook.scopedBrowser' ? 'focus-app' : 'focus-context',
      )
      const held = harness.holdPanelActivity(kind)
      release = held.release
      const state = harness.reader.presentationState()
      transfer = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'guided-walkthrough',
        action: 'select',
      })
      const rejected = assert.rejects(transfer, {
        code: 'PRESENTATION_UNAVAILABLE',
        causeDetail:
          'Error: Native focus left the owned presentation target; the newer learner choice was preserved.',
      })
      await held.started
      const commands = [...harness.commands],
        reveals = harness.panelReveals()
      // Act
      draft.focus()
      held.release()
      await rejected
      // Assert
      assert.equal(harness.groups[0]!.activeTab, draft.tab)
      assert.equal(harness.focusedPanel(), undefined)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(draft.tab.isDirty, true)
      assert.deepEqual(harness.commands, commands)
      assert.deepEqual(harness.panelReveals(), reveals)
      assert.equal(harness.reader.presentationState().mode, 'living-book')
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      assert.deepEqual(
        harness.presentationPreferences.get('codebook.presentation.v1'),
        { version: 1, mode: 'living-book' },
      )
      assert.equal(harness.runtimes.length, 0)
    } finally {
      release()
      await transfer?.catch(() => undefined)
      await harness.close()
    }
  })

for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext'])
  test(`mode transfer confirms ${kind} focus while VS Code retains its most recent text editor`, async () => {
    // Arrange: VS Code can keep activeTextEditor populated after native and inner webview focus succeed.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let release = (): void => {}
    try {
      await openRetainedStudy(harness)
      await harness.reader.understand(true)
      await harness.reader.action(
        kind === 'codebook.scopedBrowser' ? 'focus-app' : 'focus-context',
      )
      const before = harness.reader.inspect(),
        decisions = await (
          await harness.reader.learningStorage()
        ).readProgress()
      const held = harness.holdTextFocusClear(kind)
      release = held.release
      const state = harness.reader.presentationState()
      // Act: the last text editor remains reported for the entire handoff, as observed in ordinary VS Code.
      await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'living-book',
        action: 'select',
      })
      // Assert
      assert.equal(harness.reader.presentationState().mode, 'living-book')
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.deepEqual(
        harness.presentationPreferences.get('codebook.presentation.v1'),
        { version: 1, mode: 'living-book' },
      )
      assert.equal(harness.focusedPanel(), kind)
      assert.equal(harness.innerFocusedPanel(), kind)
      assert.equal(
        harness.focusedSource()?.document.uri.toString(),
        before.sourceUri,
      )
      assert.equal(harness.reader.inspect().sourceUri, before.sourceUri)
      assert.deepEqual(
        await (await harness.reader.learningStorage()).readProgress(),
        decisions,
      )
      assert.equal(harness.runtimes.length, 0)
    } finally {
      release()
      await harness.close()
    }
  })

for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext'])
  test(`clearing the last text editor during ${kind} reading restoration preserves confirmed native focus`, async (context) => {
    // Arrange: a late text-editor notification does not represent a new native tab or learner choice.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let release = (): void => {}
    try {
      await harness.reader.open()
      const initial = harness.reader.presentationState()
      await harness.reader.changePresentation({
        presentationId: initial.presentationId,
        expectedRevision: initial.presentationControlRevision,
        mode: 'guided-walkthrough',
        action: 'select',
      })
      await harness.reader.action(
        kind === 'codebook.scopedBrowser' ? 'focus-app' : 'focus-context',
      )
      const held = harness.holdTextFocusClear(kind)
      release = held.release
      let cleared = false
      harness.onNextPanel('codebook.studyContext', (panel) => {
        const post = panel.webview.postMessage.bind(panel.webview)
        context.mock.method(
          panel.webview,
          'postMessage',
          async (message: Parameters<typeof post>[0]) => {
            if (message.type === 'restore-presentation-pose') {
              assert.ok(harness.focusedSource())
              held.release()
              await Promise.resolve()
              cleared = true
            }
            return post(message)
          },
        )
      })
      const state = harness.reader.presentationState()
      // Act
      await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      // Assert
      assert.equal(cleared, true)
      assert.equal(harness.focusedSource(), undefined)
      assert.equal(harness.focusedPanel(), kind)
      assert.equal(harness.innerFocusedPanel(), kind)
      assert.equal(harness.reader.presentationState().mode, 'study-workspace')
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.deepEqual(
        harness.presentationPreferences.get('codebook.presentation.v1'),
        { version: 1, mode: 'study-workspace' },
      )
      assert.equal(harness.runtimes.length, 0)
    } finally {
      release()
      await harness.close()
      context.mock.restoreAll()
    }
  })

for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext'])
  test(`Study restoration preserves the prior source until delayed text focus clear follows ${kind} activation`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let release = (): void => {},
      transfer: Promise<unknown> | undefined
    try {
      await openRetainedStudy(harness)
      await harness.reader.understand(true)
      const initial = harness.reader.presentationState()
      await harness.reader.changePresentation({
        presentationId: initial.presentationId,
        expectedRevision: initial.presentationControlRevision,
        mode: 'guided-walkthrough',
        action: 'select',
      })
      await harness.reader.action(
        kind === 'codebook.scopedBrowser' ? 'focus-app' : 'focus-context',
      )
      const before = harness.reader.inspect(),
        decisions = await (
          await harness.reader.learningStorage()
        ).readProgress(),
        draft = harness.addForeignDraft()
      const held = harness.holdTextFocusClear(kind)
      release = held.release
      const state = harness.reader.presentationState()
      // Act: the owned tab/panel is already active when the previous text editor finally clears.
      transfer = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      await held.observed
      held.release()
      await transfer
      // Assert
      assert.equal(harness.reader.presentationState().mode, 'study-workspace')
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.deepEqual(
        harness.presentationPreferences.get('codebook.presentation.v1'),
        { version: 1, mode: 'study-workspace' },
      )
      assert.equal(harness.focusedPanel(), kind)
      assert.equal(harness.reader.inspect().sourceUri, before.sourceUri)
      assert.deepEqual(
        await (await harness.reader.learningStorage()).readProgress(),
        decisions,
      )
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(draft)),
        true,
      )
      assert.equal(draft.isDirty, true)
      assert.equal(harness.runtimes.length, 0)
    } finally {
      release()
      await transfer?.catch(() => undefined)
      await harness.close()
    }
  })

for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext'])
  test(`a learner draft chosen before text focus clear for ${kind} survives the refused Study restoration`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let release = (): void => {},
      transfer: Promise<unknown> | undefined
    try {
      await harness.reader.open()
      const initial = harness.reader.presentationState()
      await harness.reader.changePresentation({
        presentationId: initial.presentationId,
        expectedRevision: initial.presentationControlRevision,
        mode: 'guided-walkthrough',
        action: 'select',
      })
      const draft = harness.focusMutableDraft()
      await harness.reader.action(
        kind === 'codebook.scopedBrowser' ? 'focus-app' : 'focus-context',
      )
      const held = harness.holdTextFocusClear(kind)
      release = held.release
      const state = harness.reader.presentationState()
      transfer = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      const rejected = assert.rejects(transfer, {
        code: 'PRESENTATION_UNAVAILABLE',
        causeDetail:
          'Error: Native focus left the owned presentation target; the newer learner choice was preserved.',
      })
      await held.observed
      const commands = [...harness.commands],
        reveals = harness.panelReveals()
      // Act
      draft.focus()
      held.release()
      await rejected
      // Assert
      assert.equal(harness.groups[0]!.activeTab, draft.tab)
      assert.equal(harness.focusedPanel(), undefined)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(draft.tab.isDirty, true)
      assert.deepEqual(harness.commands, commands)
      assert.deepEqual(harness.panelReveals(), reveals)
      assert.equal(
        harness.reader.presentationState().mode,
        'guided-walkthrough',
      )
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      assert.deepEqual(
        harness.presentationPreferences.get('codebook.presentation.v1'),
        { version: 1, mode: 'guided-walkthrough' },
      )
      assert.equal(harness.runtimes.length, 0)
    } finally {
      release()
      await transfer?.catch(() => undefined)
      await harness.close()
    }
  })

for (const pane of ['app', 'contextPanel'] as const)
  test(`a learner draft focus during ${pane} placement stops later layout work and preserves that focus`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await harness.reader.open()
      const initial = harness.reader.presentationState()
      await harness.reader.changePresentation({
        presentationId: initial.presentationId,
        expectedRevision: initial.presentationControlRevision,
        mode: 'living-book',
        action: 'select',
      })
      const draft = harness.focusMutableDraft()
      await harness.reader.action('focus-context')
      const layoutChanges = harness.commands.filter(
        (command) => command === 'vscode.setEditorLayout',
      ).length
      let changedFocus = false
      harness.onNextPanel(
        pane === 'app' ? 'codebook.scopedBrowser' : 'codebook.studyContext',
        () => {
          changedFocus = true
          draft.focus()
        },
      )
      const state = harness.reader.presentationState()
      // Act
      await assert.rejects(
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'guided-walkthrough',
          action: 'select',
        }),
        {
          code: 'PRESENTATION_UNAVAILABLE',
          causeDetail:
            'Error: Native focus changed while presentation panes moved; the learner focus was preserved.',
        },
      )
      // Assert
      assert.equal(changedFocus, true)
      assert.equal(harness.groups[0]!.activeTab, draft.tab)
      assert.equal(harness.focusedPanel(), undefined)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(
        harness.commands.filter(
          (command) => command === 'vscode.setEditorLayout',
        ).length,
        layoutChanges,
      )
      assert.equal(harness.reader.presentationState().mode, 'living-book')
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      assert.deepEqual(
        harness.presentationPreferences.get('codebook.presentation.v1'),
        { version: 1, mode: 'living-book' },
      )
      assert.equal(harness.runtimes.length, 0)
    } finally {
      await harness.close()
    }
  })

test('a learner source selection during delayed placement is preserved without later movement or preference changes', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const initial = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: initial.presentationId,
      expectedRevision: initial.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    await harness.reader.action('focus-context')
    const layoutChanges = harness.commands.filter(
      (command) => command === 'vscode.setEditorLayout',
    ).length
    let selected:
        ReturnType<typeof harness.changeFocusedSourceSelection> | undefined,
      revealCount = 0
    harness.delayPanelRegistration('codebook.scopedBrowser', true)
    harness.onNextPanel('codebook.scopedBrowser', () => {
      selected = harness.changeFocusedSourceSelection(46)
      revealCount = harness.panelReveals().length
    })
    const state = harness.reader.presentationState()
    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'guided-walkthrough',
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        causeDetail:
          'Error: Native source selection changed while presentation panes moved; the learner selection was preserved.',
      },
    )
    // Assert
    assert.ok(selected)
    assert.deepEqual(
      selected.selections.map((selection) => selection.active.line),
      [46],
    )
    assert.equal(harness.panelReveals().length, revealCount)
    assert.equal(harness.focusedPanel(), undefined)
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      layoutChanges,
    )
    assert.equal(harness.reader.presentationState().mode, 'living-book')
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.deepEqual(
      harness.presentationPreferences.get('codebook.presentation.v1'),
      { version: 1, mode: 'living-book' },
    )
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

for (const replacement of ['wrapper', 'opened', 'unannounced'] as const)
  test(`source-group ${replacement} replacement during pane movement ${replacement === 'wrapper' ? 'retains' : 'invalidates'} presentation ownership`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await openRetainedStudy(harness)
      await harness.reader.understand(true)
      const initial = harness.reader.presentationState()
      await harness.reader.changePresentation({
        presentationId: initial.presentationId,
        expectedRevision: initial.presentationControlRevision,
        mode: 'living-book',
        action: 'select',
      })
      await harness.reader.action('focus-context')
      const source = harness.reader.inspect().sourceUri,
        decisions = await (
          await harness.reader.learningStorage()
        ).readProgress()
      let replaced = false
      harness.onNextPanel('codebook.scopedBrowser', () => {
        replaced = true
        harness.replaceEditorGroup(replacement)
      })
      const state = harness.reader.presentationState()
      // Act
      const changing = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'guided-walkthrough',
        action: 'select',
      })
      if (replacement === 'wrapper') await changing
      else
        await assert.rejects(changing, {
          code: 'PRESENTATION_UNAVAILABLE',
          causeDetail:
            'Error: Native focus changed while presentation panes moved; the learner focus was preserved.',
        })
      // Assert
      assert.equal(replaced, true)
      assert.equal(harness.reader.inspect().sourceUri, source)
      assert.deepEqual(
        await (await harness.reader.learningStorage()).readProgress(),
        decisions,
      )
      assert.equal(
        harness.reader.presentationState().layoutConfirmed,
        replacement === 'wrapper',
      )
      assert.equal(
        harness.reader.presentationState().mode,
        replacement === 'wrapper' ? 'guided-walkthrough' : 'living-book',
      )
      assert.equal(harness.runtimes.length, 0)
    } finally {
      await harness.close()
    }
  })

test('mode transfer waits for replacement-pane registration before treating the new grid as a stable learner arrangement', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    await harness.reader.action('focus-app')
    await harness.reader.understand(true)
    const before = harness.reader.inspect(),
      decisions = await (await harness.reader.learningStorage()).readProgress(),
      draft = harness.addForeignDraft()
    harness.delayPanelRegistration('codebook.studyContext', true)
    const state = harness.reader.presentationState()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    // Assert
    assert.equal(harness.reader.presentationState().mode, 'living-book')
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(harness.reader.inspect().sourceUri, before.sourceUri)
    assert.deepEqual(
      await (await harness.reader.learningStorage()).readProgress(),
      decisions,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft)),
      true,
    )
    assert.equal(draft.isDirty, true)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

test('Guided walkthrough returns to Study without an unnecessary kept-tab focus handoff', async () => {
  // Arrange: native Keep Editor focus can echo even though both owned tabs are already retained.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    let state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'guided-walkthrough',
      action: 'select',
    })
    state = harness.reader.presentationState()
    const source = harness.reader.inspect().sourceUri
    const focusedPanel = harness.focusedPanel(),
      draft = harness.addForeignDraft()
    harness.deferKeptFocusEcho()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert: the unchanged source, learner draft and initiating focus survive the confirmed mode change.
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.reader.inspect().sourceUri, source)
    assert.equal(harness.focusedPanel(), focusedPanel)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft)),
      true,
    )
    assert.equal(draft.isDirty, true)
    assert.deepEqual(
      harness.presentationPreferences.get('codebook.presentation.v1'),
      { version: 1, mode: 'study-workspace' },
    )
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

test('a learner source selection during final reading restoration survives without a later focus restore', async () => {
  // Arrange: already kept tabs leave the verified source focused while its reading position settles.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const state = harness.reader.presentationState()
    let changedSource:
      ReturnType<typeof harness.changeFocusedSourceSelection> | undefined
    harness.changeAfterNextReadingReveal(() => {
      changedSource = harness.changeFocusedSourceSelection(46)
    })
    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'guided-walkthrough',
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        causeDetail:
          'Error: Native source selection changed while presentation panes moved; the learner selection was preserved.',
      },
    )
    // Assert: neither the previous selection nor the prior explanation focus may replace the learner choice.
    assert.ok(changedSource)
    assert.equal(changedSource.selections[0]?.active.line, 46)
    assert.equal(harness.focusedPanel(), undefined)
    assert.equal(harness.presentationPreferences.size, 0)
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

test('switching presentation waits for restored application focus before confirming the new mode', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('focus-app')
    const state = harness.reader.presentationState()
    // A single final focus request must await its delayed native notification.
    harness.deferPanelFocus('codebook.scopedBrowser', 1)
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    // Assert
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(harness.reader.presentationState().mode, 'living-book')
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.deepEqual(
      harness.presentationPreferences.get('codebook.presentation.v1'),
      { version: 1, mode: 'living-book' },
    )
  } finally {
    await harness.close()
  }
})

test('a missing explicit replay-focus receipt rejects once without retrying focus or losing retained evidence', async (context) => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
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
    await harness.reader.understand(true)
    await harness.reader.action('focus-app')
    const source = harness.reader.inspect().sourceUri,
      bundle = harness.controller.bundle(),
      library = await harness.reader.learningStorage()
    const decisions = (await library.readProgress()).decisions,
      draft = harness.addForeignDraft()
    let focusRequests = 0,
      placedLayout: unknown
    const app = harness.reader['app']
    assert.ok(app)
    {
      const post = app.webview.postMessage.bind(app.webview)
      context.mock.method(
        app.webview,
        'postMessage',
        (message: Parameters<typeof post>[0]) => {
          if (message.type === 'codebook-focus' && message.phase === 'commit') {
            focusRequests++
            placedLayout ??= harness.editorLayout()
            return Promise.resolve(true)
          }
          return post(message)
        },
      )
    }
    const state = harness.reader.presentationState()
    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'focus',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        causeDetail:
          'Error: Codebook asked the Application pane to take the keyboard, and the pane did not confirm it within 5 seconds. The action was stopped there and nothing else was changed. Click into the Application pane and repeat the action.',
      },
    )
    // Assert: failed focus cannot change layout, select another mode or rewrite learner evidence.
    assert.equal(
      focusRequests,
      1,
      'One failed final restore must not trigger a second full focus wait',
    )
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    assert.equal(
      harness.reader.presentationState().layoutConfirmed,
      state.layoutConfirmed,
    )
    assert.equal(harness.reader.presentationState().state, 'open')
    assert.equal(harness.presentationPreferences.size, 0)
    assert.deepEqual(harness.editorLayout(), placedLayout)
    assert.equal(harness.controller.state().mode, 'paused')
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(harness.controller.bundle(), bundle)
    assert.equal(harness.reader.inspect().sourceUri, source)
    assert.equal(harness.displayedImage(), harness.png.toString('base64'))
    assert.deepEqual((await library.readProgress()).decisions, decisions)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft)),
      true,
    )
    assert.equal(draft.isDirty, true)
    assert.equal(harness.runtimes.length, 1)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

for (const editStage of [
  'before focus restoration',
  'during native source display',
  'during reading reveal',
] as const)
  test(`a draft edited ${editStage} rejects its obsolete reading pose without overwriting the new text`, async () => {
    // Arrange: the same native tab survives a document edit, so group ownership alone cannot validate its old pose.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await harness.reader.open()
      const draft = harness.focusMutableDraft()
      harness.retainReadingRange(84, 96)
      const restoreFocus = harness.reader['capturePresentationFocus'](undefined)
      await harness.reader.action('focus-app')
      const edit = (): void =>
        draft.replaceContent('New first line.\nNew last line.\n')
      if (editStage === 'before focus restoration') edit()
      else if (editStage === 'during native source display')
        harness.changeAfterNextSourceDisplay(edit)
      else harness.changeAfterNextReadingReveal(edit)
      // Act
      await assert.rejects(
        restoreFocus(),
        /document changed during presentation/,
      )
      // Assert: changed text and its learner-owned dirty tab remain untouched; no new mode can be saved.
      assert.equal(
        draft.document.getText(),
        'New first line.\nNew last line.\n',
      )
      assert.equal(draft.document.version, 2)
      assert.equal(draft.tab.isDirty, true)
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(draft.tab)),
        true,
      )
      assert.equal(harness.presentationPreferences.size, 0)
    } finally {
      await harness.close()
    }
  })

test('an unchanged learner draft restores its reading pose and remains dirty', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const draft = harness.focusMutableDraft()
    harness.retainReadingRange(84, 96)
    const restoreFocus = harness.reader['capturePresentationFocus'](undefined)
    await harness.reader.action('focus-app')
    // Act
    await restoreFocus()
    // Assert
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(draft.document.version, 1)
    assert.equal(draft.tab.isDirty, true)
    assert.equal(harness.isReadingLineVisible(90), true)
    assert.equal(harness.focusedPanel(), undefined)
  } finally {
    await harness.close()
  }
})

test('restoring replay preserves a learner draft opened over historical source during layout measurement', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
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
    await harness.reader.understand(true)
    await harness.reader.action('read-source')
    const source = harness.reader.inspect().sourceUri,
      bundle = harness.controller.bundle(),
      library = await harness.reader.learningStorage()
    const progress = await library.readProgress(),
      layout = harness.holdNextCommand('vscode.getEditorLayout')
    release = layout.release
    const state = harness.reader.presentationState()
    const restoring = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })
    const rejected = assert.rejects(restoring, /focus|pane|tab/i)
    await layout.started
    // Act: the newer draft owns the historical source's group before measurement returns.
    const draft = harness.focusMutableDraft('replay-reading-notes.txt', 2),
      placedLayout = harness.editorLayout()
    const commands = [...harness.commands],
      reveals = harness.panelReveals()
    layout.release()
    await rejected
    // Assert
    assert.equal(draft.editor.group.activeTab, draft.tab)
    assert.equal(draft.tab.isDirty, true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(harness.editorLayout(), placedLayout)
    // The held read was the first layout read after the end of the Read's maximization. The recording's two rows gave the Read no width to measure the side bars by, so it hid none and none is shown (Cycle 0045 local review study-1 #1). No command follows.
    assert.deepEqual(harness.commands, commands)
    assert.deepEqual(harness.panelReveals(), reveals)
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.equal(harness.presentationPreferences.size, 0)
    assert.equal(harness.controller.state().mode, 'paused')
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(harness.controller.bundle(), bundle)
    assert.equal(harness.reader.inspect().sourceUri, source)
    assert.equal(harness.displayedImage(), harness.png.toString('base64'))
    assert.deepEqual(await library.readProgress(), progress)
    assert.equal(harness.runtimes.length, 1)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
  } finally {
    release()
    await harness.close()
  }
})

test('moving a presentation retains both measured axes when native pane creation flattens the grid', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    harness.changeEditorLayout({
      orientation: 0,
      groups: [
        { size: 352, groups: [{ size: 154 }, { size: 154 }] },
        { size: 288 },
      ],
    })
    harness.onNextPanel('codebook.scopedBrowser', () =>
      harness.changeEditorLayout({
        orientation: 0,
        groups: [{ size: 220 }, { size: 220 }, { size: 220 }],
      }),
    )
    const state = harness.reader.presentationState()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'restore',
    })
    // Assert
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 384 },
        { size: 256, groups: [{ size: 154 }, { size: 154 }] },
      ],
    })
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
  } finally {
    await harness.close()
  }
})

test('reselecting a confirmed presentation clears a stale control warning and keeps the selector usable', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    let state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    state = harness.reader.presentationState()
    harness.receive({
      type: 'presentation',
      revision: harness.reader.inspect().view!.revision,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision + 1,
      mode: 'living-book',
      action: 'select',
    })
    await waitUntil(
      () =>
        harness.reader
          .inspect()
          .view!.errors.some((error) =>
            error.includes('control revision changed'),
          ),
      'stale presentation diagnostic',
      1_000,
    )
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    // Assert
    assert.equal(harness.reader.inspect().view!.errors.length, 0)
    assert.equal(
      harness.reader.presentationState().presentationControlRevision,
      1,
    )
    assert.equal(harness.postedMessages().at(-1)!.presentation!.state, 'open')
  } finally {
    await harness.close()
  }
})

test('same-mode selection keeps its revision only while the actual native layout is still confirmed', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    let state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    state = harness.reader.presentationState()
    const commands = [...harness.commands]
    // Act / Assert
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    assert.equal(
      harness.reader.presentationState().presentationControlRevision,
      1,
    )
    assert.deepEqual(harness.commands, [...commands, 'vscode.getEditorLayout'])
    harness.changeEditorLayout({
      orientation: 0,
      groups: [
        { size: 0.5, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.5 },
      ],
    })
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    assert.equal(
      harness.reader.presentationState().presentationControlRevision,
      2,
    )
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.6 },
        { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] },
      ],
    })
  } finally {
    await harness.close()
  }
})

test('a failed mode preference keeps the applied layout and save-only recovery does not move any editor', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    harness.failPresentationPreference(true)
    let state = harness.reader.presentationState()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    // Assert
    state = harness.reader.presentationState()
    assert.equal(state.mode, 'living-book')
    assert.equal(state.layoutConfirmed, true)
    assert.equal(state.preference.status, 'failed')
    const commands = [...harness.commands],
      reveals = harness.panelReveals()
    harness.failPresentationPreference(false)
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'save-preference',
    })
    assert.equal(harness.reader.presentationState().preference.status, 'saved')
    assert.deepEqual(harness.commands, commands)
    assert.deepEqual(harness.panelReveals(), reveals)
    assert.equal(
      harness.reader.presentationState().presentationControlRevision,
      2,
    )
  } finally {
    await harness.close()
  }
})

test('Close retires the reader identity immediately and waits for an already accepted presentation preference write', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  let held: ReturnType<typeof harness.holdPresentationPreference> | undefined
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    held = harness.holdPresentationPreference()
    await harness.reader.open()
    const state = harness.reader.presentationState()
    const pending = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    const rejected = assert.rejects(pending, /not confirmed/)
    await held.started
    // Act
    let closed = false
    const closing = harness.reader.close().then(() => {
      closed = true
    })
    // Assert
    assert.notEqual(
      harness.reader.presentationState().presentationId,
      state.presentationId,
    )
    assert.equal(
      harness.reader.presentationState().presentationControlRevision,
      0,
    )
    assert.equal(closed, false)
    assert.throws(
      () =>
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: 1,
          mode: 'living-book',
          action: 'select',
        }),
      /lifetime has ended/,
    )
    held.release()
    await rejected
    await closing
    assert.equal(closed, true)
    assert.deepEqual(
      harness.presentationPreferences.get('codebook.presentation.v1'),
      { version: 1, mode: 'living-book' },
    )
    assert.equal(harness.reader.presentationState().mode, 'living-book')
    assert.equal(harness.reader.presentationState().state, 'closed')
  } finally {
    try {
      held?.release()
    } finally {
      await harness.close()
    }
  }
})

test('Close cancels pending focus recovery after a native layout failure without losing the draft or original failure', async (context) => {
  // Arrange: earlier owned-panel focus receipts succeed; failure recovery receives no final focus receipt.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let recoveryEntered = (): void => {}
  const recoveryStarted = new Promise<void>((resolve) => {
    recoveryEntered = resolve
  })
  try {
    await harness.reader.open()
    await harness.reader.action('focus-app')
    const draft = harness.addForeignDraft(),
      state = harness.reader.presentationState()
    let focusRequests = 0
    harness.onNextPanel('codebook.scopedBrowser', (app) => {
      const post = app.webview.postMessage.bind(app.webview)
      context.mock.method(
        app.webview,
        'postMessage',
        (message: Parameters<typeof post>[0]) => {
          if (message.type === 'codebook-focus' && message.phase === 'commit') {
            focusRequests++
            recoveryEntered()
            return Promise.resolve(true)
          }
          return post(message)
        },
      )
      // Fail the measured layout read after adoption and source anchoring; only error-path focus recovery follows.
      harness.failNextCommand('vscode.getEditorLayout')
    })
    const transfer = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    const rejected = assert.rejects(transfer, {
      code: 'PRESENTATION_UNAVAILABLE',
      causeDetail: 'Error: Native layout command failed',
    })
    await recoveryStarted
    const cancellation =
      harness.reader['presentationTransition']?.cancellation.signal
    assert.ok(cancellation)
    // Act: Close arrives after recovery begins, so its initial ownership check cannot skip the recovery.
    let closed = false
    const closing = harness.reader.close().then(() => {
      closed = true
    })
    assert.equal(cancellation.aborted, true)
    await waitUntil(
      () => closed,
      'Close cancels the recovery receipt',
      1_000,
    ).catch(() => undefined)
    const closedWithinBudget = closed
    // Drain even a failing regression so no native operation outlives this test.
    await closing
    await rejected
    // Assert
    assert.equal(focusRequests, 1)
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    assert.notEqual(
      harness.reader.presentationState().presentationId,
      state.presentationId,
    )
    assert.equal(harness.counts().panels, 0)
    assert.equal(harness.presentationPreferences.size, 0)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft)),
      true,
    )
    assert.equal(draft.isDirty, true)
    assert.equal(harness.runtimes.length, 0)
    assert.equal(
      closedWithinBudget,
      true,
      'Close should cancel an in-flight recovery focus receipt instead of waiting its full timeout',
    )
  } finally {
    context.mock.restoreAll()
    await harness.close()
  }
})

for (const mode of ['study-workspace', 'living-book', 'guided-walkthrough'])
  test(`ordinary chat opens a closed ${mode} through MCP without starting execution or changing learner work`, async () => {
    // Arrange
    let harness: Awaited<ReturnType<typeof workspaceHarness>> | undefined
    let reader:
      | ReturnType<Awaited<ReturnType<typeof workspaceHarness>>['createReader']>
      | undefined
    let endpoint: Awaited<ReturnType<typeof startServer>> | undefined
    let client: Client | undefined
    try {
      harness = await workspaceHarness(false)
      harness.useNativeLayout({ orientation: 0, groups: [{}] })
      const draft = harness.focusMutableDraft()
      if (mode !== 'study-workspace')
        harness.presentationPreferences.set('codebook.presentation.v1', {
          version: 1,
          mode,
        })
      reader = harness.createReader()
      await reader.attach(harness.service)
      const progress = await (await reader.learningStorage()).readProgress()
      endpoint = await startServer(harness.service)
      const transport = new StreamableHTTPClientTransport(
        new URL(endpoint.descriptor.url),
        {
          requestInit: {
            headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
          },
        },
      )
      client = new Client({ name: 'cold-presentation-test', version: '1.0' })
      await client.connect(transport)
      // Act: ordinary discovery must not open panes; the explicit presentation request owns that effect.
      const discovery = await client.callTool({
        name: 'codebook_status',
        arguments: {},
      })
      const selected = z
        .object({
          data: z.object({
            instanceId: z.string(),
            presentation: z.object({
              presentationId: z.string(),
              presentationControlRevision: z.number(),
              mode: z.string(),
              state: z.string(),
            }),
          }),
        })
        .parse(discovery.structuredContent).data
      assert.equal(selected.presentation.mode, mode)
      assert.equal(selected.presentation.state, 'closed')
      assert.equal(harness.counts().panels, 0)
      const opened = await client.callTool({
        name: 'codebook_presentation',
        arguments: {
          instanceId: selected.instanceId,
          presentationId: selected.presentation.presentationId,
          expectedRevision: selected.presentation.presentationControlRevision,
          mode: selected.presentation.mode,
          action: 'select',
        },
      })
      // Assert
      assert.equal(
        opened.isError,
        undefined,
        JSON.stringify(opened.structuredContent),
      )
      const state = reader.presentationState()
      assert.equal(state.state, 'open')
      assert.equal(state.mode, mode)
      assert.equal(state.layoutConfirmed, true)
      assert.equal(state.reader.contentTab, 'overview')
      assert.equal(state.reader.followingCurrentRun, true)
      // A newly opened reader follows the run but still needs the public Live selection before runtime input.
      const openedState = z
        .object({
          data: z.object({ reader: z.object({ contentRevision: z.number() }) }),
        })
        .parse(opened.structuredContent).data
      const returned = await client.callTool({
        name: 'codebook_return_current',
        arguments: {
          instanceId: selected.instanceId,
          presentationId: selected.presentation.presentationId,
          expectedRevision: openedState.reader.contentRevision,
        },
      })
      assert.equal(
        returned.isError,
        undefined,
        JSON.stringify(returned.structuredContent),
      )
      assert.equal(reader.presentationState().reader.contentTab, 'live')
      assert.equal(reader.presentationState().reader.followingCurrentRun, true)
      // Live uses native chat beside App/source; the saved preference still belongs to the learner.
      assert.equal(reader.presentationState().mode, 'study-workspace')
      assert.equal(reader.presentationState().preference.mode, mode)
      assert.equal(reader.presentationState().panes.contextColumn, undefined)
      assert.equal(harness.counts().panels, 1)
      assert.equal(harness.runtimes.length, 0)
      assert.equal(harness.service.records.size, 0)
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(draft.tab)),
        true,
      )
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(draft.tab.isDirty, true)
      assert.deepEqual(
        await (await reader.learningStorage()).readProgress(),
        progress,
      )
    } finally {
      try {
        await client?.close()
      } finally {
        try {
          await endpoint?.close()
        } finally {
          try {
            await reader?.dispose()
          } finally {
            await harness?.close()
          }
        }
      }
    }
  })

test('real MCP presentation discovery and control preserve identities across response loss and reject stale clients', async () => {
  // Arrange
  let harness: Awaited<ReturnType<typeof workspaceHarness>> | undefined
  let endpoint: Awaited<ReturnType<typeof startServer>> | undefined
  let client: Client | undefined
  try {
    harness = await workspaceHarness()
    // An earlier version saved a layout that is retired now; the reader still opens in it.
    harness.presentationPreferences.set('codebook.presentation.v1', {
      version: 1,
      mode: 'living-book',
    })
    await harness.reader.close()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    await harness.reader.open()
    endpoint = await startServer(harness.service)
    const transport = new StreamableHTTPClientTransport(
      new URL(endpoint.descriptor.url),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
        },
      },
    )
    client = new Client({ name: 'presentation-contract-test', version: '1.0' })
    await client.connect(transport)
    // Act
    const tools = await client.listTools(),
      discovery = await client.callTool({
        name: 'codebook_status',
        arguments: {},
      })
    const selected = z
      .object({
        data: z.object({
          instanceId: z.string(),
          presentation: z.object({
            presentationId: z.string(),
            presentationControlRevision: z.number(),
            uri: z.string(),
          }),
        }),
      })
      .parse(discovery.structuredContent).data
    const input = {
      instanceId: selected.instanceId,
      presentationId: selected.presentation.presentationId,
      expectedRevision: selected.presentation.presentationControlRevision,
      mode: 'study-workspace',
    }
    const before = [...harness.commands]
    const wrong = await client.callTool({
      name: 'codebook_presentation',
      arguments: { ...input, instanceId: randomUUID() },
    })
    // Assert
    assert.match(JSON.stringify(wrong.structuredContent), /STALE_INSTANCE/)
    assert.deepEqual(harness.commands, before)
    const tool = tools.tools.find(
      (tool) => tool.name === 'codebook_presentation',
    )!
    assert.equal(tool.annotations?.destructiveHint, false)
    assert.equal(tool.annotations?.openWorldHint, false)
    assert.deepEqual(tool.inputSchema.properties?.mode, {
      type: 'string',
      enum: ['study-workspace', 'living-book', 'guided-walkthrough'],
    })
    assert.equal(tool.inputSchema.required?.includes('action'), false)
    // The retired layouts can no longer be selected (Cycle 0044, 0031-U7): the refusal names them and has no native effect.
    const retiredLayout = await client.callTool({
      name: tool.name,
      arguments: { ...input, mode: 'guided-walkthrough' },
    })
    assert.match(
      JSON.stringify(retiredLayout.structuredContent),
      /PRESENTATION_UNAVAILABLE/,
    )
    assert.match(
      JSON.stringify(retiredLayout.structuredContent),
      /The Living book and Guided walkthrough layouts are retired\. Select study-workspace/,
    )
    // The refusal may read the native layout to learn the reader's mode, but never changes it.
    assert.equal(
      harness.commands.filter((command) => command === 'vscode.setEditorLayout')
        .length,
      before.filter((command) => command === 'vscode.setEditorLayout').length,
    )
    assert.equal(
      harness.commands.filter((command) => command === 'runCommands').length,
      before.filter((command) => command === 'runCommands').length,
    )
    assert.equal(harness.reader.presentationState().mode, 'living-book')
    assert.match(tool.description ?? '', /layouts are retired/)
    const applied = await client.callTool({ name: tool.name, arguments: input })
    assert.equal(applied.isError, undefined)
    const resource = await client.readResource({
      uri: selected.presentation.uri,
    })
    const contents = resource.contents[0]
    assert.ok(contents && 'text' in contents)
    const receipt = z
      .object({
        instanceId: z.string(),
        presentationId: z.string(),
        presentationControlRevision: z.number(),
        mode: z.string(),
        preference: z.object({ status: z.string() }),
      })
      .parse(JSON.parse(contents.text))
    assert.equal(receipt.presentationId, selected.presentation.presentationId)
    assert.equal(receipt.presentationControlRevision, 1)
    assert.equal(receipt.mode, 'study-workspace')
    assert.equal(receipt.preference.status, 'saved')
    const commands = [...harness.commands]
    const stale = await client.callTool({ name: tool.name, arguments: input })
    assert.match(JSON.stringify(stale.structuredContent), /STALE_PRESENTATION/)
    assert.deepEqual(harness.commands, commands)
    await harness.reader.close()
    const retired = await client.callTool({
      name: tool.name,
      arguments: { ...input, expectedRevision: 1 },
    })
    assert.match(
      JSON.stringify(retired.structuredContent),
      /PRESENTATION_INSTANCE_GONE/,
    )
    assert.equal(harness.runtimes.length, 0)
    assert.equal(harness.service.records.size, 0)
  } finally {
    try {
      await client?.close()
    } finally {
      try {
        await endpoint?.close()
      } finally {
        await harness?.close()
      }
    }
  }
})

test('editor AI can return a saved recording to its current run without repeating application input or losing history', async () => {
  // Arrange
  const harness = await recordedReaderHarness()
  const service = harness.service
  let next: ReturnType<typeof service.start> | undefined
  let endpoint: Awaited<ReturnType<typeof startServer>> | undefined
  let client: Client | undefined
  try {
    // The run is started while the reader follows it; a start made while the reader shows the recording is refused (OBS-1).
    next = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'before-saved-recording',
    })
    await service.record(next).preparation
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    endpoint = await startServer(service)
    const transport = new StreamableHTTPClientTransport(
      new URL(endpoint.descriptor.url),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
        },
      },
    )
    client = new Client({ name: 'reader-return-contract-test', version: '1.0' })
    await client.connect(transport)
    const status = await client.callTool({
      name: 'codebook_status',
      arguments: {},
    })
    const discovered = z
      .object({
        data: z.object({
          instanceId: z.string(),
          presentation: z.object({
            presentationId: z.string(),
            reader: z.object({
              contentRevision: z.number(),
              contentTab: z.literal('recording'),
              followingCurrentRun: z.literal(false),
            }),
          }),
        }),
      })
      .parse(status.structuredContent).data
    const input = {
      instanceId: discovered.instanceId,
      presentationId: discovered.presentation.presentationId,
      expectedRevision: discovered.presentation.reader.contentRevision,
    }
    const stale = await client.callTool({
      name: 'codebook_return_current',
      arguments: { ...input, expectedRevision: input.expectedRevision + 1 },
    })
    const wrong = await client.callTool({
      name: 'codebook_return_current',
      arguments: { ...input, instanceId: randomUUID() },
    })
    assert.match(JSON.stringify(stale.structuredContent), /STALE_PRESENTATION/)
    assert.match(JSON.stringify(wrong.structuredContent), /STALE_INSTANCE/)
    assert.equal(harness.controller.state().mode, 'paused')
    // Act
    const returned = await client.callTool({
      name: 'codebook_return_current',
      arguments: input,
    })
    const result = z
      .object({
        data: z.object({
          presentationId: z.string(),
          reader: z.object({
            contentRevision: z.number(),
            contentTab: z.literal('live'),
            followingCurrentRun: z.literal(true),
          }),
        }),
      })
      .parse(returned.structuredContent).data
    // Assert
    assert.equal(returned.isError, undefined)
    assert.equal(result.presentationId, input.presentationId)
    assert.ok(result.reader.contentRevision > input.expectedRevision)
    assert.equal(harness.reader.inspect().view!.model.selection.follow, true)
    assert.equal(harness.runtimes.at(-1)!.dispatches, 0)
    const library = await harness.reader.learningStorage()
    assert.equal((await library.readStudy(harness.studyId)).id, harness.studyId)
    assert.equal((await library.readProgress()).decisions.length, 0)
  } finally {
    try {
      await client?.close()
    } finally {
      try {
        await endpoint?.close()
      } finally {
        try {
          if (next) await service.stop(next)
        } finally {
          await harness.close()
        }
      }
    }
  }
})

test('an unknown presentation preference survives opening until an explicit replacement', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  const stored = { version: 91, mode: 'future-mode', foreign: 'retained' }
  harness.presentationPreferences.set('codebook.presentation.v1', stored)
  harness.presentationPreferences.set('unrelated', { value: 'retained' })
  await harness.reader.close()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    // Act
    await harness.reader.open()
    // Assert
    let state = harness.reader.presentationState()
    assert.equal(state.mode, 'study-workspace')
    assert.equal(state.preference.status, 'unknown')
    assert.equal(state.presentationControlRevision, 0)
    assert.deepEqual(
      harness.presentationPreferences.get('codebook.presentation.v1'),
      stored,
    )
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    state = harness.reader.presentationState()
    assert.equal(state.preference.status, 'saved')
    assert.equal(state.presentationControlRevision, 1)
    assert.deepEqual(
      harness.presentationPreferences.get('codebook.presentation.v1'),
      { version: 1, mode: 'study-workspace' },
    )
    assert.deepEqual(harness.presentationPreferences.get('unrelated'), {
      value: 'retained',
    })
  } finally {
    await harness.close()
  }
})

test('a foreign preview is preserved without Keep Editor or relocation when selecting another presentation', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const draft = harness.addForeignDraft(1)
    Reflect.set(draft, 'isPreview', true)
    const state = harness.reader.presentationState(),
      commands = [...harness.commands],
      reveals = harness.panelReveals()
    // Act / Assert
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
          'A destination group contains a foreign preview: "notes.txt" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
      },
    )
    assert.deepEqual(harness.commands, commands)
    assert.deepEqual(harness.panelReveals(), reveals)
    assert.equal(Reflect.get(draft, 'isPreview'), true)
    assert.equal(draft.isDirty, true)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft)),
      true,
    )
    assert.equal(harness.presentationPreferences.size, 0)
    // Cycle 0044 (0041-N10-5 / 0042-R2): the refusal names the tab and the remedy; red while it said only "a foreign preview".
    assert.equal(
      harness.reader.presentationState().reason,
      'Error: A destination group contains a foreign preview: "notes.txt" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
    )
  } finally {
    await harness.close()
  }
})

for (const boundary of ['layout read', 'layout application'] as const)
  test(`manual resume during presentation ${boundary} cannot certify or save a different live state`, async () => {
    // Arrange
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let release = (): void => {}
    try {
      await harness.reader.open()
      harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      await [...harness.service.records.values()][0]!.preparation
      const runtime = harness.runtimes[0]!,
        view = runtime.view.bind(runtime)
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
        'base64',
      )
      await writeFile(
        join(runtime.evidence.directory, 'paused-browser.png'),
        png,
      )
      runtime.view = () => ({
        ...view(),
        captures: {
          'paused-browser': {
            status: 'captured',
            file: 'paused-browser.png',
            renderer: { epoch: 'test', id: 1, hash: sha256(png) },
          },
        },
      })
      await harness.reader.action('click')
      await harness.reader.action('focus-app')
      harness.changeEditorLayout({
        orientation: 1,
        groups: [{ size: 0.7 }, { size: 0.3 }],
      })
      const state = harness.reader.presentationState()
      const held = harness.holdNextCommand(
        boundary === 'layout read'
          ? 'vscode.getEditorLayout'
          : 'vscode.setEditorLayout',
      )
      release = held.release
      const transfer = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      const rejected = assert.rejects(transfer, /live pause changed/)
      await held.started
      // Act: a native debugger action changes the pause while native layout acknowledgement is pending.
      runtime.gate.invalidate()
      runtime.status = 'ready'
      held.release()
      await rejected
      // Assert
      assert.equal(harness.reader.presentationState().mode, 'study-workspace')
      assert.equal(harness.presentationPreferences.size, 0)
      assert.equal(runtime.dispatches, 1)
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    } finally {
      release()
      await harness.close()
    }
  })

for (const learnerChange of ['pane movement', 'focus change'] as const)
  test(`presentation layout read preserves a later learner ${learnerChange} without saving the mode`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let release = (): void => {}
    try {
      await harness.reader.open()
      const held = harness.holdNextCommand('vscode.getEditorLayout')
      release = held.release
      const state = harness.reader.presentationState()
      const transfer = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'living-book',
        action: 'select',
      })
      const rejected = assert.rejects(transfer, /not confirmed/)
      await held.started
      // Act: the reader still has three groups, but the learner now owns the changed pane or focus.
      harness.movePanel(
        learnerChange === 'pane movement'
          ? 'codebook.studyContext'
          : 'codebook.scopedBrowser',
        learnerChange === 'pane movement' ? 2 : 1,
      )
      const reveals = harness.panelReveals(),
        commands = [...harness.commands]
      held.release()
      await rejected
      // Assert
      assert.equal(
        harness.panelColumn('codebook.studyContext'),
        learnerChange === 'pane movement' ? 2 : 3,
      )
      assert.equal(harness.reader.presentationState().mode, 'study-workspace')
      assert.equal(harness.presentationPreferences.size, 0)
      assert.deepEqual(harness.panelReveals(), reveals)
      assert.deepEqual(harness.commands, commands)
    } finally {
      release()
      await harness.close()
    }
  })

test('a foreign preview opened during the layout read survives without relocation or a saved presentation', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await harness.reader.open()
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release
    const state = harness.reader.presentationState()
    const transfer = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    const rejected = assert.rejects(transfer, {
      code: 'PRESENTATION_UNAVAILABLE',
      message:
        'The preview tab "learner-preview.txt" was opened while the Codebook panes were being arranged and was left as it is. Change the presentation again.',
    })
    await held.started
    // Act: preserve global Context focus while a learner preview opens in the later destination.
    const preview = harness.addTextPreview(
      join(harness.directory, 'learner-preview.txt'),
      1,
    )
    harness.groups.find((group) => group.viewColumn === 1)!.activeTab = preview
    const reveals = harness.panelReveals(),
      commands = [...harness.commands]
    held.release()
    await rejected
    // Assert
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 1)!.activeTab,
      preview,
    )
    assert.equal(preview.isPreview, true)
    assert.deepEqual(harness.panelReveals(), reveals)
    assert.deepEqual(harness.commands, commands)
    assert.equal(harness.presentationPreferences.size, 0)
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    assert.equal(
      harness.reader.presentationState().reason,
      'Error: The preview tab "learner-preview.txt" was opened while the Codebook panes were being arranged and was left as it is. Change the presentation again.',
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=a presentation change while the learner has a file open as a preview (a single click in the Explorer), with that file kept; fails_when=any preview tab Codebook did not open refuses the selection, so an agent's first select fails until the learner keeps or closes the tab; why_new=Cycle 0044 0036-N02 (the existing preview tests cover only an edited preview and one opened during the move); seam=workspace harness with the fake editor
test('a presentation selection keeps the learner’s unedited file preview by pinning it in place and is confirmed', async () => {
  // Arrange: the learner single-clicked a workspace file, which the editor shows as a preview tab in the second column.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const path = join(harness.directory, 'login-form.tsx')
    await writeFile(path, 'export const form = 1\n')
    const preview = harness.addTextPreview(path, 2)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    // Assert
    assert.equal(selected.mode, 'living-book')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(
      harness.groups.filter((group) => group.tabs.includes(preview)).length,
      1,
    )
    assert.equal(preview.isPreview, false)
    assert.equal(preview.isDirty, false)
    assert.equal(await readFile(path, 'utf8'), 'export const form = 1\n')
  } finally {
    await harness.close()
  }
})

// Value: protects=a preview tab the editor API cannot pin (the Welcome page) staying untouched, and the learner or agent being told which tab it is and what to do; fails_when=the refusal reaches the agent as the generic "The presentation was not confirmed" or without the tab's name, or the selection moves panes over that tab; why_new=Cycle 0044 0036-N02 (the refusal named neither the tab nor a remedy; since the merge with 0041-N10-5 it is the shared foreign-preview text); seam=workspace harness with the fake editor
test('a presentation selection refused for a preview tab that cannot be pinned names that tab and the step that keeps it', async () => {
  // Arrange: the editor's Welcome page is an unpinned preview tab beside the Application pane.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const welcome = harness.addOpaqueTab('Welcome', 1)
    welcome.isPreview = true
    const state = harness.reader.presentationState(),
      commands = [...harness.commands],
      reveals = harness.panelReveals()
    // Act / Assert
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
          'A destination group contains a foreign preview: "Welcome" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
      },
    )
    assert.equal(welcome.isPreview, true)
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 1)!.tabs[0],
      welcome,
    )
    assert.deepEqual(harness.commands, commands)
    assert.deepEqual(harness.panelReveals(), reveals)
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    assert.equal(harness.presentationPreferences.size, 0)
  } finally {
    await harness.close()
  }
})

for (const reader of ['closed', 'open'] as const)
  // Value: protects=the first presentation selection answering a confirmed layout while the learner's own file is the focused tab of the source column; fails_when=the focus given back after the placement fronts the learner's file over the captured source, so the answer reads layoutConfirmed false ("The current captured source is not ready in its native pane") until a second call; why_new=Cycle 0044 0037-I3 (the existing selection tests keep the learner's draft in another column); seam=workspace harness with the fake editor
  test(`the first presentation selection on ${reader === 'closed' ? 'a closed' : 'an open'} reader is confirmed when the learner’s focused file is in the source column, and that file stays open behind the captured source`, async () => {
    // Arrange: the learner is typing in a file of the second column, where Study workspace shows the captured source.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    try {
      if (reader === 'open') await harness.reader.open()
      else await harness.reader.attach(harness.service)
      const draft = harness.focusMutableDraft('login-form.tsx', 2)
      const state = harness.reader.presentationState()
      // Act
      const selected = await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      // Assert
      const sourceGroup = harness.groups.find(
        (group) => group.viewColumn === 2,
      )!
      assert.equal(selected.state, 'open')
      assert.equal(selected.layoutConfirmed, true)
      assert.equal(selected.reason, undefined)
      assert.equal(selected.panes.appColumn, 1)
      assert.equal(selected.panes.sourceColumn, 2)
      assert.equal(selected.panes.contextColumn, 3)
      assert.match(
        String(Reflect.get(sourceGroup.activeTab!.input, 'uri')),
        /^codebook-source:\/\//,
      )
      assert.equal(sourceGroup.tabs.includes(draft.tab), true)
      assert.equal(draft.tab.isDirty, true)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      // The keyboard focus stays in the learner's group, on the captured source, not on a Codebook pane.
      assert.equal(harness.focusedPanel(), undefined)
    } finally {
      await harness.close()
    }
  })

test('restoring layout during a late replay image retains the current frame and lets the requested seek finish', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
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
    await harness.reader.understand(true)
    const source = harness.reader.inspect().sourceUri,
      library = await harness.reader.learningStorage(),
      decisions = (await library.readProgress()).decisions
    const retained = harness.controller.bundle(),
      pendingImage = harness.holdNextImage()
    release = pendingImage.release
    harness.controller.command({
      action: 'seek',
      studyId: harness.studyId,
      expectedRevision: harness.controller.state().revision,
      positionMs: 150,
    })
    await pendingImage.started
    await harness.reader.action('focus-app')
    const state = harness.reader.presentationState()
    // Act
    const transfer = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })
    await transfer
    assert.equal(harness.controller.bundle(), retained)
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(harness.controller.state().readiness, 'loading')
    release()
    await harness.controller.settle()
    // Assert
    assert.equal(harness.controller.state().mode, 'paused')
    assert.equal(harness.controller.state().presentedMs, 150)
    assert.equal(harness.controller.state().requestedMs, 150)
    assert.equal(harness.controller.bundle()?.projection.positionMs, 150)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.reader.inspect().sourceUri, source)
    assert.equal(harness.reader.inspect().view?.contentTab, 'recording')
    assert.equal(harness.displayedImage(), harness.png.toString('base64'))
    assert.deepEqual((await library.readProgress()).decisions, decisions)
    assert.equal(harness.runtimes.length, 1)
    assert.equal(harness.runtimes[0]!.dispatches, 1)
    assert.equal((await harness.store.readPreference())?.positionMs, 150)
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    const next = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: next.presentationId,
      expectedRevision: next.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })
    assert.equal(harness.controller.state().presentedMs, 150)
    assert.equal(harness.controller.state().mode, 'paused')
    assert.equal(harness.reader.inspect().sourceUri, source)
  } finally {
    release()
    await harness.close()
  }
})

test('presentation source acquisition restores every original selection after the owned native response', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    await harness.reader.action('source')
    const source = harness.focusedSource()
    assert.ok(source)
    const position = source.selections[0]!.active
    source.selections = [
      { anchor: position.with(5, 1), active: position.with(9, 3) },
      { anchor: position.with(18, 6), active: position.with(17, 2) },
    ]
    let displayed: typeof source | undefined
    harness.changeAfterNextSourceDisplay((editor) => {
      displayed = editor
    })
    const state = harness.reader.presentationState()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    // Assert
    assert.deepEqual(
      displayed?.selections.map((selection) => [
        selection.anchor.line,
        selection.anchor.character,
        selection.active.line,
        selection.active.character,
      ]),
      [
        [5, 1, 9, 3],
        [18, 6, 17, 2],
      ],
    )
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
  } finally {
    await harness.close()
  }
})

for (const sourceClosed of [false, true])
  for (const interaction of ['selection', 'none'] as const)
    test(`presentation source acquisition ${sourceClosed ? 'with a closed source tab ' : ''}${interaction === 'none' ? 'continues after unchanged native display' : 'preserves a newer selection before the display response'}`, async () => {
      // Arrange: native Source is already visible when its display response is still pending.
      const harness = await workspaceHarness(false)
      harness.useNativeLayout({ orientation: 0, groups: [{}] })
      try {
        await harness.reader.open()
        await harness.reader.action('source')
        if (sourceClosed) {
          const group = harness.groups.find(
            (group) => group.viewColumn === harness.sourceColumn(),
          )
          assert.ok(group?.activeTab)
          group.tabs = group.tabs.filter((tab) => tab !== group.activeTab)
          group.activeTab = undefined
          await harness.reader.action('focus-context')
        }
        const state = harness.reader.presentationState()
        let revealed: ReturnType<typeof harness.focusedSource>,
          reveals: ReturnType<typeof harness.panelReveals> | undefined,
          commands: string[] | undefined
        harness.changeAfterNextSourceDisplay((editor) => {
          revealed = editor
          if (interaction === 'selection') {
            const active = harness.focusedSource()
            assert.ok(active)
            editor.selections = [
              {
                anchor: editor.selections[0]!.active.with(39, 6),
                active: editor.selections[0]!.active.with(39, 6),
              },
            ]
            active.selections = editor.selections
            harness.retainReadingRange(34, 46)
          }
          reveals = harness.panelReveals()
          commands = [...harness.commands]
        })
        // Act
        const transfer = harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'living-book',
          action: 'select',
        })
        if (interaction === 'none') await transfer
        else await assert.rejects(transfer, /not confirmed/)
        // Assert
        assert.ok(revealed)
        assert.equal(
          revealed.selections[0]!.active.line,
          interaction === 'selection' ? 39 : 0,
        )
        assert.equal(
          harness.reader.presentationState().layoutConfirmed,
          interaction === 'none',
        )
        assert.equal(
          harness.reader.presentationState().mode,
          interaction === 'none' ? 'living-book' : 'study-workspace',
        )
        if (interaction === 'selection') {
          assert.equal(
            harness.focusedSource()?.selections[0]!.active.character,
            6,
          )
          assert.equal(harness.isReadingLineVisible(40), true)
          assert.deepEqual(harness.panelReveals(), reveals)
          assert.deepEqual(harness.commands, commands)
          assert.equal(harness.presentationPreferences.size, 0)
        }
      } finally {
        await harness.close()
      }
    })

for (const interaction of ['selection', 'none'] as const)
  test(`presentation post-move layout response ${interaction === 'none' ? 'completes the unchanged reading pose' : 'preserves a newer source selection and viewport before further effects'}`, async () => {
    // Arrange: arm the next layout read only after the native source display, so the first scope read is not held.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let held: ReturnType<typeof harness.holdNextCommand> | undefined,
      displayed!: () => void
    const sourceDisplayed = new Promise<void>((resolve) => {
      displayed = resolve
    })
    let transfer: Promise<unknown> | undefined
    try {
      await harness.reader.open()
      harness.retainReadingRange(0, 12)
      harness.changeAfterNextSourceDisplay(() => {
        held = harness.holdNextCommand('vscode.getEditorLayout')
        displayed()
      })
      const state = harness.reader.presentationState()
      transfer = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'guided-walkthrough',
        action: 'select',
      })
      const outcome =
        interaction === 'none'
          ? transfer
          : assert.rejects(transfer, /not confirmed/)
      await sourceDisplayed
      assert.ok(held)
      await held.started
      assert.ok(harness.focusedSource())
      // Act
      if (interaction === 'selection') {
        harness.changeFocusedSourceSelection(46)
        harness.retainReadingRange(40, 52)
      }
      const commands = [...harness.commands],
        reveals = harness.panelReveals()
      held.release()
      await outcome
      // Assert
      assert.equal(
        harness.reader.presentationState().layoutConfirmed,
        interaction === 'none',
      )
      if (interaction === 'selection') {
        assert.deepEqual(harness.commands, commands)
        assert.deepEqual(harness.panelReveals(), reveals)
        assert.equal(harness.focusedSource()?.selections[0]?.active.line, 46)
        assert.equal(harness.isReadingLineVisible(46), true)
        assert.equal(harness.presentationPreferences.size, 0)
        assert.equal(harness.reader.presentationState().mode, 'study-workspace')
      } else
        assert.equal(
          harness.reader.presentationState().mode,
          'guided-walkthrough',
        )
    } finally {
      held?.release()
      await transfer?.catch(() => undefined)
      await harness.close()
    }
  })

for (const interruption of [
  'original source',
  'departure and reentry',
  'same-group tab roundtrip',
  'none',
] as const)
  test(`native activation preparation ${interruption === 'none' ? 'completes while ownership remains held' : `preserves learner ${interruption} without a late focus commit`}`, async (context) => {
    // Arrange: hold the actual final Context preparation after it has selected the native editor.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let release = (): void => {},
      transfer: Promise<unknown> | undefined
    try {
      await harness.reader.open()
      await harness.reader.action('focus-context')
      const initial = harness.reader.presentationState()
      await harness.reader.changePresentation({
        presentationId: initial.presentationId,
        expectedRevision: initial.presentationControlRevision,
        mode: 'guided-walkthrough',
        action: 'select',
      })
      let panel = harness
        .nativePanels()
        .find((current) => current.kind === 'codebook.studyContext')
      assert.ok(panel)
      const sameGroupDraft =
        interruption === 'same-group tab roundtrip'
          ? harness.addForeignDraft(panel.viewColumn)
          : undefined
      const listenerCount = harness.focusListenerCount()
      let originalSource: ReturnType<typeof harness.focusedSource>,
        interrupted = false,
        lateCommits = 0
      let entered = (_source: NonNullable<typeof originalSource>): void => {}
      const prepared = new Promise<NonNullable<typeof originalSource>>(
        (resolve) => {
          entered = resolve
        },
      )
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      // Final native activation belongs to the adopted document, including same-column changes.
      harness.onNextPanel('codebook.studyContext', (replacement) => {
        panel = replacement
        const reveal = replacement.reveal.bind(replacement),
          post = replacement.webview.postMessage.bind(replacement.webview)
        context.mock.method(
          replacement,
          'reveal',
          (...arguments_: Parameters<typeof replacement.reveal>) => {
            if (!interrupted) originalSource = harness.focusedSource()
            return reveal(...arguments_)
          },
        )
        context.mock.method(
          replacement.webview,
          'postMessage',
          async (message: Parameters<typeof post>[0]) => {
            if (
              message.type === 'codebook-focus' &&
              message.phase === 'prepare' &&
              originalSource &&
              !interrupted
            ) {
              interrupted = true
              entered(originalSource)
              await held
            } else if (
              message.type === 'codebook-focus' &&
              message.phase === 'commit' &&
              interrupted
            )
              lateCommits++
            return post(message)
          },
        )
      })
      const state = harness.reader.presentationState()
      transfer = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      const outcome =
        interruption === 'none'
          ? transfer
          : assert.rejects(transfer, /not confirmed/)
      const source = await prepared
      assert.equal(harness.focusedPanel(), 'codebook.studyContext')
      // Act: source return may exactly match the start snapshot, but it is a newer learner choice.
      if (interruption !== 'none') {
        if (sameGroupDraft)
          harness.roundtripExistingPanelTab(
            'codebook.studyContext',
            sameGroupDraft,
          )
        else harness.focusExistingSource(source)
        source.selections = [
          {
            anchor: source.selections[0]!.active.with(31, 4),
            active: source.selections[0]!.active.with(31, 4),
          },
        ]
        if (interruption === 'departure and reentry')
          panel?.reveal(undefined, false)
      }
      const reveals = harness.panelReveals(),
        commands = [...harness.commands]
      release()
      await outcome
      // Assert
      assert.equal(harness.focusListenerCount(), listenerCount)
      if (interruption === 'none') {
        assert.equal(harness.reader.presentationState().mode, 'study-workspace')
        assert.equal(harness.reader.presentationState().layoutConfirmed, true)
        assert.equal(lateCommits, 1)
      } else {
        assert.equal(lateCommits, 0)
        assert.deepEqual(harness.panelReveals(), reveals)
        assert.deepEqual(harness.commands, commands)
        assert.equal(source.selections[0]!.active.line, 31)
        assert.equal(source.selections[0]!.active.character, 4)
        assert.equal(
          harness.reader.presentationState().mode,
          'guided-walkthrough',
        )
        assert.equal(harness.reader.presentationState().layoutConfirmed, false)
        assert.deepEqual(
          harness.presentationPreferences.get('codebook.presentation.v1'),
          { version: 1, mode: 'guided-walkthrough' },
        )
        if (interruption === 'original source')
          assert.equal(harness.focusedSource(), source)
        else assert.equal(harness.focusedPanel(), 'codebook.studyContext')
      }
    } finally {
      release()
      await transfer?.catch(() => undefined)
      context.mock.restoreAll()
      await harness.close()
    }
  })

test('mode selection rejects missing inner focus instead of treating native tab activation as success', async () => {
  // Arrange: H's native tab acknowledgment can succeed while the inner document never receives focus.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    harness.movePanel('codebook.studyContext', 3)
    harness.suppressNativeInnerFocus()
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
        causeDetail:
          'Error: Codebook asked the Explanation pane to take the keyboard, and the pane did not confirm it within 5 seconds. The action was stopped there and nothing else was changed. Click into the Explanation pane and repeat the action.',
      },
    )
    // Assert: native selection alone cannot certify document focus or commit a preference.
    assert.equal(harness.innerFocusedPanel(), undefined)
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    assert.equal(harness.presentationPreferences.size, 0)
  } finally {
    await harness.close()
  }
})

test('leaving the native work window during presentation preserves the prior preference without recovering focus', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await harness.reader.open()
    const held = harness.holdPresentationMessage()
    release = held.release
    const state = harness.reader.presentationState()
    const transfer = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    const rejected = assert.rejects(transfer, /lost focus/)
    await held.started
    const reveals = harness.panelReveals()
    // Act
    harness.changeWindowFocus(false)
    held.release()
    await rejected
    // Assert
    assert.deepEqual(harness.panelReveals(), reveals)
    assert.equal(harness.presentationPreferences.size, 0)
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    assert.equal(harness.windowFocusListeners(), 0)
  } finally {
    release()
    await harness.close()
  }
})

test('a background work window refuses a mode change before native effects', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    harness.changeWindowFocus(false)
    const state = harness.reader.presentationState(),
      reveals = harness.panelReveals()
    // Act / Assert
    assert.throws(
      () =>
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'living-book',
          action: 'select',
        }),
      /Focus this Codebook work window/,
    )
    assert.deepEqual(harness.panelReveals(), reveals)
    assert.equal(harness.presentationPreferences.size, 0)
  } finally {
    await harness.close()
  }
})

test('presentation cannot save its mode from a stale reading restoration receipt', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let releaseRestore: (() => void) | undefined
  try {
    await harness.reader.open()
    const state = harness.reader.presentationState()
    let observed!: () => void
    const requested = new Promise<void>((resolve) => {
      observed = resolve
    })
    harness.onNextPanel('codebook.studyContext', (panel) => {
      const originalPost = panel.webview.postMessage.bind(panel.webview)
      panel.webview.postMessage = (message) => {
        if (message.type !== 'restore-presentation-pose')
          return originalPost(message)
        releaseRestore = (): void => {
          void originalPost(message)
        }
        observed()
        return Promise.resolve(true)
      }
    })
    const changing = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'guided-walkthrough',
      action: 'select',
    })
    await requested
    // Act
    harness.receive({
      type: 'presentation-pose-restored',
      captureId: '33333333-3333-4333-8333-333333333333',
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    // Assert
    assert.equal(harness.presentationPreferences.size, 0)
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    releaseRestore?.()
    await changing
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
  } finally {
    releaseRestore?.()
    await harness.close()
  }
})

const capturedSourceTabs = (
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
): number =>
  harness.groups
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        'uri' in tab.input &&
        String(tab.input.uri).startsWith('codebook-source://'),
    ).length

// Value: protects=a captured-source tab the learner pinned to keep an earlier run's source in view; fails_when=the one-tab-per-file rule closes every captured tab of the file without reading isPinned, so the pinned tab disappears when the same article runs again; why_new=Cycle 0045 CX-S1 (the filter compared only the URI); seam=the harness tab is pinned as the editor's Pin command marks it
test('a captured-source tab the learner pinned stays open when another run of the same file is shown', async () => {
  // Arrange: a first run stopped in src/theme.ts, and the learner pinned its captured-source tab.
  const harness = await configuredWorkspaceHarness()
  try {
    await harness.start()
    await harness.reader.action('click')
    await harness.reader.action('stop')
    const pinnedTab = harness.groups
      .flatMap((group) => group.tabs)
      .find(
        (tab) =>
          'uri' in tab.input &&
          tab.input.uri.path.endsWith('/Captured-theme.ts'),
      )
    assert.ok(pinnedTab)
    pinnedTab.isPinned = true

    // Act: a second run stops in the same file.
    await harness.start()
    await harness.reader.action('click')

    // Assert: the pinned capture stays beside the second run's own.
    const capturedThemeTabs = harness.groups
      .flatMap((group) => group.tabs)
      .filter(
        (tab) =>
          'uri' in tab.input &&
          tab.input.uri.path.endsWith('/Captured-theme.ts'),
      )
    assert.equal(capturedThemeTabs.includes(pinnedTab), true)
    assert.deepEqual(
      capturedThemeTabs.map((tab) => Boolean(tab.isPinned)),
      [true, false],
    )
  } finally {
    await harness.close()
  }
})

test('selecting a presentation on a closed reader closes a leftover captured-source tab that has no text editor and keeps the learner’s own tab', async () => {
  // Arrange: after a host restart the active tab is a captured source of this workspace, beside a learner draft and another workspace's captured source.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const foreign = harness.restoreLeftoverCapturedSource({
      active: false,
      authority: 'f'.repeat(64),
    })
    const draft = harness.focusMutableDraft()
    const leftover = harness.restoreLeftoverCapturedSource()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(leftover), false)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(tabs.includes(foreign), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    await harness.close()
  }
})

test('the leftover captured-source tab is closed on a reader that has not loaded its library yet', async () => {
  // Arrange: nothing has attached or opened this reader, so its workspace key is not known when the selection arrives.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const draft = harness.focusMutableDraft()
    const leftover = harness.restoreLeftoverCapturedSource()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(leftover), false)
    assert.equal(tabs.includes(draft.tab), true)
  } finally {
    await harness.close()
  }
})

test('a second presentation control sent while the leftover captured-source tabs are closing is refused', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    harness.focusMutableDraft()
    harness.restoreLeftoverCapturedSource()
    const state = harness.reader.presentationState(),
      request = {
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select' as const,
      }
    // Act
    const first = harness.reader.changePresentation(request)
    // Assert
    assert.throws(() => harness.reader.changePresentation(request), {
      code: 'PRESENTATION_UNAVAILABLE',
      message:
        'A presentation change or reader close is pending. Read its state before another control.',
    })
    assert.equal((await first).layoutConfirmed, true)
    assert.equal(harness.reader.presentationState().state, 'open')
  } finally {
    await harness.close()
  }
})

test('a selection still succeeds when the editor reports the next text editor a moment after the leftover tab closed', async () => {
  // Arrange: the tab model names the learner draft at once, the active text editor follows 60 ms later.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const draft = harness.focusMutableDraft()
    const leftover = harness.restoreLeftoverCapturedSource({
      lateTextEditor: true,
    })
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(leftover), false)
    assert.equal(tabs.includes(draft.tab), true)
    // The draft the editor activated in the leftover tab's place shares the Application pane's group: the pane is in front and has the keyboard focus that draft had, and the draft is still open behind it (Cycle 0045 NF-1 as DR-5; the draft was fronted and focused again before).
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(
      harness.groups.find((group) => group.tabs.includes(draft.tab))
        ?.activeTab === draft.tab,
      false,
    )
    assert.equal(
      harness.groups.find((group) => group.tabs.includes(draft.tab))
        ?.viewColumn,
      1,
    )
    assert.equal(selected.panes.appColumn, 1)
  } finally {
    await harness.close()
  }
})

test('a leftover captured-source tab the editor refuses to close leaves every tab in place and reports why the selection could not start', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const draft = harness.focusMutableDraft()
    const leftover = harness.restoreLeftoverCapturedSource({
      refuseClose: true,
    })
    const state = harness.reader.presentationState(),
      tabsBefore = harness.groups.flatMap((group) => group.tabs)
    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'The presentation was not changed: the focused tab "Captured-login-form.tsx" in editor group 1 has no text editor, so the focus could not be given back to it. Close that tab or click into another editor, then try again.',
        causeDetail: 'A leftover captured source tab could not be closed.',
      },
    )
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(tabs.length, tabsBefore.length)
    assert.equal(tabs.includes(leftover), true)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.counts().panels, 0)
  } finally {
    harness.acceptLeftoverClose()
    await harness.close()
  }
})

test('a closed reader opens when closing its focused leftover captured-source tab leaves a non-text page of the editor active', async () => {
  // Arrange: after a host restart the group holds the editor's own Settings page and, with focus, a captured source of this workspace.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const settingsPage = harness.useOpaquePrimary('settings')
    const leftover = harness.restoreLeftoverCapturedSource()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(leftover), false)
    assert.equal(
      tabs.some((tab) => tab === settingsPage),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection on a closed reader being admitted while a page of the editor that is no text editor has the focus in the Application's group, with that page left open behind the pane; fails_when=the admission refuses a focused non-text page again, or the page is closed or moved to make room for the pane; why_new=Cycle 0045 cause 7 (this test asserted the refusal "Focus a Codebook pane or text editor before selecting a presentation; the current foreign editor cannot be restored safely." until then); seam=useOpaquePrimary, restoreLeftoverCapturedSource
test('a closed reader behind a focused non-text page of the editor opens, closes the leftover captured-source tab and keeps that page open behind the Application pane', async () => {
  // Arrange: the active tab is the editor's Settings page; a leftover captured source sits inactive in the same group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const settingsPage = harness.useOpaquePrimary('settings')
    const leftover = harness.restoreLeftoverCapturedSource({ active: false })
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const applicationGroup = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(
      harness.groups.flatMap((group) => group.tabs).includes(leftover),
      false,
    )
    assert.equal(applicationGroup.tabs[0], settingsPage)
    assert.equal(
      Reflect.get(applicationGroup.activeTab!.input, 'viewType'),
      'codebook.scopedBrowser',
    )
    // The keyboard focus stays on the placed captured source; the page is not fronted again.
    assert.equal(harness.editor.window.tabGroups.activeTabGroup.viewColumn, 2)
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection on an open reader never closes the captured source it is showing; fails_when=the closed-reader condition is dropped from the leftover-tab list, so an open reader's own captured-source tabs are closed as leftovers; why_new=Cycle 0044 0036-C07a: the earlier test left the learner's focus on a text editor, so the leftover-tab step never ran and the condition was never reached; seam=restoreLeftoverCapturedSource
test('selecting a presentation on an open reader whose focused captured-source tab has no text editor closes none of its captured-source tabs', async () => {
  // Arrange: the reader is open and shows its captured source; the tab that has focus is a captured source of this workspace without a text editor.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const focusedCapturedSource = harness.restoreLeftoverCapturedSource()
    const capturedBefore = capturedSourceTabs(harness),
      closeRequestsBefore = harness.tabCloseRequests().length,
      state = harness.reader.presentationState()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    assert.equal(capturedBefore, 2)
    assert.equal(capturedSourceTabs(harness), 2)
    assert.equal(harness.tabCloseRequests().length, closeRequestsBefore)
    assert.equal(
      harness.groups
        .flatMap((group) => group.tabs)
        .includes(focusedCapturedSource),
      true,
    )
  } finally {
    await harness.close()
  }
})

/** Counts the tabs of one Codebook pane kind, in the registered or the main-thread form, for the dead-pane tests. @example codebookPaneTabs(harness, 'codebook.scopedBrowser') // 1 */
const codebookPaneTabs = (
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  kind: 'codebook.scopedBrowser' | 'codebook.studyContext',
): number =>
  harness.groups
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        'viewType' in tab.input &&
        [kind, `mainThreadWebview-${kind}`].includes(tab.input.viewType),
    ).length

// Value: protects=the reader recognizes exactly the old host's pane as dead and asks the editor to close that tab alone; fails_when=the dead-pane reader answers none, or takes the learner's tabs or this host's live Wiki pane for dead; why_new=Cycle 0044 0037-D8: the earlier test of this name asserted the fake editor only and never called the reader; seam=leaveDeadCodebookPane
test('the first presentation selection after an extension-host restart asks the editor to close the old host’s dead Study pane and no other tab', async () => {
  // Arrange: the old host's Study pane is the only tab of column 3; the learner's draft has focus in column 1 and this host's Repository Wiki pane is open in column 2.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    harness.focusMutableDraft('mutable-notes.txt', 1)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    assert.equal(selected.layoutConfirmed, true)
    assert.deepEqual(harness.tabCloseRequests()[0], [deadStudy])
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
  } finally {
    await harness.close()
  }
})

test('the first presentation selection after an extension-host restart closes the old host’s dead Application and Study panes and is confirmed', async () => {
  // Arrange: the old host's Application pane is still the visible tab of column 1, its Study pane sits in column 3 behind the learner draft that has focus, and the new Application panel registers a moment after it is created.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const articleSource = harness.groups[0]!.tabs[0]!,
      wiki = harness.groups[1]!.tabs[0]!
    const deadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
      ),
      deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const draft = harness.focusMutableDraft('mutable-notes.txt', 3)
    harness.delayPanelRegistration('codebook.scopedBrowser', true)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
    // The learner's draft, a second workspace file and another extension's webview are untouched.
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(tabs.includes(articleSource), true)
    assert.equal(tabs.includes(wiki), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    await harness.close()
  }
})

test('the first presentation selection is confirmed when the old host’s dead Study pane had focus and no text editor was active', async () => {
  // Arrange: focus sits on the dead Study pane, the only tab of column 3; the learner draft of column 1 is open behind the dead Application pane.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const articleSource = harness.groups[0]!.tabs[0]!,
      wiki = harness.groups[1]!.tabs[0]!
    const draft = harness.focusMutableDraft('mutable-notes.txt', 1)
    const deadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
      ),
      deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3, {
        focused: true,
      })
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(tabs.includes(articleSource), true)
    assert.equal(tabs.includes(wiki), true)
  } finally {
    await harness.close()
  }
})

test('the first presentation selection closes a dead Application pane together with the focused leftover captured-source tab', async () => {
  // Arrange: the state the installed trial met: the old host's Application pane as the visible tab of column 1 and, with focus in column 2, a captured source of this workspace; the new Application panel registers a moment after it is created.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    const articleSource = harness.groups[0]!.tabs[0]!,
      wiki = harness.groups[1]!.tabs[0]!
    const deadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
      ),
      leftover = harness.restoreLeftoverCapturedSource({ column: 2 })
    harness.delayPanelRegistration('codebook.scopedBrowser', true)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(leftover), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(tabs.includes(articleSource), true)
    assert.equal(tabs.includes(wiki), true)
  } finally {
    await harness.close()
  }
})

test('a presentation selection on a closed reader that already owns a live Application panel closes no Codebook pane', async () => {
  // Arrange: a run created the Application panel before the reader was opened.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const draft = harness.focusMutableDraft()
  const viewport = await harness.reader.presentation.createViewport(
    'run-before-reader',
    () => {},
    () => {},
    'normal',
  )
  try {
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(
      harness
        .tabCloseRequests()
        .flat()
        .some((tab) => 'viewType' in tab.input),
      false,
    )
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(tabs.includes(draft.tab), true)
  } finally {
    viewport.close()
    await harness.close()
  }
})

// Value: protects=a dead pane the editor keeps ends the selection with the instruction to close it, whatever the editor closed in other groups; fails_when=the kept pane is read from the editor's one answer instead of from the tab model, or a panel is created beside the kept pane; why_new=Cycle 0044 0037-F4, 0037-D8: the fake editor closed all requested tabs or none, while the editor closes group by group; seam=leaveDeadCodebookPane refuseClose
test('a dead Codebook pane the editor refuses to close stays in its group while the dead pane of another group closes, and the selection tells why it could not start', async () => {
  // Arrange: the editor keeps the dead Application pane of column 1 and lets the dead Study pane of column 3 close.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const draft = harness.focusMutableDraft('mutable-notes.txt', 2)
    const deadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
        { refuseClose: true },
      ),
      deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const state = harness.reader.presentationState(),
      tabsBefore = harness.groups.flatMap((group) => group.tabs)
    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.',
        causeDetail: 'A leftover Codebook pane could not be closed.',
      },
    )
    // Assert: only the dead pane the editor released is gone.
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.deepEqual(
      tabs,
      tabsBefore.filter((tab) => tab !== deadStudy),
    )
    assert.equal(tabs.includes(deadApplication), true)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.counts().panels, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection refused over a dead Codebook pane is confirmed when repeated once the editor lets the pane close; fails_when=the refusal leaves its pending transition or its kept-pane verdict behind, so the repeated selection is refused again; why_new=the refusal test stops at the refusal and never sends the selection again; seam=none
test('a presentation selection refused over a dead Codebook pane is confirmed when it is repeated once the editor lets the pane close', async () => {
  // Arrange: the editor refused to close the old host's panes, so the first selection ended with the instruction to close them and select again.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const deadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
        { refuseClose: true },
      ),
      deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const draft = harness.focusMutableDraft('mutable-notes.txt', 3)
    const refusedState = harness.reader.presentationState()
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: refusedState.presentationId,
        expectedRevision: refusedState.presentationControlRevision,
        mode: refusedState.mode,
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        causeDetail: 'A leftover Codebook pane could not be closed.',
      },
    )
    harness.acceptDeadPaneClose()
    // Act: the agent reads the presentation state again and repeats the selection.
    const state = harness.reader.presentationState()
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection behind a foreign non-text editor stays refused and opens no pane when an earlier extension session left a dead Codebook pane elsewhere; fails_when=closing a dead pane is reported as closing the focused tab, so the focus guard is skipped and the reader opens over the foreign editor; why_new=the foreign-editor refusal test has no dead pane, so its refusal is thrown before the close step ever runs; seam=none
test('a closed reader behind a focused non-text page of the editor opens when an earlier extension session left a dead Study pane in another group, and that page stays open', async () => {
  // Arrange: the editor's Settings page has focus in column 1; the old host's Study pane is the only tab of column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const settingsPage = harness.useOpaquePrimary('settings')
    const deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(harness.counts().panels, 2)
    // The learner's Settings page is still a tab of its group, behind the Application pane.
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 1)?.tabs[0],
      settingsPage,
    )
  } finally {
    await harness.close()
  }
})

/** Tells whether a request answered before one second passed, so a test can show that the five-second editor-agreement wait did not run. @example await answeredWithinOneSecond(request) // true */
const answeredWithinOneSecond = async (
  request: Promise<unknown>,
): Promise<boolean> => {
  const deadline = new AbortController()
  try {
    return await Promise.race([
      request.then(
        () => true,
        () => true,
      ),
      delay(1_000, false, { signal: deadline.signal }),
    ])
  } finally {
    deadline.abort()
  }
}

/** Waits until the editor has removed a tab, so a test can act between the close and the admission that follows it. @example await tabClosed(harness, leftover) */
const tabClosed = async (
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
  tab: ReturnType<typeof harness.restoreLeftoverCapturedSource>,
): Promise<void> => {
  while (harness.groups.flatMap((group) => group.tabs).includes(tab))
    await new Promise<void>((resolve) => setImmediate(resolve))
}

const TAB_WITHOUT_EDITOR_REFUSAL =
  'The presentation was not changed: the focused tab "Captured-login-form.tsx" in editor group 1 has no text editor, so the focus could not be given back to it. Close that tab or click into another editor, then try again.'

// Value: protects=a selection that has no leftover tab to close is answered at once; fails_when=the editor-agreement wait runs although no tab closed, so the refusal arrives after five seconds; why_new=Cycle 0044 0036-C06a: no test had another workspace's captured-source tab as the focused tab; seam=restoreLeftoverCapturedSource authority
test('a selection behind another workspace’s captured-source tab is refused without the five-second editor wait', async () => {
  // Arrange: the focused tab is a captured source of another workspace, restored without a text editor; this workspace left no tab.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    harness.restoreLeftoverCapturedSource({ authority: 'f'.repeat(64) })
    const state = harness.reader.presentationState()
    // Act
    const request = Promise.resolve().then(() =>
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select',
      }),
    )
    const answered = await answeredWithinOneSecond(request)
    // Assert
    assert.equal(answered, true)
    await assert.rejects(request, {
      code: 'PRESENTATION_UNAVAILABLE',
      message: TAB_WITHOUT_EDITOR_REFUSAL,
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=a refused selection leaves this workspace's leftover tabs where they are; fails_when=the leftover tabs are closed before the refusal for a focus that cannot be kept; why_new=Cycle 0044 0036-C06b: no test combined a foreign workspace's focused captured source with an own leftover tab; seam=restoreLeftoverCapturedSource authority
test('a selection refused behind another workspace’s captured-source tab closes none of this workspace’s leftover tabs', async () => {
  // Arrange: this workspace's leftover captured source sits inactive beside the focused captured source of another workspace.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const leftover = harness.restoreLeftoverCapturedSource({ active: false })
    harness.restoreLeftoverCapturedSource({ authority: 'f'.repeat(64) })
    const state = harness.reader.presentationState(),
      tabsBefore = harness.groups.flatMap((group) => group.tabs)
    // Act
    await assert.rejects(
      async () =>
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: state.mode,
          action: 'select',
        }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message: TAB_WITHOUT_EDITOR_REFUSAL,
      },
    )
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.deepEqual(tabs, tabsBefore)
    assert.equal(tabs.includes(leftover), true)
    assert.deepEqual(harness.tabCloseRequests(), [])
    assert.equal(harness.reader.presentationState().state, 'closed')
  } finally {
    await harness.close()
  }
})

// Value: protects=the selection is admitted on the editor's settled state when a non-text page replaces the closed leftover tab; fails_when=the admission runs while the active text editor still reports the document of the tab that closed, and tries to give focus back to it; why_new=Cycle 0044 0036-C06c: the late-editor test ends on a text tab, where the wait already ran; seam=restoreLeftoverCapturedSource staleTextEditor
test('a selection is confirmed when the editor still reports the closed captured source as its text editor for a moment after its Settings page took the tab’s place', async () => {
  // Arrange: the group holds the editor's Settings page and, with focus, a leftover captured source; for 60 ms after the close the editor still reports that source as its active text editor.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const settingsPage = harness.useOpaquePrimary('settings')
    const leftover = harness.restoreLeftoverCapturedSource({
      staleTextEditor: true,
    })
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(tabs.includes(leftover), false)
    assert.equal(
      tabs.some((tab) => tab === settingsPage),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a captured source this host itself shows in a text editor is kept by a selection on a closed reader; fails_when=the leftover-tab step takes every captured-source tab of the workspace for a leftover, with or without a text editor; why_new=Cycle 0044 0036-C06d: every earlier leftover tab was one without a text editor; seam=restoreLeftoverCapturedSource textEditor
test('a selection on a closed reader does not close a focused captured-source tab that has a text editor', async () => {
  // Arrange: a first open that failed left this host's captured source open in a live text editor, and the reader closed.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const liveCapturedSource = harness.restoreLeftoverCapturedSource({
      textEditor: true,
    })
    const state = harness.reader.presentationState()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    assert.equal(
      harness.tabCloseRequests().flat().includes(liveCapturedSource),
      false,
    )
    assert.equal(
      harness.groups
        .flatMap((group) => group.tabs)
        .includes(liveCapturedSource),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a page that is no text editor staying open, behind the pane placed in its group, when it had the focus at a selection; fails_when=the selection is refused for that page, or the page is closed, moved or fronted again over the placed pane; why_new=Cycle 0045 cause 7 (until then this test moved the learner to such a page while leftover tabs closed and asserted the refusal "Focus a Codebook pane or text editor before selecting a presentation; the current foreign editor cannot be restored safely."); seam=focusOpaqueTab
test('a presentation selection made while a tab that is not a text editor has the focus in a group the Study panes use keeps that tab open behind the placed pane', async () => {
  // Arrange: an extension's page has the focus in column 2, where Study workspace shows the captured source; the learner's draft is in column 1.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    await harness.reader.attach(harness.service)
    const draft = harness.focusMutableDraft('mutable-notes.txt', 1)
    const extensionPage = harness.addOpaqueTab('Extension page', 2)
    harness.focusOpaqueTab(extensionPage)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const sourceGroup = harness.groups.find((group) => group.viewColumn === 2)!
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(sourceGroup.tabs[0], extensionPage)
    assert.match(
      String(Reflect.get(sourceGroup.activeTab!.input, 'uri')),
      /^codebook-source:\/\//,
    )
    // The keyboard focus stays on the placed captured source, and the learner's draft is untouched.
    assert.equal(harness.editor.window.tabGroups.activeTabGroup, sourceGroup)
    assert.equal(draft.tab.isDirty, true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    await harness.close()
  }
})

// Value: protects=closing the reader ends a selection that is waiting for the editor after it closed a leftover tab; fails_when=the wait ignores the reader's cancellation and holds the selection for five seconds, or the selection goes on to open a pane on the closed reader; why_new=Cycle 0044 0036-C07d: no test closed the reader during the leftover-tab step; seam=restoreLeftoverCapturedSource authority
test('closing the reader while a selection waits for the editor after closing a leftover tab ends the selection at once and opens no pane', async () => {
  // Arrange: closing the focused leftover tab activates another workspace's captured source, for which the editor never reports a text editor, so the selection waits.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    harness.restoreLeftoverCapturedSource({
      active: false,
      authority: 'f'.repeat(64),
    })
    const leftover = harness.restoreLeftoverCapturedSource()
    const state = harness.reader.presentationState()
    const request = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    request.catch(() => undefined)
    await tabClosed(harness, leftover)
    // Act
    const closing = harness.reader.close()
    const answered = await answeredWithinOneSecond(request)
    await closing
    // Assert
    assert.equal(answered, true)
    await assert.rejects(request, {
      message:
        'The study workspace was closed; repeat the action explicitly if needed.',
    })
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.counts().panels, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=the dead panes of an earlier host are closed by the first selection although a run already created this host's Application panel; fails_when=the dead-pane reader answers none as soon as this host owns a panel, so the selection meets two Application tabs; why_new=Cycle 0044 0037-D3: the only test with a panel created first had no dead pane; seam=leaveDeadCodebookPane
test('the first presentation selection closes the old host’s dead panes when a run created this host’s Application panel before the reader was opened', async (context) => {
  // Arrange: the old host's panes are in columns 1 and 3; an agent run then creates this host's Application panel, and the learner's draft has focus in column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
    ),
    deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
  const draft = harness.focusMutableDraft('mutable-notes.txt', 3)
  const createPanel = harness.editor.window.createWebviewPanel
  context.mock.method(
    harness.editor.window,
    'createWebviewPanel',
    (...arguments_: Parameters<typeof createPanel>) => {
      // Native registration requires the earlier host's tabs gone before the new pane is created.
      if (arguments_[0] === 'codebook.scopedBrowser') {
        const tabs = harness.groups.flatMap((group) => group.tabs)
        assert.equal(tabs.includes(deadApplication), false)
        assert.equal(tabs.includes(deadStudy), false)
      }
      return createPanel(...arguments_)
    },
  )
  let viewport:
    | Awaited<ReturnType<typeof harness.reader.presentation.createViewport>>
    | undefined
  try {
    viewport = await harness.reader.presentation.createViewport(
      'run-before-reader',
      () => {},
      () => {},
      'normal',
    )
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
    assert.equal(tabs.includes(draft.tab), true)
  } finally {
    context.mock.restoreAll()
    viewport?.close()
    await harness.close()
  }
})

for (const laterChoice of ['new source', 'Close'] as const)
  test(`cold prepared Study preserves ${laterChoice} while its preference write drains`, async () => {
    // Arrange: native App preparation preserves three original groups, so cold selection confirms that actual four-group layout.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
    const viewport = await harness.reader.presentation.createViewport(
      'prepared-preference',
      () => {},
      () => {},
      'normal',
    )
    const held = harness.holdPresentationPreference(),
      state = harness.reader.presentationState()
    let outcome: Promise<void> | undefined, closing: Promise<void> | undefined
    try {
      const selection = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select',
      })
      outcome = assert.rejects(selection, /closed|changed|not confirmed/i)
      await held.started
      const commandsBefore = harness.commands.length

      // Act: the accepted preference write must drain, but cannot certify the old UI after newer input or Close.
      const draft =
        laterChoice === 'new source'
          ? harness.focusMutableDraft('later-choice.txt', 3)
          : undefined
      if (laterChoice === 'Close') closing = harness.reader.close()
      held.release()
      await outcome
      await closing

      // Assert
      if (draft) {
        assert.equal(
          harness.focusedSource()?.document.uri.toString(),
          draft.document.uri.toString(),
        )
        assert.equal(draft.document.getText(), 'Original learner draft.\n')
        assert.equal(draft.tab.isDirty, true)
        assert.equal(
          harness.commands
            .slice(commandsBefore)
            .includes('vscode.setEditorLayout'),
          false,
        )
      } else {
        assert.equal(harness.reader.inspect().opened, false)
        assert.equal(harness.counts().panels, 0)
      }
    } finally {
      held.release()
      await outcome?.catch(() => undefined)
      await closing
      viewport.close()
      await harness.close()
    }
  })

test('MCP-first acquisition preserves a refused stale pane without allocating another Application', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const dead = harness.leaveDeadCodebookPane('codebook.scopedBrowser', 1, {
      refuseClose: true,
    }),
    draft = harness.focusMutableDraft('retained-draft.txt', 2),
    commandsBefore = harness.commands.length
  try {
    // Act
    await assert.rejects(
      Promise.resolve(
        harness.reader.presentation.createViewport(
          'refused-stale-pane',
          () => {},
          () => {},
          'normal',
        ),
      ),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'Close the leftover Codebook panes, then retry the live explanation.',
      },
    )

    // Assert
    assert.equal(harness.counts().panels, 0)
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.newGroupAbove'),
      false,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(dead)),
      true,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft.tab)),
      true,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(draft.tab.isDirty, true)
  } finally {
    harness.acceptDeadPaneClose()
    await harness.close()
  }
})

test('Close during MCP-first stale-pane retirement prevents a later Application allocation', async (context) => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const dead = harness.leaveDeadCodebookPane('codebook.scopedBrowser', 1),
    draft = harness.focusMutableDraft('retained-draft.txt', 2),
    nativeClose = harness.editor.window.tabGroups.close,
    commandsBefore = harness.commands.length
  let release = (): void => {},
    closingOldPane = false,
    outcome: Promise<void> | undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  context.mock.method(
    harness.editor.window.tabGroups,
    'close',
    async (...arguments_: Parameters<typeof nativeClose>) => {
      const result = await nativeClose(...arguments_)
      // Hold only the first accepted native close response; Close's own later cleanup remains runnable.
      if (!closingOldPane) {
        closingOldPane = true
        await held
      }
      return result
    },
  )
  try {
    outcome = assert.rejects(
      Promise.resolve(
        harness.reader.presentation.createViewport(
          'closing-stale-pane',
          () => {},
          () => {},
          'normal',
        ),
      ),
      /closed/i,
    )
    await waitUntil(() => closingOldPane, 'the accepted stale-pane retirement')
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(dead)),
      false,
    )

    // Act
    await harness.reader.close()
    release()
    await outcome

    // Assert
    assert.equal(harness.reader.inspect().opened, false)
    assert.equal(harness.counts().panels, 0)
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .includes('workbench.action.newGroupAbove'),
      false,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.equal(draft.tab.isDirty, true)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft.tab)),
      true,
    )
  } finally {
    release()
    await outcome?.catch(() => undefined)
    context.mock.restoreAll()
    await harness.close()
  }
})

// Value: protects=a dead pane the editor kept at a cold open is named by the next selection and closed once the editor lets it, without touching the open reader's captured source; fails_when=the selection of an open reader never looks for dead panes, so the kept pane is never reported; why_new=Cycle 0044 0037-D3: the cold-open refusal test stopped at the open; seam=leaveDeadCodebookPane refuseClose, acceptDeadPaneClose
test('a selection on a reader that opened beside a dead pane the editor kept names that pane, and closes it once the editor lets it', async () => {
  // Arrange: the editor refused to close the old host's Application pane when the Study workspace was opened.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
      { refuseClose: true },
    )
    harness.focusMutableDraft('mutable-notes.txt', 3)
    await harness.reader.open()
    const capturedBefore = capturedSourceTabs(harness),
      refusedState = harness.reader.presentationState()
    // Act
    await assert.rejects(
      async () =>
        harness.reader.changePresentation({
          presentationId: refusedState.presentationId,
          expectedRevision: refusedState.presentationControlRevision,
          mode: refusedState.mode,
          action: 'select',
        }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.',
        causeDetail: 'A leftover Codebook pane could not be closed.',
      },
    )
    harness.acceptDeadPaneClose()
    const state = harness.reader.presentationState()
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(capturedBefore, 1)
    assert.equal(capturedSourceTabs(harness), 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=a closed reader opens when the page left active by closing its focused dead pane is a non-text page of the same group; fails_when=that page is refused as a foreign editor, so the first selection after an update needs the learner's click again; why_new=Cycle 0044 0037-D5: the same rule was tested for a focused captured source only; seam=leaveDeadCodebookPane focused
test('a closed reader opens when closing its focused dead Study pane leaves a non-text page of the editor active in the same group', async () => {
  // Arrange: after a host restart column 1 holds the editor's Settings page and, with focus, the old host's Study pane.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const settingsPage = harness.useOpaquePrimary('settings')
    const deadStudy = harness.leaveDeadCodebookPane(
      'codebook.studyContext',
      1,
      {
        focused: true,
      },
    )
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(
      tabs.some((tab) => tab === settingsPage),
      true,
    )
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection refused for the focused tab changes nothing in the window; fails_when=the dead panes and leftover captured-source tabs are closed before the refusal is decided; why_new=Cycle 0044 0037-F5: the refusal test beside a dead pane asserted the refusal and the focused page only (since Cycle 0045 cause 7 the refusal is the one for a focused preview tab; a kept non-text page is admitted); seam=leaveDeadCodebookPane, restoreLeftoverCapturedSource
test('a selection refused for a focused preview tab that is no text editor closes neither the dead pane nor the leftover captured-source tab of an earlier session', async () => {
  // Arrange: the editor's Settings page has focus in column 1 as a preview tab, beside an inactive leftover captured source; the old host's Study pane is the only tab of column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    await harness.reader.attach(harness.service)
    harness.useOpaquePrimary('settings')!.isPreview = true
    const leftover = harness.restoreLeftoverCapturedSource({ active: false }),
      deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const state = harness.reader.presentationState(),
      tabsBefore = harness.groups.flatMap((group) => group.tabs)
    // Act
    await assert.rejects(
      async () =>
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: state.mode,
          action: 'select',
        }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'A destination group contains a foreign preview: "Settings" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
      },
    )
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.deepEqual(tabs, tabsBefore)
    assert.equal(tabs.includes(leftover), true)
    assert.equal(tabs.includes(deadStudy), true)
    assert.deepEqual(harness.tabCloseRequests(), [])
    assert.equal(harness.counts().panels, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=the selection waits for the editor and is confirmed when the editor closed the focused dead pane but kept a leftover tab of another group; fails_when=the editor's one answer for the whole request is read as "nothing closed", so the wait is skipped and the draft the close activated is refused as a foreign editor; why_new=Cycle 0044 0037-F4: the fake editor closed all requested tabs or none; seam=restoreLeftoverCapturedSource refuseClose lateTextEditor, leaveDeadCodebookPane focused
test('a selection is confirmed when the editor closes the focused dead pane and keeps a leftover captured-source tab of another group', async () => {
  // Arrange: the editor keeps the inactive leftover captured source of column 1; in column 3 the old host's Study pane has focus in front of the learner's draft, whose text editor the editor reports 60 ms after the pane closed.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    await harness.reader.attach(harness.service)
    const draft = harness.focusMutableDraft('mutable-notes.txt', 3)
    const keptLeftover = harness.restoreLeftoverCapturedSource({
      active: false,
      column: 1,
      refuseClose: true,
      lateTextEditor: true,
    })
    const deadStudy = harness.leaveDeadCodebookPane(
      'codebook.studyContext',
      3,
      {
        focused: true,
      },
    )
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(tabs.includes(keptLeftover), true)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
  } finally {
    harness.acceptLeftoverClose()
    await harness.close()
  }
})

// Value: protects=a close request the editor rejects is treated as a kept pane: the selection ends with the instruction and nothing changes; fails_when=the rejection escapes as the editor's own error, or the selection goes on beside the dead pane; why_new=Cycle 0044 0037-D8: the fake editor could refuse a close but never reject the request; seam=rejectNextTabClose
test('a close request the editor rejects leaves every tab in place and the selection tells that a dead pane is still open', async () => {
  // Arrange: the editor rejects the close request, as it does when the request is cancelled.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.focusMutableDraft('mutable-notes.txt', 2)
    harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    harness.rejectNextTabClose()
    const state = harness.reader.presentationState(),
      tabsBefore = harness.groups.flatMap((group) => group.tabs)
    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select',
      }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        causeDetail: 'A leftover Codebook pane could not be closed.',
      },
    )
    // Assert
    assert.deepEqual(
      harness.groups.flatMap((group) => group.tabs),
      tabsBefore,
    )
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.counts().panels, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=this host's live Study pane is never taken for a dead one while its Application pane is gone; fails_when=only the Application panel counts as "this host owns a pane", so the live Study tab is closed as a leftover; why_new=Cycle 0044 0037-D8: the Study-only half of the live-panel condition had no test; seam=nativePanels
test('a selection after the learner closed the Application pane does not close this host’s live Study pane', async () => {
  // Arrange: the reader is open and the learner closed its Application tab, so this host owns the Study panel only.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    await harness.reader.open()
    const application = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser'),
      study = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.studyContext')
    assert.ok(application)
    assert.ok(study)
    application.dispose()
    const state = harness.reader.presentationState()
    // Act
    await harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'select',
      })
      .catch(() => undefined)
    // Assert
    assert.equal(
      harness.tabCloseRequests().flat().includes(study.nativeTab),
      false,
    )
    assert.equal(
      harness.groups.flatMap((group) => group.tabs).includes(study.nativeTab),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a dead Repository Wiki pane that had focus is closed by the first selection, which is then confirmed; fails_when=only the Application and Study view types count as Codebook panes, so the dead Wiki pane stays and the selection is refused for a foreign editor; why_new=Cycle 0044 0037-N6b: no test left a dead Wiki pane; seam=leaveDeadCodebookPane 'codebook.repositoryWiki'
test('the first presentation selection after an extension-host restart closes the old host’s dead Repository Wiki pane that had focus', async () => {
  // Arrange: the old host's Repository Wiki pane has focus in the only group; this host's Wiki reader has no panel.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const articleSource = harness.groups[0]!.tabs[0]!
    const deadWiki = harness.leaveDeadCodebookPane(
      'codebook.repositoryWiki',
      1,
      { focused: true },
    )
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadWiki), false)
    assert.equal(tabs.includes(articleSource), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=this host's live Repository Wiki pane stays open when the first selection closes the old host's dead panes; fails_when=every Repository Wiki tab is closed as a leftover without asking whether the Wiki reader owns a panel; why_new=Cycle 0044 0037-N6b: the Wiki view type was not a Codebook pane type before, so no test could close a live one; seam=leaveDeadCodebookPane
test('the first presentation selection keeps this host’s live Repository Wiki pane while it closes the old host’s dead Application pane', async () => {
  // Arrange: this host's Wiki reader shows its article in column 2; the old host's Application pane is the visible tab of column 1 and the learner's draft has focus in column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const liveWiki = harness.groups[1]!.tabs[0]!
    const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
    )
    harness.focusMutableDraft('mutable-notes.txt', 3)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.deepEqual(harness.tabCloseRequests()[0], [deadApplication])
    assert.equal(tabs.includes(liveWiki), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the dead panes of two earlier hosts are all closed by the first selection; fails_when=only one dead pane of a kind is recognized, so a second dead Application tab stays and the selection meets two Application tabs; why_new=Cycle 0044 0037-PR3: every earlier test left at most one dead pane of a kind; seam=leaveDeadCodebookPane
test('the first presentation selection closes the dead Application panes that two earlier extension hosts left in one window', async () => {
  // Arrange: two host restarts each left an Application pane behind: one in column 1, one in column 2; the learner's draft has focus in column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const firstDeadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        1,
      ),
      secondDeadApplication = harness.leaveDeadCodebookPane(
        'codebook.scopedBrowser',
        2,
      )
    harness.focusMutableDraft('mutable-notes.txt', 3)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(firstDeadApplication), false)
    assert.equal(tabs.includes(secondDeadApplication), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=the reader places its panes in columns 1 and 3 after the dead pane's close removed the first editor group and renumbered the others; fails_when=the placement uses the column numbers it read before the close; why_new=Cycle 0044 0037-PR4: the only emptied-group test removed the last group, which renumbers nothing; seam=leaveDeadCodebookPane, useOpaquePrimary
test('the first presentation selection places its panes after closing the dead Application pane removed the first editor group', async () => {
  // Arrange: the old host's Application pane is the only tab of column 1; the learner's draft has focus in column 2 and column 3 is empty.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.useOpaquePrimary('blank')
    const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
    )
    const draft = harness.focusMutableDraft('mutable-notes.txt', 2)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    // Assert
    const tabs = harness.groups.flatMap((group) => group.tabs)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(draft.tab), true)
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
  } finally {
    await harness.close()
  }
})

// Value: protects=the extension README tells a learner and an agent the dead-pane refusal and its causes in the words the reader uses; fails_when=the README does not describe the close of an earlier session's tabs, or its texts drift from the refusal a selection gives; why_new=Cycle 0044 0037-DOC1: the README named neither the close nor the refusal; seam=none
test('the extension README gives the refusal for a dead pane that stays open and both causes word for word', async () => {
  // Arrange
  const readme = await readFile(resolve(__dirname, '../../README.md'), 'utf8')
  // Act
  const documented = [
    '`A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.`',
    '`A leftover Codebook pane could not be closed.`',
    '`A leftover captured source tab could not be closed.`',
  ].map((text) => readme.includes(text))
  // Assert
  assert.deepEqual(documented, [true, true, true])
})

/** Lists the commands a reader ran that move the keyboard between editor groups or to Cursor's chat, in order: the editor's group focus commands and Cursor's "Focus Agent". @example keyboardCommands(harness) // => ['workbench.action.focusFirstEditorGroup', 'composer.focusComposer'] */
const keyboardCommands = (
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
): string[] => harness.commands.filter(isKeyboardCommand)

/** Tells whether a command moves the keyboard between editor groups or to Cursor's chat; see {@link keyboardCommands}. @example isKeyboardCommand('composer.focusComposer') // => true */
function isKeyboardCommand(command: string): boolean {
  return /^workbench\.action\.focus\w+EditorGroup$|^composer\.focusComposer$/.test(
    command,
  )
}

/** Starts a run of the harness's configured study and follows it to its first pause, as an agent's start and input do; the reader is left as it was. @example const record = await pauseLiveRun(harness) */
const pauseLiveRun = async (
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
) => {
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: randomUUID(),
  })
  const record = harness.service.record(receipt)
  await record.preparation
  harness.service.action({
    instanceId: harness.service.instanceId,
    runId: record.id,
    key: randomUUID(),
    action: 'repository-click',
  })
  return record
}

// Value: protects=a presentation select answering with the opened reader after the learner closed the Study workspace during a paused run; fails_when=Close keeps the live or replay arrangement flag, so the next select arranges panes of a closed reader and is refused until Open Study Workspace is run; why_new=Cycle 0045 NF-21: no test selected a presentation after a close that ended a live arrangement; seam=workspace harness with the controlled runtime
test('a selection after Close Study Workspace during a paused run opens the reader instead of refusing the live layout', async () => {
  // Arrange: the learner followed a run to its pause in the live arrangement, then closed the Study workspace, which stops the run.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await pauseLiveRun(harness)
    await harness.reader.open()
    const liveBeforeClose = readerSeams(harness).isLiveArrangement()
    await harness.reader.close()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(liveBeforeClose, true)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(selected.panes.contextColumn, 3)
  } finally {
    await harness.close()
  }
})

// Value: protects=a presentation select answering with the opened reader after a first entry during a paused run was refused; fails_when=the refused entry keeps the live arrangement flag of a reader that is not open, so the next select arranges two rows in a window that holds no Codebook pane and is refused until Open Study Workspace, Open replay or Close; why_new=Cycle 0045 local review study-1 #2 (NF-21 reset the flags in Close only); seam=workspace harness with the controlled runtime and failNextPanelCreation
test('a selection after a first entry that was refused during a paused run opens the reader in the live arrangement', async () => {
  // Arrange: an agent's run is paused, the reader is closed and the learner's file has the focus; the first selection is refused inside the entry, after the entry chose the live arrangement.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    harness.focusMutableDraft()
    await pauseLiveRun(harness)
    const closed = harness.reader.presentationState()
    harness.failNextPanelCreation('codebook.scopedBrowser')
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: closed.presentationId,
        expectedRevision: closed.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      }),
    )
    const refused = {
      state: harness.reader.presentationState().state,
      live: readerSeams(harness).isLiveArrangement(),
      panels: harness.counts().panels,
    }
    const state = harness.reader.presentationState()

    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert
    assert.deepEqual(refused, { state: 'closed', live: false, panels: 0 })
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(readerSeams(harness).isLiveArrangement(), true)
  } finally {
    await harness.close()
  }
})

/** The editor commands that hide or show a side bar; a reading whose side bars could not be measured runs none of them. */
const SIDE_BAR_COMMANDS = [
  'workbench.action.closeSidebar',
  'workbench.action.maximizeEditorHideSidebar',
  'workbench.action.focusSideBar',
  'workbench.action.focusAuxiliaryBar',
]

for (const open of [
  { primary: false, auxiliary: true },
  { primary: true, auxiliary: false },
  { primary: false, auxiliary: false },
  { primary: true, auxiliary: true },
])
  // Value: protects=the learner's side bars through a Read of the Application pane during a live run and the Restore that ends it: each bar is open or closed as the learner had it; fails_when=the live arrangement's two rows give the reader no width to measure the bars by, the Read hides both anyway and its end shows both, so a learner who keeps the file explorer or the chat closed gets it opened by every Read; why_new=Cycle 0045 local review study-1 #1 (the "stays closed" tests of NF-22 used the three-pane columns only); seam=the workspace harness's side bar model, the controlled runtime and the fake editor's maximized group
  test(`a Read in the live arrangement and its Restore leave the side bars as the learner has them, with the primary side bar ${open.primary ? 'open' : 'closed'} and the secondary one ${open.auxiliary ? 'open' : 'closed'}`, async () => {
    // Arrange: a paused live run in its two rows; the learner reads the Application pane enlarged.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.modelSideBars(open)
    try {
      await pauseLiveRun(harness)
      await harness.reader.open()
      const liveBeforeRead = readerSeams(harness).isLiveArrangement()
      await harness.reader.action('read-app')
      const duringRead = {
        ...harness.sideBars(),
        maximized: harness.maximizedEditorGroup(),
      }
      const state = harness.reader.presentationState()

      // Act
      const restored = await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })

      // Assert
      assert.equal(liveBeforeRead, true)
      assert.deepEqual(duringRead, {
        ...open,
        hasKeyboard: false,
        maximized: true,
      })
      assert.deepEqual(harness.sideBars(), { ...open, hasKeyboard: false })
      assert.equal(harness.maximizedEditorGroup(), false)
      assert.equal(restored.layoutConfirmed, true)
      assert.equal(restored.reason, undefined)
      // No bar is hidden for a measurement that cannot be made, and none is shown.
      assert.deepEqual(
        harness.commands.filter((command) =>
          SIDE_BAR_COMMANDS.includes(command),
        ),
        [],
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=a Restore after a Read in a live run ending confirmed, with the keyboard on the pane that had it, when the editor names another group as the active one for a moment while the Read's maximization ends; fails_when=that event of the Restore's own un-maximize is read as the learner choosing another tab, and the Restore, which arranged the panes, answers "The learner changed native tab focus while the Study layout command was pending. The newer choice was preserved." although nobody touched the window; why_new=Cycle 0046 row 4 (Cycle 0045 NF-7b, Cursor checks F8 and F6); seam=the workspace harness's nameAnotherGroupWhenMaximizationEnds and the controlled runtime
test('a Restore after a Read in a live run is confirmed when the editor names another group for a moment while the maximization ends', async () => {
  // Arrange: a paused live run in its two rows; the learner read the Application pane enlarged, and the editor names the source's group for 40 ms when that maximization ends.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.nameAnotherGroupWhenMaximizationEnds(2, 40)
  try {
    await pauseLiveRun(harness)
    await harness.reader.open()
    await harness.reader.action('read-app')
    const focusedBefore = harness.focusedPanel()
    const state = harness.reader.presentationState()

    // Act
    const restored = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })

    // Assert
    assert.equal(focusedBefore, 'codebook.scopedBrowser')
    assert.equal(restored.layoutConfirmed, true)
    assert.equal(restored.reason, undefined)
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(harness.maximizedEditorGroup(), false)
  } finally {
    await harness.close()
  }
})

// Value: protects=the pane's Restore after a Read in the three-pane Study layout ending confirmed when the editor names another group as the active one for a moment while the Read's maximization ends; fails_when=the three-pane Restore reads that event of its own un-maximize as the learner choosing another tab and leaves the layout unconfirmed with "The learner changed native tab focus while the Study layout command was pending. The newer choice was preserved."; why_new=Cycle 0046 row 4 (the three-pane Restore uses the same guard as the live one); seam=the workspace harness's nameAnotherGroupWhenMaximizationEnds
test('a Restore after a Read in the three-pane Study layout is confirmed when the editor names another group for a moment while the maximization ends', async () => {
  // Arrange: the learner read the explanation enlarged; the editor names the Application pane's group for 40 ms when that maximization ends.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.nameAnotherGroupWhenMaximizationEnds(1, 40)
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')

    // Act
    await harness.reader.action('arrange')

    // Assert
    assert.equal(harness.reader.inspect().view!.errors.join(' | '), '')
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(harness.maximizedEditorGroup(), false)
    const restored = await harness.reader.readPresentationState()
    assert.equal(restored.layoutConfirmed, true)
    assert.equal(restored.reason, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=a learner who selects another tab while a Restore after a Read in a live run ends the maximization keeping that tab, the Restore refused with the sentence that says so; fails_when=the allowance for the editor's own events of the un-maximize also swallows a change that lasts, and the Restore takes the keyboard back from the learner's tab; why_new=Cycle 0046 row 4 (the separation of the editor's event from a learner's change needs its other side); seam=holdNextCommand on the Restore's un-maximize, the learner's focusMutableDraft, the controlled runtime
test('a learner who selects another tab while a Restore in a live run ends the maximization keeps that tab and the Restore says so', async () => {
  // Arrange: a paused live run in its two rows; the learner read the Application pane enlarged.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await pauseLiveRun(harness)
    await harness.reader.open()
    await harness.reader.action('read-app')
    const state = harness.reader.presentationState()
    const held = harness.holdNextCommand(
      'workbench.action.minimizeOtherEditors',
    )
    release = held.release

    // Act: while the Restore ends the maximization, the learner selects a file of their own in the source's group.
    const restoring = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })
    await held.started
    const draft = harness.focusMutableDraft('newer-notes.txt', 2)
    release()
    const refusal = await restoring.then(
      () => 'restored',
      (error: unknown) => String(error),
    )

    // Assert
    assert.equal(
      refusal,
      'Error: The learner changed native tab focus while the Study layout command was pending. The newer choice was preserved.',
    )
    assert.equal(
      harness.editor.window.tabGroups.activeTabGroup.activeTab,
      draft.tab,
    )
  } finally {
    release()
    await harness.close()
  }
})

// Value: protects=the learner's side bars through a Read of the captured source in a recording and Close Study Workspace: a bar the learner keeps closed is closed afterwards and an open one is open; fails_when=the replay arrangement's two rows give no width, the Read hides both bars and Close shows both, which opens the bar the learner had closed; why_new=Cycle 0045 local review study-1 #1 (the replay arrangement was covered only by a test that pinned both show commands); seam=the recorded reader harness, the workspace harness's side bar model and the fake editor's maximized group
test('a Read in a recording and Close Study Workspace leave a side bar the learner had closed as it was', async () => {
  // Arrange: a recording is open in its two rows, the primary side bar closed and the secondary one open; the learner reads the captured source enlarged.
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: false, auxiliary: true })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.action('read-source')
    const duringRead = {
      ...harness.sideBars(),
      maximized: harness.maximizedEditorGroup(),
    }

    // Act
    await harness.reader.close()

    // Assert
    assert.deepEqual(duringRead, {
      primary: false,
      auxiliary: true,
      hasKeyboard: false,
      maximized: true,
    })
    assert.deepEqual(harness.sideBars(), {
      primary: false,
      auxiliary: true,
      hasKeyboard: false,
    })
    assert.equal(harness.maximizedEditorGroup(), false)
    assert.deepEqual(
      harness.commands.filter((command) => SIDE_BAR_COMMANDS.includes(command)),
      [],
    )
    assert.equal(harness.reader.presentationState().state, 'closed')
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's first presentation select during a paused run answering with the live panes arranged and confirmed; fails_when=the selection that opened a closed reader into the live arrangement still waits for a Study pane's render, which that arrangement does not have, and is refused after five seconds; why_new=Cycle 0045 NF-19: every selection test of a closed reader ran without a current run; seam=workspace harness with the controlled runtime
test('the first presentation select during a paused live run with the reader closed arranges the live panes and answers a confirmed layout', async () => {
  // Arrange: an agent's run is paused at its stop and the learner has not opened the Study workspace; the learner's file has the focus.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const draft = harness.focusMutableDraft()
    await pauseLiveRun(harness)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(state.state, 'closed')
    assert.equal(selected.state, 'open')
    assert.equal(selected.mode, 'study-workspace')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(selected.panes.contextColumn, undefined)
    assert.equal(readerSeams(harness).isLiveArrangement(), true)
    assert.equal(
      harness.groups.flatMap((group) => group.tabs).includes(draft.tab),
      true,
    )
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    await harness.close()
  }
})

for (const replacesGroupObjects of [false, true])
  // Value: protects=an agent's presentation select being admitted while the agent's own chat tab has the keyboard focus, with the chat left as it is and focused again afterwards; fails_when=the admission refuses every focused tab that is no text editor, or the arranged panes keep the focus, or the group objects the editor replaces with each tab change make the arrangement lose its groups; why_new=Cycle 0045 cause 7 of the baseline round (Cursor: the Agent chat is a tab of an editor group with no known input, and nobody can focus anything else while the agent works); seam=workspace harness with a separate editor part and the fake editor's group object replacement
  test(`a presentation selection made while a tab that is not a text editor has the focus in another group arranges the Study panes and gives that group the focus back, ${replacesGroupObjects ? 'also when the editor replaces every tab group object with each tab change as Cursor does' : 'in an editor that keeps its tab group objects'}`, async () => {
    // Arrange: the agent's chat is a tab of its own editor part and has the keyboard focus; the reader is closed.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const chat = harness.addSeparateEditorPart()
    if (replacesGroupObjects) harness.replaceGroupObjectsOnTabChanges()
    try {
      chat.focusTab()
      const state = harness.reader.presentationState()
      // Act
      const selected = await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      // Assert
      const chatGroup = harness.groups.find((group) =>
        group.tabs.includes(chat.tab),
      )
      assert.equal(selected.state, 'open')
      assert.equal(selected.layoutConfirmed, true)
      assert.equal(selected.reason, undefined)
      assert.equal(selected.panes.appColumn, 1)
      assert.equal(selected.panes.sourceColumn, 2)
      assert.equal(selected.panes.contextColumn, 3)
      // The chat tab was neither closed nor moved into a Study group: it is the only tab of its own group, behind the three Study groups.
      assert.equal(chatGroup?.viewColumn, 4)
      assert.equal(chatGroup?.tabs.length, 1)
      assert.equal(chatGroup?.activeTab, chat.tab)
      // The chat has the keyboard again through Cursor's own command; the focus command of the chat's column, which would open a new empty group in the main editor, was not run.
      assert.deepEqual(keyboardCommands(harness), [
        'workbench.action.focusFirstEditorGroup',
        'composer.focusComposer',
      ])
      assert.equal(harness.groups.length, 4)
      assert.equal(chat.focused(), true)
      assert.equal(harness.editor.window.activeTextEditor, undefined)
    } finally {
      await harness.close()
    }
  })

for (const reader of ['closed', 'open'] as const)
  // Value: protects=the refusal for a preview tab that would be replaced by a placed pane naming that tab and the step that clears it, also when that tab itself has the focus; fails_when=a focused image preview is answered with a refusal that names no tab, or the selection moves panes over it; why_new=Cycle 0045 NF-26: the tab was named only while a text editor had the focus (the refusal read "Focus a Codebook pane or text editor before selecting a presentation; the current foreign editor cannot be restored safely."); seam=addOpaqueTab, focusOpaqueTab
  test(`a selection refused while an image preview has the focus names that tab and how to clear it, on ${reader === 'closed' ? 'a closed' : 'an open'} reader`, async () => {
    // Arrange: the learner single-clicked an image, which the editor shows as a preview tab in the first column, and it has the focus.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      if (reader === 'open') await harness.reader.open()
      else await harness.reader.attach(harness.service)
      const image = harness.addOpaqueTab('logo.png', 1)
      image.isPreview = true
      harness.focusOpaqueTab(image)
      const state = harness.reader.presentationState(),
        commands = [...harness.commands],
        reveals = harness.panelReveals(),
        tabsBefore = harness.groups.flatMap((group) => group.tabs)
      // Act
      const refused = (async () =>
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'living-book',
          action: 'select',
        }))()
      // Assert
      await assert.rejects(refused, {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'A destination group contains a foreign preview: "logo.png" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
      })
      assert.equal(image.isPreview, true)
      assert.deepEqual(
        harness.groups.flatMap((group) => group.tabs),
        tabsBefore,
      )
      assert.deepEqual(harness.commands, commands)
      assert.deepEqual(harness.panelReveals(), reveals)
      assert.equal(harness.reader.presentationState().mode, 'study-workspace')
      assert.equal(harness.presentationPreferences.size, 0)
    } finally {
      await harness.close()
    }
  })

// Value: protects=the refusal of a live arrangement naming the tab that covers the captured source and the step that clears it; fails_when=the cause reads "The current captured source is not ready in its native pane. Wait for it, …", which names no tab and nothing the reader can do about one; why_new=Cycle 0045 NF-26: the live branch of a selection inspected no tab; seam=workspace harness with the controlled runtime, addOpaqueTab, focusOpaqueTab
test('a live selection refused because a tab covers the captured source names that tab', async () => {
  // Arrange: the reader follows a paused run in the live arrangement; the learner opened an image in the source group, where it covers the captured source and has the focus.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await pauseLiveRun(harness)
    await harness.reader.open()
    const image = harness.addOpaqueTab('logo.png', 2)
    harness.focusOpaqueTab(image)
    const state = harness.reader.presentationState()
    // Act
    const refused = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    await assert.rejects(refused, {
      code: 'PRESENTATION_UNAVAILABLE',
      message: 'The live Study layout could not be confirmed after Restore.',
      causeDetail:
        'The tab "logo.png" is in front of the captured source in editor group 2. Close that tab or select the captured source\'s tab, then restore the layout again.',
    })
    assert.equal(readerSeams(harness).isLiveArrangement(), true)
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 2)?.activeTab,
      image,
    )
  } finally {
    await harness.close()
  }
})

for (const reader of ['closed', 'open'] as const)
  // Value: protects=an agent's presentation select during its own paused run in Cursor ending with the live panes confirmed and the agent's chat focused, whether the Study workspace was closed or already followed the run; fails_when=the selection is refused for the focused chat tab, the live panes lose their groups to the group objects Cursor replaces, or the focus stays in the main editor after the layout was measured; why_new=Cycle 0045 cause 7 with NF-19 (the baseline round's Cursor run: the select was refused and the run showed no stopped source); seam=workspace harness with the controlled runtime, a separate editor part and the fake editor's group object replacement
  test(`a presentation ${reader === 'open' ? 'restore' : 'select'} during a paused live run, made while the agent chat's tab has the focus in Cursor, confirms the live panes and gives the chat the focus back, with the reader ${reader}`, async () => {
    // Arrange: Cursor replaces every tab group object with each tab change; the agent's chat is a tab of its own editor part and has the keyboard focus while its run is paused.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.replaceGroupObjectsOnTabChanges()
    try {
      await pauseLiveRun(harness)
      if (reader === 'open') await harness.reader.open()
      chat.focusTab()
      const state = harness.reader.presentationState()
      // Act
      const selected = await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        // A select of the live layout that is confirmed already is answered without arranging (Cycle 0045 cause 12 (e)); on the open reader the arrangement is asked for with a restore.
        action: reader === 'open' ? 'restore' : 'select',
      })
      // Assert
      const chatGroup = harness.groups.find((group) =>
        group.tabs.includes(chat.tab),
      )
      assert.equal(state.state, reader)
      assert.equal(selected.state, 'open')
      assert.equal(selected.layoutConfirmed, true)
      assert.equal(selected.reason, undefined)
      assert.equal(selected.panes.appColumn, 1)
      assert.equal(selected.panes.sourceColumn, 2)
      assert.equal(readerSeams(harness).isLiveArrangement(), true)
      assert.equal(chatGroup?.viewColumn, 4)
      assert.equal(chatGroup?.activeTab, chat.tab)
      // The chat has the keyboard again through Cursor's own command; the focus command of the chat's column, which would open a new empty group in the main editor, was not run.
      assert.equal(keyboardCommands(harness).at(-1), 'composer.focusComposer')
      assert.equal(harness.groups.length, 4)
      assert.equal(chat.focused(), true)
    } finally {
      await harness.close()
    }
  })

// Value: protects=the agent chat's keyboard after a restore of the live panes that failed once the arrangement had moved the keyboard into the main editor: the chat has it again; fails_when=only the successful arrangement gives the focus back, so a restore the editor fails leaves the keyboard in the main editor and the agent's next key press goes there; why_new=Cycle 0045 local review coderabbit #6 (the live and replay branch returned the focus on success only, unlike a selection and an open); seam=workspace harness with the controlled runtime, a separate editor part, and failNextCommand on the arrangement's command batch
test("a restore of the live panes that the editor fails after the arrangement took the keyboard, made while the agent chat's tab has the focus in Cursor, gives the chat the keyboard back", async () => {
  // Arrange: the reader follows a paused run in Cursor and the agent's chat has the keyboard; the editor will fail the command batch of the restore's arrangement.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  try {
    await pauseLiveRun(harness)
    await harness.reader.open()
    chat.focusTab()
    const state = harness.reader.presentationState()
    harness.failNextCommand('runCommands')

    // Act
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      }),
      /Native layout command failed/,
    )

    // Assert
    assert.equal(chat.focused(), true)
    assert.equal(keyboardCommands(harness).at(-1), 'composer.focusComposer')
    assert.equal(harness.groups.length, 4)
    assert.equal(
      harness.reader.presentationState().reason,
      'Error: Native layout command failed',
    )
  } finally {
    await harness.close()
  }
})

for (const action of ['select', 'restore'] as const)
  for (const replacesGroupObjects of [false, true])
    // Value: protects=an agent's presentation select or restore being admitted in the state a real Cursor chat submission is in (the chat input holds the keyboard, and the editor names a learner's file of the main editor as the active tab without an active text editor), and the chat having the keyboard again afterwards; fails_when=every text tab without an active text editor is refused as if it were a captured source the editor kept, which only a click into an editor clears, and an agent cannot click, or the keyboard stays on the captured source after the measurement borrowed it; why_new=Cycle 0045 cause 12 (a) (second native round, N14-b2 and owed check 1, take A2: both calls refused with "has no text editor", the run showed no stopped source); seam=workspace harness with a separate editor part that holds the keyboard while the main group stays the active tab group
    test(`a ${action === 'select' ? 'selection' : 'restore'} made while the chat input has the focus and the editor names a text tab without an active text editor arranges the Study panes and closes or moves no tab, ${replacesGroupObjects ? 'also when the editor replaces every tab group object with each tab change as Cursor does' : 'in an editor that keeps its tab group objects'}`, async () => {
      // Arrange: as the editor API reported it in Cursor: group 1 is the active tab group and shows the learner's file beside a settings page, group 2 below it is empty, and the Agent chat's own editor part holds the keyboard, so no text editor is active while that file's editor is visible.
      const harness = await workspaceHarness(false)
      harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
      harness.groups.at(-1)!.tabs = []
      harness.groups.at(-1)!.activeTab = undefined
      const chat = harness.addSeparateEditorPart()
      if (replacesGroupObjects) harness.replaceGroupObjectsOnTabChanges()
      try {
        const settings = harness.addOpaqueTab('Cursor Settings', 1),
          learnerFile = harness.focusMutableDraft('actions.ts', 1)
        chat.focus()
        const state = harness.reader.presentationState(),
          activeBefore = harness.editor.window.tabGroups.activeTabGroup,
          tabsOfFirstGroupBefore = [...activeBefore.tabs]
        const stateBefore = {
          chatHasKeyboard: chat.focused(),
          chatColumn: harness.groups.find((group) =>
            group.tabs.includes(chat.tab),
          )?.viewColumn,
          activeColumn: activeBefore.viewColumn,
          activeTabIsLearnerFile: activeBefore.activeTab === learnerFile.tab,
          hasActiveTextEditor:
            harness.editor.window.activeTextEditor !== undefined,
          visibleEditors: harness.editor.window.visibleTextEditors.length,
        }
        // Act
        const arranged = await harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'study-workspace',
          action,
        })
        // Assert
        const firstGroup = harness.groups.find(
          (group) => group.viewColumn === 1,
        )!
        assert.deepEqual(stateBefore, {
          chatHasKeyboard: true,
          chatColumn: 3,
          activeColumn: 1,
          activeTabIsLearnerFile: true,
          hasActiveTextEditor: false,
          visibleEditors: 1,
        })
        assert.equal(arranged.state, 'open')
        assert.equal(arranged.layoutConfirmed, true)
        assert.equal(arranged.reason, undefined)
        assert.equal(arranged.panes.appColumn, 1)
        assert.equal(arranged.panes.sourceColumn, 2)
        assert.equal(arranged.panes.contextColumn, 3)
        // No tab was closed or moved: the first group still holds its tabs in their order, before the Application pane, and the chat tab is alone in its group behind the Study groups.
        assert.deepEqual(harness.tabCloseRequests(), [])
        assert.deepEqual(
          firstGroup.tabs.slice(0, tabsOfFirstGroupBefore.length),
          tabsOfFirstGroupBefore,
        )
        assert.equal(firstGroup.tabs.includes(settings), true)
        assert.equal(learnerFile.tab.isDirty, true)
        assert.equal(
          learnerFile.document.getText(),
          'Original learner draft.\n',
        )
        assert.equal(
          harness.groups.find((group) => group.tabs.includes(chat.tab))
            ?.viewColumn,
          4,
        )
        // The measurement borrowed the keyboard for the main editor; the chat has it again through Cursor's own command. The focus command of the chat's column, which would open a new empty group in the main editor, was not run.
        assert.equal(chat.focused(), true)
        assert.equal(harness.editor.window.activeTextEditor, undefined)
        assert.deepEqual(keyboardCommands(harness), [
          'workbench.action.focusFirstEditorGroup',
          'composer.focusComposer',
        ])
        assert.equal(harness.groups.length, 4)
      } finally {
        await harness.close()
      }
    })

for (const reader of ['closed', 'open'] as const)
  // Value: protects=an agent's presentation select during its own paused run in the state of a real Cursor chat submission (the chat input holds the keyboard, the editor names a file in an original main group, no text editor is active) ending with the live panes confirmed and the keyboard back in the chat; fails_when=the selection is refused for the text tab without an active text editor, or the keyboard stays on that file after the measurement focused the first editor group; why_new=Cycle 0045 cause 12 (a) (N14-b2: the debugger's source shared group 1 with the Application pane and every presentation call was refused); seam=workspace harness with the controlled runtime, a separate editor part that holds the keyboard and the fake editor's group object replacement
  test(`a presentation ${reader === 'open' ? 'restore' : 'select'} during a paused live run, made while the chat input has the focus and the editor names a text tab without an active text editor, confirms the live panes and gives the chat the keyboard back, with the reader ${reader}`, async () => {
    // Arrange: the original second main group holds the named file before or after App allocation; the chat's own editor part holds the keyboard, so the editor names that file's tab and no active text editor.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    const chat = harness.addSeparateEditorPart()
    harness.replaceGroupObjectsOnTabChanges()
    try {
      await pauseLiveRun(harness)
      if (reader === 'open') await harness.reader.open()
      const namedFile = harness.focusMutableDraft(
        'login-form.tsx',
        reader === 'open' ? 3 : 2,
      )
      chat.focus()
      const state = harness.reader.presentationState()
      const stateBefore = {
        chatHasKeyboard: chat.focused(),
        activeTabIsNamedFile:
          harness.editor.window.tabGroups.activeTabGroup.activeTab ===
          namedFile.tab,
        hasActiveTextEditor:
          harness.editor.window.activeTextEditor !== undefined,
      }
      // Act
      const selected = await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        // A select of the live layout that is confirmed already is answered without arranging (Cycle 0045 cause 12 (e)); on the open reader the arrangement is asked for with a restore.
        action: reader === 'open' ? 'restore' : 'select',
      })
      // Assert
      const chatGroup = harness.groups.find((group) =>
        group.tabs.includes(chat.tab),
      )
      assert.deepEqual(stateBefore, {
        chatHasKeyboard: true,
        activeTabIsNamedFile: true,
        hasActiveTextEditor: false,
      })
      assert.equal(state.state, reader)
      assert.equal(selected.state, 'open')
      assert.equal(selected.layoutConfirmed, true)
      assert.equal(selected.reason, undefined)
      assert.equal(selected.panes.appColumn, 1)
      assert.equal(selected.panes.sourceColumn, 2)
      assert.equal(readerSeams(harness).isLiveArrangement(), true)
      assert.equal(
        harness.groups
          .find((group) => group.viewColumn === 3)
          ?.tabs.includes(namedFile.tab),
        true,
      )
      assert.deepEqual(harness.tabCloseRequests(), [])
      assert.equal(namedFile.document.getText(), 'Original learner draft.\n')
      assert.equal(namedFile.tab.isDirty, true)
      assert.equal(chatGroup?.viewColumn, 4)
      // The chat has the keyboard again through Cursor's own command; the focus command of the chat's column, which would open a new empty group in the main editor, was not run.
      assert.equal(keyboardCommands(harness).at(-1), 'composer.focusComposer')
      assert.equal(harness.groups.length, 4)
      assert.equal(chat.focused(), true)
    } finally {
      await harness.close()
    }
  })

// Value: protects=a refused presentation selection leaving the window as it found it: no Codebook pane is opened, no tab changes, and the chat input keeps the keyboard; fails_when=the refusal is answered only after the Application pane was opened in the first group and the keyboard had moved from the chat to it, and both stay; why_new=Cycle 0045 cause 12 (b) (owed check 1, take A1: refused after 5.2 s, the Application pane open in group 1 with the keyboard); seam=workspace harness with a separate editor part whose group the editor names as active, the fake editor's group object replacement and its unreported pane focus beside the chat
test('a selection refused for a preview tab opens no pane and leaves the keyboard focus where it was', async () => {
  // Arrange: Cursor names the chat's group as the active one and its input has the keyboard; the first group shows the learner's file and holds an image the learner opened by a single click, a preview tab that Codebook cannot keep open for the learner.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    await harness.reader.attach(harness.service)
    const image = harness.addOpaqueTab('logo.png', 1)
    image.isPreview = true
    harness.focusMutableDraft('login-form.tsx', 1)
    chat.focusTab()
    const state = harness.reader.presentationState(),
      commands = [...harness.commands],
      tabsBefore = harness.groups.map((group) => [...group.tabs])
    // Act
    const refused = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    await assert.rejects(refused, {
      code: 'PRESENTATION_UNAVAILABLE',
      message:
        'A destination group contains a foreign preview: "logo.png" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
    })
    assert.equal(harness.counts().panels, 0)
    assert.deepEqual(
      harness.groups.map((group) => [...group.tabs]),
      tabsBefore,
    )
    assert.equal(image.isPreview, true)
    assert.deepEqual(harness.tabCloseRequests(), [])
    // Nothing was focused, measured or revealed: the chat's group is the active one and its input has the keyboard.
    assert.deepEqual(harness.commands, commands)
    assert.deepEqual(harness.panelReveals(), [])
    assert.equal(
      harness.editor.window.tabGroups.activeTabGroup.tabs.includes(chat.tab),
      true,
    )
    assert.equal(chat.focused(), true)
    assert.equal(harness.reader.presentationState().state, 'closed')
  } finally {
    await harness.close()
  }
})

// Value: protects=the first presentation selection of a chat request in Cursor being arranged beside the preview tab the debugger of an earlier run left in the first group, with that tab kept open; fails_when=the main editor is measured only after the Application pane was placed in front of the first group's text editor, where Cursor reports no focus while it names the chat's group, so the wait for that report ends after five seconds and the refusal names the preview tab; why_new=Cycle 0045 cause 12 (b) (owed check 1, take A1, and item 2's first try: "A destination group contains a foreign preview: "actions.ts" in editor group 1. …" twice, the preview was not replaced either time); seam=workspace harness with a separate editor part whose group the editor names as active, addTextPreview, the fake editor's group object replacement and its unreported pane focus beside the chat
test("a selection made from the chat beside the debugger's leftover preview tab arranges the Study panes and keeps that tab open", async () => {
  // Arrange: as the editor API reported it in Cursor: the first group shows the learner's file and holds the debugger's unedited preview and a settings page, the group below is empty, and the editor names the chat's group, whose input has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    const debuggerFile = join(harness.directory, 'actions.ts')
    await writeFile(debuggerFile, 'export const authenticate = 1\n')
    const settings = harness.addOpaqueTab('Cursor Settings', 1),
      learnerFile = harness.focusMutableDraft('login-form.tsx', 1),
      debuggerPreview = harness.addTextPreview(debuggerFile, 1)
    chat.focusTab()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    const firstGroup = harness.groups.find((group) => group.viewColumn === 1)!,
      chatGroup = harness.groups.find((group) => group.tabs.includes(chat.tab))
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(selected.panes.contextColumn, 3)
    // The debugger's tab is still a tab of the first group, kept open as a double-click on its tab keeps it; nothing was closed.
    assert.equal(firstGroup.tabs.includes(debuggerPreview), true)
    assert.equal(debuggerPreview.isPreview, false)
    assert.equal(firstGroup.tabs.includes(settings), true)
    assert.equal(firstGroup.tabs.includes(learnerFile.tab), true)
    assert.deepEqual(harness.tabCloseRequests(), [])
    assert.equal(chatGroup?.viewColumn, 4)
    // The chat has the keyboard again through Cursor's own command; the focus command of the chat's column, which would open a new empty group in the main editor, was not run.
    assert.deepEqual(keyboardCommands(harness), [
      'workbench.action.focusFirstEditorGroup',
      'composer.focusComposer',
    ])
    assert.equal(harness.groups.length, 4)
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection that is refused because the main editor never reports the keyboard focus the measurement gave it leaving the window as it found it, with a text that says what the reader does next; fails_when=the Application pane the selection created stays open with the keyboard, the chat does not get the keyboard back because the editor still names its group, or the refusal reads "Timed out waiting for identifiable primary editor focus"; why_new=Cycle 0045 cause 12 (b) (owed check 1, take A1: Cursor kept naming the chat's group while the Application pane had the keyboard, and the pane stayed); seam=workspace harness with a separate editor part whose group the editor names as active, the fake editor's unreported pane focus beside the chat, and the fake clock for the five seconds of the wait
test('a selection refused because the main editor reports no keyboard focus closes the Application pane it opened and gives the chat the keyboard back', async (context) => {
  // Arrange: Cursor names the chat's group as the active one and its input has the keyboard; the first group shows a settings page, so the measurement can only focus the Application pane the selection places there, and Cursor reports no focus of that pane.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    await harness.reader.attach(harness.service)
    harness.focusOpaqueTab(harness.addOpaqueTab('Cursor Settings', 1))
    chat.focusTab()
    const state = harness.reader.presentationState(),
      tabsBefore = harness.groups.map((group) => [...group.tabs]),
      layoutBefore = structuredClone(harness.editorLayout())
    // Act: the five seconds of the wait for the focus report pass on a faked clock.
    let answer: unknown
    void harness.reader
      .changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .then(
        (arranged) => {
          answer = arranged
        },
        (error: unknown) => {
          answer = error
        },
      )
    enableFakeClock(context)
    const refusedAfterMs = await advanceClockUntil(
      context,
      () => answer !== undefined,
      6_000,
    )
    resetFakeClock(context)
    // Assert
    // The faked clock moves in steps of 50 ms, and the refusal is seen one step after the bound at the latest.
    assert.equal(
      refusedAfterMs !== undefined &&
        refusedAfterMs >= 5_000 &&
        refusedAfterMs <= 5_050,
      true,
    )
    assert.equal(
      answer instanceof Error && answer.message,
      'The Codebook panes were not arranged: the main editor did not report the keyboard focus within 5 s after Codebook focused its first editor group. Click into a file in the main editor, then try again.',
    )
    assert.equal(harness.counts().panels, 0)
    assert.deepEqual(
      harness.groups.map((group) => [...group.tabs]),
      tabsBefore,
    )
    assert.equal(chat.focused(), true)
    assert.equal(harness.reader.presentationState().state, 'closed')
    // The grid is as the call found it: no editor group was opened for the focus return (Cycle 0045 cause 12 (d)).
    assert.equal(harness.groups.length, 3)
    assert.deepEqual(harness.editorLayout(), layoutBefore)
    assert.deepEqual(keyboardCommands(harness), [
      'workbench.action.focusFirstEditorGroup',
      'composer.focusComposer',
    ])
  } finally {
    resetFakeClock(context)
    await harness.close()
  }
})

for (const reader of ['study-workspace', 'living-book'] as const)
  // Value: protects=the presentation resource offering an agent only layouts its next select is accepted for; fails_when=the resource lists Living book and Guided walkthrough beside Study workspace, and a select of either is refused as retired; why_new=Cycle 0045 SM-10 (`presentationState` listed all three modes while `selectPresentation` refused two of them); seam=none
  test(`the presentation resource offers only layouts a select accepts: Study workspace, and a retired layout only while the reader is in it (reader in ${reader})`, async () => {
    // Arrange: an earlier version may have saved a layout that is retired now; the reader still opens in it.
    const harness = await workspaceHarness()
    try {
      if (reader === 'living-book') {
        harness.presentationPreferences.set('codebook.presentation.v1', {
          version: 1,
          mode: 'living-book',
        })
        await harness.reader.close()
        harness.useNativeLayout({ orientation: 0, groups: [{}] })
        await harness.reader.open()
      }
      // Act
      const resource = await harness.service.presentationState(
        harness.service.instanceId,
      )
      // Assert
      assert.equal(resource.mode, reader)
      assert.deepEqual(
        resource.modes.map((offered) => offered.mode),
        reader === 'living-book'
          ? ['study-workspace', 'living-book']
          : ['study-workspace'],
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=a run started while the open reader shows a saved study ending before the application gets any input, with the step that makes the next start possible; fails_when=the run is admitted, starts the application and fails about 25 s later at its first capture with "Learner is viewing history; current capture was not displayed.", which names no step; why_new=Cycle 0045 finding OBS-1 (native observation round, and again in owed check 2: run 303345e4 ended after 25.6 s); seam=the recorded reader harness with the real service and reader
test('a run started while the reader shows a saved study is refused before any input and names the return to the current run', async () => {
  // Arrange: the open reader shows a saved study's recording, so it does not follow the current run.
  const harness = await recordedReaderHarness()
  const service = harness.service
  let refused: ReturnType<typeof service.start> | undefined,
    repeated: ReturnType<typeof service.start> | undefined
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const shown = harness.reader.presentationState(),
      runtimesBefore = harness.runtimes.length,
      library = await harness.reader.learningStorage(),
      savedStudiesBefore = await library.savedStudyCount()
    // Act
    refused = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'while-the-reader-shows-a-saved-study',
    })
    const refusedRecord = service.record(refused)
    await refusedRecord.preparation
    await waitUntil(() => refusedRecord.stopped, 'the refused run ended', 1_000)
    // Assert
    assert.equal(shown.state, 'open')
    assert.equal(shown.reader.followingCurrentRun, false)
    assert.equal(shown.reader.contentRevision, 3)
    assert.equal(refusedRecord.error?.code, 'PRESENTATION_UNAVAILABLE')
    assert.equal(
      refusedRecord.error?.message,
      "The run was not started: the reader shows saved history and does not follow the current run (reader.followingCurrentRun is false), so none of this run's captures would be displayed. Call codebook_return_current with expectedRevision 3 (reader.contentRevision), then start again with a new key.",
    )
    // No runtime was created: the application was not started and got no input.
    assert.equal(refusedRecord.runtime, undefined)
    assert.equal(harness.runtimes.length, runtimesBefore)
    // The refused run left nothing behind: no study was saved for it.
    assert.equal(refusedRecord.historyExcluded, 'refused-at-admission')
    assert.equal(await library.savedStudyCount(), savedStudiesBefore)
    assert.equal(savedStudiesBefore, 1)
    // The step the text names makes the next start possible.
    const returned = await harness.reader.returnToCurrent({
      presentationId: shown.presentationId,
      expectedRevision: shown.reader.contentRevision,
    })
    repeated = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'after-the-return-to-the-current-run',
    })
    await service.record(repeated).preparation
    assert.equal(returned.reader.followingCurrentRun, true)
    assert.equal(service.record(repeated).error, undefined)
    assert.equal(service.record(repeated).prepared, true)
    // The status help, which names followingCurrentRun, says the same.
    assert.equal(
      (await service.status()).presentation?.instructions.includes(
        'Before a new run, if reader.contentTab is not live or reader.followingCurrentRun is false, use codebook_return_current with reader.contentRevision as expectedRevision; verify both live and followingCurrentRun true so captured values and explanations are visible. A run started while an open reader has followingCurrentRun false is not started: it ends before any application input and names this step; start again with a new key after it.',
      ),
      true,
    )
  } finally {
    try {
      if (repeated) await service.stop(repeated)
    } finally {
      await harness.close()
    }
  }
})

// Value: protects=the Application pane being in front after a cold selection made from a learner's file that shares its group, with the keyboard focus that file had, and the file still open; fails_when=the selection fronts and focuses the learner's file again, so the Application pane the layout was confirmed for stays hidden behind it; why_new=Cycle 0045 NF-1 as DR-5 (presenting never leaves the Application pane behind a learner's tab; the pane takes the focus only from an editor Codebook knows held it); seam=focusMutableDraft
test("after a cold selection the Application pane is in front of the learner's own file that shares its group, holds the keyboard focus, and that file is still open", async () => {
  // Arrange: the learner types in a file of the first group, where the selection places the Application pane.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    const draft = harness.focusMutableDraft('notes.txt', 1)
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    const applicationGroup = harness.groups.find(
      (group) => group.viewColumn === 1,
    )!
    assert.equal(state.state, 'closed')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(
      applicationGroup.activeTab?.input instanceof
        harness.editor.TabInputWebview,
      true,
    )
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(harness.editor.window.activeTextEditor, undefined)
    assert.equal(applicationGroup.tabs.includes(draft.tab), true)
    assert.equal(draft.tab.isDirty, true)
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
    assert.deepEqual(harness.tabCloseRequests(), [])
  } finally {
    await harness.close()
  }
})

// Value: protects=a selection made from Cursor's chat being arranged when the editor answers the focus command with the first group's text editor as the active text editor and still names the chat's group, and the keyboard going back to the chat without a new editor group; fails_when=the measurement waits for the first group to be named as the active tab group, which Cursor does not do, and refuses after five seconds, or the focus is given back with the focus command of the chat's column, which opens a new empty group in the main editor; why_new=Cycle 0045 cause 12 (d) (obs15 P2: refused after 5.28 s, a new empty group at column 3, the caret not in the chat); seam=workspace harness with a separate editor part whose group the editor names, the fake Cursor's stale group name, its group focus commands and its "Focus Agent" command
test("a selection made from Cursor's chat is arranged when the editor reports the first group's text editor without naming its group, and the chat gets the keyboard back without a new editor group", async () => {
  // Arrange: as the editor API reported it in Cursor: group 1 holds two files (the second one shown, its text editor visible) and a settings page, group 2 is empty, and the editor names the chat's group, whose input has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    const settings = harness.addOpaqueTab('Cursor Settings', 1),
      learnerFile = harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    const firstGroup = harness.groups.find((group) => group.viewColumn === 1)!
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(selected.panes.contextColumn, 3)
    assert.equal(firstGroup.tabs.includes(learnerFile.tab), true)
    assert.equal(firstGroup.tabs.includes(settings), true)
    assert.deepEqual(harness.tabCloseRequests(), [])
    // Three groups of the main editor and the chat's: no group was opened for the focus return, and none is empty.
    assert.equal(harness.groups.length, 4)
    assert.equal(
      harness.groups.some((group) => group.tabs.length === 0),
      false,
    )
    assert.deepEqual(keyboardCommands(harness), [
      'workbench.action.focusFirstEditorGroup',
      'composer.focusComposer',
    ])
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the answer an agent gets for its own select from the chat reading confirmed; fails_when=the answer is read after the focus return changed the editor groups, or the read that follows the select cannot measure the grid from the chat and answers layoutConfirmed false with "Main editor layout could not be checked without changing focus. …", which the agent relays to the learner; why_new=Cycle 0045 cause 12 (d) (obs15 P1: the select arranged the three panes and answered layoutConfirmed false with that reason and no layoutMeasured member); seam=the service's selectPresentation on the workspace harness with a separate editor part that has the keyboard
test("the answer to a selection made from Cursor's chat input reads the layout as confirmed and says that the grid was not measured again", async () => {
  // Arrange: the chat input has the keyboard while the editor names the learner's file of group 1 without an active text editor.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.replaceGroupObjectsOnTabChanges()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    chat.focus()
    const state = harness.reader.presentationState()
    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(answer.state, 'open')
    assert.equal(answer.layoutConfirmed, true)
    assert.equal(answer.layoutMeasured, false)
    assert.equal(answer.reason, undefined)
    assert.equal(answer.panes.appColumn, 1)
    assert.equal(answer.panes.sourceColumn, 2)
    assert.equal(answer.panes.contextColumn, 3)
    assert.equal(harness.groups.length, 4)
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when an agent selects the Study workspace through codebook_presentation while VS Code's chat view (or Cursor's chat in the side bar) has it: the placement needs the captured source's focus, and afterwards no file the learner is not known to work in gets the keyboard; the learner is told once that the captured source has it; fails_when=the selection's focus return shows the learner's active file with the keyboard, so the chat input the request was typed in loses its keyboard to that file without a word; why_new=Cycle 0046 row 613; seam=useNativeLayout, focusMutableDraft, focusView (the chat view's input, which the editor does not report), the service's selectPresentation (the codebook_presentation tool's handler), textDocumentShows, focusedSource and the information messages
test('an agent’s Study selection made while the chat view has the keyboard gives no learner’s file the keyboard and says once that the captured source has it', async () => {
  // Arrange: the learner's notes stand in the second group and readme.md is the active editor of the third; then the learner typed the request into the chat view.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length
    const state = harness.reader.presentationState()

    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: no learner's file was shown with the keyboard, the captured source has it, and the sentence says so; the Study stands confirmed.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus)
        .map((shown) => shown.name),
      ['Captured-overview.mts'],
    )
    assert.equal(
      harness
        .focusedSource()
        ?.document.uri.path.endsWith('/Captured-overview.mts'),
      true,
    )
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Codebook arranged the Study workspace an agent asked for, and its captured source has the keyboard now: placing the panes needed the focus of the source, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
    assert.equal(answer.layoutConfirmed, true)
  } finally {
    await harness.close()
  }
})

for (const failure of [
  {
    holder: 'the Application pane',
    paneTakingKeyboard: 'app',
    focusedPanel: 'codebook.scopedBrowser',
    focusedSourceIsCaptured: false,
    sentence:
      'Codebook could not finish the Study arrangement an agent asked for, and the Application pane has the keyboard now. This editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat before: click where you want to type.',
  },
  {
    holder: 'the Study pane',
    paneTakingKeyboard: 'contextPanel',
    focusedPanel: 'codebook.studyContext',
    focusedSourceIsCaptured: false,
    sentence:
      'Codebook could not finish the Study arrangement an agent asked for, and the Study pane has the keyboard now. This editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat before: click where you want to type.',
  },
  {
    holder: 'the captured source',
    paneTakingKeyboard: undefined,
    focusedPanel: undefined,
    focusedSourceIsCaptured: true,
    sentence:
      'Codebook arranged the Study workspace an agent asked for, and its captured source has the keyboard now: placing the panes needed the focus of the source, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
  },
] as const)
  // Value: protects=the learner told where the keyboard is when an agent's Study selection (codebook_presentation) fails after its placement focused the captured source, while VS Code's chat view had the keyboard: no learner's file gets the keyboard (row 613's rule holds on the failure path too), and the one sentence names the place that has it now, the captured source, the Application pane or the Study pane; fails_when=the failure path tells the captured source's sentence ("… its captured source has the keyboard now …") without reading where the keyboard is, so a learner whose Application or Study pane took it is sent to the wrong place; why_new=Cycle 0046 row 634 (CodeRabbit on 2d7d660c..dc60b8f6, performPresentation's catch path and keepsKeyboardAfterAgentSelection); seam=useNativeLayout, changeEditorLayout (an unconfirmed Study layout), focusMutableDraft, focusChatInSecondarySideBar, holdNextCommand and failNextCommand on vscode.setEditorLayout, a pane's reveal with the keyboard while that command is pending, the service's selectPresentation, focusedPanel, focusedSource, textDocumentShows and the information messages
  test(`an agent’s Study selection that fails after its placement while ${failure.holder} has the keyboard gives no learner’s file the keyboard and says once that ${failure.holder} has it`, async () => {
    // Arrange: the Study workspace is open; the learner resized its panes, went back to actions.ts in the first group, and typed the request into VS Code's chat view. The editor will give ${failure.holder} the keyboard while the placement's layout command is pending, and then refuse that command.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await harness.reader.open()
      harness.focusMutableDraft('actions.ts', 1)
      harness.changeEditorLayout({
        orientation: 0,
        groups: [
          { size: 0.7, groups: [{ size: 0.3 }, { size: 0.7 }] },
          { size: 0.3 },
        ],
      })
      const unconfirmed = await harness.reader.readPresentationState()
      harness.focusChatInSecondarySideBar()
      const showsBefore = harness.textDocumentShows().length,
        messagesBefore = harness.informationMessages.length
      harness.failNextCommand('vscode.setEditorLayout')
      const layoutCommand = harness.holdNextCommand('vscode.setEditorLayout')

      // Act
      let refusal: unknown
      const selecting = harness.service
        .selectPresentation({
          instanceId: harness.service.instanceId,
          presentationId: unconfirmed.presentationId,
          expectedRevision: unconfirmed.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        })
        .catch((error: unknown) => {
          refusal = error
        })
      await layoutCommand.started
      if (failure.paneTakingKeyboard)
        harness.reader[failure.paneTakingKeyboard]!.reveal(undefined, false)
      layoutCommand.release()
      await selecting

      // Assert: the selection was refused; the only document shown with the keyboard is the captured source the placement needed, and the sentence names the place that has the keyboard now.
      assert.deepEqual(
        {
          refusal: String(refusal),
          focusedPanel: harness.focusedPanel(),
          focusedSourceIsCaptured: Boolean(
            harness
              .focusedSource()
              ?.document.uri.path.endsWith('/Captured-overview.mts'),
          ),
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
          refusal:
            'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
          focusedPanel: failure.focusedPanel,
          focusedSourceIsCaptured: failure.focusedSourceIsCaptured,
          shownWithKeyboard: ['Captured-overview.mts'],
          messages: [failure.sentence],
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner's own Study selection that fails after its placement focused the captured source: the failure path still gives the learner's file the keyboard back, as it did before row 634 changed the agent's failure path; fails_when=the agent's rule (no unproven file gets the keyboard) or its sentence reaches the learner's own failed selection; why_new=Cycle 0046 row 634 (the learner's half); seam=useNativeLayout, changeEditorLayout, focusMutableDraft, failNextCommand on vscode.setEditorLayout, the reader's changePresentation (the learner's control), the active text editor and the information messages
test('a learner’s own Study selection that fails after its placement gives the learner’s file its keyboard back and tells nothing', async () => {
  // Arrange: the Study workspace is open; the learner resized its panes and works in actions.ts in the first group. The editor will refuse the placement's layout command.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    harness.focusMutableDraft('actions.ts', 1)
    harness.changeEditorLayout({
      orientation: 0,
      groups: [
        { size: 0.7, groups: [{ size: 0.3 }, { size: 0.7 }] },
        { size: 0.3 },
      ],
    })
    const unconfirmed = await harness.reader.readPresentationState()
    const messagesBefore = harness.informationMessages.length
    harness.failNextCommand('vscode.setEditorLayout')

    // Act
    let refusal: unknown
    await harness.reader
      .changePresentation({
        presentationId: unconfirmed.presentationId,
        expectedRevision: unconfirmed.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      .catch((error: unknown) => {
        refusal = error
      })

    // Assert: refused, actions.ts has the keyboard again, and nothing is told.
    assert.deepEqual(
      {
        refusal: String(refusal),
        activeTextEditor:
          harness.editor.window.activeTextEditor?.document.uri.path
            .split('/')
            .at(-1),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        refusal:
          'Error: The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
        activeTextEditor: 'actions.ts',
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's keyboard when an agent selects the Study workspace right after Developer: Reload Window, with the earlier window's empty Application group still the active group and the chat view holding the keyboard: no editor group is focused after the placement and the learner is told once that the captured source has the keyboard; fails_when=the selection's focus return focuses the active editor group it captured (the empty leftover's), taking the keyboard from the chat input without a word; why_new=Cycle 0046 row 613 (with a reload: row 608's path); seam=applicationGroupMarkers, leaveEmptyLockedGroup, focusMutableDraft, the editor's focusFirstEditorGroup (the learner's last click into the empty group), focusView (the chat view's input), the service's selectPresentation, the command log, focusedSource and the information messages
test('an agent’s Study selection right after a reload while the chat view has the keyboard focuses no editor group afterwards and says once that the captured source has it', async () => {
  // Arrange: the earlier window recorded its Application group at column 1; after the reload it stands empty, locked and active beside the learner's notes in column 2 and readme.md in column 3, and the learner typed the request into the chat view.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
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
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    await harness.editor.commands.executeCommand(
      'workbench.action.focusFirstEditorGroup',
    )
    harness.focusView()
    const commandsBefore = harness.commands.length
    const state = harness.reader.presentationState()

    // Act
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: no focus command ran after the placement, the captured source has the keyboard, and the sentence says so.
    assert.deepEqual(
      harness.commands
        .slice(commandsBefore)
        .filter((command) => /^workbench\.action\.focus/.test(command)),
      [],
    )
    assert.equal(
      harness
        .focusedSource()
        ?.document.uri.path.endsWith('/Captured-overview.mts'),
      true,
    )
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Codebook arranged the Study workspace an agent asked for, and its captured source has the keyboard now: placing the panes needed the focus of the source, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own Study selection (the Study pane's control or a command) while a side view has the keyboard: as before row 613, the keyboard goes back to the learner's active file after the placement and nothing is told; fails_when=row 613's rule for an agent's selection also withholds the keyboard from a learner who selected the Study workspace themselves; why_new=Cycle 0046 row 613 (its bound: only an agent's request is treated so); seam=useNativeLayout, focusMutableDraft, focusView, the reader's changePresentation (the learner's path), textDocumentShows and the information messages
test('a learner’s own Study selection gives the keyboard back to the learner’s active file as before and tells nothing', async () => {
  // Arrange: the learner's notes stand in the second group and readme.md is the active editor of the third; a side view has the keyboard.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length
    const state = harness.reader.presentationState()

    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus)
        .map((shown) => shown.name),
      ['Captured-overview.mts', 'learner-readme.md'],
    )
    assert.equal(
      harness.focusedSource()?.document.uri.path.endsWith('/learner-readme.md'),
      true,
    )
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat input's keyboard in an agent's cold order (select, Return Current, start) in VS Code: the Return Current that enters the live arrangement prepares its Application group as an agent's, and where that preparation had to focus an editor group the learner is told once that the new group has the keyboard; fails_when=the Return's preparation takes the chat view's keyboard with the first group's focus command and nothing tells the learner, because a Live Return keeps the final handoff for itself; why_new=Cycle 0046 finding on codebook_return_current; seam=useNativeLayout, focusMutableDraft, focusView (the chat view's input), the service's selectPresentation and returnToCurrent (the codebook_presentation and codebook_return_current handlers), textDocumentShows and the information messages
test('an agent’s Return Current after its own Study selection, made while the chat view has the keyboard, gives no file the keyboard and says once that the Application’s group has it', async () => {
  // Arrange: the agent selected the Study workspace from the chat view, and the learner typed the next request there again.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusView()
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.focusView()
    const state = harness.reader.presentationState(),
      showsBefore = harness.textDocumentShows().length,
      messagesBefore = harness.informationMessages.length

    // Act
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })

    // Assert: no document was shown with the keyboard, and the sentence says that the new Application group has it.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's knowledge of where the keyboard is when an agent selects the Study workspace while VS Code's chat editor tab (Chat: Open Chat in Editor) has the keyboard in a group the Study's panes then cover: the chat tab cannot be given its keyboard back without uncovering it, so the captured source keeps the keyboard the placement needed and the learner is told once; fails_when=the selection, having remembered a foreign tab, skips row 613's sentence and its return to that tab finds the tab behind a Study pane, so the keyboard moves to the captured source without a word; why_new=Cycle 0046 row 625; seam=useNativeLayout, focusMutableDraft, focusChatEditorTab, the service's selectPresentation (codebook_presentation), focusedSource and the information messages
test('an agent’s Study selection that covers the group of VS Code’s chat editor tab says once that the captured source has the keyboard', async () => {
  // Arrange: notes stand in the second group and readme.md in the third, where the learner typed the request into the chat opened as an editor tab.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    harness.focusChatEditorTab(3)
    const state = harness.reader.presentationState()

    // Act
    const answer = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })

    // Assert: the Study pane stands in front of the chat's group, the captured source has the keyboard, and the sentence says so.
    assert.equal(answer.layoutConfirmed, true)
    assert.equal(harness.panelColumn('codebook.studyContext'), 3)
    assert.equal(
      harness
        .focusedSource()
        ?.document.uri.path.endsWith('/Captured-overview.mts'),
      true,
    )
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Codebook arranged the Study workspace an agent asked for, and its captured source has the keyboard now: placing the panes needed the focus of the source, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=VS Code's chat editor tab keyboard in an agent's cold order (select, Return Current): the Return's preparation focuses the first group to place the Application, and the Return's own end gives the chat tab, in front of its group behind the new Application group, its keyboard back; no sentence says that the Application's group has the keyboard; fails_when=the preparation tells row 612's sentence ("that group has the keyboard now") and the Return then gives the chat tab the keyboard, so the learner is told the opposite of where the keyboard is; why_new=Cycle 0046 row 625; seam=useNativeLayout, focusMutableDraft, focusChatEditorTab and focusOpaqueTab (the learner clicking the chat tab again, in front of the Study pane), the service's selectPresentation and returnToCurrent (codebook_presentation, codebook_return_current), the active tab group and the information messages
test('an agent’s Return Current while VS Code’s chat editor tab has the keyboard gives that chat tab its keyboard back without saying that the Application’s group has it', async () => {
  // Arrange: the agent selected the Study from the chat opened as an editor tab of the third group, and the learner clicked the chat tab and typed the next request there.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    const chat = harness.focusChatEditorTab(3)
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.focusOpaqueTab(chat)
    const state = harness.reader.presentationState(),
      messagesBefore = harness.informationMessages.length

    // Act
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })

    // Assert: the Application stands in its own group at column 1, the chat tab's group (now column 4) has the keyboard with the chat in front, and nothing was told.
    const active = harness.editor.window.tabGroups.activeTabGroup
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
    assert.equal(active.viewColumn, 4)
    assert.equal(active.activeTab, chat)
    assert.equal(harness.focusedSource(), undefined)
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's knowledge of where the keyboard is when an agent's Return Current cannot give VS Code's chat editor tab its keyboard back, because the live arrangement shows the captured source in front of the chat's group (the group directly below the Application's own): the Return's end tells once where the keyboard is, as row 614 does; fails_when=row 625 defers the preparation's sentence to the Return's end and drops it when the chat gets nothing back; why_new=Cycle 0046 row 625 guard; seam=useNativeLayout, focusMutableDraft, focusChatEditorTab and focusOpaqueTab, the service's selectPresentation and returnToCurrent, the active tab group and the information messages
test('an agent’s Return Current whose live arrangement covers the group of VS Code’s chat editor tab says once that the Application’s group has the keyboard', async () => {
  // Arrange: the learner typed the requests into the chat opened as an editor tab of the first group, in front of article-source.ts; the Study's selection covered it with the Application pane, and the learner brought it to the front again. The live arrangement shows the captured source in that group, directly below the Application's own group.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    harness.leaveEmptyGroup(2)
    harness.focusMutableDraft('learner-notes.ts', 2)
    harness.focusMutableDraft('learner-readme.md', 3)
    const chat = harness.focusChatEditorTab(1)
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.focusOpaqueTab(chat)
    const state = harness.reader.presentationState(),
      messagesBefore = harness.informationMessages.length

    // Act
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })

    // Assert: the new Application group, added above the chat's group without another group's focus, has the keyboard, and row 614's sentence says that an editor tab's keyboard went there.
    const active = harness.editor.window.tabGroups.activeTabGroup
    assert.equal(active.viewColumn, 1)
    assert.notEqual(active.activeTab, chat)
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group. If you were typing in a file or another editor tab, that group has the keyboard now: click there to type again. If you were typing in the chat, the terminal or another view, the keyboard is still there.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's second group and the one-tab-per-capture rule when an agent's Study selection is followed by its Return Current beside two learner groups: the selection shows the captured source in front of the learner's second group (column 2), and the Return inserts the Application's own group above the first and shows the source again directly below the Application (the first learner group, now column 2); the copy the Study left in the second group (now column 3) is closed, so that group shows the learner's auth.ts again, and Close still returns both groups exactly; fails_when=the Return leaves the Study's Source tab in front of the second group, so the same capture is shown twice and covers auth.ts until Close (Cycle 0046 C56 1a natively in VS Code 1.140.0: layout 229/229/229 with [Application], [actions.ts … Captured-login-form.tsx], [auth.ts, Captured-login-form.tsx]); why_new=Cycle 0046 row 627; seam=useNativeLayout with two learner groups (leaveEmptyGroup, focusMutableDraft), addSeparateEditorPart and focusTab for Cursor's chat part, the service's selectPresentation and returnToCurrent (the codebook_presentation and codebook_return_current handlers), harness.groups, Close
for (const host of ['VS Code', 'Cursor'] as const)
  test(`an agent’s Return Current after its Study selection beside two learner groups shows the captured source once, below the Application, and gives the second group its own front tab back (${host})`, async () => {
    // Arrange: the learner's groups G1 [actions.ts] and G2 [auth.ts, a draft whose caret is on line 8]; in Cursor its chat tab, in a separate editor part, has the keyboard.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    try {
      harness.leaveEmptyGroup(1)
      harness.leaveEmptyGroup(2)
      const auth = harness.focusMutableDraft('auth.ts', 2)
      const caret = auth.editor.selections[0]!
      auth.editor.selections = [
        { anchor: caret.anchor.with(7, 0), active: caret.active.with(7, 0) },
      ]
      harness.focusMutableDraft('actions.ts', 1)
      const chat =
        host === 'Cursor' ? harness.addSeparateEditorPart() : undefined
      if (host === 'Cursor') harness.leavePaneFocusUnreportedBesideChat()
      chat?.focusTab()
      const selection = harness.reader.presentationState()
      await harness.service.selectPresentation({
        instanceId: harness.service.instanceId,
        presentationId: selection.presentationId,
        expectedRevision: selection.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      chat?.focusTab()
      const state = harness.reader.presentationState()

      // Act
      await harness.service.returnToCurrent({
        instanceId: harness.service.instanceId,
        presentationId: state.presentationId,
        expectedRevision: state.reader.contentRevision,
      })
      const afterReturn = harness.groups.map((group) => ({
        column: group.viewColumn,
        tabs: group.tabs.map((tab) =>
          'uri' in tab.input
            ? `${tab === group.activeTab ? '*' : ''}${tab.input.uri.path.split('/').at(-1)}`
            : `${tab === group.activeTab ? '*' : ''}${'viewType' in tab.input ? tab.input.viewType : 'chat'}`,
        ),
      }))
      const authCaretAfterReturn = auth.editor.selections[0]!.active.line
      await harness.close()

      // Assert: the Application above the captured source, which is shown once; the second learner group shows auth.ts in front with its caret, and Close returns both groups.
      assert.deepEqual(afterReturn, [
        { column: 1, tabs: ['*codebook.scopedBrowser'] },
        { column: 2, tabs: ['actions.ts', '*Captured-overview.mts'] },
        { column: 3, tabs: ['*auth.ts'] },
        ...(host === 'Cursor' ? [{ column: 4, tabs: ['*chat'] }] : []),
      ])
      assert.equal(authCaretAfterReturn, 7)
      assert.equal(auth.document.getText(), 'Original learner draft.\n')
      assert.deepEqual(
        harness.groups.map((group) =>
          group.tabs.map((tab) =>
            'uri' in tab.input ? tab.input.uri.path.split('/').at(-1) : 'chat',
          ),
        ),
        [['actions.ts'], ['auth.ts'], ...(host === 'Cursor' ? [['chat']] : [])],
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the chat input's keyboard in VS Code when an agent starts a run right after its own Study selection, without Return Current: the reader's next refresh (every 250 ms, well before the run's Application viewport) enters the Live arrangement as the agent's run, so no file gets the keyboard and the learner is told once that the new Application group has it; fails_when=that entry prepares the Application as the learner's and its focus return shows the captured source, the active text editor, with the keyboard, and nothing tells the learner; why_new=Cycle 0046 finding on codebook_start (the reader's own Live entry of a run); seam=useNativeLayout, focusMutableDraft, focusView (the chat view's input), the service's selectPresentation and start (the codebook_presentation and codebook_start handlers), the reader's refresh as its timer runs it, textDocumentShows and the information messages
test('an agent’s run started right after its own Study selection, while the chat view has the keyboard, enters Live with no file given the keyboard and says once that the Application’s group has it', async () => {
  // Arrange: the agent selected the Study workspace from the chat view, and the learner typed the next request there again.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusView()
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.focusView()
    const showsBefore = harness.textDocumentShows().length,
      messagesBefore = harness.informationMessages.length
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation

    // Act: the reader's timer refreshes before the run creates its Application viewport.
    await readerSeams(harness).refresh()

    // Assert: no document was shown with the keyboard, and the sentence says that the new Application group has it.
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the chat view's keyboard in VS Code when an agent's Return Current (codebook_return_current) meets a run the reader has not entered yet: the Return's own refresh enters the Live arrangement of that run, and that entry follows the Return's requester, so it is the agent's: no file gets the keyboard and the learner is told once that the new Application group has it; fails_when=the reader's Live entry inside a running Return ignores who asked for the Return and prepares the Application as the learner's, whose preparation adds no focus return of its own, so nothing tells the learner where the keyboard went; why_new=Cycle 0046 row 623 (commit 60bf03d8 made that entry follow the Return's requester without a test reaching it); seam=readerSeams stopOwnTimer (only the Return's own refresh runs), useNativeLayout, focusMutableDraft, focusView (the chat view's input), the service's selectPresentation, start and returnToCurrent (the codebook_presentation, codebook_start and codebook_return_current handlers), textDocumentShows and the information messages
test('an agent’s Return Current that meets a run the reader has not entered yet enters it as the agent’s, giving no file the chat view’s keyboard and saying once that the Application’s group has it', async () => {
  // Arrange: the agent selected the Study workspace from the chat view and started a run; the reader's own refresh has not entered it.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  readerSeams(harness).stopOwnTimer()
  try {
    harness.leaveEmptyGroup(1)
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusView()
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    harness.focusView()
    const state = harness.reader.presentationState(),
      showsBefore = harness.textDocumentShows().length,
      messagesBefore = harness.informationMessages.length

    // Act
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: state.presentationId,
      expectedRevision: state.reader.contentRevision,
    })

    // Assert: the run is the one the reader follows now, no document was shown with the keyboard, and the agent's sentence was told once.
    assert.equal(harness.reader['liveEntryRunId'], receipt.runId)
    assert.deepEqual(
      harness
        .textDocumentShows()
        .slice(showsBefore)
        .filter((shown) => !shown.preserveFocus),
      [],
    )
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Codebook opened its Application pane in a new editor group, and that group has the keyboard now: placing the pane needed the focus of an editor group, and this editor does not tell Codebook whether you were typing in a file, the terminal, a view or the chat. Click where you want to type.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner's own Return to current pause, run while the Study pane has the keyboard, when it meets a run the reader has not entered yet (the learner reads the Overview tab while following, so an agent's run is accepted and the reader's refresh does not enter it): the Return's own refresh enters the Live arrangement of that run as the learner's, so the agent's rule beside a chat view is not applied to the learner's own request and only the learner's sentence is told; fails_when=the reader's Live entry inside a running Return ignores who asked for the Return and treats every such entry as the agent's run, so the learner is also told the agent's sentence that this editor does not say where they were typing; why_new=Cycle 0046 row 623 (the other requester of the same entry); seam=readerSeams stopOwnTimer (only the Return's own refresh runs), the Study pane's tab message, the service's start (codebook_start), the Study pane's pane-focus report, the return-current action (the command Codebook: Return to Current Pause) and the information messages
test('the learner’s Return to current pause from the Study pane that meets a run the reader has not entered yet enters it as the learner’s and tells only the learner’s sentence', async () => {
  // Arrange: the learner follows the current run on the Overview tab of the Study pane when the agent starts a run, and the Study pane has the keyboard.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  readerSeams(harness).stopOwnTimer()
  try {
    await harness.reader.open()
    harness.receiveContext({
      type: 'tab',
      tab: 'overview',
      revision: harness.reader.inspect().view!.revision,
    })
    await waitUntil(
      () => harness.reader.presentationState().reader.contentTab === 'overview',
      'the Overview tab the learner chose',
    )
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    harness.receiveContext({ type: 'pane-focus', focused: true })
    const messagesBefore = harness.informationMessages.length

    // Act: the learner runs Return to Current Pause while the Study pane has the keyboard.
    await harness.reader.action('return-current')

    // Assert: the run is the one the reader follows now, and only the learner's sentence was told.
    assert.equal(harness.reader['liveEntryRunId'], receipt.runId)
    assert.deepEqual(
      harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
      [
        'Return to current pause closed the Study pane, which had the keyboard, to arrange the live run. The active editor group has the keyboard now (the Application pane’s, once it is placed). Click where you want to type.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who presses Return to current pause in the Study pane while it has the keyboard: the live arrangement closes that pane, so its keyboard would be on no element (a key pressed then goes nowhere) with the new Application group named as the active one; the keyboard is given to that group and the learner is told once where it is; fails_when=a learner's Live Return adds no focus return of its own (returnPreparationFocus returns at once for it, finishCurrentReturn gives the keyboard back only to a foreign tab), so the keyboard stays on the page body and nothing is told; why_new=Cycle 0046 row 624; seam=the workspace harness in VS Code's model (one editor part) and in Cursor's (addSeparateEditorPart), the Study pane's pane-focus report, the pane's return-current action, keyboardOnBody, focusedPanel and the information messages
for (const host of ['VS Code', 'Cursor'] as const)
  test(`Return to current pause pressed in the Study pane in ${host} gives the Application's group the keyboard the closed Study pane had and says so once`, async () => {
    // Arrange: the learner reads a saved item while a run is current, and the Study pane has the keyboard.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    if (host === 'Cursor') harness.addSeparateEditorPart()
    try {
      await harness.reader.open()
      await harness.reader.select('repository/workspace/overview')
      await harness.reader.action('focus-context')
      harness.receiveContext({ type: 'pane-focus', focused: true })
      const messagesBefore = harness.informationMessages.length

      // Act: the learner presses Return to current pause in the Study pane.
      await harness.reader.action('return-current', true)

      // Assert: the Study pane is gone, the Application's group has the keyboard, and the sentence says so once.
      assert.deepEqual(
        {
          studyPaneOpen: Boolean(harness.reader['contextPanel']),
          keyboardOnBody: harness.keyboardOnBody(),
          activeTab: harness.focusedPanel(),
          messages: harness.informationMessages
            .slice(messagesBefore)
            .map((message) => message.message),
        },
        {
          studyPaneOpen: false,
          keyboardOnBody: false,
          activeTab: 'codebook.scopedBrowser',
          messages: [
            'Return to current pause closed the Study pane, which had the keyboard, to arrange the live run. The active editor group has the keyboard now (the Application pane’s, once it is placed). Click where you want to type.',
          ],
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner whose Return to current pause, pressed in the Study pane while it had the keyboard, is refused after the live arrangement already closed that pane (here the editor rejects the new Application group): the keyboard the closed pane had would be on no element, so the Return's end still gives the active editor group the keyboard and tells once where it is, as the Return that succeeds does; fails_when=only a Return that succeeds settles the learner's place (the refusal skips settleLearnersReturnKeyboard), so after the refusal the keyboard stays on the page body and nothing is told; why_new=Cycle 0046 row 629 (row 624's refusal branch had no test); seam=the workspace harness in VS Code's and Cursor's models, failNextCommand (the editor rejects workbench.action.newGroupAbove), the Study pane's pane-focus report, the pane's return-current action, keyboardOnBody, the command log and the information messages
for (const host of ['VS Code', 'Cursor'] as const)
  test(`Return to current pause pressed in the Study pane in ${host} and refused after it closed that pane gives the active editor group the keyboard and says so once`, async () => {
    // Arrange: the learner reads a saved item while a run is current, and the Study pane has the keyboard; the editor will reject the Application's new group.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    if (host === 'Cursor') harness.addSeparateEditorPart()
    try {
      await harness.reader.open()
      await harness.reader.select('repository/workspace/overview')
      await harness.reader.action('focus-context')
      harness.receiveContext({ type: 'pane-focus', focused: true })
      const messagesBefore = harness.informationMessages.length,
        commandsBefore = harness.commands.length
      harness.failNextCommand('workbench.action.newGroupAbove')

      // Act: the learner presses Return to current pause in the Study pane.
      let refusal: unknown
      await harness.reader
        .action('return-current', true)
        .catch((error: unknown) => {
          refusal = error
        })

      // Assert: the Return was refused after the Study pane closed; the active editor group got the keyboard as the last command, and the sentence says so once.
      assert.deepEqual(
        {
          refusal: String(refusal),
          studyPaneOpen: Boolean(harness.reader['contextPanel']),
          lastCommand: harness.commands.slice(commandsBefore).at(-1),
          keyboardOnBody: harness.keyboardOnBody(),
          messages: harness.informationMessages
            .slice(messagesBefore)
            .map((message) => message.message),
        },
        {
          refusal: 'Error: Native layout command failed',
          studyPaneOpen: false,
          lastCommand: 'workbench.action.focusActiveEditorGroup',
          keyboardOnBody: false,
          messages: [
            'Return to current pause closed the Study pane, which had the keyboard, to arrange the live run. The active editor group has the keyboard now (the Application pane’s, once it is placed). Click where you want to type.',
          ],
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the learner who presses Return to current pause in the Observed moments view of the bottom panel, which outlives the Study pane the live arrangement closes: that view gets its keyboard back with its own focus command (VS Code 1.140.0 workbench.desktop.main.js 1639:157156: the view's focus command opens it with the focus unless asked to keep it), and nothing is told; fails_when=in Cursor's model the Application group's preparation focused the first editor group, which took the view's keyboard, and the Return gives it back to no one, so it ends on the page body without a word; why_new=Cycle 0046 row 624 (the Return control the learner pressed still exists there); seam=the workspace harness in VS Code's and Cursor's models, the bottom view's pane-focus report, focusView (a view that is no editor has the keyboard), viewFocusCommands and the information messages
for (const host of ['VS Code', 'Cursor'] as const)
  test(`Return to current pause pressed in the Observed moments view in ${host} gives that view its keyboard back and tells nothing`, async () => {
    // Arrange: the learner reads a saved item while a run is current, opened Observed moments in the bottom panel and clicked into it.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    if (host === 'Cursor') harness.addSeparateEditorPart()
    try {
      await harness.reader.open()
      await harness.reader.select('repository/workspace/overview')
      await harness.editor.commands.executeCommand(
        'codebook.observedMoments.focus',
      )
      harness.focusView()
      harness.receivePlaybackPanel({ type: 'pane-focus', focused: true })
      const viewFocusBefore = harness.viewFocusCommands.length,
        messagesBefore = harness.informationMessages.length

      // Act: the learner presses Return to current pause in Observed moments.
      await harness.reader.action('return-current', true)

      // Assert: the Study pane is gone, the view's focus command ran once with the focus, and nothing is told.
      assert.deepEqual(
        {
          studyPaneOpen: Boolean(harness.reader['contextPanel']),
          viewFocusCommands: harness.viewFocusCommands.slice(viewFocusBefore),
          messages: harness.informationMessages
            .slice(messagesBefore)
            .map((message) => message.message),
        },
        {
          studyPaneOpen: false,
          viewFocusCommands: [
            {
              command: 'codebook.observedMoments.focus',
              preserveFocus: false,
            },
          ],
          messages: [],
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the main editor's grid when the chat cannot be given the keyboard back: in an editor without Cursor's "Focus Agent" command the focus stays where the arrangement ended and no group is opened; fails_when=the focus command of the other editor part's column is run, which opens a new empty group in the main editor; why_new=Cycle 0045 cause 12 (d) (the numbered focus commands count the main editor's groups only); seam=workspace harness with a separate editor part, removeHostCommands
test('a selection made while another editor part holds the keyboard, in an editor without a command that focuses that part, leaves the focus where the arrangement ended and opens no editor group', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.removeHostCommands('composer.focusComposer')
  try {
    harness.focusMutableDraft('actions.ts', 1)
    chat.focus()
    const state = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(harness.groups.length, 4)
    assert.deepEqual(keyboardCommands(harness), [
      'workbench.action.focusFirstEditorGroup',
    ])
    // The keyboard is on the captured source the arrangement placed last.
    assert.equal(chat.focused(), false)
    assert.equal(harness.editor.window.activeTextEditor?.viewColumn, 2)
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's restore, or its second selection, right after its own selection from Cursor's chat being answered confirmed, with the keyboard left in the chat input and nothing arranged again; fails_when=the restore is refused with "… the focused tab "Captured-login-form.tsx" in editor group 2 has no text editor, so the focus could not be given back to it. …" because the editor names the reader's own captured source without an active text editor while the chat input has the keyboard; why_new=Cycle 0045 cause 12 (g) (obs15 R, a2-restore: refused after 172 ms; an agent that calls select and then restore got this); seam=workspace harness with a separate editor part that holds the keyboard, the fake Cursor's stale group name and its command log
for (const action of ['restore', 'select'] as const)
  test(`a ${action === 'restore' ? 'restore' : 'second selection'} made from Cursor's chat right after its own selection answers the confirmed layout and leaves the keyboard in the chat`, async () => {
    // Arrange: as the editor API reported it in Cursor after a selection made from the chat input: the three panes are arranged, the chat input has the keyboard again, and the editor names the reader's own captured source in group 2, whose text editor is visible, without an active text editor.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    try {
      harness.focusMutableDraft('actions.ts', 1)
      chat.focus()
      const closed = harness.reader.presentationState()
      const selected = await harness.reader.changePresentation({
        presentationId: closed.presentationId,
        expectedRevision: closed.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      const named = harness.editor.window.tabGroups.activeTabGroup,
        namedInput: unknown = named.activeTab?.input
      const stateBefore = {
        namedColumn: named.viewColumn,
        namedTabIsCapturedSource:
          namedInput instanceof harness.editor.TabInputText &&
          namedInput.uri.scheme === 'codebook-source',
        hasActiveTextEditor:
          harness.editor.window.activeTextEditor !== undefined,
        sourceEditorVisibleInColumn: harness.editor.window.visibleTextEditors
          .filter((editor) => editor.document.uri.scheme === 'codebook-source')
          .map((editor) => editor.viewColumn),
        chatHasKeyboard: chat.focused(),
      }
      const commandsBefore = harness.commands.length,
        tabsBefore = harness.groups.map((group) => [...group.tabs])
      // Act
      const restored = await harness.reader.changePresentation({
        presentationId: selected.presentationId,
        expectedRevision: selected.presentationControlRevision,
        mode: 'study-workspace',
        action,
      })
      // Assert
      assert.deepEqual(stateBefore, {
        namedColumn: 2,
        namedTabIsCapturedSource: true,
        hasActiveTextEditor: false,
        sourceEditorVisibleInColumn: [2],
        chatHasKeyboard: true,
      })
      assert.equal(selected.layoutConfirmed, true)
      assert.equal(restored.state, 'open')
      assert.equal(restored.layoutConfirmed, true)
      // The grid cannot be measured from the chat without taking its keyboard: the answer repeats the selection's confirmation and says so.
      assert.equal(restored.layoutMeasured, false)
      assert.equal(restored.reason, undefined)
      assert.equal(restored.panes.appColumn, 1)
      assert.equal(restored.panes.sourceColumn, 2)
      assert.equal(restored.panes.contextColumn, 3)
      // One layout read, as a status read makes it: nothing was arranged, focused or closed.
      assert.deepEqual(harness.commands.slice(commandsBefore), [
        'vscode.getEditorLayout',
      ])
      assert.deepEqual(
        harness.groups.map((group) => [...group.tabs]),
        tabsBefore,
      )
      assert.deepEqual(harness.tabCloseRequests(), [])
      assert.equal(chat.focused(), true)
    } finally {
      await harness.close()
    }
  })

// Value: protects=an agent's restore from Cursor's chat being admitted and arranged when the learner resized the panes since its selection, while the editor names the reader's own captured source without an active text editor, and the chat having the keyboard again afterwards; fails_when=the reader's own current captured source is refused like a leftover one that no text editor shows ("… has no text editor, so the focus could not be given back to it. …"), which only a click into an editor clears, and an agent cannot click; why_new=Cycle 0045 cause 12 (g) (obs15 R, a2-restore); seam=workspace harness with a separate editor part that holds the keyboard, changeEditorLayout
test("a restore made from Cursor's chat after the learner resized the panes arranges them again while the editor names the reader's captured source without an active text editor", async () => {
  // Arrange: a selection from the chat input arranged the three panes; the learner then clicked into the captured source and dragged two sashes, a status read saw the changed grid, and the learner went back to the chat input, so the editor names the captured source in group 2 without an active text editor.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
  harness.groups.at(-1)!.tabs = []
  harness.groups.at(-1)!.activeTab = undefined
  const chat = harness.addSeparateEditorPart()
  harness.leavePaneFocusUnreportedBesideChat()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    chat.focus()
    const closed = harness.reader.presentationState()
    const selected = await harness.reader.changePresentation({
      presentationId: closed.presentationId,
      expectedRevision: closed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    const source = harness.editor.window.visibleTextEditors.find(
      (editor) => editor.document.uri.scheme === 'codebook-source',
    )
    assert.ok(source)
    await harness.editor.window.showTextDocument(source.document, {
      viewColumn: 2,
    })
    harness.changeEditorLayout({
      orientation: 0,
      groups: [
        { size: 0.7, groups: [{ size: 0.3 }, { size: 0.7 }] },
        { size: 0.3 },
      ],
    })
    const unconfirmed = await harness.reader.readPresentationState()
    chat.focus()
    const named = harness.editor.window.tabGroups.activeTabGroup,
      namedInput: unknown = named.activeTab?.input
    const stateBefore = {
      namedColumn: named.viewColumn,
      namedTabIsCapturedSource:
        namedInput instanceof harness.editor.TabInputText &&
        namedInput.uri.scheme === 'codebook-source',
      hasActiveTextEditor: harness.editor.window.activeTextEditor !== undefined,
      chatHasKeyboard: chat.focused(),
    }
    const commandsBefore = harness.commands.length
    // Act
    const restored = await harness.reader.changePresentation({
      presentationId: unconfirmed.presentationId,
      expectedRevision: unconfirmed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })
    // Assert
    assert.deepEqual(stateBefore, {
      namedColumn: 2,
      namedTabIsCapturedSource: true,
      hasActiveTextEditor: false,
      chatHasKeyboard: true,
    })
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(unconfirmed.layoutConfirmed, false)
    assert.equal(
      unconfirmed.reason,
      'The Study arrangement is not confirmed: the editor grid no longer has the sizes of the confirmed layout. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.',
    )
    assert.equal(restored.state, 'open')
    assert.equal(restored.layoutConfirmed, true)
    assert.equal(restored.reason, undefined)
    assert.equal(restored.panes.appColumn, 1)
    assert.equal(restored.panes.sourceColumn, 2)
    assert.equal(restored.panes.contextColumn, 3)
    // The grid has the sizes of the Study layout again; three groups of the main editor and the chat's, none of them empty.
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })
    assert.equal(harness.groups.length, 4)
    assert.equal(
      harness.groups.some((group) => group.tabs.length === 0),
      false,
    )
    // The arrangement entered the main editor through the captured source's text editor (Cursor reports no focus of the Application pane the first group shows); the chat has the keyboard again through Cursor's own command.
    assert.deepEqual(
      harness.commands.slice(commandsBefore).filter(isKeyboardCommand),
      ['composer.focusComposer'],
    )
    assert.equal(chat.focused(), true)
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's Restore made from Cursor's chat right after its own Return Current: the Return gave the chat input its keyboard back with Cursor's Focus Agent, which changes no tab or group, so the editor names the Application pane's tab while that pane is not active; the Restore arranges the live panes again, answers confirmed and gives the chat its keyboard back; fails_when=the Restore takes the named Application pane for the learner's focus, its measurement moves the keyboard into the main editor, and it refuses with "The Study pane did not regain native focus after layout measurement." although no Study pane was pressed, leaving the chat without the keyboard; why_new=Cycle 0046 row 628; seam=useNativeLayout, addSeparateEditorPart (Cursor's chat part and its Focus Agent command), the service's selectPresentation and returnToCurrent (codebook_presentation, codebook_return_current), focusedPanel and the command log
test('an agent’s Restore right after its own Return Current from Cursor’s chat reaches the confirmed live arrangement and gives the chat its keyboard back', async () => {
  // Arrange: the agent selected the Study workspace from Cursor's chat and returned it to the current run; the Return gave the chat input the keyboard back, and the editor still names the Application pane's tab.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const chat = harness.addSeparateEditorPart()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    chat.focusTab()
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    chat.focusTab()
    const beforeReturn = harness.reader.presentationState()
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: beforeReturn.presentationId,
      expectedRevision: beforeReturn.reader.contentRevision,
    })
    const afterReturn = harness.reader.presentationState()
    const stateBefore = {
      contentTab: afterReturn.reader.contentTab,
      layoutConfirmed: afterReturn.layoutConfirmed,
      namedTab: harness.focusedPanel(),
      chatHasKeyboard: chat.focused(),
    }
    const commandsBefore = harness.commands.length

    // Act
    const restored = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: afterReturn.presentationId,
      expectedRevision: afterReturn.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })

    // Assert: the live arrangement is confirmed again, and Cursor's own command gave the chat input its keyboard back.
    assert.deepEqual(stateBefore, {
      contentTab: 'live',
      layoutConfirmed: true,
      namedTab: 'codebook.scopedBrowser',
      chatHasKeyboard: true,
    })
    assert.deepEqual(
      {
        layoutConfirmed: restored.layoutConfirmed,
        reason: restored.reason,
        appColumn: restored.panes.appColumn,
        sourceColumn: restored.panes.sourceColumn,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter(isKeyboardCommand),
        chatHasKeyboard: chat.focused(),
      },
      {
        layoutConfirmed: true,
        reason: undefined,
        appColumn: 1,
        sourceColumn: 2,
        keyboardCommands: ['composer.focusComposer'],
        chatHasKeyboard: true,
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's Restore made from VS Code's chat view right after its own Return Current: VS Code names the Application pane as the active one beside its chat view, the Restore arranges the live panes again, answers confirmed, and takes nothing from the view that has the keyboard; fails_when=a change for Cursor's chat part (row 628) runs a chat focus command or refuses the Restore in VS Code; why_new=Cycle 0046 row 628 (VS Code's chat-view model); seam=useNativeLayout, focusChatInSecondarySideBar, the service's selectPresentation and returnToCurrent, keyboardInView and the command log
test('an agent’s Restore right after its own Return Current from VS Code’s chat view reaches the confirmed live arrangement and leaves the keyboard in that view', async () => {
  // Arrange: the agent selected the Study workspace from VS Code's chat view and returned it to the current run; the learner typed the next request into the chat view.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    harness.focusMutableDraft('actions.ts', 1)
    harness.focusChatInSecondarySideBar()
    const selection = harness.reader.presentationState()
    await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: selection.presentationId,
      expectedRevision: selection.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    harness.focusChatInSecondarySideBar()
    const beforeReturn = harness.reader.presentationState()
    await harness.service.returnToCurrent({
      instanceId: harness.service.instanceId,
      presentationId: beforeReturn.presentationId,
      expectedRevision: beforeReturn.reader.contentRevision,
    })
    harness.focusChatInSecondarySideBar()
    const afterReturn = harness.reader.presentationState()
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length

    // Act
    const restored = await harness.service.selectPresentation({
      instanceId: harness.service.instanceId,
      presentationId: afterReturn.presentationId,
      expectedRevision: afterReturn.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })

    // Assert: the live arrangement is confirmed again; no focus command ran, the chat view keeps the keyboard, and nothing is told.
    assert.deepEqual(
      {
        contentTab: afterReturn.reader.contentTab,
        layoutConfirmed: restored.layoutConfirmed,
        reason: restored.reason,
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter(isKeyboardCommand),
        viewHasKeyboard: harness.keyboardInView(),
        messages: harness.informationMessages
          .slice(messagesBefore)
          .map((message) => message.message),
      },
      {
        contentTab: 'live',
        layoutConfirmed: true,
        reason: undefined,
        keyboardCommands: [],
        viewHasKeyboard: true,
        messages: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's selection after the learner watched a replay and closed the Study workspace: the reader still holds that recording, and the selection arranges its panes and answers confirmed once the recorded source is shown; fails_when=the selection is answered while the recorded source is still opening, with "The live Study layout could not be confirmed after Restore." and the panes it opened left behind, again at every repeat; why_new=Cycle 0045 cause 12 (e) (obs15 P4: two selects refused after 473 ms and 446 ms with the cause "The recorded source is opening in its native pane."); seam=the recorded reader harness, focusMutableDraft
test("a selection made on a closed reader that holds a recording arranges the recording's panes and answers confirmed once the recorded source is shown", async () => {
  // Arrange: a recording was opened and the Study workspace closed; the learner types in a file.
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.close()
    const learnerFile = harness.focusMutableDraft('actions.ts', 1)
    const closed = harness.reader.presentationState()
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: closed.presentationId,
      expectedRevision: closed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(closed.state, 'closed')
    assert.equal(closed.reader.contentTab, 'recording')
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.reader.contentTab, 'recording')
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(selected.panes.contextColumn, undefined)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(learnerFile.document.getText(), 'Original learner draft.\n')
    assert.equal(learnerFile.tab.isDirty, true)
    assert.equal(
      harness.groups
        .find((group) => group.viewColumn === 2)
        ?.tabs.includes(learnerFile.tab),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's selection on a closed reader whose recording was never read to its end (the Study workspace was closed while the recording was loading, or its load had failed): the selection reads the recording again, arranges its panes and answers confirmed; fails_when=the read that the selection's own entry restarts opens the reader a second time, which the selection's pending presentation change refuses ("A presentation change or reader close is pending. …"), so the recording fails to load and the selection is refused with "The recording's Study layout could not be confirmed after Restore." at every repeat; why_new=Cycle 0045 cause 12 (e), second native result (obs15 R, e-select1 and e-select2: refused after 1.93 s and 194 ms, the Application tab never got the recording's title, the reader's content revision went from 9 to 12); seam=the recorded reader harness, focusMutableDraft
test('a selection made on a closed reader whose recording was closed while it was loading reads the recording again and answers confirmed', async () => {
  // Arrange: a recording was opened and the Study workspace closed before the recording was read; the learner types in a file.
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.reader.close()
    harness.focusMutableDraft('actions.ts', 1)
    const closed = harness.reader.presentationState(),
      readBeforeSelect = {
        readiness: harness.controller.state().readiness,
        presentedMs: harness.controller.state().presentedMs,
      }
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: closed.presentationId,
      expectedRevision: closed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(closed.state, 'closed')
    assert.equal(closed.reader.contentTab, 'recording')
    assert.deepEqual(readBeforeSelect, {
      readiness: 'idle',
      presentedMs: undefined,
    })
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(selected.reader.contentTab, 'recording')
    assert.equal(selected.panes.appColumn, 1)
    assert.equal(selected.panes.sourceColumn, 2)
    assert.equal(selected.panes.contextColumn, undefined)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.state().reason, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=the cause an agent reads when the recording the reader holds failed to load: it names the failure and the step that loads the recording again; fails_when=the state and the refusal say "The current captured source is not ready in its native pane. Wait for it, or use Return to current …", which names a step that loads no recording, so the agent waits or returns to the current run and the select is refused again; why_new=Cycle 0045 cause 12 (e), second native result (obs15 R: that sentence stood in the state after both refused selects while the recording's load had failed); seam=the recorded reader harness, failNextCommand
test('the refusal of a selection on a reader whose recording failed to load names that failure and the step that loads the recording again', async () => {
  // Arrange: the Study workspace is open; a recording is opened and the editor fails the layout read of its entry, so the recording's load fails with the reader open.
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}] })
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    harness.failNextCommand('vscode.getEditorLayout')
    harness.controller.command({
      studyId: harness.studyId,
      action: 'open',
      expectedRevision: harness.controller.state().revision,
    })
    await harness.controller.settle()
    const failed = harness.reader.presentationState()
    // Act
    const refused = harness.reader.changePresentation({
      presentationId: failed.presentationId,
      expectedRevision: failed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(harness.controller.state().readiness, 'failed')
    assert.equal(failed.state, 'open')
    assert.equal(failed.layoutConfirmed, false)
    assert.equal(
      failed.reason,
      'The recording is not shown: it could not be loaded (Native layout command failed). Open the recording again, then restore the layout.',
    )
    await assert.rejects(refused, {
      code: 'PRESENTATION_UNAVAILABLE',
      message:
        "The recording's Study layout could not be confirmed after Restore.",
      causeDetail:
        'The recording is not shown: it could not be loaded (Native layout command failed). Open the recording again, then restore the layout.',
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent's replay opened from Cursor's chat while the Study workspace is open: the recording is read, its two panes are arranged and confirmed, and the chat has the keyboard again; fails_when=the entry measures the main editor by focusing its first group, which shows the Application pane, Cursor reports no focus of a pane beside the chat, the wait ends after five seconds and the recording fails to load with "The Codebook panes were not arranged: the main editor did not report the keyboard focus within 5 s …"; why_new=Cycle 0045 cause 12 (e), second native result (obs15 R: `codebook_playback` open made with the caret in the chat on the three-pane layout; 3.7 s later the state read open, unconfirmed, "The native editor layout receipt no longer matches the Study panes. …", and the recording was never read); seam=the recorded reader harness with a separate editor part whose group the editor names, the fake Cursor's unreported pane focus and stale group name
for (const named of ["the chat's group", 'the captured source'] as const)
  test(`a recording opened from Cursor's chat while the Study workspace is open is arranged and confirmed, and the chat gets the keyboard back, while the editor names ${named}`, async () => {
    // Arrange: the three Study panes are open (the Application pane is the tab the first group shows) and the chat has the keyboard. The editor names the chat's group after a click on the chat's tab; after a selection made from the chat input it names the captured source in group 2 without an active text editor, which is the state of the trace.
    const harness = await recordedReaderHarness()
    harness.useNativeLayout({ orientation: 1, groups: [{}, {}] })
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    const chat = harness.addSeparateEditorPart()
    harness.leavePaneFocusUnreportedBesideChat()
    try {
      const original = harness.focusMutableDraft('actions.ts', 1)
      if (named === "the chat's group") {
        await harness.reader.open()
        chat.focusTab()
      } else {
        chat.focus()
        const closed = harness.reader.presentationState()
        await harness.reader.changePresentation({
          presentationId: closed.presentationId,
          expectedRevision: closed.presentationControlRevision,
          mode: 'study-workspace',
          action: 'select',
        })
      }
      const before = await harness.reader.readPresentationState(),
        namedBefore = harness.editor.window.tabGroups.activeTabGroup,
        stateBefore = {
          namesChatGroup: namedBefore.tabs.includes(chat.tab),
          namedColumn: namedBefore.viewColumn,
          hasActiveTextEditor:
            harness.editor.window.activeTextEditor !== undefined,
          chatHasKeyboard: chat.focused(),
        },
        commandsBefore = harness.commands.length
      // Act
      harness.controller.command({
        studyId: harness.studyId,
        action: 'open',
        expectedRevision: harness.controller.state().revision,
      })
      await harness.controller.settle()
      // Assert
      const opened = await harness.reader.readPresentationState()
      assert.deepEqual(
        stateBefore,
        named === "the chat's group"
          ? {
              namesChatGroup: true,
              namedColumn: 4,
              hasActiveTextEditor: false,
              chatHasKeyboard: true,
            }
          : {
              namesChatGroup: false,
              namedColumn: 2,
              hasActiveTextEditor: false,
              chatHasKeyboard: true,
            },
      )
      assert.equal(before.layoutConfirmed, true)
      assert.equal(before.panes.contextColumn, 3)
      assert.equal(
        harness.controller.state().readiness,
        'ready',
        harness.controller.state().reason,
      )
      assert.equal(harness.controller.state().reason, undefined)
      assert.equal(opened.state, 'open')
      assert.equal(opened.reader.contentTab, 'recording')
      assert.equal(opened.layoutConfirmed, true)
      assert.equal(opened.reason, undefined)
      assert.equal(opened.panes.appColumn, 1)
      assert.equal(opened.panes.sourceColumn, 2)
      assert.equal(opened.panes.contextColumn, undefined)
      // Dedicated App preparation retains both original main groups and the auxiliary chat.
      assert.deepEqual(
        harness.groups.map((group) => [group.viewColumn, group.tabs.length]),
        [
          [1, 1],
          [2, 3],
          [3, 0],
          [4, 1],
        ],
      )
      // Explicit reservation may borrow native source, then returns input through Cursor's own chat command.
      assert.equal(
        harness.commands.slice(commandsBefore).filter(isKeyboardCommand).at(-1),
        'composer.focusComposer',
      )
      assert.equal(harness.groups[1]!.tabs.includes(original.tab), true)
      assert.equal(original.document.getText(), 'Original learner draft.\n')
      assert.equal(original.tab.isDirty, true)
      assert.equal(chat.focused(), true)
    } finally {
      await harness.close()
    }
  })

// Value: protects=a repeated selection on a reader whose recording layout is confirmed answering confirmed without arranging, measuring by focus or focusing anything; fails_when=the selection runs the whole arrangement again (the expand command, the grid, a focus hand-over), which in Cursor ended with "The learner changed native tab focus while the Study layout command was pending. The newer choice was preserved." although nobody touched the window; why_new=Cycle 0045 cause 12 (e) (obs15 P4, third select); seam=the recorded reader harness and its command log
test('a repeated selection on the confirmed layout of a recording answers confirmed and runs no layout or focus command', async () => {
  // Arrange: the reader shows a recording in its two confirmed panes; the keyboard is in the captured source.
  const harness = await recordedReaderHarness()
  harness.useNativeLayout({ orientation: 1, groups: [{}] })
  try {
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    const confirmed = await harness.reader.readPresentationState(),
      commandsBefore = harness.commands.length
    // Act
    const selected = await harness.reader.changePresentation({
      presentationId: confirmed.presentationId,
      expectedRevision: confirmed.presentationControlRevision,
      mode: 'study-workspace',
      action: 'select',
    })
    // Assert
    assert.equal(confirmed.layoutConfirmed, true)
    assert.equal(selected.state, 'open')
    assert.equal(selected.layoutConfirmed, true)
    assert.equal(selected.reason, undefined)
    assert.equal(
      selected.presentationControlRevision,
      confirmed.presentationControlRevision,
    )
    // One layout read, as a status read makes it; nothing was expanded, applied or focused.
    assert.deepEqual(harness.commands.slice(commandsBefore), [
      'vscode.getEditorLayout',
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=the reason of a refused presentation change leaving the state once the layout is confirmed; fails_when=a status read answers layoutConfirmed true beside the sentence of an earlier refusal, which an agent relays as the current state; why_new=Cycle 0045 cause 12 (e) (obs15 P4: state open, layoutConfirmed true and reason "Error: The live Study layout could not be confirmed after Restore." two seconds after a refused select); seam=workspace harness, addOpaqueTab
test('the reason of a refused selection is gone from the presentation state once the layout is confirmed', async () => {
  // Arrange: a selection was refused for an image the learner opened by a single click (a preview Codebook cannot keep); the learner then keeps that tab open and opens the Study workspace.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    const image = harness.addOpaqueTab('logo.png', 1)
    image.isPreview = true
    const closed = harness.reader.presentationState()
    await assert.rejects(
      harness.reader.changePresentation({
        presentationId: closed.presentationId,
        expectedRevision: closed.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      }),
    )
    const refused = harness.reader.presentationState()
    image.isPreview = false
    // Act
    await harness.reader.open()
    // Assert
    const opened = await harness.reader.readPresentationState()
    assert.equal(
      refused.reason,
      'Error: A destination group contains a foreign preview: "logo.png" in editor group 1. Close that tab, or keep it open (double-click its tab), then try again.',
    )
    assert.equal(opened.layoutConfirmed, true)
    assert.equal(opened.reason, undefined)
  } finally {
    await harness.close()
  }
})
