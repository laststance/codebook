import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  showKeyboardShortcuts,
  type KeyboardShortcutsEditor,
  type KeyboardShortcutsQuickPick,
} from '../keyboardShortcutsCommand'

type FakeItem = { label: string; description?: string; kind?: number }
type FakeButton = { iconPath: { id: string }; tooltip?: string }

/** A QuickPick stand-in that records what the command sets and lets a test fire the editor's events. */
class FakeQuickPick {
  title = ''
  placeholder = ''
  items: FakeItem[] = []
  buttons: FakeButton[] = []
  value = ''
  selectedItems: FakeItem[] = []
  shown = 0
  hidden = 0
  disposed = false
  private listeners: Record<string, Array<(argument?: unknown) => void>> = {}

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
    this.fire('hide')
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

function openEditor() {
  const picks: FakeQuickPick[] = []
  const commands: unknown[][] = []
  const editor = {
    window: {
      createQuickPick: () => {
        const pick = new FakeQuickPick()
        picks.push(pick)
        return pick as unknown as KeyboardShortcutsQuickPick
      },
    },
    commands: {
      executeCommand: async (...args: unknown[]) => {
        commands.push(args)
      },
    },
    QuickPickItemKind: { Separator: -1 },
    ThemeIcon: class {
      constructor(readonly id: string) {}
    },
  } as unknown as KeyboardShortcutsEditor
  return { editor, picks, commands }
}

// Value: protects=the list a learner sees on opening: its title, search placeholder, the two title buttons and items the editor's own filter cannot hide; fails_when=a title or placeholder changes, a button is missing, or an item lacks alwaysShow; no_claim=real rendering (the fake QuickPick records, native checks look)
test('opens one list titled Keyboard shortcuts with a close button and a current key bindings button', () => {
  // Arrange
  const { editor, picks } = openEditor()

  // Act
  showKeyboardShortcuts(editor, 'darwin')
  const pick = pickAt(picks, 0)

  // Assert
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
  assert.ok(
    pick.items.every((item) => (item as { alwaysShow?: boolean }).alwaysShow),
  )
  pick.fire('hide')
})

// Value: protects=one list at a time; fails_when=a second call while the list is open creates a second QuickPick; no_claim=focus handling
test('a second call while the list is open shows the same list again', () => {
  // Arrange
  const { editor, picks } = openEditor()
  showKeyboardShortcuts(editor, 'linux')

  // Act
  showKeyboardShortcuts(editor, 'linux')

  // Assert
  assert.equal(picks.length, 1)
  assert.equal(pickAt(picks, 0).shown, 2)
  pickAt(picks, 0).fire('hide')
})

// Value: protects=Codebook's own filter running on every keystroke and the no-match item clearing the search while the list stays open; fails_when=typing leaves the items stale, accepting the no-match item closes the list or keeps the search text; no_claim=the host's own filter
test('typing zzz shows the no-match item, and accepting it clears the search and keeps the list open', () => {
  // Arrange
  const { editor, picks } = openEditor()
  showKeyboardShortcuts(editor, 'darwin')
  const pick = pickAt(picks, 0)
  const fullCount = pick.items.length

  // Act
  pick.value = 'zzz'
  pick.fire('value', 'zzz')
  const noMatchLabels = pick.items.map((item) => item.label)
  pick.selectedItems = [pick.items[0] as FakeItem]
  pick.fire('accept')

  // Assert
  assert.deepEqual(noMatchLabels, ['No shortcuts match "zzz"'])
  assert.equal(pick.value, '')
  assert.equal(pick.items.length, fullCount)
  assert.equal(pick.hidden, 0)
  pick.fire('hide')
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

// Value: protects=the learner's route to a rebound key and the clearly labeled close control; fails_when=Show current key bindings runs another command or query, or Close keyboard shortcuts leaves the list open; no_claim=that the Keyboard Shortcuts editor opens (a native check)
test('Show current key bindings opens the Keyboard Shortcuts editor on the command, and Close keyboard shortcuts closes the list', () => {
  // Arrange
  const { editor, picks, commands } = openEditor()
  showKeyboardShortcuts(editor, 'win32')
  const pick = pickAt(picks, 0)

  // Act
  pick.fire('button', pick.buttons[1])
  const afterBindings = [...commands]
  showKeyboardShortcuts(editor, 'win32')
  const second = pickAt(picks, 1)
  second.fire('button', second.buttons[0])

  // Assert
  assert.deepEqual(afterBindings, [
    [
      'workbench.action.openGlobalKeybindings',
      'codebook.showKeyboardShortcuts',
    ],
  ])
  assert.equal(second.hidden, 1)
  assert.equal(commands.length, 1)
})
