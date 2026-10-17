/** What a pane's script reads from, and asks of, the memory {@link installPaneFocusMemory} keeps for it. */
export interface PaneFocusMemory {
  /** Gives the control that holds the keyboard focus now, or `undefined` while the focus stands on the document body. */
  focusedControl: () => HTMLElement | undefined
  /** Gives the control the learner left the pane at, until a control has the focus again; `undefined` when the keyboard stood on none. */
  leftControl: () => HTMLElement | undefined
  /** Gives the control at which the keyboard stands: the focused one, and while the document does not have the focus the one the learner left the pane at. */
  keyboardControl: () => HTMLElement | undefined
  /** Keeps a control as the one the learner left the pane at, or forgets that there is one, and tells the pane through its `onLeft`. */
  holdAsLeft: (control: HTMLElement | undefined) => void
  /** Says whether a control is shown and can be used, so that it can take the focus. */
  canTakeFocus: (control: HTMLElement) => boolean
  /** Says whether the pane may place the focus for a control now: the document has the focus, and the focus stands on the document body or on that control. */
  isFocusOpenFor: (control: HTMLElement) => boolean
}

/**
 * Remembers, in a pane Codebook serves into the editor, the control the learner left the pane at, and brings about the pane's focus at the learner's return; called once by the script of the Study pane ({@link studyHtml}) and of the Repository Wiki pane ({@link repositoryHtml}), which receive this function as text.
 *
 * Why: the editor's webview takes the focus from the focused control as the pane is left (a focusout without a related target, after which the active element is the page body, then the window's blur) and does not give it back on return. A pane that reads `document.activeElement` therefore finds the body while the learner is away and loses the keyboard's place. A `focus()` by script in a pane the learner left takes the window's keyboard, so nothing is focused here while the document has no focus.
 *
 * The return and a pointer press: the editor reports the window's focus and the press of the click the learner returned with a few milliseconds apart, in an order a pane cannot rely on. The focus the pane settles at the return is put back at the release of that press when the press took it off again, which a press on the pane's background does; a press on another control leaves the focus on that control.
 *
 * The function is written into a page as its source text, so it uses only its parameters and the page's globals.
 *
 * @param returnPressWindowMs - How long after the window's focus event a pointer press still counts as the press the learner returned with.
 * @param onLeft - Told the control the learner left the pane at (`undefined` when the keyboard stood on none), at the window's blur and at every {@link PaneFocusMemory.holdAsLeft}; the pane notes there what it owes that control at the return.
 * @param settleReturn - Places the pane's focus for the return, at the window's focus event, while the document has the focus again; what has the focus afterwards is what a press on the background gets back.
 * @returns The memory's readers and its one writer, {@link PaneFocusMemory}.
 *
 * @example
 * const memory = installPaneFocusMemory(300, (control) => { focusOwed = control }, () => focusOwed?.focus())
 * memory.keyboardControl()?.id // => 'playback-toggle' while the learner, who left the pane at Play, works in the editor
 */
export function installPaneFocusMemory(
  returnPressWindowMs: number,
  onLeft: (control: HTMLElement | undefined) => void,
  settleReturn: () => void,
): PaneFocusMemory {
  // The control at which the keyboard stood when the learner left the pane for another part of the editor. Cleared once any control has the focus.
  let leftControl: HTMLElement | undefined
  // The control that just lost the focus with no control taking it. It becomes the left control when the window's blur follows; a focus on any control ends it.
  let focusLostWithoutTarget: HTMLElement | undefined
  // Whether a pointer press inside the pane is under way, from its pointerdown to its release: a focus it takes off a control is the learner's own doing and not a leaving.
  let isPressUnderWay = false
  // Whether the press that is under way is the one the learner returned to the pane with: its release puts back the focus the pane settled for the return.
  let isPressOfReturn = false
  // The learner's last return to the pane: when the window's focus event came and which control had the focus once the pane had settled it.
  let paneReturn: { atMs: number; control: HTMLElement | undefined } | undefined
  const focusedControl = (): HTMLElement | undefined => {
    const active = document.activeElement
    return active instanceof HTMLElement && active !== document.body
      ? active
      : undefined
  }
  const canTakeFocus = (control: HTMLElement): boolean =>
    control.checkVisibility() && !control.matches(':disabled')
  const isFocusOpenFor = (control: HTMLElement): boolean =>
    document.hasFocus() &&
    (document.activeElement === document.body ||
      document.activeElement === control)
  /** Says whether the control the pane settled at the return can have the focus again: the focus is open for it and it can take one; read by {@link repayReturnFocus}. @example canGetFocusBack(element('playback-toggle')) // => false once the learner pressed another control */
  const canGetFocusBack = (control: HTMLElement): boolean =>
    isFocusOpenFor(control) && canTakeFocus(control)
  const holdAsLeft = (control: HTMLElement | undefined): void => {
    leftControl = control
    onLeft(control)
  }
  document.addEventListener('focusout', (event) => {
    // A press on the pane's background takes the focus off a control too; that is no leaving.
    focusLostWithoutTarget =
      event.relatedTarget === null &&
      !isPressUnderWay &&
      event.target instanceof HTMLElement
        ? event.target
        : undefined
  })
  document.addEventListener('focusin', () => {
    focusLostWithoutTarget = undefined
    leftControl = undefined
  })
  window.addEventListener('blur', () => {
    // A browser that leaves the focus on the control when its window is left names it still; the editor's webview has taken it by now.
    holdAsLeft(focusedControl() ?? focusLostWithoutTarget)
    focusLostWithoutTarget = undefined
    paneReturn = undefined
    // A press whose release went to another part of the editor is over.
    isPressUnderWay = false
    isPressOfReturn = false
  })
  /**
   * Puts the focus back that the pane settled at the learner's return when the press the learner returned with took it off again; called at the release of that press.
   * A press on another control leaves the focus on that control, and a pane that was left again takes none.
   * @example repayReturnFocus()
   */
  const repayReturnFocus = (): void => {
    const settled = paneReturn?.control
    paneReturn = undefined
    if (settled && canGetFocusBack(settled))
      settled.focus({ preventScroll: true })
  }
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.isTrusted) return
      isPressUnderWay = true
      // The press of the click the learner returned with can reach the page after the window's focus event. Its time is the click's own, so it is not later than that event by more than the editor's delay between the two.
      isPressOfReturn = Boolean(
        paneReturn && event.timeStamp - paneReturn.atMs <= returnPressWindowMs,
      )
    },
    { capture: true, passive: true },
  )
  /** Ends the press that is under way and, when the learner returned to the pane with it, puts back the focus it took off; called at the release of every pointer press in the pane. By then the browser's own handling of the press is over. @example document.addEventListener('pointerup', endPress, { capture: true, passive: true }) */
  const endPress = (event: Event): void => {
    if (!event.isTrusted) return
    if (isPressOfReturn) repayReturnFocus()
    isPressUnderWay = false
    isPressOfReturn = false
  }
  document.addEventListener('pointerup', endPress, {
    capture: true,
    passive: true,
  })
  document.addEventListener('pointercancel', endPress, {
    capture: true,
    passive: true,
  })
  window.addEventListener('focus', (event) => {
    settleReturn()
    // What has the focus now is what the pane settled for this return. A press that is under way brought the return about, and the browser handles it after this event; the focus it may take off is put back at its release.
    paneReturn = { atMs: event.timeStamp, control: focusedControl() }
    if (isPressUnderWay) isPressOfReturn = true
  })
  return {
    focusedControl,
    leftControl: () => leftControl,
    keyboardControl: () =>
      focusedControl() ?? (document.hasFocus() ? undefined : leftControl),
    holdAsLeft,
    canTakeFocus,
    isFocusOpenFor,
  }
}
