import { runInNewContext } from 'node:vm'

import type { WikiFreshness } from '../../utils/inspectDeepWikiFreshness'
import type { WikiUpdateStatus } from '../../utils/wikiUpdateRun'

import { createManualClock } from './createManualClock'

type PageEvent = {
  defaultPrevented: boolean
  preventDefault(): void
  /** Keeps the listeners after this one from running, as a browser's `stopImmediatePropagation` does. */
  stopImmediatePropagation(): void
}
type PageListener = (event: PageEvent) => void
type PageNode = PageElement | string

/** How long one step of {@link FakeWikiPage.advance} is at most; the last step of an advance is cut to what is left of it. */
const CLOCK_STEP_MS = 1_000
/** The two attribute forms {@link PageElement.matches} understands, `[attribute]` and `[attribute=value]` (the value with or without quotes); a bracket group of any other form, such as one with an operator, is refused. */
const SUPPORTED_ATTRIBUTE_SELECTOR = /\[([\w-]+)(?:="?([^"\]]*)"?)?\]/g
/** The month names the fake page prints, so a printed date does not depend on the locale data of the Node that runs the test. */
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
/** When a fake page is loaded unless the test says otherwise. */
const PAGE_LOADED_AT = '2026-10-03T12:00:00.000Z'
/** When the site a fake reader serves was published unless the test says otherwise. */
const SITE_PUBLISHED_AT = '2026-10-03T11:30:00.000Z'
/** The publication a fake page is served from and its reader answers unless the test says otherwise. */
const PUBLICATION_AT_LOAD = 'publication-at-load'
/** What the fake reader answers a question with unless the test says otherwise: an answer with one citation. */
const QUESTION_ANSWER: FakeWikiQuestionAnswer = {
  answer: 'The order is created in src/order.ts.',
  citations: [
    {
      path: 'src/order.ts',
      line: 3,
      uri: 'vscode://laststance.codebook/source?root=%2Frepo&path=src%2Forder.ts&line=3',
    },
  ],
  sourceChanged: false,
}

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
  /** Whether a `details` element is open; a closed one draws its summary alone. */
  open = false
  /** The text of a `textarea` or an `input`. */
  value = ''
  /** The inline style a script set, by property name. */
  readonly style: Record<string, string> = {}
  /** How often the content of this element was written, so a test can tell a repeated announcement from one. */
  contentWriteCount = 0
  /** How often an attribute of this element was set or removed, so a test can tell a repeated write from one; a browser's observers see every `setAttribute`, also with the value the attribute already has. */
  attributeWriteCount = 0
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
  get firstChild(): PageNode | null {
    return this.childNodes[0] ?? null
  }
  get nextSibling(): PageNode | null {
    const siblings = this.parentNode?.childNodes ?? []
    return siblings[siblings.indexOf(this) + 1] ?? null
  }
  get isConnected(): boolean {
    return this.tagName === 'html' || Boolean(this.parentNode?.isConnected)
  }
  /** The classes of the element as a browser's `classList` reads and changes them. */
  get classList(): {
    contains(name: string): boolean
    add(name: string): void
    remove(name: string): void
  } {
    const names = (): string[] => this.className.split(/\s+/).filter(Boolean)
    return {
      contains: (name) => names().includes(name),
      add: (name): void => {
        if (!names().includes(name))
          this.className = [...names(), name].join(' ')
      },
      remove: (name): void => {
        this.className = names()
          .filter((candidate) => candidate !== name)
          .join(' ')
      },
    }
  }
  /** The label elements of the page that name a `textarea` or an `input` by its id; `null` for any other element, which no label names. */
  get labels(): PageElement[] | null {
    if (this.tagName !== 'textarea' && this.tagName !== 'input') return null
    let root: PageElement = this
    while (root.parentNode) root = root.parentNode
    return this.id
      ? root
          .querySelectorAll('label')
          .filter((label) => label.getAttribute('for') === this.id)
      : []
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
    this.attributeWriteCount += 1
    this.attributes.set(name, String(value))
  }
  removeAttribute(name: string): void {
    // Removing an attribute the element does not have changes nothing, as in a browser.
    if (this.attributes.delete(name)) this.attributeWriteCount += 1
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
  contains(node: PageNode | null): boolean {
    for (
      let ancestor = node instanceof PageElement ? node : null;
      ancestor;
      ancestor = ancestor.parentNode
    )
      if (ancestor === this) return true
    return false
  }
  closest(selectorList: string): PageElement | null {
    for (let node: PageElement | null = this; node; node = node.parentNode)
      if (node.matches(selectorList)) return node
    return null
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

/** What the fake reader answers a question of the page's form with: an answer with its citations, the sentence of a question handed over to the editor's chat, or a refusal, which the reader answers with an error status and its reason. */
export type FakeWikiQuestionAnswer =
  | {
      answer: string
      citations: { path: string; line: number; uri: string }[]
      sourceChanged: boolean
    }
  | { handoff: string }
  | { error: string }

/** Which question form the fake page carries in its reading column. */
export type FakeWikiPageComposer =
  /** The form of every Wiki published before Cycle 0046 D2 (`scripts/fixtures/reader-shell-0.2.29.0.txt`): the question row, then the hidden disclosure that holds the answer's status region. */
  | 'published-before-the-question-status'
  /** The form of the current `reader-shell.html`: the question row, the empty question status line, then the hidden disclosure that holds the answer's status region. */
  | 'current-shell'

/** The fake reader behind the page: what its routes answer next. A test changes the fields between steps. */
export type FakeWikiReader = {
  updateStatus: WikiUpdateStatus
  /** When the site on disk was published (ISO timestamp); undefined answers like a reader whose manifest is missing. */
  sitePublishedAt: string | undefined
  /** Which publication is on disk; undefined answers like a folder without a publisher's receipt. */
  publication: string | undefined
  /** The reader's source-change stamp; a test raises it when a file of the project changed. */
  sourceChangeStamp: number
  freshness: WikiFreshness['status']
  /** What the freshness answer carries beside its status: the reason of an undecided check, or that added files were not checked. */
  freshnessDetail: Partial<
    Pick<WikiFreshness, 'reason' | 'addedFilesUnchecked'>
  >
  /** When true the freshness route answers an error while the update state is still answered. */
  isFreshnessFailing: boolean
  /** When true every request fails the way a closed reader does. */
  isDown: boolean
  /** What the question route answers. */
  questionAnswer: FakeWikiQuestionAnswer
  /** Paths requested so far, relative to the reader prefix. */
  requests: string[]
}

/** How a fake page itself was loaded, as opposed to what its reader answers. */
export type FakeWikiPageLoad = {
  /** When the page was loaded by the host's clock (ISO timestamp); the page clock starts there. */
  loadedAt?: string
  /** How far the browser's clock runs ahead of the host's (ms); none when omitted. */
  browserClockAheadMs?: number
  /** The publication the reader wrote into the page's HTML; `null` for a site that had none. The one the fake reader answers at load when omitted. */
  publication?: string | null
  /** Routes whose first answer is kept back from the load on, until `release(route)`. */
  heldAtLoad?: string[]
  /** The query of the address the page was opened at, with its question mark; none when omitted. */
  search?: string
  /** Whether the window's `load` event has already passed when the page script runs, as on a page whose script was added late; a page script normally runs before it, which is the case when omitted. */
  isLoadedBeforeTheScript?: boolean
  /** The ids of headings the article's own content carries, in their order; none when omitted. A page published before the publisher kept such ids apart from the reader's may carry an id of the reader there. */
  articleHeadingIds?: string[]
  /** The question form below the article, with the shell's theme button in the header; neither when omitted. */
  composer?: FakeWikiPageComposer
}

/** A loaded fake page: its elements, its reader and the test's hands on time and input. */
export type FakeWikiPage = {
  reader: FakeWikiReader
  /** Keeps the answer to the next request of one route back until `release(route)`; the answer is what the reader knew when the request arrived. */
  holdNext(route: string): void
  /** Delivers the held answer of one route and lets the page take it in. @throws When no answer of the route is held back, or when the page has not asked for the route since the hold: a release before the request would state an order that never happened. */
  release(route: string): Promise<void>
  body: PageElement
  /** First element matching the selector, or undefined. */
  find(selector: string): PageElement | undefined
  /** Whether the element is in the page and neither it nor an ancestor is hidden. */
  isShown(element: PageElement | undefined): boolean
  /** Text of every stylesheet the script injected. */
  injectedStyles(): string
  /** Clicks an element the way a learner does. @returns Whether the page swallowed the click. @throws When the element is undefined, so a selector that found nothing fails the test. */
  click(element: PageElement | undefined): Promise<{ wasSwallowed: boolean }>
  /** Types a question into the page's form and submits it the way the learner's press of Ask Codebook does, then lets every request the page started and that is not held back finish. @returns Whether the page kept the browser from submitting the form itself. @throws When the page has no question form. */
  ask(question: string): Promise<{ wasSubmissionPrevented: boolean }>
  /** Moves the clock by exactly the time given and lets every timer and request due by then finish. */
  advance(milliseconds: number): Promise<void>
  /** Hides or shows the tab. */
  setTabHidden(isHidden: boolean): Promise<void>
  /** Gives the browser window focus. */
  focusWindow(): Promise<void>
  /** The page's address as it stands now: path and query. */
  address(): string
  /** The document's title as it stands now; a fake page starts as "Overview · sample DeepWiki". */
  title(): string
  /** Ends the loading of the page: the document becomes complete and the window's `load` event fires once. @throws When the page has already loaded, so a test cannot state a second `load` a browser never fires. */
  finishLoading(): Promise<void>
  /** Timers the page is waiting on. */
  pendingTimerCount(): number
  /** How often the page reloaded itself. */
  reloadCount(): number
}

/** Builds the question form of one composer, as the shell writes it, and the connection note after it. */
function buildComposer(composer: FakeWikiPageComposer): PageElement {
  return new PageElement(
    'section',
    { class: 'composer', 'aria-label': 'Repository questions' },
    [
      new PageElement('form', { id: 'qa-form' }, [
        new PageElement('label', { for: 'qa-input', class: 'sr-only' }, [
          'Ask about this repository',
        ]),
        new PageElement('div', { class: 'question-row' }, [
          new PageElement('textarea', {
            id: 'qa-input',
            name: 'question',
            rows: '1',
            required: '',
            placeholder: 'Ask about this repository…',
          }),
          new PageElement('button', { type: 'submit' }, ['Ask Codebook']),
        ]),
        ...(composer === 'current-shell'
          ? [
              new PageElement('p', {
                class: 'qa-status',
                role: 'status',
                'aria-live': 'polite',
                'data-codebook-question-status': '',
              }),
            ]
          : []),
        Object.assign(
          new PageElement(
            'details',
            { id: 'qa-response', class: 'answer-disclosure' },
            [
              new PageElement('summary', {}, ['Answer and source citations']),
              new PageElement('div', {
                class: 'qa-answer',
                role: 'status',
                'aria-live': 'polite',
                tabindex: '0',
              }),
            ],
          ),
          { hidden: true },
        ),
      ]),
      new PageElement('details', { class: 'connection' }, [
        new PageElement('summary', {}, [
          new PageElement(
            'span',
            { class: 'unavailable', 'data-codebook-status': '' },
            ['Offline reader · connection help'],
          ),
        ]),
        new PageElement('p', {}, [
          'Read these pages offline. Open this Wiki through Codebook: Open LLM Wiki in Browser to ask the editor model. No app or debugger is needed.',
        ]),
      ]),
    ],
  )
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
 * Times the page prints are the UTC hour and minute, and dates the UTC day and short month ("2 Oct"), so expected sentences can be hard-coded.
 *
 * @param script - The served `codebook-qa.js`.
 * @param layout - Which right rail the page starts with.
 * @param reader - What the fake reader answers at load; idle, current, reachable and a site published half an hour before the page was loaded unless given.
 * @param load - How the page itself was loaded: when, with which browser clock and from which publication.
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
  load: FakeWikiPageLoad = {},
): Promise<FakeWikiPage> {
  const readerPrefix = '/w/fake-reader-token/'
  const pageReader: FakeWikiReader = {
    updateStatus: { state: 'idle' },
    sitePublishedAt: SITE_PUBLISHED_AT,
    publication: PUBLICATION_AT_LOAD,
    sourceChangeStamp: 0,
    freshness: 'current',
    freshnessDetail: {},
    isFreshnessFailing: false,
    isDown: false,
    questionAnswer: QUESTION_ANSWER,
    ...reader,
    requests: [],
  }
  const clock = createManualClock()
  const pendingTimers = new Set<number>()
  // The browser's clock: the host's time of the load plus what the browser runs ahead.
  const loadedAtMs =
    Date.parse(load.loadedAt ?? PAGE_LOADED_AT) +
    (load.browserClockAheadMs ?? 0)
  const pagePublication =
    load.publication === undefined ? PUBLICATION_AT_LOAD : load.publication
  /** The routes whose next answer a test keeps back, each with the promise its request waits on and the function that settles it. A route stays in `heldRequests` until the page's request for it arrives. */
  const heldRequests = new Map<string, Promise<void>>()
  const heldReleases = new Map<string, () => void>()
  const holdNext = (route: string): void => {
    heldRequests.set(
      route,
      new Promise<void>((resolveHold) => {
        heldReleases.set(route, resolveHold)
      }),
    )
  }
  for (const route of load.heldAtLoad ?? []) holdNext(route)
  let reloads = 0

  const head = new PageElement('head')
  const body = new PageElement('body', {}, [
    new PageElement('header', { class: 'site-header' }, [
      new PageElement(
        'div',
        { class: 'repo-meta' },
        load.composer
          ? [
              new PageElement(
                'button',
                {
                  type: 'button',
                  id: 'theme-toggle',
                  'aria-label': 'Switch to dark theme',
                },
                ['Dark theme'],
              ),
            ]
          : [],
      ),
    ]),
    new PageElement('main', { class: 'reading-column' }, [
      new PageElement('article', { class: 'wiki-article' }, [
        new PageElement('h1', { id: 'article-title' }, ['Overview']),
        ...(load.articleHeadingIds ?? []).map(
          (id) => new PageElement('h2', { id }, [`Section ${id}`]),
        ),
      ]),
      ...(load.composer ? [buildComposer(load.composer)] : []),
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
    // The title the publisher gives the overview of a project folder named "sample".
    title: 'Overview · sample DeepWiki',
    // A page script runs while its document is still loading, unless the test says the load has passed.
    readyState: load.isLoadedBeforeTheScript ? 'complete' : 'loading',
    head,
    body,
    createElement: (tagName: string): PageElement => new PageElement(tagName),
    createTextNode: (text: string): string => text,
    // The script tag the reader added to the page; it carries the publication the page was served from.
    currentScript: {
      getAttribute: (name: string): string | null =>
        name === 'data-codebook-publication' ? pagePublication : null,
    },
    querySelector: (selector: string): PageElement | null =>
      root.querySelector(selector),
    querySelectorAll: (selector: string): PageElement[] =>
      root.querySelectorAll(selector),
    // The first element with the id, as a browser answers it; an id the selector syntax cannot name finds nothing.
    getElementById: (id: string): PageElement | null =>
      /^[\w-]+$/.test(id) ? root.querySelector(`#${id}`) : null,
    addEventListener: listen(documentListeners),
  }
  const location = {
    pathname: `${readerPrefix}index.html`,
    search: load.search ?? '',
    hash: '',
    reload: (): void => {
      reloads += 1
    },
  }
  const history = {
    // The page rewrites its own address; only path and query are kept.
    replaceState(_state: unknown, _title: string, address: string): void {
      const [pathname = '', query] = address.split('?')
      location.pathname = pathname
      location.search = query === undefined ? '' : `?${query}`
    },
  }
  /** Lets every request and promise the page started run to its end. */
  const settle = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve))
  /** What the fake reader answers at one route right now. */
  const answerRoute = (
    route: string,
  ): { ok: boolean; json(): Promise<unknown> } => {
    if (route === 'api/update-status') {
      const answer = {
        ...structuredClone(pageReader.updateStatus),
        sitePublishedAt: pageReader.sitePublishedAt,
        publication: pageReader.publication,
        sourceChangeStamp: pageReader.sourceChangeStamp,
      }
      return { ok: true, json: async () => answer }
    }
    if (route === 'api/ask') {
      const answer = structuredClone(pageReader.questionAnswer)
      return { ok: !('error' in answer), json: async () => answer }
    }
    if (route === 'api/freshness' && !pageReader.isFreshnessFailing) {
      const answer = {
        status: pageReader.freshness,
        changedPaths: [],
        addedPaths: [],
        ...pageReader.freshnessDetail,
      }
      return { ok: true, json: async () => answer }
    }
    return { ok: false, json: async () => ({ error: 'Unknown route.' }) }
  }
  const dispatch = async (
    listeners: PageListener[] | undefined,
  ): Promise<PageEvent> => {
    let isStopped = false
    const event: PageEvent = {
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true
      },
      stopImmediatePropagation() {
        isStopped = true
      },
    }
    for (const listener of listeners ?? []) {
      listener(event)
      if (isStopped) break
    }
    await settle()
    return event
  }

  runInNewContext(script, {
    document,
    location,
    history,
    URLSearchParams,
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
      // The manual clock stands at a timer's own due time while its callback runs, so a callback reads the time it was due at.
      static override now(): number {
        return loadedAtMs + clock.now()
      }
      override toLocaleTimeString(): string {
        return this.toISOString().slice(11, 16)
      }
      // Day and month, and the whole date for comparing two days, follow UTC like the time.
      override toLocaleDateString(): string {
        return `${this.getUTCDate()} ${SHORT_MONTHS[this.getUTCMonth()]}`
      }
      override toDateString(): string {
        return this.toISOString().slice(0, 10)
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
      // The answer is what the reader knows when the request arrives; a held request delivers it later.
      const answer = answerRoute(route)
      const hold = heldRequests.get(route)
      if (hold) {
        heldRequests.delete(route)
        await hold
      }
      return answer
    },
  })
  await settle()

  return {
    reader: pageReader,
    holdNext,
    async release(route): Promise<void> {
      const release = heldReleases.get(route)
      if (!release)
        throw new Error(`The fake page holds no answer of ${route} back.`)
      // The hold is still waiting for its request: nothing was kept back yet, and the hold stays for a request that comes later.
      if (heldRequests.has(route))
        throw new Error(
          `The fake page has not asked for ${route} since its answer was to be held back, so there is no answer to release.`,
        )
      heldReleases.delete(route)
      release()
      await settle()
    },
    body,
    find: (selector) => root.querySelector(selector) ?? undefined,
    isShown(element) {
      for (let node = element ?? null; node; node = node.parentNode) {
        if (node.hidden) return false
        // A closed disclosure draws its summary alone, so nothing else it holds is in the page for the learner or assistive technology.
        if (
          node.parentNode?.tagName === 'details' &&
          !node.parentNode.open &&
          node.tagName !== 'summary'
        )
          return false
      }
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
    async ask(question) {
      const form = root.querySelector('form#qa-form')
      const field = form?.querySelector('textarea')
      if (!form || !field)
        throw new Error(
          'The fake page has no question form: open it with a composer.',
        )
      field.value = question
      const event = await dispatch(form.listeners.get('submit'))
      return { wasSubmissionPrevented: event.defaultPrevented }
    },
    async advance(milliseconds): Promise<void> {
      // Each step may start a request whose answer sets the next timer, so the page settles between steps.
      for (let stepped = 0; stepped < milliseconds; stepped += CLOCK_STEP_MS) {
        const stepMs = Math.min(CLOCK_STEP_MS, milliseconds - stepped)
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
    address: () => location.pathname + location.search,
    title: () => document.title,
    async finishLoading(): Promise<void> {
      if (document.readyState === 'complete')
        throw new Error(
          'The fake page has already loaded: a window fires its load event once.',
        )
      document.readyState = 'complete'
      await dispatch(windowListeners.get('load'))
    },
    pendingTimerCount: () => pendingTimers.size,
    reloadCount: () => reloads,
  }
}
