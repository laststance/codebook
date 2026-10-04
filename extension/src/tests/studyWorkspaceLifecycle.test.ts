import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'

import type { PresentationPoseCapture } from '../presentationSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer } from '../server'
import { withStorageLock } from '../utils/withStorageLock'

import {
  workspaceHarness,
  openRetainedStudy,
  readerSeams,
  recordedReaderHarness,
} from './studyWorkspaceHarness'
import {
  advanceClockUntil,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'
for (const stage of [
  'capture-presentation-pose',
  'restore-presentation-pose',
] as const)
  test(`Close cancels stalled ${stage} delivery without waiting for the renderer transport`, async () => {
    // Arrange: delivery itself is pending, so the later receipt deadline cannot observe cancellation.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let releaseDelivery = (_accepted: boolean): void => {},
      changing: Promise<unknown> | undefined,
      closing: Promise<void> | undefined
    try {
      await harness.reader.open()
      const panel = harness
        .nativePanels()
        .find((current) => current.kind === 'codebook.studyContext')
      assert.ok(panel)
      let observed!: () => void
      const requested = new Promise<void>((resolve) => {
        observed = resolve
      })
      const delivery = new Promise<boolean>((resolve) => {
        releaseDelivery = resolve
      })
      const holdDelivery = (target: NonNullable<typeof panel>): void => {
        const originalPost = target.webview.postMessage.bind(target.webview)
        target.webview.postMessage = (message) => {
          if (message.type !== stage) return originalPost(message)
          observed()
          return delivery
        }
      }
      // Capture uses the predecessor; restoration uses the newly adopted document.
      if (stage === 'capture-presentation-pose') holdDelivery(panel)
      else harness.onNextPanel('codebook.studyContext', holdDelivery)
      const state = harness.reader.presentationState()
      changing = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'guided-walkthrough',
        action: 'select',
      })
      void changing.catch(() => undefined)
      await requested
      // Act
      closing = harness.reader.close()
      const result = await Promise.race([
        closing.then(() => 'closed'),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve('blocked by transport'), 500),
        ),
      ])
      // Assert
      assert.equal(result, 'closed')
      assert.equal(harness.counts().panels, 0)
      await assert.rejects(changing, { code: 'PRESENTATION_UNAVAILABLE' })
      assert.equal(harness.presentationPreferences.size, 0)
      assert.equal(harness.reader.presentationState().state, 'closed')
    } finally {
      releaseDelivery(false)
      await changing?.catch(() => undefined)
      await closing
      await harness.close()
    }
  })

for (const stage of [
  'capture-presentation-pose',
  'restore-presentation-pose',
] as const)
  for (const failure of ['rejected', 'not delivered', 'stalled'] as const)
    test(
      `${failure} ${stage} delivery refuses the presentation within its existing deadline`,
      { timeout: 15_000 },
      async () => {
        // Arrange
        const harness = await workspaceHarness(false)
        harness.useNativeLayout({ orientation: 0, groups: [{}] })
        let releaseDelivery = (_accepted: boolean): void => {}
        try {
          await harness.reader.open()
          const panel = harness
            .nativePanels()
            .find((current) => current.kind === 'codebook.studyContext')
          assert.ok(panel)
          const pending = new Promise<boolean>((resolve) => {
            releaseDelivery = resolve
          })
          const failDelivery = (target: NonNullable<typeof panel>): void => {
            const originalPost = target.webview.postMessage.bind(target.webview)
            target.webview.postMessage = (message) =>
              message.type !== stage
                ? originalPost(message)
                : failure === 'stalled'
                  ? pending
                  : failure === 'not delivered'
                    ? Promise.resolve(false)
                    : Promise.reject(new Error('Reading transport rejected.'))
          }
          // The failure must reach the document handling this stage after a same-column handoff.
          if (stage === 'capture-presentation-pose') failDelivery(panel)
          else harness.onNextPanel('codebook.studyContext', failDelivery)
          const state = harness.reader.presentationState()
          // Act / Assert: even transport failure must not save a mode or manufacture a reading receipt.
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
                failure === 'rejected'
                  ? 'Error: Reading transport rejected.'
                  : failure === 'not delivered'
                    ? 'Error: Reading position message could not reach the current explanation.'
                    : `Error: Timed out waiting for ${stage === 'capture-presentation-pose' ? 'retained' : 'restored'} reading position`,
            },
          )
          assert.equal(harness.presentationPreferences.size, 0)
          assert.equal(
            harness.reader.presentationState().mode,
            'study-workspace',
          )
          assert.equal(harness.reader.presentationState().state, 'open')
        } finally {
          releaseDelivery(false)
          await harness.close()
        }
      },
    )

test('learner input after reading capture cancels placement without saving or restoring the obsolete pose', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let release = (): void => {}
  try {
    await harness.reader.open()
    const panel = harness.reader['contextPanel']
    assert.ok(panel)
    const originalPost = panel.webview.postMessage.bind(panel.webview),
      state = harness.reader.presentationState()
    let capture: PresentationPoseCapture | undefined,
      restorations = 0
    panel.webview.postMessage = (message) => {
      if (message.type === 'capture-presentation-pose') capture = message
      if (message.type === 'restore-presentation-pose') restorations++
      return originalPost(message)
    }
    const held = harness.holdNextCommand('vscode.getEditorLayout')
    release = held.release
    const changing = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    const rejected = assert.rejects(
      changing,
      /newer learner input was preserved/,
    )
    await held.started
    assert.ok(capture)
    // Act
    harness.receive({
      type: 'presentation-pose-invalidated',
      captureId: capture.captureId,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    held.release()
    await rejected
    // Assert
    assert.equal(restorations, 0)
    assert.equal(harness.presentationPreferences.size, 0)
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
  } finally {
    release()
    await harness.close()
  }
})

for (const pane of ['application', 'context'] as const)
  test(`an unchanged empty chat wrapper during ${pane} replacement preserves all three presentation destinations`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft()
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    try {
      await harness.reader.open()
      const source = harness.reader.inspect().sourceUri,
        progress = await (await harness.reader.learningStorage()).readProgress()
      let refreshed = false
      harness.onNextPanel(
        pane === 'application'
          ? 'codebook.scopedBrowser'
          : 'codebook.studyContext',
        () => {
          assert.equal(harness.reader['layoutReceipt'], undefined)
          chat.resync('wrapper')
          refreshed = true
        },
      )
      const state = harness.reader.presentationState()
      // Act
      await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'living-book',
        action: 'select',
      })
      // Assert
      assert.equal(refreshed, true)
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(harness.reader.presentationState().mode, 'living-book')
      assert.equal(harness.reader.presentationState().panes.appColumn, 2)
      assert.equal(harness.reader.presentationState().panes.sourceColumn, 3)
      assert.equal(harness.reader.presentationState().panes.contextColumn, 1)
      assert.deepEqual(harness.groups.at(-1)!.tabs, [])
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(harness.reader.inspect().sourceUri, source)
      assert.deepEqual(
        await (await harness.reader.learningStorage()).readProgress(),
        progress,
      )
      assert.equal(harness.runtimes.length, 0)
      assert.equal(harness.counts().panels, 2)
    } finally {
      await harness.close()
    }
  })

for (const pane of ['application', 'context'] as const)
  test(`a ${pane} pane replacement retains a native group containing an unchanged settings tab`, async () => {
    // Arrange: ordinary setup can leave settings tabs beside the Codebook panes in the same three editor groups.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await harness.reader.open()
      const column = pane === 'application' ? 1 : 3
      const settings = harness.addOpaqueTab('Settings', column)
      harness.onNextPanel(
        pane === 'application'
          ? 'codebook.scopedBrowser'
          : 'codebook.studyContext',
        () => harness.replaceEditorGroup('wrapper', column),
      )
      const state = harness.reader.presentationState()
      // Act
      await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'living-book',
        action: 'select',
      })
      // Assert: the unchanged foreign tab survives and does not prevent confirmation of the requested mode.
      assert.equal(harness.reader.presentationState().mode, 'living-book')
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.ok(harness.groups.some((group) => group.tabs.includes(settings)))
    } finally {
      await harness.close()
    }
  })

test('a changed settings tab during pane replacement cannot inherit native group ownership', async () => {
  // Arrange: a foreign tab with an altered title is a learner change, even when Codebook's panel is unchanged.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const settings = harness.addOpaqueTab('Settings', 1)
    harness.onNextPanel('codebook.scopedBrowser', () =>
      harness.replaceEditorGroup('wrapper', 1, (tabs) => {
        tabs[tabs.indexOf(settings)] = {
          ...settings,
          label: 'Changed settings',
        }
      }),
    )
    const state = harness.reader.presentationState()
    // Act / Assert: keep the prior mode and the learner's new tab instead of confirming an adopted group.
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
          'Error: Native editor groups changed during pane creation; the learner arrangement was preserved.',
      },
    )
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    assert.ok(
      harness.groups.some((group) =>
        group.tabs.some((tab) => tab.label === 'Changed settings'),
      ),
    )
  } finally {
    await harness.close()
  }
})

test('a replacement settings tab with the same title cannot inherit native group ownership', async () => {
  // Arrange: a learner can reopen Settings under the same visible label while Codebook moves its panes.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    const originalSettings = harness.addOpaqueTab('Settings', 1)
    const replacementSettings = harness.addOpaqueTab('Settings', 1)
    const settingsGroup = harness.groups.find((group) => group.viewColumn === 1)
    assert.ok(settingsGroup)
    settingsGroup.tabs.splice(
      settingsGroup.tabs.indexOf(replacementSettings),
      1,
    )
    harness.onNextPanel('codebook.scopedBrowser', () =>
      harness.replaceEditorGroup('wrapper', 1, (tabs) => {
        tabs[tabs.indexOf(originalSettings)] = replacementSettings
      }),
    )
    const state = harness.reader.presentationState()
    // Act: attempt the same presentation transfer after the native wrapper reports its new tab.
    const changing = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    // Assert: a matching title cannot grant ownership of the learner's replacement tab.
    await assert.rejects(changing, {
      code: 'PRESENTATION_UNAVAILABLE',
      causeDetail:
        'Error: Native editor groups changed during pane creation; the learner arrangement was preserved.',
    })
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    assert.ok(
      harness.groups.some((group) => group.tabs.includes(replacementSettings)),
    )
  } finally {
    await harness.close()
  }
})

for (const change of ['opened', 'unannounced', 'move'] as const)
  test(`an empty chat ${change} during pane replacement cannot inherit presentation ownership`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const chat = harness.addSeparateEditorPart(),
      draft = harness.focusMutableDraft()
    harness.groups.at(-1)!.tabs = []
    harness.groups.at(-1)!.activeTab = undefined
    try {
      await harness.reader.open()
      const app = harness.reader['app'],
        explanation = harness.reader['contextPanel']
      harness.onNextPanel('codebook.scopedBrowser', () => chat.resync(change))
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
            'Error: Native editor groups changed during pane creation; the learner arrangement was preserved.',
        },
      )
      // Assert
      assert.equal(harness.reader['app'], app)
      assert.equal(harness.reader['contextPanel'], explanation)
      assert.equal(harness.reader.presentationState().mode, 'study-workspace')
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      assert.equal(harness.presentationPreferences.size, 0)
      assert.equal(harness.counts().panels, 2)
      assert.deepEqual(harness.groups.at(-1)!.tabs, [])
      assert.deepEqual(chat.layout(), {
        orientation: 1,
        groups: [{ size: 743 }],
      })
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      assert.equal(harness.runtimes.length, 0)
    } finally {
      await harness.close()
    }
  })

for (const positionMs of [0, 100])
  test(`restoring replay preserves both live history and replay leases at the confirmed ${positionMs === 0 ? 'missing-frame' : 'captured-frame'} position`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const failures: string[] = []
    let live:
      | ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      | undefined
    try {
      live = harness.reader.presentation.createViewport(
        'handoff-live',
        () => {},
        (reason) => failures.push(reason),
        'normal',
      )
      await harness.reader.openRecording(harness.studyId)
      await harness.controller.settle()
      harness.controller.command({
        action: 'seek',
        studyId: harness.studyId,
        expectedRevision: harness.controller.state().revision,
        positionMs,
      })
      await harness.controller.settle()
      const app = harness.reader['app'],
        context = harness.reader['contextPanel'],
        replay = harness.reader['replayViewport']
      const bundle = harness.controller.bundle(),
        image = harness.displayedImage(),
        source = harness.reader.inspect().sourceUri
      const progress = await (
        await harness.reader.learningStorage()
      ).readProgress()
      harness.viewportEvents.length = 0
      await harness.reader.action('focus-app')
      const state = harness.reader.presentationState()
      // Act
      await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      // Assert
      assert.equal(harness.reader['app'], app)
      assert.equal(harness.reader['contextPanel'], context)
      assert.equal(context, undefined)
      assert.equal(harness.summary.visible, true)
      assert.equal(harness.reader['viewport'], live)
      assert.equal(harness.reader['replayViewport'], replay)
      assert.equal(harness.viewportInstances.length, 2)
      assert.equal(harness.viewportInstances[0]!.historical, true)
      for (const viewport of harness.viewportInstances)
        assert.equal(viewport.panel, harness.reader['app'])
      assert.deepEqual(
        harness.viewportEvents.filter((event) =>
          /^(hold|rebind|release|restore|unexpected-close):/.test(event),
        ),
        [],
      )
      assert.deepEqual(failures, [])
      assert.equal(harness.counts().panels, 1)
      assert.equal(harness.peakPanels(), 1)
      assert.equal(harness.controller.bundle(), bundle)
      assert.equal(harness.controller.state().presentedMs, positionMs)
      assert.equal(harness.controller.state().mode, 'paused')
      assert.equal(harness.displayedImage(), image)
      assert.equal(harness.reader.inspect().sourceUri, source)
      assert.deepEqual(
        await (await harness.reader.learningStorage()).readProgress(),
        progress,
      )
      assert.equal(harness.runtimes.length, 1)
      assert.equal(harness.runtimes[0]!.dispatches, 1)
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(
        harness.commands.includes('workbench.action.keepEditor'),
        false,
      )
    } finally {
      live?.close()
      await harness.close()
    }
  })

for (const failure of ['native layout failure', 'newer learner tab'] as const)
  test(`replay retains its renderer after ${failure} and restores layout only on explicit retry`, async () => {
    // Arrange
    const harness = await recordedReaderHarness(true)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let live:
      | ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      | undefined
    let draft: ReturnType<typeof harness.focusMutableDraft> | undefined
    let release = (): void => {}
    try {
      live = harness.reader.presentation.createViewport(
        'retained-replay-failure',
        () => {},
        () => {},
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
      await harness.reader.action('focus-app')
      const app = harness.reader['app'],
        bundle = harness.controller.bundle(),
        image = harness.displayedImage()
      const progress = await (
        await harness.reader.learningStorage()
      ).readProgress()
      const held = harness.holdNextCommand(
        'workbench.action.minimizeOtherEditors',
      )
      release = held.release
      const state = harness.reader.presentationState()
      const restoring = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      const rejected = assert.rejects(restoring, /Native|focus|pane/i)
      await held.started
      // Act: failure arrives while the existing renderer remains attached.
      if (failure === 'native layout failure')
        harness.failNextCommand('vscode.getEditorLayout')
      else draft = harness.focusMutableDraft('newer-reading-notes.txt', 2)
      held.release()
      await rejected
      // Assert
      assert.equal(harness.reader['app'], app)
      assert.equal(harness.controller.bundle(), bundle)
      assert.equal(harness.controller.state().presentedMs, 100)
      assert.equal(harness.controller.state().cleared, false)
      assert.equal(harness.displayedImage(), image)
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      assert.equal(harness.presentationPreferences.size, 0)
      const reveals = harness.panelReveals()
      await harness.reader['refresh']()
      assert.deepEqual(harness.panelReveals(), reveals)
      if (draft) {
        assert.equal(draft.editor.group.activeTab, draft.tab)
        assert.equal(draft.document.getText(), 'Original learner draft.\n')
      }
      // Act: only a new learner request may expose the source and recover its layout.
      await harness.reader.action('read-source')
      await harness.reader.action('focus-app')
      const retry = harness.reader.presentationState()
      await harness.reader.changePresentation({
        presentationId: retry.presentationId,
        expectedRevision: retry.presentationControlRevision,
        mode: 'study-workspace',
        action: 'restore',
      })
      // Assert
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(harness.controller.state().readiness, 'ready')
      assert.equal(harness.controller.bundle(), bundle)
      assert.equal(harness.controller.state().presentedMs, 100)
      assert.equal(harness.displayedImage(), image)
      assert.deepEqual(
        await (await harness.reader.learningStorage()).readProgress(),
        progress,
      )
      assert.equal(harness.viewportInstances.length, 2)
      assert.equal(harness.runtimes.length, 1)
      assert.equal(harness.runtimes[0]!.dispatches, 1)
    } finally {
      release()
      live?.close()
      await harness.close()
    }
  })

test('same-column mode changes recover native inner-focus delivery while preserving the current viewport lease', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let live:
    | ReturnType<NonNullable<typeof harness.reader.presentation.createViewport>>
    | undefined
  try {
    await harness.reader.open()
    live = harness.reader.presentation.createViewport(
      'same-column',
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.action('focus-context')
    const source = harness.reader.inspect().sourceUri
    harness.viewportEvents.length = 0
    // Act
    for (const mode of ['guided-walkthrough', 'study-workspace'] as const) {
      // The installed host can suppress inner delivery to retained documents despite selecting their native tabs.
      const previous = harness.nativePanels()
      for (const panel of previous) panel.blockInnerFocus = true
      const state = harness.reader.presentationState()
      await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode,
        action: 'select',
      })
      assert.equal(harness.innerFocusedPanel(), 'codebook.studyContext')
      assert.equal(harness.reader.presentationState().mode, mode)
      assert.equal(
        harness.nativePanels().some((panel) => previous.includes(panel)),
        false,
      )
    }
    // Assert
    assert.equal(harness.reader.inspect().sourceUri, source)
    assert.equal(harness.reader['viewport'], live)
    assert.equal(harness.peakPanels(), 4)
    assert.equal(harness.counts().panels, 2)
    assert.deepEqual(harness.viewportEvents, [
      'hold:live',
      'rebind:live',
      'release:live',
      'restore:live',
      'hold:live',
      'rebind:live',
      'release:live',
      'restore:live',
    ])
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
  } finally {
    live?.close()
    await harness.close()
  }
})

for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext'])
  test(`same-column handoff preserves its current lease when the host refreshes the previous ${kind} tab wrapper`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let live:
      | ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      | undefined
    try {
      await harness.reader.open()
      live = harness.reader.presentation.createViewport(
        'tab-resync',
        () => {},
        () => {},
        'normal',
      )
      await harness.reader.action('focus-context')
      const previous = harness
        .nativePanels()
        .find((panel) => panel.kind === kind)
      assert.ok(previous)
      const originalTab = previous.nativeTab,
        state = harness.reader.presentationState()
      harness.onNextPanel(kind, () => previous.refreshTabWrapper())
      // Act
      await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'guided-walkthrough',
        action: 'select',
      })
      // Assert
      assert.notEqual(previous.nativeTab, originalTab)
      assert.equal(
        harness.reader.presentationState().mode,
        'guided-walkthrough',
      )
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(harness.reader['viewport'], live)
      assert.equal(harness.counts().panels, 2)
      assert.equal(harness.innerFocusedPanel(), 'codebook.studyContext')
    } finally {
      live?.close()
      await harness.close()
    }
  })

for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext'])
  test(`same-column ${kind} handoff survives a group-wrapper refresh while both owned tabs coexist`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let live:
      | ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      | undefined
    try {
      await harness.reader.open()
      live = harness.reader.presentation.createViewport(
        'group-resync',
        () => {},
        () => {},
        'normal',
      )
      await harness.reader.action('focus-context')
      const state = harness.reader.presentationState()
      let refreshed = false
      harness.onNextPanel(kind, (replacement) => {
        assert.equal(
          harness.nativePanels().filter((panel) => panel.kind === kind).length,
          2,
        )
        harness.replaceEditorGroup('wrapper', replacement.viewColumn)
        refreshed = true
      })
      // Act
      await harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'guided-walkthrough',
        action: 'select',
      })
      // Assert
      assert.equal(refreshed, true)
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.equal(
        harness.reader.presentationState().mode,
        'guided-walkthrough',
      )
      assert.equal(harness.reader['viewport'], live)
      assert.equal(harness.counts().panels, 2)
      assert.equal(harness.innerFocusedPanel(), 'codebook.studyContext')
    } finally {
      live?.close()
      await harness.close()
    }
  })

for (const change of [
  'opened',
  'unannounced',
  'third-tab',
  'moved-group',
] as const)
  test(`same-column handoff refuses a ${change} during owned tab overlap`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await harness.reader.open()
      await harness.reader.action('focus-context')
      const state = harness.reader.presentationState()
      let interrupted = false
      harness.onNextPanel('codebook.scopedBrowser', (replacement) => {
        const group = harness.groups.find(
          (candidate) => candidate.viewColumn === replacement.viewColumn,
        )
        assert.ok(group)
        // A third lookalike tab and learner group movement cannot become an owned two-pane overlap.
        if (change === 'third-tab')
          group.tabs.push({ ...replacement.nativeTab })
        if (change === 'moved-group')
          harness.swapEditorGroups(
            group,
            harness.groups.find((candidate) => candidate.viewColumn === 3)!,
          )
        harness.replaceEditorGroup(
          change === 'opened' || change === 'unannounced' ? change : 'wrapper',
          replacement.viewColumn,
        )
        interrupted = true
      })
      // Act
      await assert.rejects(
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'guided-walkthrough',
          action: 'select',
        }),
        { code: 'PRESENTATION_UNAVAILABLE' },
      )
      // Assert
      assert.equal(interrupted, true)
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      assert.equal(harness.reader.presentationState().mode, 'study-workspace')
      assert.equal(harness.presentationPreferences.size, 0)
    } finally {
      await harness.close()
    }
  })

test('explicit same-mode restoration recovers inner-focus delivery without replacing the current viewport lease', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let live:
    | ReturnType<NonNullable<typeof harness.reader.presentation.createViewport>>
    | undefined
  try {
    await harness.reader.open()
    live = harness.reader.presentation.createViewport(
      'unchanged-mode',
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.action('focus-context')
    const state = harness.reader.presentationState()
    for (const panel of harness.nativePanels()) panel.blockInnerFocus = true
    harness.viewportEvents.length = 0
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })
    // Assert
    assert.equal(harness.innerFocusedPanel(), 'codebook.studyContext')
    assert.equal(harness.reader['viewport'], live)
    assert.equal(harness.peakPanels(), 4)
    assert.equal(harness.counts().panels, 2)
    assert.deepEqual(harness.viewportEvents, [
      'hold:live',
      'rebind:live',
      'release:live',
      'restore:live',
    ])
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
  } finally {
    live?.close()
    await harness.close()
  }
})

for (const failure of ['creation throws', 'unretained tab'] as const)
  test(`a second replacement that ${failure} preserves the prior panes and live lease without saving the mode`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const failures: string[] = []
    let live:
      | ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      | undefined
    try {
      await harness.reader.open()
      live = harness.reader.presentation.createViewport(
        'failed-handoff',
        () => {},
        (reason) => failures.push(reason),
        'normal',
      )
      const app = harness.reader['app'],
        context = harness.reader['contextPanel'],
        source = harness.reader.inspect().sourceUri
      const progress = await (
        await harness.reader.learningStorage()
      ).readProgress()
      if (failure === 'creation throws')
        harness.failNextPanelCreation('codebook.studyContext')
      else
        harness.onNextPanel('codebook.studyContext', (panel) => {
          panel.nativeTab.isPreview = true
        })
      const state = harness.reader.presentationState()
      // Act
      await assert.rejects(
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'living-book',
          action: 'select',
        }),
        { code: 'PRESENTATION_UNAVAILABLE' },
      )
      // Assert
      assert.equal(harness.reader['app'], app)
      assert.equal(harness.reader['contextPanel'], context)
      assert.equal(harness.reader['viewport'], live)
      assert.equal(harness.viewportInstances[0]!.panel, app)
      assert.deepEqual(failures, [])
      assert.equal(harness.counts().panels, 2)
      assert.equal(harness.reader.inspect().sourceUri, source)
      assert.deepEqual(
        await (await harness.reader.learningStorage()).readProgress(),
        progress,
      )
      assert.equal(harness.presentationPreferences.size, 0)
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
      assert.equal(harness.reader.presentationState().mode, 'study-workspace')
      assert.equal(
        harness.viewportEvents.some((event) => event.startsWith('rebind:')),
        false,
      )
    } finally {
      live?.close()
      await harness.close()
    }
  })

test('retired application notifications after reopening cannot change the current replay or learner understanding', async () => {
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
    const previousApp = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')!
    await harness.reader.close()
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    assert.notEqual(harness.reader['app'], previousApp)
    const presentation = harness.reader.presentationState()
    const bundle = harness.controller.bundle(),
      progress = await (await harness.reader.learningStorage()).readProgress(),
      messages = harness.postedMessages().length
    // Act: already queued callbacks retain their old object even after disposal.
    previousApp.notifyViewState()
    previousApp.emit({ type: 'ready' })
    previousApp.emit({
      type: 'understanding',
      revision: harness.reader.inspect().view!.revision,
      understood: true,
    })
    previousApp.emit({
      type: 'presentation-pose-invalidated',
      captureId: '33333333-3333-4333-8333-333333333333',
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    // Assert
    assert.equal(harness.controller.bundle(), bundle)
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(harness.controller.state().presentedMs, 100)
    assert.equal(harness.postedMessages().length, messages)
    assert.deepEqual(
      await (await harness.reader.learningStorage()).readProgress(),
      progress,
    )
    assert.deepEqual(harness.reader.presentationState(), presentation)
    assert.equal(harness.counts().panels, 1)
  } finally {
    await harness.close()
  }
})

test('closing the adopted application during native layout rejects the transition and fails its live lease exactly once', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const failures: string[] = []
  let release = (): void => {},
    live:
      | ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      | undefined
  try {
    await harness.reader.open()
    live = harness.reader.presentation.createViewport(
      'close-current',
      () => {},
      (reason) => failures.push(reason),
      'normal',
    )
    const held = harness.holdNextCommand('vscode.setEditorLayout')
    release = held.release
    const state = harness.reader.presentationState()
    const changing = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'living-book',
      action: 'select',
    })
    const rejected = assert.rejects(changing, {
      code: 'PRESENTATION_UNAVAILABLE',
    })
    await held.started
    const app = harness.reader['app']
    assert.ok(app)
    // Act
    app.dispose()
    app.dispose()
    held.release()
    await rejected
    // Assert
    assert.deepEqual(failures, ['Owned viewport closed before cleanup'])
    assert.equal(harness.reader['app'], undefined)
    assert.equal(harness.counts().panels, 1)
    assert.equal(harness.presentationPreferences.size, 0)
    assert.equal(harness.reader.presentationState().mode, 'study-workspace')
    assert.equal(harness.reader.presentationState().layoutConfirmed, false)
  } finally {
    release()
    live?.close()
    await harness.close()
  }
})

test('restoring replay keeps the live renderer attached without requesting a pane handoff', async (context) => {
  // Arrange
  const harness = await recordedReaderHarness(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let live:
    | ReturnType<NonNullable<typeof harness.reader.presentation.createViewport>>
    | undefined
  try {
    live = harness.reader.presentation.createViewport(
      'retained-live',
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.openRecording(harness.studyId)
    await harness.controller.settle()
    await harness.reader.action('focus-app')
    const app = harness.reader['app'],
      bundle = harness.controller.bundle()
    let handoffs = 0
    context.mock.method(live, 'holdPlacement', async () => {
      handoffs++
      throw new Error('Replay restoration must retain its renderer.')
    })
    const state = harness.reader.presentationState()
    // Act
    await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
    })
    // Assert
    assert.equal(handoffs, 0)
    assert.equal(harness.reader['app'], app)
    assert.equal(harness.peakPanels(), 1)
    assert.equal(harness.presentationPreferences.size, 0)
    assert.equal(harness.reader.presentationState().layoutConfirmed, true)
    assert.equal(harness.controller.bundle(), bundle)
    assert.equal(harness.reader['viewport'], live)
  } finally {
    context.mock.restoreAll()
    live?.close()
    await harness.close()
  }
})

for (const change of ['move', 'close'] as const)
  test(`a learner ${change} of the first replacement before the second registers prevents lease adoption`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    const failures: string[] = []
    let live:
      | ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      | undefined
    try {
      await harness.reader.open()
      live = harness.reader.presentation.createViewport(
        'interrupted-creation',
        () => {},
        (reason) => failures.push(reason),
        'normal',
      )
      const app = harness.reader['app'],
        explanation = harness.reader['contextPanel']
      const previousApp = harness
        .nativePanels()
        .find((panel) => panel.kind === 'codebook.scopedBrowser')
      harness.onNextPanel('codebook.studyContext', () => {
        const replacement = harness
          .nativePanels()
          .find(
            (panel) =>
              panel.kind === 'codebook.scopedBrowser' && panel !== previousApp,
          )
        assert.ok(replacement)
        if (change === 'move') replacement.reveal(1, true)
        else replacement.dispose()
      })
      const state = harness.reader.presentationState()
      // Act
      await assert.rejects(
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: 'living-book',
          action: 'select',
        }),
        { code: 'PRESENTATION_UNAVAILABLE' },
      )
      // Assert
      assert.equal(harness.reader['app'], app)
      assert.equal(harness.reader['contextPanel'], explanation)
      assert.equal(harness.viewportInstances[0]!.panel, app)
      assert.deepEqual(failures, [])
      assert.equal(
        harness.viewportEvents.some((event) => event.startsWith('rebind:')),
        false,
      )
      assert.equal(harness.counts().panels, 2)
      assert.equal(harness.presentationPreferences.size, 0)
      assert.equal(harness.reader.presentationState().layoutConfirmed, false)
    } finally {
      live?.close()
      await harness.close()
    }
  })

test('explicit presentation focus returns from Wiki without changing layout, learning or execution', async () => {
  // Arrange
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await openRetainedStudy(harness)
    const wiki = harness.openWiki(2),
      draft = harness.addForeignDraft(1)
    const state = harness.reader.presentationState(),
      layout = harness.editorLayout()
    const before = harness.reader.inspect(),
      commands = harness.commands.length
    // Opening retained evidence can finish its durable selection after the view becomes ready.
    await waitUntil(
      async () =>
        (await (await harness.reader.learningStorage()).readProgress())
          .selection?.studyId === before.view?.model.selection.studyId,
      'retained selection persistence',
      1_000,
    )
    const progress = await (
      await harness.reader.learningStorage()
    ).readProgress()
    // Act
    const result = await harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: state.mode,
      action: 'focus',
    })
    // Assert
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(harness.innerFocusedPanel(), 'codebook.studyContext')
    assert.equal(result.state, 'open')
    assert.equal(
      result.presentationControlRevision,
      state.presentationControlRevision + 1,
    )
    assert.equal(result.mode, state.mode)
    assert.deepEqual(harness.editorLayout(), layout)
    assert.equal(harness.reader.inspect().sourceUri, before.sourceUri)
    assert.deepEqual(
      await (await harness.reader.learningStorage()).readProgress(),
      progress,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(wiki.nativeTab)),
      true,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(draft)),
      true,
    )
    assert.equal(draft.isDirty, true)
    assert.equal(
      harness.commands
        .slice(commands)
        .includes('workbench.action.maximizeEditorHideSidebar'),
      false,
    )
    assert.equal(harness.runtimes.length, 0)
    assert.throws(
      () =>
        harness.reader.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: state.mode,
          action: 'focus',
        }),
      { code: 'STALE_PRESENTATION' },
    )
  } finally {
    await harness.close()
  }
})

for (const invalid of ['closed', 'different mode', 'unfocused window'] as const)
  test(`presentation focus rejects ${invalid} without revealing a pane`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      if (invalid !== 'closed') await openRetainedStudy(harness)
      if (invalid === 'unfocused window') harness.changeWindowFocus(false)
      const state = harness.reader.presentationState(),
        reveals = harness.panelReveals().length
      // Act / Assert
      assert.throws(
        () =>
          harness.reader.changePresentation({
            presentationId: state.presentationId,
            expectedRevision: state.presentationControlRevision,
            mode: invalid === 'different mode' ? 'living-book' : state.mode,
            action: 'focus',
          }),
        { code: 'PRESENTATION_UNAVAILABLE' },
      )
      assert.equal(harness.panelReveals().length, reveals)
      assert.equal(
        harness.reader.presentationState().presentationControlRevision,
        state.presentationControlRevision,
      )
      assert.equal(harness.runtimes.length, 0)
    } finally {
      harness.changeWindowFocus(true)
      await harness.close()
    }
  })

for (const departure of ['window roundtrip', 'learner draft'] as const)
  test(`presentation focus preserves newer intent after ${departure} during native handoff`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let release = (): void => {}
    try {
      await openRetainedStudy(harness)
      const draft = harness.focusMutableDraft()
      harness.openWiki(2)
      const state = harness.reader.presentationState(),
        listeners = harness.windowFocusListeners()
      const held = harness.holdPanelActivity('codebook.studyContext')
      release = held.release
      const focusing = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: state.mode,
        action: 'focus',
      })
      const rejected = assert.rejects(focusing, {
        code: 'PRESENTATION_UNAVAILABLE',
      })
      await held.started
      const reveals = harness.panelReveals().length
      // Act
      if (departure === 'window roundtrip') {
        harness.changeWindowFocus(false)
        harness.changeWindowFocus(true)
      } else draft.focus()
      held.release()
      await rejected
      // Assert
      assert.equal(harness.panelReveals().length, reveals)
      assert.equal(harness.reader.presentationState().state, 'open')
      assert.equal(harness.windowFocusListeners(), listeners)
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
      if (departure === 'learner draft')
        assert.equal(
          harness.focusedSource()?.document.uri.toString(),
          draft.document.uri.toString(),
        )
      assert.equal(harness.runtimes.length, 0)
    } finally {
      release()
      harness.changeWindowFocus(true)
      await harness.close()
    }
  })

test('ordinary chat can recover Study focus from Wiki through the public MCP presentation tool', async () => {
  // Arrange
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  await harness.reader.open()
  const wiki = harness.openWiki(2)
  const endpoint = await startServer(harness.service)
  const transport = new StreamableHTTPClientTransport(
    new URL(endpoint.descriptor.url),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
      },
    },
  )
  const client = new Client({
    name: 'study-focus-recovery-test',
    version: '1.0',
  })
  await client.connect(transport)
  try {
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
          }),
        }),
      })
      .parse(discovery.structuredContent).data
    const input = {
      instanceId: selected.instanceId,
      presentationId: selected.presentation.presentationId,
      expectedRevision: selected.presentation.presentationControlRevision,
      mode: selected.presentation.mode,
      action: 'focus',
    }
    // Act
    const focused = await client.callTool({
      name: 'codebook_presentation',
      arguments: input,
    })
    const stale = await client.callTool({
      name: 'codebook_presentation',
      arguments: input,
    })
    // Assert
    assert.equal(
      focused.isError,
      undefined,
      JSON.stringify(focused.structuredContent),
    )
    assert.equal(harness.focusedPanel(), 'codebook.studyContext')
    assert.equal(harness.innerFocusedPanel(), 'codebook.studyContext')
    assert.match(JSON.stringify(stale.structuredContent), /STALE_PRESENTATION/)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(wiki.nativeTab)),
      true,
    )
    assert.equal(harness.runtimes.length, 0)
    assert.equal(harness.service.records.size, 0)
  } finally {
    await client.close()
    await endpoint.close()
    await harness.close()
  }
})

for (const dirty of [false, true])
  test(`same-layout selection repairs proportions while preserving an ${dirty ? 'unsaved' : 'unchanged'} source preview`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      await harness.reader.open()
      await harness.reader.action('focus-context')
      const panels = [...harness.nativePanels()]
      const preview = harness.addTextPreview(
        join(harness.directory, 'learner-source.ts'),
        2,
        dirty,
      )
      harness.changeEditorLayout({
        orientation: 0,
        groups: [
          { size: 0.5, groups: [{ size: 0.5 }, { size: 0.5 }] },
          { size: 0.5 },
        ],
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
      assert.equal(harness.reader.presentationState().layoutConfirmed, true)
      assert.deepEqual(harness.nativePanels(), panels)
      assert.ok(
        harness.groups
          .find((group) => group.viewColumn === 2)
          ?.tabs.includes(preview),
      )
      assert.equal(preview.isPreview, true)
      assert.equal(preview.isDirty, dirty)
      assert.equal(
        harness.commands.includes('workbench.action.keepEditor'),
        false,
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=closing the reader while learning storage holds a lock, and the learner's write that was accepted before the close still reaching the disk; fails_when=close() awaits the library queue without a bound and never finishes, or the close drops the write that was waiting for the storage lock; why_new=Cycle 0044 (0033-O4), and Cycle 0045 X7-E1.3: the landing was asserted on a promise of the test itself, so a close that dropped a pending save passed; seam=the storage lock of the library's directory, held by the test as another writer of this process
test('closing the reader finishes after the storage bound while a library write is still held, and that write still lands', async (context) => {
  // Arrange: an opened reader, and a learner decision the library accepted but cannot write: another writer holds the storage lock of its directory.
  const harness = await workspaceHarness()
  let releaseLock = (): void => {}
  try {
    await harness.reader.open()
    const library = harness.reader['library']
    assert.ok(library)
    const progressFile = join(library.directory, 'progress.repository.v4.json')
    /** Reads the learner decisions the progress file on disk holds; a file that was never written holds none. */
    const savedDecisionIds = async (): Promise<string[]> => {
      const saved = await readFile(progressFile, 'utf8').catch(() => undefined)
      return saved === undefined
        ? []
        : z
            .object({ decisions: z.array(z.object({ id: z.string() })) })
            .parse(JSON.parse(saved))
            .decisions.map((decision) => decision.id)
    }
    let lockTaken = false
    const lockHeld = withStorageLock(
      library.directory,
      () =>
        new Promise<void>((resolve) => {
          lockTaken = true
          releaseLock = resolve
        }),
    )
    await waitUntil(() => lockTaken, 'the held storage lock', 1_000)
    const decision = {
      id: '0d0c1f6e-6f0b-4e0e-9f43-7f6f2f1c9a11',
      item: 'repository/interface/theme',
      sourceHash: 'a'.repeat(64),
      understood: true,
      at: '2026-10-04T09:00:00.000Z',
    }
    const written = library.decide(decision)
    void written.catch(() => undefined)
    context.mock.timers.enable({ apis: ['setTimeout'] })
    let closed = false

    // Act: time advances in 1 s steps until the reader has closed (at most 10 s).
    const closing = harness.reader.close().then(() => {
      closed = true
    })
    let elapsedMs = 0
    while (!closed && elapsedMs < 10_000) {
      for (let turn = 0; turn < 20; turn++)
        await new Promise<void>((resolve) => setImmediate(resolve))
      if (closed) break
      context.mock.timers.tick(1_000)
      elapsedMs += 1_000
    }
    const closedWhileWriteHeld = closed
    context.mock.timers.reset()
    const savedWhenClosed = await savedDecisionIds()
    releaseLock()
    await lockHeld
    await written
    await closing

    // Assert: the decision is read back from the file on disk.
    assert.equal(closedWhileWriteHeld, true)
    assert.equal(elapsedMs, 5_000)
    assert.deepEqual(savedWhenClosed, [])
    assert.deepEqual(await savedDecisionIds(), [
      '0d0c1f6e-6f0b-4e0e-9f43-7f6f2f1c9a11',
    ])
    assert.equal(harness.reader.presentationState().state, 'closed')
  } finally {
    context.mock.timers.reset()
    releaseLock()
    await harness.close()
  }
})

// Value: protects=Close Study Workspace ending while a run is still alive and learning storage does not answer, and the workspace opening again afterwards; fails_when=close() awaits the run's final checkpoint without a bound, so a write that never returns leaves the reader closing for good and every later Open is refused; why_new=Cycle 0045 X7-A.2 (the code half of row DOC-4: the 5 s bound did not cover the forced checkpoint before it); seam=the storage lock of the library's directory, held by the test as another writer of this process
test('closing the Study workspace during a run whose checkpoint write never returns ends within the close bound and the workspace opens again', async (context) => {
  // Arrange: the reader follows a run that has not stopped; another writer holds the storage lock, so the run's final checkpoint cannot be written.
  const harness = await workspaceHarness()
  let releaseLock = (): void => {}
  try {
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: 'run-alive-at-close',
    })
    await [...harness.service.records.values()][0]!.preparation
    await harness.reader.open()
    const library = harness.reader['library']
    assert.ok(library)
    let lockTaken = false
    const lockHeld = withStorageLock(
      library.directory,
      () =>
        new Promise<void>((resolve) => {
          lockTaken = true
          releaseLock = resolve
        }),
    )
    await waitUntil(() => lockTaken, 'the held storage lock', 1_000)
    let closed = false

    // Act: the close bound passes on a faked clock.
    const closing = harness.reader.close().then(() => {
      closed = true
    })
    enableFakeClock(context)
    const closedAfterMs = await advanceClockUntil(context, () => closed, 60_000)
    resetFakeClock(context)
    releaseLock()
    await lockHeld
    await closing
    await harness.reader.open()

    // Assert: closed while the write was still held, at the one 5 s bound; the rest of the close takes a few 50 ms steps of the faked clock, far from a second bound.
    assert.equal(
      closedAfterMs !== undefined &&
        closedAfterMs >= 5_000 &&
        closedAfterMs <= 5_500,
      true,
    )
    assert.equal(harness.reader.presentationState().state, 'open')
  } finally {
    resetFakeClock(context)
    releaseLock()
    await harness.close()
  }
})

// Value: protects=the learner who closed the Application pane of a live run and then follows the current run; fails_when=the reader asks the released lease to show the run, reports "Viewport lease is released" under a line the same render clears again, and leaves no pane and no word of what happened; why_new=Cycle 0045 H2-F1 (the harness's fake viewport accepted showLive on a released lease until D-M3, which hid this); seam=WorkspaceViewport refuses showLive after its panel closed, like the real viewport
test('following the current run after its Application pane was closed says that the run ended and how to see the application again, in a line that stays', async () => {
  // Arrange: the Application pane of a live run shows the history of a selected item, and the learner closes that pane, which ends the run's lease on it.
  const harness = await workspaceHarness()
  const leaseFailures: string[] = []
  try {
    await harness.reader.open()
    const lease = harness.reader.presentation.createViewport(
      'live-run',
      () => {},
      (reason) => leaseFailures.push(reason),
      'normal',
    )
    await harness.reader.select('repository/workspace/overview')
    const closedPane = harness.reader['app']!,
      historyPage = closedPane.webview.html
    closedPane.dispose()
    const messagesBeforeReturn = harness.postedMessages().length

    // Act: the learner follows the current run, and the reader's timer runs once more.
    await harness.reader.action('return-current')
    await readerSeams(harness).refresh()

    // Assert: one line was shown during the return and is still there; the released lease was not asked and the closed pane kept its page.
    const errorLinesShown = new Set(
      harness
        .postedMessages()
        .slice(messagesBeforeReturn)
        .flatMap((message) => message.errors),
    )
    assert.deepEqual(leaseFailures, ['Owned viewport closed before cleanup'])
    assert.deepEqual(
      [...errorLinesShown],
      [
        'Error: The Application pane of the current run was closed, which ended that run. Ask your agent for a new run to see the application again.',
      ],
    )
    assert.deepEqual(
      [...harness.postedMessages().at(-1)!.errors],
      [
        'Error: The Application pane of the current run was closed, which ended that run. Ask your agent for a new run to see the application again.',
      ],
    )
    assert.equal(harness.postedMessages().at(-1)!.unretryableErrorCount, 1)
    assert.equal(closedPane.webview.html, historyPage)
    // The fake lease still refuses like the real viewport (Cycle 0045 D-M3), which is what made the old behavior visible.
    await assert.rejects(
      lease.showLive(new AbortController().signal),
      /Viewport lease is released/,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the line about a closed Application pane leaving once a pane exists again; fails_when=the line stays through the next run, although that run's pane shows the application; why_new=Cycle 0045 H2-F1 (the line is kept under its own kind, which no render retires); seam=WorkspaceViewport
test('a new run that opens the Application pane again retires the line about the closed one', async () => {
  // Arrange: the learner closed the Application pane of a live run and followed the current run, which left the line.
  const harness = await workspaceHarness()
  try {
    await harness.reader.open()
    harness.reader.presentation.createViewport(
      'live-run',
      () => {},
      () => {},
      'normal',
    )
    await harness.reader.select('repository/workspace/overview')
    harness.reader['app']!.dispose()
    await harness.reader.action('return-current')
    const linesBeforeTheNewRun = [...harness.postedMessages().at(-1)!.errors]

    // Act: a new run takes its viewport lease, which opens the pane again.
    harness.reader.presentation.createViewport(
      'next-run',
      () => {},
      () => {},
      'normal',
    )

    // Assert
    assert.deepEqual(linesBeforeTheNewRun, [
      'Error: The Application pane of the current run was closed, which ended that run. Ask your agent for a new run to see the application again.',
    ])
    assert.deepEqual([...harness.postedMessages().at(-1)!.errors], [])
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests of Show Variables meeting the real debugger owner when the learner stops the recorded session during a wait; fails_when=the fake debugger keeps a wait for native Variables open after its session ended, or lets the view's refresh, 400 ms later, answer a wait as retrieved; why_new=Cycle 0045 X7-D.2 (the fake's wait read only the fake view, never the session); seam=the workspace harness's fake historical debugger and its fake Variables view
test('the workspace harness historical debugger ends a wait for native Variables when its session ends, and the view refreshing later no longer answers one, like the real owner', async () => {
  // Arrange: a recorded stop is presented while the host's Variables view was hidden; the learner shows the view, which refreshes 400 ms later.
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.setHistoricalDebugInspection('uninspected')
    harness.hideNativeVariables('missed-the-stop')
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
    await harness.editor.commands.executeCommand(
      'workbench.debug.action.focusVariablesView',
    )

    // Act: the learner stops the recorded session while a wait for the stop's scopes is open; the view refreshes afterwards.
    const waitOpenAtTheEnd = debuggerView.awaitRetrieval('scopes', 2_000)
    harness.endHistoricalDebugSession()
    // One turn of the event loop is the bound: the real owner answers an open wait as the session ends.
    const answerAtTheEnd = await Promise.race([
      waitOpenAtTheEnd,
      new Promise<string>((resolve) => {
        setImmediate(resolve, 'still waiting')
      }),
    ])
    await waitUntil(
      () => harness.nativeVariablesView().valuesListed,
      'the Variables view refreshed',
      2_000,
    )
    const answerAfterTheRefresh = await debuggerView.awaitRetrieval(
      'values',
      2_000,
    )

    // Assert
    assert.equal(answerAtTheEnd, false)
    assert.equal(answerAfterTheRefresh, false)
  } finally {
    await harness.close()
  }
})

// Value: protects=reader tests of Show Variables meeting the real debugger owner when the reader is closed during a wait; fails_when=the fake debugger keeps a wait for native Variables open after it was disposed, until the wait's own deadline; why_new=Cycle 0045 X7-D.2 (the fake's dispose woke no wait); seam=the workspace harness's fake historical debugger and its fake Variables view
test('the workspace harness historical debugger ends a wait for native Variables when the reader is closed, like the real owner', async () => {
  // Arrange: a recorded stop is presented while the host's Variables view shows another session, so the view never asks for the stop.
  const harness = await recordedReaderHarness(true, true)
  try {
    harness.setHistoricalDebugInspection('uninspected')
    harness.hideNativeVariables('shows-another-session')
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

    // Act: the reader is closed, which disposes its debugger, while a wait for the stop's scopes is open.
    const waitOpenAtTheClose = debuggerView.awaitRetrieval('scopes', 2_000)
    await harness.reader.close()
    // One turn of the event loop is the bound: the real owner answers an open wait as it is disposed.
    const answerAtTheClose = await Promise.race([
      waitOpenAtTheClose,
      new Promise<string>((resolve) => {
        setImmediate(resolve, 'still waiting')
      }),
    ])

    // Assert
    assert.equal(answerAtTheClose, false)
  } finally {
    await harness.close()
  }
})

// Value: protects=a click on "Open replay" in the status bar opening the recording; fails_when=every publish of the reader assigns a new command object to the status entry, so the host disposes the command the entry was drawn with and a click between two publishes ends in the host's "Actual command not found"; why_new=Cycle 0045 NF-23 (Cursor showed that toast on one Open replay click); seam=the harness's status item counts the assignments of its command
test('the Open replay entry keeps its command while the reader publishes again without a change, so a click between two publishes still opens the recording', async () => {
  // Arrange: a saved recording, whose status bar entry offers Open replay.
  const harness = await recordedReaderHarness()
  try {
    await harness.reader.saveLearningReplay(harness.studyId)
    const openReplayCommand = harness.saveStatus.command
    const assignmentsAtSave = harness.saveStatus.commandAssignments

    // Act: the reader publishes three more times while nothing about the entry changes.
    for (let publishCount = 0; publishCount < 3; publishCount++)
      readerSeams(harness).publish()

    // Assert: the host was handed no new command object, so the entry drawn with the first one still runs it.
    assert.deepEqual(structuredClone(openReplayCommand), {
      title: 'Open learning replay',
      command: 'codebook.openLearningReplay',
      arguments: [harness.studyId],
    })
    assert.equal(harness.saveStatus.commandAssignments - assignmentsAtSave, 0)
    assert.equal(harness.saveStatus.command, openReplayCommand)
  } finally {
    await harness.close()
  }
})

// Value: protects=design decision 2A, one recording control in the status bar: Save learning replay during the run, Open replay after the save; fails_when=the reader offers the run's recording while it is unsaved, or creates a second status bar item for it, which would put a replay session beside a paused live session in Call Stack; why_new=Cycle 0045 NF-2 as DR-6 (closed as no defect, pinned); seam=the harness records every status bar item the reader creates
test('while a run records the status bar offers Save learning replay and no second recording control, and after the save the same item offers Open replay', async () => {
  // Arrange: a run that is paused at its first stop and still recording.
  const harness = await workspaceHarness(true, true)
  try {
    harness.acknowledgeContext()
    harness.service.environment.build.sourceHash = sha256(
      'recording-control-pin-build',
    )
    harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: 'recording-control-pin',
    })
    const record = [...harness.service.records.values()][0]!
    await record.preparation
    harness.clock(100)
    await harness.reader.action('click')
    const studyId = `${harness.service.instanceId}_${record.id}`
    const whileRecording = {
      runStopped: record.stopped,
      text: harness.saveStatus.text,
      command: structuredClone(harness.saveStatus.command),
      visible: harness.saveStatus.visible,
      statusItems: [...harness.createdStatusItemIds],
    }

    // Act
    await harness.reader.saveLearningReplay(studyId)

    // Assert
    assert.deepEqual(whileRecording, {
      runStopped: false,
      text: '$(record) Recording explanation · Save learning replay',
      command: {
        title: 'Save learning replay',
        command: 'codebook.saveLearningReplay',
        arguments: [studyId],
      },
      visible: true,
      statusItems: ['codebook.learningSave'],
    })
    assert.deepEqual(
      {
        text: harness.saveStatus.text,
        command: structuredClone(harness.saveStatus.command),
        visible: harness.saveStatus.visible,
        statusItems: [...harness.createdStatusItemIds],
      },
      {
        text: '$(warning) Learning partially saved · Open replay',
        command: {
          title: 'Open learning replay',
          command: 'codebook.openLearningReplay',
          arguments: [studyId],
        },
        visible: true,
        statusItems: ['codebook.learningSave'],
      },
    )
  } finally {
    await harness.close()
  }
})
