import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import type * as TimersModule from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'
import type * as TimersPromisesModule from 'node:timers/promises'
import { runInNewContext } from 'node:vm'

import type * as ViewportModule from '../runtimeSupport/browserViewport'
import { Cdp } from '../runtimeSupport/cdp'
import type { Scenario } from '../runtimeSupport/constants'
import {
  ACTIVE_TIMEOUT_MS,
  CAPTURE_TIMEOUT_MS,
  POLL_INTERVAL_MS,
} from '../runtimeSupport/constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  advanceClock,
  advanceClockUntilSettled,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'

/** Races an operation against a labelled limit and cancels the limit's timer once the race is decided, so no timer outlives its test. @example await withinLimit(pending, 500, 'still waiting for cleanup') */
async function withinLimit<Outcome>(
  operation: Promise<Outcome>,
  limitMs: number,
  label: string,
): Promise<Outcome | string> {
  const limit = new AbortController()
  try {
    return await Promise.race([
      operation,
      delay(limitMs, label, { signal: limit.signal }),
    ])
  } finally {
    limit.abort()
  }
}

/** Models multiple viewport listeners on one reader so {@link viewportHarness} can verify shared lease retirement. @example const renderer = viewportPanel() */
function viewportPanel() {
  const messages: Record<string, unknown>[] = []
  const receivers = new Set<(message: unknown) => void>(),
    visibility = new Set<() => void>(),
    disposal = new Set<() => void>()
  const posted = new Set<(message: Record<string, unknown>) => void>()
  let panelDisposals = 0
  let nativeInput: 'source' | 'app' | 'body' | 'chat' = 'app'
  const reveals: { preserveFocus: boolean | undefined }[] = []
  const panel = {
    visible: true,
    viewColumn: 1,
    reveal(_column?: number, preserveFocus?: boolean): void {
      reveals.push({ preserveFocus })
      if (_column !== undefined) panel.viewColumn = _column
      // Revealing over a focused native file removes that input even when focus is preserved.
      if (!preserveFocus) nativeInput = 'app'
      else if (nativeInput === 'source') nativeInput = 'body'
      panel.visible = true
      for (const callback of visibility) callback()
    },
    dispose(): void {
      if (panelDisposals) return
      panelDisposals++
      for (const callback of [...disposal]) callback()
    },
    onDidDispose(callback: () => void) {
      disposal.add(callback)
      return {
        dispose(): void {
          disposal.delete(callback)
        },
      }
    },
    onDidChangeViewState(callback: () => void) {
      visibility.add(callback)
      return {
        dispose(): void {
          visibility.delete(callback)
        },
      }
    },
    webview: {
      html: '',
      onDidReceiveMessage(callback: (message: unknown) => void) {
        receivers.add(callback)
        return {
          dispose(): void {
            receivers.delete(callback)
          },
        }
      },
      postMessage(message: Record<string, unknown>) {
        messages.push(message)
        for (const callback of [...posted]) callback(message)
        return Promise.resolve(true)
      },
    },
  }
  return {
    panel,
    messages,
    /** How each reveal of the panel treated the keyboard focus, in order. */
    reveals,
    nativeInput: () => nativeInput,
    focusChat(): void {
      nativeInput = 'chat'
    },
    focusNativeSource(): void {
      nativeInput = 'source'
      panel.visible = false
      for (const callback of visibility) callback()
    },
    disposals: () => panelDisposals,
    callbacks: () => ({
      receivers: [...receivers],
      visibility: [...visibility],
      disposal: [...disposal],
    }),
    hide(): void {
      panel.visible = false
      for (const callback of visibility) callback()
    },
    receive(message: unknown): void {
      for (const callback of [...receivers]) callback(message)
    },
    nextFrame(): Promise<Record<string, unknown>> {
      return new Promise((resolve) => {
        const callback = (message: Record<string, unknown>): void => {
          if (message.type !== 'frame') return
          posted.delete(callback)
          resolve(message)
        }
        posted.add(callback)
      })
    },
    ready(epoch: string): void {
      for (const callback of receivers) {
        callback({ type: 'ready', epoch })
        callback({
          type: 'ready',
          epoch,
          requestId: messages.findLast(
            (message) => message.type === 'requestReady',
          )?.requestId,
        })
      }
    },
  }
}

/** Stands for the editor's `TabInputText` of the file the debugger opened at a pause; only its class identity is read. */
class PausedFileTab {}

/** Drives actual {@link BrowserViewport} through editor lifecycle boundaries without pretending to verify native paint. @example await viewportHarness('normal') */
async function viewportHarness(
  scenario: Scenario,
  leased = false,
  observer?: ViewportModule.ViewportRecordingObserver,
  mode: 'live' | 'recording' = 'live',
  renderer = viewportPanel(),
  /** What the editor reports once the debugger has opened a paused file, with the keyboard focus, in the first group; without it no debug session has stopped yet and no stack item is active. While the session is paused the active stack item is a frame; `sessionRunsAgain` makes it the thread without a frame, which both editors report once the session went on running, with that file still the active text editor. `learnerInChat` says how Cursor reports a learner who went back to the Agent chat afterwards: `'named group'` (the chat's group is the active tab group) or `'keyboard only'` (the paused file's tab is still named, and no text editor is active). */
  pausedFile?: {
    focusEditorOnBreak: boolean
    learnerInChat?: 'named group' | 'keyboard only'
    sessionRunsAgain?: boolean
    /** Cursor can report the paused text editor before updating the named active tab group. */
    namedGroupStaysInChat?: boolean
  },
  /** What the lease's owner answers when the viewport asks it, before the pane covers the paused file, whether the pane is to come without the keyboard: `true` (it gave the keyboard to the chat), `false` (to nobody), `'fails'` (its answer rejects) or `'held'` (it does not answer until the test calls `answerOwner`, and never if the test does not). Left out, the lease has no such owner. */
  ownerReturnsKeyboard?: boolean | 'fails' | 'held',
  /** Models native ownership admission and any focus effect of an asynchronous keyboard answer. */
  revealAdmission?: {
    assertCanReveal(panel: ReturnType<typeof viewportPanel>['panel']): void
    beforeOwnerAnswer?(): void
  },
) {
  const filename = join(__dirname, '../runtimeSupport/browserViewport.js')
  const nativeRequire = createRequire(filename)
  const exports: Partial<typeof ViewportModule> = {}
  const { panel } = renderer
  const sourceGroup = {
    viewColumn: 1,
    activeTab: { input: new PausedFileTab() },
  }
  const chatGroup = {
    viewColumn: 3,
    activeTab: { input: undefined },
  }
  let leaseReleases = 0,
    keyboardTakes = 0
  /** How many reveals the pane had seen each time the viewport asked the owner to give the keyboard back. */
  const revealsWhenOwnerAsked: number[] = []
  /** Answers the owner's held answer; see `ownerReturnsKeyboard`. */
  let answerHeldOwner = (_keeps: boolean): void => {}
  const failures: string[] = []
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      Buffer,
      require: (name: string) =>
        name === 'vscode'
          ? {
              window: {
                createWebviewPanel: () => panel,
                state: { focused: true },
                tabGroups: {
                  all: [sourceGroup, chatGroup],
                  activeTabGroup:
                    pausedFile?.learnerInChat === 'named group' ||
                    pausedFile?.namedGroupStaysInChat
                      ? chatGroup
                      : sourceGroup,
                },
                activeTextEditor: pausedFile?.learnerInChat
                  ? undefined
                  : { viewColumn: 1 },
              },
              ViewColumn: { One: 1 },
              TabInputText: PausedFileTab,
              debug: {
                activeStackItem: pausedFile
                  ? {
                      session: { id: 'live-next-server' },
                      threadId: 1,
                      ...(pausedFile.sessionRunsAgain ? {} : { frameId: 7 }),
                    }
                  : undefined,
              },
              workspace: {
                getConfiguration: () => ({
                  get: () => pausedFile?.focusEditorOnBreak,
                }),
              },
            }
          : nativeRequire(name),
    },
    { filename },
  )
  assert.ok(exports.BrowserViewport)
  const events: { type: string; detail: unknown }[] = []
  const viewport: ViewportModule.BrowserViewport = runInNewContext(
    'new Viewport("owned-run", record, fail, scenario, lease, observer, mode)',
    {
      Viewport: exports.BrowserViewport,
      scenario,
      observer,
      mode,
      record: (type: string, detail: unknown) => events.push({ type, detail }),
      fail: (reason: string) => failures.push(reason),
      lease: leased
        ? {
            panel,
            assertCanReveal: revealAdmission?.assertCanReveal,
            released(): void {
              leaseReleases++
            },
            tookKeyboardFromEditor(): void {
              keyboardTakes++
            },
            ...(ownerReturnsKeyboard === undefined
              ? {}
              : {
                  async comesWithoutKeyboard(): Promise<boolean> {
                    revealsWhenOwnerAsked.push(renderer.reveals.length)
                    revealAdmission?.beforeOwnerAnswer?.()
                    if (ownerReturnsKeyboard === 'fails')
                      throw new Error('The chat could not be focused.')
                    if (ownerReturnsKeyboard === 'held')
                      return new Promise<boolean>((resolve) => {
                        answerHeldOwner = resolve
                      })
                    return ownerReturnsKeyboard
                  },
                }),
          }
        : undefined,
    },
  )
  return {
    ...renderer,
    viewport,
    events,
    failures,
    counts: () => ({ panelDisposals: renderer.disposals(), leaseReleases }),
    /** How often the viewport told its lease's owner that the pane took the keyboard from the file the debugger focused at a pause. */
    keyboardTakes: () => keyboardTakes,
    /** For each time the viewport asked its lease's owner to give the keyboard back at a pause: how many reveals the pane had seen by then. */
    revealsWhenOwnerAsked: () => [...revealsWhenOwnerAsked],
    /** Lets an owner whose answer is held (`ownerReturnsKeyboard: 'held'`) answer now. @example harness.answerOwner(false) */
    answerOwner: (keeps: boolean): void => answerHeldOwner(keeps),
    rebind(
      replacement: ReturnType<typeof viewportPanel>,
      signal = new AbortController().signal,
    ): void {
      runInNewContext('viewport.rebindPanel(panel, signal)', {
        viewport,
        panel: replacement.panel,
        signal,
      })
    },
  }
}

/** Runs the real serialized image document for hidden-paint regressions; tests alone control animation availability. @example const renderer = await recordedRenderer(false); renderer.show(); renderer.paint() */
async function recordedRenderer(initiallyVisible: boolean) {
  const harness = await viewportHarness('normal', true, undefined, 'recording')
  const events = new Map<string, (() => void)[]>(),
    messages: ((event: { data: unknown }) => unknown)[] = [],
    animations: (() => void)[] = []
  const page = { hidden: true, src: '', removeAttribute(): void {} },
    phase = { textContent: '' }
  let visible = initiallyVisible
  harness.panel.webview.postMessage = (message) => {
    harness.messages.push(message)
    for (const callback of messages) void callback({ data: message })
    return Promise.resolve(true)
  }
  const script = harness.panel.webview.html.match(
    /<script nonce="[^"]+">([\s\S]*)<\/script>/,
  )?.[1]
  assert.ok(script)
  runInNewContext(script, {
    crypto,
    Date,
    setTimeout,
    acquireVsCodeApi: () => ({
      postMessage: (message: unknown): void => harness.receive(message),
    }),
    document: {
      get visibilityState() {
        return visible ? 'visible' : 'hidden'
      },
      hasFocus: () => visible,
      body: { clientWidth: 720, clientHeight: 640 },
      getElementById: (id: string) => (id === 'page' ? page : phase),
      addEventListener(name: string, callback: () => void) {
        events.set(name, [...(events.get(name) ?? []), callback])
      },
    },
    window: {
      addEventListener(
        name: string,
        callback: (event: { data: unknown }) => unknown,
      ) {
        if (name === 'message') messages.push(callback)
      },
    },
    Image: class {
      src = ''
      decode(): Promise<void> {
        return Promise.resolve()
      }
    },
    requestAnimationFrame: (callback: () => void) => animations.push(callback),
  })
  return {
    ...harness,
    page,
    phase,
    hide(): void {
      visible = false
      for (const callback of events.get('visibilitychange') ?? []) callback()
    },
    show(): void {
      visible = true
      for (const callback of events.get('visibilitychange') ?? []) callback()
    },
    paint(): void {
      while (animations.length) animations.shift()?.()
    },
  }
}

for (const start of ['already hidden', 'hidden after decode'] as const)
  test(`a recorded image ${start} waits for real painting instead of exhausting its deadline in the background`, async (context) => {
    // Arrange
    const renderer = await recordedRenderer(start !== 'already hidden')
    enableFakeClock(context)
    let outcome = 'pending'
    const capture = renderer.viewport
      .present('cGl4ZWxz', 'Recorded · 55.87 s')
      .then(
        () => {
          outcome = 'painted'
        },
        (error) => {
          outcome = String(error)
        },
      )
    try {
      await advanceClock(context, 0)
      if (start === 'hidden after decode') renderer.hide()
      // Act: Chromium cannot run animation callbacks while hidden, even though decoding and native panel visibility succeed.
      await advanceClock(context, CAPTURE_TIMEOUT_MS + 100)
      const hiddenOutcome = outcome
      renderer.show()
      renderer.paint()
      await advanceClockUntilSettled(context, capture, 1_000)
      // Assert
      assert.equal(hiddenOutcome, 'pending')
      assert.equal(outcome, 'painted')
      assert.equal(renderer.panel.visible, true)
      assert.equal(
        renderer.events.filter(
          (event) => event.type === 'viewport.acknowledged',
        ).length,
        1,
      )
    } finally {
      resetFakeClock(context)
      renderer.viewport.close()
      await capture
    }
  })

test('an explicit recorded gap waits through background suspension and confirms only its own painted placeholder', async (context) => {
  // Arrange
  const renderer = await recordedRenderer(false)
  enableFakeClock(context)
  let outcome = 'pending'
  const missing = renderer.viewport
    .presentMissing('Not recorded at this moment', new AbortController().signal)
    .then(
      () => {
        outcome = 'painted'
      },
      (error) => {
        outcome = String(error)
      },
    )
  try {
    // Act
    await advanceClock(context, CAPTURE_TIMEOUT_MS + 100)
    const hiddenOutcome = outcome
    renderer.show()
    renderer.paint()
    await advanceClockUntilSettled(context, missing, 1_000)
    // Assert
    assert.equal(hiddenOutcome, 'pending')
    assert.equal(outcome, 'painted')
    assert.equal(renderer.page.hidden, true)
    assert.equal(
      renderer.events.some((event) => event.type === 'viewport.acknowledged'),
      false,
    )
  } finally {
    resetFakeClock(context)
    renderer.viewport.close()
    await missing
  }
})

// Value: protects=a hidden recorded gap sleeps until Application can paint instead of waking the extension host every poll interval; fails_when=the gap wait polls its paint clock while the document is hidden; why_new=the performance review found the hidden gap wait polling at 50 ms without limit; seam=node:test mock of the shared timers/promises module counts poll timers
test('a hidden recorded gap waits without polling until Application becomes visible', async (context) => {
  // Arrange
  const nodeRequire = createRequire(__filename)
  const promiseTimers: typeof TimersPromisesModule = nodeRequire(
      'node:timers/promises',
    ),
    callbackTimers: typeof TimersModule = nodeRequire('node:timers')
  const renderer = await recordedRenderer(false)
  const pollCalls = context.mock.method(promiseTimers, 'setTimeout'),
    wakeTimerCalls = context.mock.method(callbackTimers, 'setTimeout')
  let outcome = 'pending'
  const missing = renderer.viewport
    .presentMissing('Not recorded at this moment', new AbortController().signal)
    .then(
      () => {
        outcome = 'painted'
      },
      (error) => {
        outcome = String(error)
      },
    )
  try {
    // Act
    await delay(POLL_INTERVAL_MS * 6)
    const hiddenPolls = pollCalls.mock.calls.filter(
        (call) => call.arguments[0] === POLL_INTERVAL_MS,
      ).length,
      hiddenWakeTimers = wakeTimerCalls.mock.calls.length
    renderer.show()
    renderer.paint()
    await missing

    // Assert
    assert.equal(hiddenPolls, 0)
    assert.equal(
      hiddenWakeTimers,
      0,
      'a hidden document arms no remaining-budget timer',
    )
    assert.equal(outcome, 'painted')
  } finally {
    renderer.viewport.close()
    await missing
  }
})

test('stale or malformed visibility cannot confirm hidden recorded pixels or change the current renderer clock', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true, undefined, 'recording')
  const epoch = '11111111-1111-1111-1111-111111111111'
  harness.ready(epoch)
  harness.receive({ type: 'visibility', epoch, visibility: 'hidden' })
  let confirmed = false
  const capture = harness.viewport
    .present('cGl4ZWxz', 'Recorded · 55.87 s')
    .then(() => {
      confirmed = true
    })
  try {
    await delay(0)
    const frame = harness.messages.findLast(
      (message) => message.type === 'frame',
    )
    // Act
    harness.receive({
      type: 'visibility',
      epoch: '22222222-2222-2222-2222-222222222222',
      visibility: 'visible',
    })
    harness.receive({ type: 'visibility', epoch, visibility: true })
    harness.receive({ type: 'painted', epoch, id: frame?.id })
    await delay(0)
    const hiddenConfirmed = confirmed
    harness.receive({ type: 'visibility', epoch, visibility: 'visible' })
    harness.receive({ type: 'painted', epoch, id: frame?.id })
    await capture
    // Assert
    assert.equal(hiddenConfirmed, false)
    assert.equal(confirmed, true)
    assert.equal(
      harness.events.filter((event) => event.type === 'viewport.acknowledged')
        .length,
      1,
    )
  } finally {
    harness.viewport.close()
  }
})

for (const boundary of ['new seek', 'close'] as const)
  test(`${boundary} retires hidden recorded pixels without waiting for a foreground window`, async () => {
    // Arrange
    const renderer = await recordedRenderer(false)
    const capture = renderer.viewport.present('cGl4ZWxz', 'Recorded · 55.87 s')
    const rejected = assert.rejects(capture, /invalidated|disposed/)
    try {
      await delay(0)
      // Act
      if (boundary === 'new seek') renderer.viewport.clearRecorded()
      else renderer.viewport.close()
      await rejected
      renderer.show()
      renderer.paint()
      // Assert
      assert.equal(
        renderer.events.some((event) => event.type === 'viewport.acknowledged'),
        false,
      )
    } finally {
      renderer.viewport.close()
    }
  })

test('cancelling a hidden recorded gap releases its wait without a fabricated placeholder receipt', async () => {
  // Arrange
  const renderer = await recordedRenderer(false),
    cancellation = new AbortController()
  const missing = renderer.viewport.presentMissing(
    'Not recorded at this moment',
    cancellation.signal,
  )
  const rejected = assert.rejects(missing, /aborted|cancelled/i)
  try {
    await delay(0)
    // Act
    cancellation.abort(new Error('Learner cancelled'))
    await rejected
    // Assert
    assert.equal(
      renderer.events.some((event) => event.type === 'viewport.acknowledged'),
      false,
    )
  } finally {
    renderer.viewport.close()
  }
})

for (const boundary of [
  'new recorded selection',
  'replacement renderer',
  'viewport closure',
] as const) {
  test(`${boundary} promptly rejects a hidden recorded gap without an AbortSignal or fabricated paint confirmation`, async () => {
    // Arrange
    const renderer = await recordedRenderer(false)
    let outcome = 'pending'
    const missing = renderer.viewport
      .presentMissing('Not recorded at this moment')
      .then(
        () => {
          outcome = 'painted'
        },
        (error) => {
          outcome = String(error)
        },
      )
    try {
      await delay(0)
      const gapMessage = renderer.messages.findLast(
        (message) => message.type === 'missing',
      )
      assert.ok(gapMessage && typeof gapMessage.epoch === 'string')
      assert.equal(outcome, 'pending')

      // Act: no signal or animation callback can release this stopped-clock wait.
      if (boundary === 'new recorded selection')
        renderer.viewport.clearRecorded()
      else if (boundary === 'replacement renderer') {
        const readinessRequest = renderer.messages.findLast(
          (message) => message.type === 'requestReady',
        )
        assert.ok(
          readinessRequest && typeof readinessRequest.requestId === 'string',
        )
        const replacementEpoch = '22222222-2222-2222-2222-222222222222'
        assert.notEqual(gapMessage.epoch, replacementEpoch)
        renderer.receive({
          type: 'ready',
          epoch: replacementEpoch,
          requestId: readinessRequest.requestId,
          visibility: 'hidden',
        })
        assert.deepEqual(
          JSON.parse(
            JSON.stringify(
              renderer.events.findLast(
                (event) => event.type === 'viewport.ready',
              )?.detail,
            ),
          ),
          { epoch: '22222222-2222-2222-2222-222222222222' },
        )
      } else renderer.viewport.close()
      const promptOutcome = await withinLimit(
        missing.then(() => outcome),
        500,
        'still waiting for hidden paint',
      )

      // Assert: lifecycle retirement must reject before visibility resumes, and late paint cannot resurrect it.
      assert.equal(
        promptOutcome,
        'Error: Recorded gap presentation invalidated.',
      )
      renderer.show()
      renderer.paint()
      await missing
      assert.equal(outcome, 'Error: Recorded gap presentation invalidated.')
      assert.equal(
        renderer.events.some((event) => event.type === 'viewport.acknowledged'),
        false,
      )
    } finally {
      renderer.viewport.close()
      await missing
    }
  })
}

test('cancelling placement while a recorded image is hidden releases only the placement reservation', async () => {
  // Arrange
  const renderer = await recordedRenderer(false),
    cancellation = new AbortController()
  let captureOutcome = 'pending'
  const capture = renderer.viewport
    .present('cGl4ZWxz', 'Recorded · 55.87 s')
    .then(
      () => {
        captureOutcome = 'painted'
      },
      () => {
        captureOutcome = 'retired'
      },
    )
  await delay(0)
  const placement = renderer.viewport.holdPlacement(cancellation.signal).then(
    (release) => {
      release()
      return 'acquired'
    },
    (error) => String(error),
  )
  try {
    // Act
    cancellation.abort(new Error('Learner cancelled placement'))
    const outcome = await withinLimit(
      placement,
      100,
      'still waiting for hidden paint',
    )
    // Assert: cancelling a layout action reports the learner's reason without waiting for visibility or retiring another owned frame.
    assert.equal(outcome, 'Error: Learner cancelled placement')
    assert.equal(captureOutcome, 'pending')
    renderer.show()
    renderer.paint()
    await capture
    assert.equal(captureOutcome, 'painted')
  } finally {
    renderer.viewport.close()
    await Promise.all([capture, placement])
  }
})

for (const mode of ['live', 'recording'] as const)
  test(`${mode} painting without a valid current hidden receipt retains a bounded timeout`, async (context) => {
    // Arrange
    const harness = await viewportHarness('normal', true, undefined, mode),
      epoch = '11111111-1111-1111-1111-111111111111'
    harness.ready(epoch)
    harness.receive({
      type: 'visibility',
      epoch: mode === 'live' ? epoch : '22222222-2222-2222-2222-222222222222',
      visibility: 'hidden',
    })
    enableFakeClock(context)
    try {
      // Act / Assert: the paint budget passes on a faked clock.
      const refused = assert.rejects(
        harness.viewport.present('cGl4ZWxz', 'before'),
        // A replay keeps the delivery's own reason, which its same-frame retry reads; a live run ends with the sentence for its reader.
        mode === 'live'
          ? /painted no frame within 3 s/
          : /acknowledgement timed out/,
      )
      await advanceClockUntilSettled(
        context,
        refused,
        CAPTURE_TIMEOUT_MS + 1_000,
      )
      await refused
      assert.equal(
        harness.events.some((event) => event.type === 'viewport.acknowledged'),
        false,
      )
    } finally {
      resetFakeClock(context)
      harness.viewport.close()
    }
  })

// Value: protects=the reason a live run ends with when its Application pane paints nothing saying what Codebook observed and the step that makes a new run possible; fails_when=the run ends with "Viewport frame acknowledgement timed out", which names nothing the learner or the agent can do; why_new=Cycle 0045 finding R2-F2 (second native round: an overlay covered the editor window and an admitted run ended in preparation with that text); seam=the viewport harness with a renderer that never acknowledges a frame and the fake clock for the three seconds of the paint bound
test('a live capture whose Application pane paints no frame within the bound ends with what was observed and the step that makes a new run possible', async (context) => {
  // Arrange: the renderer is ready and receives the frame, but paints nothing, as while a window covers the editor.
  const harness = await viewportHarness('normal', true),
    epoch = '11111111-1111-1111-1111-111111111111'
  harness.ready(epoch)
  enableFakeClock(context)
  try {
    // Act: the three seconds of the paint bound pass on a faked clock.
    const shown = harness.viewport.present('cGl4ZWxz', 'ready').then(
      () => 'confirmed',
      (error: unknown) => String(error),
    )
    const elapsedMs = await advanceClockUntilSettled(
      context,
      shown,
      CAPTURE_TIMEOUT_MS + 1_000,
    )
    // Assert
    assert.equal(
      await shown,
      'Error: The capture was not shown: the Application pane painted no frame within 3 s. Make the editor window and the Application pane visible, then start a new run.',
    )
    // The faked clock moves in steps of 50 ms, and the rejection is seen one step after the bound at the latest.
    assert.equal(elapsedMs >= 3_000 && elapsedMs <= 3_050, true)
    assert.equal(
      harness.events.some((event) => event.type === 'viewport.acknowledged'),
      false,
    )
  } finally {
    resetFakeClock(context)
    harness.viewport.close()
  }
})

test('a visible unresponsive recorded gap still fails within its paint budget', async (context) => {
  // Arrange
  const renderer = await recordedRenderer(true)
  enableFakeClock(context)
  try {
    // Act / Assert: deliberately withhold visible animation callbacks; the paint budget passes on a faked clock.
    const refused = assert.rejects(
      renderer.viewport.presentMissing('Not recorded at this moment'),
      /Timed out waiting for recorded gap presentation/,
    )
    await advanceClockUntilSettled(context, refused, CAPTURE_TIMEOUT_MS + 1_000)
    await refused
    assert.equal(
      renderer.events.some((event) => event.type === 'viewport.acknowledged'),
      false,
    )
  } finally {
    resetFakeClock(context)
    renderer.viewport.close()
  }
})

// Value: protects=a recorded gap placeholder is confirmed only by a receipt from a visible renderer; fails_when=the missing-painted handler stops refusing receipts while the recording document is hidden; why_new=existing gap tests withhold animation callbacks until visibility returns, so no hidden gap receipt ever reaches the viewport; seam=none
test('a recorded gap receipt sent while the recording is hidden cannot confirm the placeholder', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true, undefined, 'recording'),
    epoch = '11111111-1111-1111-1111-111111111111'
  harness.ready(epoch)
  harness.receive({ type: 'visibility', epoch, visibility: 'hidden' })
  let confirmed = false
  const pending = harness.viewport
    .presentMissing('Not recorded at this moment')
    .then(() => {
      confirmed = true
    })
  try {
    await delay(0)
    const missing = harness.messages.findLast(
      (message) => message.type === 'missing',
    )
    assert.ok(missing && typeof missing.id === 'string')

    // Act: the hidden document reports its placeholder, then becomes visible and reports it again.
    harness.receive({ type: 'missing-painted', epoch, id: missing.id })
    await delay(200)
    const hiddenConfirmed = confirmed
    harness.receive({ type: 'visibility', epoch, visibility: 'visible' })
    harness.receive({ type: 'missing-painted', epoch, id: missing.id })
    await pending

    // Assert
    assert.equal(hiddenConfirmed, false)
    assert.equal(confirmed, true)
    assert.equal(
      harness.events.some((event) => event.type === 'viewport.acknowledged'),
      false,
    )
  } finally {
    harness.viewport.close()
    await pending.catch(() => {})
  }
})

// Value: protects=hiding and revealing Application cannot extend a stalled recorded gap beyond its visible paint budget; fails_when=the recording paint clock forgets or over-counts visible time used before a visibility change; why_new=the gap deadline reads BrowserViewport's own clock rather than FrameDelivery's, and existing gap tests never toggle visibility after visible time was consumed; seam=none
test('a stalled recorded gap keeps the paint time it used before Application was hidden', async (context) => {
  // Arrange: half of the paint budget elapses while the unpainted placeholder is visible.
  const renderer = await recordedRenderer(true)
  enableFakeClock(context)
  let outcome = 'pending'
  const missing = renderer.viewport
    .presentMissing('Not recorded at this moment')
    .then(
      () => {
        outcome = 'painted'
      },
      (error) => {
        outcome = String(error)
      },
    )
  try {
    await advanceClock(context, CAPTURE_TIMEOUT_MS / 2)

    // Act: a long hidden interval, then visibility returns without any painted placeholder.
    renderer.hide()
    await advanceClock(context, CAPTURE_TIMEOUT_MS / 2)
    renderer.show()
    await advanceClock(context, 400)
    const soonAfterShowing = outcome
    // A whole fresh budget would still be waiting 1.9 s later; the helper then fails the test.
    await advanceClockUntilSettled(context, missing, 1_900)
    const settled = outcome

    // Assert: hidden time is free, but the remaining half expires instead of restarting the whole budget.
    assert.equal(soonAfterShowing, 'pending')
    assert.equal(
      settled,
      'Error: Timed out waiting for recorded gap presentation',
    )
    assert.equal(
      renderer.events.some((event) => event.type === 'viewport.acknowledged'),
      false,
    )
  } finally {
    resetFakeClock(context)
    renderer.viewport.close()
    await missing
  }
})

// Value: protects=native placement behind a hidden recorded image fails within its named active bound instead of hanging presentation; fails_when=the placement drain loses its response timeout while hidden paints may wait indefinitely; why_new=the only hidden drain test cancels explicitly, so nothing proves an uncancelled drain ends; seam=none
test('placement behind a hidden recorded image times out, releases its reservation and leaves the image to paint later', async (context) => {
  // Arrange
  const renderer = await recordedRenderer(false),
    signal = new AbortController().signal
  enableFakeClock(context)
  let captureOutcome = 'pending'
  const capture = renderer.viewport
    .present('cGl4ZWxz', 'Recorded · 55.87 s')
    .then(
      () => {
        captureOutcome = 'painted'
      },
      (error) => {
        captureOutcome = String(error)
      },
    )
  try {
    await advanceClock(context, 0)

    // Act: nobody cancels the move, and the hidden document cannot run animation callbacks.
    // The outer bound turns a lost drain timeout into a failed test instead of a hung test file.
    const draining = renderer.viewport.holdPlacement(signal).then(
      () => 'placement acquired',
      (error) => String(error),
    )
    await advanceClock(context, ACTIVE_TIMEOUT_MS - 250)
    let drainOutcomeBeforeBound = 'still draining'
    void draining.then((label) => {
      drainOutcomeBeforeBound = label
    })
    await advanceClock(context, 0)
    const beforeBound = drainOutcomeBeforeBound
    await advanceClockUntilSettled(context, draining, 5_000)
    const drainOutcome = await draining
    const outcomeAfterTimeout = captureOutcome
    renderer.show()
    renderer.paint()
    await advanceClockUntilSettled(context, capture, 1_000)
    const release = await renderer.viewport.holdPlacement(signal)
    release()

    // Assert
    assert.equal(beforeBound, 'still draining')
    assert.equal(
      drainOutcome,
      'Error: Timed out waiting for viewport placement drain',
    )
    assert.equal(outcomeAfterTimeout, 'pending')
    assert.equal(captureOutcome, 'painted')
    assert.equal(
      renderer.events.filter((event) => event.type === 'viewport.acknowledged')
        .length,
      1,
    )
  } finally {
    resetFakeClock(context)
    renderer.viewport.close()
    await capture
  }
})

test('closing a shared application panel ends both live and replay leases unless each lease has transferred', async () => {
  // Arrange
  const renderer = viewportPanel(),
    closes: boolean[] = []
  const live = await viewportHarness(
    'normal',
    true,
    {
      elapsedMs: () => 123,
      frame() {},
      closed: (event) => closes.push(event.expected),
    },
    'live',
    renderer,
  )
  live.viewport.showHistory('<p>Independent live session hidden by replay</p>')
  const replay = await viewportHarness(
    'normal',
    true,
    undefined,
    'recording',
    renderer,
  )
  // Act
  renderer.panel.dispose()
  // Assert
  assert.deepEqual(live.failures, ['Owned viewport closed before cleanup'])
  assert.deepEqual(replay.failures, ['Owned viewport closed before cleanup'])
  assert.deepEqual(closes, [false])
  live.viewport.close()
  replay.viewport.close()
})

// Value: protects=the real BrowserViewport behaviour that the workspace harness models for a shared Application panel; fails_when=the recording viewport rewrites its own document or confirms a paint after a live lease's history page replaced it; why_new=Cycle 0035 R07g (only the workspace harness modelled the replaced-document sequence); seam=the test panel answers a frame only while the recording renderer's document is in place
test('a live lease writing its history page over the recording renderer on one shared panel leaves that renderer unable to confirm a paint', async () => {
  // Arrange: a live lease and a recording lease share one panel, the recording renderer wrote its document last and confirms a first paint.
  const renderer = viewportPanel()
  const live = await viewportHarness(
    'normal',
    true,
    undefined,
    'live',
    renderer,
  )
  const replay = await viewportHarness(
    'normal',
    true,
    undefined,
    'recording',
    renderer,
  )
  const recordingDocument = renderer.panel.webview.html,
    epoch = '11111111-1111-1111-1111-111111111111'
  replay.ready(epoch)
  const answerFrameWhileRendererInPlace = async (): Promise<void> => {
    const frame = await renderer.nextFrame()
    // A webview whose document was replaced has no renderer left to answer.
    if (renderer.panel.webview.html === recordingDocument)
      renderer.receive({ type: 'painted', epoch, id: frame.id })
  }
  const firstAnswer = answerFrameWhileRendererInPlace()
  await replay.viewport.present('Zmlyc3Q=', 'Recorded 0.10 s')
  await firstAnswer
  try {
    // Act
    live.viewport.showHistory('<p>Loading recording</p>')
    const secondAnswer = answerFrameWhileRendererInPlace()
    const secondPaint = replay.viewport
      .present('c2Vjb25k', 'Recorded 0.20 s')
      .then(
        () => 'confirmed',
        (error: unknown) => String(error),
      )
    await secondAnswer

    // Assert
    assert.equal(
      await secondPaint,
      'Error: Viewport frame acknowledgement timed out',
    )
    assert.equal(renderer.panel.webview.html, '<p>Loading recording</p>')
    assert.equal(
      replay.events.filter((event) => event.type === 'viewport.acknowledged')
        .length,
      1,
    )
  } finally {
    live.viewport.close()
    replay.viewport.close()
  }
})

test('revealing a destroyed renderer cannot confirm an image using its old readiness response', async () => {
  // Arrange
  const harness = await viewportHarness('normal')
  const firstEpoch = '11111111-1111-1111-1111-111111111111'
  const secondEpoch = '22222222-2222-2222-2222-222222222222'
  harness.ready(firstEpoch)
  const oldRequest = harness.messages.findLast(
    (message) => message.type === 'requestReady',
  )
  harness.hide()
  let revealed = false
  const reveal = harness.viewport
    .reveal(new AbortController().signal)
    .then(() => {
      revealed = true
    })
  // Act
  harness.receive({
    type: 'ready',
    epoch: firstEpoch,
    requestId: oldRequest?.requestId,
  })
  await delay(0)
  // Assert
  assert.equal(revealed, false)
  harness.ready(secondEpoch)
  await reveal
  const capture = harness.viewport.present('YWZ0ZXI=', 'after')
  await delay(0)
  const sent = harness.messages.findLast((message) => message.type === 'frame')
  assert.equal(sent?.epoch, secondEpoch)
  harness.receive({ type: 'painted', epoch: secondEpoch, id: sent?.id })
  assert.equal((await capture).epoch, secondEpoch)
  harness.viewport.close()
})

test('required frame progress remains private diagnostic evidence until the matching paint acknowledgement', async () => {
  // Arrange
  const harness = await viewportHarness('normal')
  const epoch = '33333333-3333-3333-3333-333333333333'
  harness.ready(epoch)
  const capture = harness.viewport.present('aW1hZ2U=', 'before')
  await delay(0)
  const frame = harness.messages.findLast((message) => message.type === 'frame')
  assert.ok(frame && typeof frame.id === 'number')
  // Act
  harness.receive({
    type: 'frame-stage',
    epoch,
    id: frame.id,
    stage: 'decoded',
    visibility: 'visible',
    hasArea: true,
    data: 'private-image',
  })
  harness.receive({
    type: 'frame-stage',
    epoch: '44444444-4444-4444-4444-444444444444',
    id: frame.id,
    stage: 'paint-queued',
    visibility: 'visible',
    hasArea: true,
  })
  await delay(0)
  // Assert
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        harness.events
          .filter((event) => event.type === 'viewport.frame-stage')
          .map((event) => event.detail),
      ),
    ),
    [{ id: frame.id, stage: 'decoded', visibility: 'visible', hasArea: true }],
  )
  assert.equal(
    harness.events.some((event) => event.type === 'viewport.acknowledged'),
    false,
  )
  harness.receive({ type: 'painted', epoch, id: frame.id })
  await capture
  assert.equal(
    harness.events.filter((event) => event.type === 'viewport.acknowledged')
      .length,
    1,
  )
  harness.viewport.close()
})

test('a recorded seek clears pending pixels and rejects their late acknowledgement before a replacement image', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true, undefined, 'recording'),
    epoch = '11111111-1111-1111-1111-111111111111'
  harness.ready(epoch)
  const original = harness.viewport.present('b2xk', 'Recorded 0.10 s'),
    rejected = assert.rejects(original, /invalidated/)
  await delay(0)
  const first = harness.messages.findLast((message) => message.type === 'frame')
  // Act
  harness.viewport.clearRecorded()
  harness.receive({ type: 'painted', epoch, id: first?.id })
  const replacement = harness.viewport.present('bmV3', 'Recorded 0.20 s')
  await delay(0)
  const second = harness.messages.findLast(
    (message) => message.type === 'frame',
  )
  harness.receive({ type: 'painted', epoch, id: second?.id })
  // Assert
  await rejected
  assert.equal((await replacement).id, 2)
  assert.equal(
    harness.messages.some(
      (message) => message.type === 'reset' && message.clear === true,
    ),
    true,
  )
  assert.equal(
    harness.events.filter((event) => event.type === 'viewport.acknowledged')
      .length,
    1,
  )
  harness.viewport.close()
})

// Value: protects=a recorded moment's frame reaching the pane before its source and values are presented, as a frame that asks for no receipt and clears nothing; fails_when=the preview posts a `reset` with `clear: true` (a blank pane), or asks for a paint receipt that holds the moment; why_new=Cycle 0050 F3 (D29); seam=the viewport harness; no_claim=the webview's off-screen decode and swap
test('a recorded preview posts one non-required frame and no clearing reset', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true, undefined, 'recording'),
    epoch = '11111111-1111-1111-1111-111111111111'
  harness.ready(epoch)

  // Act
  harness.viewport.previewRecorded('b2xk', 'Recorded 0.10 s')
  await delay(0)

  // Assert
  const frames = harness.messages.filter((message) => message.type === 'frame')
  assert.equal(frames.length, 1)
  assert.equal(frames[0]?.required, false)
  assert.equal(frames[0]?.phase, 'Recorded 0.10 s')
  assert.equal(
    harness.messages.some((message) => message.type === 'reset'),
    false,
  )
  harness.viewport.close()
})

// Value: protects=previewRecorded telling its caller whether the frame was posted, so a dropped preview is answered by clearing the pane and not by leaving the earlier moment's pixels; fails_when=it returns true for a frame that no renderer will show (before the renderer is ready, in a live viewport, after close, or while a required frame is already pending) or false for one it posted; why_new=Cycle 0050 F374 (it returned nothing, so a drop was invisible to the workspace); seam=the viewport harness's renderer epoch and its two delivery slots; no_claim=the webview's decode and swap
test('a recorded preview reports whether it was posted: yes with a renderer, no before one, after close or beside a pending required frame', async () => {
  // Arrange
  const recording = await viewportHarness(
      'normal',
      true,
      undefined,
      'recording',
    ),
    live = await viewportHarness('normal', true, undefined, 'live'),
    epoch = '11111111-1111-1111-1111-111111111111',
    beforeRenderer = recording.viewport.previewRecorded(
      'b2xk',
      'Recorded 0.10 s',
    )
  recording.ready(epoch)
  live.ready(epoch)

  // Act
  const withRenderer = recording.viewport.previewRecorded(
    'b2xk',
    'Recorded 0.10 s',
  )
  const inLiveViewport = live.viewport.previewRecorded(
    'b2xk',
    'Recorded 0.10 s',
  )
  // The posted preview is still in flight, so a required frame waits behind it: the delivery takes no preview.
  const queued = recording.viewport.present('bmV3', 'Recorded 0.30 s')
  await delay(0)
  const besideRequired = recording.viewport.previewRecorded(
    'b2xk',
    'Recorded 0.40 s',
  )
  recording.viewport.close()
  const afterClose = recording.viewport.previewRecorded(
    'b2xk',
    'Recorded 0.50 s',
  )
  live.viewport.close()
  await Promise.allSettled([queued])

  // Assert
  assert.deepEqual(
    {
      beforeRenderer,
      withRenderer,
      inLiveViewport,
      besideRequired,
      afterClose,
    },
    {
      beforeRenderer: false,
      withRenderer: true,
      inLiveViewport: false,
      besideRequired: false,
      afterClose: false,
    },
  )
})

// Value: protects=previewRecorded refusing a preview while a pause image is pinned, the drop condition the workspace harness's fake holdPausePinned models; fails_when=the viewport posts a non-required preview over a pinned pause image or reports it posted; why_new=Cycle 0050 F396 (the fake modelled only the pending required frame; this pins the real condition it now copies); seam=the viewport harness's renderer epoch, a painted pause frame and the delivery's frozen state; no_claim=the webview's decode and swap
test('a recorded preview is dropped while a pause image is pinned and posted again after the pause ends', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true, undefined, 'recording'),
    epoch = '11111111-1111-1111-1111-111111111111'
  harness.ready(epoch)
  const paused = harness.viewport.present('cGl4ZWxz', 'paused at stop')
  await delay(0)
  const frame = harness.messages.findLast((message) => message.type === 'frame')
  harness.receive({ type: 'painted', epoch, id: frame?.id })
  await paused

  // Act
  const whilePinned = harness.viewport.previewRecorded(
    'b2xk',
    'Recorded 0.10 s',
  )
  harness.viewport.resume()
  const afterResume = harness.viewport.previewRecorded(
    'b2xk',
    'Recorded 0.20 s',
  )
  harness.viewport.close()

  // Assert
  assert.deepEqual(
    { whilePinned, afterResume },
    { whilePinned: false, afterResume: true },
  )
})

test('a recorded gap requires its own current renderer receipt and never certifies a PNG', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true, undefined, 'recording'),
    epoch = '11111111-1111-1111-1111-111111111111'
  harness.ready(epoch)
  let confirmed = false
  // Act
  const pending = harness.viewport.presentMissing('Stream lost').then(() => {
    confirmed = true
  })
  await delay(0)
  const missing = harness.messages.findLast(
    (message) => message.type === 'missing',
  )
  harness.receive({
    type: 'missing-painted',
    epoch: '22222222-2222-2222-2222-222222222222',
    id: missing?.id,
  })
  await delay(0)
  assert.equal(confirmed, false)
  harness.receive({ type: 'missing-painted', epoch, id: missing?.id })
  await pending
  // Assert
  assert.equal(confirmed, true)
  assert.equal(
    harness.messages.some((message) => message.type === 'frame'),
    false,
  )
  assert.equal(
    harness.events.some((event) => event.type === 'viewport.acknowledged'),
    false,
  )
  harness.viewport.close()
})

test('recording receives a stream frame only after its CDP acknowledgement is sent and observer failure cannot stop rendering', async () => {
  // Arrange
  const requests: string[] = [],
    order: string[] = [],
    observed: number[] = []
  class RespondingSocket extends EventTarget {
    send(value: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      const message = JSON.parse(String(value))
      requests.push(message.method)
      if (message.method === 'Page.screencastFrameAck') order.push('ack')
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({ id: message.id, result: {} }),
          }),
        ),
      )
    }
    close(): void {
      this.dispatchEvent(new Event('close'))
    }
  }
  const socket = new RespondingSocket(),
    cdp = new Cdp(socket, () => undefined)
  const harness = await viewportHarness('normal', false, {
    elapsedMs: () => 75,
    frame(input) {
      order.push('observer')
      observed.push(input.elapsedMs)
      throw new Error('injected recorder error')
    },
    closed() {},
  })
  const attaching = harness.viewport.attach(cdp, new AbortController().signal)
  await delay(0)
  harness.ready('11111111-1111-1111-1111-111111111111')
  await attaching
  // Act
  for (let index = 0; index < 2; index++)
    socket.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          method: 'Page.screencastFrame',
          params: {
            data: 'cGl4ZWxz',
            sessionId: index + 1,
            metadata: { timestamp: 1234 },
          },
        }),
      }),
    )
  await delay(0)
  // Assert
  assert.deepEqual(order, ['ack', 'observer', 'ack'])
  assert.deepEqual(observed, [75])
  assert.equal(
    requests.filter((method) => method === 'Page.screencastFrameAck').length,
    2,
  )
  assert.equal(
    harness.events.filter((event) => event.type === 'recording.observer-failed')
      .length,
    1,
  )
  assert.equal(
    harness.messages.some((message) => message.type === 'frame'),
    true,
  )
  harness.viewport.close()
  cdp.close()
})

test('recorded phase receipt precedes presentation and hidden history never earns a renderer confirmation', async () => {
  // Arrange
  const observed: Parameters<
    ViewportModule.ViewportRecordingObserver['frame']
  >[0][] = []
  const closes: Parameters<
    ViewportModule.ViewportRecordingObserver['closed']
  >[0][] = []
  const harness = await viewportHarness('normal', true, {
    elapsedMs: () => 123,
    frame: (frame) => observed.push(frame),
    closed: (event) => closes.push(event),
  })
  harness.viewport.showHistory('<p>Historical study</p>')
  // Act
  harness.viewport.recordCapture('cGl4ZWxz', 'paused-server')
  await assert.rejects(
    harness.viewport.present('cGl4ZWxz', 'paused-server'),
    /viewing history/,
  )
  harness.viewport.close()
  harness.viewport.close()
  // Assert
  assert.equal(observed.length, 1)
  assert.equal(observed[0]?.elapsedMs, 123)
  assert.equal(observed[0]?.kind, 'phase')
  assert.equal(
    harness.events.some((event) => event.type === 'viewport.acknowledged'),
    false,
  )
  assert.equal(closes.length, 1)
  assert.equal(closes[0]?.expected, true)
})

test('historical reading rejects hidden current captures and releases the runtime without closing its reader panel', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true),
    epoch = '11111111-1111-1111-1111-111111111111'
  harness.ready(epoch)
  // Act
  harness.viewport.showHistory('<p>Server observation history</p>')
  await assert.rejects(
    harness.viewport.present('cGF1c2U=', 'paused-browser'),
    /viewing history/,
  )
  harness.receive({
    type: 'ready',
    epoch: '22222222-2222-2222-2222-222222222222',
  })
  harness.viewport.close()
  const messagesAfterClose = harness.messages.length
  harness.receive({ type: 'ready', epoch })
  // Assert
  assert.equal(harness.panel.webview.html, '<p>Server observation history</p>')
  assert.deepEqual(harness.counts(), { panelDisposals: 0, leaseReleases: 1 })
  assert.equal(harness.messages.length, messagesAfterClose)
})

test('continuation during renderer reload prevents the retired pause from being displayed or acknowledged', async () => {
  // Arrange
  const harness = await viewportHarness('viewport-reload')
  harness.ready('11111111-1111-1111-1111-111111111111')
  const capture = harness.viewport.present('cGF1c2U=', 'paused-1')
  const rejected = assert.rejects(capture, /presentation invalidated/)
  // Act
  harness.viewport.resume()
  harness.ready('22222222-2222-2222-2222-222222222222')
  await rejected
  // Assert
  assert.equal(
    harness.messages.some(
      (message) => message.type === 'frame' && message.phase === 'paused-1',
    ),
    false,
  )
  harness.viewport.close()
})

test('invalidating a displayed pause rejects its late acknowledgement before any newer image can be certified', async () => {
  // Arrange
  const harness = await viewportHarness('normal')
  const epoch = '11111111-1111-1111-1111-111111111111'
  harness.ready(epoch)
  const capture = harness.viewport.present('cGF1c2U=', 'paused-1')
  const rejected = assert.rejects(capture, /Pause display invalidated/)
  await delay(0)
  const sent = harness.messages.findLast((message) => message.type === 'frame')
  // Act
  harness.viewport.resume()
  harness.receive({ type: 'painted', epoch, id: sent?.id })
  // Assert
  await rejected
  assert.equal(harness.messages.at(-1)?.type, 'reset')
  harness.viewport.close()
})

test('native placement drains the current required image and holds newer image delivery until release', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true),
    epoch = '11111111-1111-1111-1111-111111111111'
  harness.ready(epoch)
  const first = harness.viewport.present('Zmlyc3Q=', 'paused-1')
  await delay(0)
  const firstFrame = harness.messages.findLast(
    (message) => message.type === 'frame',
  )
  let acquired = false
  // Act
  const placement = harness.viewport
    .holdPlacement(new AbortController().signal)
    .then((release) => {
      acquired = true
      return release
    })
  const next = harness.viewport.present('bmV4dA==', 'paused-2')
  await delay(0)
  // Assert
  assert.equal(acquired, false)
  assert.equal(
    harness.messages.filter((message) => message.type === 'frame').length,
    1,
  )
  harness.receive({ type: 'painted', epoch, id: firstFrame?.id })
  await first
  const release = await placement
  await delay(0)
  assert.equal(acquired, true)
  assert.equal(
    harness.messages.filter((message) => message.type === 'frame').length,
    1,
  )
  release()
  await delay(0)
  const nextFrame = harness.messages.findLast(
    (message) => message.type === 'frame',
  )
  assert.equal(
    harness.messages.filter((message) => message.type === 'frame').length,
    2,
  )
  assert.equal(nextFrame?.data, 'bmV4dA==')
  harness.receive({ type: 'painted', epoch, id: nextFrame?.id })
  await next
  harness.viewport.close()
})

test('closing a viewport releases held placement without delivering a queued historical image', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true)
  harness.ready('11111111-1111-1111-1111-111111111111')
  const release = await harness.viewport.holdPlacement(
    new AbortController().signal,
  )
  const queued = harness.viewport.present('cXVldWVk', 'paused-1'),
    rejected = assert.rejects(queued, /closed/)
  // Act
  harness.viewport.close()
  release()
  await rejected
  // Assert
  assert.equal(
    harness.messages.filter((message) => message.type === 'frame').length,
    0,
  )
  assert.deepEqual(harness.counts(), { panelDisposals: 0, leaseReleases: 1 })
})

test('manual continuation while placement drains invalidates the old paint and releases waiting work', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true),
    epoch = '11111111-1111-1111-1111-111111111111'
  harness.ready(epoch)
  const first = harness.viewport.present('cGF1c2U=', 'paused-1'),
    rejected = assert.rejects(first, /invalidated/)
  await delay(0)
  const placement = harness.viewport.holdPlacement(
      new AbortController().signal,
    ),
    placementRejected = assert.rejects(placement, /invalidated/)
  // Act
  harness.viewport.resume()
  await rejected
  await placementRejected
  const next = harness.viewport.present('YWZ0ZXI=', 'after')
  await delay(0)
  const frame = harness.messages.findLast((message) => message.type === 'frame')
  harness.receive({ type: 'painted', epoch, id: frame?.id })
  // Assert
  assert.equal((await next).epoch, epoch)
  harness.viewport.close()
})

test('a held viewport transfers its paused pixels without letting the retired panel close or acknowledge the session', async () => {
  // Arrange
  const closes: boolean[] = [],
    observed: string[] = []
  const harness = await viewportHarness('normal', true, {
    elapsedMs: () => 123,
    frame: (frame) => observed.push(frame.data),
    closed: (event) => closes.push(event.expected),
  })
  const oldEpoch = '11111111-1111-1111-1111-111111111111',
    newEpoch = '22222222-2222-2222-2222-222222222222'
  harness.ready(oldEpoch)
  const firstFrame = harness.nextFrame(),
    capture = harness.viewport.present('cGF1c2U=', 'paused-1')
  const original = await firstFrame
  harness.receive({ type: 'painted', epoch: oldEpoch, id: original.id })
  await capture
  const retiredCallbacks = harness.callbacks(),
    replacement = viewportPanel(),
    signal = new AbortController().signal
  const release = await harness.viewport.holdPlacement(signal)
  // Act
  harness.rebind(replacement)
  harness.panel.dispose()
  for (const callback of retiredCallbacks.disposal) callback()
  assert.deepEqual(harness.failures, [])
  assert.deepEqual(closes, [])
  assert.equal(replacement.panel.webview.html, '')
  release()
  const nextFrame = replacement.nextFrame()
  let restored = false
  const restoration = harness.viewport.restorePlacement(signal).then(() => {
    restored = true
  })
  replacement.ready(newEpoch)
  const next = await nextFrame
  for (const callback of retiredCallbacks.receivers)
    callback({ type: 'painted', epoch: newEpoch, id: next.id })
  replacement.receive({ type: 'painted', epoch: oldEpoch, id: original.id })
  await delay(0)
  // Assert
  assert.equal(restored, false)
  assert.equal(next.data, 'cGF1c2U=')
  assert.equal(next.epoch, newEpoch)
  assert.equal(
    harness.events.filter((event) => event.type === 'viewport.acknowledged')
      .length,
    1,
  )
  const confirmedFrame = replacement.nextFrame()
  replacement.receive({ type: 'painted', epoch: newEpoch, id: next.id })
  const confirmed = await confirmedFrame
  replacement.receive({ type: 'painted', epoch: newEpoch, id: confirmed.id })
  await restoration
  harness.viewport.recordCapture('bGF0ZXI=', 'after')
  assert.deepEqual(observed, ['bGF0ZXI='])
  assert.equal(restored, true)
  assert.deepEqual(harness.failures, [])
  assert.deepEqual(closes, [])
  replacement.panel.dispose()
  replacement.panel.dispose()
  assert.deepEqual(harness.failures, ['Owned viewport closed before cleanup'])
  assert.deepEqual(closes, [false])
  harness.viewport.close()
  assert.deepEqual(harness.counts(), { panelDisposals: 1, leaseReleases: 1 })
})

test('pane handoff waits for the accepted required paint before detaching its old acknowledgement listener', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true),
    replacement = viewportPanel(),
    signal = new AbortController().signal
  const epoch = '11111111-1111-1111-1111-111111111111'
  harness.ready(epoch)
  const nextFrame = harness.nextFrame(),
    pending = harness.viewport.present('cGF1c2U=', 'paused-1'),
    frame = await nextFrame
  // Act
  const holding = harness.viewport.holdPlacement(signal)
  assert.throws(
    () => harness.rebind(replacement),
    /current drained lease placement/,
  )
  harness.receive({ type: 'painted', epoch, id: frame.id })
  await pending
  const release = await holding
  harness.rebind(replacement)
  release()
  harness.panel.dispose()
  // Assert
  assert.deepEqual(harness.failures, [])
  assert.equal(harness.callbacks().receivers.length, 0)
  assert.equal(replacement.callbacks().receivers.length, 1)
  harness.viewport.close()
  assert.equal(replacement.callbacks().receivers.length, 0)
})

test('refreshing a visible recorded application does not reveal its native pane over Study focus', async () => {
  // Arrange
  const renderer = viewportPanel(),
    harness = await viewportHarness(
      'normal',
      true,
      undefined,
      'recording',
      renderer,
    )
  let nativeReveals = 0
  renderer.panel.reveal = (): void => {
    nativeReveals++
  }

  // Act
  const refreshing = harness.viewport.reveal(new AbortController().signal)
  renderer.ready('22222222-2222-2222-2222-222222222222')
  await refreshing

  // Assert
  assert.equal(nativeReveals, 0)
  assert.equal(renderer.panel.visible, true)
  harness.viewport.close()
})

test('live-follow refresh restores an adopted renderer after placement fails without revealing a newer learner tab', async () => {
  // Arrange: a native failure leaves the new panel adopted while the old live pause and lease survive.
  const harness = await viewportHarness('normal', true),
    replacement = viewportPanel()
  const signal = new AbortController().signal,
    oldEpoch = '11111111-1111-1111-1111-111111111111'
  harness.ready(oldEpoch)
  const firstFrame = harness.nextFrame(),
    capture = harness.viewport.present('cGF1c2U=', 'paused-1')
  const first = await firstFrame
  harness.receive({ type: 'painted', epoch: oldEpoch, id: first.id })
  await capture
  const release = await harness.viewport.holdPlacement(signal)
  harness.rebind(replacement)
  harness.panel.dispose()
  release()
  let reveals = 0
  replacement.panel.reveal = (): void => {
    reveals++
  }
  try {
    // Act: the ordinary follow path must recover without retrying native placement or selecting the tab.
    await harness.viewport.showLive(signal)
    // Assert: a new document confirms the retained pause, with no new capture or native focus operation.
    assert.match(replacement.panel.webview.html, /<!doctype html>/i)
    assert.equal(reveals, 0)
    const restoredFrame = replacement.nextFrame()
    replacement.ready('22222222-2222-2222-2222-222222222222')
    const restored = await restoredFrame
    assert.equal(restored.data, 'cGF1c2U=')
    replacement.receive({
      type: 'painted',
      epoch: restored.epoch,
      id: restored.id,
    })
    const html = replacement.panel.webview.html
    await harness.viewport.showLive(signal)
    assert.equal(replacement.panel.webview.html, html)
    assert.equal(reveals, 0)
    assert.deepEqual(harness.failures, [])
  } finally {
    harness.viewport.close()
  }
})

test('pane handoff refuses unleased, unreserved, aborted and already closed viewport ownership', async () => {
  // Arrange
  const unleased = await viewportHarness('normal'),
    leased = await viewportHarness('normal', true),
    replacement = viewportPanel()
  const signal = new AbortController().signal,
    aborted = new AbortController()
  aborted.abort(new Error('Learner cancelled handoff'))
  const releaseUnleased = await unleased.viewport.holdPlacement(signal)
  // Act
  assert.throws(
    () => unleased.rebind(replacement),
    /current drained lease placement/,
  )
  assert.throws(
    () => leased.rebind(replacement),
    /current drained lease placement/,
  )
  const release = await leased.viewport.holdPlacement(signal)
  assert.throws(
    () => leased.rebind(replacement, aborted.signal),
    /Learner cancelled handoff/,
  )
  leased.viewport.close()
  assert.throws(
    () => leased.rebind(replacement),
    /current drained lease placement/,
  )
  // Assert
  assert.equal(replacement.panel.webview.html, '')
  assert.equal(replacement.callbacks().receivers.length, 0)
  assert.equal(replacement.disposals(), 0)
  assert.equal(
    leased.events.some((event) => event.type === 'viewport.panel-rebound'),
    false,
  )
  release()
  releaseUnleased()
  unleased.viewport.close()
})

// Value: protects=rebinding the live-history and replay leases keeping the independent recorder alive and painting only the chosen presentation; fails_when=a rebinding stops the recorder or paints the other presentation; why_new=two leases share one viewport; seam=a fake browser viewport; no_claim=real pixels
test('rebinding both live-history and replay leases preserves the independent recorder and paints only the chosen presentation', async () => {
  // Arrange
  const original = viewportPanel(),
    replacement = viewportPanel(),
    closes: boolean[] = []
  const live = await viewportHarness(
    'normal',
    true,
    {
      elapsedMs: () => 123,
      frame() {},
      closed: (event) => closes.push(event.expected),
    },
    'live',
    original,
  )
  live.viewport.showHistory('<p>Preserved live history</p>')
  const replay = await viewportHarness(
      'normal',
      true,
      undefined,
      'recording',
      original,
    ),
    signal = new AbortController().signal
  const releaseLive = await live.viewport.holdPlacement(signal),
    releaseReplay = await replay.viewport.holdPlacement(signal)
  // Act
  live.rebind(replacement)
  replay.rebind(replacement)
  original.panel.dispose()
  releaseLive()
  releaseReplay()
  assert.equal(replacement.panel.webview.html, '')
  const revealing = replay.viewport.reveal(signal)
  replacement.ready('22222222-2222-2222-2222-222222222222')
  await revealing
  const replayHtml = replacement.panel.webview.html
  await assert.rejects(
    live.viewport.present('Y3VycmVudA==', 'paused-2'),
    /viewing history/,
  )
  // Assert
  assert.equal(replacement.panel.webview.html, replayHtml)
  assert.notEqual(replayHtml, '<p>Preserved live history</p>')
  assert.deepEqual(live.failures, [])
  assert.deepEqual(replay.failures, [])
  assert.deepEqual(closes, [])
  replay.viewport.close()
  await live.viewport.restorePlacement(signal)
  assert.equal(replacement.panel.webview.html, '<p>Preserved live history</p>')
  live.viewport.close()
  live.viewport.close()
  assert.deepEqual(closes, [true])
  assert.equal(replacement.disposals(), 0)
  assert.equal(replacement.callbacks().receivers.length, 0)
})

// Value: protects=a test replay's later moments keep the shown history's document and update only its restore copy, which is written once, when a replacement panel needs it, at the latest moment; fails_when=updateHistory writes the shown document again (its scroll, selection and focus are lost), a replacement panel restores an earlier moment, or a document is built at every moment (Step 9 performance: 100 to 300 KB per step on the extension host); why_new=PR-B1 posts later moments into the Application document in place (EN3) and the copy is how a replacement panel gets them; seam=the viewport harness's panels; no_claim=VS Code's own restore of a hidden webview
test('a history update keeps the shown document and a replacement panel restores the latest moment, written only then', async () => {
  // Arrange
  const original = viewportPanel(),
    replacement = viewportPanel(),
    signal = new AbortController().signal
  const live = await viewportHarness(
    'normal',
    true,
    undefined,
    'live',
    original,
  )
  live.viewport.showHistory('<p>Stop 1 of 2 · 0.20 s</p>')
  const written: string[] = []

  // Act
  live.viewport.updateHistory(() => {
    written.push('output')
    return '<p>Output · 0.25 s</p>'
  })
  live.viewport.updateHistory(() => {
    written.push('stop 2')
    return '<p>Stop 2 of 2 · 0.30 s</p>'
  })
  const shownAfterUpdate = original.panel.webview.html
  const writtenBeforeRestore = [...written]
  const release = await live.viewport.holdPlacement(signal)
  live.rebind(replacement)
  original.panel.dispose()
  release()
  await live.viewport.restorePlacement(signal)

  // Assert
  assert.equal(shownAfterUpdate, '<p>Stop 1 of 2 · 0.20 s</p>')
  assert.deepEqual(writtenBeforeRestore, [])
  assert.deepEqual(written, ['stop 2'])
  assert.equal(replacement.panel.webview.html, '<p>Stop 2 of 2 · 0.30 s</p>')
  assert.deepEqual(live.failures, [])
  live.viewport.close()
})

// Value: protects=a replacement panel restores the history shown last, not a test replay's later moment that an earlier history left as its restore copy; fails_when=showHistory keeps the earlier replay's restore copy, so a replacement panel brings back that replay's moment over the history or recording selected since, or the earlier copy is built at all; why_new=Step 9 pass 2's testing review: since pass 1b the restore copy is a second field, cleared by showHistory and showLive, and no test shows another history after an update; seam=the viewport harness's panels; no_claim=VS Code's own restore of a hidden webview
test('a history shown after a test replay’s later moment is what a replacement panel restores', async () => {
  // Arrange
  const original = viewportPanel(),
    replacement = viewportPanel(),
    signal = new AbortController().signal
  const live = await viewportHarness(
    'normal',
    true,
    undefined,
    'live',
    original,
  )
  live.viewport.showHistory('<p>Test replay · Stop 1 of 2 · 0.20 s</p>')
  const written: string[] = []
  live.viewport.updateHistory(() => {
    written.push('test replay')
    return '<p>Test replay · Stop 2 of 2 · 0.30 s</p>'
  })

  // Act
  live.viewport.showHistory('<p>Browser recording · 1.50 s</p>')
  const release = await live.viewport.holdPlacement(signal)
  live.rebind(replacement)
  original.panel.dispose()
  release()
  await live.viewport.restorePlacement(signal)

  // Assert
  assert.equal(
    replacement.panel.webview.html,
    '<p>Browser recording · 1.50 s</p>',
  )
  assert.deepEqual(written, [])
  assert.deepEqual(live.failures, [])
  live.viewport.close()
})

test('closing the current panel releases a reserved placement and rejects waiting capture without later cleanup', async () => {
  // Arrange
  const harness = await viewportHarness('normal', true),
    release = await harness.viewport.holdPlacement(new AbortController().signal)
  const queued = harness.viewport.present('cXVldWVk', 'paused-1').then(
    () => 'painted',
    () => 'closed',
  )
  // Act
  harness.panel.dispose()
  const outcome = await withinLimit(queued, 100, 'still waiting for cleanup')
  // Assert
  try {
    assert.equal(outcome, 'closed')
    assert.equal(
      harness.messages.some((message) => message.type === 'frame'),
      false,
    )
  } finally {
    release()
    harness.viewport.close()
    await queued
  }
})

test('a rebound live viewport keeps one CDP stream and records later frames without closing the recorder', async () => {
  // Arrange
  const requests: string[] = [],
    observed: string[] = [],
    closes: boolean[] = []
  class RespondingSocket extends EventTarget {
    send(value: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      const message = JSON.parse(String(value))
      requests.push(message.method)
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({ id: message.id, result: {} }),
          }),
        ),
      )
    }
    close(): void {
      this.dispatchEvent(new Event('close'))
    }
  }
  const socket = new RespondingSocket(),
    cdp = new Cdp(socket, () => undefined),
    replacement = viewportPanel(),
    signal = new AbortController().signal
  const harness = await viewportHarness('normal', true, {
    elapsedMs: () => 123,
    frame: (frame) => observed.push(frame.data),
    closed: (event) => closes.push(event.expected),
  })
  const attaching = harness.viewport.attach(cdp, signal)
  await delay(0)
  harness.ready('11111111-1111-1111-1111-111111111111')
  await attaching
  const originalFrame = harness.nextFrame()
  socket.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({
        method: 'Page.screencastFrame',
        params: {
          data: 'Zmlyc3Q=',
          sessionId: 1,
          metadata: { timestamp: 1234 },
        },
      }),
    }),
  )
  const first = await originalFrame
  harness.receive({ type: 'painted', epoch: first.epoch, id: first.id })
  // Act
  const release = await harness.viewport.holdPlacement(signal)
  harness.rebind(replacement)
  harness.panel.dispose()
  release()
  const restoredFrame = replacement.nextFrame(),
    revealing = harness.viewport.reveal(signal)
  replacement.ready('22222222-2222-2222-2222-222222222222')
  await revealing
  const restored = await restoredFrame
  replacement.receive({
    type: 'painted',
    epoch: restored.epoch,
    id: restored.id,
  })
  const laterFrame = replacement.nextFrame()
  socket.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({
        method: 'Page.screencastFrame',
        params: {
          data: 'c2Vjb25k',
          sessionId: 2,
          metadata: { timestamp: 1235 },
        },
      }),
    }),
  )
  const later = await laterFrame
  replacement.receive({ type: 'painted', epoch: later.epoch, id: later.id })
  // Assert
  assert.equal(later.data, 'c2Vjb25k')
  assert.deepEqual(observed, ['Zmlyc3Q=', 'c2Vjb25k'])
  assert.equal(
    requests.filter((method) => method === 'Page.startScreencast').length,
    1,
  )
  assert.equal(
    requests.filter((method) => method === 'Page.screencastFrameAck').length,
    2,
  )
  assert.deepEqual(harness.failures, [])
  assert.deepEqual(closes, [])
  harness.viewport.close()
  cdp.close()
  assert.deepEqual(closes, [true])
})

// Value: protects=a hidden recorded gap when the learner closes the Application panel; fails_when=panel disposal marks the viewport closed without waking the gap wait, so playback stays loading until a later visibility change that never comes; why_new=Cycle 0032 T1, the lifecycle boundary tests cover explicit closure but not native panel disposal; seam=none
test('disposing the recording panel promptly rejects a hidden recorded gap without fabricated paint confirmation', async () => {
  // Arrange
  const renderer = await recordedRenderer(false)
  let outcome = 'pending'
  const missing = renderer.viewport
    .presentMissing('Not recorded at this moment')
    .then(
      () => {
        outcome = 'painted'
      },
      (error) => {
        outcome = String(error)
      },
    )
  try {
    await delay(0)
    assert.equal(outcome, 'pending')

    // Act
    renderer.panel.dispose()
    const promptOutcome = await withinLimit(
      missing.then(() => outcome),
      500,
      'still waiting for hidden paint',
    )

    // Assert
    assert.equal(promptOutcome, 'Error: Recorded gap presentation invalidated.')
    assert.equal(
      renderer.events.some((event) => event.type === 'viewport.acknowledged'),
      false,
    )
  } finally {
    renderer.viewport.close()
  }
})

// Value: protects=the keyboard focus after each captured pause of a live run (0037-F6); fails_when=the Application pane is revealed over the paused file the debugger focused while preserving focus, which hides the focused editor and leaves document.activeElement on body until a click; why_new=native run of 2026-10-04 (a57.focuslog.txt: body 5.5 s after each stop); seam=fake editor with a paused debug session
test('the Application pane takes the keyboard focus when it is revealed over the file the debugger focused at a pause', async () => {
  // Arrange: the debugger opened the paused file in the Application pane's group and focused it.
  const harness = await viewportHarness(
    'normal',
    true,
    undefined,
    'live',
    viewportPanel(),
    { focusEditorOnBreak: true },
  )
  harness.hide()
  const signal = new AbortController().signal

  // Act
  const revealed = harness.viewport.reveal(signal)
  harness.ready('11111111-1111-1111-1111-111111111111')
  await revealed

  // Assert
  assert.deepEqual(harness.reveals, [{ preserveFocus: false }])
  harness.viewport.close()
})

// Value: protects=the owner of the Application pane hearing that the pane took the keyboard from the paused file, so that it can give the keyboard back to the chat that had it before the pause or tell the learner where it is; fails_when=the pane takes the keyboard at a pause and nobody is told: in Cursor's tab layout the chat never gets the keyboard back from a run whose paused file opens in the Application pane's group, and with a side-view chat no sentence is shown; why_new=Cycle 0046 row 5, Cursor half (runs r5a and r5b of 2026-10-05: at every pause the Application pane took the keyboard, and no sentence was shown); seam=fake editor with a paused debug session and a lease that counts the calls
for (const { returnsToChat, expectedReveals, expectedTakes } of [
  {
    returnsToChat: true,
    expectedReveals: [{ preserveFocus: true }],
    expectedTakes: 0,
  },
  {
    returnsToChat: false,
    expectedReveals: [{ preserveFocus: false }],
    expectedTakes: 1,
  },
])
  // Cursor's first-pause trace names chat as the active group after its debugger has focused the source.
  test(`a paused file covered by Application ${returnsToChat ? 'gives the chat its keyboard back before reveal' : 'gives Application the keyboard'} even while Cursor still names the chat tab group`, async () => {
    // Arrange
    const harness = await viewportHarness(
      'normal',
      true,
      undefined,
      'live',
      viewportPanel(),
      { focusEditorOnBreak: true, namedGroupStaysInChat: true },
      returnsToChat,
    )
    harness.hide()
    try {
      // Act
      const revealed = harness.viewport.reveal(new AbortController().signal)
      await waitUntil(
        () => harness.reveals.length > 0,
        'the reveal after deciding who keeps the keyboard',
        2_000,
      )
      harness.ready('11111111-1111-1111-1111-111111111111')
      await revealed

      // Assert
      assert.deepEqual(harness.revealsWhenOwnerAsked(), [0])
      assert.deepEqual(harness.reveals, expectedReveals)
      assert.equal(harness.keyboardTakes(), expectedTakes)
    } finally {
      harness.viewport.close()
    }
  })

test('the Application pane tells its owner once when it took the keyboard from the file the debugger focused at a pause', async () => {
  // Arrange: the debugger opened the paused file in the Application pane's group and focused it.
  const harness = await viewportHarness(
    'normal',
    true,
    undefined,
    'live',
    viewportPanel(),
    { focusEditorOnBreak: true },
  )
  harness.hide()
  const signal = new AbortController().signal

  // Act
  const revealed = harness.viewport.reveal(signal)
  harness.ready('11111111-1111-1111-1111-111111111111')
  await revealed

  // Assert
  assert.deepEqual(harness.reveals, [{ preserveFocus: false }])
  assert.equal(harness.keyboardTakes(), 1)
  harness.viewport.close()
})

for (const [ownerAnswer, revealPreservesFocus, takesTold] of [
  ['gave the keyboard back', true, 0],
  ['gave it to nobody', false, 1],
  ['could not answer', false, 1],
] as const)
  // Value: protects=the keyboard of a learner who was typing in a chat when a live run paused and its Application pane came to the front over the paused file: the pane's owner gives the keyboard back before the pane is revealed, and the pane is then revealed without it; where the owner gave it to nobody the pane takes it and says so; fails_when=the pane is revealed with the keyboard first and the owner returns it right behind that reveal, so the pane's frame, whose focus lands after the reveal returned, takes the keyboard again; or an owner that gave nothing back leaves the keyboard on no element; why_new=Cycle 0046 row 140, item 10 (a webview's focus cannot be awaited); seam=fake editor with a paused debug session and a lease whose owner answers the question and records how many reveals it had seen
  test(`the Application pane asks its owner to give the keyboard back before it is revealed over the file the debugger focused at a pause, and ${revealPreservesFocus ? 'leaves the keyboard where the owner put it' : 'takes the keyboard and tells its owner'} when the owner ${ownerAnswer}`, async () => {
    // Arrange: the debugger opened the paused file in the Application pane's group and focused it; the lease has an owner that can give the keyboard back.
    const harness = await viewportHarness(
      'normal',
      true,
      undefined,
      'live',
      viewportPanel(),
      { focusEditorOnBreak: true },
      ownerAnswer === 'gave the keyboard back'
        ? true
        : ownerAnswer === 'gave it to nobody'
          ? false
          : 'fails',
    )
    harness.hide()
    const signal = new AbortController().signal

    // Act: the reveal waits for the owner's answer, and the renderer answers once the pane is in front.
    const revealed = harness.viewport.reveal(signal)
    await waitUntil(
      () => harness.reveals.length > 0,
      "the pane's reveal after its owner answered",
      2_000,
    )
    harness.ready('11111111-1111-1111-1111-111111111111')
    await revealed

    // Assert: the owner was asked once, before any reveal.
    assert.deepEqual(harness.revealsWhenOwnerAsked(), [0])
    assert.deepEqual(harness.reveals, [{ preserveFocus: revealPreservesFocus }])
    assert.equal(harness.keyboardTakes(), takesTold)
    harness.viewport.close()
  })

// Value: protects=a reveal of the Application pane that was called off while its owner was asked about the keyboard: the pane stays as it is, takes no keyboard and tells nothing; fails_when=after the owner's answer only the viewport's closure is read again, so an aborted reveal still brings the pane to the front and, when the owner gave the keyboard to nobody, takes the keyboard and tells the notice before its wait throws; why_new=Cycle 0046 row 253 (delegated review, finding 6); seam=fake editor with a paused debug session, a lease whose owner's answer is held, and the reveal's abort signal
test('a reveal of the Application pane that is aborted while its owner is asked about the keyboard reveals nothing, takes no keyboard and tells nothing', async () => {
  // Arrange: the debugger opened the paused file in the Application pane's group and focused it; the owner does not answer yet.
  const harness = await viewportHarness(
    'normal',
    true,
    undefined,
    'live',
    viewportPanel(),
    { focusEditorOnBreak: true },
    'held',
  )
  harness.hide()
  const abort = new AbortController()

  // Act: the reveal waits for the owner; it is called off; then the owner answers that it gave the keyboard to nobody.
  const revealed = harness.viewport.reveal(abort.signal)
  await waitUntil(
    () => harness.revealsWhenOwnerAsked().length > 0,
    "the viewport's question to its owner",
    2_000,
  )
  abort.abort(new Error('The presentation was replaced.'))
  harness.answerOwner(false)
  const outcome = await revealed.then(
    () => 'revealed',
    (error: unknown) => String(error),
  )

  // Assert
  assert.equal(outcome, 'Error: The presentation was replaced.')
  assert.deepEqual(harness.reveals, [])
  assert.equal(harness.keyboardTakes(), 0)
  harness.viewport.close()
})

test('moving the App group during a keyboard answer preserves native source input and refuses the late reveal', async () => {
  // Arrange
  const renderer = viewportPanel(),
    harness = await viewportHarness(
      'normal',
      true,
      undefined,
      'live',
      renderer,
      { focusEditorOnBreak: false },
      'held',
      {
        assertCanReveal(current) {
          assert.equal(current, renderer.panel)
          if (current.viewColumn !== 1)
            throw new Error(
              'Application ownership changed; use Focus Application.',
            )
        },
      },
    )
  renderer.focusNativeSource()
  let outcome: string | undefined
  const revealing = harness.viewport.reveal(new AbortController().signal).then(
    () => {
      outcome = 'displayed'
    },
    (error: unknown) => {
      outcome = String(error)
    },
  )
  await waitUntil(
    () => harness.revealsWhenOwnerAsked().length === 1,
    'owner asked',
    2_000,
  )

  // Act
  renderer.panel.viewColumn = 2
  harness.answerOwner(true)
  await waitUntil(
    () => outcome !== undefined || harness.reveals.length > 0,
    'reveal or refusal',
    2_000,
  )
  // The original implementation is allowed to finish its real handshake, so RED is an ownership assertion rather than a timeout.
  if (harness.reveals.length)
    harness.ready('11111111-1111-1111-1111-111111111111')
  await revealing

  // Assert
  assert.equal(renderer.nativeInput(), 'source')
  assert.equal(
    outcome,
    'Error: Application ownership changed; use Focus Application.',
  )
  assert.deepEqual(harness.reveals, [])
  assert.equal(harness.keyboardTakes(), 0)
  assert.equal(
    harness.messages.some((message) => message.type === 'requestReady'),
    false,
  )
  harness.viewport.close()
})

test('an already unsafe App reveal never asks a keyboard owner that would move source input into chat', async () => {
  // Arrange
  const renderer = viewportPanel(),
    harness = await viewportHarness(
      'normal',
      true,
      undefined,
      'live',
      renderer,
      { focusEditorOnBreak: false },
      'held',
      {
        assertCanReveal() {
          throw new Error(
            'Application ownership changed; use Focus Application.',
          )
        },
        beforeOwnerAnswer() {
          renderer.focusChat()
        },
      },
    )
  renderer.focusNativeSource()
  let outcome: string | undefined

  // Act
  const revealing = harness.viewport.reveal(new AbortController().signal).then(
    () => {
      outcome = 'displayed'
    },
    (error: unknown) => {
      outcome = String(error)
    },
  )
  await waitUntil(
    () => outcome !== undefined || harness.revealsWhenOwnerAsked().length > 0,
    'admission or keyboard owner',
    2_000,
  )
  if (harness.revealsWhenOwnerAsked().length) harness.answerOwner(true)
  await revealing

  // Assert
  assert.equal(renderer.nativeInput(), 'source')
  assert.equal(
    outcome,
    'Error: Application ownership changed; use Focus Application.',
  )
  assert.deepEqual(harness.revealsWhenOwnerAsked(), [])
  assert.deepEqual(harness.reveals, [])
  assert.equal(
    harness.messages.some((message) => message.type === 'requestReady'),
    false,
  )
  harness.viewport.close()
})

test('a failed App keyboard answer cannot bypass final ownership refusal or hide native source input', async () => {
  // Arrange
  const renderer = viewportPanel(),
    harness = await viewportHarness(
      'normal',
      true,
      undefined,
      'live',
      renderer,
      { focusEditorOnBreak: false },
      'fails',
      {
        assertCanReveal(current) {
          if (current.viewColumn !== 1)
            throw new Error(
              'Application ownership changed; use Focus Application.',
            )
        },
        beforeOwnerAnswer() {
          renderer.panel.viewColumn = 2
        },
      },
    )
  renderer.focusNativeSource()
  let outcome: string | undefined

  // Act
  const revealing = harness.viewport.reveal(new AbortController().signal).then(
    () => {
      outcome = 'displayed'
    },
    (error: unknown) => {
      outcome = String(error)
    },
  )
  await waitUntil(
    () => outcome !== undefined || harness.reveals.length > 0,
    'reveal or refusal',
    2_000,
  )
  if (harness.reveals.length)
    harness.ready('11111111-1111-1111-1111-111111111111')
  await revealing

  // Assert
  assert.equal(renderer.nativeInput(), 'source')
  assert.equal(
    outcome,
    'Error: Application ownership changed; use Focus Application.',
  )
  assert.deepEqual(harness.reveals, [])
  assert.equal(harness.keyboardTakes(), 0)
  // Explicit native App focus can recover; the following handshake needs no unsafe background reveal.
  renderer.panel.reveal(1, false)
  const recovered = harness.viewport.reveal(new AbortController().signal)
  harness.ready('22222222-2222-2222-2222-222222222222')
  await recovered
  assert.equal(renderer.nativeInput(), 'app')
  assert.deepEqual(harness.reveals, [{ preserveFocus: false }])
  harness.viewport.close()
})

// Value: protects=the Application pane and every placement behind its reveal when the owner's answer about the keyboard never comes (the editor does not answer the chat's focus command): after two seconds the reveal goes on as if the keyboard had been given to nobody, so the pane takes it and says so; fails_when=the wait for the owner has no bound, so one command the editor does not answer holds the reveal and everything queued behind it for good; why_new=Cycle 0046 row 253 (delegated review, finding 6); seam=fake editor with a paused debug session, a lease whose owner never answers, and the faked clock
test('the Application pane takes the keyboard and tells its owner two seconds after it asked an owner that does not answer, and not before', async (context) => {
  // Arrange: the debugger opened the paused file in the Application pane's group and focused it; the owner never answers.
  const harness = await viewportHarness(
    'normal',
    true,
    undefined,
    'live',
    viewportPanel(),
    { focusEditorOnBreak: true },
    'held',
  )
  harness.hide()
  const signal = new AbortController().signal
  enableFakeClock(context)

  // Act: the reveal asks its owner and waits; 1.9 s pass, then 0.2 s more.
  const revealed = harness.viewport.reveal(signal)
  await advanceClock(context, 1_900)
  const revealsBeforeTheBound = harness.reveals.length
  await advanceClock(context, 200)
  const revealsAfterTheBound = [...harness.reveals]
  // A reveal that still waited would be let go here, so that a run without the bound ends too.
  harness.answerOwner(false)
  await advanceClock(context, 0)
  harness.ready('11111111-1111-1111-1111-111111111111')
  await advanceClock(context, 100)
  resetFakeClock(context)
  await revealed

  // Assert
  assert.deepEqual(harness.revealsWhenOwnerAsked(), [0])
  assert.equal(revealsBeforeTheBound, 0)
  assert.deepEqual(revealsAfterTheBound, [{ preserveFocus: false }])
  assert.equal(harness.keyboardTakes(), 1)
  harness.viewport.close()
})

for (const [situation, pausedFile] of [
  // Cycle 0045 X7-A.4: the debugger opened the paused file in the Application's group, and the learner went back to Cursor's chat before a delayed reveal.
  [
    "the learner went back to Cursor's chat after a pause and the editor names the chat's group",
    { focusEditorOnBreak: true, learnerInChat: 'named group' },
  ],
  [
    "the learner went back to Cursor's chat after a pause and the editor still names the paused file's tab, with no active text editor",
    { focusEditorOnBreak: true, learnerInChat: 'keyboard only' },
  ],
] as const)
  // Value: protects=the keyboard focus of a learner who types in Cursor's chat tab while the Application pane is brought back; fails_when=the Application pane takes the focus, or asks its owner about a keyboard, although it covers no active text editor; why_new=control for the 0037-F6 fix; seam=fake editor
  test(`the Application pane leaves the keyboard focus where it is when it is revealed while ${situation}`, async () => {
    // Arrange: the lease has an owner that could give the keyboard back.
    const harness = await viewportHarness(
      'normal',
      true,
      undefined,
      'live',
      viewportPanel(),
      pausedFile,
      true,
    )
    harness.hide()
    const signal = new AbortController().signal

    // Act
    const revealed = harness.viewport.reveal(signal)
    harness.ready('11111111-1111-1111-1111-111111111111')
    await revealed

    // Assert
    assert.deepEqual(harness.reveals, [{ preserveFocus: true }])
    // A pane that left the keyboard where it was has nothing to tell its owner, and nothing to ask it.
    assert.equal(harness.keyboardTakes(), 0)
    assert.deepEqual(harness.revealsWhenOwnerAsked(), [])
    harness.viewport.close()
  })

for (const [situation, pausedFile] of [
  ['no debug session has stopped yet', undefined],
  [
    'the session runs again after a pause and the editor reports its thread',
    { focusEditorOnBreak: true, sessionRunsAgain: true },
  ],
  [
    'a session is paused and the learner turned off debug.focusEditorOnBreak',
    { focusEditorOnBreak: false },
  ],
] as const)
  for (const [ownerAnswer, owner, revealPreservesFocus, takesTold, asked] of [
    ['says that the keyboard is not in that editor', true, true, 0, [0]],
    ['says that the learner works in that editor', false, false, 1, [0]],
    ['could not answer', 'fails', true, 0, [0]],
    ['does not exist', undefined, true, 0, []],
  ] as const)
    // Value: protects=the keyboard of a learner around an Application pane that comes to the front over the active text editor of its group while the debugger gave that editor no keyboard (no stop yet, a session that runs, a stop with debug.focusEditorOnBreak off): the pane's owner, who knows whether the learner works in that editor, is asked, and the pane takes the keyboard only when the owner says so; fails_when=the owner is asked only at a pause that focused the file, so a learner who clicked into the covered file loses the keyboard to no element; or a pane without an owner, or with one that fails, takes the keyboard from a learner who types in a side-view chat; why_new=Cycle 0046 row 293 (the viewport judged these three situations alone, as "the keyboard cannot be told"); seam=fake editor with a text editor in front of the pane's group in the three states of the debugger, and a lease whose owner answers, fails or is missing
    test(`the Application pane that comes to the front over the active text editor while ${situation} ${revealPreservesFocus ? 'leaves the keyboard where it is' : 'takes the keyboard and tells its owner'} when the owner ${ownerAnswer}`, async () => {
      // Arrange: a text editor is in front of the Application pane's group and is the active text editor.
      const harness = await viewportHarness(
        'normal',
        true,
        undefined,
        'live',
        viewportPanel(),
        pausedFile,
        owner,
      )
      harness.hide()
      const signal = new AbortController().signal

      // Act: the reveal waits for an owner that is asked, and the renderer answers once the pane is in front.
      const revealed = harness.viewport.reveal(signal)
      await waitUntil(
        () => harness.reveals.length > 0,
        "the pane's reveal",
        2_000,
      )
      harness.ready('11111111-1111-1111-1111-111111111111')
      await revealed

      // Assert
      assert.deepEqual(harness.revealsWhenOwnerAsked(), asked)
      assert.deepEqual(harness.reveals, [
        { preserveFocus: revealPreservesFocus },
      ])
      assert.equal(harness.keyboardTakes(), takesTold)
      harness.viewport.close()
    })
