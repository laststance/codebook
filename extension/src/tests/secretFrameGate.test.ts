import assert from 'node:assert/strict'
import { mock, test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { SECRET_FRAME_OBSERVER_GLOBAL } from '../constants'
import { Cdp } from '../runtimeSupport/cdp'
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

// protects=a secret too short to tell from page text drops every later image as an unrecorded gap and leaves the run alive, while a longer one keeps today's passing frames; fails_when=frames after a 1-3 character secret pass although its copies are never checked, or the run fails; no_claim=a real page (the evaluate function answers as a healthy page)
test('a 3-character secret drops frames from its send onward without failing the run, a 6-character one keeps passing', async () => {
  // Arrange
  const healthyPage = async (expression: string) => {
    if (expression === 'performance.timeOrigin') return 1
    if (expression.includes('query()'))
      return { now: Date.now(), open: null, unsafe: [] }
    return { ok: true, origin: 1 }
  }
  const failures: SecretFrameFailureReason[] = []
  const shortGate = new SecretFrameGate({
    evaluate: healthyPage,
    onFailure: (reason) => void failures.push(reason),
  })
  const longGate = new SecretFrameGate({ evaluate: healthyPage })
  const beforeSend = Date.now() - 1_000
  // Act
  const beforeShort = await shortGate.admitFrame(beforeSend)
  await shortGate.arm('#pw', 'ab1')
  await delay(10)
  const afterShort = await shortGate.admitFrame(Date.now())
  const laterShort = await shortGate.admitFrame(Date.now())
  await longGate.arm('#pw', 'ab1cd2')
  await delay(10)
  const afterLong = await longGate.admitFrame(Date.now())
  // Assert
  assert.deepEqual(
    [beforeShort, afterShort, laterShort, afterLong, failures],
    ['pass', 'drop', 'drop', 'pass', []],
  )
  assert.equal(shortGate.failure, undefined)
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
      // The observers of the first document are gone; the one installed after the replacement answers.
      if (expression.includes('query()'))
        return replaced && !expression.includes('Gate2')
          ? null
          : { now: Date.now(), open: null, unsafe: [] }
      return { ok: true, origin: replaced ? 2 : 1 }
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

// protects=a secret copied into the text of a same-origin iframe fails the gate; fails_when=the rendered-text check reads only the top document (an iframe document fails the parent realm's instanceof Document); no_claim=cross-origin iframes (their text cannot be read, a stated limit); real headless Chrome
test('a secret copied into the text of a same-origin iframe drops frames and fails the run', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load('<input id="pw" type="password"><div id="host"></div>')
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw', 'typed-secret')
  // Act
  await page.evaluate(
    `(() => { const frame = document.createElement('iframe'); document.getElementById('host').append(frame); frame.contentDocument.body.textContent = 'you typed typed-secret' })()`,
  )
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual([verdict, failures], ['drop', ['value-copied-to-text']])
})

// protects=a secret copied into the text of an open shadow root fails the gate; fails_when=shadow roots count as zero occurrences; no_claim=closed shadow roots; real headless Chrome
test('a secret copied into the text of an open shadow root drops frames and fails the run', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load('<input id="pw" type="password"><div id="host"></div>')
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw', 'typed-secret')
  // Act
  await page.evaluate(
    `(() => { const note = document.createElement('p'); note.textContent = 'you typed typed-secret'; document.getElementById('host').attachShadow({ mode: 'open' }).append(note) })()`,
  )
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual([verdict, failures], ['drop', ['value-copied-to-text']])
})

// protects=a plain text control inside a same-origin iframe that holds the secret fails the gate; fails_when=the control test uses the parent realm's HTMLInputElement, which an iframe's input is not; no_claim=cross-origin iframes; real headless Chrome
test('a plain control inside a same-origin iframe holding the secret drops frames and fails the run', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load('<input id="pw" type="password"><div id="host"></div>')
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw', 'typed-secret')
  // Act
  await page.evaluate(
    `(() => { const frame = document.createElement('iframe'); document.getElementById('host').append(frame); const input = frame.contentDocument.createElement('input'); input.type = 'text'; frame.contentDocument.body.append(input); input.value = 'typed-secret' })()`,
  )
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual([verdict, failures], ['drop', ['control-replaced']])
})

// protects=a full navigation to a page that renders the typed value fails the run and holds its images; fails_when=the gate stops checking after the document is replaced and a server-rendered echo passes; no_claim=a cross-origin page and a navigation the browser blocks: the second document is loaded through the protocol, not a form post
test('a new document that renders the typed value drops frames and fails the run', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load(PAGE)
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw', 'typed-secret')
  await typeIntoControl(page, 'typed-secret')
  await gate.admitFrame(Date.now() - 20)
  // Act
  await page.load('<p id="welcome">Welcome, typed-secret</p>')
  await delay(CLEAR_OF_MARGIN_MS)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual([verdict, failures], ['drop', ['value-copied-to-text']])
})

// protects=a new document that does not show the typed value keeps passing frames after a verification, and a later copy of the value in it fails the run; fails_when=the gate releases for good after the navigation, or counts the new page's first copy as page text; no_claim=pixels; real headless Chrome with a protocol navigation
test('after a navigation the typed value is still watched: frames pass while it is absent and a later copy fails the run', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load(PAGE)
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw', 'typed-secret')
  await page.load('<p id="welcome">Welcome</p>')
  await delay(CLEAR_OF_MARGIN_MS)
  // Act
  // The first image after the navigation finds the replacement and is held (the time before it was never verified); the next one is verified.
  await gate.admitFrame(Date.now())
  // Not in the millisecond the gap ended in, which the gate treats as inside it.
  await delay(5)
  const before = await gate.admitFrame(Date.now())
  await page.evaluate(
    `document.getElementById('welcome').textContent = 'Welcome, typed-secret'`,
  )
  await settle(page)
  const after = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual(
    [before, after, failures],
    ['pass', 'drop', ['value-copied-to-text']],
  )
})

// protects=a new document that shows the typed value in a plain control fails the run; fails_when=only rendered text is re-checked after a navigation; no_claim=real form posts
test('a new document that shows the typed value in a plain control drops frames and fails the run', async (context) => {
  // Arrange
  const page = await launchRealHeadlessPage(context)
  if (!page) return
  await page.load(PAGE)
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw', 'typed-secret')
  // Act
  await page.load('<input id="echo" value="typed-secret">')
  await delay(CLEAR_OF_MARGIN_MS)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual([verdict, failures], ['drop', ['control-replaced']])
})

/** A socket that answers every `Runtime.evaluate` as a healthy page of the fake clock would, so the real {@link Cdp} sits between the gate and the page. */
class AnsweringSocket extends EventTarget {
  evaluations = 0
  /** Since when the fake page's control draws its text, or `null` while it is a password control. */
  openSince: number | null = null
  send(value: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    const message = JSON.parse(String(value)) as {
      id: number
      params: { expression: string }
    }
    this.evaluations += 1
    const { expression } = message.params
    let answer: unknown = { ok: true, origin: 1 }
    if (expression.includes('query()'))
      answer = { now: Date.now(), open: this.openSince, unsafe: [] }
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            id: message.id,
            result: { result: { value: answer } },
          }),
        }),
      ),
    )
  }
  close(): void {}
}

/** Lets promise chains and the fake socket's microtasks settle without moving the fake clock. */
const settleMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve))

/** An armed gate over a real {@link Cdp} (quiet requests, as the run sends them) and a fake page, with every journaled event counted. */
async function gateOverCdp() {
  const socket = new AnsweringSocket()
  const journal: string[] = []
  const cdp = new Cdp(socket, (type) => void journal.push(type))
  const summaries: { verifications: number; passes: number; drops: number }[] =
    []
  const gate = new SecretFrameGate({
    evaluate: async (expression, timeoutMs) => {
      const answer = await cdp.requestQuietly(
        'Runtime.evaluate',
        { expression, returnByValue: true },
        timeoutMs,
      )
      return answer.result.value
    },
    onSummary: (summary) => {
      summaries.push(summary)
      journal.push('secret-frame.summary')
    },
  })
  await gate.arm('#pw', 'typed-secret')
  return { socket, cdp, gate, journal, summaries }
}

// protects=a run with the gate armed through five minutes of 30 frames per second and a learning pause stays far below the evidence journal's 10,000 events, sends no verification while no image is captured, and passes every safe frame; fails_when=the gate sends and journals one verification per frame (the native trial's journal filled in about a minute and failed the run); no_claim=a real page and a real clock (the fake clock and a fake socket stand in), the journal's own limit (events are counted here)
test('an armed gate over five minutes of frames and a pause journals few events and sends no verification while paused', async () => {
  // Arrange
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
  const { socket, cdp, gate, journal, summaries } = await gateOverCdp()
  const verdicts: Promise<'pass' | 'drop'>[] = []
  let evaluationsWhenPauseBegan = 0
  let evaluationsWhenPauseEnded = 0
  // Act
  for (let frame = 0; frame < 9_000; frame += 1) {
    // The learning pause: no frame arrives for 60 s.
    if (frame === 3_000) {
      // The verification owed to the last frames is sent before the pause is measured.
      mock.timers.tick(200)
      await settleMicrotasks()
      evaluationsWhenPauseBegan = socket.evaluations
      mock.timers.tick(60_000)
      await settleMicrotasks()
      evaluationsWhenPauseEnded = socket.evaluations
    }
    verdicts.push(gate.admitFrame(Date.now()))
    mock.timers.tick(33)
    await settleMicrotasks()
  }
  mock.timers.tick(200)
  await settleMicrotasks()
  gate.flushSummary()
  const results = await Promise.all(verdicts)
  mock.timers.reset()
  cdp.close()
  // Assert
  assert.equal(results.filter((verdict) => verdict === 'pass').length, 9_000)
  assert.equal(gate.failure, undefined)
  assert.equal(evaluationsWhenPauseEnded - evaluationsWhenPauseBegan, 0)
  assert.equal(journal.filter((type) => type.startsWith('cdp.')).length, 0)
  assert.ok(journal.length < 500, `journal held ${journal.length} events`)
  assert.ok(
    socket.evaluations < 3_200,
    `${socket.evaluations} page requests for 9,000 frames`,
  )
  assert.equal(
    summaries.reduce((total, summary) => total + summary.passes, 0),
    9_000,
  )
})

// protects=verifications are spaced at least the minimum interval apart however fast frames arrive, and none is sent once frames stop; fails_when=a verification is sent per frame, or the gate keeps asking the page while nothing was captured; no_claim=real timing (fake clock and socket)
test('verification requests stay within the minimum interval under a burst of frames and stop when frames stop', async () => {
  // Arrange
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 2_000_000 })
  const { socket, cdp, gate } = await gateOverCdp()
  const installs = socket.evaluations
  // Act
  for (let tick = 0; tick < 200; tick += 1) {
    void gate.admitFrame(Date.now())
    mock.timers.tick(5)
    await settleMicrotasks()
  }
  mock.timers.tick(200)
  await settleMicrotasks()
  const afterBurst = socket.evaluations - installs
  mock.timers.tick(30_000)
  await settleMicrotasks()
  const afterQuiet = socket.evaluations - installs
  mock.timers.reset()
  cdp.close()
  // Assert
  assert.equal(afterBurst <= 12, true, `${afterBurst} requests in one second`)
  assert.equal(afterQuiet, afterBurst)
})

// protects=frames captured while the control draws its text are still dropped when verifications are shared and spaced, and earlier frames pass; fails_when=sharing a verification lets an unsafe frame through or drops a safe one; no_claim=a real page (a fake page reports the unsafe time)
test('frames from the time the control draws its text are dropped and earlier frames pass under shared verifications', async () => {
  // Arrange
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 3_000_000 })
  const { socket, cdp, gate } = await gateOverCdp()
  const startedAt = Date.now()
  const outcomes: { atMs: number; verdict: 'pass' | 'drop' }[] = []
  // Act
  for (let frame = 0; frame < 100; frame += 1) {
    const atMs = Date.now() - startedAt
    if (atMs >= 2_000 && socket.openSince === null)
      socket.openSince = Date.now()
    void gate
      .admitFrame(Date.now())
      .then((verdict) => outcomes.push({ atMs, verdict }))
    mock.timers.tick(33)
    await settleMicrotasks()
  }
  mock.timers.tick(500)
  await settleMicrotasks()
  mock.timers.reset()
  cdp.close()
  // Assert
  assert.equal(
    outcomes.filter((o) => o.atMs < 1_900 && o.verdict === 'drop').length,
    0,
  )
  assert.equal(
    outcomes.filter((o) => o.atMs >= 2_000 && o.verdict === 'pass').length,
    0,
  )
  assert.equal(outcomes.length, 100)
  assert.equal(gate.failure, 'control-not-password')
})

/** Starts a real page and a gate armed on its password control with a known secret. */
async function armedWithSecret(context: TestContext, secret: string) {
  const page = await launchRealHeadlessPage(context)
  if (!page) return undefined
  await page.load(
    '<input id="pw" type="password"><canvas id="board"></canvas><div id="host"></div><p id="note">hello</p>',
  )
  const failures: SecretFrameFailureReason[] = []
  const gate = new SecretFrameGate({
    evaluate: (expression) => page.evaluate(expression),
    onFailure: (reason) => void failures.push(reason),
  })
  await gate.arm('#pw', secret)
  return { page, gate, failures }
}

// protects=a secret drawn on a canvas with fillText fails the gate; fails_when=the observer reads only controls and innerText, so canvas pixels count as safe; no_claim=WebGL and drawImage of pre-rendered images; real headless Chrome
test('a typed value drawn on a canvas with fillText drops frames and fails the run', async (context) => {
  // Arrange
  const armed = await armedWithSecret(context, 'canvas-secret')
  if (!armed) return
  const { page, gate, failures } = armed
  await typeIntoControl(page, 'canvas-secret')
  // Act
  await page.evaluate(
    "document.getElementById('board').getContext('2d').fillText('you typed canvas-secret', 10, 10)",
  )
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual([verdict, failures], ['drop', ['value-copied-to-text']])
})

// protects=a secret drawn on a canvas inside a same-origin iframe fails the gate; fails_when=only the top window's canvas prototype is wrapped; no_claim=a draw made before the observer first reaches the frame
test('a typed value drawn on a canvas in a same-origin iframe drops frames and fails the run', async (context) => {
  // Arrange
  const armed = await armedWithSecret(context, 'frame-canvas-secret')
  if (!armed) return
  const { page, gate, failures } = armed
  await typeIntoControl(page, 'frame-canvas-secret')
  await page.evaluate(
    "document.getElementById('host').append(document.createElement('iframe'))",
  )
  await settle(page)
  // Act
  await page.evaluate(
    "(() => { const doc = document.querySelector('iframe').contentDocument; const canvas = doc.createElement('canvas'); doc.body.append(canvas); canvas.getContext('2d').strokeText('frame-canvas-secret', 5, 5) })()",
  )
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual([verdict, failures], ['drop', ['value-copied-to-text']])
})

// protects=a value copied into an attribute that CSS attr() draws fails the gate; fails_when=attribute values are not inspected; no_claim=CSS content with a literal string in a stylesheet the page builds
test('a typed value copied into an attribute drawn by CSS generated content drops frames and fails the run', async (context) => {
  // Arrange
  const armed = await armedWithSecret(context, 'attr-secret')
  if (!armed) return
  const { page, gate, failures } = armed
  await typeIntoControl(page, 'attr-secret')
  await settle(page)
  // Act
  await page.evaluate(
    "(() => { const style = document.createElement('style'); style.textContent = '#note::before{content:attr(data-x)}'; document.head.append(style); document.getElementById('note').setAttribute('data-x', 'attr-secret') })()",
  )
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual([verdict, failures], ['drop', ['value-copied-to-text']])
})

// protects=a controlled password input whose value attribute holds the value (React syncs it) keeps frames passing; fails_when=the armed control's own value attribute counts as a copy; no_claim=a page that reveals the value another way
test('a controlled password input whose value attribute holds the value keeps frames passing', async (context) => {
  // Arrange
  const armed = await armedWithSecret(context, 'sync-secret')
  if (!armed) return
  const { page, gate, failures } = armed
  await typeIntoControl(page, 'sync-secret')
  // Act
  await page.evaluate(
    "(() => { document.getElementById('pw').setAttribute('value', 'sync-secret'); const second = document.createElement('input'); second.type = 'password'; second.setAttribute('value', 'sync-secret'); document.getElementById('host').append(second) })()",
  )
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual([verdict, failures], ['pass', []])
})

// protects=arming a second control wraps each canvas drawing method once and every armed observer still sees canvas text; fails_when=each arm wraps fillText again (wrappers pile up) or the first observer stops seeing canvas text; no_claim=WebGL and drawImage; real headless Chrome
test('arming two controls wraps fillText once and the first control still catches its value on a canvas', async (context) => {
  // Arrange
  const armed = await armedWithSecret(context, 'first-canvas-secret')
  if (!armed) return
  const { page, gate, failures } = armed
  await page.evaluate(
    "(() => { const second = document.createElement('input'); second.id = 'pw2'; second.type = 'password'; document.getElementById('host').append(second) })()",
  )
  // Act
  await gate.arm('#pw2', 'second-canvas-secret')
  const listenerCount = await page.evaluate(
    "CanvasRenderingContext2D.prototype.fillText[Symbol.for('codebook.secretFrameCanvasListeners')]?.size ?? 0",
  )
  await typeIntoControl(page, 'first-canvas-secret')
  await page.evaluate(
    "document.getElementById('board').getContext('2d').fillText('you typed first-canvas-secret', 10, 10)",
  )
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual(
    [listenerCount, verdict, failures],
    [2, 'drop', ['value-copied-to-text']],
  )
})

// protects=one DOM mutation runs one full check, as one explicit query does; fails_when=the page document is observed twice and every mutation reads the page's rendered text twice; no_claim=mutations inside shadow roots and frames; real headless Chrome
test('one DOM mutation runs one full check of the page', async (context) => {
  // Arrange
  const armed = await armedWithSecret(context, 'mutation-secret')
  if (!armed) return
  const { page } = armed
  const globalName = `${SECRET_FRAME_OBSERVER_GLOBAL}1`
  await page.evaluate(
    "(() => { window.__fullChecks = 0; const original = Document.prototype.querySelectorAll; Document.prototype.querySelectorAll = function (selector) { if (selector === '*') window.__fullChecks += 1; return original.call(this, selector) } })()",
  )
  // Act
  await page.evaluate(`window[${JSON.stringify(globalName)}].query()`)
  const readsPerCheck = await page.evaluate('window.__fullChecks')
  await page.evaluate(
    "(() => { window.__fullChecks = 0; document.getElementById('note').textContent = 'changed' })()",
  )
  await settle(page)
  const readsPerMutation = await page.evaluate('window.__fullChecks')
  // Assert
  assert.equal(typeof readsPerCheck, 'number')
  assert.equal(readsPerMutation, readsPerCheck)
})

// protects=a hidden input holding the value keeps frames passing; fails_when=a hidden input's attributes count as a copy; no_claim=hidden inputs the page reveals another way
test('a hidden input holding the value keeps frames passing', async (context) => {
  // Arrange
  const armed = await armedWithSecret(context, 'hidden-secret')
  if (!armed) return
  const { page, gate, failures } = armed
  await typeIntoControl(page, 'hidden-secret')
  // Act
  await page.evaluate(
    "(() => { const hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.setAttribute('value', 'hidden-secret'); hidden.value = 'hidden-secret'; document.getElementById('host').append(hidden) })()",
  )
  await settle(page)
  const verdict = await gate.admitFrame(Date.now() - 20)
  // Assert
  assert.deepEqual([verdict, failures], ['pass', []])
})
