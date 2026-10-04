import { runInNewContext } from 'node:vm'

import type { WikiFreshness } from '../../utils/inspectDeepWikiFreshness'
import type { WikiUpdateStatus } from '../../utils/wikiUpdateRun'

import { createManualClock } from './createManualClock'

type PageEvent = { defaultPrevented: boolean; preventDefault(): void }
type PageListener = (event: PageEvent) => void
type PageNode = PageElement | string

/** How long one step of {@link FakeWikiPage.advance} is at most; the last step of an advance is cut to what is left of it. */
const CLOCK_STEP_MS = 1_000
/** The two attribute forms {@link PageElement.matches} understands, `[attribute]` and `[attribute=value]` (the value with or without quotes); a bracket group of any other form, such as one with an operator, is refused. */
const SUPPORTED_ATTRIBUTE_SELECTOR = /\[([\w-]+)(?:="?([^"\]]*)"?)?\]/g
/** When a fake page is loaded unless the test says otherwise. */
const PAGE_LOADED_AT = '2026-10-03T12:00:00.000Z'
/** When the site a fake reader serves was published unless the test says otherwise. */
const SITE_PUBLISHED_AT = '2026-10-03T11:30:00.000Z'

/**
 * One element of the hand-written page the served Wiki script runs against in tests; it has only what that script uses.
 *
 * Text nodes are plain strings. Selectors are `*` or one compound per comma (tag, `#id`, `.class`, `[attribute]`, `[attribute=value]`); anything else throws, so an unsupported selector cannot pass as "not found" or match every element.
 * `insertBefore` refuses a reference that is not a child with the browser's `NotFoundError`, before it changes anything.
 *
 * @example
 * ```ts
 * const link = new PageElement('a', { class: 'wiki-update' }, ['Update LLM Wiki'])
 * link.matches('.wiki-update') // => true
 * ```
 */
class PageElement {
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, PageListener[]>()
  childNodes: PageNode[] = []
  parentNode: PageElement | null = null
  hidden = false
  /** How often the content of this element was written, so a test can tell a repeated announcement from one. */
  contentWriteCount = 0
  /** How often script moved focus here. */
  focusCount = 0

  constructor(
    readonly tagName: string,
    attributes: Record<string, string> = {},
    children: PageNode[] = [],
  ) {
    for (const [name, value] of Object.entries(attributes))
      this.attributes.set(name, value)
    for (const child of children) this.#adopt(child)
  }

  get className(): string {
    return this.attributes.get('class') ?? ''
  }
  set className(value: string) {
    this.attributes.set('class', value)
  }
  get id(): string {
    return this.attributes.get('id') ?? ''
  }
  set id(value: string) {
    this.attributes.set('id', value)
  }
  get textContent(): string {
    return this.childNodes
      .map((child) => (typeof child === 'string' ? child : child.textContent))
      .join('')
  }
  set textContent(value: string) {
    this.replaceChildren(...(value ? [value] : []))
  }
  get nextSibling(): PageNode | null {
    const siblings = this.parentNode?.childNodes ?? []
    return siblings[siblings.indexOf(this) + 1] ?? null
  }
  get isConnected(): boolean {
    return this.tagName === 'html' || Boolean(this.parentNode?.isConnected)
  }
  /** The element children, in order. */
  get children(): PageElement[] {
    return this.childNodes.filter((child) => child instanceof PageElement)
  }
  get childElementCount(): number {
    return this.children.length
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value))
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }
  addEventListener(type: string, listener: PageListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  focus(): void {
    this.focusCount += 1
  }
  getClientRects(): unknown[] {
    return [{}]
  }

  append(...nodes: PageNode[]): void {
    this.contentWriteCount += 1
    for (const node of nodes) this.#adopt(node)
  }
  appendChild(node: PageNode): void {
    this.append(node)
  }
  replaceChildren(...nodes: PageNode[]): void {
    this.contentWriteCount += 1
    for (const child of this.children) child.parentNode = null
    this.childNodes = []
    for (const node of nodes) this.#adopt(node)
  }
  insertBefore(node: PageNode, reference: PageNode | null): void {
    // A browser refuses a reference that is not a child before it changes anything.
    if (reference !== null && !this.childNodes.includes(reference))
      throw new DOMException(
        "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
        'NotFoundError',
      )
    this.contentWriteCount += 1
    this.#adopt(node)
    if (reference === null) return
    // The adopted node sits last; move it in front of its reference.
    this.childNodes.pop()
    this.childNodes.splice(this.childNodes.indexOf(reference), 0, node)
  }
  after(...nodes: PageNode[]): void {
    const reference = this.nextSibling
    for (const node of nodes) this.parentNode?.insertBefore(node, reference)
  }
  remove(): void {
    if (!this.parentNode) return
    this.parentNode.contentWriteCount += 1
    this.parentNode.childNodes = this.parentNode.childNodes.filter(
      (child) => child !== this,
    )
    this.parentNode = null
  }

  matches(selectorList: string): boolean {
    return selectorList.split(',').some((selector) => {
      const compound = selector.trim()
      if (compound === '*') return true
      const conditions = [...compound.matchAll(SUPPORTED_ATTRIBUTE_SELECTOR)]
      // Only the supported attribute forms are taken out: any other bracket group stays and is refused below.
      const simple = compound.replace(SUPPORTED_ATTRIBUTE_SELECTOR, '')
      if (!/^[\w-]*(?:[#.][\w-]+)*$/.test(simple))
        throw new Error(`The fake page cannot match the selector ${compound}`)
      const tagName = /^[\w-]+/.exec(simple)?.[0]
      const classNames = this.className.split(/\s+/)
      return (
        (!tagName || tagName === this.tagName) &&
        [...simple.matchAll(/#([\w-]+)/g)].every(
          (match) => match[1] === this.id,
        ) &&
        [...simple.matchAll(/\.([\w-]+)/g)].every(
          (match) => match[1] !== undefined && classNames.includes(match[1]),
        ) &&
        conditions.every(
          (match) =>
            match[1] !== undefined &&
            this.attributes.has(match[1]) &&
            (match[2] === undefined ||
              this.attributes.get(match[1]) === match[2]),
        )
      )
    })
  }
  querySelectorAll(selectorList: string): PageElement[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selectorList) ? [child] : []),
      ...child.querySelectorAll(selectorList),
    ])
  }
  querySelector(selectorList: string): PageElement | null {
    return this.querySelectorAll(selectorList)[0] ?? null
  }

  /** Puts a node last among the children, taking an element out of its old place first. */
  #adopt(node: PageNode): void {
    if (node instanceof PageElement) {
      node.remove()
      node.parentNode = this
    }
    this.childNodes.push(node)
  }
}

/** Which right rail the fake page starts with. */
export type FakeWikiPageLayout =
  /** A site published before Cycle 0044: the link, then the freshness label, no group, no placeholder. */
  | 'published-before-the-group'
  /** A site published from the current `reader-shell.html`: the group with label, link and offline placeholder. */
  | 'current-shell'
  /** A site whose rail has the update link and no freshness label. */
  | 'link-without-freshness-label'
  /** A page with neither the link nor the label. */
  | 'no-rail'

/** The fake reader behind the page: what its routes answer next. A test changes the fields between steps. */
export type FakeWikiReader = {
  updateStatus: WikiUpdateStatus
  /** When the site on disk was published (ISO timestamp); undefined answers like a reader whose manifest is missing. */
  sitePublishedAt: string | undefined
  freshness: WikiFreshness['status']
  /** When true every request fails the way a closed reader does. */
  isDown: boolean
  /** Paths requested so far, relative to the reader prefix. */
  requests: string[]
}

/** A loaded fake page: its elements, its reader and the test's hands on time and input. */
export type FakeWikiPage = {
  reader: FakeWikiReader
  body: PageElement
  /** First element matching the selector, or undefined. */
  find(selector: string): PageElement | undefined
  /** Whether the element is in the page and neither it nor an ancestor is hidden. */
  isShown(element: PageElement | undefined): boolean
  /** Text of every stylesheet the script injected. */
  injectedStyles(): string
  /** Clicks an element the way a learner does. @returns Whether the page swallowed the click. @throws When the element is undefined, so a selector that found nothing fails the test. */
  click(element: PageElement | undefined): Promise<{ wasSwallowed: boolean }>
  /** Moves the clock by exactly the time given and lets every timer and request due by then finish. */
  advance(milliseconds: number): Promise<void>
  /** Hides or shows the tab. */
  setTabHidden(isHidden: boolean): Promise<void>
  /** Gives the browser window focus. */
  focusWindow(): Promise<void>
  /** Timers the page is waiting on. */
  pendingTimerCount(): number
  /** How often the page reloaded itself. */
  reloadCount(): number
}

/** Builds the right rail of one layout. */
function buildRail(layout: FakeWikiPageLayout): PageElement[] {
  const link = new PageElement(
    'a',
    {
      class: 'wiki-update',
      href: 'vscode://laststance.codebook/update?root=%2Frepo',
    },
    ['Update LLM Wiki'],
  )
  const label = new PageElement(
    'p',
    { 'data-codebook-freshness': '', 'data-status': 'unknown' },
    ['Open from Codebook to check freshness'],
  )
  const outline = new PageElement('nav', { 'aria-label': 'On this page' })
  if (layout === 'no-rail') return []
  if (layout === 'link-without-freshness-label')
    return [new PageElement('aside', { class: 'right-rail' }, [link, outline])]
  if (layout === 'published-before-the-group')
    return [
      new PageElement('aside', { class: 'right-rail' }, [link, label, outline]),
    ]
  return [
    new PageElement('aside', { class: 'right-rail' }, [
      new PageElement('div', { 'data-codebook-update-group': '' }, [
        label,
        link,
        new PageElement('p', { 'data-codebook-update-status': '' }, [
          'Offline copy. Update progress shows in the editor, or here when this Wiki is opened from Codebook.',
        ]),
      ]),
      outline,
    ]),
  ]
}

/**
 * Loads the served Wiki page script into a hand-written page so a test can read what the learner would see.
 *
 * Why: the page script is served text, so its behaviour (polling, the held-back link, the status line) is only proven by running what the browser gets.
 * Trigger: page tests call it with the script from {@link readServedWikiScript}.
 *
 * Times the page prints are the UTC hour and minute, so expected sentences can be hard-coded.
 *
 * @param script - The served `codebook-qa.js`.
 * @param layout - Which right rail the page starts with.
 * @param reader - What the fake reader answers at load; idle, current, reachable and a site published half an hour before the page was loaded unless given.
 * @param loadedAt - When the page was loaded (ISO timestamp); the page clock starts there.
 * @returns The page after its first reads finished.
 *
 * @example
 * ```ts
 * const page = await openFakeWikiPage(script, 'current-shell')
 * await page.click(page.find('.wiki-update'))
 * await page.advance(2_000)
 * page.find('[data-codebook-update-status]')?.textContent
 * ```
 */
export async function openFakeWikiPage(
  script: string,
  layout: FakeWikiPageLayout,
  reader: Partial<Omit<FakeWikiReader, 'requests'>> = {},
  loadedAt: string = PAGE_LOADED_AT,
): Promise<FakeWikiPage> {
  const readerPrefix = '/w/fake-reader-token/'
  const pageReader: FakeWikiReader = {
    updateStatus: { state: 'idle' },
    sitePublishedAt: SITE_PUBLISHED_AT,
    freshness: 'current',
    isDown: false,
    ...reader,
    requests: [],
  }
  const clock = createManualClock()
  const pendingTimers = new Set<number>()
  const loadedAtMs = Date.parse(loadedAt)
  let elapsedMs = 0
  let reloads = 0

  const head = new PageElement('head')
  const body = new PageElement('body', {}, [
    new PageElement('header', { class: 'site-header' }, [
      new PageElement('div', { class: 'repo-meta' }),
    ]),
    ...buildRail(layout),
  ])
  const root = new PageElement('html', {}, [head, body])
  const documentListeners = new Map<string, PageListener[]>()
  const windowListeners = new Map<string, PageListener[]>()
  const listen =
    (listeners: Map<string, PageListener[]>) =>
    (type: string, listener: PageListener): void => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    }
  const document = {
    hidden: false,
    head,
    body,
    createElement: (tagName: string): PageElement => new PageElement(tagName),
    createTextNode: (text: string): string => text,
    querySelector: (selector: string): PageElement | null =>
      root.querySelector(selector),
    querySelectorAll: (selector: string): PageElement[] =>
      root.querySelectorAll(selector),
    addEventListener: listen(documentListeners),
  }
  const location = {
    pathname: `${readerPrefix}index.html`,
    reload: (): void => {
      reloads += 1
    },
  }
  /** Lets every request and promise the page started run to its end. */
  const settle = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve))
  const dispatch = async (
    listeners: PageListener[] | undefined,
  ): Promise<PageEvent> => {
    const event: PageEvent = {
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true
      },
    }
    for (const listener of listeners ?? []) listener(event)
    await settle()
    return event
  }

  runInNewContext(script, {
    document,
    location,
    window: {
      location,
      setTimeout: (callback: () => void, delayMs: number): number => {
        const id = clock.setTimeout(() => {
          pendingTimers.delete(id)
          callback()
        }, delayMs)
        pendingTimers.add(id)
        return id
      },
      clearTimeout: (id: number): void => {
        pendingTimers.delete(id)
        clock.clearTimeout(id)
      },
      addEventListener: listen(windowListeners),
    },
    performance: { timeOrigin: loadedAtMs },
    // The page reads the clock and formats times through Date; both follow the manual clock and UTC.
    Date: class PageDate extends Date {
      static override now(): number {
        return loadedAtMs + elapsedMs
      }
      override toLocaleTimeString(): string {
        return this.toISOString().slice(11, 16)
      }
    },
    MutationObserver: class {
      observe(): void {}
    },
    fetch: async (
      url: string,
    ): Promise<{ ok: boolean; json(): Promise<unknown> }> => {
      const route = url.slice(readerPrefix.length)
      pageReader.requests.push(route)
      if (pageReader.isDown) throw new TypeError('fetch failed')
      if (route === 'api/update-status')
        return {
          ok: true,
          json: async () => ({
            ...structuredClone(pageReader.updateStatus),
            sitePublishedAt: pageReader.sitePublishedAt,
          }),
        }
      if (route === 'api/freshness')
        return {
          ok: true,
          json: async () => ({
            status: pageReader.freshness,
            changedPaths: [],
            addedPaths: [],
          }),
        }
      return { ok: false, json: async () => ({ error: 'Unknown route.' }) }
    },
  })
  await settle()

  return {
    reader: pageReader,
    body,
    find: (selector) => root.querySelector(selector) ?? undefined,
    isShown(element) {
      for (let node = element ?? null; node; node = node.parentNode)
        if (node.hidden) return false
      return Boolean(element?.isConnected)
    },
    injectedStyles: () =>
      head
        .querySelectorAll('style')
        .map((style) => style.textContent)
        .join('\n'),
    async click(element) {
      // A click on nothing dispatches nothing, which would read as a click the page did not swallow.
      if (!element)
        throw new Error(
          'The fake page has no element to click: the selector found nothing in this layout.',
        )
      const event = await dispatch(element.listeners.get('click'))
      return { wasSwallowed: event.defaultPrevented }
    },
    async advance(milliseconds): Promise<void> {
      // Each step may start a request whose answer sets the next timer, so the page settles between steps.
      for (let stepped = 0; stepped < milliseconds; stepped += CLOCK_STEP_MS) {
        const stepMs = Math.min(CLOCK_STEP_MS, milliseconds - stepped)
        elapsedMs += stepMs
        clock.advance(stepMs)
        await settle()
      }
    },
    async setTabHidden(isHidden): Promise<void> {
      document.hidden = isHidden
      await dispatch(documentListeners.get('visibilitychange'))
    },
    async focusWindow(): Promise<void> {
      await dispatch(windowListeners.get('focus'))
    },
    pendingTimerCount: () => pendingTimers.size,
    reloadCount: () => reloads,
  }
}
