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
  openRetainedStudy,
  readerSeams,
  recordedReaderHarness,
} from './studyWorkspaceHarness'
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
          'Error: Timed out waiting for owned presentation inner focus',
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
      assert.equal(reader.presentationState().mode, mode)
      assert.equal(harness.counts().panels, 2)
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
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    next = service.start({
      instanceId: service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'after-saved-recording',
    })
    await service.record(next).preparation
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
          'Error: Timed out waiting for owned presentation inner focus',
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
    // The draft the editor activated in the leftover tab's place has focus again once the panes are placed.
    assert.equal(harness.focusedPanel(), undefined)
    assert.equal(
      harness.groups.some((group) => group.activeTab === draft.tab),
      true,
    )
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
          'Focus a Codebook pane or text editor before selecting a presentation; the current foreign editor cannot be restored safely.',
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

test('a closed reader behind a foreign non-text editor refuses the selection and closes no leftover captured-source tab', async () => {
  // Arrange: the active tab is the editor's Settings page; a leftover captured source sits inactive in the same group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.attach(harness.service)
    harness.useOpaquePrimary('settings')
    const leftover = harness.restoreLeftoverCapturedSource({ active: false })
    const state = harness.reader.presentationState()
    // Act / Assert
    assert.throws(
      () =>
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: state.mode,
          action: 'select',
        }),
      {
        code: 'PRESENTATION_UNAVAILABLE',
        message:
          'Focus a Codebook pane or text editor before selecting a presentation; the current foreign editor cannot be restored safely.',
      },
    )
    assert.equal(
      harness.groups.flatMap((group) => group.tabs).includes(leftover),
      true,
    )
    assert.equal(harness.reader.presentationState().state, 'closed')
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
  const viewport = harness.reader.presentation.createViewport(
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
test('a closed reader behind a foreign non-text editor still refuses the selection and opens no pane when an earlier extension session left a dead Study pane in another group', async () => {
  // Arrange: the editor's Settings page has focus in column 1; the old host's Study pane is the only tab of column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    const settingsPage = harness.useOpaquePrimary('settings')
    harness.leaveDeadCodebookPane('codebook.studyContext', 3)
    const state = harness.reader.presentationState()
    // Act / Assert
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
          'Focus a Codebook pane or text editor before selecting a presentation; the current foreign editor cannot be restored safely.',
      },
    )
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.counts().panels, 0)
    // The learner's Settings page is still the visible tab of its group.
    assert.equal(
      harness.groups.find((group) => group.viewColumn === 1)?.activeTab,
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

const FOREIGN_EDITOR_REFUSAL =
  'Focus a Codebook pane or text editor before selecting a presentation; the current foreign editor cannot be restored safely.'

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
      message: FOREIGN_EDITOR_REFUSAL,
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
      { code: 'PRESENTATION_UNAVAILABLE', message: FOREIGN_EDITOR_REFUSAL },
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

// Value: protects=only the page the close itself activated is accepted in place of the closed focused tab; fails_when=any non-text page that has focus when the admission runs is accepted, so the reader opens over a page the learner chose meanwhile; why_new=Cycle 0044 0036-C06f: no test moved focus between the close and the admission; seam=focusOpaqueTab
test('a selection is refused when the learner moves to another non-text page while the editor settles after the focused leftover tab closed', async () => {
  // Arrange: closing the focused leftover tab activates the learner's draft, whose text editor the editor reports 60 ms later; an extension's page is open in column 2.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  try {
    await harness.reader.attach(harness.service)
    harness.focusMutableDraft('mutable-notes.txt', 1)
    const extensionPage = harness.addOpaqueTab('Extension page', 2)
    const leftover = harness.restoreLeftoverCapturedSource({
      column: 1,
      lateTextEditor: true,
    })
    const state = harness.reader.presentationState()
    // Act: the learner clicks the extension's page while the selection waits for the draft's text editor.
    const request = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'select',
    })
    request.catch(() => undefined)
    await tabClosed(harness, leftover)
    harness.focusOpaqueTab(extensionPage)
    // Assert
    await assert.rejects(request, {
      code: 'PRESENTATION_UNAVAILABLE',
      message: FOREIGN_EDITOR_REFUSAL,
    })
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.counts().panels, 0)
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
test('the first presentation selection closes the old host’s dead panes when a run created this host’s Application panel before the reader was opened', async () => {
  // Arrange: the old host's panes are in columns 1 and 3; an agent run then creates this host's Application panel, and the learner's draft has focus in column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  const deadApplication = harness.leaveDeadCodebookPane(
      'codebook.scopedBrowser',
      1,
    ),
    deadStudy = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
  const draft = harness.focusMutableDraft('mutable-notes.txt', 3)
  const viewport = harness.reader.presentation.createViewport(
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
    assert.equal(tabs.includes(deadApplication), false)
    assert.equal(tabs.includes(deadStudy), false)
    assert.equal(codebookPaneTabs(harness, 'codebook.scopedBrowser'), 1)
    assert.equal(codebookPaneTabs(harness, 'codebook.studyContext'), 1)
    assert.equal(tabs.includes(draft.tab), true)
  } finally {
    viewport.close()
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

// Value: protects=a selection refused for a foreign non-text editor changes nothing in the window; fails_when=the dead panes and leftover captured-source tabs are closed before the refusal is decided; why_new=Cycle 0044 0037-F5: the refusal test beside a dead pane asserted the refusal and the focused page only; seam=leaveDeadCodebookPane, restoreLeftoverCapturedSource
test('a selection refused behind a foreign non-text editor closes neither the dead pane nor the leftover captured-source tab of an earlier session', async () => {
  // Arrange: the editor's Settings page has focus in column 1 beside an inactive leftover captured source; the old host's Study pane is the only tab of column 3.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  try {
    await harness.reader.attach(harness.service)
    harness.useOpaquePrimary('settings')
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
      { code: 'PRESENTATION_UNAVAILABLE', message: FOREIGN_EDITOR_REFUSAL },
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
