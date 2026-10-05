export interface ShortcutHelpEntry {
  action: string
  keys: string
  context: string
  selector?: string
}

/**
 * Installs scoped discovery when {@link studyHtml} starts its webview; browser readers can reuse the same DOM-only procedure.
 * The dialog is named by its heading and a control is described by the tooltip, both through an id: each of the two ids is the list's own only while no element of the page carries it, else it gets a number, so a page whose content holds one of them (a Wiki page published before the publisher kept such ids apart) cannot name the dialog or describe a control with its own element.
 * The line that says a search matched nothing is a status region that stays in the dialog, rendered and empty, while the search has matches: its sentence is then a change of a region that exists, which a screen reader announces. It is never taken out with `hidden`.
 * @param entries - The shortcuts of the page; one with a selector is listed only while a control it names is shown and enabled.
 * @param rootSelector - The part of the page that must be shown for the list to open.
 * @example installShortcutHelp(entries, '#study-content')
 */
export function installShortcutHelp(
  entries: ShortcutHelpEntry[],
  rootSelector: string,
): void {
  /**
   * Gives an element of the keyboard help an id no element of the page carries: the id it has, or that id with a number. Called for the heading and for the tooltip before either is added to the page.
   * A reference by id finds the first element of the page with that id, which would be the page's own element, not the list's.
   * @param element - The element, already given the id it wants and not yet in the page.
   * @example keepIdFree(heading) // 'shortcut-title' stays, or becomes 'shortcut-title-2' on a page whose content carries it
   */
  const keepIdFree = (element: HTMLElement): void => {
    const wanted = element.id
    for (let count = 2; document.querySelector('#' + element.id); count += 1)
      element.id = wanted + '-' + count
  }
  const dialog = document.createElement('dialog')
  dialog.className = 'shortcut-dialog'
  const heading = document.createElement('h2')
  heading.id = 'shortcut-title'
  keepIdFree(heading)
  dialog.setAttribute('aria-labelledby', heading.id)
  heading.textContent = 'Keyboard shortcuts'
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Close'
  close.setAttribute('aria-label', 'Close keyboard shortcuts')
  const search = document.createElement('input')
  search.type = 'search'
  search.placeholder = 'Search shortcuts'
  search.setAttribute('aria-label', 'Search shortcuts')
  const list = document.createElement('div')
  list.className = 'shortcut-list'
  // Created empty and never hidden: the sentence arrives with the first search that matches nothing.
  const empty = document.createElement('p')
  empty.setAttribute('role', 'status')
  const clear = document.createElement('button')
  clear.type = 'button'
  clear.textContent = 'Clear search'
  clear.hidden = true
  dialog.append(heading, close, search, list, empty, clear)
  document.body.append(dialog)
  let previousFocus: HTMLElement | undefined
  let renderedSignature = ''
  const available = () =>
    entries.filter(
      (entry) =>
        !entry.selector ||
        Array.from(document.querySelectorAll<HTMLElement>(entry.selector)).some(
          (control) =>
            control.getClientRects().length > 0 &&
            !control.closest('[hidden],[inert]') &&
            !control.matches(':disabled'),
        ),
    )
  /**
   * Writes the no-match line for the list as it was just rendered; called by `render` after every search and every change of the shown shortcuts.
   * The line stays rendered either way: its sentence is the change a screen reader announces.
   * @param isListEmpty - Whether the search matched no shortcut.
   * @example showNoMatch(true) // the line reads "No shortcuts match."
   */
  const showNoMatch = (isListEmpty: boolean): void => {
    const sentence = isListEmpty ? 'No shortcuts match.' : ''
    // Written only when it changes, so the sentence is announced once for a run of searches without a match.
    if (empty.textContent !== sentence) empty.textContent = sentence
    // An empty paragraph keeps its margins and would open a gap under the list: the line has none while it is empty, whatever the page's stylesheet gives a paragraph.
    empty.style.margin = sentence ? '' : '0'
  }
  const render = (): void => {
    const query = search.value.trim().toLocaleLowerCase(),
      bindings = available()
    const signature = JSON.stringify([query, bindings])
    // Live playhead updates must not reset scrolling in an unchanged shortcut list.
    if (signature === renderedSignature) return
    renderedSignature = signature
    list.replaceChildren()
    let group: HTMLElement | undefined,
      contextName = ''
    for (const entry of bindings) {
      // Search includes scope so timeline-only bindings cannot be mistaken for global commands.
      if (
        ![entry.action, entry.keys, entry.context]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query)
      )
        continue
      if (contextName !== entry.context) {
        contextName = entry.context
        group = document.createElement('section')
        const title = document.createElement('h3')
        title.textContent = contextName
        group.append(title)
        list.append(group)
      }
      const row = document.createElement('div')
      row.className = 'shortcut-row'
      const label = document.createElement('span')
      label.textContent = entry.action
      const keys = document.createElement('kbd')
      keys.textContent = entry.keys
      row.append(label, keys)
      group?.append(row)
    }
    showNoMatch(list.childElementCount === 0)
    clear.hidden = !query
  }
  const open = (): void => {
    // Repeated ? never replaces the dialog or its original return target.
    if (
      dialog.open ||
      !document.querySelector(rootSelector)?.getClientRects().length
    )
      return
    previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined
    search.value = ''
    render()
    dialog.showModal()
    search.focus({ preventScroll: true })
  }
  for (const control of Array.from(
    document.querySelectorAll<HTMLElement>('[data-shortcut-help]'),
  ))
    control.addEventListener('click', open)
  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener(
    'keydown',
    (event) => {
      // Search fields consume Escape to clear text; the help contract closes on one press.
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      dialog.close()
    },
    { capture: true },
  )
  dialog.addEventListener('close', () => {
    hideTooltip()
    const target =
      previousFocus?.isConnected &&
      previousFocus.getClientRects().length &&
      !previousFocus.closest('[hidden],[inert]')
        ? previousFocus
        : Array.from(
            document.querySelectorAll<HTMLElement>('[data-shortcut-help]'),
          ).find((control) => control.getClientRects().length > 0)
    target?.focus({ preventScroll: true })
  })
  const root = document.querySelector(rootSelector)
  if (root)
    new MutationObserver(() => {
      if (dialog.open) render()
    }).observe(root, { attributes: true, childList: true, subtree: true })
  search.addEventListener('input', render)
  clear.addEventListener('click', () => {
    search.value = ''
    render()
    search.focus({ preventScroll: true })
  })
  document.addEventListener('keydown', (event) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.key !== '?'
    )
      return
    const target = event
      .composedPath()
      .find((value) => value instanceof HTMLElement)
    // Editing, selection widgets and nested editable elements retain their ordinary text handling.
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
        ))
    )
      return
    if (!document.querySelector(rootSelector)?.getClientRects().length) return
    event.preventDefault()
    open()
  })
  const tooltip = document.createElement('div')
  tooltip.id = 'shortcut-tooltip'
  keepIdFree(tooltip)
  tooltip.className = 'shortcut-tooltip'
  tooltip.setAttribute('role', 'tooltip')
  tooltip.hidden = true
  document.body.append(tooltip)
  let tooltipOwner: HTMLElement | undefined
  const hideTooltip = (): void => {
    tooltip.hidden = true
    tooltipOwner?.removeAttribute('aria-describedby')
    tooltipOwner = undefined
  }
  // One registry supplies both visible key labels and tooltips for the actual local key handlers.
  const controls = new Set(
    entries.flatMap((entry) =>
      entry.selector
        ? Array.from(document.querySelectorAll<HTMLElement>(entry.selector))
        : [],
    ),
  )
  controls.add(close)
  for (const control of controls) {
    const text =
      control === close
        ? 'Close keyboard shortcuts — Esc'
        : entries
            .filter(
              (entry) => entry.selector && control.matches(entry.selector),
            )
            .map(
              (entry) => `${entry.action} — ${entry.keys} (${entry.context})`,
            )
            .join('; ')
    control.title = text
    const show = (): void => {
      hideTooltip()
      tooltipOwner = control
      ;(dialog.contains(control) ? dialog : document.body).append(tooltip)
      tooltip.textContent = text
      tooltip.hidden = false
      control.setAttribute('aria-describedby', tooltip.id)
    }
    control.addEventListener('mouseenter', show)
    control.addEventListener('focus', show)
    control.addEventListener('mouseleave', hideTooltip)
    control.addEventListener('blur', hideTooltip)
  }
}
