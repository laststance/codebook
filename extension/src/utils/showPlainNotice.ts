import type * as vscode from 'vscode'

import { plainNotificationText } from './plainNotificationText'
import type { WikiUpdateNotice } from './wikiUpdateNotice'

/** How loud a notification is; it selects the editor's information, warning or error notification. */
export type NoticeSeverity = WikiUpdateNotice['severity']

/** The part of the editor's `window` that shows a notification; the caller passes `vscode.window`, a test passes its fake. */
type NoticeWindow = Pick<
  typeof vscode.window,
  'showInformationMessage' | 'showWarningMessage' | 'showErrorMessage'
>

/**
 * Shows one non-modal editor notification whose text the editor cannot turn into a link; the only place of the extension that calls the editor's `show…Message` for a notification.
 *
 * Why: the editor renders `[label](command:…)` in a notification as a link that runs a command, and almost every Codebook notification quotes outside text (a path, a setting, an error's own words). One helper applies {@link plainNotificationText} to every message, so a new notification cannot forget it; the `no-restricted-syntax` rule in `eslint.config.mjs` refuses a direct call anywhere else in `src`. Only a modal confirmation (`{ modal: true }`) still calls the editor itself.
 * Trigger: `activate` binds it to `vscode.window` as its local `showNotice(severity, message, ...actions)`; {@link StudyWorkspace} and {@link RepositoryReader} call it with `vscode.window`.
 *
 * @param window - The editor's `vscode.window`. It is a parameter because the tests load one module with a fake `vscode`, which a utility's own import would not receive.
 * @param severity - Which notification the editor shows.
 * @param message - The sentence as Codebook wrote it, with any outside text inside; link syntax in it is taken apart before it is shown.
 * @param actions - Button labels, shown in this order and as written; without any, the notification has no button.
 * @returns
 * - The label of the button the learner pressed
 * - `undefined` when the notification was dismissed, timed out or has no button
 *
 * @example
 * ```ts
 * void showPlainNotice(vscode.window, 'error', `Codebook could not open DeepWiki: ${String(error)}`)
 * const choice = await showPlainNotice(vscode.window, 'information', 'Move the summary?', 'Move view')
 * // choice => 'Move view' | undefined
 * ```
 */
export function showPlainNotice<Action extends string>(
  window: NoticeWindow,
  severity: NoticeSeverity,
  message: string,
  ...actions: Action[]
): Thenable<Action | undefined> {
  const plainMessage = plainNotificationText(message)
  // Each method is called on the window itself, so the editor's API object keeps its receiver.
  if (severity === 'information')
    return window.showInformationMessage(plainMessage, ...actions)
  if (severity === 'warning')
    return window.showWarningMessage(plainMessage, ...actions)
  return window.showErrorMessage(plainMessage, ...actions)
}
