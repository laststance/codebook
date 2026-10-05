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
  append(...elements: ListElement[]): void {
    for (const element of elements) {
      element.parent = this
      this.children.push(element)
    }
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
 * @returns The no-match line, what the dialog shows of it, and the two ways a learner changes the search.
 * @example
 * ```ts
 * const list = installedList()
 * list.search('seek')
 * list.read() // => { isInDialog: true, isHidden: false, text: '', margin: '0', rowCount: 1 }
 * ```
 */
function installedList() {
  const created: ListElement[] = []
  const body = new ListElement('body')
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
        querySelector: (): null => null,
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
