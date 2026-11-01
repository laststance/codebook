import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SECRET_FRAME_OBSERVER_GLOBAL } from '../constants'
import {
  SecretFrameGate,
  type SecretFrameFailureReason,
} from '../runtimeSupport/secretFrameGate'

import {
  launchRealHeadlessPage,
  type RealHeadlessPage,
} from './utils/realHeadlessPage'

const PAGE =
  '<form><input id="pw" type="password" name="pw"></form><p id="note">hello</p>'

/** A frame whose document the page cannot read: a sandboxed `srcdoc` frame has an opaque origin, so `contentDocument` is null, as for a frame from another site. */
const CROSS_ORIGIN_WIDGET =
  '<iframe id="widget" sandbox srcdoc="<p>widget</p>" style="width:200px;height:80px"></iframe>'

/** Types `value` into the armed control the way typed text arrives: the value, then an input event. */
async function typeIntoControl(
  page: RealHeadlessPage,
  value: string,
): Promise<void> {
  await page.evaluate(
    `(() => { const control = document.getElementById('pw'); control.value = ${JSON.stringify(value)}; control.dispatchEvent(new Event('input', { bubbles: true })) })()`,
  )
}

/** Loads `html`, arms a gate on `#pw` with a typed secret and types it. */
async function armedPage(
  page: RealHeadlessPage,
  html: string,
): Promise<{ gate: SecretFrameGate; failures: SecretFrameFailureReason[] }> {
  await page.load(html)
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw', 'typed-secret')
  await typeIntoControl(page, 'typed-secret')
  return { gate, failures }
}

/** Reads the first observer's record from the page, as the gate does. */
async function readObserverReport(page: RealHeadlessPage): Promise<{
  crossOriginOpen: number | null
  crossOrigin: [number, number][]
}> {
  return (await page.evaluate(
    `window['${SECRET_FRAME_OBSERVER_GLOBAL}1'].query()`,
  )) as { crossOriginOpen: number | null; crossOrigin: [number, number][] }
}

// protects=a frame whose content the gate cannot read keeps its pixels out of the recording once a secret was sent, and the run goes on; fails_when=the frame's images pass (the old gate answered 'pass') or the gate fails the run (failures non-empty or gate.failure set); no_claim=a real cross-site out-of-process iframe (the fixture is an opaque-origin sandboxed srcdoc frame in the same process), pixels
test('after a secret, a visible frame from another origin withholds images as cross-origin without failing the run', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  const { gate, failures } = await armedPage(
    page,
    `${PAGE}${CROSS_ORIGIN_WIDGET}`,
  )
  // Act
  const capturedAtMs = (await page.evaluate('Date.now()')) as number
  const verdict = await gate.admitFrame(capturedAtMs)
  // Assert
  assert.equal(verdict, 'drop-cross-origin-frame')
  assert.deepEqual(failures, [])
  assert.equal(gate.failure, undefined)
})

// protects=hidden helper frames (a captcha's hidden challenge, a payment library's metrics frame, a tag manager's noscript frame) do not withhold every image of a run; fails_when=any connected unreadable frame withholds images; no_claim=frames clipped by an ancestor's overflow or clip-path (counted as drawn by design)
test('frames from another origin that draw nothing leave images passing after a secret', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  const hiddenFrames = [
    'display:none',
    'visibility:hidden',
    'opacity:0',
    'width:0;height:0;border:0',
    'position:absolute;top:-10000px',
  ]
    .map(
      (style) => `<iframe sandbox srcdoc="<p>x</p>" style="${style}"></iframe>`,
    )
    .join('')
  const { gate, failures } = await armedPage(page, `${PAGE}${hiddenFrames}`)
  // Act
  const verdict = await gate.admitFrame(
    (await page.evaluate('Date.now()')) as number,
  )
  // Assert
  assert.equal(verdict, 'pass')
  assert.deepEqual(failures, [])
})

// protects=nothing is withheld before a secret is sent; fails_when=cross-origin detection runs for every run with a third-party widget; no_claim=none beyond protects
test('an unarmed gate keeps passing images of a page with a visible frame from another origin and never asks the page', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load(`${PAGE}${CROSS_ORIGIN_WIDGET}`)
  let asked = 0
  const gate = new SecretFrameGate({
    evaluate: (expression) => {
      asked += 1
      return page.evaluate(expression)
    },
  })
  // Act
  const frame = await gate.admitFrame(Date.now())
  const capture = await gate.admitCapture(Date.now() - 10, Date.now())
  // Assert
  assert.deepEqual([frame, capture, asked], ['pass', 'pass', 0])
})

// protects=the observer notices a frame shown or hidden after arm, and the interval ends when the frame leaves the screen; fails_when=only frames present at arm are watched, or the interval never closes (every later image withheld); no_claim=the gate's verdict math (the fake-evaluate tests)
test('a frame from another origin shown after the secret opens a withheld interval and hiding it closes the interval', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  const { failures } = await armedPage(
    page,
    `${PAGE}${CROSS_ORIGIN_WIDGET.replace('style="', 'style="display:none;')}`,
  )
  // Act
  const shownAt = (await page.evaluate(
    "(() => { document.getElementById('widget').style.display = 'block'; return Date.now() })()",
  )) as number
  const opened = await readObserverReport(page)
  await page.evaluate(
    "document.getElementById('widget').style.display = 'none'",
  )
  const closed = await readObserverReport(page)
  // Assert
  assert.ok(
    opened.crossOriginOpen !== null && opened.crossOriginOpen <= shownAt,
  )
  assert.equal(closed.crossOriginOpen, null)
  assert.equal(closed.crossOrigin.length, 1)
  assert.deepEqual(failures, [])
})

// protects=same-origin embeds (an app's own preview iframe) keep their images and stay content-checked as before; fails_when=every iframe is treated as unreadable; no_claim=copies inside same-origin frames (the existing tests cover them)
test('a visible same-origin frame is read, not withheld, after a secret', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  const { gate, failures } = await armedPage(page, PAGE)
  await page.evaluate(
    "(() => { const frame = document.createElement('iframe'); frame.style.cssText = 'width:300px;height:150px'; document.body.appendChild(frame) })()",
  )
  // Act
  const verdict = await gate.admitFrame(
    (await page.evaluate('Date.now()')) as number,
  )
  // Assert
  assert.equal(verdict, 'pass')
  assert.deepEqual(failures, [])
})

// protects=readability is checked again on every check, not cached at insertion; fails_when=a same-origin frame that moves to another origin keeps its images; no_claim=a navigation that commits between two checks while the parent's main thread is paused (stated limit; detection is backdated)
test('a frame that navigates to another origin without any change in the parent page is noticed', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  const { failures } = await armedPage(page, PAGE)
  await page.evaluate(
    "(() => { const frame = document.createElement('iframe'); frame.id = 'preview'; frame.style.cssText = 'width:300px;height:150px'; document.body.appendChild(frame) })()",
  )
  // Act
  await page.evaluate(
    "new Promise(resolve => { const frame = document.getElementById('preview'); frame.addEventListener('load', () => resolve(Date.now()), { once: true }); frame.contentWindow.location.replace('data:text/html,<p>moved</p>') })",
  )
  const report = await readObserverReport(page)
  // Assert
  assert.notEqual(report.crossOriginOpen, null)
  assert.deepEqual(failures, [])
})

// protects=the gate withholds exactly the images whose capture window touches a drawn interval and never fails the run for it; fails_when=the gate fails the run (onFailure called), ignores the interval, or withholds images outside it; no_claim=the observer's detection (the real-Chrome tests)
test('images are judged by the cross-origin interval at their capture time, and an open interval withholds every later image', async () => {
  // Arrange
  const base = Date.now() - 5_000
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: async (expression) => {
      if (expression === 'performance.timeOrigin') return 1
      if (expression.startsWith('window['))
        return {
          now: Date.now(),
          open: null,
          unsafe: [],
          crossOriginOpen: base + 4_000,
          crossOrigin: [[base + 1_000, base + 2_000]],
        }
      return { ok: true, origin: 1 }
    },
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#password', 'typed-secret')
  // Act
  const verdicts = [
    await gate.admitFrame(base + 500),
    await gate.admitFrame(base + 1_500),
    await gate.admitFrame(base + 3_000),
    await gate.admitFrame(base + 4_500),
  ]
  // Assert
  assert.deepEqual(verdicts, [
    'pass',
    'drop-cross-origin-frame',
    'pass',
    'drop-cross-origin-frame',
  ])
  assert.deepEqual(failures, [])
  assert.deepEqual(gate.withheld, { crossOriginFrame: 2, secretNotVerified: 0 })
})

// protects=a sign-in that redirects does not erase the record of a third-party frame on the old page; fails_when=retiring the observers forgets their cross-origin intervals and the late image passes; no_claim=a real navigation
test('a late image of a replaced document captured while its frame from another origin was drawn stays withheld after the replacement', async () => {
  // Arrange
  const base = Date.now() - 5_000
  let replaced = false
  const gate = new SecretFrameGate({
    evaluate: async (expression) => {
      if (expression === 'performance.timeOrigin') return replaced ? 2 : 1
      if (expression.startsWith('window[')) {
        // The old document's observer is gone after the replacement; the new one (global 2) sees no frame.
        if (
          replaced &&
          !expression.includes(`${SECRET_FRAME_OBSERVER_GLOBAL}1"`)
        )
          return {
            now: Date.now(),
            open: null,
            unsafe: [],
            crossOriginOpen: null,
            crossOrigin: [],
          }
        if (replaced) return null
        return {
          now: Date.now(),
          open: null,
          unsafe: [],
          crossOriginOpen: base + 1_000,
          crossOrigin: [],
        }
      }
      return { ok: true, origin: replaced ? 2 : 1 }
    },
  })
  await gate.arm('#password', 'typed-secret')
  await gate.admitFrame(Date.now())
  replaced = true
  await gate.admitFrame(Date.now())
  // Act
  const late = await gate.admitFrame(base + 2_000)
  // Assert
  assert.equal(late, 'drop-cross-origin-frame')
  assert.equal(gate.failure, undefined)
})
