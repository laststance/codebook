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

/** A page whose declared-selector targets are each unusable in one way, plus a contenteditable and a select that can hold focus. */
const FIXTURE = `<!doctype html><html><body>
<button id="hidden-button" type="button" style="display:none">Hidden</button>
<button id="disabled-button" type="button" disabled>Disabled</button>
<div inert><button id="inert-button" type="button">Inert</button></div>
<button class="twin" type="button">One</button>
<button class="twin" type="button">Two</button>
<div id="editor" contenteditable="true">Draft</div>
<select id="picker"><option value="a">A</option><option value="b">B</option></select>
</body></html>`

const HOOKS: OperationSendHooks = {
  beforeInput: () => {},
  acknowledged: () => {},
  valueChecked: () => {},
}

type PressOperation = Extract<RepositoryOperation, { kind: 'press' }>

/** Wraps a page proxy so every protocol method the engine requests is recorded in order. */
function recordingCdp(cdp: Cdp, sentMethods: string[]): Cdp {
  return new Proxy(cdp, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver)
      if (property !== 'request' && property !== 'requestQuietly') {
        return typeof value === 'function' ? value.bind(target) : value
      }
      return (method: string, ...rest: unknown[]) => {
        sentMethods.push(method)
        return Reflect.apply(value as () => unknown, target, [method, ...rest])
      }
    },
  })
}

/** Prepares and sends one press over the real page, returning its refusal and the protocol methods requested. */
async function refusalAndMethods(
  page: RealChromePage,
  operation: PressOperation,
): Promise<{ refusal: OperationRefusal; sentMethods: string[] }> {
  const sentMethods: string[] = []
  const port: OperationPort = {
    pageCdp: async () => recordingCdp(page.cdp, sentMethods),
    origins: () => [page.origin],
    assertCurrent: (): void => {},
    millisecondsSinceNavigation: () => Number.POSITIVE_INFINITY,
    isPagePaused: () => false,
    sleep: (delayMs): Promise<void> => delay(delayMs),
    readClickPoint: async () => ({ x: 0, y: 0 }),
  }
  try {
    const prepared = await prepareOperation(port, {
      index: 1,
      total: 1,
      operation,
    })
    await prepared.send(HOOKS)
  } catch (error) {
    assert.ok(error instanceof OperationRefusal)
    return { refusal: error, sentMethods }
  }
  throw new Error('The press was not refused.')
}

/** Moves the page's focus to an element, the way an earlier click operation would. */
async function focusOn(page: RealChromePage, selector: string): Promise<void> {
  await page.cdp.request('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(selector)}).focus()`,
    returnByValue: true,
  })
}

const SELECTOR_ROWS = [
  { name: 'a hidden element', selector: '#hidden-button' },
  { name: 'a disabled button', selector: '#disabled-button' },
  { name: 'an element inside [inert]', selector: '#inert-button' },
  { name: 'a selector matching two elements', selector: '.twin' },
] as const

for (const row of SELECTOR_ROWS) {
  // Value: protects=a declared selector that is not one visible enabled non-inert element is refused at the selector with no press reason and no key; fails_when=the key is sent to or around an unusable target or a press reason hides the selector fix; no_claim=the exact message wording
  test(`a press whose selector names ${row.name} is refused at its selector and sends no key`, async (context) => {
    // Arrange
    const page = await openRealChromePage(context, FIXTURE)
    if (!page) return
    // Act
    const { refusal, sentMethods } = await refusalAndMethods(page, {
      kind: 'press',
      title: 'Open',
      key: 'x',
      selector: row.selector,
    })
    // Assert
    assert.equal(refusal.code, 'INPUT_NOT_ACCEPTED')
    assert.equal(refusal.reason, undefined)
    assert.equal(refusal.path, 'operations[0].selector')
    assert.equal(refusal.sent, 'not-sent')
    assert.ok(refusal.message.includes(row.selector), refusal.message)
    assert.deepEqual(
      sentMethods.filter((method) => method === 'Input.dispatchKeyEvent'),
      [],
    )
  })
}

for (const row of [
  { name: 'a contenteditable element', selector: '#editor' },
  { name: 'a select', selector: '#picker' },
] as const) {
  // Value: protects=a key is never typed into a contenteditable element or a select that holds focus; fails_when=either focus owner is not treated as text entry and receives the key; no_claim=text inputs (pressOperation.test.ts)
  test(`a press with focus in ${row.name} is refused as focus in text entry and sends no key`, async (context) => {
    // Arrange
    const page = await openRealChromePage(context, FIXTURE)
    if (!page) return
    await focusOn(page, row.selector)
    // Act
    const { refusal, sentMethods } = await refusalAndMethods(page, {
      kind: 'press',
      title: 'Open',
      key: 'x',
    })
    // Assert
    assert.equal(refusal.code, 'INPUT_NOT_ACCEPTED')
    assert.equal(refusal.reason, 'press-focus-in-text-entry')
    assert.equal(refusal.sent, 'not-sent')
    assert.deepEqual(
      sentMethods.filter((method) => method === 'Input.dispatchKeyEvent'),
      [],
    )
  })
}
