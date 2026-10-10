import { randomUUID } from 'node:crypto'

import {
  PANE_RETURN_PRESS_WINDOW_MS,
  REPOSITORY_NARROW_WIDTH_PX,
  REPOSITORY_READER_DEBOUNCE_MS,
  REPOSITORY_VISITED_CITATIONS_LIMIT,
} from '../constants'
import type { RepositorySelection } from '../learnerSchemas'
import type { RepositoryViewMessage } from '../repositoryView'
import { installPaneFocusMemory } from '../utils/installPaneFocusMemory'

import { STUDY_STYLES } from './constants'

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState():
    | {
        key?: string
        location?: RepositorySelection['location']
        visited?: string[]
      }
    | undefined
  setState(state: unknown): void
}

/** Renders the approved compact article shell; {@link RepositoryReader} supplies escaped-by-DOM typed content separately. @example repositoryHtml() */
export function repositoryHtml(): string {
  const nonce = randomUUID()
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Repository Wiki · codebook</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">${STUDY_STYLES}
body{padding:20px 24px;font-size:16px;line-height:1.5}button,select{font:inherit}button{min-height:44px}h1{font-size:20px;line-height:1.3;margin:12px 0}h2{font-size:16px}.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:12px}.toolbar select{max-width:100%;min-height:44px}.layout{display:grid;grid-template-columns:minmax(0,72ch) minmax(210px,30ch);gap:24px}.article{min-width:0}.article section{border-top:1px solid var(--vscode-panel-border);padding:16px 0;margin:0}.article p{white-space:pre-wrap;overflow-wrap:anywhere}.badges{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.badge{font-size:13px;padding:2px 6px;border:1px solid var(--vscode-panel-border);border-radius:3px}.interpretation{border-left:3px solid var(--vscode-textLink-foreground);padding-left:12px}.context{min-width:0;border-left:1px solid var(--vscode-panel-border);padding-left:16px}.context button{display:block;text-align:left;width:100%;margin-bottom:4px;overflow-wrap:anywhere}.context h2{margin-top:20px}.context p,.context li{font-size:14px;overflow-wrap:anywhere}.context ol{padding-left:20px}.understanding{display:flex;align-items:center;min-height:44px;gap:10px}.understanding input{width:16px;height:16px;margin:0}.history{font-size:13px;overflow-wrap:anywhere}.source-link{max-width:100%;text-align:left;overflow-wrap:anywhere}.contents-compact{display:none}#state{min-height:24px}#errors:empty{display:none}#latest{margin:12px 0}#article-title:focus{outline:1px solid var(--vscode-focusBorder)}
#observations button[aria-disabled="true"]{opacity:.6;cursor:default}#observations button[aria-disabled="true"]:hover{filter:none}
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media(max-width:${REPOSITORY_NARROW_WIDTH_PX - 1}px){body{padding:16px}.layout{display:block}.context{border-left:0;border-top:1px solid var(--vscode-panel-border);padding:0}.contents-wide{display:none}.contents-compact{display:block}.toolbar{align-items:stretch}.toolbar select{width:100%}}
</style></head><body><header class="toolbar"><strong>Repository Wiki</strong><label for="books">Book</label><select id="books"></select><label for="versions">Revision</label><select id="versions"></select><button id="refresh" data-action="refresh">Refresh</button><button id="connect" data-action="connect">Connect agent</button></header>
<p id="state" role="status" aria-live="polite">Loading repository library…</p><p id="errors" class="error" role="status" aria-live="polite"></p><button id="retry" data-action="retry" hidden>Retry storage / refresh</button><div id="latest" hidden><span id="latest-text"></span> <button id="load-latest" data-action="latest">Load latest</button></div>
<div id="empty" hidden><h1>Your repository learning book</h1><p>Connect your agent, ask it to read repository sources and publish a learning book. Source reading and articles work without starting an application.</p></div>
<div id="reader" class="layout" hidden><article class="article"><header data-reading-region><nav aria-label="Wiki articles"><label for="nodes">Article</label><select id="nodes"></select></nav><h1 id="article-title" tabindex="-1"></h1><div class="badges"><span class="badge">Source-derived</span><span class="badge">Agent interpretation</span></div><p id="summary" class="muted"></p><details class="contents-compact"><summary>Contents</summary><nav id="contents-compact" aria-label="Article contents"></nav></details></header><div id="sections"></div><section data-reading-region><h2>Cited source</h2><div id="anchors"></div><button id="current-file" data-action="current-file">Open verified current file</button><p id="source-status" class="muted"></p></section><section data-reading-region><h2>Related observations</h2><div id="observations"></div></section><section data-reading-region><label class="understanding" for="understand"><input id="understand" type="checkbox" aria-describedby="progress-description"><span>understand</span><span id="save-state" class="muted"></span></label><span id="progress-description" class="visually-hidden">Your understanding applies to every citation in this article.</span><p id="progress-status" class="muted"></p><details><summary>Understanding history</summary><div id="history" class="history"></div></details></section></article><aside class="context" aria-label="Article context"><div class="contents-wide"><h2>Article navigation</h2><nav id="contents-wide"></nav></div><h2>Source-derived relationships</h2><p class="muted">Agent interpretation of cited code; runtime order requires linked observations.</p><div id="relations"></div><button id="back-top">Back to top ↑</button></aside></div>
<script nonce="${nonce}">(${repositoryClient.toString()})(${REPOSITORY_READER_DEBOUNCE_MS},${REPOSITORY_VISITED_CITATIONS_LIMIT},${PANE_RETURN_PRESS_WINDOW_MS},${installPaneFocusMemory.toString()})</script></body></html>`
}

/**
 * Keeps article DOM stable during status updates and restores section-relative reading context after width changes; runs once in the Repository Wiki pane, which receives it as text from {@link repositoryHtml}.
 * It focuses by script only while its document has the focus, because a `focus()` in a webview takes the window's keyboard from the part of the editor the learner works in: a focus it could not place is owed to the document's next focus event, and so is the focus of the control the learner left the pane at ({@link installPaneFocusMemory}).
 * @param debounceMs - How long the pane waits after a scroll or a focus before it saves its reading place.
 * @param visitedLimit - How many visited citations the pane keeps.
 * @param returnPressWindowMs - How long after the window's focus event a pointer press still counts as the press the learner returned to the pane with.
 * @param installFocusMemory - {@link installPaneFocusMemory}, handed over as the pane's script cannot import it.
 * @example repositoryClient(150, 512, 300, installPaneFocusMemory)
 */
function repositoryClient(
  debounceMs: number,
  visitedLimit: number,
  returnPressWindowMs: number,
  installFocusMemory: typeof installPaneFocusMemory,
): void {
  const api = acquireVsCodeApi()
  let saved = api.getState()
  const visited = new Set(saved?.visited ?? [])
  let current: RepositoryViewMessage | undefined,
    contentKey = '',
    presentedRevision = -1,
    location: RepositorySelection['location'],
    restoring = false,
    timer: ReturnType<typeof setTimeout> | undefined
  const element = (id: string) => document.getElementById(id)!
  // The focus the pane owes: the element it would have focused in a document that has the focus. The newest wish replaces an older one, as the newest `focus()` would have. It is the control the learner left the pane at until a part of the pane names another place (an article's title, the place a revision returns to, the same control of a list that was rendered again).
  let focusOwed: (() => HTMLElement | null) | undefined
  /**
   * Places the focus the pane owes, once; called by {@link placeFocus} while this document has the focus, and at the document's next focus event otherwise.
   * @example payFocus()
   */
  const payFocus = (): void => {
    const find = focusOwed
    focusOwed = undefined
    find?.()?.focus({ preventScroll: true })
  }
  /**
   * Focuses an element for the pane itself (not for a press of the learner): at once in a document that has the focus, and at the document's next focus event in one that has not, so a pane the learner left takes no focus.
   * @param find - Finds the element when the focus is placed; a part that is rendered again meanwhile is then looked up anew.
   * @example placeFocus(() => element('article-title'))
   */
  const placeFocus = (find: () => HTMLElement | null): void => {
    focusOwed = find
    if (document.hasFocus()) payFocus()
  }
  // The editor takes the focus from the control the learner leaves the pane at and does not give it back: the pane owes it to that control, and reads the keyboard's place from the memory while the learner is away.
  const { keyboardControl } = installFocusMemory(
    returnPressWindowMs,
    (control) => {
      if (control) focusOwed = () => control
    },
    payFocus,
  )
  const text = (id: string, value: string): void => {
    element(id).textContent = value
  }
  const send = (value: object): void =>
    api.postMessage({ ...value, revision: current?.revision })
  const button = (label: string, id: string, action: () => void) => {
    const value = document.createElement('button')
    value.textContent = label
    value.id = id
    value.onclick = action
    return value
  }
  const choose = (
    target: HTMLElement,
    entries: { value: string; label: string }[],
    selected: string,
  ): void => {
    if (!(target instanceof HTMLSelectElement)) return
    const signature = JSON.stringify(entries)
    if (target.dataset.options !== signature) {
      target.replaceChildren(
        ...entries.map((entry) => {
          const option = document.createElement('option')
          option.value = entry.value
          option.textContent = entry.label
          return option
        }),
      )
      target.dataset.options = signature
    }
    target.value = selected
  }
  const capture = () => {
    if (!current?.selection) return undefined
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('[data-section]'),
    )
    let sectionIndex = 0
    sections.forEach((section, index) => {
      if (section.getBoundingClientRect().top <= 1) sectionIndex = index
    })
    const section = sections[sectionIndex],
      top = section?.getBoundingClientRect().top ?? 0
    // While the learner is away the keyboard's place is the control the learner left, which the active element no longer names.
    const focused = keyboardControl(),
      bounds = focused?.getBoundingClientRect()
    // A visible article control is a stable return anchor even when adjacent recovery text changes the section height.
    const visibleFocus =
      focused?.id &&
      focused.closest('[data-section]') &&
      bounds &&
      bounds.height > 0 &&
      bounds.width > 0 &&
      bounds.top >= 0 &&
      bounds.bottom <= innerHeight &&
      bounds.left >= 0 &&
      bounds.right <= innerWidth
    return {
      sectionIndex,
      fraction: section
        ? Math.min(1, Math.max(0, -top / Math.max(1, section.offsetHeight)))
        : 0,
      focusId: focused?.id || location?.focusId || 'article-title',
      ...(visibleFocus
        ? { focusViewportFraction: bounds.top / innerHeight }
        : {}),
    }
  }
  const persist = (): void => {
    if (restoring || !current?.selection || current.loading) return
    location = capture()
    api.setState({ key: contentKey, location, visited: [...visited] })
    send({ type: 'location', selection: { ...current.selection, location } })
  }
  const restore = (focus: boolean): void => {
    if (!location) return
    restoring = true
    const section = document.querySelector<HTMLElement>(
      `[data-section="${location.sectionIndex}"]`,
    )
    if (section)
      window.scrollTo(
        0,
        window.scrollY +
          section.getBoundingClientRect().top +
          section.offsetHeight * location.fraction,
      )
    const focusId = location.focusId,
      focused = element(focusId),
      bounds = focused?.getBoundingClientRect()
    // Restore only an existing article anchor; old positions and hidden/missing targets keep the section-relative fallback.
    if (
      location.focusViewportFraction !== undefined &&
      focused?.closest('[data-section]') &&
      bounds &&
      bounds.height > 0 &&
      bounds.width > 0
    ) {
      const offset = Math.min(
        innerHeight * location.focusViewportFraction,
        Math.max(0, innerHeight - bounds.height),
      )
      window.scrollTo(0, window.scrollY + bounds.top - offset)
    }
    if (focus) placeFocus(() => document.getElementById(focusId))
    requestAnimationFrame(() => {
      restoring = false
    })
  }
  const select = (selection: RepositorySelection): void => {
    persist()
    send({ type: 'select', selection })
  }
  document.addEventListener('click', (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-action]')
        : null
    if (target?.dataset.action) {
      persist()
      send({ type: 'action', action: target.dataset.action })
    }
  })
  element('books').onchange = (event): void => {
    const id =
        event.target instanceof HTMLSelectElement ? event.target.value : '',
      book = current?.catalog.find((value) => value.bookId === id)
    if (book?.revision && book.firstNodeId)
      select({
        bookId: book.bookId,
        revision: book.revision,
        nodeId: book.firstNodeId,
        anchorIndex: 0,
      })
  }
  element('versions').onchange = (event): void => {
    if (current?.selection && event.target instanceof HTMLSelectElement)
      select({
        ...current.selection,
        revision: Number(event.target.value),
        anchorIndex: 0,
        location: undefined,
      })
  }
  element('nodes').onchange = (event): void => {
    if (current?.selection && event.target instanceof HTMLSelectElement)
      select({
        ...current.selection,
        nodeId: event.target.value,
        anchorIndex: 0,
        location: undefined,
      })
  }
  element('understand').onchange = (event): void => {
    if (!(event.target instanceof HTMLInputElement)) return
    const understood = event.target.checked
    event.target.checked = current?.understanding?.understood ?? false
    // Keep pending writes focusable while rejecting repeated keyboard/pointer input until the host settles.
    if (
      !current ||
      current.saving ||
      current.loading ||
      !current.understanding?.known ||
      event.target.getAttribute('aria-disabled') === 'true'
    )
      return
    event.target.setAttribute('aria-disabled', 'true')
    send({ type: 'understanding', understood })
  }
  element('back-top').onclick = (): void => {
    window.scrollTo(0, 0)
    element('article-title').focus({ preventScroll: true })
    persist()
  }
  window.addEventListener('scroll', () => {
    if (!restoring) {
      clearTimeout(timer)
      timer = setTimeout(persist, debounceMs)
    }
  })
  document.addEventListener('focusin', () => {
    if (!restoring) {
      clearTimeout(timer)
      timer = setTimeout(persist, debounceMs)
    }
  })
  window.addEventListener('resize', () => restore(false))
  window.addEventListener('pagehide', persist)
  window.addEventListener('message', (event) => {
    const message: RepositoryViewMessage = event.data
    if (message?.type !== 'repository') return
    current = message
    const { book, selection, understanding } = message,
      node = book?.revision.document.nodes.find(
        (value) => value.id === selection?.nodeId,
      )
    text('errors', message.error ?? '')
    element('retry').hidden = !message.error
    text(
      'state',
      message.loading
        ? 'Loading selected article…'
        : selection && book
          ? `Revision ${selection.revision} · ${new Date(book.revision.publishedAt).toLocaleString()}`
          : 'Repository library',
    )
    element('empty').hidden =
      Boolean(book) || message.loading || message.catalog.length > 0
    element('reader').hidden = !node
    choose(
      element('books'),
      message.catalog
        .filter((entry) => entry.status === 'available')
        .map((entry) => ({
          value: entry.bookId,
          label: entry.title ?? entry.bookId,
        })),
      selection?.bookId ?? '',
    )
    choose(
      element('versions'),
      (
        message.catalog.find((entry) => entry.bookId === selection?.bookId)
          ?.revisions ?? []
      ).map((revision) => ({
        value: String(revision),
        label: `Revision ${revision}`,
      })),
      String(selection?.revision ?? ''),
    )
    element('latest').hidden =
      !book || book.latestRevision === selection?.revision
    text(
      'latest-text',
      book
        ? `You are reading a historical revision. Revision ${book.latestRevision} is available.`
        : '',
    )
    if (!book || !node || !selection) return
    choose(
      element('nodes'),
      book.revision.document.nodes.map((value) => ({
        value: value.id,
        label: value.title,
      })),
      node.id,
    )
    const key = `${selection.bookId}/${selection.revision}/${node.id}`,
      changed = key !== contentKey
    if (changed) {
      // Explicit Study Return wins over viewport state saved while native panes moved.
      contentKey = key
      location =
        selection.location ?? (saved?.key === key ? saved.location : undefined)
      saved = undefined
      text('article-title', node.title)
      text('summary', book.revision.document.summary)
      element('sections').replaceChildren(
        ...node.sections.map((part, index) => {
          const section = document.createElement('section')
          section.dataset.readingRegion = ''
          section.id = `section-${index}`
          section.tabIndex = -1
          const heading = document.createElement('h2')
          heading.textContent = `${index + 1}. ${part.title}`
          const paragraph = document.createElement('p')
          paragraph.className = 'interpretation'
          paragraph.textContent = part.text
          section.append(heading, paragraph)
          return section
        }),
      )
      document
        .querySelectorAll<HTMLElement>('[data-reading-region]')
        .forEach((region, index) => {
          region.dataset.section = String(index)
        })
      for (const id of ['contents-wide', 'contents-compact'])
        element(id).replaceChildren(
          ...node.sections.map((part, index) =>
            button(`${index + 1}. ${part.title}`, `${id}-${index}`, () => {
              element(`section-${index}`).scrollIntoView()
              element(`section-${index}`).focus({ preventScroll: true })
              persist()
            }),
          ),
        )
      element('relations').replaceChildren(
        ...book.revision.document.edges
          .filter((edge) => edge.from === node.id || edge.to === node.id)
          .map((edge, index) => {
            const otherId = edge.from === node.id ? edge.to : edge.from,
              other = book.revision.document.nodes.find(
                (value) => value.id === otherId,
              )!
            const container = document.createElement('div')
            const paragraph = document.createElement('p')
            paragraph.textContent = `${edge.relationship}: ${edge.explanation}`
            container.append(
              button(other.title, `relation-${index}`, () =>
                select({
                  ...selection,
                  nodeId: otherId,
                  anchorIndex: 0,
                  location: undefined,
                }),
              ),
              paragraph,
            )
            return container
          }),
      )
      if (!element('relations').childElementCount)
        text('relations', 'No relationships authored for this article.')
      if (!location) {
        window.scrollTo(0, 0)
        // A wrapped toolbar can hide the title; reveal it only when this deferred default focus is paid.
        placeFocus(() => {
          const title = element('article-title'),
            bounds = title.getBoundingClientRect()
          // Preserve the default top position when the title is already fully visible.
          if (bounds.top < 0 || bounds.bottom > window.innerHeight)
            title.scrollIntoView({ block: 'nearest' })
          return title
        })
      }
    }
    // Citation status changes update labels in place, without replacing the learner's focused control.
    if (element('anchors').dataset.key !== key) {
      element('anchors').dataset.key = key
      element('anchors').replaceChildren(
        ...node.anchors.map((_anchor, index) => {
          const source = button('', `anchor-${index}`, () => {
            if (current?.selection)
              select({
                ...current.selection,
                anchorIndex: index,
                location: capture(),
              })
          })
          source.className = 'source-link'
          return source
        }),
      )
    }
    // A completed native citation selection is visited independently of the currently selected citation.
    if (!message.loading && node.anchors[selection.anchorIndex]) {
      const citationKey = JSON.stringify(node.anchors[selection.anchorIndex])
      if (!visited.has(citationKey)) {
        visited.add(citationKey)
        // Bound presentation-only link history; learner understanding is stored independently in the host ledger.
        while (visited.size > visitedLimit)
          visited.delete(visited.values().next().value!)
        api.setState({ key: contentKey, location, visited: [...visited] })
      }
    }
    node.anchors.forEach((anchor, index) => {
      const state = message.sources.find(
          (value) => value.path === anchor.path && value.hash === anchor.hash,
        ),
        wasVisited = visited.has(JSON.stringify(anchor)),
        control = element(`anchor-${index}`)
      control.className = `source-link link${wasVisited ? ' visited' : ''}`
      control.setAttribute(
        'aria-current',
        String(selection.anchorIndex === index),
      )
      text(
        `anchor-${index}`,
        `${anchor.path}:${anchor.startLine}–${anchor.endLine} · ${state?.status ?? 'unverified'}${wasVisited ? ' · visited' : ''}${selection.anchorIndex === index ? ' · selected' : ''}`,
      )
    })
    // Observation identity is independent of current citation status and selected citation index.
    const links = book.links.filter((link) => link.nodeId === node.id),
      evidenceKey = JSON.stringify([key, links])
    if (element('observations').dataset.key !== evidenceKey) {
      element('observations').dataset.key = evidenceKey
      // A new article already owns its title or explicit Return focus; only its own list update inherits a control.
      const keyboardStandsAt = keyboardControl(),
        focusedId =
          !changed &&
          keyboardStandsAt &&
          element('observations').contains(keyboardStandsAt)
            ? keyboardStandsAt.id
            : undefined
      element('observations').replaceChildren(
        ...links.map((link) => {
          const container = document.createElement('div'),
            caption = document.createElement('p')
          caption.textContent = `${link.outcome} saved study · ${link.studyId} · ${(link.elapsedMs / 1000).toFixed(2)} s${link.status === 'unavailable' ? ` · ${link.reason}` : ''}`
          container.append(caption)
          for (const recording of [false, true]) {
            const control = button(
              recording ? 'View recording' : 'View observation',
              `evidence-${link.linkIndex}-${recording ? 'recording' : 'observation'}`,
              () => {
                // ARIA-disabled controls retain Return focus; reject keyboard and pointer activation here.
                if (
                  current?.loading ||
                  link.status !== 'available' ||
                  (recording && link.recording.status !== 'available')
                )
                  return
                persist()
                send({
                  type: 'evidence',
                  linkIndex: link.linkIndex,
                  recording,
                  selection: { ...current?.selection, location },
                })
              },
            )
            container.append(control)
          }
          // Keep recovery readable while preserving the unavailable recording's exact diagnostic on demand.
          if (link.recording.status !== 'available') {
            const recovery = document.createElement('p'),
              details = document.createElement('details'),
              summary = document.createElement('summary'),
              reason = document.createElement('p')
            recovery.className = 'muted'
            recovery.textContent =
              'Recording unavailable. Refresh the article or ask your agent to check it.'
            summary.textContent = 'Recording details'
            reason.textContent =
              link.recording.reason ??
              'No verified recording for this observation.'
            details.append(summary, reason)
            container.append(recovery, details)
          }
          return container
        }),
      )
      if (!element('observations').childElementCount)
        text(
          'observations',
          'No runtime observation linked. This article explains source-derived behavior.',
        )
      if (focusedId) placeFocus(() => document.getElementById(focusedId))
    }
    const changedSource = message.sources.some(
        (source) => source.status === 'changed',
      ),
      unavailable = message.sources.some(
        (source) => source.status === 'unavailable',
      )
    text(
      'source-status',
      !message.sources.length
        ? 'Checking current citations…'
        : changedSource
          ? 'Review needed — cited source changed. Retained source and earlier understanding remain available.'
          : unavailable
            ? 'Current source unverified — retained source remains available.'
            : 'All cited source hashes match the current files.',
    )
    text('save-state', message.saving ? 'Saving…' : '')
    // Keep old article actions inert until the selected article/source has finished loading.
    document
      .querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
        '#reader button, #reader select, #books, #versions, #load-latest',
      )
      .forEach((control) => {
        control.disabled = message.loading
      })
    // Unavailable evidence remains focusable for exact Return; its handler blocks activation independently.
    for (const link of links)
      for (const recording of [false, true]) {
        const control = element(
          `evidence-${link.linkIndex}-${recording ? 'recording' : 'observation'}`,
        )
        if (control instanceof HTMLButtonElement)
          control.setAttribute(
            'aria-disabled',
            String(
              message.loading ||
                link.status !== 'available' ||
                (recording && link.recording.status !== 'available'),
            ),
          )
      }
    const selectedAnchor = node.anchors[selection.anchorIndex],
      currentFile = element('current-file')
    if (currentFile instanceof HTMLButtonElement)
      currentFile.disabled =
        message.loading ||
        !message.sources.some(
          (source) =>
            source.path === selectedAnchor?.path &&
            source.hash === selectedAnchor.hash &&
            source.status === 'current',
        )
    // Native disabled blurs a focused checkbox; saving retains its focus and exposes the temporary ARIA state.
    const checkbox = element('understand')
    if (checkbox instanceof HTMLInputElement) {
      checkbox.checked = understanding?.understood ?? false
      checkbox.disabled = message.loading || !understanding?.known
      checkbox.setAttribute(
        'aria-disabled',
        String(message.saving || checkbox.disabled),
      )
    }
    if (!message.loading)
      text(
        'state',
        `Revision ${selection.revision} · ${new Date(book.revision.publishedAt).toLocaleString()}${changedSource ? ' · Review needed' : unavailable ? ' · Current source unverified' : ''}`,
      )
    text(
      'progress-status',
      changedSource || unavailable
        ? `${changedSource ? 'Review needed' : 'Current source unverified'}${understanding?.understood ? ' · historical understanding retained' : ''}`
        : understanding?.reviewNeeded
          ? 'Review needed'
          : '',
    )
    element('progress-status').hidden = !element('progress-status').textContent
    text(
      'history',
      understanding?.history
        .map(
          (decision) =>
            `${decision.understood ? 'Understood' : 'Unchecked'} · ${new Date(decision.at).toLocaleString()} · ${decision.context.kind === 'citations' ? decision.context.hash.slice(0, 12) : decision.sourceHash.slice(0, 12)}`,
        )
        .join('\n') || 'No understanding decision yet.',
    )
    // Restore explicit return/navigation even when the article DOM already exists; status-only updates leave focus alone.
    if (!message.loading && presentedRevision !== message.revision) {
      presentedRevision = message.revision
      if (!changed) location = selection.location ?? location
      if (location)
        requestAnimationFrame(() => {
          // A newer or loading model retires this earlier frame's reading and keyboard restoration.
          if (current?.revision === message.revision && !current.loading)
            restore(true)
        })
    }
    api.postMessage({
      type: 'rendered',
      revision: message.revision,
      selection: { ...selection, location },
      width: window.innerWidth,
    })
  })
  api.postMessage({ type: 'ready' })
}
