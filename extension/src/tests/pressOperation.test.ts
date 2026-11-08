import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  OperationRefusal,
  prepareOperation,
  type OperationPort,
  type OperationSendHooks,
} from '../configuredOperations'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import type { Cdp } from '../runtimeSupport/cdp'

import {
  closeRealChrome,
  openRealChromePage,
  type RealChromePage,
} from './utils/realChromePage'

after(closeRealChrome)

/** The fixture page: a button, a text input, a password input, a frame, a focusable panel and a `delegatesFocus` host around a password input; every key event the document sees is recorded. */
const FIXTURE = `<!doctype html><html><body>
<button id="open" type="button">Open</button>
<input id="search" type="text" name="q">
<input id="pass" type="password" name="password">
<iframe id="frame" srcdoc="<input id='inner'>"></iframe>
<div id="panel" tabindex="0">Panel</div>
<div id="host"></div>
<script>
window.events = [];
window.pauseOnKeydown = false;
for (const type of ['keydown', 'keypress', 'keyup']) {
  document.addEventListener(type, (event) => {
    window.events.push({ type, key: event.key, code: event.code, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey, trusted: event.isTrusted, target: event.target.id || event.target.tagName.toLowerCase() });
  }, true);
}
document.addEventListener('keydown', () => { if (window.pauseOnKeydown) { debugger; } });
const host = document.getElementById('host').attachShadow({ mode: 'open', delegatesFocus: true });
host.innerHTML = '<input type="password" id="inner-secret">';
</script></body></html>`

type SeenEvent = {
  type: string
  key: string
  code: string
  ctrl: boolean
  shift: boolean
  meta: boolean
  trusted: boolean
  target: string
}

/** Builds the port a run gives the engine over a real page; the page is paused when `isPaused` says so. */
function portOf(
  page: RealChromePage,
  cdp: Cdp = page.cdp,
  isPaused: () => boolean = () => false,
): OperationPort {
  return {
    pageCdp: async () => cdp,
    origins: () => [page.origin],
    assertCurrent: (): void => {},
    millisecondsSinceNavigation: () => Number.POSITIVE_INFINITY,
    isPagePaused: isPaused,
    sleep: (delayMs): Promise<void> => delay(delayMs),
    readClickPoint: async () => ({ x: 0, y: 0 }),
  }
}

const HOOKS: OperationSendHooks = {
  beforeInput: () => {},
  acknowledged: () => {},
  valueChecked: () => {},
}

/** Reads a value out of the page. */
async function read(page: RealChromePage, expression: string) {
  return (
    await page.cdp.request('Runtime.evaluate', {
      expression,
      returnByValue: true,
    })
  ).result.value
}

/** Moves the page's focus to an element, the way an earlier click operation would. */
async function focusOn(page: RealChromePage, selector: string): Promise<void> {
  await read(
    page,
    `document.querySelector(${JSON.stringify(selector)}).focus()`,
  )
}

/** The key events the document saw so far. */
async function seenEvents(page: RealChromePage): Promise<SeenEvent[]> {
  return (await read(page, 'window.events')) as SeenEvent[]
}

/** Prepares and sends one press through the engine over the real page. */
async function press(
  page: RealChromePage,
  operation: Extract<RepositoryOperation, { kind: 'press' }>,
): Promise<void> {
  const prepared = await prepareOperation(portOf(page), {
    index: 1,
    total: 1,
    operation,
  })
  await prepared.send(HOOKS)
}

/** Catches the refusal a press raises. */
async function refusalOf(
  page: RealChromePage,
  operation: Extract<RepositoryOperation, { kind: 'press' }>,
): Promise<OperationRefusal> {
  try {
    await press(page, operation)
  } catch (error) {
    assert.ok(error instanceof OperationRefusal)
    return error
  }
  throw new Error('The press was not refused.')
}

const open = (key: string, selector?: string) =>
  ({ kind: 'press', title: 'Open', key, selector }) as const

// Value: protects=a printable key reaches a page without focus as trusted keydown, keypress and keyup; fails_when=a field of the CDP event is wrong, a key event is missing or untrusted; no_claim=a real app's handler
test('a printable key on the page body arrives as trusted keydown, keypress and keyup', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  await press(page, open('x'))
  // Assert
  assert.deepEqual(await seenEvents(page), [
    {
      type: 'keydown',
      key: 'x',
      code: 'KeyX',
      ctrl: false,
      shift: false,
      meta: false,
      trusted: true,
      target: 'body',
    },
    {
      type: 'keypress',
      key: 'x',
      code: 'KeyX',
      ctrl: false,
      shift: false,
      meta: false,
      trusted: true,
      target: 'body',
    },
    {
      type: 'keyup',
      key: 'x',
      code: 'KeyX',
      ctrl: false,
      shift: false,
      meta: false,
      trusted: true,
      target: 'body',
    },
  ])
})

// Value: protects=a named key reaches the focused button with no character event; fails_when=Escape produces keypress or the code differs; no_claim=other named keys (pressKey.test.ts holds the table)
test('Escape on a focused button arrives as keydown and keyup without keypress', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  await focusOn(page, '#open')
  // Act
  await press(page, open('Escape'))
  // Assert
  assert.deepEqual(
    (await seenEvents(page)).map(
      (seen) => `${seen.type}:${seen.key}:${seen.target}`,
    ),
    ['keydown:Escape:open', 'keyup:Escape:open'],
  )
})

// Value: protects=Enter carries its carriage return so the page sees keypress too; fails_when=Enter arrives without keypress; no_claim=the button's default action
test('Enter on a focused button arrives as keydown, keypress and keyup', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  await focusOn(page, '#open')
  // Act
  await press(page, open('Enter'))
  // Assert
  assert.deepEqual(
    (await seenEvents(page)).map((seen) => seen.type),
    ['keydown', 'keypress', 'keyup'],
  )
})

// Value: protects=a chord carries its modifier flags and types nothing; fails_when=Control is missing from the event or a keypress arrives; no_claim=Meta and Alt (the bitmask is pinned in pressKey.test.ts)
test('Control+k arrives with the control flag and no keypress', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  await focusOn(page, '#open')
  // Act
  await press(page, open('Control+k'))
  // Assert
  assert.deepEqual(
    (await seenEvents(page)).map(
      (seen) => `${seen.type}:${seen.key}:${seen.ctrl}`,
    ),
    ['keydown:k:true', 'keyup:k:true'],
  )
})

// Value: protects=Shift with a letter arrives as the shifted key; fails_when=the page sees a lowercase key or no shift flag; no_claim=symbols
test('Shift+a arrives as the capital letter with the shift flag', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  await press(page, open('Shift+a'))
  // Assert
  assert.deepEqual(
    (await seenEvents(page)).map(
      (seen) => `${seen.type}:${seen.key}:${seen.shift}`,
    ),
    ['keydown:A:true', 'keypress:A:true', 'keyup:A:true'],
  )
})

// Value: protects=a declared selector is focused first so the key reaches it; fails_when=the key goes to the body; no_claim=focus handlers of the app
test('a declared selector receives the focus and the key', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  await press(page, open('Escape', '#panel'))
  // Assert
  assert.deepEqual(
    (await seenEvents(page)).map((seen) => seen.target),
    ['panel', 'panel'],
  )
})

// Value: protects=a key is refused, nothing sent, while a text input holds the focus; fails_when=the key is typed into the input or the refusal has no reason; no_claim=the message wording (pressOperationSend.test.ts)
test('a press with focus in a text input is refused with its reason and sends nothing', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  await focusOn(page, '#search')
  // Act
  const refusal = await refusalOf(page, open('x'))
  // Assert
  assert.equal(refusal.code, 'INPUT_NOT_ACCEPTED')
  assert.equal(refusal.reason, 'press-focus-in-text-entry')
  assert.equal(refusal.path, 'operations[0]')
  assert.equal(refusal.sent, 'not-sent')
  assert.deepEqual(await seenEvents(page), [])
  assert.equal(await read(page, "document.getElementById('search').value"), '')
})

// Value: protects=a declared selector on a text input is the intent, so the key is sent to it; fails_when=the declared text input is refused; no_claim=text entry through a text operation
test('a press that declares a text input as its selector is sent to it', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  await press(page, open('q', '#search'))
  // Assert
  assert.equal(await read(page, "document.getElementById('search').value"), 'q')
})

// Value: protects=a key never goes to a password control, focused or declared; fails_when=a secret control receives a key; no_claim=other secret names (classifySecretControl tests)
test('a press with focus in a password input, or naming it, is refused as a secret control', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  await focusOn(page, '#pass')
  // Act
  const focused = await refusalOf(page, open('x'))
  const declared = await refusalOf(page, open('x', '#pass'))
  // Assert
  assert.equal(focused.reason, 'press-secret-control')
  assert.equal(declared.reason, 'press-secret-control')
  assert.equal(declared.path, 'operations[0].selector')
  assert.deepEqual(await seenEvents(page), [])
})

// Value: protects=a delegatesFocus host is judged by the password input inside it; fails_when=the host is classified as an ordinary element and the key reaches the password input; no_claim=closed shadow roots, which hide their focus (a recorded limit)
test('a delegatesFocus host around a password input is refused as a secret control', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  const refusal = await refusalOf(page, {
    kind: 'press',
    title: 'Open',
    key: 'x',
    selector: '#host',
  })
  // Assert
  assert.equal(refusal.reason, 'press-secret-control')
  assert.deepEqual(await seenEvents(page), [])
})

// Value: protects=a frame's inner focus, which Codebook cannot classify, is never keyed; fails_when=a key is sent into an iframe; no_claim=same-origin frame content
test('a press naming a frame is refused as focus in a frame', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  const refusal = await refusalOf(page, open('x', '#frame'))
  // Assert
  assert.equal(refusal.reason, 'press-focus-in-frame')
  assert.deepEqual(await seenEvents(page), [])
})

// Value: protects=a missing selector is refused like a click target, with no press reason; fails_when=a missing target is sent a key or carries a press reason; no_claim=hidden and disabled targets
test('a press naming a missing element is refused at its selector without a press reason', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  const refusal = await refusalOf(page, open('x', '#nothing'))
  // Assert
  assert.equal(refusal.code, 'INPUT_NOT_ACCEPTED')
  assert.equal(refusal.reason, undefined)
  assert.equal(refusal.path, 'operations[0].selector')
})

// Value: protects=a stop inside the key handler holds keyDown pending, keyUp follows only after the resume and the page sees keyup last; fails_when=keyUp is sent while the page is paused or the key is lost; no_claim=js-debug's own stop handling (run tests)
test('a real pause inside the keydown handler holds the release until the page is resumed', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  const requested: string[] = []
  const recording = {
    request: (
      method: string,
      params: { type?: string },
      timeoutMs?: number,
    ) => {
      if (method === 'Input.dispatchKeyEvent')
        requested.push(String(params.type))
      return (page.cdp.request as (...a: unknown[]) => unknown)(
        method,
        params,
        timeoutMs,
      )
    },
  } as unknown as Cdp
  let isPaused = false
  const paused = new Promise<void>((resolve) => {
    page.cdp.on('Debugger.paused', () => {
      isPaused = true
      resolve()
    })
  })
  page.cdp.on('Debugger.resumed', () => {
    isPaused = false
  })
  await page.cdp.request('Debugger.enable', {})
  await read(page, 'window.pauseOnKeydown = true')
  const prepared = await prepareOperation(
    portOf(page, recording, () => isPaused),
    { index: 1, total: 1, operation: open('x') },
  )
  // Act
  const sending = prepared.send(HOOKS)
  await paused
  const requestedWhilePaused = [...requested]
  await page.cdp.request('Debugger.resume', {})
  await sending
  // Assert
  assert.deepEqual(requestedWhilePaused, ['keyDown'])
  assert.deepEqual(requested, ['keyDown', 'keyUp'])
  assert.deepEqual(
    (await seenEvents(page)).map((seen) => seen.type),
    ['keydown', 'keypress', 'keyup'],
  )
})
