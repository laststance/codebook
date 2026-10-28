import type { NodeTestApplicationView } from './projectNodeTestApplication'

/** Where the learner reads in the output region: the number of the first line in view and how far its top is above the region's top, so the same place is found again in a document written later (EN3). */
export type NodeTestOutputAnchor = {
  line: number
  offsetPx: number
}

/** What the host keeps of the learner's reading of one test replay's output (D22): the follow choice and the scroll anchor. */
export type NodeTestOutputReading = {
  follow: boolean
  anchor?: NodeTestOutputAnchor
}

/** What the document's script needs from the host; passed in, as the script imports nothing. */
export type NodeTestOutputOptions = {
  /** Starts a line the test wrote to standard error. */
  stderrMark: string
  /** The test replay the document shows; the host files the learner's reading under it (DS20). */
  history: string
  /** How close to its end the output region counts as at its end. */
  endTolerancePx: number
  /** At most how often the document reports the learner's scroll anchor to the host; the reports in between are joined into one. */
  stateReportIntervalMs: number
  /** The first view, drawn by the same code that draws every later one (F136). */
  view: NodeTestApplicationView
  /** The learner's reading of this replay as the host keeps it: a new document takes it, never state an earlier document left (D22). */
  reading: NodeTestOutputReading
}

/** The message the Study workspace posts to the Application pane for each later event of the same test replay; the answer to the document's ready message also carries the host's reading. */
export type NodeTestOutputUpdate = {
  type: 'node-history-output'
  generation: number
  view: NodeTestApplicationView
  reading?: NodeTestOutputReading
}

/** What the document tells the host: it is ready for views (with the generation it shows and its follow choice), or the learner's reading changed. */
export type NodeTestOutputReport =
  | {
      type: 'node-history-output-ready'
      history: string
      generation: number
      follow: boolean
    }
  | ({
      type: 'node-history-output-state'
      history: string
    } & NodeTestOutputReading)

/**
 * Draws the Application pane's one document for a test replay and applies each later event to it in place (EN3), so moving through the replay never reloads the page: unchanged lines keep their nodes, so the learner's text selection, the scroll position and the keyboard focus survive, and an update older than the one shown is ignored. It follows the latest output until the learner scrolls up, and `Jump to latest` follows again (DS20); called by the document {@link testOutputHtml} writes, serialized with `toString()`, so it imports nothing.
 * The first view is drawn by the same code as every later one. The learner's follow choice and scroll anchor belong to the host, which files them under the replay and passes them in the options of each document it writes, so a document that replaces another of the same replay (a presentation change, a Retry, a reload) opens where the learner was (D22). The document reports a change of its follow choice at once and its scroll anchor at most once per interval, and tells the host when it is ready, so a document that VS Code reloads in place is brought to the host's current view (F141). Views posted in a burst are drawn once per animation frame, the newest only (F140), and the host's reading in a replaced view is carried to the newest, so it is not lost (F290); a reading that arrives after the learner scrolled or pressed Jump to latest is ignored, because the learner's own place is newer (F290). Following is decided by the scroll position alone: a scroll that leaves the position the document itself set is the learner's (F106).
 * @param api - The webview's API.
 * @param options - The stderr mark, the shown replay, the end tolerance, the report interval, the first view and the host's reading.
 * @example installNodeTestOutput(acquireVsCodeApi(), { stderrMark: '[stderr] ', history: 'study_1', endTolerancePx: 2, stateReportIntervalMs: 500, view, reading: { follow: true } })
 */
export function installNodeTestOutput(
  api: {
    postMessage(message: NodeTestOutputReport): void
  },
  options: NodeTestOutputOptions,
): void {
  const element = (id: string): HTMLElement => {
    const found = document.getElementById(id)
    if (!found) throw new Error(`Test output element ${id} is missing.`)
    return found
  }
  const output = element('test-output'),
    jump = element('test-output-jump')
  let shown = options.view.generation,
    follow = options.reading.follow,
    // The scroll position the document itself left; a scroll event that ends elsewhere is the learner's.
    expectedTop = 0,
    queued: NodeTestOutputUpdate | undefined,
    // Whether the learner scrolled or pressed Jump to latest in this document: a reading the host built before that is older than the learner's own place (F290).
    learnerActed = false,
    frame: number | undefined,
    reportTimer: ReturnType<typeof setTimeout> | undefined,
    reportDue = false
  /** Finds the first line in view and how far its top is above the region's top, by bisection over the lines (each probe reads one rectangle). */
  const currentAnchor = (): NodeTestOutputAnchor | undefined => {
    const lines = output.children
    const regionTop = output.getBoundingClientRect().top
    let low = 0,
      high = lines.length - 1
    while (low < high) {
      const middle = (low + high) >> 1
      if (lines[middle]!.getBoundingClientRect().bottom > regionTop)
        high = middle
      else low = middle + 1
    }
    const first = lines[low]
    if (!(first instanceof HTMLElement)) return undefined
    return {
      line: Number(first.dataset.line),
      offsetPx: regionTop - first.getBoundingClientRect().top,
    }
  }
  /** Tells the host the learner's reading: the follow choice and the scroll anchor. */
  const reportState = (): void => {
    reportDue = false
    api.postMessage({
      type: 'node-history-output-state',
      history: options.history,
      follow,
      anchor: currentAnchor(),
    })
  }
  /** Reports now, or once the interval since the last report ends: scrolling produces events faster than the host needs the anchor. */
  const reportSoon = (): void => {
    if (reportTimer !== undefined) {
      reportDue = true
      return
    }
    reportState()
    reportTimer = setTimeout(() => {
      reportTimer = undefined
      // The scrolls that came during the interval are reported as one.
      if (reportDue) reportSoon()
    }, options.stateReportIntervalMs)
  }
  // A document that is left reports the anchor it had joined before it goes.
  window.addEventListener('pagehide', () => {
    if (reportDue) reportState()
  })
  /** Remembers where the document left the scroll position, so the scroll event it causes (or none) is told from the learner's. */
  const settle = (): void => {
    expectedTop = output.scrollTop
  }
  /** Shows a muted line with its text, or leaves it out without text. */
  const line = (id: string, value: string | undefined): void => {
    const target = element(id)
    target.textContent = value ?? ''
    target.hidden = value === undefined
  }
  /** Makes the node of one output line: the `[stderr] ` mark for a standard-error line that is not cut, its text and a line feed, all as text. The one place that draws a line (F136). */
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
    // Instant, never smooth: the learner's reduced-motion choice needs no separate path.
    output.scrollTop = output.scrollHeight
    settle()
  }
  /** Every drawn line by its number, with the line it shows: a frame compares a line with what it drew, never by querying the document, and the lines a view leaves are found without walking the output (F314). */
  const drawn = new Map<
    number,
    { node: HTMLElement; shows: NodeTestApplicationView['lines'][number] }
  >()
  /** Removes the drawn lines a view no longer holds. */
  const dropLeftLines = (lines: NodeTestApplicationView['lines']): void => {
    const wanted = new Set(lines.map((value) => value.number))
    for (const [number, line] of drawn)
      if (!wanted.has(number)) {
        line.node.remove()
        drawn.delete(number)
      }
  }
  /** Places one line after the line before it: lines are matched by their number, so an unchanged line keeps its node and a selection or focus inside it survives; a changed line is replaced and a new one inserted. */
  const placeLine = (
    value: NodeTestApplicationView['lines'][number],
    previous: Element | undefined,
  ): Element => {
    const kept = drawn.get(value.number)
    const unchanged =
      kept?.shows.channel === value.channel &&
      Boolean(kept.shows.cut) === Boolean(value.cut) &&
      kept.shows.text === value.text
    if (unchanged && kept) return kept.node
    const placed = lineNode(value)
    if (kept) kept.node.replaceWith(placed)
    else if (previous) previous.after(placed)
    else output.prepend(placed)
    drawn.set(value.number, { node: placed, shows: value })
    return placed
  }
  /** Brings the output region's lines to a view's in place, in time linear in the lines. */
  const placeLines = (lines: NodeTestApplicationView['lines']): void => {
    dropLeftLines(lines)
    let previous: Element | undefined
    for (const value of lines) previous = placeLine(value, previous)
  }
  /** Scrolls so that the anchor's line stands where it stood; an anchor whose line the view no longer holds leaves the region at its start. */
  const restoreAnchor = (anchor: NodeTestOutputAnchor): void => {
    const target = drawn.get(anchor.line)?.node
    if (target)
      output.scrollTop +=
        target.getBoundingClientRect().top -
        output.getBoundingClientRect().top +
        anchor.offsetPx
    else output.scrollTop = 0
    settle()
  }
  /** Takes the host's reading of the replay: following goes to the end, otherwise the anchor's line is found again. */
  const takeReading = (reading: NodeTestOutputReading): void => {
    follow = reading.follow
    jump.hidden = follow
    if (follow) toEnd()
    else if (reading.anchor) restoreAnchor(reading.anchor)
    else settle()
  }
  /** Places the region after a view was drawn: following goes to the end; otherwise the learner's line stands where it stood, whatever the webview's own scroll anchoring did with lines dropped above it (F354), or the position is recorded as the document's own. */
  const placeReading = (anchor: NodeTestOutputAnchor | undefined): void => {
    // A shorter output clamps the scroll position: that is the document's change, never the learner's return to the end (DS20), and `settle` records it as such.
    if (follow) toEnd()
    else if (anchor && drawn.has(anchor.line)) restoreAnchor(anchor)
    else settle()
  }
  /** Brings a server replay's request and response regions to a view's in place; a region the view lacks is hidden. */
  const applyServerRegions = (view: NodeTestApplicationView): void => {
    const request = view.request
    element('test-output-request').hidden = !request
    const requestLine = element('test-output-request-line')
    requestLine.textContent = request?.line ?? ''
    requestLine.title = request?.line ?? ''
    element('test-output-request-claim').textContent = request?.claim ?? ''
    const response = view.response
    element('test-output-response').hidden = !response
    element('test-output-response-state').textContent = response?.state ?? ''
    const body = element('test-output-response-body')
    body.textContent = response?.body ?? ''
    body.hidden = response?.body === undefined
    line('test-output-response-note', response?.note)
  }
  const apply = (view: NodeTestApplicationView): void => {
    // The line the learner reads, taken before the lines change: a view that drops earlier lines would otherwise move it up (F354).
    const readingAnchor = follow ? undefined : currentAnchor()
    document.title = view.name
    element('test-output-main').setAttribute('aria-label', view.name)
    element('test-output-time').textContent = view.time
    // A server replay has no cited test; its request and response regions take that place.
    if (view.profile === 'node-server') applyServerRegions(view)
    else {
      const test = element('test-output-test')
      test.textContent = view.test
      test.title = view.test
    }
    output.setAttribute('aria-label', view.region ?? view.name)
    line('test-output-inspector', view.inspector)
    line('test-output-cut', view.cut)
    line('test-output-placeholder', view.placeholder)
    line('test-output-end', view.end)
    placeLines(view.lines)
    placeReading(readingAnchor)
    jump.hidden = follow
  }
  /** Draws the newest view that came since the last frame, and takes the host's reading when the update carries it. */
  const drawQueued = (): void => {
    frame = undefined
    const update = queued
    queued = undefined
    if (!update) return
    shown = update.generation
    apply(update.view)
    // The host's reading is the answer to `ready`, built before anything the learner did since; it never overrides the learner's own place (F290).
    if (update.reading && !learnerActed) takeReading(update.reading)
  }
  output.addEventListener('scroll', () => {
    // A scroll that ends where the document left the position (its own scroll to the end, or a clamp to a shorter output, or none at all) is no choice of the learner's.
    if (output.scrollTop === expectedTop) return
    expectedTop = output.scrollTop
    learnerActed = true
    const following = atEnd()
    if (following === follow) {
      reportSoon()
      return
    }
    follow = following
    jump.hidden = follow
    // The learner's own choice is reported at once; only the anchor of a long scroll is joined.
    reportState()
  })
  jump.addEventListener('click', () => {
    learnerActed = true
    follow = true
    toEnd()
    jump.hidden = true
    reportState()
    // The button leaves the page, so the keyboard stays in the output it led to.
    output.focus()
  })
  /** Tells a view the host posted from any other message the webview receives: it has a generation and a view. */
  const isOutputUpdate = (
    data: Partial<NodeTestOutputUpdate> | null,
  ): data is NodeTestOutputUpdate =>
    data?.type === 'node-history-output' &&
    typeof data.generation === 'number' &&
    Boolean(data.view)
  /** Whether an update is older than the one shown or waiting: it came late, and the newer selection stands. */
  const isLate = (generation: number): boolean =>
    generation < Math.max(shown, queued?.generation ?? 0)
  /** Draws the queued view at the next frame: views that arrive faster than frames (Play posts up to twenty a second) are drawn once, the newest. */
  const drawSoon = (): void => {
    frame ??= requestAnimationFrame(drawQueued)
  }
  /** Queues the newest view, keeping the host's reading that waited in the update it replaces unless this one brings its own (F290). */
  const queue = (update: NodeTestOutputUpdate): void => {
    const reading = update.reading ?? queued?.reading
    queued = {
      type: 'node-history-output',
      generation: update.generation,
      view: update.view,
      ...(reading ? { reading } : {}),
    }
    drawSoon()
  }
  window.addEventListener(
    'message',
    (event: MessageEvent<Partial<NodeTestOutputUpdate> | null>) => {
      const data = event.data
      if (!isOutputUpdate(data) || isLate(data.generation)) return
      queue(data)
    },
  )
  apply(options.view)
  takeReading(options.reading)
  // The host answers with its current view when this document's is older, as after VS Code reloads the page in place (F141).
  api.postMessage({
    type: 'node-history-output-ready',
    history: options.history,
    generation: shown,
    follow,
  })
}
