import type * as vscode from 'vscode'

import {
  WIKI_CHAT_WATCH_CANCEL_COMMAND,
  WIKI_CHAT_WATCH_STATUS_ID,
  WIKI_CHAT_WATCH_STATUS_NAME,
  WIKI_CHAT_WATCH_STATUS_TEXT,
  WIKI_CHAT_WATCH_TOOLTIP,
} from '../constants'

/** The members of the editor's status bar entry that {@link showWikiChatWatchStatus} sets, shows and hands back for disposal. */
export type WikiChatWatchEntry = Pick<
  vscode.StatusBarItem,
  | 'name'
  | 'text'
  | 'tooltip'
  | 'accessibilityInformation'
  | 'command'
  | 'show'
  | 'dispose'
>

/** What {@link showWikiChatWatchStatus} needs of the editor's `vscode.window`: the entry it creates in the status bar. */
export type WikiChatWatchStatusBar = {
  createStatusBarItem(
    id: string,
    alignment: vscode.StatusBarAlignment,
  ): WikiChatWatchEntry
}

/**
 * Shows the watch of a VS Code Wiki update as one status bar entry: its visible state, and its Cancel, which a press on the entry runs.
 *
 * Why: the watch lasts up to 15 minutes, while the chat asks the learner to approve its steps. The editor stacks notifications at the window's lower right, where the Chat view has its default place, so any other notification pushed a notification of the watch over the approval's Allow and Skip buttons. The status bar lies below every notification.
 * Trigger: the extension's watch of a VS Code update, from the chat's first sign until the run's end is recorded; the extension disposes the entry then.
 *
 * @param window - The editor's `vscode.window`. It is a parameter because the tests load the extension with a fake `vscode`, which a utility's own import would not receive.
 * @param alignment - The side of the status bar: the editor's `vscode.StatusBarAlignment.Right`, the side of Codebook's learning replay entry.
 * @returns The shown entry, which says what is watched and names its Cancel ({@link WIKI_CHAT_WATCH_STATUS_TEXT}) and runs {@link WIKI_CHAT_WATCH_CANCEL_COMMAND} when pressed; disposing it removes it.
 *
 * @example
 * ```ts
 * const entry = showWikiChatWatchStatus(vscode.window, vscode.StatusBarAlignment.Right)
 * entry.text // => '$(sync~spin) Watching for the LLM Wiki update · Cancel'
 * entry.command // => 'codebook.cancelWikiChatWatch'
 * entry.dispose() // the entry leaves the status bar
 * ```
 */
export function showWikiChatWatchStatus(
  window: WikiChatWatchStatusBar,
  alignment: vscode.StatusBarAlignment,
): WikiChatWatchEntry {
  const entry = window.createStatusBarItem(WIKI_CHAT_WATCH_STATUS_ID, alignment)
  entry.name = WIKI_CHAT_WATCH_STATUS_NAME
  entry.text = WIKI_CHAT_WATCH_STATUS_TEXT
  entry.tooltip = WIKI_CHAT_WATCH_TOOLTIP
  // A screen reader reads the sentence instead of the icon's name, and announces the entry as the button it is.
  entry.accessibilityInformation = {
    label: WIKI_CHAT_WATCH_TOOLTIP,
    role: 'button',
  }
  entry.command = WIKI_CHAT_WATCH_CANCEL_COMMAND
  entry.show()
  return entry
}
