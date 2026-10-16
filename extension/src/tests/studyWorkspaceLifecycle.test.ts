import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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
import { isProportionalEditorLayout } from '../utils/isProportionalEditorLayout'
import { settledWithin } from '../utils/settledWithin'
import { withStorageLock } from '../utils/withStorageLock'

import {
  workspaceHarness,
  openRetainedStudy,
  readerSeams,
  recordedReaderHarness,
  articleRecordingLayoutHarness,
} from './studyWorkspaceHarness'
import {
  advanceClockUntil,
  advanceClockUntilSettled,
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
      | Awaited<
          ReturnType<
            NonNullable<typeof harness.reader.presentation.createViewport>
          >
        >
      | undefined
    try {
      live = await harness.reader.presentation.createViewport(
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
      | Awaited<
          ReturnType<
            NonNullable<typeof harness.reader.presentation.createViewport>
          >
        >
      | undefined
    let draft: ReturnType<typeof harness.focusMutableDraft> | undefined
    let release = (): void => {}
    try {
      live = await harness.reader.presentation.createViewport(
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
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
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
      | Awaited<
          ReturnType<
            NonNullable<typeof harness.reader.presentation.createViewport>
          >
        >
      | undefined
    try {
      await harness.reader.open()
      live = await harness.reader.presentation.createViewport(
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
      | Awaited<
          ReturnType<
            NonNullable<typeof harness.reader.presentation.createViewport>
          >
        >
      | undefined
    try {
      await harness.reader.open()
      live = await harness.reader.presentation.createViewport(
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

for (const changed of ['predecessor', 'replacement'] as const)
  test(`same-column App handoff preserves the old lease when the ${changed} preview state changes during registration`, async () => {
    // Arrange: App preparation moved its retained predecessor, which is now a native preview.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let live:
      | Awaited<
          ReturnType<
            NonNullable<typeof harness.reader.presentation.createViewport>
          >
        >
      | undefined
    try {
      await harness.reader.open()
      live = await harness.reader.presentation.createViewport(
        'preview-change',
        () => {},
        () => {},
        'normal',
      )
      await harness.reader.action('focus-context')
      const state = harness.reader.presentationState(),
        predecessor = harness
          .nativePanels()
          .find((panel) => panel.kind === 'codebook.scopedBrowser')!
      assert.equal(predecessor.nativeTab.isPreview, true)
      let changedDuringRegistration = false
      harness.onNextPanel('codebook.scopedBrowser', (replacement) => {
        // A real later native flag change cannot become the creation receipt's expected cohort.
        if (changed === 'predecessor') predecessor.nativeTab.isPreview = false
        else replacement.nativeTab.isPreview = true
        harness.replaceEditorGroup('wrapper', replacement.viewColumn)
        changedDuringRegistration = true
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

      // Assert: failed creation removes its replacement and preserves the original renderer/lease and later flag.
      assert.equal(changedDuringRegistration, true)
      assert.equal(harness.reader['viewport'], live)
      assert.equal(harness.reader['app'], predecessor)
      assert.equal(predecessor.nativeTab.isPreview, changed !== 'predecessor')
      assert.equal(harness.reader.presentationState().mode, 'study-workspace')
      assert.equal(harness.presentationPreferences.size, 0)
      assert.equal(harness.counts().panels, 2)
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
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    await harness.reader.open()
    live = await harness.reader.presentation.createViewport(
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
      | Awaited<
          ReturnType<
            NonNullable<typeof harness.reader.presentation.createViewport>
          >
        >
      | undefined
    try {
      await harness.reader.open()
      live = await harness.reader.presentation.createViewport(
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
      | Awaited<
          ReturnType<
            NonNullable<typeof harness.reader.presentation.createViewport>
          >
        >
      | undefined
  try {
    // A real prepared Live entry owns the App/source composition; the old synthetic idle lease now has four retained groups and correctly refuses a legacy mode change before layout.
    await harness.reader.attach(harness.service)
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
      (reason) => failures.push(reason),
      'normal',
    )
    // Explicit Restore must actually issue a native layout effect before the panel-close race.
    harness.changeEditorLayout({
      orientation: 0,
      groups: [{ size: 3 }, { size: 1 }],
    })
    const held = harness.holdNextCommand('vscode.setEditorLayout')
    release = held.release
    const state = harness.reader.presentationState()
    const changing = harness.reader.changePresentation({
      presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision,
      mode: 'study-workspace',
      action: 'restore',
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
    assert.equal(harness.counts().panels, 0)
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
    | Awaited<
        ReturnType<
          NonNullable<typeof harness.reader.presentation.createViewport>
        >
      >
    | undefined
  try {
    live = await harness.reader.presentation.createViewport(
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
      | Awaited<
          ReturnType<
            NonNullable<typeof harness.reader.presentation.createViewport>
          >
        >
      | undefined
    try {
      await harness.reader.open()
      live = await harness.reader.presentation.createViewport(
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
    const lease = await harness.reader.presentation.createViewport(
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
  // Arrange: the learner stays following the current run after closing its Application pane.
  const harness = await workspaceHarness()
  try {
    await harness.reader.open()
    await harness.reader.presentation.createViewport(
      'live-run',
      () => {},
      () => {},
      'normal',
    )
    harness.reader['app']!.dispose()
    await readerSeams(harness).refresh()
    const linesBeforeTheNewRun = [...harness.postedMessages().at(-1)!.errors]

    // Act: a new run takes its viewport lease, which opens the pane again.
    await harness.reader.presentation.createViewport(
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

for (const holder of ['the captured source', 'the Study pane'] as const)
  // Value: protects=the keyboard after Close Study Workspace when a Codebook pane or the captured source had it: the editor group that remains gets it; fails_when=the tabs are closed without moving the focus and nothing is focused afterwards, so the keyboard is on the page body until the learner clicks; why_new=Cycle 0045 cause 12 (f) (obs15 P4: `document.activeElement` was the page body after Close, twice); seam=the workspace harness's keyboardOnBody, focusMutableDraft
  test(`Close Study Workspace made with the keyboard in ${holder} leaves the keyboard in the editor group that remains`, async () => {
    // Arrange: the learner's file is a tab of the first group; the reader is open and the keyboard is in one of its panes.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      harness.focusMutableDraft('actions.ts', 1)
      await harness.reader.open()
      if (holder === 'the captured source')
        await harness.editor.window.showTextDocument(
          harness.editor.window.visibleTextEditors.find(
            (editor) => editor.viewColumn === 2,
          )!.document,
          { viewColumn: 2, preserveFocus: false },
        )
      const before = {
        keyboardInSource:
          harness.editor.window.activeTextEditor?.viewColumn === 2,
        keyboardInStudyPane: harness.focusedPanel() === 'codebook.studyContext',
      }

      // Act
      await harness.reader.close()

      // Assert
      assert.deepEqual(before, {
        keyboardInSource: holder === 'the captured source',
        keyboardInStudyPane: holder === 'the Study pane',
      })
      assert.equal(harness.reader.presentationState().state, 'closed')
      assert.equal(harness.keyboardOnBody(), false)
      assert.equal(
        harness.commands.at(-1),
        'workbench.action.focusActiveEditorGroup',
      )
    } finally {
      await harness.close()
    }
  })

for (const keyboardBeforePalette of ['the terminal', 'the Study pane'] as const)
  // Value: protects=the learner told where the keyboard is after "Codebook: Close Study Workspace" from the Command Palette while the Study pane is the active editor, whether the keyboard was in that pane or in the terminal before the palette opened; fails_when=Close moves the keyboard to the active editor group without a word, so a learner who was typing in the terminal finds the keyboard in an editor; why_new=Cycle 0046 row 1 (Cycle 0045 study-1 #5: the extension API reads the same for both cases, and the Study pane reports a blur in both before the command runs); seam=the workspace harness's information messages and command log, the Study pane's pane-focus report
  test(`Close Study Workspace from the Command Palette with the keyboard in ${keyboardBeforePalette} gives the active editor group the keyboard and says so`, async () => {
    // Arrange: the Study pane is the active editor. With the keyboard in the terminal its document reported a blur when the learner left it; with the keyboard in the pane it reported focus, and a blur when the palette opened. The editor's API reads the same in both cases.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      harness.focusMutableDraft('actions.ts', 1)
      await harness.reader.open()
      const studyPaneActive = harness.focusedPanel() === 'codebook.studyContext'
      if (keyboardBeforePalette === 'the Study pane')
        await readerSeams(harness).receive(
          { type: 'pane-focus', focused: true },
          'context',
        )
      await readerSeams(harness).receive(
        { type: 'pane-focus', focused: false },
        'context',
      )

      // Act
      await harness.reader.close()

      // Assert
      assert.equal(studyPaneActive, true)
      assert.equal(harness.reader.presentationState().state, 'closed')
      assert.equal(
        harness.commands.at(-1),
        'workbench.action.focusActiveEditorGroup',
      )
      assert.deepEqual(
        harness.informationMessages.map((message) => message.message),
        [
          'Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.',
        ],
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the keyboard after Close Study Workspace in an editor that closes a disposed pane's tab a moment after the disposal, as Cursor and VS Code do: the group that remains gets the keyboard once the panes' tabs are gone; fails_when=the focus command runs right after the disposal, reaches the group that still shows the closing Application pane, and the keyboard goes with that tab to the page body; why_new=Cycle 0045 cause 12 (f), second native result (obs15 R, `e-after.dom.json`: `document.activeElement` is the page body after Close with the caret in the captured source; the first fix passed its test because the fake editor closed the panes' tabs at once); seam=the workspace harness's closeDisposedPanelTabsLater and keyboardOnBody
test("Close Study Workspace made with the keyboard in the captured source leaves the keyboard in the editor group that remains when the editor closes the panes' tabs a moment later", async () => {
  // Arrange: the learner's file is a tab of the first group; the reader is open, the keyboard is in the captured source, and the editor closes a disposed pane's tab 20 ms after the disposal and removes a group its last tab left empty.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.closeDisposedPanelTabsLater()
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    await harness.editor.window.showTextDocument(
      harness.editor.window.visibleTextEditors.find(
        (editor) => editor.viewColumn === 2,
      )!.document,
      { viewColumn: 2, preserveFocus: false },
    )
    const keyboardInSource =
      harness.editor.window.activeTextEditor?.viewColumn === 2

    // Act
    await harness.reader.close()
    // Longer than the fake editor's delay for a disposed pane's tab.
    await new Promise((resolve) => setTimeout(resolve, 60))

    // Assert
    assert.equal(keyboardInSource, true)
    assert.equal(harness.reader.presentationState().state, 'closed')
    assert.equal(harness.counts().panels, 0)
    assert.deepEqual(
      harness.groups.map((group) => group.viewColumn),
      [1],
    )
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(
      harness.commands.at(-1),
      'workbench.action.focusActiveEditorGroup',
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner whose own file is the active editor when "Codebook: Close Study Workspace" runs: the active editor group has it once the panes' groups are closed, and the learner is told once in an editor session where it is; fails_when=Close runs its focus command only when a pane or the captured source was active, the editor rebuilds its grid as the closed tabs' groups leave, and the keyboard is on the page body until the learner clicks (Cursor 3.23.12, two of two takes), or the sentence comes at every Close; why_new=Cycle 0046 row 66 (native check (c) of row 1; this replaces the Cycle 0045 test "Close Study Workspace made with the keyboard in the learner's own file runs no focus command", whose rule left that keyboard on the page body); seam=the workspace harness's closeDisposedPanelTabsLater, loseKeyboardWhenGroupCloses, keyboardOnBody, command log and information messages
test("Close Study Workspace made with the learner's own file active gives the active editor group the keyboard once the panes' groups closed, and says where it is once in an editor session", async () => {
  // Arrange: the editor closes a disposed pane's tab 20 ms after the disposal, removes the group that tab left empty 57 ms after that, and lets the keyboard fall to the page body when a group goes; the reader is open and the learner's file in the first group is the active editor.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.closeDisposedPanelTabsLater()
  harness.removeEmptiedGroupsLater()
  harness.loseKeyboardWhenGroupCloses()
  try {
    await harness.reader.open()
    const learnerFile = harness.focusMutableDraft('actions.ts', 1)
    const groupsBeforeClose = harness.groups.length

    // Act: Close, and longer than the fake editor takes to remove an emptied group; then the Study workspace is opened and closed once more in the same editor session.
    await harness.reader.close()
    await new Promise((resolve) => setTimeout(resolve, 120))
    const afterFirstClose = {
      groups: harness.groups.length,
      keyboardOnBody: harness.keyboardOnBody(),
      lastCommand: harness.commands.at(-1),
      panels: harness.counts().panels,
      activeDocument: harness.editor.window.activeTextEditor?.document,
      sentences: harness.informationMessages.map((message) => message.message),
    }
    await harness.reader.open()
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.close()
    await new Promise((resolve) => setTimeout(resolve, 120))

    // Assert
    assert.equal(groupsBeforeClose, 3)
    assert.deepEqual(afterFirstClose, {
      groups: 1,
      keyboardOnBody: false,
      lastCommand: 'workbench.action.focusActiveEditorGroup',
      panels: 0,
      activeDocument: learnerFile.document,
      sentences: [
        'Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.',
      ],
    })
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(
      harness.commands.at(-1),
      'workbench.action.focusActiveEditorGroup',
    )
    // The second Close of the session tells nothing more.
    assert.equal(harness.informationMessages.length, 1)
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner reading the notice of Close Study Workspace once in an editor session, also after the workspace folders changed and the extension made a new reader; fails_when=the mark "told once" is kept with the reader, which a change of the workspace folders disposes, so the same sentence is told again in one editor session; why_new=Cycle 0046 row 174 (delegated review, finding 11); seam=the workspace harness's createReader (a second reader from the same loaded module, as the extension makes one), focusMutableDraft and information messages
test('the notice of Close Study Workspace is not told again in the same editor session by the reader that replaces a disposed one after the workspace folders changed', async () => {
  // Arrange: the first reader of the editor session closed its Study workspace beside the learner's file and told where the keyboard is.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  let replacement: ReturnType<typeof harness.createReader> | undefined
  try {
    await harness.reader.open()
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.close()
    const sentencesOfFirstReader = harness.informationMessages.map(
      (message) => message.message,
    )

    // Act: the workspace folders change: the extension disposes its reader and makes a new one, whose Study workspace is opened and closed the same way.
    await harness.reader.dispose()
    replacement = harness.createReader()
    await replacement.open()
    harness.focusMutableDraft('actions.ts', 1)
    await replacement.close()

    // Assert: the second Close settled the keyboard and told nothing more.
    assert.deepEqual(sentencesOfFirstReader, [
      'Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.',
    ])
    assert.equal(
      harness.commands.at(-1),
      'workbench.action.focusActiveEditorGroup',
    )
    assert.equal(harness.informationMessages.length, 1)
  } finally {
    await replacement?.dispose()
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner who types in the terminal beside a file when the workspace folders change and the extension disposes its reader: no focus command runs and nothing is told; fails_when=a reader's disposal runs the Close of the command, which gives the active editor group the keyboard beside a learner's file, so a folder added to the workspace moves the keyboard without a word; why_new=Cycle 0046 row 174 (delegated review, finding 11: a reader that is disposed moves no keyboard); seam=the workspace harness's focusMutableDraft, command log and information messages
test("a reader that is disposed while its Study workspace is open beside the learner's own file runs no focus command and tells nothing", async () => {
  // Arrange: the Study workspace is open and the learner's file in the first group is the active editor.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    await harness.reader.open()
    harness.focusMutableDraft('actions.ts', 1)
    const commandsBefore = harness.commands.length

    // Act: the workspace folders change, and the extension disposes its reader.
    await harness.reader.dispose()

    // Assert
    assert.equal(harness.counts().panels, 0)
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .some((command) => /^workbench\.action\.focus/.test(command)),
      false,
    )
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    await harness.close()
  }
})

for (const wrapperRefresh of [false, true])
  test(`native disposal preserves the learner's actual auth keyboard and original file beside both owned panes with group wrapper refresh ${wrapperRefresh}`, async () => {
    // Arrange: native controls 447–449 retain login behind App and auth in the other learner group.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.modelNativeTabCloseFocus()
    if (wrapperRefresh) harness.replaceGroupObjectsOnTabChanges()
    try {
      const login = harness.focusMutableDraft('login-form.tsx', 1)
      await harness.reader.open()
      const auth = harness.focusMutableDraft('auth.ts', 2)
      const commandsBefore = harness.commands.length
      const requestsBefore = harness.tabCloseFocusRequests().length
      assert.equal(harness.groups.length, 3)
      assert.equal(harness.keyboardOnBody(), false)

      // Act: a same-host folder change disposes the reader while auth owns native keyboard.
      await harness.reader.dispose()
      await waitUntil(() => harness.groups.length === 2, 'owned group removal')

      // Assert: native restoration retains auth; false for the nonempty App group would select login instead.
      assert.equal(harness.keyboardOnBody(), false)
      assert.equal(
        harness.editor.window.activeTextEditor?.document,
        auth.document,
      )
      assert.equal(harness.editor.window.activeTextEditor?.viewColumn, 2)
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(login.tab)),
        true,
      )
      assert.equal(
        harness.groups.some((group) => group.tabs.includes(auth.tab)),
        true,
      )
      assert.deepEqual(harness.tabCloseFocusRequests().slice(requestsBefore), [
        true,
        true,
        false,
      ])
      assert.equal(harness.counts().panels, 0)
      assert.deepEqual(
        harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
        [],
      )
      assert.deepEqual(harness.informationMessages, [])
    } finally {
      await harness.close()
    }
  })

for (const outsideInput of ['terminal', 'sidebar chat'])
  test(`native disposal leaves the ${outsideInput} keyboard outside the editor while auth remains the reported active editor`, async () => {
    // Arrange: both native controls 451–457 hold an input outside the editor-part DOM container.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.modelNativeTabCloseFocus()
    try {
      harness.focusMutableDraft('login-form.tsx', 1)
      await harness.reader.open()
      const auth = harness.focusMutableDraft('auth.ts', 2)
      harness.focusView()
      const commandsBefore = harness.commands.length

      // Act
      await harness.reader.dispose()
      await waitUntil(() => harness.groups.length === 2, 'owned group removal')

      // Assert: activeTextEditor alone does not grant editor ownership of keyboard.
      assert.equal(harness.keyboardInView(), true)
      assert.equal(harness.keyboardOnBody(), false)
      assert.equal(
        harness.editor.window.activeTextEditor?.document,
        auth.document,
      )
      assert.deepEqual(
        harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
        [],
      )
      assert.deepEqual(harness.informationMessages, [])
    } finally {
      await harness.close()
    }
  })

test('native disposal of a captured-source-only ending group preserves the actual learner editor keyboard', async () => {
  // Arrange: no pane owns this last group; the captured source is still reader-owned.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.modelNativeTabCloseFocus()
  try {
    await harness.reader['initialize']()
    harness.groups[1]!.tabs = []
    const captured = harness.restoreLeftoverCapturedSource({
      column: 2,
      active: false,
    })
    const auth = harness.focusMutableDraft('auth.ts', 1)
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.dispose()

    // Assert: false for this ending group lets the host restore auth without an extension focus command.
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document,
      auth.document,
    )
    assert.equal(harness.groups.length, 1)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(captured)),
      false,
    )
    assert.deepEqual(harness.tabCloseFocusRequests(), [false])
    assert.deepEqual(
      harness.commands
        .slice(commandsBefore)
        .filter((command) => /^workbench\.action\.focus/.test(command)),
      [],
    )
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    await harness.close()
  }
})

test('native tab disposal callbacks do not erase the once-only keyboard notice when the reader closes its active Study pane', async () => {
  // Arrange: native tab close synchronously disposes the panel before close() resumes.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.modelNativeTabCloseFocus()
  try {
    harness.focusMutableDraft('login-form.tsx', 1)
    await harness.reader.open()
    harness.focusMutableDraft('auth.ts', 2)
    // Remove the captured source first: the later notice must depend on the panels whose native closes clear their fields.
    await harness.editor.window.tabGroups.close(
      harness.groups
        .flatMap((group) => group.tabs)
        .filter(
          (tab) =>
            tab.input instanceof harness.editor.TabInputText &&
            tab.input.uri.scheme === 'codebook-source',
        ),
      true,
    )
    await harness.reader.action('focus-context')
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.dispose()

    // Assert: eligibility captured before native callbacks survives cleared panel fields.
    assert.equal(harness.counts().panels, 0)
    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(
      harness.commands
        .slice(commandsBefore)
        .filter((command) => /^workbench\.action\.focus/.test(command)),
      ['workbench.action.focusActiveEditorGroup'],
    )
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.',
      ],
    )
  } finally {
    await harness.close()
  }
})

test('native disposal retains another reader source and inherited pane instead of treating their group as ending', async () => {
  // Arrange: an inherited pane and a foreign captured source are learner-owned from this reader's perspective.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.modelNativeTabCloseFocus()
  try {
    const inherited = harness.leaveDeadCodebookPane('codebook.studyContext', 2)
    const foreignSource = harness.restoreLeftoverCapturedSource({
      authority: 'f'.repeat(64),
      column: 2,
      active: false,
    })
    const replacement = harness.createReader()
    await replacement['initialize']()
    const captured = harness.restoreLeftoverCapturedSource({
      column: 2,
      active: false,
    })
    const auth = harness.focusMutableDraft('auth.ts', 1)
    const requestsBefore = harness.tabCloseRequests().length

    // Act
    await replacement.dispose()

    // Assert: ownership, not webview type or URI scheme alone, governs native close and focus flags.
    const closed = harness.tabCloseRequests().slice(requestsBefore).flat()
    assert.equal(closed.includes(captured), true)
    assert.equal(closed.includes(foreignSource), false)
    assert.equal(closed.includes(inherited), false)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(foreignSource)),
      true,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(inherited)),
      true,
    )
    assert.deepEqual(harness.tabCloseFocusRequests().slice(requestsBefore), [
      true,
    ])
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(
      harness.editor.window.activeTextEditor?.document,
      auth.document,
    )
  } finally {
    await harness.close()
  }
})

test('native disposal preserves a rebuilt inherited pane while a current owned Study pane remains open after an earlier close', async () => {
  // Arrange: runtime-first pane creation can coexist with an inherited pane before a cold Open clears leftovers.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.modelNativeTabCloseFocus()
  const inherited = harness.leaveDeadCodebookPane('codebook.studyContext', 2)
  const replacement = harness.createReader()
  let closing: Promise<void> | undefined
  const held = harness.holdNextTabCloseResponse()
  try {
    await replacement['initialize']()
    replacement['ensureApp']()
    replacement['ensureContext']()
    const auth = harness.focusMutableDraft('auth.ts', 1)
    closing = replacement.dispose()
    await held.started
    const refreshedInherited = { ...inherited }
    harness.replaceEditorGroup('wrapper', 2, (tabs) => {
      tabs[tabs.indexOf(inherited)] = refreshedInherited
    })

    // Act: the next close sees current tab objects while its own Study panel still exists.
    held.release()
    await closing

    // Assert: wrapper replacement cannot give the earlier host's pane to this reader.
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(refreshedInherited)),
      true,
    )
    assert.equal(
      harness.tabCloseRequests().flat().includes(refreshedInherited),
      false,
    )
    assert.equal(
      harness.editor.window.activeTextEditor?.document,
      auth.document,
    )
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(harness.counts().panels, 0)
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    held.release()
    await closing?.catch(() => undefined)
    await replacement.close()
    await harness.close()
  }
})

test('native disposal refuses indistinguishable rebuilt same-kind panes in its current panel group and preserves both tabs', async () => {
  // Arrange: an inherited Study and this reader's Study share the same group, then both wrappers are rebuilt.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] })
  harness.modelNativeTabCloseFocus()
  const inherited = harness.leaveDeadCodebookPane('codebook.studyContext', 3)
  const replacement = harness.createReader()
  const held = harness.holdNextTabCloseResponse()
  let closing: Promise<unknown> | undefined
  try {
    await replacement['initialize']()
    replacement['ensureApp']()
    replacement['ensureContext']()
    const auth = harness.focusMutableDraft('auth.ts', 1)
    closing = replacement.dispose().then(
      () => 'closed',
      (error: unknown) => String(error),
    )
    await held.started
    const refreshedInherited = { ...inherited }
    harness.replaceEditorGroup('wrapper', 3, (tabs) => {
      for (let index = 0; index < tabs.length; index++)
        tabs[index] =
          tabs[index] === inherited ? refreshedInherited : { ...tabs[index]! }
    })
    const before = [
      ...harness.groups.find((group) => group.viewColumn === 3)!.tabs,
    ]

    // Act
    held.release()
    const result = await closing

    // Assert: view type and column cannot distinguish these tabs, so none is deleted or forcibly disposed.
    assert.equal(
      result,
      'Error: Codebook cannot distinguish its current pane tab from another pane of the same kind. The remaining panes were left open. Keep the pane you need, close the duplicate Codebook pane tab, then try Close Study Workspace again.',
    )
    assert.deepEqual(
      harness.groups.find((group) => group.viewColumn === 3)!.tabs,
      before,
    )
    assert.equal(harness.counts().panels, 1)
    assert.equal(
      harness.editor.window.activeTextEditor?.document,
      auth.document,
    )
    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(harness.informationMessages, [])
    // Follow the refusal's remedy through the native tab API, then retry the real Close before fixture teardown.
    await harness.editor.window.tabGroups.close([refreshedInherited], true)
    await replacement.close()
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(refreshedInherited)),
      false,
    )
    assert.equal(harness.counts().panels, 0)
    assert.equal(
      harness.editor.window.activeTextEditor?.document,
      auth.document,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(auth.tab)),
      true,
    )
    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(harness.informationMessages, [])
  } finally {
    held.release()
    await closing
    await replacement.close()
    await harness.close()
  }
})

for (const originalGroups of [1, 2])
  test(`recording reentry retires the reader-created Context group after wrapper refresh when ${originalGroups} learner groups existed before Open`, async () => {
    // Arrange: Context occupies a group created by Open, unlike the learner's preexisting empty third group.
    const harness = await articleRecordingLayoutHarness(true, true)
    harness.useNativeLayout({
      orientation: 0,
      groups: Array.from({ length: originalGroups }, () => ({})),
    })
    harness.replaceGroupObjectsOnTabChanges()
    const draft = harness.focusMutableDraft('auth.ts', 1)
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      assert.equal(harness.groups.length, 3)
      harness.resyncEditorGroups()
      const application = harness.reader['app']

      // Act: recording reentry may retire only its own unchanged created group.
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()

      // Assert: a created Source split retires; an original Wiki group survives beside the newly added App.
      assert.equal(harness.groups.length, originalGroups === 1 ? 2 : 3)
      assert.equal(
        isProportionalEditorLayout(harness.editorLayout(), {
          orientation: 1,
          groups:
            originalGroups === 1
              ? [{ size: 0.5 }, { size: 0.5 }]
              : [{ size: 0.25 }, { size: 0.25 }, { size: 0.5 }],
        }),
        true,
      )
      if (originalGroups === 2)
        assert.equal(
          harness.groups
            .find((group) => group.viewColumn === 3)
            ?.tabs.some(
              (tab) =>
                tab.input instanceof harness.editor.TabInputWebview &&
                tab.input.viewType === 'codebook.repositoryWiki',
            ),
          true,
        )
      assert.equal(harness.controller.state().readiness, 'ready')
      assert.equal(harness.reader['app'], application)
      assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1)
      assert.equal(harness.sourceColumn(), 2)
      assert.equal(harness.displayedImage(), harness.png.toString('base64'))
      assert.equal(
        harness.groups
          .flatMap((group) => group.tabs)
          .some(
            (tab) =>
              tab.input instanceof harness.editor.TabInputText &&
              tab.input.uri.toString() === draft.document.uri.toString(),
          ),
        true,
      )
      assert.equal(draft.document.getText(), 'Original learner draft.\n')
    } finally {
      await harness.close()
    }
  })

for (const laterChoice of [
  'pinned capture',
  'dirty draft',
  'replacement group',
])
  test(`recording keeps a reader-created source group after the learner adds a ${laterChoice}`, async () => {
    // Arrange
    const harness = await articleRecordingLayoutHarness(true, true)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.replaceGroupObjectsOnTabChanges()
    const original = harness.focusMutableDraft('auth.ts', 1)
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      const source = harness.editor.window.visibleTextEditors.find(
        (editor) => editor.viewColumn === 2,
      )
      assert.ok(source)
      const sourceUri = source.document.uri.toString(),
        sourceText = source.document.getText()
      let draft: ReturnType<typeof harness.focusMutableDraft> | undefined
      if (laterChoice === 'pinned capture') {
        const tab = harness.groups
          .find((group) => group.viewColumn === 2)
          ?.tabs.find(
            (tab) =>
              tab.input instanceof harness.editor.TabInputText &&
              tab.input.uri.toString() === sourceUri,
          )
        assert.ok(tab)
        tab.isPinned = true
      } else if (laterChoice === 'dirty draft') {
        draft = harness.focusMutableDraft('source-notes.txt', 2)
        harness.focusExistingSource(source)
      } else harness.replaceEditorGroup('opened', 2)

      // Act
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        true,
        undefined,
        harness.origin,
      )
      await harness.controller.settle()

      // Assert: App adds a group, while the adopted/replaced original Source group survives in column three.
      assert.equal(harness.groups.length, 3)
      assert.equal(harness.controller.state().readiness, 'ready')
      assert.equal(harness.displayedImage(), harness.png.toString('base64'))
      assert.equal(original.document.getText(), 'Original learner draft.\n')
      if (laterChoice === 'pinned capture') {
        assert.equal(
          harness.groups
            .find((group) => group.viewColumn === 3)
            ?.tabs.some(
              (tab) =>
                tab.isPinned &&
                tab.input instanceof harness.editor.TabInputText &&
                tab.input.uri.toString() === sourceUri,
            ),
          true,
        )
        assert.equal(source.document.getText(), sourceText)
      }
      if (draft) {
        assert.equal(draft.document.getText(), 'Original learner draft.\n')
        // Context retirement rebuilds Cursor's wrappers before App insertion; use the current native group rather than an old editor object.
        assert.equal(
          harness.groups.find((group) =>
            group.tabs.some(
              (tab) =>
                tab.input instanceof harness.editor.TabInputText &&
                tab.input.uri.toString() === draft.document.uri.toString(),
            ),
          )?.viewColumn,
          3,
        )
      }
    } finally {
      await harness.close()
    }
  })

for (const laterChoice of ['new source', 'new source with chat', 'Close'])
  test(`recording source-group retirement stops after ${laterChoice} while its native copy waits`, async () => {
    // Arrange: hold only the actual native copy response, after the same document has appeared in its new group.
    const harness = await articleRecordingLayoutHarness(true, true)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.replaceGroupObjectsOnTabChanges()
    const original = harness.focusMutableDraft('auth.ts', 1)
    const chat =
      laterChoice === 'new source with chat'
        ? harness.addSeparateEditorPart()
        : undefined
    const show = harness.editor.window.showTextDocument
    let release = (): void => {},
      entered = (): void => {},
      opening: Promise<unknown> | undefined,
      closing: Promise<void> | undefined
    const held = new Promise<void>((resolve) => {
        release = resolve
      }),
      started = new Promise<void>((resolve) => {
        entered = resolve
      })
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      chat?.focusTab()
      const sourceUri = harness.reader.inspect().sourceUri,
        commandsBeforeRecording = harness.commands.length
      harness.editor.window.showTextDocument = async (document, options) => {
        const shown = await show(document, options)
        if (
          shown.document.uri.toString() === sourceUri &&
          options?.viewColumn === 2 &&
          harness.commands
            .slice(commandsBeforeRecording)
            .includes('workbench.action.newGroupAbove')
        ) {
          entered()
          await held
        }
        return shown
      }
      opening = harness.reader
        .openRepositoryEvidence(
          harness.binding,
          true,
          undefined,
          harness.origin,
        )
        .then(
          () => 'opened',
          (error: unknown) => String(error),
        )
      assert.equal(
        await Promise.race([
          started.then(() => 'copy reached'),
          opening.then(String),
        ]),
        'copy reached',
      )
      assert.equal(
        harness.groups
          .find((group) => group.viewColumn === 3)
          ?.tabs.some(
            (tab) =>
              tab.input instanceof harness.editor.TabInputText &&
              tab.input.uri.toString() === sourceUri,
          ),
        true,
      )

      // Act
      const draft =
        laterChoice !== 'Close'
          ? harness.focusMutableDraft('later-choice.txt', 2)
          : undefined
      if (laterChoice === 'Close') closing = harness.reader.close()
      release()
      const result = await opening
      await closing

      // Assert: the old entry cannot succeed or close a source group after losing its input/lifetime authority.
      assert.notEqual(result, 'opened')
      assert.equal(original.document.getText(), 'Original learner draft.\n')
      if (draft) {
        assert.equal(
          harness.editor.window.activeTextEditor?.document.uri.toString(),
          draft.document.uri.toString(),
        )
        assert.equal(draft.document.getText(), 'Original learner draft.\n')
        assert.equal(harness.groups.length, chat ? 4 : 3)
        harness.editor.window.showTextDocument = show
        await harness.reader.openRepositoryEvidence(
          harness.binding,
          true,
          undefined,
          harness.origin,
        )
        await harness.controller.settle()
        assert.equal(harness.controller.state().readiness, 'ready')
        assert.equal(harness.groups.length, chat ? 3 : 2)
        assert.equal(draft.document.getText(), 'Original learner draft.\n')
      } else assert.equal(harness.reader.inspect().opened, false)
    } finally {
      release()
      await opening
      await closing
      harness.editor.window.showTextDocument = show
      await harness.close()
    }
  })

for (const refusedClose of [false, true])
  test(`recording retry retires its created Context group after newer input interrupts native scope measurement${refusedClose ? ' and the native close is refused once' : ''}`, async (context) => {
    // Arrange: this hold is the actual scope borrow before App allocation, not the later source copy.
    const harness = await articleRecordingLayoutHarness(true, true)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.replaceGroupObjectsOnTabChanges()
    const original = harness.focusMutableDraft('auth.ts', 1),
      chat = harness.addSeparateEditorPart(),
      show = harness.editor.window.showTextDocument
    let release = (): void => {},
      entered = (): void => {},
      opening: Promise<string> | undefined
    const held = new Promise<void>((resolve) => {
        release = resolve
      }),
      started = new Promise<void>((resolve) => {
        entered = resolve
      })
    try {
      await harness.reader.openRepositoryEvidence(
        harness.binding,
        false,
        undefined,
        harness.origin,
      )
      chat.focusTab()
      const sourceUri = harness.reader.inspect().sourceUri,
        commandsBefore = harness.commands.length
      harness.editor.window.showTextDocument = async (document, options) => {
        const shown = await show(document, options)
        if (
          shown.document.uri.toString() === sourceUri &&
          options?.viewColumn === 2
        ) {
          entered()
          await held
        }
        return shown
      }
      opening = harness.reader
        .openRepositoryEvidence(
          harness.binding,
          true,
          undefined,
          harness.origin,
        )
        .then(
          () => 'opened',
          (error: unknown) => String(error),
        )
      assert.equal(
        await Promise.race([started.then(() => 'scope reached'), opening]),
        'scope reached',
      )
      assert.equal(
        harness.commands
          .slice(commandsBefore)
          .includes('workbench.action.newGroupAbove'),
        false,
      )
      const draft = harness.focusMutableDraft('later-scope-choice.txt', 2)
      enableFakeClock(context)
      release()
      await advanceClockUntilSettled(context, opening, 6_000)
      assert.notEqual(await opening, 'opened')
      resetFakeClock(context)
      harness.editor.window.showTextDocument = show
      assert.equal(
        harness.groups.find((group) => group.viewColumn === 3)?.tabs.length,
        0,
      )
      const closedColumns: number[] = [],
        changed = harness.editor.window.tabGroups.onDidChangeTabGroups(
          (event) => {
            closedColumns.push(...event.closed.map((group) => group.viewColumn))
          },
        )
      try {
        if (refusedClose) {
          const nativeClose = harness.editor.window.tabGroups.close,
            beforeRetry = harness.commands.length
          let refused = false
          harness.editor.window.tabGroups.close = async (
            tabs,
            preserveFocus,
          ) => {
            if (
              !Array.isArray(tabs) &&
              tabs.viewColumn === 3 &&
              !tabs.tabs.length
            ) {
              refused = true
              return false
            }
            return nativeClose(tabs, preserveFocus)
          }
          try {
            await assert.rejects(
              harness.reader.openRepositoryEvidence(
                harness.binding,
                true,
                undefined,
                harness.origin,
              ),
            )
            assert.equal(refused, true)
            assert.equal(
              harness.commands
                .slice(beforeRetry)
                .includes('workbench.action.newGroupAbove'),
              false,
            )
            assert.deepEqual(closedColumns, [])
          } finally {
            harness.editor.window.tabGroups.close = nativeClose
          }
        }
        // Act: Context was already disposed, but its proved empty group is still this reader's to retire on retry.
        await harness.reader.openRepositoryEvidence(
          harness.binding,
          true,
          undefined,
          harness.origin,
        )
        await harness.controller.settle()

        // Assert: the adopted Source group and chat survive; only the old empty Context closes.
        assert.deepEqual(closedColumns, [3])
        assert.equal(harness.groups.length, 4)
        assert.equal(harness.controller.state().readiness, 'ready')
        assert.equal(harness.displayedImage(), harness.png.toString('base64'))
        assert.equal(original.document.getText(), 'Original learner draft.\n')
        assert.equal(draft.document.getText(), 'Original learner draft.\n')
        // The old editor object may still name its pre-retirement wrapper; the current native group owns this preserved document.
        assert.equal(
          harness.groups.find((group) =>
            group.tabs.some(
              (tab) =>
                tab.input instanceof harness.editor.TabInputText &&
                tab.input.uri.toString() === draft.document.uri.toString(),
            ),
          )?.viewColumn,
          3,
        )
        assert.equal(
          harness.groups
            .find((group) => group.viewColumn === 4)
            ?.tabs.includes(chat.tab),
          true,
        )
      } finally {
        changed.dispose()
      }
    } finally {
      release()
      resetFakeClock(context)
      await opening
      harness.editor.window.showTextDocument = show
      await harness.close()
    }
  })

test('an empty learner third group added after the first Open note remains after retry and recording reentry', async () => {
  // Arrange: first Open notes two groups; the learner adds a third before the fresh native reservation/creation.
  const harness = await articleRecordingLayoutHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  const draft = harness.focusMutableDraft('auth.ts', 1)
  const originalNote = harness.reader['noteLayoutBeforeOpen']
  const note = originalNote.bind(harness.reader)
  let changed = false
  harness.reader['noteLayoutBeforeOpen'] = (
    ...arguments_: Parameters<typeof note>
  ): void => {
    note(...arguments_)
    if (changed) return
    changed = true
    queueMicrotask(() => {
      void harness.editor.commands.executeCommand('vscode.setEditorLayout', {
        orientation: 0,
        groups: [{ size: 1 }, { size: 1 }, { size: 1 }],
      })
    })
  }
  try {
    await harness.reader
      .openRepositoryEvidence(harness.binding, false, undefined, harness.origin)
      .catch(() => undefined)
    // The explicit retry preserves a partial Open's original-layout note, but must not treat that stale count as creation evidence.
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    await harness.reader.action('return-wiki')

    // Explicit Study had arranged the added group; Return cannot restore its stale two-group origin over that third group.
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })

    // Act
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()

    // Assert: actual reservation measured three learner groups, so Context borrowed the third.
    assert.equal(changed, true)
    assert.equal(harness.groups.length, 4)
    assert.deepEqual(harness.editorLayout(), {
      orientation: 0,
      groups: [
        { size: 0.55, groups: [{ size: 0.25 }, { size: 0.25 }, { size: 0.5 }] },
        { size: 0.45 },
      ],
    })
    assert.equal(harness.controller.state().readiness, 'ready')
    assert.equal(draft.document.getText(), 'Original learner draft.\n')
  } finally {
    harness.reader['noteLayoutBeforeOpen'] = originalNote
    await harness.close()
  }
})

test('a learner replacement of the pending created Context group cannot inherit its receipt after failed placement and retry', async () => {
  // Arrange: direct Context creation has not yet sealed its group identity when the first placement read waits.
  const harness = await articleRecordingLayoutHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.focusMutableDraft('auth.ts', 1)
  let held: ReturnType<typeof harness.holdNextCommand> | undefined
  harness.onNextPanel('codebook.studyContext', () => {
    held = harness.holdNextCommand('vscode.getEditorLayout')
  })
  let opening: Promise<string> | undefined
  try {
    opening = harness.reader
      .openRepositoryEvidence(harness.binding, false, undefined, harness.origin)
      .then(
        () => 'opened',
        (error: unknown) => String(error),
      )
    await waitUntil(() => Boolean(held), 'pending Context placement read')
    assert.ok(held)
    await held.started
    // The native group is replaced while the exact panel survives, as after a learner moves it and closes its old group.
    harness.replaceEditorGroup('opened', 3)

    // Act: retain the partial panes, retry, and then enter recording in that learner-owned replacement group.
    held.release()
    const firstResult = await opening
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()

    // Assert: a same-numbered group is a new learner group, never the reservation's original group.
    assert.match(
      firstResult,
      /Native pane, group or focus changed while presentation waited/,
    )
    assert.equal(harness.groups.length, 4)
    assert.equal(harness.controller.state().readiness, 'ready')
  } finally {
    held?.release()
    await opening
    await harness.close()
  }
})

test('a learner replacement during the post-reservation layout read cannot be claimed as the created Context group', async () => {
  // Arrange: the actual reservation created group3, but its ownership read has not returned yet.
  const harness = await articleRecordingLayoutHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.focusMutableDraft('auth.ts', 1)
  const originalRemember = harness.reader['rememberLayout']
  const remember = originalRemember.bind(harness.reader)
  let held: ReturnType<typeof harness.holdNextCommand> | undefined
  harness.reader['rememberLayout'] = (
    ...arguments_: Parameters<typeof remember>
  ) => {
    if (!held && !harness.reader['contextPanel'])
      held = harness.holdNextCommand('vscode.getEditorLayout')
    return remember(...arguments_)
  }
  let opening: Promise<unknown> | undefined
  try {
    opening = harness.reader.openRepositoryEvidence(
      harness.binding,
      false,
      undefined,
      harness.origin,
    )
    await waitUntil(() => Boolean(held), 'post-reservation ownership read')
    assert.ok(held)
    await held.started
    harness.replaceEditorGroup('opened', 3)

    // Act: the read's ownership refusal may retain native effects, but cannot re-query the replacement column as proof of creation.
    held.release()
    await opening
    await harness.reader.openRepositoryEvidence(
      harness.binding,
      true,
      undefined,
      harness.origin,
    )
    await harness.controller.settle()

    // Assert
    assert.equal(harness.groups.length, 3)
    assert.equal(harness.controller.state().readiness, 'ready')
  } finally {
    held?.release()
    await opening?.catch(() => undefined)
    harness.reader['rememberLayout'] = originalRemember
    await harness.close()
  }
})

for (const laterChange of [
  'learner tab',
  'reordered groups',
  'new tab objects',
  'window focus lost',
])
  test(`native disposal rereads the current tab groups after an earlier close answer waits for ${laterChange}`, async () => {
    // Arrange: App closes first; its native response is held while later groups remain open.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
    harness.modelNativeTabCloseFocus()
    harness.replaceGroupObjectsOnTabChanges()
    let closing: Promise<void> | undefined
    const held = harness.holdNextTabCloseResponse()
    try {
      harness.focusMutableDraft('login-form.tsx', 1)
      await harness.reader.open()
      const auth = harness.focusMutableDraft('auth.ts', 2)
      const requestsBefore = harness.tabCloseFocusRequests().length
      const commandsBefore = harness.commands.length
      closing = harness.reader.dispose()
      await held.started
      const studyGroup = harness.groups.find((group) => group.viewColumn === 3)!
      const studyTab = studyGroup.tabs[0]!
      let laterLearnerTab: typeof auth.tab | undefined
      if (laterChange === 'learner tab') {
        laterLearnerTab = harness.focusMutableDraft('later-notes.ts', 3).tab
        harness.focusExistingSource(auth.editor)
      } else if (laterChange === 'reordered groups') {
        harness.swapEditorGroups(
          studyGroup,
          harness.groups.find((group) => group.tabs.includes(auth.tab))!,
        )
        harness.groups.reverse()
      } else if (laterChange === 'new tab objects') {
        const refreshedTab = { ...studyTab }
        studyGroup.tabs = studyGroup.tabs.map((tab) =>
          tab === studyTab ? refreshedTab : tab,
        )
        if (studyGroup.activeTab === studyTab)
          studyGroup.activeTab = refreshedTab
      } else harness.changeWindowFocus(false)
      harness.changed()

      // Act: only now can Close read and close the remaining current owned sets.
      held.release()
      await closing

      // Assert: later learner tabs survive, new wrappers are dispatched, and focus is resampled beside the next close.
      assert.equal(
        harness.editor.window.activeTextEditor?.document,
        auth.document,
      )
      assert.deepEqual(
        harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
        [],
      )
      assert.deepEqual(harness.informationMessages, [])
      assert.equal(harness.counts().panels, 0)
      if (laterChange === 'learner tab') {
        assert.equal(
          harness.groups.some((group) => group.tabs.includes(laterLearnerTab!)),
          true,
        )
        assert.deepEqual(
          harness.tabCloseFocusRequests().slice(requestsBefore),
          [true, true, true],
        )
        assert.equal(harness.keyboardOnBody(), false)
      } else if (laterChange === 'window focus lost') {
        assert.equal(harness.editor.window.state.focused, false)
        assert.deepEqual(
          harness.tabCloseFocusRequests().slice(requestsBefore),
          [true, true, true],
        )
      } else {
        assert.equal(harness.keyboardOnBody(), false)
        assert.equal(harness.groups.length, 2)
        assert.equal(
          harness
            .tabCloseRequests()
            .slice(requestsBefore)
            .flat()
            .includes(studyTab),
          laterChange !== 'new tab objects',
        )
      }
    } finally {
      held.release()
      await closing?.catch(() => undefined)
      await harness.close()
    }
  })

test('native disposal leaves a refused owned pane and learner tabs intact without forcing panel disposal', async (context) => {
  // Arrange: the editor refuses the first owned-tab close without disposing its panel.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] })
  harness.modelNativeTabCloseFocus()
  try {
    const login = harness.focusMutableDraft('login-form.tsx', 1)
    await harness.reader.open()
    const auth = harness.focusMutableDraft('auth.ts', 2)
    const app = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')!
    const originalClose = harness.editor.window.tabGroups.close
    const refusal = context.mock.method(
      harness.editor.window.tabGroups,
      'close',
      async () => false,
    )

    // Act
    const result = await harness.reader.dispose().then(
      () => 'closed',
      (error: unknown) => String(error),
    )

    // Assert: rejection stops cleanup before forced dispose and preserves the refused native editor.
    assert.equal(result, 'Error: Some Study workspace readers could not close.')
    assert.equal(harness.nativePanels().includes(app), true)
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(app.nativeTab)),
      true,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(login.tab)),
      true,
    )
    assert.equal(
      harness.groups.some((group) => group.tabs.includes(auth.tab)),
      true,
    )
    assert.equal(harness.keyboardOnBody(), false)
    assert.deepEqual(harness.informationMessages, [])
    refusal.mock.restore()
    harness.editor.window.tabGroups.close = originalClose
  } finally {
    context.mock.restoreAll()
    await harness.reader.close()
    await harness.close()
  }
})

// Value: protects=the editor after a Study reader's dispose failed while it closed its panes: the reader's listeners are released all the same, so the reader the extension makes in its place does not share the editor's events with a disposed one; fails_when=the dispose stops at the failure and leaves what the reader registered with the editor in place, so two readers answer the same views and events, or the next reader cannot register its views at all; why_new=Cycle 0046 row 298 (a reader's dispose releases its registrations whatever throws); seam=the workspace harness's count of the reader's listeners in the fake editor, and the reader's close replaced by one that fails
test('a reader whose dispose fails while it closes its panes releases what it registered with the editor all the same, and tells the failure', async () => {
  // Arrange: a reader that listens to the editor, and whose panes cannot be closed.
  const harness = await workspaceHarness(false)
  const close = harness.reader.close.bind(harness.reader)
  try {
    const listenersBefore = harness.focusListenerCount()
    harness.reader.close = async (): Promise<void> => {
      throw new Error('The panes could not be closed.')
    }
    // Act: the workspace folders change, and the extension disposes its reader.
    const disposal = await harness.reader.dispose().then(
      () => 'disposed',
      (error: unknown) => String(error),
    )
    // Assert
    assert.equal(listenersBefore, 7)
    assert.equal(disposal, 'Error: The panes could not be closed.')
    assert.equal(harness.focusListenerCount(), 0)
  } finally {
    harness.reader.close = close
    await harness.close()
  }
})

// Value: protects=the learner whose reader is disposed during a Read (a folder is added to the workspace while a pane is maximized and the learner types in the terminal): the side bars the Read hid are shown again, and because the editor's commands that show a bar give it the keyboard, the active editor group takes the keyboard and the learner is told where it is, as after a Close; fails_when=the disposal shows the side bars, moves the keyboard into the editor group and tells nothing, against "a reader that is disposed moves no keyboard", so the learner's typing stops in the terminal without a word; why_new=Cycle 0046 row 255 (delegated review, finding 8: the exception of a disposal during a Read is stated and told); seam=the workspace harness's side bar model, focusView for the terminal, the reader's Read and its disposal, command log and information messages
test('a reader that is disposed during a Read shows the side bars the Read hid again, and tells the learner that the keyboard is in the active editor group now', async () => {
  // Arrange: the primary side bar is open; the learner reads the explanation enlarged, which hides it, and then types in the terminal.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.modelSideBars({ primary: true, auxiliary: false })
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    harness.focusView()
    const duringRead = harness.sideBars()

    // Act: the workspace folders change, and the extension disposes its reader.
    await harness.reader.dispose()

    // Assert: the bar is back; showing it moved the keyboard, which the active editor group has now, and the learner is told.
    assert.deepEqual(duringRead, {
      primary: false,
      auxiliary: false,
      hasKeyboard: false,
    })
    assert.deepEqual(harness.sideBars(), {
      primary: true,
      auxiliary: false,
      hasKeyboard: false,
    })
    assert.equal(harness.keyboardInView(), false)
    assert.equal(harness.maximizedEditorGroup(), false)
    assert.deepEqual(
      harness.informationMessages.map((message) => message.message),
      [
        'Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.',
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner whose Settings page (a tab of the main editor that is no text editor) is the active editor when "Codebook: Close Study Workspace" runs in an editor without a chat tab: the active editor group has it once the panes' groups are closed, and the learner is told where it is; fails_when=Close settles the keyboard only while the editor names an active text editor or pane, the editor rebuilds its grid as the closed tabs' groups leave, and the keyboard is on the page body until the learner clicks; why_new=Cycle 0046 row 140, item 8 (the state of row 66 beside a page that is no text editor); seam=the workspace harness's addOpaqueTab, focusOpaqueTab, closeDisposedPanelTabsLater, removeEmptiedGroupsLater, loseKeyboardWhenGroupCloses, keyboardOnBody, command log and information messages
test("Close Study Workspace made with the editor's Settings page active gives the active editor group the keyboard once the panes' groups closed, and says where it is", async () => {
  // Arrange: an editor with one editor part; it removes a group its last tab left and lets the keyboard fall to the page body when it does; the reader is open and the Settings page in the first group is the active editor.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.closeDisposedPanelTabsLater()
  harness.removeEmptiedGroupsLater()
  harness.loseKeyboardWhenGroupCloses()
  try {
    await harness.reader.open()
    const settingsPage = harness.addOpaqueTab('Settings', 1)
    harness.focusOpaqueTab(settingsPage)
    const activeTextEditorBeforeClose = harness.editor.window.activeTextEditor

    // Act: Close, and longer than the fake editor takes to remove an emptied group.
    await harness.reader.close()
    await new Promise((resolve) => setTimeout(resolve, 120))

    // Assert
    assert.equal(activeTextEditorBeforeClose, undefined)
    assert.deepEqual(
      {
        groups: harness.groups.length,
        tabInFront: harness.groups[0]!.activeTab,
        keyboardOnBody: harness.keyboardOnBody(),
        lastCommand: harness.commands.at(-1),
        sentences: harness.informationMessages.map(
          (message) => message.message,
        ),
      },
      {
        groups: 1,
        tabInFront: settingsPage,
        keyboardOnBody: false,
        lastCommand: 'workbench.action.focusActiveEditorGroup',
        sentences: [
          'Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner who types in Cursor's Agent chat (a tab of another editor part) while the editor still names a main group that shows its Settings page, when "Codebook: Close Study Workspace" runs: nothing is focused and nothing is told; fails_when=the rule for a page that is no text editor also runs beside a chat tab, where the editor reads the same whether the keyboard is in that page or in the chat, and Close takes the keyboard from the chat; why_new=Cycle 0046 row 140, item 8 (the other side: with a second editor part the state cannot be told from the chat holding the keyboard); seam=the workspace harness's addSeparateEditorPart, addOpaqueTab, focusOpaqueTab, the chat's focus, command log and information messages
test("Close Study Workspace made while the editor names its Settings page beside Cursor's chat tab runs no focus command and tells nothing", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the reader is open, the Settings page is the tab in front of the first group, and the learner types in the chat while the editor goes on naming that group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  try {
    await harness.reader.open()
    harness.focusOpaqueTab(harness.addOpaqueTab('Settings', 1))
    chat.focus()
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.close()

    // Assert
    assert.equal(chat.focused(), true)
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .some((command) => /^workbench\.action\.focus/.test(command)),
      false,
    )
    assert.deepEqual(harness.informationMessages, [])
    assert.equal(harness.reader.presentationState().state, 'closed')
  } finally {
    await harness.close()
  }
})

for (const situation of [
  'the work window does not have the focus',
  'the Study workspace is not open',
] as const)
  // Value: protects=a Close that has nothing to settle leaving the keyboard and the learner alone: in a window that is not focused, and when no pane and no captured source was open; fails_when=the wider rule of row 66 focuses the active editor group of a window the learner is not in, or tells its sentence after a Close that closed nothing; why_new=Cycle 0046 row 66 (the bounds of the new rule); seam=the workspace harness's changeWindowFocus, command log and information messages
  test(`Close Study Workspace made with the learner's own file active runs no focus command and tells nothing when ${situation}`, async () => {
    // Arrange
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      if (situation === 'the work window does not have the focus')
        await harness.reader.open()
      harness.focusMutableDraft('actions.ts', 1)
      if (situation === 'the work window does not have the focus')
        harness.changeWindowFocus(false)
      const commandsBefore = harness.commands.length

      // Act
      await harness.reader.close()

      // Assert
      assert.equal(
        harness.commands
          .slice(commandsBefore)
          .some((command) => /^workbench\.action\.focus/.test(command)),
        false,
      )
      assert.deepEqual(harness.informationMessages, [])
      assert.equal(harness.reader.presentationState().state, 'closed')
    } finally {
      await harness.close()
    }
  })

// Value: protects=the keyboard of a learner who types in Cursor's Agent chat (a tab of another editor part) when "Codebook: Close Study Workspace" runs: it stays in the chat and nothing is told; fails_when=the wider rule of row 66 runs its focus command although the editor names no active text editor and no active pane, and takes the keyboard from the chat; why_new=Cycle 0046 row 66 ("keep what is known": only a state the editor reads as an active text editor or pane is settled); seam=the workspace harness's addSeparateEditorPart, command log and information messages
test("Close Study Workspace made while Cursor's chat tab has the keyboard leaves the keyboard in the chat and tells nothing", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part; the reader is open and the learner types in the chat.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  const chat = harness.addSeparateEditorPart()
  try {
    await harness.reader.open()
    chat.focusTab()
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.close()

    // Assert
    assert.equal(chat.focused(), true)
    assert.equal(
      harness.commands
        .slice(commandsBefore)
        .some((command) => /^workbench\.action\.focus/.test(command)),
      false,
    )
    assert.deepEqual(harness.informationMessages, [])
    assert.equal(harness.reader.presentationState().state, 'closed')
  } finally {
    await harness.close()
  }
})

// Value: protects=the keyboard of a learner who types in Cursor's Agent chat (a tab of another editor part) when "Codebook: Close Study Workspace" ends a Read: the side bars the Read hid are shown again, the chat has the keyboard again and nothing is told; fails_when=the close shows the bars with the editor's focus commands, which give a bar the keyboard, then focuses the active editor group twice and gives nothing back, so the learner's typing leaves the chat without a word, against the README's "moves nothing and shows nothing"; why_new=Cycle 0046 row 317 (a), read in the source by the last documents pass; seam=the workspace harness's addSeparateEditorPart, side bar model, the reader's Read, command log and information messages
test("Close Study Workspace that ends a Read while Cursor's chat tab has the keyboard shows the side bars the Read hid again, gives the keyboard back to the chat and tells nothing", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part and both side bars open; the learner reads the explanation enlarged, which hides both bars, then shows the secondary bar again and types in the chat.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  harness.modelSideBars({ primary: true, auxiliary: true })
  const chat = harness.addSeparateEditorPart()
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    const duringRead = harness.sideBars()
    harness.modelSideBars({ primary: false, auxiliary: true })
    chat.focusTab()
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.close()

    // Assert: both bars are open, the last command that moved the keyboard is Cursor's Focus Agent, and no notice is shown.
    assert.deepEqual(duringRead, {
      primary: false,
      auxiliary: false,
      hasKeyboard: false,
    })
    assert.deepEqual(
      {
        sideBars: harness.sideBars(),
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus|^composer\./.test(command),
          ),
        chatHasKeyboard: chat.focused(),
        sentences: harness.informationMessages.map(
          (message) => message.message,
        ),
        state: harness.reader.presentationState().state,
      },
      {
        sideBars: { primary: true, auxiliary: true, hasKeyboard: false },
        keyboardCommands: [
          'workbench.action.focusAuxiliaryBar',
          'workbench.action.focusSideBar',
          'workbench.action.focusActiveEditorGroup',
          'composer.focusComposer',
        ],
        chatHasKeyboard: true,
        sentences: [],
        state: 'closed',
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner told where the keyboard is after a Close that ended a Read beside Cursor's chat tab while the editor named a Settings page of the main editor: the editor reads the same whether the keyboard was in that page or in the chat, so nothing is given back, the active editor group has the keyboard and the Close notice says so; fails_when=such a close shows the side bars with the editor's focus commands, focuses the active editor group and tells nothing, so a learner who typed in the chat finds the keyboard gone without a word; why_new=Cycle 0046 row 317 (a), the state in which the chat cannot be known to have had the keyboard; seam=the workspace harness's addSeparateEditorPart, addOpaqueTab, focusOpaqueTab, side bar model, command log and information messages
test("Close Study Workspace that ends a Read while the editor names its Settings page beside Cursor's chat tab gives the active editor group the keyboard and says where it is", async () => {
  // Arrange: Cursor with the Agent chat as a tab of another editor part and the primary side bar open; the learner reads the explanation enlarged, which hides the bar; then the Settings page is the tab in front of the first group and the learner types in the chat while the editor goes on naming that group.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.useHostAppName('Cursor')
  harness.modelSideBars({ primary: true, auxiliary: false })
  const chat = harness.addSeparateEditorPart()
  try {
    await harness.reader.open()
    await harness.reader.action('read-context')
    harness.focusOpaqueTab(harness.addOpaqueTab('Settings', 1))
    chat.focus()
    const commandsBefore = harness.commands.length

    // Act
    await harness.reader.close()

    // Assert: the bar is back, no command of the chat ran, and the learner is told where the keyboard is.
    assert.deepEqual(
      {
        sideBars: harness.sideBars(),
        keyboardCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) =>
            /^workbench\.action\.focus|^composer\./.test(command),
          ),
        sentences: harness.informationMessages.map(
          (message) => message.message,
        ),
        state: harness.reader.presentationState().state,
      },
      {
        sideBars: { primary: true, auxiliary: false, hasKeyboard: false },
        keyboardCommands: [
          'workbench.action.focusSideBar',
          'workbench.action.focusActiveEditorGroup',
          'workbench.action.focusActiveEditorGroup',
        ],
        sentences: [
          'Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.',
        ],
        state: 'closed',
      },
    )
  } finally {
    await harness.close()
  }
})

for (const ending of [
  'Close Study Workspace',
  'A disposal of the reader',
] as const)
  // Value: protects=the learner who returns to a window in which a Read was ended while the window did not have the focus (a Close that outlasted the learner's switch to another application, or a folder added to the workspace from outside): the side bars the Read hid are shown again, the active editor group has the keyboard once the panes are closed, and the Close notice says so; fails_when=the bars are shown with the editor's focus commands in the unfocused window, the panes are closed after it without a focus command and nothing is told, so the learner comes back to a keyboard that moved, or is on no element, without a word; why_new=Cycle 0046 row 317 (b), read in the source by the last documents pass; seam=the workspace harness's side bar model, changeWindowFocus, closeDisposedPanelTabsLater, removeEmptiedGroupsLater, loseKeyboardWhenGroupCloses, keyboardOnBody, command log and information messages
  test(`${ending} that ends a Read in a window without the focus shows the side bars the Read hid again, leaves the keyboard in the active editor group and tells the learner where it is`, async () => {
    // Arrange: the primary side bar is open; the editor closes a disposed pane's tab a moment after the disposal, removes the group it left empty and lets the keyboard fall to the page body when a group goes. The learner reads the explanation enlarged, which hides the bar, and then works in another application.
    const harness = await workspaceHarness(false)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.modelSideBars({ primary: true, auxiliary: false })
    harness.closeDisposedPanelTabsLater()
    harness.removeEmptiedGroupsLater()
    harness.loseKeyboardWhenGroupCloses()
    try {
      await harness.reader.open()
      await harness.reader.action('read-context')
      harness.changeWindowFocus(false)
      const commandsBefore = harness.commands.length

      // Act: the Read is ended, and longer than the fake editor takes to remove an emptied group.
      if (ending === 'Close Study Workspace') await harness.reader.close()
      else await harness.reader.dispose()
      await new Promise((resolve) => setTimeout(resolve, 120))

      // Assert: the bar is back, the last focus command ran after the panes' groups were gone, and the notice waits for the learner.
      assert.deepEqual(
        {
          sideBars: harness.sideBars(),
          panels: harness.counts().panels,
          keyboardOnBody: harness.keyboardOnBody(),
          keyboardCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) => /^workbench\.action\.focus/.test(command)),
          sentences: harness.informationMessages.map(
            (message) => message.message,
          ),
        },
        {
          sideBars: { primary: true, auxiliary: false, hasKeyboard: false },
          panels: 0,
          keyboardOnBody: false,
          keyboardCommands: [
            'workbench.action.focusSideBar',
            'workbench.action.focusActiveEditorGroup',
            'workbench.action.focusActiveEditorGroup',
          ],
          sentences: [
            'Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.',
          ],
        },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=side-view typing at automatic run-end while the native Application tab stays active; fails_when=active tab flags are mistaken for actual document keyboard ownership; why_new=row393 native off-setting flow loses Agent keyboard only at run-end; seam=existing focusView and controlled viewport lifecycle
test('a live run ending preserves side-view typing even while its Application remains the native active tab', async () => {
  // Arrange: the Application tab remains active while a view outside the editor owns the keyboard.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    harness.focusMutableDraft('login-form.tsx', 1)
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    const live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.reader['app']!.reveal(undefined, false)
    harness.focusView()
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser')
    assert.equal(harness.keyboardInView(), true)
    assert.equal(harness.innerFocusedPanel(), undefined)
    // The preparation's own sentence about the new group (row 614) is no part of this test.
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length

    // Act: automatic retirement completes without the learner choosing another input.
    live.close()
    await waitUntil(
      () => harness.counts().panels === 0,
      'the ended run to retire its Application pane',
      2_000,
    )
    await new Promise((resolve) => setTimeout(resolve, 150))

    // Assert: retirement leaves view typing and quiet intact, without inventing a chat focus command.
    assert.deepEqual(
      {
        keyboardInView: harness.keyboardInView(),
        keyboardOnBody: harness.keyboardOnBody(),
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
        notices: harness.informationMessages.slice(messagesBefore),
      },
      {
        keyboardInView: true,
        keyboardOnBody: false,
        focusCommands: [],
        notices: [],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a newer cold presentation Open while an older run inspects its Application; fails_when=opened alone misses an entry already reserved before its progress read; why_new=row394 delegated review; seam=the instance's real progress read and Application message delivery
for (const preparation of ['initialization', 'progress read'])
  test(`an ended run preserves a newer cold presentation while its ${preparation} is pending`, async () => {
    // Arrange: retain the real Application and hold only inspection and the next ledger read.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    readerSeams(harness).stopOwnTimer()
    const library = harness.reader['library']!
    const originalReadProgress = library.readProgress.bind(library),
      originalInitialize = readerSeams(harness).initialization
    let markInspectionStarted = (): void => {},
      releaseInspection = (): void => {},
      markPreparationStarted = (): void => {},
      releasePreparation = (): void => {},
      changing:
        ReturnType<typeof harness.reader.changePresentation> | undefined,
      restorePostMessage = (): void => {}
    const inspectionStarted = new Promise<void>((resolve) => {
      markInspectionStarted = resolve
    })
    const inspectionHeld = new Promise<void>((resolve) => {
      releaseInspection = resolve
    })
    const preparationStarted = new Promise<void>((resolve) => {
      markPreparationStarted = resolve
    })
    const preparationHeld = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    try {
      harness.focusMutableDraft('login-form.tsx', 1)
      const receipt = harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      await harness.service.record(receipt).preparation
      const live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      const application = harness.reader['app']!
      application.reveal(undefined, false)
      const originalPost = application.webview.postMessage.bind(
        application.webview,
      )
      restorePostMessage = (): void => {
        application.webview.postMessage = originalPost
      }
      application.webview.postMessage = async (message) => {
        if (message.type === 'codebook-focus' && message.phase === 'inspect') {
          markInspectionStarted()
          await inspectionHeld
        }
        return originalPost(message)
      }
      live.close()
      await inspectionStarted
      // The presentation reserves its transition before initialization; Open reserves its source before progress.
      if (preparation === 'initialization')
        readerSeams(harness).initialization = async (): Promise<void> => {
          markPreparationStarted()
          await preparationHeld
          await originalInitialize()
        }
      else
        library.readProgress = async () => {
          markPreparationStarted()
          await preparationHeld
          return originalReadProgress()
        }
      const state = harness.reader.presentationState()
      changing = harness.reader.changePresentation({
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
        mode: 'study-workspace',
        action: 'select',
      })
      void changing.catch(() => undefined)
      await preparationStarted
      assert.equal(harness.reader.presentationState().state, 'applying')
      assert.equal(harness.reader['opened'], false)
      // The preparation's own sentence about the new group (row 614) is no part of this test.
      const commandsBefore = harness.commands.length,
        messagesBefore = harness.informationMessages.length

      // Act: the old inspection finishes before the newer Open can finish reading progress.
      releaseInspection()
      await new Promise<void>((resolve) => setImmediate(resolve))

      // Assert: the old ending keeps the same pane and does not interrupt the valid public selection.
      assert.equal(harness.reader['app'], application)
      assert.equal(harness.counts().panels, 1)
      assert.deepEqual(
        harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
        [],
      )
      assert.deepEqual(harness.informationMessages.slice(messagesBefore), [])
      releasePreparation()
      const result = await changing
      assert.equal(result.state, 'open')
      assert.equal(result.layoutConfirmed, true)
    } finally {
      releaseInspection()
      releasePreparation()
      restorePostMessage()
      library.readProgress = originalReadProgress
      readerSeams(harness).initialization = originalInitialize
      await changing?.catch(() => undefined)
      await harness.close()
    }
  })

for (const replacement of ['a newer live lease', 'a replacement document'])
  test(`an ended run preserves its Application when ${replacement} arrives during keyboard inspection`, async () => {
    // Arrange: hold only the old run's read-only document inspection.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    let markInspectionStarted = (): void => {},
      releaseInspection = (): void => {},
      restorePostMessage = (): void => {}
    const inspectionStarted = new Promise<void>((resolve) => {
      markInspectionStarted = resolve
    })
    const inspectionHeld = new Promise<void>((resolve) => {
      releaseInspection = resolve
    })
    try {
      harness.focusMutableDraft('login-form.tsx', 1)
      const receipt = harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      await harness.service.record(receipt).preparation
      const live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      const application = harness.reader['app']!
      application.reveal(undefined, false)
      const originalPost = application.webview.postMessage.bind(
        application.webview,
      )
      restorePostMessage = (): void => {
        application.webview.postMessage = originalPost
      }
      application.webview.postMessage = async (message) => {
        if (message.type === 'codebook-focus' && message.phase === 'inspect') {
          markInspectionStarted()
          await inspectionHeld
        }
        return originalPost(message)
      }
      // The preparation's own sentence about the new group (row 614) is no part of this test.
      const commandsBefore = harness.commands.length,
        messagesBefore = harness.informationMessages.length

      // Act: new ownership arrives before the original inspection answers.
      live.close()
      await inspectionStarted
      if (replacement === 'a newer live lease')
        await harness.reader.presentation.createViewport(
          randomUUID(),
          () => {},
          () => {},
          'normal',
        )
      else application.webview.html = '<replacement-owned-application-document>'
      const replacementHtml = application.webview.html
      releaseInspection()
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Assert: the old ending cannot remove or focus the replacement.
      assert.equal(harness.counts().panels, 1)
      assert.equal(application.webview.html, replacementHtml)
      assert.deepEqual(
        harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
        [],
      )
      assert.deepEqual(harness.informationMessages.slice(messagesBefore), [])
    } finally {
      releaseInspection()
      restorePostMessage()
      await harness.close()
    }
  })

// Value: protects=the keyboard of a learner at the end of a live run whose Application pane had the keyboard while the Study workspace is closed: the run's pane is closed, the active editor group has the keyboard, and the learner is told once in an editor session where it is, in words that are true for a pane the run closed; fails_when=the run's end disposes the pane that has the keyboard and focuses nothing, so the keyboard is on the page body and a key the learner presses goes nowhere until they click; why_new=Cycle 0046 row 342 (Cursor 3.23.12 on candidate 4: at the end of a run of five stops the tab "codebook · Application" closed, the extension host named login-form.tsx as the active text editor, and the workbench page had no focus with BODY as its active element, also a minute later); seam=the workspace harness with the controlled runtime, a live run's viewport and its close, the Application pane's reveal with the focus, keyboardOnBody, command log and information messages
test('a live run that ends while its Application pane has the keyboard and the Study workspace is closed leaves the keyboard in the active editor group and says once in an editor session where it is', async () => {
  // Arrange: the learner's file is the tab of the first group; a live run shows its Application pane there with the Study workspace closed, and the pane has the keyboard.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    harness.focusMutableDraft('login-form.tsx', 1)
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    const live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    harness.reader['app']!.reveal(undefined, false)
    const before = {
      reader: harness.reader.presentationState().state,
      keyboardInApplicationPane:
        harness.focusedPanel() === 'codebook.scopedBrowser',
    }
    // The preparation's own sentence about the new group (row 614) is no part of this test.
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length

    // Act: the run ends and gives its pane back; then a second run ends the same way in the same editor session.
    live.close()
    await waitUntil(
      () => harness.informationMessages.length > messagesBefore,
      'the notice of the run that closed its pane',
      2_000,
    ).catch(() => undefined)
    const afterFirstRun = {
      panels: harness.counts().panels,
      keyboardOnBody: harness.keyboardOnBody(),
      focusCommands: harness.commands
        .slice(commandsBefore)
        .filter((command) => /^workbench\.action\.focus/.test(command)),
      sentences: harness.informationMessages
        .slice(messagesBefore)
        .map((message) => message.message),
    }
    const second = await harness.reader.presentation.createViewport(
      randomUUID(),
      () => {},
      () => {},
      'normal',
    )
    harness.reader['app']!.reveal(undefined, false)
    second.close()
    await waitUntil(
      () =>
        harness.commands
          .slice(commandsBefore)
          .filter(
            (command) => command === 'workbench.action.focusActiveEditorGroup',
          ).length === 2,
      'the second run to settle the keyboard',
      2_000,
    ).catch(() => undefined)

    // Assert
    assert.deepEqual(before, {
      reader: 'closed',
      keyboardInApplicationPane: true,
    })
    assert.deepEqual(afterFirstRun, {
      panels: 0,
      keyboardOnBody: false,
      focusCommands: ['workbench.action.focusActiveEditorGroup'],
      sentences: [
        'The run ended and Codebook closed its Application pane. The keyboard is in the active editor group now: closing the pane can leave it nowhere, and the editor does not tell Codebook whether it was in the pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.',
      ],
    })
    assert.equal(harness.keyboardOnBody(), false)
    assert.equal(harness.informationMessages.slice(messagesBefore).length, 1)
  } finally {
    await harness.close()
  }
})

for (const situation of [
  'the learner works in a file of their own and the pane is not the active editor',
  'the work window does not have the focus',
] as const)
  // Value: protects=the keyboard and the learner's quiet at the end of a live run whose pane did not have the keyboard: the pane is closed, no focus command runs and nothing is told; fails_when=every run's end focuses the active editor group and tells its sentence, also for a learner who types in their own file beside the pane, or in a window the learner is not in; why_new=Cycle 0046 row 342 (the bounds of the new rule, as row 66 has them for a Close); seam=the workspace harness with the controlled runtime, a live run's viewport and its close, focusMutableDraft, changeWindowFocus, command log and information messages
  test(`a live run that ends with the Study workspace closed runs no focus command and tells nothing when ${situation}`, async () => {
    // Arrange: a live run shows its Application pane with the Study workspace closed.
    const harness = await workspaceHarness()
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    try {
      const receipt = harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'repository-browser',
        configuration: harness.configuration,
        key: randomUUID(),
      })
      await harness.service.record(receipt).preparation
      const live = await harness.reader.presentation.createViewport(
        receipt.runId,
        () => {},
        () => {},
        'normal',
      )
      if (situation.startsWith('the learner works'))
        harness.focusMutableDraft('login-form.tsx', 1)
      else {
        harness.reader['app']!.reveal(undefined, false)
        harness.changeWindowFocus(false)
      }
      // The preparation's own sentence about the new group (row 614) is no part of this test.
      const commandsBefore = harness.commands.length,
        messagesBefore = harness.informationMessages.length

      // Act: the run ends; longer than the reader would take to settle the keyboard.
      live.close()
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Assert
      assert.deepEqual(
        {
          panels: harness.counts().panels,
          focusCommands: harness.commands
            .slice(commandsBefore)
            .filter((command) => /^workbench\.action\.focus/.test(command)),
          sentences: harness.informationMessages.slice(messagesBefore),
        },
        { panels: 0, focusCommands: [], sentences: [] },
      )
    } finally {
      await harness.close()
    }
  })

// Value: protects=the keyboard of a learner whose reader is disposed (a folder is added to the workspace) while one of its panes is the active editor: the pane is closed with the reader, the active editor group has the keyboard, and the learner is told as after a Close; fails_when=a disposal moves no keyboard whatever it closes, so a learner who read in the Study pane is left with the keyboard on the page body; why_new=Cycle 0046 row 342 (every path that closes a pane that held the keyboard; row 174's rule stays for a learner's own file); seam=the workspace harness, the focus-context action, the reader's dispose, keyboardOnBody, command log and information messages
test('a reader that is disposed while its Study pane is the active editor leaves the keyboard in the active editor group and tells the learner where it is', async () => {
  // Arrange: the Study workspace is open and the Study pane has the keyboard.
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  try {
    harness.focusMutableDraft('actions.ts', 1)
    await harness.reader.open()
    await harness.reader.action('focus-context')
    const keyboardInStudyPane =
      harness.focusedPanel() === 'codebook.studyContext'
    const commandsBefore = harness.commands.length

    // Act: the workspace folders change, and the extension disposes its reader.
    await harness.reader.dispose()

    // Assert
    assert.equal(keyboardInStudyPane, true)
    assert.deepEqual(
      {
        panels: harness.counts().panels,
        keyboardOnBody: harness.keyboardOnBody(),
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
        sentences: harness.informationMessages.map(
          (message) => message.message,
        ),
      },
      {
        panels: 0,
        keyboardOnBody: false,
        focusCommands: ['workbench.action.focusActiveEditorGroup'],
        sentences: [
          'Study workspace closed. The keyboard is in the active editor group now: closing the panes can leave it nowhere, and the editor does not tell Codebook whether it was in a pane, a file, the terminal, a view or the chat. If you were typing outside the editor, click there to type again.',
        ],
      },
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the learner who leaves the editor window while a run's disposed Application tab still waits to close; fails_when=run-end focus sampled before that wait sends a later keyboard command and notice after the window lost focus; why_new=Cycle 0046 row 364; seam=delayed native tab close, the original run-end continuation observed without changing its behavior, and window focus loss
test('a run that ends with its Application pane active sends no keyboard command or notice when the window loses focus while the disposed tab waits to close', async () => {
  // Arrange: Study is closed, a live run's pane has the keyboard, and native disposal waits.
  const harness = await workspaceHarness()
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.closeDisposedPanelTabsLater()
  const settleKeyboard = harness.reader[
    'settleKeyboardAfterRunClosedPane'
  ].bind(harness.reader)
  let settling: Promise<void> | undefined,
    departedWithPendingTab = false,
    removeDisposalObserver = (): void => {}
  let markSettlingStarted = (): void => {}
  const settlingStarted = new Promise<void>((resolve) => {
    markSettlingStarted = resolve
  })
  harness.reader['settleKeyboardAfterRunClosedPane'] = (): Promise<void> => {
    // Observe completion of the real continuation; the public lease release still triggers it.
    settling = settleKeyboard()
    markSettlingStarted()
    return settling
  }
  try {
    const learnerFile = harness.focusMutableDraft('learner-file.ts', 1)
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: harness.configuration,
      key: randomUUID(),
    })
    await harness.service.record(receipt).preparation
    const live = await harness.reader.presentation.createViewport(
      receipt.runId,
      () => {},
      () => {},
      'normal',
    )
    const application = harness
      .nativePanels()
      .find((panel) => panel.kind === 'codebook.scopedBrowser')!
    application.reveal(undefined, false)
    const disposal = application.onDidDispose(() => {
      // Native disposal precedes its deferred tab close and the allocation drain.
      departedWithPendingTab = harness.groups.some((group) =>
        group.tabs.includes(application.nativeTab),
      )
      harness.changeWindowFocus(false)
    })
    removeDisposalObserver = (): void => disposal.dispose()
    // The preparation's own sentence about the new group (row 614) is no part of this test.
    const commandsBefore = harness.commands.length,
      messagesBefore = harness.informationMessages.length

    // Act: end the run; actual native disposal triggers departure while its tab is still pending.
    live.close()
    assert.equal(
      await settledWithin(settlingStarted, 2_000),
      true,
      'The original run-end keyboard continuation did not start',
    )
    assert.ok(settling, 'The run did not start its keyboard continuation')
    assert.equal(departedWithPendingTab, true)
    assert.equal(harness.editor.window.state.focused, false)
    await settling
    assert.equal(learnerFile.document.getText(), 'Original learner draft.\n')
    assert.equal(learnerFile.tab.isDirty, true)

    // Assert: after the actual continuation settled, no later keyboard operation or notice ran.
    assert.deepEqual(
      {
        panels: harness.counts().panels,
        focusCommands: harness.commands
          .slice(commandsBefore)
          .filter((command) => /^workbench\.action\.focus/.test(command)),
        notices: harness.informationMessages.slice(messagesBefore),
      },
      { panels: 0, focusCommands: [], notices: [] },
    )
  } finally {
    removeDisposalObserver()
    harness.changeWindowFocus(true)
    harness.reader['settleKeyboardAfterRunClosedPane'] = settleKeyboard
    await harness.close()
  }
})
