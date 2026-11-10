import type * as vscode from 'vscode'

import {
  CLEAR_SEARCH_DESCRIPTION,
  itemsForQuery,
  KEYBOARD_SHORTCUTS_TITLE,
  keyboardShortcutItems,
  type ShortcutListItem,
} from './utils/keyboardShortcutItems'
import { showPlainNotice } from './utils/showPlainNotice'

/** The command id of the Keyboard shortcuts list; the keybinding, the title controls and the palette entry name it. */
export const SHOW_KEYBOARD_SHORTCUTS_COMMAND = 'codebook.showKeyboardShortcuts'
/** The placeholder of the list's search box. */
const SEARCH_PLACEHOLDER = 'Search shortcuts'
/** The tooltip of the title button that closes the list. */
const CLOSE_BUTTON_TOOLTIP = 'Close keyboard shortcuts'
/** The tooltip of the title button that opens the Keyboard Shortcuts editor on this command. */
const CURRENT_BINDINGS_BUTTON_TOOLTIP = 'Show current key bindings'
/** The editor command that opens the Keyboard Shortcuts editor, given a query. */
const OPEN_KEYBINDINGS_COMMAND = 'workbench.action.openGlobalKeybindings'

/** The members of the editor's QuickPick the list touches. */
export type KeyboardShortcutsQuickPick = Pick<
  vscode.QuickPick<vscode.QuickPickItem>,
  | 'title'
  | 'placeholder'
  | 'items'
  | 'buttons'
  | 'value'
  | 'selectedItems'
  | 'show'
  | 'hide'
  | 'dispose'
  | 'onDidChangeValue'
  | 'onDidAccept'
  | 'onDidTriggerButton'
  | 'onDidHide'
>

/** The slice of the editor API the list uses; the real `vscode` satisfies it and a test supplies a small stand-in. */
export interface KeyboardShortcutsEditor {
  window: Pick<
    typeof vscode.window,
    'showInformationMessage' | 'showWarningMessage' | 'showErrorMessage'
  > & { createQuickPick(): KeyboardShortcutsQuickPick }
  commands: {
    executeCommand(command: string, ...args: unknown[]): Thenable<unknown>
  }
  QuickPickItemKind: { Separator: number }
  ThemeIcon: new (id: string) => vscode.ThemeIcon
}

/** The list that is open now, so a second call shows it again instead of making another. */
let openList: KeyboardShortcutsQuickPick | undefined

/**
 * Turns the list's items into the editor's, each kept on screen by Codebook's own filter.
 *
 * @param editor - The editor API, for the separator kind.
 * @param items - What {@link itemsForQuery} gave.
 * @returns QuickPick items; every one has `alwaysShow` so the editor's filter hides none.
 * @example
 * ```ts
 * toQuickPickItems(editor, [{ kind: 'separator', label: 'Codebook views' }])
 * // [{ label: 'Codebook views', kind: editor.QuickPickItemKind.Separator, alwaysShow: true }]
 * ```
 */
function toQuickPickItems(
  editor: KeyboardShortcutsEditor,
  items: readonly ShortcutListItem[],
): vscode.QuickPickItem[] {
  return items.map((item) => {
    if (item.kind === 'separator')
      return {
        label: item.label,
        kind: editor.QuickPickItemKind.Separator,
        alwaysShow: true,
      }
    return {
      label: item.label,
      description: item.description,
      detail: item.kind === 'shortcut' ? item.detail : undefined,
      alwaysShow: true,
    }
  })
}

/**
 * Opens the native Keyboard shortcuts list that Codebook's views, title controls and Command Palette entry share.
 *
 * Triggered by the command {@link SHOW_KEYBOARD_SHORTCUTS_COMMAND}, which {@link activate} registers. The list never runs a command of its own shortcuts; accepting an item closes it.
 *
 * @param editor - The editor API (the real `vscode` or a stand-in).
 * @param platform - The host's `process.platform`, for the key notation.
 * @example
 * ```ts
 * registerCommand(SHOW_KEYBOARD_SHORTCUTS_COMMAND, () => showKeyboardShortcuts(vscode, process.platform))
 * ```
 */
export function showKeyboardShortcuts(
  editor: KeyboardShortcutsEditor,
  platform: NodeJS.Platform,
): void {
  // One list at a time: show the open one again.
  if (openList) {
    openList.show()
    return
  }
  const allItems = keyboardShortcutItems(platform)
  const closeButton = {
    iconPath: new editor.ThemeIcon('close'),
    tooltip: CLOSE_BUTTON_TOOLTIP,
  }
  const bindingsButton = {
    iconPath: new editor.ThemeIcon('gear'),
    tooltip: CURRENT_BINDINGS_BUTTON_TOOLTIP,
  }
  const list = editor.window.createQuickPick()
  // Closing paths release the module's open list first, so a call right after a close makes a new list.
  const closeList = (): void => {
    if (openList === list) openList = undefined
    list.hide()
  }
  list.title = KEYBOARD_SHORTCUTS_TITLE
  list.placeholder = SEARCH_PLACEHOLDER
  list.buttons = [closeButton, bindingsButton]
  list.items = toQuickPickItems(editor, allItems)
  const showQuery = (query: string): void => {
    list.items = toQuickPickItems(editor, itemsForQuery(allItems, query))
  }
  list.onDidChangeValue(showQuery)
  list.onDidAccept(() => {
    // The no-match item clears the search and keeps the list open; a shortcut closes it.
    if (list.selectedItems[0]?.description === CLEAR_SEARCH_DESCRIPTION) {
      list.value = ''
      showQuery('')
      return
    }
    closeList()
  })
  list.onDidTriggerButton(async (button) => {
    closeList()
    if (button !== bindingsButton) return
    try {
      await editor.commands.executeCommand(
        OPEN_KEYBINDINGS_COMMAND,
        SHOW_KEYBOARD_SHORTCUTS_COMMAND,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await showPlainNotice(
        editor.window,
        'error',
        `Codebook could not open the Keyboard Shortcuts editor: ${message}`,
      )
    }
  })
  list.onDidHide(() => {
    // A late hide of a closed list must not clear a newer list.
    if (openList === list) openList = undefined
    list.dispose()
  })
  list.show()
  openList = list
}
