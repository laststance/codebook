import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  OperationRefusal,
  prepareOperation,
  waitForSettledPage,
  type OperationPort,
  type OperationSendHooks,
} from '../configuredOperations'
import { REPOSITORY_RUN_TIMEOUT_MS } from '../constants'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import type { Cdp } from '../runtimeSupport/cdp'
import { classifySecretControl } from '../utils/classifySecretControl'

import {
  closeRealChrome,
  openRealChromePage,
  type RealChromePage,
} from './utils/realChromePage'

after(closeRealChrome)

/**
 * The fixture page: every control kind the engine meets. `#amount` and `#customer` are tracked the way React tracks a controlled control: a plain `element.value = x` updates the tracker and fires no change, while the native prototype setter does not, so only the native setter makes `window.reactChanges` list the control.
 */
const FIXTURE = `<!doctype html><html><body>
<form id="f" onsubmit="return false">
<select id="customer"><option value="">Choose</option><option value="c1">Alice</option><option value="c2" disabled>Bob</option></select>
<input id="amount" type="number" min="1" max="1000" step="1">
<input id="locked" type="number" readonly>
<fieldset id="group-fieldset"><input id="fielded" type="number"></fieldset>
<select id="grouped"><optgroup label="Closed" disabled><option value="g1">Closed one</option></optgroup><optgroup id="open" label="Open"><option value="g2">Open one</option></optgroup></select>
<input id="email" type="email" name="email">
<input id="memo" type="text" name="memo">
<input id="password" type="password" name="password">
<input id="token-field" type="text" name="accessToken">
<input id="pin" type="text" autocomplete="one-time-code">
<select id="api-select" name="apiKey"><option value="k1">k1</option></select>
<select id="multi" multiple><option value="a">a</option></select>
<input id="when" type="date">
<input id="agree" type="checkbox">
<input id="shifty" type="text" name="shifty">
<button id="go" type="button">Go</button>
</form>
<script>
window.reactChanges = [];
window.clicks = 0;
document.getElementById('go').addEventListener('click', () => { window.clicks++; });
for (const id of ['amount', 'customer']) {
  const element = document.getElementById(id);
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  let tracked = descriptor.get.call(element);
  // React's tracker: an own property that records what a plain assignment sets.
  Object.defineProperty(element, 'value', {
    configurable: true,
    get() { return descriptor.get.call(element); },
    set(next) { tracked = String(next); descriptor.set.call(element, next); },
  });
  const onEvent = () => {
    if (descriptor.get.call(element) !== tracked) {
      tracked = descriptor.get.call(element);
      window.reactChanges.push(id);
    }
  };
  element.addEventListener('input', onEvent);
  element.addEventListener('change', onEvent);
}
</script></body></html>`

/** The moments of one operation's input, in the order the engine reported them. */
function recordingHooks(): { moments: string[]; hooks: OperationSendHooks } {
  const moments: string[] = []
  return {
    moments,
    hooks: {
      beforeInput: () => moments.push('before-input'),
      acknowledged: () => moments.push('acknowledged'),
      valueChecked: (passed) => moments.push(`value-checked:${passed}`),
    },
  }
}

/** Builds the port a run gives the engine, over a real page: its click point is the centre of the unique target. */
function portOf(page: RealChromePage): OperationPort {
  return {
    pageCdp: async () => page.cdp,
    origins: () => [page.origin],
    assertCurrent: (): void => {},
    millisecondsSinceNavigation: () => Number.POSITIVE_INFINITY,
    sleep: (delayMs): Promise<void> => delay(delayMs),
    readClickPoint: async (selector) => {
      const read = await page.cdp.request('Runtime.evaluate', {
        expression: `(() => { const found = document.querySelectorAll(${JSON.stringify(selector)}); if (found.length !== 1) throw new Error('not unique'); const box = found[0].getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 } })()`,
        returnByValue: true,
      })
      return read.result.value as { x: number; y: number }
    },
  }
}

/** Sends one operation through the engine and answers what the page then holds. */
async function send(
  page: RealChromePage,
  operation: RepositoryOperation,
  learnerSecret?: string,
) {
  const recorded = recordingHooks()
  const prepared = await prepareOperation(portOf(page), {
    index: 1,
    total: 1,
    operation,
    learnerSecret,
  })
  await prepared.send(recorded.hooks)
  return recorded.moments
}

/** Reads a value out of the page. */
async function read(
  page: RealChromePage,
  expression: string,
): Promise<unknown> {
  return (
    await page.cdp.request('Runtime.evaluate', {
      expression,
      returnByValue: true,
    })
  ).result.value
}

/** Catches the refusal an operation raises, with the page left as it was. */
async function refusalOf(
  page: RealChromePage,
  operation: RepositoryOperation,
  learnerSecret?: string,
): Promise<OperationRefusal> {
  try {
    await send(page, operation, learnerSecret)
  } catch (error) {
    assert.ok(error instanceof OperationRefusal)
    return error
  }
  throw new Error('The operation was not refused.')
}

// Value: protects=the secret classification of a control by its type, name, id and autocomplete tokens; fails_when=a password, a secret-named control or a one-time-code control is read as ordinary; no_claim=the page's attributes are read right (real Chrome tests)
test('a control reads as secret by its type, its name or id, or an autocomplete token', () => {
  // Arrange
  const plain = {
    type: 'text',
    name: 'email',
    id: 'email',
    autocomplete: 'email',
  }
  // Act, Assert
  assert.equal(
    classifySecretControl({ ...plain, type: 'password' }),
    'type=password',
  )
  assert.equal(classifySecretControl({ ...plain, name: 'accessToken' }), 'name')
  assert.equal(classifySecretControl({ ...plain, id: 'apiKey' }), 'id')
  for (const token of [
    'current-password',
    'new-password',
    'one-time-code',
    'cc-number',
    'cc-csc',
  ])
    assert.equal(
      classifySecretControl({ ...plain, autocomplete: `section-a ${token}` }),
      'autocomplete',
    )
  assert.equal(classifySecretControl(plain), undefined)
  assert.equal(
    classifySecretControl({ ...plain, name: 'tokenCount' }),
    undefined,
  )
})

// protects=a native select is chosen the way a user chooses, so a React-controlled select sees the change; fails_when=the value is set with a plain assignment (the tracker swallows it) or no change event fires; no_claim=a real React app (the page emulates React's value tracker); real headless Chrome
test('choose sets a React-tracked select through the native setter and its change reaches the framework', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  const moments = await send(page, {
    kind: 'choose',
    title: 'Customer',
    selector: '#customer',
    value: 'c1',
  })
  // Assert
  assert.deepEqual(moments, [
    'before-input',
    'acknowledged',
    'value-checked:true',
  ])
  assert.equal(
    await read(page, 'document.getElementById("customer").value'),
    'c1',
  )
  assert.deepEqual(await read(page, 'window.reactChanges'), ['customer'])
})

// protects=a number input takes its text through the native setter and reaches a React-controlled handler; fails_when=the text goes through a plain assignment, or the value does not read back; no_claim=a real React app; real headless Chrome
test('text into a number input sets the value through the native setter and the framework sees it', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  const moments = await send(page, {
    kind: 'text',
    title: 'Amount',
    selector: '#amount',
    text: '120',
  })
  // Assert
  assert.deepEqual(moments, [
    'before-input',
    'acknowledged',
    'value-checked:true',
  ])
  assert.equal(
    await read(page, 'document.getElementById("amount").value'),
    '120',
  )
  assert.deepEqual(await read(page, 'window.reactChanges'), ['amount'])
})

// protects=a number the control rejects fails the operation with INPUT_NOT_ACCEPTED, naming the app's own min and max, after the input was sent; fails_when=a value outside min and max passes the check or the refusal names no rule; no_claim=none beyond protects; real headless Chrome
test('a number the control rejects is refused as INPUT_NOT_ACCEPTED naming min and max, and is reported as sent', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  const recorded = recordingHooks()
  const prepared = await prepareOperation(portOf(page), {
    index: 3,
    total: 4,
    operation: {
      kind: 'text',
      title: 'Amount',
      selector: '#amount',
      text: '5000',
    },
  })
  // Act
  const failure = await prepared.send(recorded.hooks).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof OperationRefusal)
  assert.equal(failure.code, 'INPUT_NOT_ACCEPTED')
  assert.match(failure.message, /app's own rules \(min 1, max 1000, step 1\)/)
  assert.equal(failure.path, 'operations[2].text')
  assert.equal(failure.sent, 'sent')
  assert.equal(failure.sideEffects, 'unknown')
  assert.deepEqual(recorded.moments, [
    'before-input',
    'acknowledged',
    'value-checked:false',
  ])
})

// protects=text into an email input goes through the browser's text insertion and reads back; a textarea-like control gets the same; fails_when=the value is missing after the send; no_claim=none beyond protects; real headless Chrome
test('text into a text-like input is typed through the browser and read back', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  const moments = await send(page, {
    kind: 'text',
    title: 'Email',
    selector: '#email',
    text: 'learner@example.invalid',
  })
  // Assert
  assert.deepEqual(moments, [
    'before-input',
    'acknowledged',
    'value-checked:true',
  ])
  assert.equal(
    await read(page, 'document.getElementById("email").value'),
    'learner@example.invalid',
  )
})

// protects=a click presses and releases once at the target; fails_when=no click or two clicks reach the page; no_claim=the run's own click-point code (the port reads the centre here); real headless Chrome
test('click presses and releases the unique target once', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  const moments = await send(page, {
    kind: 'click',
    title: 'Go',
    selector: '#go',
  })
  // Assert
  assert.deepEqual(moments, ['before-input', 'acknowledged'])
  assert.equal(await read(page, 'window.clicks'), 1)
})

// protects=a missing or disabled option fails before any input with OPTION_NOT_AVAILABLE naming the value; fails_when=the select changes, or the code is another; no_claim=none beyond protects; real headless Chrome
test('choose refuses a missing and a disabled option before anything is sent', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  const missing = await refusalOf(page, {
    kind: 'choose',
    title: 'Customer',
    selector: '#customer',
    value: 'nobody',
  })
  const disabled = await refusalOf(page, {
    kind: 'choose',
    title: 'Customer',
    selector: '#customer',
    value: 'c2',
  })
  // Assert
  assert.equal(missing.code, 'OPTION_NOT_AVAILABLE')
  assert.match(missing.message, /no option with the value "nobody"/)
  assert.equal(disabled.code, 'OPTION_NOT_AVAILABLE')
  assert.match(disabled.message, /a disabled option with the value "c2"/)
  assert.equal(missing.sent, 'not-sent')
  assert.equal(missing.path, 'operations[0].value')
  assert.equal(
    await read(page, 'document.getElementById("customer").value'),
    '',
  )
})

// protects=controls a send cannot drive answer CONTROL_KIND_NOT_SUPPORTED naming the kind, with click advice where a click fits; fails_when=a multiple select, a date input or a checkbox given text is typed into; no_claim=none beyond protects; real headless Chrome
test('controls a send cannot drive are refused naming their kind and suggesting a click where it fits', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  const multiple = await refusalOf(page, {
    kind: 'choose',
    title: 'Multi',
    selector: '#multi',
    value: 'a',
  })
  const date = await refusalOf(page, {
    kind: 'text',
    title: 'When',
    selector: '#when',
    text: '2026-01-01',
  })
  const checkbox = await refusalOf(page, {
    kind: 'text',
    title: 'Agree',
    selector: '#agree',
    text: 'on',
  })
  const chooseIntoInput = await refusalOf(page, {
    kind: 'choose',
    title: 'Memo',
    selector: '#memo',
    value: 'x',
  })
  // Assert
  for (const refusal of [multiple, date, checkbox, chooseIntoInput])
    assert.equal(refusal.code, 'CONTROL_KIND_NOT_SUPPORTED')
  assert.match(multiple.message, /<select multiple>/)
  assert.match(date.message, /<input type="date">/)
  assert.match(
    checkbox.message,
    /<input type="checkbox">.*Use a click operation/,
  )
  assert.match(chooseIntoInput.message, /native single <select>/)
  assert.equal(await read(page, 'document.getElementById("when").value'), '')
})

// protects=chat text never goes into a control that reads as a secret: a password, a secret-named control and a one-time-code control answer SECRET_INPUT_FROM_CHAT and the control stays empty; fails_when=any of them receives the text; no_claim=none beyond protects; real headless Chrome
test('chat text into a password, a secret-named or a one-time-code control is refused with SECRET_INPUT_FROM_CHAT and sends nothing', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  const refusals = []
  for (const selector of ['#password', '#token-field', '#pin'])
    refusals.push(
      await refusalOf(page, {
        kind: 'text',
        title: 'Secret',
        selector,
        text: 'not-from-chat',
      }),
    )
  // Assert
  for (const refusal of refusals) {
    assert.equal(refusal.code, 'SECRET_INPUT_FROM_CHAT')
    assert.equal(refusal.sent, 'not-sent')
    assert.doesNotMatch(refusal.message, /not-from-chat/)
  }
  assert.equal(
    await read(
      page,
      '["password","token-field","pin"].map((id) => document.getElementById(id).value).join("")',
    ),
    '',
  )
})

// protects=choosing an option of a secret-named select is refused with SECRET_INPUT_VISIBLE because the chosen label would show in frames; fails_when=the select changes or the code is another; no_claim=none beyond protects; real headless Chrome
test('choose into a secret-named select is refused with SECRET_INPUT_VISIBLE', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  // Act
  const refusal = await refusalOf(page, {
    kind: 'choose',
    title: 'Key',
    selector: '#api-select',
    value: 'k1',
  })
  // Assert
  assert.equal(refusal.code, 'SECRET_INPUT_VISIBLE')
  assert.equal(refusal.sent, 'not-sent')
})

// protects=an ask-learner secret is typed into a password control with the learner's answer, and into nothing else; fails_when=the answer is not typed, or a plain text input receives it; no_claim=the learner is asked in the editor (service tests); real headless Chrome
test('an ask-learner operation types the learner secret into a password input and is refused for a visible control', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  const operation = (selector: string): RepositoryOperation => ({
    kind: 'text',
    title: 'Password',
    selector,
    secret: 'ask-learner',
  })
  // Act
  const visible = await refusalOf(page, operation('#memo'), 'typed-by-learner')
  const moments = await send(page, operation('#password'), 'typed-by-learner')
  // Assert
  assert.equal(visible.code, 'SECRET_INPUT_VISIBLE')
  assert.equal(visible.path, 'operations[0].secret')
  assert.doesNotMatch(visible.message, /typed-by-learner/)
  assert.equal(await read(page, 'document.getElementById("memo").value'), '')
  assert.deepEqual(moments, [
    'before-input',
    'acknowledged',
    'value-checked:true',
  ])
  assert.equal(
    await read(page, 'document.getElementById("password").value'),
    'typed-by-learner',
  )
})

// protects=the secret classification is read again right before the input: a control that turns into a password after it was resolved receives no chat text; fails_when=the text reaches a control that became secret; no_claim=none beyond protects; real headless Chrome
test('a control that turns into a password between resolution and the input receives nothing', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  const prepared = await prepareOperation(portOf(page), {
    index: 1,
    total: 1,
    operation: {
      kind: 'text',
      title: 'Shifty',
      selector: '#shifty',
      text: 'not-from-chat',
    },
  })
  await read(page, 'document.getElementById("shifty").type = "password"')
  // Act
  const failure = await prepared.send(recordingHooks().hooks).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof OperationRefusal)
  assert.equal(failure.code, 'SECRET_INPUT_VISIBLE')
  assert.equal(failure.sent, 'not-sent')
  assert.equal(await read(page, 'document.getElementById("shifty").value'), '')
})

// protects=a click target is read again right before the press: a target that moved is pressed where it now is, and one that disappeared is refused as INPUT_NOT_ACCEPTED, not sent, with no mouse event; fails_when=the press goes to the centre read at preparation, or a vanished target is pressed; no_claim=a real page (a scripted port answers the two reads and records the mouse events)
test('a click re-reads its target right before the press and refuses one that is gone', async () => {
  // Arrange
  const mouseEvents: { type: string; x: number; y: number }[] = []
  const cdp = {
    request: async (
      _method: string,
      parameters: { type: string; x: number; y: number },
    ) => {
      mouseEvents.push({
        type: parameters.type,
        x: parameters.x,
        y: parameters.y,
      })
      return {}
    },
  } as unknown as Cdp
  const answers: ({ x: number; y: number } | Error)[] = [
    // The two preparations read first, then each send reads again.
    { x: 10, y: 10 },
    { x: 10, y: 10 },
    { x: 50, y: 60 },
    new Error('#go is not a unique visible enabled target (not-visible)'),
  ]
  const port: OperationPort = {
    pageCdp: async () => cdp,
    origins: () => [],
    assertCurrent: (): void => {},
    millisecondsSinceNavigation: () => Number.POSITIVE_INFINITY,
    sleep: (): Promise<void> => delay(1),
    readClickPoint: async () => {
      const answer = answers.shift()!
      if (answer instanceof Error) throw answer
      return answer
    },
  }
  const operation: RepositoryOperation = {
    kind: 'click',
    title: 'Go',
    selector: '#go',
  }
  const moved = await prepareOperation(port, { index: 1, total: 1, operation })
  const gone = await prepareOperation(port, { index: 1, total: 1, operation })
  const moments = recordingHooks()
  // Act
  await moved.send(moments.hooks)
  const mouseEventsAfterMove = [...mouseEvents]
  mouseEvents.length = 0
  const refusal = await gone.send(recordingHooks().hooks).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.deepEqual(mouseEventsAfterMove, [
    { type: 'mousePressed', x: 50, y: 60 },
    { type: 'mouseReleased', x: 50, y: 60 },
  ])
  assert.ok(refusal instanceof OperationRefusal)
  assert.equal(refusal.code, 'INPUT_NOT_ACCEPTED')
  assert.equal(refusal.sent, 'not-sent')
  assert.deepEqual(mouseEvents, [])
})

// protects=the settle wait returns once the page is complete and quiet for the window, and ends with NAVIGATION_NOT_SETTLED when navigation never stops; fails_when=an operation is sent into a page that still loads, or a quiet page waits for the bound; no_claim=Chrome's real load events (the run records main-frame navigations); a fake channel stands in for the page's readyState, as the configured run tests do
test('the settle wait passes a quiet complete page and refuses a page that keeps navigating', async () => {
  // Arrange
  const states = ['loading', 'loading', 'complete']
  const quietCdp = {
    request: async () => ({ result: { value: states.shift() ?? 'complete' } }),
  } as unknown as Cdp
  const port = (sinceNavigationMs: () => number): OperationPort => ({
    pageCdp: async () => quietCdp,
    origins: () => [],
    assertCurrent: (): void => {},
    millisecondsSinceNavigation: sinceNavigationMs,
    sleep: (): Promise<void> => delay(5),
    readClickPoint: async () => ({ x: 0, y: 0 }),
  })
  // Act
  await waitForSettledPage(
    port(() => 600),
    2,
    2_000,
  )
  const refusal = await waitForSettledPage(
    port(() => 10),
    2,
    120,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(refusal instanceof OperationRefusal)
  assert.equal(refusal.code, 'NAVIGATION_NOT_SETTLED')
  assert.equal(refusal.operationIndex, 2)
  assert.equal(refusal.sent, 'not-sent')
})

// protects=a read-only number input is refused as INPUT_NOT_ACCEPTED in preparation and right before the send, and keeps its value; fails_when=the native setter writes into a read-only control; no_claim=none beyond protects; real headless Chrome
test('text into a read-only number input is refused before and after preparation and writes nothing', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  const operation: RepositoryOperation = {
    kind: 'text',
    title: 'Locked',
    selector: '#locked',
    text: '5',
  }
  // Act
  const atPreparation = await refusalOf(page, operation)
  await read(page, 'document.getElementById("locked").readOnly = false')
  const prepared = await prepareOperation(portOf(page), {
    index: 1,
    total: 1,
    operation,
  })
  await read(page, 'document.getElementById("locked").readOnly = true')
  const beforeSend = await prepared
    .send(recordingHooks().hooks)
    .then(() => undefined)
    .catch((error: unknown) => error)
  // Assert
  assert.equal(atPreparation.code, 'INPUT_NOT_ACCEPTED')
  assert.ok(beforeSend instanceof OperationRefusal)
  assert.equal(beforeSend.code, 'INPUT_NOT_ACCEPTED')
  assert.equal(await read(page, 'document.getElementById("locked").value'), '')
})

// protects=a number input inside <fieldset disabled> is refused as INPUT_NOT_ACCEPTED in preparation and right before the send, and keeps its value; fails_when=only the control's own disabled flag decides, so the native setter writes into a control the browser treats as disabled; no_claim=none beyond protects; real headless Chrome
test('text into a number input inside a disabled fieldset is refused before and after preparation and writes nothing', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  const operation: RepositoryOperation = {
    kind: 'text',
    title: 'Fielded',
    selector: '#fielded',
    text: '5',
  }
  const prepared = await prepareOperation(portOf(page), {
    index: 1,
    total: 1,
    operation,
  })
  await read(page, 'document.getElementById("group-fieldset").disabled = true')
  // Act
  const atPreparation = await refusalOf(page, operation)
  const beforeSend = await prepared
    .send(recordingHooks().hooks)
    .then(() => undefined)
    .catch((error: unknown) => error)
  // Assert
  assert.equal(atPreparation.code, 'INPUT_NOT_ACCEPTED')
  assert.ok(beforeSend instanceof OperationRefusal)
  assert.equal(beforeSend.code, 'INPUT_NOT_ACCEPTED')
  assert.equal(await read(page, 'document.getElementById("fielded").value'), '')
})

// protects=an option inside a disabled optgroup is OPTION_NOT_AVAILABLE in preparation and right before the send; fails_when=the option's own disabled flag alone decides, so the choice is applied; no_claim=none beyond protects; real headless Chrome
test('choose refuses an option inside a disabled optgroup before and after preparation', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  const choose = (value: string): RepositoryOperation => ({
    kind: 'choose',
    title: 'Group',
    selector: '#grouped',
    value,
  })
  const prepared = await prepareOperation(portOf(page), {
    index: 1,
    total: 1,
    operation: choose('g2'),
  })
  await read(page, 'document.getElementById("open").disabled = true')
  // Act
  const atPreparation = await refusalOf(page, choose('g1'))
  const beforeSend = await prepared
    .send(recordingHooks().hooks)
    .then(() => undefined)
    .catch((error: unknown) => error)
  // Assert
  assert.equal(atPreparation.code, 'OPTION_NOT_AVAILABLE')
  assert.ok(beforeSend instanceof OperationRefusal)
  assert.equal(beforeSend.code, 'OPTION_NOT_AVAILABLE')
  // The select still holds its first usable option from the page load.
  assert.equal(
    await read(page, 'document.getElementById("grouped").value'),
    'g2',
  )
})

// protects=a text insert held by a learning stop in the control's handler waits as long as a pause may be held, not the channel's default; fails_when=the insert is requested with the default 20 s deadline; no_claim=the stop itself (the channel records the deadline it is given and the real insert answers at once)
test('a text operation requests its insert with the pause-length deadline', async (context) => {
  // Arrange
  const page = await openRealChromePage(context, FIXTURE)
  if (!page) return
  const insertDeadlines: (number | undefined)[] = []
  const recording = new Proxy(page.cdp, {
    get(target, property) {
      if (property !== 'request') return Reflect.get(target, property)
      return (method: string, params: object, timeoutMs?: number) => {
        if (method === 'Input.insertText') insertDeadlines.push(timeoutMs)
        return (
          target.request as (
            ...parameters: [string, object, number | undefined]
          ) => Promise<unknown>
        ).call(target, method, params, timeoutMs)
      }
    },
  })
  const port = { ...portOf(page), pageCdp: async () => recording }
  // Act
  const prepared = await prepareOperation(port, {
    index: 1,
    total: 1,
    operation: {
      kind: 'text',
      title: 'Email',
      selector: '#email',
      text: 'learner@example.invalid',
    },
  })
  await prepared.send(recordingHooks().hooks)
  // Assert
  assert.deepEqual(insertDeadlines, [REPOSITORY_RUN_TIMEOUT_MS])
})
