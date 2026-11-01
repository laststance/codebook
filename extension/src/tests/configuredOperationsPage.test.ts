import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyNativeValue,
  describeConfirmationControls,
  describeOperationControl,
} from '../configuredOperations'

/** The origin the fake page is at; every call below names it as owned unless a test says otherwise. */
const OWNED_ORIGIN = 'http://localhost:3000'

/**
 * An element of the fake page: the attributes, box, computed style and effective `:disabled` state the in-page functions read, and the events dispatched to it.
 * The real-Chrome tests in configuredOperations.test.ts drive the same functions in a browser; this fake lets each branch run in Node.
 */
class FakeElement {
  readonly tagName: string
  readonly id: string
  isConnected = true
  /** What `matches(':disabled')` answers: the effective state, as a `<fieldset disabled>` gives it. */
  isDisabled = false
  box = { width: 120, height: 24 }
  style = { display: 'inline-block', visibility: 'visible', opacity: '1' }
  shadowRoot: { activeElement: FakeElement | null } | null = null
  readonly dispatched: { type: string; bubbles: boolean }[] = []
  /** Runs for each dispatched event, as a page's handler would. */
  onDispatch: (type: string) => void = () => {}
  private readonly attributes: Map<string, string>
  constructor(tagName: string, attributes: Record<string, string>) {
    this.tagName = tagName.toUpperCase()
    this.attributes = new Map(Object.entries(attributes))
    this.id = attributes.id ?? ''
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  matches(selector: string): boolean {
    assert.equal(selector, ':disabled')
    return this.isDisabled
  }
  getBoundingClientRect(): { width: number; height: number } {
    return this.box
  }
  dispatchEvent(event: Event): boolean {
    this.dispatched.push({ type: event.type, bubbles: event.bubbles })
    this.onDispatch(event.type)
    return true
  }
}

/** A fake `HTMLElement`: a `<div>` or the base of the form controls. */
class FakeHTMLElement extends FakeElement {
  isContentEditable = false
}

/** A fake `<input>`, whose prototype holds the native `value` accessor as the browser's does. */
class FakeHTMLInputElement extends FakeHTMLElement {
  readOnly = false
  validity = { valid: true }
  private storedValue = ''
  constructor(attributes: Record<string, string>) {
    super('input', attributes)
  }
  get type(): string {
    return this.getAttribute('type') ?? 'text'
  }
  get value(): string {
    return this.storedValue
  }
  set value(next: string) {
    this.storedValue = next
  }
}

/** A fake `<textarea>`. */
class FakeHTMLTextAreaElement extends FakeHTMLElement {
  readOnly = false
  constructor(attributes: Record<string, string>) {
    super('textarea', attributes)
  }
}

/** A fake `<option>` with its effective `:disabled` state. */
class FakeOption {
  constructor(
    readonly value: string,
    readonly isDisabled = false,
    readonly label = value,
  ) {}
  matches(selector: string): boolean {
    assert.equal(selector, ':disabled')
    return this.isDisabled
  }
}

/** A fake `<select>`, whose prototype holds the native `value` accessor; a value no option has leaves it empty, as the browser does. */
class FakeHTMLSelectElement extends FakeHTMLElement {
  multiple = false
  readonly options: FakeOption[]
  private storedValue = ''
  constructor(attributes: Record<string, string>, options: FakeOption[]) {
    super('select', attributes)
    this.options = options
  }
  get value(): string {
    return this.storedValue
  }
  set value(next: string) {
    this.storedValue = this.options.some((option) => option.value === next)
      ? next
      : ''
  }
}

/** What the fake page answers: its origin, what each selector matches, the focused element and, optionally, page classes that differ from the fakes. */
type FakePage = {
  origin: string
  matchesBySelector: Record<string, FakeElement[]>
  activeElement?: FakeElement
  selectClass?: typeof FakeHTMLSelectElement
}

/** The page globals the in-page functions read and Node lacks; each is restored after a call. */
const PAGE_GLOBALS = [
  'location',
  'document',
  'getComputedStyle',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLSelectElement',
] as const

/** Runs `run` with the fake page's globals installed on Node's global object, then puts the previous globals back. */
function inFakePage<Result>(page: FakePage, run: () => Result): Result {
  const previous = PAGE_GLOBALS.map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  Object.assign(globalThis, {
    location: { origin: page.origin },
    document: {
      activeElement: page.activeElement ?? null,
      querySelectorAll: (selector: string) =>
        page.matchesBySelector[selector] ?? [],
    },
    getComputedStyle: (element: FakeElement) => element.style,
    HTMLElement: FakeHTMLElement,
    HTMLInputElement: FakeHTMLInputElement,
    HTMLTextAreaElement: FakeHTMLTextAreaElement,
    HTMLSelectElement: page.selectClass ?? FakeHTMLSelectElement,
  })
  try {
    return run()
  } finally {
    for (const [name, descriptor] of previous)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
  }
}

/** Runs the real {@link describeOperationControl} on a fake control, with the page's origin owned. */
function describeIn(page: FakePage, control: FakeElement, selector: string) {
  return inFakePage(page, () =>
    describeOperationControl.call(control as unknown as Element, {
      selector,
      origins: [OWNED_ORIGIN],
    }),
  )
}

/** Runs the real {@link applyNativeValue} on a fake control classified with `expected`, with the page's origin owned. */
function applyIn(
  page: FakePage,
  control: FakeElement,
  input: {
    selector: string
    kind: 'number' | 'select'
    value: string
    expected: {
      tagName: string
      type: string
      name: string
      id: string
      autocomplete: string
    }
  },
) {
  return inFakePage(page, () =>
    applyNativeValue.call(control as unknown as Element, {
      ...input,
      origins: [OWNED_ORIGIN],
    }),
  )
}

/** The fingerprint `#customer` was classified with: a select named customer. */
const CUSTOMER_FINGERPRINT = {
  tagName: 'select',
  type: '',
  name: 'customer',
  id: 'customer',
  autocomplete: '',
}

/** The fingerprint `#amount` was classified with: a number input named amount. */
const AMOUNT_FINGERPRINT = {
  tagName: 'input',
  type: 'number',
  name: 'amount',
  id: 'amount',
  autocomplete: '',
}

/** A `#customer` select with an empty choice, Alice (`c1`) and Bob (`c2`). */
function customerSelect(): FakeHTMLSelectElement {
  return new FakeHTMLSelectElement({ id: 'customer', name: 'customer' }, [
    new FakeOption(''),
    new FakeOption('c1'),
    new FakeOption('c2'),
  ])
}

/** A `#amount` number input limited to 1–100 in steps of 1. */
function amountInput(): FakeHTMLInputElement {
  return new FakeHTMLInputElement({
    id: 'amount',
    name: 'amount',
    type: 'number',
    min: '1',
    max: '100',
    step: '1',
  })
}

// protects=the classification reads a control's attributes and never its value; fails_when=a field is missing, misnamed or carries the typed value; no_claim=real layout or computed style (a fake box and style stand in for Chrome's)
test('describes a visible enabled number input by its attributes, without its value', () => {
  // Arrange
  const amount = new FakeHTMLInputElement({
    id: 'amount',
    name: 'amount',
    type: 'number',
    autocomplete: 'off',
  })
  amount.value = '42'
  const page = {
    origin: OWNED_ORIGIN,
    matchesBySelector: { '#amount': [amount] },
  }
  // Act
  const description = describeIn(page, amount, '#amount')
  // Assert
  assert.deepEqual(description, {
    ready: true,
    reason: undefined,
    tagName: 'input',
    type: 'number',
    name: 'amount',
    id: 'amount',
    autocomplete: 'off',
    multiple: false,
    isContentEditable: false,
    isFocused: false,
  })
})

// protects=no operation is prepared on a page that left the run's loopback origins; fails_when=a foreign page's control is described; no_claim=how the run notices the navigation
test('refuses to describe a control on a page at an origin the run does not own', () => {
  // Arrange
  const amount = amountInput()
  const page = {
    origin: 'https://example.com',
    matchesBySelector: { '#amount': [amount] },
  }
  // Act
  const description = describeIn(page, amount, '#amount')
  // Assert
  assert.deepEqual(description, { ready: false, reason: 'wrong-origin' })
})

// protects=an operation names exactly one connected control; fails_when=an ambiguous selector, a selector that now names another control or a detached control is described as ready; no_claim=CSS selector parsing (the fake maps selectors to elements)
test('refuses a selector that matches two controls, another control or a detached one', () => {
  // Arrange
  const amount = amountInput()
  const other = amountInput()
  const detached = amountInput()
  detached.isConnected = false
  // Act
  const ambiguous = describeIn(
    { origin: OWNED_ORIGIN, matchesBySelector: { '#amount': [amount, other] } },
    amount,
    '#amount',
  )
  const replaced = describeIn(
    { origin: OWNED_ORIGIN, matchesBySelector: { '#amount': [other] } },
    amount,
    '#amount',
  )
  const removed = describeIn(
    { origin: OWNED_ORIGIN, matchesBySelector: { '#amount': [detached] } },
    detached,
    '#amount',
  )
  // Assert
  assert.deepEqual(ambiguous, {
    ready: false,
    reason: 'unique-control-required',
  })
  assert.deepEqual(replaced, {
    ready: false,
    reason: 'unique-control-required',
  })
  assert.deepEqual(removed, { ready: false, reason: 'unique-control-required' })
})

// protects=the text path types only into the control that holds the focus, also inside open shadow roots; fails_when=a control focused inside nested shadow roots reads as unfocused, or another focused element reads as this one; no_claim=real focus handling (the fake document names the focused element)
test('reads the focus through nested open shadow roots and tells another focused element apart', () => {
  // Arrange
  const email = new FakeHTMLInputElement({ id: 'email', type: 'email' })
  const innerHost = new FakeHTMLElement('sign-in-field', {})
  innerHost.shadowRoot = { activeElement: email }
  const outerHost = new FakeHTMLElement('sign-in-form', {})
  outerHost.shadowRoot = { activeElement: innerHost }
  const memo = new FakeHTMLInputElement({ id: 'memo', type: 'text' })
  // Act
  const insideShadowRoots = describeIn(
    {
      origin: OWNED_ORIGIN,
      matchesBySelector: { '#email': [email] },
      activeElement: outerHost,
    },
    email,
    '#email',
  )
  const elsewhere = describeIn(
    {
      origin: OWNED_ORIGIN,
      matchesBySelector: { '#email': [email] },
      activeElement: memo,
    },
    email,
    '#email',
  )
  // Assert
  assert.equal(insideShadowRoots.isFocused, true)
  assert.equal(elsewhere.isFocused, false)
})

// protects=a control the learner cannot see receives no operation; fails_when=a control without a box, with display none, visibility hidden or opacity 0 reads as ready; no_claim=CSS cascade (the fake style is the computed one)
test('a control without a box, or hidden by display, visibility or opacity, is not ready', () => {
  // Arrange
  const withoutWidth = amountInput()
  withoutWidth.box = { width: 0, height: 24 }
  const withoutHeight = amountInput()
  withoutHeight.box = { width: 120, height: 0 }
  const notDisplayed = amountInput()
  notDisplayed.style = { ...notDisplayed.style, display: 'none' }
  const invisible = amountInput()
  invisible.style = { ...invisible.style, visibility: 'hidden' }
  const transparent = amountInput()
  transparent.style = { ...transparent.style, opacity: '0' }
  // Act
  const reasons = [
    withoutWidth,
    withoutHeight,
    notDisplayed,
    invisible,
    transparent,
  ].map((control) => {
    const description = describeIn(
      { origin: OWNED_ORIGIN, matchesBySelector: { '#amount': [control] } },
      control,
      '#amount',
    )
    return [description.ready, description.reason]
  })
  // Assert
  assert.deepEqual(reasons, [
    [false, 'control-not-visible'],
    [false, 'control-not-visible'],
    [false, 'control-not-visible'],
    [false, 'control-not-visible'],
    [false, 'control-not-visible'],
  ])
})

// protects=a disabled control, also one inside a disabled fieldset, receives no operation, and a hidden one is named hidden first; fails_when=the effective disabled state is ignored or the reasons swap order; no_claim=how Chrome computes :disabled
test('a disabled control is not ready, and a hidden disabled control is named not visible', () => {
  // Arrange
  const disabled = amountInput()
  disabled.isDisabled = true
  const hiddenAndDisabled = amountInput()
  hiddenAndDisabled.isDisabled = true
  hiddenAndDisabled.style = { ...hiddenAndDisabled.style, display: 'none' }
  // Act
  const disabledDescription = describeIn(
    { origin: OWNED_ORIGIN, matchesBySelector: { '#amount': [disabled] } },
    disabled,
    '#amount',
  )
  const hiddenDescription = describeIn(
    {
      origin: OWNED_ORIGIN,
      matchesBySelector: { '#amount': [hiddenAndDisabled] },
    },
    hiddenAndDisabled,
    '#amount',
  )
  // Assert
  assert.equal(disabledDescription.ready, false)
  assert.equal(disabledDescription.reason, 'control-disabled')
  assert.equal(hiddenDescription.reason, 'control-not-visible')
})

// protects=a read-only input or textarea takes no typed or set value, while a select (which has no read-only state) stays ready; fails_when=a read-only control reads as ready or a select is refused as read-only; no_claim=the browser's own editability rules
test('a read-only input or textarea is not ready, and a select stays ready', () => {
  // Arrange
  const lockedAmount = amountInput()
  lockedAmount.readOnly = true
  const lockedNote = new FakeHTMLTextAreaElement({ id: 'note', name: 'note' })
  lockedNote.readOnly = true
  const customer = customerSelect()
  // Act
  const amountDescription = describeIn(
    { origin: OWNED_ORIGIN, matchesBySelector: { '#amount': [lockedAmount] } },
    lockedAmount,
    '#amount',
  )
  const noteDescription = describeIn(
    { origin: OWNED_ORIGIN, matchesBySelector: { '#note': [lockedNote] } },
    lockedNote,
    '#note',
  )
  const customerDescription = describeIn(
    { origin: OWNED_ORIGIN, matchesBySelector: { '#customer': [customer] } },
    customer,
    '#customer',
  )
  // Assert
  assert.equal(amountDescription.reason, 'control-readonly')
  assert.equal(noteDescription.reason, 'control-readonly')
  assert.equal(noteDescription.tagName, 'textarea')
  assert.equal(customerDescription.ready, true)
  assert.equal(customerDescription.reason, undefined)
})

// protects=the kind refusal can name a multiple select and editable content; fails_when=multiple or isContentEditable is lost, or a missing name or autocomplete reads as null; no_claim=which operation kinds accept these controls (prepareOperation decides)
test('names a multiple select and an editable element, with empty texts for absent attributes', () => {
  // Arrange
  const tags = new FakeHTMLSelectElement({ id: 'tags' }, [new FakeOption('a')])
  tags.multiple = true
  const editor = new FakeHTMLElement('div', { id: 'editor' })
  editor.isContentEditable = true
  // Act
  const tagsDescription = describeIn(
    { origin: OWNED_ORIGIN, matchesBySelector: { '#tags': [tags] } },
    tags,
    '#tags',
  )
  const editorDescription = describeIn(
    { origin: OWNED_ORIGIN, matchesBySelector: { '#editor': [editor] } },
    editor,
    '#editor',
  )
  // Assert
  assert.deepEqual(tagsDescription, {
    ready: true,
    reason: undefined,
    tagName: 'select',
    type: '',
    name: '',
    id: 'tags',
    autocomplete: '',
    multiple: true,
    isContentEditable: false,
    isFocused: false,
  })
  assert.deepEqual(editorDescription, {
    ready: true,
    reason: undefined,
    tagName: 'div',
    type: '',
    name: '',
    id: 'editor',
    autocomplete: '',
    multiple: false,
    isContentEditable: true,
    isFocused: false,
  })
})

// protects=choose sets the value past a framework's own value property and fires bubbling input then change, so a React-controlled select sees it; fails_when=a plain assignment is used, an event is missing, out of order or not bubbling; no_claim=React itself (an own value property stands in for its tracker)
test('choose sets a select through the native setter and fires bubbling input and change events', () => {
  // Arrange
  const customer = customerSelect()
  const plainAssignments: string[] = []
  const nativeValue = Object.getOwnPropertyDescriptor(
    FakeHTMLSelectElement.prototype,
    'value',
  )
  // A framework's tracker: an own value property that records what a plain assignment sets.
  Object.defineProperty(customer, 'value', {
    configurable: true,
    get: () => nativeValue?.get?.call(customer),
    set: (next: string) => {
      plainAssignments.push(next)
      nativeValue?.set?.call(customer, next)
    },
  })
  const page = {
    origin: OWNED_ORIGIN,
    matchesBySelector: { '#customer': [customer] },
  }
  // Act
  const result = applyIn(page, customer, {
    selector: '#customer',
    kind: 'select',
    value: 'c1',
    expected: CUSTOMER_FINGERPRINT,
  })
  // Assert
  assert.deepEqual(result, {
    applied: true,
    valueMatches: true,
    isValid: true,
    rule: undefined,
  })
  assert.equal(customer.value, 'c1')
  assert.deepEqual(plainAssignments, [])
  assert.deepEqual(customer.dispatched, [
    { type: 'input', bubbles: true },
    { type: 'change', bubbles: true },
  ])
})

// protects=a number the app's rules refuse is reported with the rules the refusal sentence names; fails_when=validity or a declared min, max, step or pattern is lost, or an absent rule reads as null; no_claim=the browser's constraint validation (the fake validity is set by the test)
test('a number input reports its validity and its min, max, step and pattern rules after the value is set', () => {
  // Arrange
  const amount = amountInput()
  amount.validity = { valid: false }
  const code = new FakeHTMLInputElement({
    id: 'code',
    name: 'code',
    type: 'number',
    pattern: '[0-9]{4}',
  })
  // Act
  const amountResult = applyIn(
    { origin: OWNED_ORIGIN, matchesBySelector: { '#amount': [amount] } },
    amount,
    {
      selector: '#amount',
      kind: 'number',
      value: '120',
      expected: AMOUNT_FINGERPRINT,
    },
  )
  const codeResult = applyIn(
    { origin: OWNED_ORIGIN, matchesBySelector: { '#code': [code] } },
    code,
    {
      selector: '#code',
      kind: 'number',
      value: '1234',
      expected: { ...AMOUNT_FINGERPRINT, name: 'code', id: 'code' },
    },
  )
  // Assert
  assert.deepEqual(amountResult, {
    applied: true,
    valueMatches: true,
    isValid: false,
    rule: { min: '1', max: '100', step: '1', pattern: undefined },
  })
  assert.equal(amount.value, '120')
  assert.deepEqual(codeResult, {
    applied: true,
    valueMatches: true,
    isValid: true,
    rule: {
      min: undefined,
      max: undefined,
      step: undefined,
      pattern: '[0-9]{4}',
    },
  })
})

// protects=nothing is set on a page that left the owned origins or when the selector no longer names this one control; fails_when=a value is set or an event fires there; no_claim=how the run reacts to the refusal (refusalOfUnapplied words it)
test('choose sets nothing on a page at another origin or when the selector no longer names this one control', () => {
  // Arrange
  const customer = customerSelect()
  const twin = customerSelect()
  // Act
  const foreign = applyIn(
    {
      origin: 'https://example.com',
      matchesBySelector: { '#customer': [customer] },
    },
    customer,
    {
      selector: '#customer',
      kind: 'select',
      value: 'c1',
      expected: CUSTOMER_FINGERPRINT,
    },
  )
  const ambiguous = applyIn(
    {
      origin: OWNED_ORIGIN,
      matchesBySelector: { '#customer': [customer, twin] },
    },
    customer,
    {
      selector: '#customer',
      kind: 'select',
      value: 'c1',
      expected: CUSTOMER_FINGERPRINT,
    },
  )
  // Assert
  assert.deepEqual(foreign, { applied: false, reason: 'wrong-origin' })
  assert.deepEqual(ambiguous, {
    applied: false,
    reason: 'unique-control-required',
  })
  assert.equal(customer.value, '')
  assert.deepEqual(customer.dispatched, [])
})

// protects=a control that turned into another kind, a secret one or a non-value control after it was classified receives nothing; fails_when=the fingerprint is not compared or a textarea is set; no_claim=which attribute changes the page can make (the fakes change type, name and tag)
test('sets nothing on a control that changed its type, its name or its kind since it was classified', () => {
  // Arrange
  const nowPassword = new FakeHTMLInputElement({
    id: 'amount',
    name: 'amount',
    type: 'password',
  })
  const renamed = amountInput()
  renamed.setAttribute('name', 'accessToken')
  const textArea = new FakeHTMLTextAreaElement({ id: 'amount', name: 'amount' })
  // Act
  const results = [nowPassword, renamed, textArea].map((control) =>
    applyIn(
      { origin: OWNED_ORIGIN, matchesBySelector: { '#amount': [control] } },
      control,
      {
        selector: '#amount',
        kind: 'number',
        value: '12',
        expected: AMOUNT_FINGERPRINT,
      },
    ),
  )
  // Assert
  assert.deepEqual(results, [
    { applied: false, reason: 'control-changed' },
    { applied: false, reason: 'control-changed' },
    { applied: false, reason: 'control-changed' },
  ])
  assert.equal(nowPassword.value, '')
  assert.equal(renamed.value, '')
  assert.deepEqual(nowPassword.dispatched, [])
  assert.deepEqual(textArea.dispatched, [])
})

// protects=a disabled control (also inside a disabled fieldset) and a read-only number input receive no value; fails_when=either is set or fires an event; no_claim=how Chrome computes :disabled
test('sets nothing on a disabled control or a read-only number input', () => {
  // Arrange
  const disabled = amountInput()
  disabled.isDisabled = true
  const locked = amountInput()
  locked.readOnly = true
  // Act
  const disabledResult = applyIn(
    { origin: OWNED_ORIGIN, matchesBySelector: { '#amount': [disabled] } },
    disabled,
    {
      selector: '#amount',
      kind: 'number',
      value: '12',
      expected: AMOUNT_FINGERPRINT,
    },
  )
  const lockedResult = applyIn(
    { origin: OWNED_ORIGIN, matchesBySelector: { '#amount': [locked] } },
    locked,
    {
      selector: '#amount',
      kind: 'number',
      value: '12',
      expected: AMOUNT_FINGERPRINT,
    },
  )
  // Assert
  assert.deepEqual(disabledResult, {
    applied: false,
    reason: 'control-disabled',
  })
  assert.deepEqual(lockedResult, { applied: false, reason: 'control-readonly' })
  assert.equal(disabled.value, '')
  assert.equal(locked.value, '')
  assert.deepEqual(locked.dispatched, [])
})

// protects=choose never sets a value the select offers no enabled option for; fails_when=a missing or disabled option (also one in a disabled optgroup) is set or fires an event; no_claim=how Chrome computes an option's :disabled
test('choose sets nothing when the select has no option with the value or only a disabled one', () => {
  // Arrange
  const customer = new FakeHTMLSelectElement(
    { id: 'customer', name: 'customer' },
    [new FakeOption(''), new FakeOption('c1'), new FakeOption('c2', true)],
  )
  const page = {
    origin: OWNED_ORIGIN,
    matchesBySelector: { '#customer': [customer] },
  }
  // Act
  const missing = applyIn(page, customer, {
    selector: '#customer',
    kind: 'select',
    value: 'c9',
    expected: CUSTOMER_FINGERPRINT,
  })
  const disabled = applyIn(page, customer, {
    selector: '#customer',
    kind: 'select',
    value: 'c2',
    expected: CUSTOMER_FINGERPRINT,
  })
  // Assert
  assert.deepEqual(missing, { applied: false, reason: 'option-missing' })
  assert.deepEqual(disabled, { applied: false, reason: 'option-disabled' })
  assert.equal(customer.value, '')
  assert.deepEqual(customer.dispatched, [])
})

// protects=the value check reads the control the selector names after the handlers ran, so a re-render that dropped the value fails and one that kept it passes; fails_when=the stale control is read, or a removed control reads as valid; no_claim=a framework's re-render (the change handler swaps the fake's matches)
test('the value is read back from the control the selector names after the change handler re-rendered it', () => {
  // Arrange
  const keptValue = customerSelect()
  keptValue.value = 'c1'
  const otherValue = customerSelect()
  otherValue.value = 'c2'
  const cases = [
    { replacement: [keptValue] },
    { replacement: [otherValue] },
    { replacement: [] },
  ].map(({ replacement }) => {
    const customer = customerSelect()
    const page = {
      origin: OWNED_ORIGIN,
      matchesBySelector: { '#customer': [customer] },
    }
    customer.onDispatch = (type): void => {
      if (type === 'change') page.matchesBySelector['#customer'] = replacement
    }
    return { page, customer }
  })
  // Act
  const results = cases.map(({ page, customer }) =>
    applyIn(page, customer, {
      selector: '#customer',
      kind: 'select',
      value: 'c1',
      expected: CUSTOMER_FINGERPRINT,
    }),
  )
  // Assert
  assert.deepEqual(results, [
    { applied: true, valueMatches: true, isValid: true, rule: undefined },
    { applied: true, valueMatches: false, isValid: true, rule: undefined },
    { applied: true, valueMatches: false, isValid: false, rule: undefined },
  ])
})

// protects=a page that removed the native value setter gets nothing set and no event; fails_when=a plain assignment or an event is used instead; no_claim=why a page would remove it (a subclass without its own value accessor stands in for the deleted one)
test('choose sets nothing on a page whose select prototype has no native value setter', () => {
  // Arrange
  class SelectWithoutNativeSetter extends FakeHTMLSelectElement {}
  const customer = new SelectWithoutNativeSetter(
    { id: 'customer', name: 'customer' },
    [new FakeOption(''), new FakeOption('c1')],
  )
  const page = {
    origin: OWNED_ORIGIN,
    matchesBySelector: { '#customer': [customer] },
    selectClass: SelectWithoutNativeSetter,
  }
  // Act
  const result = applyIn(page, customer, {
    selector: '#customer',
    kind: 'select',
    value: 'c1',
    expected: CUSTOMER_FINGERPRINT,
  })
  // Assert
  assert.deepEqual(result, { applied: false, reason: 'setter-missing' })
  assert.equal(customer.value, '')
  assert.deepEqual(customer.dispatched, [])
})

// protects=ENG-8: the confirmation's in-page read names the enabled option by its label, skips a disabled option and a multiple select, finds exactly one control, reads attributes only, and answers nothing at another origin; fails_when=a disabled label or a value is read, two matches count as found, or another origin answers; no_claim=real Chrome (the real-Chrome test covers it)
test('the confirmation read names an enabled option by its label and reads nothing at another origin', () => {
  // Arrange
  const customer = new FakeHTMLSelectElement(
    { id: 'customer', name: 'customer' },
    [new FakeOption('c1', false, 'Alice'), new FakeOption('c2', true, 'Bob')],
  )
  const multiple = new FakeHTMLSelectElement({ id: 'multi' }, [
    new FakeOption('a', false, 'A'),
  ])
  multiple.multiple = true
  const first = new FakeHTMLInputElement({ id: 'one', type: 'password' })
  const second = new FakeHTMLInputElement({ id: 'two' })
  const page = {
    origin: OWNED_ORIGIN,
    matchesBySelector: {
      '#customer': [customer],
      '#multi': [multiple],
      '.pair': [first, second],
    },
  }
  const input = {
    origins: [OWNED_ORIGIN],
    controls: [
      { selector: '#customer', value: 'c1' },
      { selector: '#customer', value: 'c2' },
      { selector: '#multi', value: 'a' },
      { selector: '.pair' },
      { selector: '#absent' },
      null,
    ],
  }
  // Act
  const described = inFakePage(page, () => describeConfirmationControls(input))
  const elsewhere = inFakePage(
    { ...page, origin: 'https://other.example' },
    () => describeConfirmationControls(input),
  )
  // Assert
  assert.deepEqual(described, [
    {
      found: true,
      type: '',
      name: 'customer',
      id: 'customer',
      autocomplete: '',
      optionLabel: 'Alice',
    },
    {
      found: true,
      type: '',
      name: 'customer',
      id: 'customer',
      autocomplete: '',
      optionLabel: undefined,
    },
    {
      found: true,
      type: '',
      name: '',
      id: 'multi',
      autocomplete: '',
      optionLabel: undefined,
    },
    { found: false },
    { found: false },
    null,
  ])
  assert.deepEqual(elsewhere, [null, null, null, null, null, null])
})
