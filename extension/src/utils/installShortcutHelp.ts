export interface ShortcutHelpEntry {
  action: string
  keys: string
  context: string
  selector?: string
}

/** Installs scoped discovery when {@link studyHtml} starts its webview; browser readers can reuse the same DOM-only procedure. @example installShortcutHelp(entries, '#study-content') */
export function installShortcutHelp(
  entries: ShortcutHelpEntry[],
  rootSelector: string,
): void {
  const dialog = document.createElement('dialog')
  dialog.className = 'shortcut-dialog'
  dialog.setAttribute('aria-labelledby', 'shortcut-title')
  const heading = document.createElement('h2')
  heading.id = 'shortcut-title'
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
  const empty = document.createElement('p')
  empty.textContent = 'No shortcuts match.'
  empty.hidden = true
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
    empty.hidden = list.childElementCount !== 0
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
