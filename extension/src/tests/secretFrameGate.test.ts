import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

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
/** A pause longer than the margin around an unsafe time, so a frame can fall clearly before or after it. */
const CLEAR_OF_MARGIN_MS = 150

/** Starts a real page with a password control and a gate armed on it. */
async function armedGate(context: TestContext) {
  const page = await launchRealHeadlessPage(context)
  if (!page) return undefined
  await page.load(PAGE)
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw')
  return { page, gate, failures }
}

/** Lets a mutation callback run and the page clock move past `CLEAR_OF_MARGIN_MS`. */
async function settle(page: RealHeadlessPage): Promise<void> {
  await page.evaluate('1')
  await delay(CLEAR_OF_MARGIN_MS)
}

/** Types `value` into the armed control the way typed text arrives: the value, then an input event. */
async function typeIntoControl(
  page: RealHeadlessPage,
  value: string,
): Promise<void> {
  await page.evaluate(
    `(() => { const control = document.getElementById('pw'); control.value = ${JSON.stringify(value)}; control.dispatchEvent(new Event('input', { bubbles: true })) })()`,
  )
}

// protects=an unarmed gate passes every frame and every screenshot and never asks the page; fails_when=the gate checks images before a secret operation was sent, dropping frames of ordinary runs; no_claim=arming from the operation engine, which another lane wires
test('an unarmed gate passes every frame and screenshot without asking the page', async () => {
  // Arrange
  let asked = 0
  const gate = new SecretFrameGate({
    evaluate: async () => {
      asked += 1
      return null
    },
  })
  // Act
  const frame = await gate.admitFrame(Date.now())
  const capture = await gate.admitCapture(Date.now() - 10, Date.now())
  // Assert
  assert.deepEqual(
    [frame, capture, asked, gate.armed],
    ['pass', 'pass', 0, false],
  )
})

// protects=a gate whose observer stops answering fails the run once and drops every image after; fails_when=an unanswered observer lets frames through or never reports the failure; no_claim=a real page, the answers are scripted
test('an observer that stops answering drops every frame and fails once', async () => {
  // Arrange
  let answering = true
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: async () => (answering ? { ok: true } : null),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw')
  answering = false
  // Act
  const first = await gate.admitFrame(Date.now())
  const second = await gate.admitFrame(Date.now())
  // Assert
  assert.deepEqual([first, second], ['drop', 'drop'])
  assert.deepEqual(failures, ['observer-unanswered'])
  assert.equal(gate.failure, 'observer-unanswered')
})

// protects=ENG-5: frames captured after the old observer last verified the page and before the document replacement was noticed are dropped as an unrecorded gap, and frames after the release pass; fails_when=a show-password toggle followed at once by a navigating submit leaves its frames in the replay, or a frame after the release is dropped; no_claim=a real navigation (the evaluate function stands in for the page and its document time origin)
test('frames between the last verified answer and a document replacement are dropped, later frames pass', async () => {
  // Arrange
  let replaced = false
  let lastAnswer = 0
  const dropped: number[] = []
  const gate = new SecretFrameGate({
    evaluate: async (expression) => {
      if (expression === 'performance.timeOrigin') return replaced ? 2 : 1
      if (expression.includes('query()')) {
        if (replaced) return null
        lastAnswer = Date.now()
        return { now: lastAnswer, open: null, unsafe: [] }
      }
      return { ok: true, origin: 1 }
    },
    onDrop: (detail) => void dropped.push(detail.atMs),
  })
  await gate.arm('#password')
  const verified = await gate.admitFrame(Date.now())
  await delay(10)
  const capturedBeforeReplacement = lastAnswer + 5
  await delay(10)
  replaced = true
  // Act
  const inGap = await gate.admitFrame(capturedBeforeReplacement)
  await delay(10)
  const afterRelease = await gate.admitFrame(Date.now())
  // Assert
  assert.deepEqual(
    [verified, inGap, afterRelease, dropped, gate.armed],
    ['pass', 'drop', 'pass', [capturedBeforeReplacement], false],
  )
})

// protects=a safe password control lets its frames pass; fails_when=a verification of a safe control drops frames; no_claim=pixels, the gate does not read them
test('frames of a control that stays a password control pass', async (context) => {
  // Arrange
  const armed = await armedGate(context)
  if (!armed) return
  const { page, gate, failures } = armed
  await settle(page)
  // Act
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.equal(verdict, 'pass')
  assert.deepEqual(failures, [])
})

// protects=a toggle to text and back drops the frames of the unsafe interval and every frame after it, fails the run, and still passes a frame captured before the toggle; fails_when=a frame from the interval is stored, or the quick return to password lets later frames through; no_claim=the toggle is a script here; Chrome's paint of the dots is not checked
test('a quick toggle to text and back drops the unsafe interval and later frames', async (context) => {
  // Arrange
  const armed = await armedGate(context)
  if (!armed) return
  const { page, gate, failures } = armed
  await settle(page)
  const beforeToggle = Date.now() - 20
  await delay(CLEAR_OF_MARGIN_MS)
  // Act
  await page.evaluate("document.getElementById('pw').type = 'text'")
  await delay(CLEAR_OF_MARGIN_MS)
  const insideInterval = Date.now() - 20
  await page.evaluate("document.getElementById('pw').type = 'password'")
  await settle(page)
  const verdicts = [
    await gate.admitFrame(beforeToggle),
    await gate.admitFrame(insideInterval),
    await gate.admitFrame(Date.now() - 20),
  ]
  // Assert
  assert.deepEqual(verdicts, ['pass', 'drop', 'drop'])
  assert.deepEqual(failures, ['control-not-password'])
})

// protects=a control replaced by a plain control that shows the typed value is unsafe: frames after it are dropped and the run fails; fails_when=a show-password swap to a text input is accepted; no_claim=a framework's own re-render, which the next test covers
test('replacing the control with a plain control that shows the value drops later frames and fails the run', async (context) => {
  // Arrange
  const armed = await armedGate(context)
  if (!armed) return
  const { page, gate, failures } = armed
  await typeIntoControl(page, 'hunter2-shown')
  await settle(page)
  // Act
  await page.evaluate(
    "(() => { const old = document.getElementById('pw'); const plain = document.createElement('input'); plain.type = 'text'; plain.id = 'pw'; plain.value = old.value; old.replaceWith(plain) })()",
  )
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.equal(verdict, 'drop')
  assert.deepEqual(failures, ['control-replaced'])
})

// protects=a sign-in form that unmounts after its submit, and a re-render that puts a new password control in its place, show nothing and fail nothing; fails_when=the normal success path of a sign-in (the form leaves the page) fails the run with SECRET_BECAME_VISIBLE; no_claim=a real framework, the DOM changes are scripted
test('removing the control or re-rendering it as another password control keeps frames passing', async (context) => {
  // Arrange
  const armed = await armedGate(context)
  if (!armed) return
  const { page, gate, failures } = armed
  await typeIntoControl(page, 'hunter2-typed')
  await settle(page)
  // Act
  await page.evaluate(
    "(() => { const old = document.getElementById('pw'); old.replaceWith(old.cloneNode()) })()",
  )
  await settle(page)
  const afterRerender = await gate.admitFrame(Date.now() - 20)
  await page.evaluate("document.querySelector('form').remove()")
  await settle(page)
  const afterRemoval = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual(
    [afterRerender, afterRemoval, failures],
    ['pass', 'pass', []],
  )
})

// protects=a frame delivered late whose capture time falls inside an unsafe interval is dropped although the control is safe again when it arrives; fails_when=the verdict follows the control's state at delivery instead of at capture; no_claim=real screencast delay, the timestamp is chosen by the test
test('a delayed frame captured during an unsafe interval is dropped after the control is safe again', async (context) => {
  // Arrange
  const armed = await armedGate(context)
  if (!armed) return
  const { page, gate } = armed
  await settle(page)
  await page.evaluate("document.getElementById('pw').type = 'text'")
  await delay(CLEAR_OF_MARGIN_MS)
  const capturedDuringToggle = Date.now() - 20
  await delay(CLEAR_OF_MARGIN_MS)
  await page.evaluate("document.getElementById('pw').type = 'password'")
  await settle(page)
  // Act
  const verdict = await gate.admitFrame(capturedDuringToggle)
  // Assert
  assert.equal(verdict, 'drop')
})

// protects=a stop screenshot taken while the control draws text is withheld, and one taken while it is a password control is kept; fails_when=the screenshot path skips the gate; no_claim=the PNG is real but its pixels are not inspected
test('a stop screenshot taken during the unsafe window is withheld', async (context) => {
  // Arrange
  const safe = await armedGate(context)
  if (!safe) return
  await settle(safe.page)
  const safeStart = Date.now()
  await safe.page.screenshot()
  const safeVerdict = await safe.gate.admitCapture(safeStart, Date.now())
  await safe.page.evaluate("document.getElementById('pw').type = 'text'")
  await settle(safe.page)
  // Act
  const unsafeStart = Date.now()
  const png = await safe.page.screenshot()
  const unsafeVerdict = await safe.gate.admitCapture(unsafeStart, Date.now())
  // Assert
  assert.ok(png.length > 0)
  assert.deepEqual([safeVerdict, unsafeVerdict], ['pass', 'drop'])
})

// protects=a password value copied into visible text fails the gate; fails_when=the observer watches only the type attribute; no_claim=copies split across elements or transformed
test('a password value copied into visible page text drops frames and fails the run', async (context) => {
  // Arrange
  const armed = await armedGate(context)
  if (!armed) return
  const { page, gate, failures } = armed
  await typeIntoControl(page, 'hunter2-visible')
  await settle(page)
  // Act
  await page.evaluate(
    "document.getElementById('note').textContent = 'you typed hunter2-visible'",
  )
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.equal(verdict, 'drop')
  assert.deepEqual(failures, ['value-copied-to-text'])
})

// protects=a secret that the page already shows as text (a "Forgot password?" label for the password "password") lets frames pass, and a real copy still fails; fails_when=any page text containing the value fails a normal run, or the baseline hides a later copy; no_claim=copies split across elements or transformed
test('text the page already showed is no copy, and a later copy of the value still fails the run', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load(
    '<form><input id="pw" type="password"></form><a>Forgot password?</a><p id="note"></p>',
  )
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw')
  await typeIntoControl(page, 'password')
  await settle(page)
  // Act
  const beforeCopy = await gate.admitFrame(Date.now() - 20)
  await page.evaluate(
    "document.getElementById('note').textContent = 'you typed password'",
  )
  await settle(page)
  const afterCopy = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual(
    [beforeCopy, afterCopy, failures],
    ['pass', 'drop', ['value-copied-to-text']],
  )
})

// protects=a copy of the typed value made after the app cleared the password control still fails the run; fails_when=the observer forgets the value once the control is empty, so a submit handler that copies then clears passes frames; no_claim=copies transformed or split across elements
test('a value copied into text and then cleared from the password control drops frames and fails the run', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load(
    '<form><input id="pw" type="password"></form><p id="note"></p>',
  )
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw', 'hunter2-visible')
  await typeIntoControl(page, 'hunter2-visible')
  await settle(page)
  // Act
  await page.evaluate(
    "(() => { document.getElementById('note').textContent = 'you typed hunter2-visible'; document.getElementById('pw').value = '' })()",
  )
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual([verdict, failures], ['drop', ['value-copied-to-text']])
})

// protects=arming on a control that is not a password control fails at once and no frame passes; fails_when=the gate arms on a text control and trusts it; no_claim=text controls with secret names, which the operation engine refuses before it arms
test('arming on a text control fails the gate', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load('<input id="pw" type="text">')
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  // Act
  await gate.arm('#pw')
  const verdict = await gate.admitFrame(Date.now())
  // Assert
  assert.equal(verdict, 'drop')
  assert.deepEqual(failures, ['control-not-password'])
})

// protects=a copy of the typed value made by a page handler registered before the observer is still a copy; fails_when=the baseline is taken after that handler, so the copy counts as page text and frames pass; no_claim=handlers that transform the value
test('a value copied by an input handler registered before the observer drops frames and fails the run', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load(
    "<form><input id=\"pw\" type=\"password\"></form><p id=\"echo\"></p><script>document.getElementById('pw').addEventListener('input', (event) => { document.getElementById('echo').textContent = 'you typed ' + event.target.value })</script>",
  )
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw', 'hunter2-visible')
  // Act
  await typeIntoControl(page, 'hunter2-visible')
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual([verdict, failures], ['drop', ['value-copied-to-text']])
})

// protects=every armed control keeps its observer: toggling the first of two secret controls to text fails the run; fails_when=the second arm overwrites the first observer and the first control's unsafe state is never read; no_claim=more than two controls
test('with two armed secret controls, the first turning into a text control drops frames and fails the run', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load(
    '<form><input id="pw" type="password"><input id="confirm" type="password"></form>',
  )
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw', 'first-secret')
  await gate.arm('#confirm', 'second-secret')
  const beforeToggle = await gate.admitFrame(Date.now() - 20)
  // Act
  await page.evaluate("document.getElementById('pw').type = 'text'")
  await settle(page)
  const afterToggle = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual(
    [beforeToggle, afterToggle, failures],
    ['pass', 'drop', ['control-not-password']],
  )
})

// protects=a frame captured on the old document after the old observer last vouched for the page is dropped once the new document is noticed, while a frame the old observer verified passes; fails_when=a frame of an unverified gap passes after the release; no_claim=a real navigation (the evaluate function stands in for the page)
test('a frame captured after the last verification of a replaced document is dropped, an earlier verified frame passes', async () => {
  // Arrange
  let replaced = false
  const gate = new SecretFrameGate({
    evaluate: async (expression) => {
      if (expression === 'performance.timeOrigin') return replaced ? 2 : 1
      if (expression.includes('query()'))
        return replaced ? null : { now: Date.now(), open: null, unsafe: [] }
      return { ok: true, origin: 1 }
    },
  })
  await gate.arm('#password', 'typed-secret')
  const capturedAt = Date.now() - 500
  const verified = await gate.admitFrame(capturedAt)
  await delay(20)
  replaced = true
  // Act
  const unverifiedLate = await gate.admitFrame(Date.now())
  const verifiedAfterRelease = await gate.admitFrame(capturedAt)
  // Assert
  assert.deepEqual(
    [verified, unverifiedLate, verifiedAfterRelease],
    ['pass', 'drop', 'pass'],
  )
})

// protects=a show-password toggle that makes the armed element leave an `input[type="password"]` selector still drops frames and fails the run; fails_when=the type check is skipped because the selector stopped matching; no_claim=other selectors (real Chrome)
test('a toggle that takes the armed control out of its type selector still drops frames and fails the run', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load('<form><input id="pw" type="password"></form>')
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('input[type="password"]', 'typed-secret')
  // Act
  await page.evaluate("document.getElementById('pw').type = 'text'")
  await settle(page)
  const afterToggle = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual([afterToggle, failures], ['drop', ['control-not-password']])
})

// protects=a replacement text control inside an open shadow root that holds the secret is found; fails_when=only light-DOM controls are read; no_claim=closed shadow roots, cross-origin frames
test('a text control in an open shadow root holding the secret drops frames', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load('<input id="pw" type="password"><div id="host"></div>')
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
  })
  await gate.arm('#pw', 'typed-secret')
  // Act
  await page.evaluate(
    `(() => { const input = document.createElement('input'); input.type = 'text'; document.getElementById('host').attachShadow({ mode: 'open' }).append(input); input.value = 'typed-secret' })()`,
  )
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.equal(verdict, 'drop')
})

// protects=a script that shows the secret in a visible text control and clears it again, with no DOM mutation and before any verification, still makes that time unsafe; fails_when=the observer reads the page only on a mutation or a verification; no_claim=exact paint timing
test('a value set by script into a visible text control and cleared again before any verification drops frames of that time', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load(
    '<input id="pw" type="password"><input id="plain" type="text">',
  )
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
  })
  await gate.arm('#pw', 'typed-secret')
  await delay(CLEAR_OF_MARGIN_MS)
  const capturedBefore = Date.now()
  await delay(CLEAR_OF_MARGIN_MS)
  // Act
  await page.evaluate("document.getElementById('plain').value = 'typed-secret'")
  await delay(CLEAR_OF_MARGIN_MS)
  const capturedWhileShown = Date.now()
  await delay(CLEAR_OF_MARGIN_MS)
  await page.evaluate("document.getElementById('plain').value = ''")
  await settle(page)
  const earlier = await gate.admitFrame(capturedBefore)
  const during = await gate.admitFrame(capturedWhileShown)
  // Assert
  assert.deepEqual([earlier, during], ['pass', 'drop'])
})
