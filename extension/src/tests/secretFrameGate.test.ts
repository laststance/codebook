import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  SecretFrameGate,
  type SecretFrameFailureReason,
} from '../runtimeSupport/secretFrameGate'

import {
  findTestChrome,
  launchRealHeadlessPage,
  type RealHeadlessPage,
} from './utils/realHeadlessPage'

const CHROME = findTestChrome()
const NO_CHROME = CHROME
  ? false
  : 'no Chrome is installed here; set CODEBOOK_TEST_CHROME to run the real-page gate tests'
const PAGE =
  '<form><input id="pw" type="password" name="pw"></form><p id="note">hello</p>'
/** A pause longer than the margin around an unsafe time, so a frame can fall clearly before or after it. */
const CLEAR_OF_MARGIN_MS = 150

/** Starts a real page with a password control and a gate armed on it. */
async function armedGate(context: TestContext) {
  const page = await launchRealHeadlessPage(context, CHROME!)
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

// protects=a safe password control lets its frames pass; fails_when=a verification of a safe control drops frames; no_claim=pixels, the gate does not read them
test(
  'frames of a control that stays a password control pass',
  { skip: NO_CHROME },
  async (context) => {
    // Arrange
    const { page, gate, failures } = await armedGate(context)
    await settle(page)
    // Act
    const verdict = await gate.admitFrame(Date.now() - 20)
    // Assert
    assert.equal(verdict, 'pass')
    assert.deepEqual(failures, [])
  },
)

// protects=a toggle to text and back drops the frames of the unsafe interval and every frame after it, fails the run, and still passes a frame captured before the toggle; fails_when=a frame from the interval is stored, or the quick return to password lets later frames through; no_claim=the toggle is a script here; Chrome's paint of the dots is not checked
test(
  'a quick toggle to text and back drops the unsafe interval and later frames',
  { skip: NO_CHROME },
  async (context) => {
    // Arrange
    const { page, gate, failures } = await armedGate(context)
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
  },
)

// protects=a replaced control is unsafe: frames after the replacement are dropped and the run fails; fails_when=a new password node with the same selector is accepted as the armed control; no_claim=a framework's own re-render
test(
  'replacing the control node drops later frames and fails the run',
  { skip: NO_CHROME },
  async (context) => {
    // Arrange
    const { page, gate, failures } = await armedGate(context)
    await settle(page)
    // Act
    await page.evaluate(
      "(() => { const old = document.getElementById('pw'); const next = old.cloneNode(); old.replaceWith(next) })()",
    )
    await settle(page)
    const verdict = await gate.admitFrame(Date.now() - 20)
    // Assert
    assert.equal(verdict, 'drop')
    assert.deepEqual(failures, ['control-replaced'])
  },
)

// protects=a frame delivered late whose capture time falls inside an unsafe interval is dropped although the control is safe again when it arrives; fails_when=the verdict follows the control's state at delivery instead of at capture; no_claim=real screencast delay, the timestamp is chosen by the test
test(
  'a delayed frame captured during an unsafe interval is dropped after the control is safe again',
  { skip: NO_CHROME },
  async (context) => {
    // Arrange
    const { page, gate } = await armedGate(context)
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
  },
)

// protects=a stop screenshot taken while the control draws text is withheld, and one taken while it is a password control is kept; fails_when=the screenshot path skips the gate; no_claim=the PNG is real but its pixels are not inspected
test(
  'a stop screenshot taken during the unsafe window is withheld',
  { skip: NO_CHROME },
  async (context) => {
    // Arrange
    const safe = await armedGate(context)
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
  },
)

// protects=a password value copied into visible text fails the gate; fails_when=the observer watches only the type attribute; no_claim=copies split across elements or transformed
test(
  'a password value copied into visible page text drops frames and fails the run',
  { skip: NO_CHROME },
  async (context) => {
    // Arrange
    const { page, gate, failures } = await armedGate(context)
    await page.evaluate(
      "document.getElementById('pw').value = 'hunter2-visible'",
    )
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
  },
)

// protects=arming on a control that is not a password control fails at once and no frame passes; fails_when=the gate arms on a text control and trusts it; no_claim=text controls with secret names, which the operation engine refuses before it arms
test(
  'arming on a text control fails the gate',
  { skip: NO_CHROME },
  async (context) => {
    // Arrange
    const page = await launchRealHeadlessPage(context, CHROME!)
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
  },
)
