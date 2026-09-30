import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { setTimeout as delay } from 'node:timers/promises'
import type * as ViewportModule from '../runtimeSupport/browserViewport'
import type { Scenario } from '../runtimeSupport/constants'
import { Cdp } from '../runtimeSupport/cdp'
import {
  ACTIVE_TIMEOUT_MS,
  CAPTURE_TIMEOUT_MS,
  POLL_INTERVAL_MS,
} from '../runtimeSupport/constants'

/** Models multiple viewport listeners on one reader so {@link viewportHarness} can verify shared lease retirement. @example const renderer = viewportPanel() */
function viewportPanel() {
  const messages: Record<string, unknown>[] = []
  const receivers = new Set<(message: unknown) => void>(),
    visibility = new Set<() => void>(),
    disposal = new Set<() => void>()
  const posted = new Set<(message: Record<string, unknown>) => void>()
  let panelDisposals = 0
  const panel = {
    visible: true,
    reveal() {
      panel.visible = true
      for (const callback of visibility) callback()
    },
    dispose() {
      if (panelDisposals) return
      panelDisposals++
      for (const callback of [...disposal]) callback()
    },
    onDidDispose(callback: () => void) {
      disposal.add(callback)
      return {
        dispose() {
          disposal.delete(callback)
        },
      }
    },
    onDidChangeViewState(callback: () => void) {
      visibility.add(callback)
      return {
        dispose() {
          visibility.delete(callback)
        },
      }
    },
    webview: {
      html: '',
      onDidReceiveMessage(callback: (message: unknown) => void) {
        receivers.add(callback)
        return {
          dispose() {
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
    disposals: () => panelDisposals,
    callbacks: () => ({
      receivers: [...receivers],
      visibility: [...visibility],
      disposal: [...disposal],
    }),
    hide() {
      panel.visible = false
      for (const callback of visibility) callback()
    },
    receive(message: unknown) {
      for (const callback of [...receivers]) callback(message)
    },
    nextFrame(): Promise<Record<string, unknown>> {
      return new Promise((resolve) => {
        const callback = (message: Record<string, unknown>) => {
          if (message.type !== 'frame') return
          posted.delete(callback)
          resolve(message)
        }
        posted.add(callback)
      })
    },
    ready(epoch: string) {
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

/** Drives actual {@link BrowserViewport} through editor lifecycle boundaries without pretending to verify native paint. @example await viewportHarness('normal') */
async function viewportHarness(
  scenario: Scenario,
  leased = false,
  observer?: ViewportModule.ViewportRecordingObserver,
  mode: 'live' | 'recording' = 'live',
  renderer = viewportPanel(),
) {
  const filename = join(__dirname, '../runtimeSupport/browserViewport.js')
  const nativeRequire = createRequire(filename)
  const exports: Partial<typeof ViewportModule> = {}
  const { panel } = renderer
  let leaseReleases = 0
  const failures: string[] = []
  runInNewContext(
    await readFile(filename, 'utf8'),
    {
      exports,
      Buffer,
      require: (name: string) =>
        name === 'vscode'
          ? {
              window: { createWebviewPanel: () => panel },
              ViewColumn: { One: 1 },
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
            released() {
              leaseReleases++
            },
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
    rebind(
      replacement: ReturnType<typeof viewportPanel>,
      signal = new AbortController().signal,
    ) {
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
  const page = { hidden: true, src: '', removeAttribute() {} },
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
      postMessage: (message: unknown) => harness.receive(message),
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
      decode() {
        return Promise.resolve()
      }
    },
    requestAnimationFrame: (callback: () => void) => animations.push(callback),
  })
  return {
    ...harness,
    page,
    phase,
    hide() {
      visible = false
      for (const callback of events.get('visibilitychange') ?? []) callback()
    },
    show() {
      visible = true
      for (const callback of events.get('visibilitychange') ?? []) callback()
    },
    paint() {
      while (animations.length) animations.shift()?.()
    },
  }
}

for (const start of ['already hidden', 'hidden after decode'] as const)
  test(`a recorded image ${start} waits for real painting instead of exhausting its deadline in the background`, async () => {
    // Arrange
    const renderer = await recordedRenderer(start !== 'already hidden')
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
      await delay(0)
      if (start === 'hidden after decode') renderer.hide()
      // Act: Chromium cannot run animation callbacks while hidden, even though decoding and native panel visibility succeed.
      await delay(CAPTURE_TIMEOUT_MS + 100)
      const hiddenOutcome = outcome
      renderer.show()
      renderer.paint()
      await capture
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
      renderer.viewport.close()
      await capture
    }
  })

test('an explicit recorded gap waits through background suspension and confirms only its own painted placeholder', async () => {
  // Arrange
  const renderer = await recordedRenderer(false)
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
    await delay(CAPTURE_TIMEOUT_MS + 100)
    const hiddenOutcome = outcome
    renderer.show()
    renderer.paint()
    await missing
    // Assert
    assert.equal(hiddenOutcome, 'pending')
    assert.equal(outcome, 'painted')
    assert.equal(renderer.page.hidden, true)
    assert.equal(
      renderer.events.some((event) => event.type === 'viewport.acknowledged'),
      false,
    )
  } finally {
    renderer.viewport.close()
    await missing
  }
})

// Value: protects=a hidden recorded gap sleeps until Application can paint instead of waking the extension host every poll interval; fails_when=the gap wait polls its paint clock while the document is hidden; why_new=the performance review found the hidden gap wait polling at 50 ms without limit; seam=node:test mock of the shared timers/promises module counts poll timers
test('a hidden recorded gap waits without polling until Application becomes visible', async (context) => {
  // Arrange
  const nodeRequire = createRequire(__filename)
  const promiseTimers: typeof import('node:timers/promises') = nodeRequire(
      'node:timers/promises',
    ),
    callbackTimers: typeof import('node:timers') = nodeRequire('node:timers')
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
      const promptOutcome = await Promise.race([
        missing.then(() => outcome),
        delay(500).then(() => 'still waiting for hidden paint'),
      ])

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
    const outcome = await Promise.race([
      placement,
      delay(100).then(() => 'still waiting for hidden paint'),
    ])
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
  test(`${mode} painting without a valid current hidden receipt retains a bounded timeout`, async () => {
    // Arrange
    const harness = await viewportHarness('normal', true, undefined, mode),
      epoch = '11111111-1111-1111-1111-111111111111'
    harness.ready(epoch)
    harness.receive({
      type: 'visibility',
      epoch: mode === 'live' ? epoch : '22222222-2222-2222-2222-222222222222',
      visibility: 'hidden',
    })
    try {
      // Act / Assert
      await assert.rejects(
        harness.viewport.present('cGl4ZWxz', 'before'),
        /acknowledgement timed out/,
      )
      assert.equal(
        harness.events.some((event) => event.type === 'viewport.acknowledged'),
        false,
      )
    } finally {
      harness.viewport.close()
    }
  })

test('a visible unresponsive recorded gap still fails within its paint budget', async () => {
  // Arrange
  const renderer = await recordedRenderer(true)
  try {
    // Act / Assert: deliberately withhold visible animation callbacks.
    await assert.rejects(
      renderer.viewport.presentMissing('Not recorded at this moment'),
      /Timed out waiting for recorded gap presentation/,
    )
    assert.equal(
      renderer.events.some((event) => event.type === 'viewport.acknowledged'),
      false,
    )
  } finally {
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
test('a stalled recorded gap keeps the paint time it used before Application was hidden', async () => {
  // Arrange: half of the paint budget elapses while the unpainted placeholder is visible.
  const renderer = await recordedRenderer(true)
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
    await delay(CAPTURE_TIMEOUT_MS / 2)

    // Act: a long hidden interval, then visibility returns without any painted placeholder.
    renderer.hide()
    await delay(CAPTURE_TIMEOUT_MS / 2)
    renderer.show()
    await delay(400)
    const soonAfterShowing = outcome
    const settled = await Promise.race([
      missing.then(() => outcome),
      delay(1_900).then(() => 'still waiting after a fresh budget'),
    ])

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
    renderer.viewport.close()
    await missing
  }
})

// Value: protects=native placement behind a hidden recorded image fails within its named active bound instead of hanging presentation; fails_when=the placement drain loses its response timeout while hidden paints may wait indefinitely; why_new=the only hidden drain test cancels explicitly, so nothing proves an uncancelled drain ends; seam=none
test('placement behind a hidden recorded image times out, releases its reservation and leaves the image to paint later', async () => {
  // Arrange
  const renderer = await recordedRenderer(false),
    signal = new AbortController().signal
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
    await delay(0)

    // Act: nobody cancels the move, and the hidden document cannot run animation callbacks.
    // The outer bound turns a lost drain timeout into a failed assertion instead of a hung test file.
    const drainBound = new AbortController()
    const drainOutcome = await Promise.race([
      renderer.viewport.holdPlacement(signal).then(
        () => 'placement acquired',
        (error) => String(error),
      ),
      delay(
        ACTIVE_TIMEOUT_MS + 5_000,
        'still draining after the active bound',
        { signal: drainBound.signal },
      ),
    ]).finally(() => drainBound.abort())
    const outcomeAfterTimeout = captureOutcome
    renderer.show()
    renderer.paint()
    await capture
    const release = await renderer.viewport.holdPlacement(signal)
    release()

    // Assert
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
  renderer.panel.reveal = () => {
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
  replacement.panel.reveal = () => {
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
  const outcome = await Promise.race([
    queued,
    delay(100).then(() => 'still waiting for cleanup'),
  ])
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
