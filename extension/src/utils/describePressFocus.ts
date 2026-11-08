/**
 * What the owned page reports of the element a `press` operation's key would go to: attributes only, never a value or text.
 * `ready` is `false` with a `reason` when the target cannot be used (`wrong-origin`, `unique-target-required`, `target-not-visible`, `target-disabled`, `target-not-focusable`); the attribute fields are present whenever the page resolved an element.
 */
export type PressFocusDescription = {
  ready: boolean
  reason?: string
  tagName?: string
  type?: string
  name?: string
  id?: string
  autocomplete?: string
  /** The tag of the element the page resolved, when the recipient lives in an open shadow root below it. */
  hostTagName?: string
  isTextEntry?: boolean
  isInFrame?: boolean
  isFocused?: boolean
}

/**
 * Describes, inside the owned page, the element a key press would reach; serialized with `toString()`, so everything it uses is declared inside it.
 *
 * Why it exists: a press goes to whatever holds the focus, so Codebook classifies that recipient (secret, text entry, frame) before the run and again right before the key is sent. Sent by `Runtime.evaluate` from `preparePressOperation` (`focus: false`: classify only) and from the press send (`focus: true`: focus the target, then classify the actual recipient); exported so a Node test runs it against a fake page.
 * With `selector` it resolves the unique target on an owned origin, which must be visible, enabled, outside `[inert]` and focusable; without it, the document's active element. The subject it classifies is the recipient: the focused element resolved through open shadow roots, so a `delegatesFocus` host is judged by the control inside it. A closed shadow root hides its focus, so the host is the subject then.
 * @param input - The optional selector, the loopback origins the page may be at and whether to apply the focus to the target first.
 * @returns The {@link PressFocusDescription}; with `focus: true` and a target that did not take focus, `reason: 'target-not-focusable'` and the attributes of the target itself.
 * @example
 * describePressFocus({ selector: '#menu', origins: ['http://localhost:3000'], focus: false }) // => { ready: true, tagName: 'button', type: '', name: '', id: 'menu', autocomplete: '', isTextEntry: false, isInFrame: false, isFocused: false }
 */
export function describePressFocus(input: {
  selector?: string
  origins: readonly string[]
  focus: boolean
}): PressFocusDescription {
  /** The focused element, through open shadow roots. */
  const recipientOf = (): Element | null => {
    let active = document.activeElement
    while (active?.shadowRoot?.activeElement)
      active = active.shadowRoot.activeElement
    return active
  }
  /** Says whether the element is the target itself or sits in an open shadow tree below it. */
  const isWithin = (element: Element | null, target: Element): boolean => {
    let node: Node | null = element
    while (node) {
      if (node === target) return true
      const root: Node = node.getRootNode()
      node = root instanceof ShadowRoot ? root.host : null
    }
    return false
  }
  /** The first reason the named target cannot take the key, or the target itself. */
  const resolveTarget = (selector: string): Element | string => {
    let matches: ArrayLike<Element> = []
    try {
      matches = document.querySelectorAll(selector)
    } catch {
      return 'unique-target-required'
    }
    const found = matches.length === 1 ? matches[0] : undefined
    if (!found?.isConnected) return 'unique-target-required'
    const rect = found.getBoundingClientRect()
    const style = getComputedStyle(found)
    const isHidden =
      rect.width <= 0 ||
      rect.height <= 0 ||
      style.display === 'none' ||
      style.visibility !== 'visible' ||
      style.opacity === '0'
    if (isHidden) return 'target-not-visible'
    if (found.matches(':disabled') || found.closest('[inert]'))
      return 'target-disabled'
    return found
  }
  /** Says whether the element can take focus: a link, a form control, an editable or a `tabindex` element. */
  const isFocusable = (element: Element): boolean =>
    element.matches(
      'a[href], area[href], button, select, textarea, summary, iframe, [contenteditable], [tabindex]',
    ) ||
    // A host that delegates focus hands it to the first focusable control in its shadow tree.
    element.shadowRoot?.delegatesFocus === true ||
    (element instanceof HTMLInputElement && element.type !== 'hidden')
  /** The reason the target cannot take the key's focus (verified after a focus applied here), or nothing. */
  const focusBlockerOf = (element: Element): string | undefined => {
    if (!isFocusable(element)) return 'target-not-focusable'
    // Both HTML and SVG elements take focus (an SVG element with a `tabindex`).
    if (
      !input.focus ||
      !(element instanceof HTMLElement || element instanceof SVGElement)
    )
      return undefined
    element.focus()
    return isWithin(recipientOf(), element) ? undefined : 'target-not-focusable'
  }
  /** Says whether a typed key would enter text: a textarea, a select, an input that takes text or editable content. */
  const isTextEntryOf = (subject: Element, tagName: string, type: string) =>
    tagName === 'textarea' ||
    tagName === 'select' ||
    (tagName === 'input' &&
      ![
        'button',
        'submit',
        'reset',
        'checkbox',
        'radio',
        'range',
        'image',
        'file',
        'color',
        'hidden',
      ].includes(type)) ||
    (subject instanceof HTMLElement && subject.isContentEditable)
  /** Describes the subject by attributes only; `host` is the element the page resolved, named when it differs. */
  const describeSubject = (
    subject: Element,
    host: Element | null,
    blocker: string | undefined,
  ): PressFocusDescription => {
    const tagName = subject.tagName.toLowerCase()
    const type = subject instanceof HTMLInputElement ? subject.type : ''
    const hostTagName = host?.tagName.toLowerCase()
    return {
      ready: blocker === undefined,
      reason: blocker,
      tagName,
      type,
      name: subject.getAttribute('name') ?? '',
      id: subject.id,
      autocomplete: subject.getAttribute('autocomplete') ?? '',
      ...(hostTagName !== undefined && hostTagName !== tagName
        ? { hostTagName }
        : {}),
      isTextEntry: isTextEntryOf(subject, tagName, type),
      isInFrame: ['iframe', 'frame', 'object', 'embed'].includes(tagName),
      isFocused: recipientOf() === subject,
    }
  }
  if (!input.origins.includes(location.origin))
    return { ready: false, reason: 'wrong-origin' }
  if (input.selector === undefined)
    return describeSubject(
      recipientOf() ?? document.body,
      document.activeElement,
      undefined,
    )
  const resolved = resolveTarget(input.selector)
  if (typeof resolved === 'string') return { ready: false, reason: resolved }
  const blocker = focusBlockerOf(resolved)
  // Classified as the target before the focus is applied; after it, as the recipient when the focus landed, else still as the target (never the element that held focus before).
  const subject =
    input.focus && blocker === undefined
      ? (recipientOf() ?? document.body)
      : resolved
  return describeSubject(subject, resolved, blocker)
}
