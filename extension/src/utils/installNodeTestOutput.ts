import type { NodeTestApplicationView } from './projectNodeTestApplication'

/** The fixed words the document's script needs; passed in, as the script imports nothing. */
export type NodeTestOutputText = {
  stderrMark: string
}

/** The message the Study workspace posts to the Application pane for each later event of the same test replay. */
export type NodeTestOutputUpdate = {
  type: 'node-history-output'
  generation: number
  view: NodeTestApplicationView
}

/**
 * Applies each later event of a test replay to the Application pane's one document in place (EN3), so moving through the replay never reloads the page: unchanged lines keep their nodes, so the learner's text selection, the scroll position and the keyboard focus survive, and an update older than the one shown is ignored. It follows the latest output until the learner scrolls up, and `Jump to latest` follows again (DS20); called by the document {@link capturedAppHtml} writes, serialized with `toString()`, so it imports nothing.
 * The follow state is kept in the webview's state, so a document written again from the restore copy keeps it.
 * @param api - The webview's API.
 * @param generation - The generation of the view the document was written with.
 * @param text - The fixed words it needs.
 * @example installNodeTestOutput(acquireVsCodeApi(), 3, { stderrMark: '[stderr] ' })
 */
export function installNodeTestOutput(
  api: {
    getState(): unknown
    setState(state: unknown): void
  },
  generation: number,
  text: NodeTestOutputText,
): void {
  const element = (id: string): HTMLElement => {
    const found = document.getElementById(id)
    if (!found) throw new Error(`Test output element ${id} is missing.`)
    return found
  }
  const output = element('test-output'),
    jump = element('test-output-jump')
  const saved = api.getState()
  let shown = generation,
    follow =
      typeof saved === 'object' &&
      saved !== null &&
      'testOutputFollow' in saved &&
      typeof saved.testOutputFollow === 'boolean'
        ? saved.testOutputFollow
        : true,
    scrolledByDocument = false
  const remember = (): void => {
    const state = api.getState()
    api.setState({
      ...(typeof state === 'object' && state !== null ? state : {}),
      testOutputFollow: follow,
    })
  }
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
      mark.textContent = text.stderrMark
      node.append(mark)
    }
    const body = document.createElement('span')
    body.className = 'output-text'
    body.textContent = view.text
    node.append(body, '\n')
    return node
  }
  const atEnd = (): boolean =>
    output.scrollHeight - output.scrollTop - output.clientHeight <= 2
  const toEnd = (): void => {
    scrolledByDocument = true
    // Instant, never smooth: the learner's reduced-motion choice needs no separate path.
    output.scrollTop = output.scrollHeight
  }
  /** Removes the lines a view no longer holds. */
  const dropLinesNotIn = (lines: NodeTestApplicationView['lines']): void => {
    const wanted = new Set(lines.map((value) => value.number))
    for (const node of Array.from(output.children))
      if (
        !(node instanceof HTMLElement) ||
        !wanted.has(Number(node.dataset.line))
      )
        node.remove()
  }
  /** Places one line after the line before it: lines are matched by their number, so an unchanged line keeps its node and a selection or focus inside it survives; a changed line is replaced and a new one inserted. */
  const placeLine = (
    value: NodeTestApplicationView['lines'][number],
    previous: Element | undefined,
  ): Element => {
    const node = output.querySelector<HTMLElement>(
      `.output-line[data-line="${value.number}"]`,
    )
    const kept =
      node?.dataset.channel === value.channel &&
      (node.dataset.cut === 'true') === Boolean(value.cut) &&
      node.querySelector('.output-text')?.textContent === value.text
    if (kept && node) return node
    const placed = lineNode(value)
    if (node) node.replaceWith(placed)
    else if (previous) previous.after(placed)
    else output.prepend(placed)
    return placed
  }
  /** Brings the output region's lines to a view's in place. */
  const placeLines = (lines: NodeTestApplicationView['lines']): void => {
    dropLinesNotIn(lines)
    let previous: Element | undefined
    for (const value of lines) previous = placeLine(value, previous)
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
    placeLines(view.lines)
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
    remember()
  })
  jump.addEventListener('click', () => {
    follow = true
    remember()
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
    },
  )
  if (follow) toEnd()
  jump.hidden = follow
}
