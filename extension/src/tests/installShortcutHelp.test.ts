import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import { installShortcutHelp } from '../utils/installShortcutHelp'

type Listener = () => void

/**
 * One element of the hand-written page the Keyboard shortcuts list is installed into: it has only what {@link installShortcutHelp} uses while it builds its dialog and renders a search.
 * Text and children are kept apart, as the list never gives one element both.
 * @example
 * ```ts
 * const line = new ListElement('p')
 * line.textContent = 'No shortcuts match.'
 * ```
 */
class ListElement {
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, Listener[]>()
  readonly style = { margin: '' }
  children: ListElement[] = []
  parent: ListElement | undefined
  className = ''
  id = ''
  textContent = ''
  value = ''
  hidden = false

  constructor(readonly tagName: string) {}

  get childElementCount(): number {
    return this.children.length
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
  /** Adds elements as the last children; an element that stood elsewhere in the page is moved, as in a browser. */
  append(...elements: ListElement[]): void {
    for (const element of elements) {
      if (element.parent)
        element.parent.children = element.parent.children.filter(
          (child) => child !== element,
        )
      element.parent = this
      this.children.push(element)
    }
  }
  contains(other: ListElement): boolean {
    return (
      other === this || this.children.some((child) => child.contains(other))
    )
  }
  /** Finds the first element with an id in this element's part of the page, in document order, which is the element a reference by id names. */
  firstWithId(id: string): ListElement | undefined {
    if (this.id === id) return this
    for (const child of this.children) {
      const found = child.firstWithId(id)
      if (found) return found
    }
    return undefined
  }
  replaceChildren(...elements: ListElement[]): void {
    this.children = []
    this.append(...elements)
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  focus(): void {}
}

/**
 * Installs the Keyboard shortcuts list into a hand-written page the way the Study pane and the Wiki reader do, from the function's own text, and gives the test its hands on the search.
 * The page has no element the shortcuts name and no part the list waits for, so the list is rendered by its search alone.
 * @param contentIds - The ids that elements of the page's own content carry before the list is installed; each such element reads "Content of the page".
 * @returns The no-match line, what the dialog shows of it, the two ways a learner changes the search, and what the dialog and a focused control are named and described by.
 * @example
 * ```ts
 * const list = installedList()
 * list.search('seek')
 * list.read() // => { isInDialog: true, isHidden: false, text: '', margin: '0', rowCount: 1 }
 * ```
 */
function installedList(contentIds: string[] = []) {
  const created: ListElement[] = []
  const body = new ListElement('body')
  for (const id of contentIds) {
    const content = new ListElement('h2')
    content.id = id
    content.textContent = 'Content of the page'
    body.append(content)
  }
  runInNewContext(
    `(${installShortcutHelp.toString()})(entries, '#no-such-part')`,
    {
      entries: [
        {
          action: 'Seek forward one second',
          keys: '→ / ↑',
          context: 'Focused recording timeline',
        },
        {
          action: 'Close keyboard shortcuts',
          keys: 'Esc',
          context: 'Keyboard shortcuts dialog',
        },
      ],
      document: {
        body,
        createElement(tagName: string): ListElement {
          const element = new ListElement(tagName)
          created.push(element)
          return element
        },
        // The list asks only whether an id is taken ("#id") and whether its part of the page is shown, which this page has none of.
        querySelector: (selector: string): ListElement | null =>
          (selector.startsWith('#')
            ? body.firstWithId(selector.slice(1))
            : undefined) ?? null,
        querySelectorAll: (): ListElement[] => [],
        addEventListener(): void {},
      },
    },
  )
  /** Finds the one element the list created that a test names; a list that created none fails the test here. */
  const only = (isNamed: (element: ListElement) => boolean): ListElement => {
    const found = created.filter(isNamed)
    assert.equal(found.length, 1)
    return found[0]!
  }
  const dialog = only((element) => element.tagName === 'dialog'),
    line = only((element) => element.attributes.get('role') === 'status'),
    searchField = only((element) => element.tagName === 'input'),
    rows = only((element) => element.className === 'shortcut-list'),
    clearButton = only((element) => element.textContent === 'Clear search')
  /** Runs every listener an element has for one event, as the browser does at that event. */
  const fire = (element: ListElement, type: string): void => {
    for (const listener of element.listeners.get(type) ?? []) listener()
  }
  return {
    /** Reads the no-match line: whether it is a child of the dialog, whether it or the dialog is hidden, its sentence, its own margin, and how many shortcuts the list shows. */
    read: () => ({
      isInDialog: line.parent === dialog,
      isHidden: line.hidden || dialog.hidden,
      text: line.textContent,
      margin: line.style.margin,
      rowCount: rows.children.reduce(
        (count, group) =>
          count +
          group.children.filter((row) => row.className === 'shortcut-row')
            .length,
        0,
      ),
    }),
    /** Types a query into the search field. */
    search(query: string): void {
      searchField.value = query
      fire(searchField, 'input')
    },
    /** Presses Clear search. */
    clear(): void {
      fire(clearButton, 'click')
    },
    /** Reads what names the dialog: the id its `aria-labelledby` states and the text of the first element of the page with that id, which is its accessible name. */
    dialogName: () => {
      const id = dialog.attributes.get('aria-labelledby') ?? ''
      return { id, text: body.firstWithId(id)?.textContent }
    },
    /** Puts the keyboard focus on the dialog's Close button, which shows the tooltip, and reads what describes the button: the id its `aria-describedby` states and the text of the first element of the page with that id. */
    describedClose: () => {
      const closeButton = only(
        (element) =>
          element.attributes.get('aria-label') === 'Close keyboard shortcuts',
      )
      fire(closeButton, 'focus')
      const id = closeButton.attributes.get('aria-describedby') ?? ''
      return { id, text: body.firstWithId(id)?.textContent }
    },
  }
}

// Value: protects=a learner who uses a screen reader hearing "No shortcuts match." when a search of the Keyboard shortcuts list matches nothing, in the Study pane and in the Wiki reader; fails_when=the line is created with its sentence and taken out with `hidden` until a search has no match, so it enters the page together with its text and is probably not announced (the mechanism of rows 63 and 74), or the empty line keeps a paragraph's margin and opens a gap under the list; why_new=Cycle 0046 row 81 (found in a native check); seam=a hand-written page that has only what the list uses
test('the Keyboard shortcuts list keeps its no-match line in the dialog, not hidden and empty, while a search has matches; a search without a match gives it its sentence, and a matching search or Clear search empties it again', () => {
  // Arrange: the list installed in a page with two shortcuts; nothing was searched yet.
  const list = installedList()
  const beforeSearch = list.read()

  // Act: a search with a match, one without, one with a match again, one without, and Clear search.
  list.search('seek')
  const withMatch = list.read()
  list.search('no-such-shortcut')
  const withoutMatch = list.read()
  list.search('seek')
  const withMatchAgain = list.read()
  list.search('no-such-shortcut')
  list.clear()
  const afterClear = list.read()

  // Assert
  assert.deepEqual(beforeSearch, {
    isInDialog: true,
    isHidden: false,
    text: '',
    margin: '',
    rowCount: 0,
  })
  assert.deepEqual(withMatch, {
    isInDialog: true,
    isHidden: false,
    text: '',
    margin: '0',
    rowCount: 1,
  })
  assert.deepEqual(withoutMatch, {
    isInDialog: true,
    isHidden: false,
    text: 'No shortcuts match.',
    margin: '',
    rowCount: 0,
  })
  assert.deepEqual(withMatchAgain, {
    isInDialog: true,
    isHidden: false,
    text: '',
    margin: '0',
    rowCount: 1,
  })
  assert.deepEqual(afterClear, {
    isInDialog: true,
    isHidden: false,
    text: '',
    margin: '0',
    rowCount: 2,
  })
})

// Value: protects=the Keyboard shortcuts dialog being named "Keyboard shortcuts" and its tooltip describing the control it belongs to, also on a Wiki page whose own content carries the ids the list uses; fails_when=the list names its dialog and its tooltip through the fixed ids `shortcut-title` and `shortcut-tooltip`, so on a page that holds a heading with one of them (published before the publisher kept such ids apart) a screen reader reads that heading as the dialog's name or as the control's description, because it stands first in the page; why_new=Cycle 0046 row 101 (found by the Wiki reader's fixer); seam=a hand-written page whose content carries the ids
test('on a page whose content carries the ids shortcut-title and shortcut-tooltip the Keyboard shortcuts dialog is still named by its own heading and a focused control is still described by the tooltip, and on a page without them both keep those ids', () => {
  // Arrange: a page whose content holds both ids, and the tooltip's id with the number 2 as well; and a page that holds none.
  const onPageWithTheIds = installedList([
      'shortcut-title',
      'shortcut-tooltip',
      'shortcut-tooltip-2',
    ]),
    onPageWithoutThem = installedList()

  // Act
  const named = {
    dialog: onPageWithTheIds.dialogName(),
    close: onPageWithTheIds.describedClose(),
  }
  const namedWithoutThem = {
    dialog: onPageWithoutThem.dialogName(),
    close: onPageWithoutThem.describedClose(),
  }

  // Assert
  assert.deepEqual(named, {
    dialog: { id: 'shortcut-title-2', text: 'Keyboard shortcuts' },
    close: {
      id: 'shortcut-tooltip-3',
      text: 'Close keyboard shortcuts — Esc',
    },
  })
  assert.deepEqual(namedWithoutThem, {
    dialog: { id: 'shortcut-title', text: 'Keyboard shortcuts' },
    close: { id: 'shortcut-tooltip', text: 'Close keyboard shortcuts — Esc' },
  })
})
