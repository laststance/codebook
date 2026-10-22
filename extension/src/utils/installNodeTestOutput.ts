import type { NodeTestApplicationView } from './projectNodeTestApplication'

/** What the document's script needs from the host; passed in, as the script imports nothing. */
export type NodeTestOutputOptions = {
  /** Starts a line the test wrote to standard error. */
  stderrMark: string
  /** The test replay the document shows; the learner's follow choice belongs to it (DS20). */
  history: string
  /** How close to its end the output region counts as at its end. */
  endTolerancePx: number
  /** At most how often the document writes its state; the writes in between are joined into one. */
  stateWriteIntervalMs: number
}

/** The message the Study workspace posts to the Application pane for each later event of the same test replay. */
export type NodeTestOutputUpdate = {
  type: 'node-history-output'
  generation: number
  view: NodeTestApplicationView
}

/**
 * Applies each later event of a test replay to the Application pane's one document in place (EN3), so moving through the replay never reloads the page: unchanged lines keep their nodes, so the learner's text selection, the scroll position and the keyboard focus survive, and an update older than the one shown is ignored. It follows the latest output until the learner scrolls up, and `Jump to latest` follows again (DS20); called by the document {@link testOutputHtml} writes, serialized with `toString()`, so it imports nothing.
 * The follow choice and the latest moment's view are kept in the webview's state with the replay they belong to: a document of the same replay that the editor loads again in the same panel (moved to another window, webviews reloaded) keeps the learner's choice and shows the latest moment. A replacement panel starts with an empty state, so the restore copy written into it starts following, as another replay's document does. The state is written at most once per interval while moments stream in, and when the document is left.
 * @param api - The webview's API.
 * @param generation - The generation of the view the document was written with.
 * @param options - The stderr mark, the shown replay, the end tolerance and the interval of state writes.
 * @example installNodeTestOutput(acquireVsCodeApi(), 3, { stderrMark: '[stderr] ', history: 'study_1', endTolerancePx: 2, stateWriteIntervalMs: 500 })
 */
export function installNodeTestOutput(
  api: {
    getState(): unknown
    setState(state: unknown): void
  },
  generation: number,
  options: NodeTestOutputOptions,
): void {
  const element = (id: string): HTMLElement => {
    const found = document.getElementById(id)
    if (!found) throw new Error(`Test output element ${id} is missing.`)
    return found
  }
  const output = element('test-output'),
    jump = element('test-output-jump')
  /** The webview's state as an object, or none. */
  const savedState = (): Record<string, unknown> | undefined => {
    const state: unknown = api.getState()
    return typeof state === 'object' && state !== null
      ? { ...state }
      : undefined
  }
  /** What this document kept of its own replay before the editor loaded it again (moved to another window, webviews reloaded): the follow choice and the latest moment's view; another replay's state does not carry over (DS20). */
  const keptState = (): {
    follow: boolean
    view: NodeTestApplicationView | undefined
  } => {
    const state = savedState()
    if (state?.testOutputHistory !== options.history)
      return { follow: true, view: undefined }
    const view = state.testOutputView
    return {
      follow:
        typeof state.testOutputFollow === 'boolean'
          ? state.testOutputFollow
          : true,
      // The kept view is this document's own earlier update, which it wrote into its state itself.
      view:
        typeof view === 'object' &&
        view !== null &&
        'generation' in view &&
        typeof view.generation === 'number'
          ? (view as NodeTestApplicationView)
          : undefined,
    }
  }
  const kept = keptState()
  let shown = generation,
    follow = kept.follow,
    scrolledByDocument = false,
    latestView: NodeTestApplicationView | null = null,
    writeTimer: ReturnType<typeof setTimeout> | undefined,
    writeDue = false
  /** Writes the follow choice and the latest moment's view with the replay they belong to, so the document the editor loads again shows them. */
  const writeState = (): void => {
    writeDue = false
    api.setState({
      ...savedState(),
      testOutputFollow: follow,
      testOutputHistory: options.history,
      testOutputView: latestView,
    })
  }
  /** Writes the state now, or once the interval since the last write ends: each write copies the whole shown output, and Play posts up to twenty moments a second. */
  const remember = (): void => {
    if (writeTimer !== undefined) {
      writeDue = true
      return
    }
    writeState()
    writeTimer = setTimeout(() => {
      writeTimer = undefined
      // The moments that came during the interval are written as one.
      if (writeDue) remember()
    }, options.stateWriteIntervalMs)
  }
  // A document that is left (moved to another window, webviews reloaded) writes the moment it shows before it goes.
  window.addEventListener('pagehide', () => {
    if (writeDue) writeState()
  })
  /** Shows a muted line with its text, or leaves it out without text. */
  const line = (id: string, value: string | undefined): void => {
    const target = element(id)
    target.textContent = value ?? ''
    target.hidden = value === undefined
  }
  /** Makes the node of one output line: the `[stderr] ` mark for a standard-error line that is not cut, its text and a line feed, all as text. */
  const lineNode = (
    view: NodeTestApplicationView['lines'][number],
  ): HTMLSpanElement => {
    const node = document.createElement('span')
    node.className = 'output-line'
    node.dataset.line = String(view.number)
    node.dataset.channel = view.channel
    if (view.cut) node.dataset.cut = 'true'
    if (view.channel === 'stderr' && !view.cut) {
      const mark = document.createElement('span')
      mark.className = 'stderr-mark'
      mark.textContent = options.stderrMark
      node.append(mark)
    }
    const body = document.createElement('span')
    body.className = 'output-text'
    body.textContent = view.text
    node.append(body, '\n')
    return node
  }
  const atEnd = (): boolean =>
    output.scrollHeight - output.scrollTop - output.clientHeight <=
    options.endTolerancePx
  const toEnd = (): void => {
    scrolledByDocument = true
    // Instant, never smooth: the learner's reduced-motion choice needs no separate path.
    output.scrollTop = output.scrollHeight
  }
  /** Removes the lines a view no longer holds and lists the kept ones by their number, so each line is found without searching the whole output. */
  const keptLines = (
    lines: NodeTestApplicationView['lines'],
  ): Map<number, HTMLElement> => {
    const wanted = new Set(lines.map((value) => value.number)),
      kept = new Map<number, HTMLElement>()
    for (const node of Array.from(output.children))
      if (node instanceof HTMLElement && wanted.has(Number(node.dataset.line)))
        kept.set(Number(node.dataset.line), node)
      else node.remove()
    return kept
  }
  /** Places one line after the line before it: lines are matched by their number, so an unchanged line keeps its node and a selection or focus inside it survives; a changed line is replaced and a new one inserted. */
  const placeLine = (
    value: NodeTestApplicationView['lines'][number],
    node: HTMLElement | undefined,
    previous: Element | undefined,
  ): Element => {
    const unchanged =
      node?.dataset.channel === value.channel &&
      (node.dataset.cut === 'true') === Boolean(value.cut) &&
      node.querySelector('.output-text')?.textContent === value.text
    if (unchanged && node) return node
    const placed = lineNode(value)
    if (node) node.replaceWith(placed)
    else if (previous) previous.after(placed)
    else output.prepend(placed)
    return placed
  }
  /** Brings the output region's lines to a view's in place, in time linear in the lines. */
  const placeLines = (lines: NodeTestApplicationView['lines']): void => {
    const kept = keptLines(lines)
    let previous: Element | undefined
    for (const value of lines)
      previous = placeLine(value, kept.get(value.number), previous)
  }
  const apply = (view: NodeTestApplicationView): void => {
    document.title = view.name
    element('test-output-main').setAttribute('aria-label', view.name)
    element('test-output-time').textContent = view.time ?? ''
    const test = element('test-output-test')
    test.textContent = view.test
    test.title = view.test
    output.setAttribute('aria-label', view.region ?? view.name)
    line('test-output-inspector', view.inspector)
    line('test-output-cut', view.cut)
    line('test-output-placeholder', view.placeholder)
    line('test-output-end', view.end)
    const scrollTopBefore = output.scrollTop
    placeLines(view.lines)
    // A shorter output clamps the scroll position: that scroll is the document's, never the learner's return to the end (DS20).
    if (output.scrollTop !== scrollTopBefore) scrolledByDocument = true
    if (follow) toEnd()
    jump.hidden = follow
  }
  output.addEventListener('scroll', () => {
    // The document's own scroll to the end is no choice of the learner's.
    if (scrolledByDocument) {
      scrolledByDocument = false
      return
    }
    const following = atEnd()
    if (following === follow) return
    follow = following
    jump.hidden = follow
    // The learner's own choice is written at once; only the stream of moments is joined.
    writeState()
  })
  jump.addEventListener('click', () => {
    follow = true
    writeState()
    toEnd()
    jump.hidden = true
    // The button leaves the page, so the keyboard stays in the output it led to.
    output.focus()
  })
  window.addEventListener(
    'message',
    (event: MessageEvent<Partial<NodeTestOutputUpdate> | null>) => {
      const data = event.data
      if (
        data?.type !== 'node-history-output' ||
        typeof data.generation !== 'number' ||
        !data.view
      )
        return
      // An update older than the one shown came late: the newer selection stands.
      if (data.generation < shown) return
      shown = data.generation
      apply(data.view)
      latestView = data.view
      remember()
    },
  )
  // A document loaded again from its first write shows the latest moment it had received, not the moment it was written with.
  if (kept.view && kept.view.generation > generation) {
    latestView = kept.view
    shown = kept.view.generation
    apply(kept.view)
    return
  }
  if (follow) toEnd()
  jump.hidden = follow
}
