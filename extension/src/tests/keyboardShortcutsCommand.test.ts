import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  showKeyboardShortcuts,
  type KeyboardShortcutsEditor,
  type KeyboardShortcutsQuickPick,
} from '../keyboardShortcutsCommand'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

type FakeItem = {
  label: string
  description?: string
  kind?: number
  alwaysShow?: boolean
}
type FakeButton = { iconPath: { id: string }; tooltip?: string }

/** A QuickPick stand-in that records what the command sets and lets a test fire the editor's events. */
class FakeQuickPick {
  title = ''
  placeholder = ''
  items: FakeItem[] = []
  buttons: FakeButton[] = []
  selectedItems: FakeItem[] = []
  shown = 0
  hidden = 0
  disposed = false
  /** When true, hide() does not fire onDidHide; the test fires it later, as the host does on a later turn. */
  deferHideEvent = false
  private currentValue = ''
  private listeners: Record<string, Array<(argument?: unknown) => void>> = {}

  /** The host echoes a programmatic value change as onDidChangeValue. */
  get value(): string {
    return this.currentValue
  }
  set value(next: string) {
    this.currentValue = next
    this.fire('value', next)
  }

  private on(name: string) {
    return (listener: (argument?: never) => void) => {
      ;(this.listeners[name] ??= []).push(listener as never)
      return { dispose(): void {} }
    }
  }
  onDidChangeValue = this.on('value')
  onDidAccept = this.on('accept')
  onDidTriggerButton = this.on('button')
  onDidHide = this.on('hide')

  show(): void {
    this.shown += 1
  }
  hide(): void {
    this.hidden += 1
    if (!this.deferHideEvent) this.fire('hide')
  }
  dispose(): void {
    this.disposed = true
  }
  fire(name: string, argument?: unknown): void {
    for (const listener of this.listeners[name] ?? []) listener(argument)
  }
}

function pickAt(picks: FakeQuickPick[], index: number): FakeQuickPick {
  const pick = picks[index]
  if (!pick) throw new Error(`No QuickPick ${index} was created.`)
  return pick
}

function openEditor(options: { commandError?: Error } = {}) {
  const picks: FakeQuickPick[] = []
  const commands: unknown[][] = []
  const errorMessages: string[] = []
  const editor = {
    window: {
      createQuickPick: () => {
        const pick = new FakeQuickPick()
        picks.push(pick)
        return pick as unknown as KeyboardShortcutsQuickPick
      },
      showErrorMessage: async (message: string) => {
        errorMessages.push(message)
      },
    },
    commands: {
      executeCommand: async (...args: unknown[]) => {
        commands.push(args)
        if (options.commandError) throw options.commandError
      },
    },
    QuickPickItemKind: { Separator: -1 },
    ThemeIcon: class {
      constructor(readonly id: string) {}
    },
  } as unknown as KeyboardShortcutsEditor
  return { editor, picks, commands, errorMessages }
}

// Value: protects=the list a learner sees on opening: its title, search placeholder, the two title buttons and items the editor's own filter cannot hide; fails_when=a title or placeholder changes, a button is missing, or an item lacks alwaysShow; no_claim=real rendering (the fake QuickPick records, native checks look)
test('opens one list titled Keyboard shortcuts with a close button and a current key bindings button', () => {
  // Arrange
  const { editor, picks } = openEditor()

  // Act
  showKeyboardShortcuts(editor, 'darwin')
  const pick = pickAt(picks, 0)

  // Assert
  try {
    assert.equal(picks.length, 1)
    assert.equal(pick.title, 'Keyboard shortcuts')
    assert.equal(pick.placeholder, 'Search shortcuts')
    assert.deepEqual(
      pick.buttons.map((button) => [button.iconPath.id, button.tooltip]),
      [
        ['close', 'Close keyboard shortcuts'],
        ['gear', 'Show current key bindings'],
      ],
    )
    assert.equal(pick.shown, 1)
    assert.ok(pick.items.every((item) => item.alwaysShow))
  } finally {
    pick.fire('hide')
  }
})

// Value: protects=one list at a time; fails_when=a second call while the list is open creates a second QuickPick; no_claim=focus handling
test('a second call while the list is open shows the same list again', () => {
  // Arrange
  const { editor, picks } = openEditor()
  showKeyboardShortcuts(editor, 'linux')

  // Act
  showKeyboardShortcuts(editor, 'linux')

  // Assert
  try {
    assert.equal(picks.length, 1)
    assert.equal(pickAt(picks, 0).shown, 2)
  } finally {
    pickAt(picks, 0).fire('hide')
  }
})

// Value: protects=Codebook's own filter running on every keystroke and the no-match item clearing the search while the list stays open; fails_when=typing leaves the items stale, the no-match item keeps alwaysShow off, accepting it closes the list, keeps the search text or restores other items than the initial ones; no_claim=the host's own filter
test('typing zzz shows the no-match item, and accepting it clears the search and keeps the list open', () => {
  // Arrange
  const { editor, picks } = openEditor()
  showKeyboardShortcuts(editor, 'darwin')
  const pick = pickAt(picks, 0)
  const initialItems = [...pick.items]

  try {
    // Act
    pick.value = 'zzz'
    const noMatchItems = [...pick.items]
    pick.selectedItems = [pick.items[0] as FakeItem]
    pick.fire('accept')

    // Assert
    assert.deepEqual(
      noMatchItems.map((item) => [item.label, item.alwaysShow]),
      [['No shortcuts match "zzz"', true]],
    )
    assert.equal(pick.value, '')
    assert.deepEqual(pick.items, initialItems)
    assert.equal(pick.hidden, 0)
  } finally {
    pick.fire('hide')
  }
})

// Value: protects=the list never invoking a command of a shortcut it names; fails_when=accepting a shortcut keeps the list open or executes a command; no_claim=focus returning to the view (native checks own that)
test('accepting a shortcut closes the list and runs no command', () => {
  // Arrange
  const { editor, picks, commands } = openEditor()
  showKeyboardShortcuts(editor, 'darwin')
  const pick = pickAt(picks, 0)
  pick.selectedItems = [pick.items[1] as FakeItem]

  // Act
  pick.fire('accept')

  // Assert
  assert.equal(pick.hidden, 1)
  assert.equal(pick.disposed, true)
  assert.deepEqual(commands, [])
})

// Value: protects=the learner's route to a rebound key and the clearly labeled close control; fails_when=Show current key bindings runs another command or query or leaves the list open, or Close keyboard shortcuts leaves the list open; no_claim=that the Keyboard Shortcuts editor opens (a native check)
test('Show current key bindings hides the list and opens the Keyboard Shortcuts editor on the command, and Close keyboard shortcuts closes the list', async () => {
  // Arrange
  const { editor, picks, commands } = openEditor()
  showKeyboardShortcuts(editor, 'win32')
  const pick = pickAt(picks, 0)

  // Act
  pick.fire('button', pick.buttons[1])
  await waitUntil(() => commands.length === 1, 'the bindings command')
  const afterBindings = [...commands]
  const hiddenAfterBindings = pick.hidden
  showKeyboardShortcuts(editor, 'win32')
  const second = pickAt(picks, 1)
  try {
    second.fire('button', second.buttons[0])

    // Assert
    assert.deepEqual(afterBindings, [
      [
        'workbench.action.openGlobalKeybindings',
        'codebook.showKeyboardShortcuts',
      ],
    ])
    assert.equal(hiddenAfterBindings, 1)
    assert.equal(second.hidden, 1)
    assert.equal(commands.length, 1)
  } finally {
    second.fire('hide')
  }
})

// Value: protects=a failed Keyboard Shortcuts editor open telling the learner instead of rejecting unhandled; fails_when=the rejection is swallowed silently or the message is missing the cause; no_claim=the host's wording of the cause
test('a Keyboard Shortcuts editor that fails to open shows an error message with the cause', async () => {
  // Arrange
  const { editor, picks, errorMessages } = openEditor({
    commandError: new Error('no such command'),
  })
  showKeyboardShortcuts(editor, 'linux')
  const pick = pickAt(picks, 0)

  try {
    // Act
    pick.fire('button', pick.buttons[1])
    await waitUntil(() => errorMessages.length === 1, 'the error message')

    // Assert
    assert.deepEqual(errorMessages, [
      'Codebook could not open the Keyboard Shortcuts editor: no such command',
    ])
  } finally {
    pick.fire('hide')
  }
})

// Value: protects=a list opened right after a close being a new list; fails_when=a second call before the closed list's onDidHide shows the closing list again, or the late onDidHide clears the newer list; no_claim=the host's real hide timing
test('a call right after a close makes a new list, and the closed list’s late hide does not clear it', () => {
  // Arrange
  const { editor, picks } = openEditor()
  showKeyboardShortcuts(editor, 'darwin')
  const first = pickAt(picks, 0)
  first.deferHideEvent = true
  first.fire('button', first.buttons[0])

  // Act
  showKeyboardShortcuts(editor, 'darwin')
  const second = pickAt(picks, 1)
  first.fire('hide')
  showKeyboardShortcuts(editor, 'darwin')

  // Assert
  try {
    assert.equal(picks.length, 2)
    assert.equal(first.disposed, true)
    assert.equal(second.shown, 2)
  } finally {
    second.fire('hide')
  }
})
