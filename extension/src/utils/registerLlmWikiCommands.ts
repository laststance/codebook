import { homedir } from 'node:os'

import type * as vscode from 'vscode'

import {
  COPY_DETAILS_ACTION,
  COPY_WIKI_RECOVERY_REQUEST_COMMAND,
  LLM_WIKI_ROW_ACTIONS,
  OPEN_CHAT_COMMAND,
  OPEN_FOLDER_COMMAND,
  OPEN_SETTINGS_COMMAND,
  REFRESH_LLM_WIKI_COMMAND,
  REVEAL_FILE_IN_OS_COMMAND,
  REVEAL_WIKI_FOLDER_COMMAND,
  SHOW_LLM_WIKI_ATTENTION_COMMAND,
  WIKI_OUTPUT_SETTINGS_QUERY,
  WIKI_UPDATE_RECOVERY_REQUEST,
} from '../constants'

import type { LlmWikiView } from './llmWikiView'
import { resolveManageTrustCommand } from './resolveManageTrustCommand'
import { withHomeFolderShown } from './withHomeFolderShown'

/** What the commands of the LLM Wiki view ask of the window. */
export type LlmWikiCommandOptions = {
  editor: Pick<typeof vscode, 'commands' | 'env' | 'Uri'>
  /** Registers a command of this window ({@link registerPlainCommand}). */
  register: (
    command: string,
    handler: (...args: never[]) => unknown,
  ) => vscode.Disposable
  /** Shows a notification; resolves with the pressed button. */
  showNotice: (
    severity: 'information' | 'warning' | 'error',
    message: string,
    ...actions: string[]
  ) => Thenable<string | undefined>
  view: LlmWikiView
  /** Stops this window's run: the VS Code watch, or the Cursor agent. */
  cancelRun: () => void
  /** The resolved Wiki folder. */
  findOutputDirectory: () => Promise<string>
}

/**
 * Shows the full sentence of an attention or last-attempt row, with Copy details; the click of those rows.
 * @param options - The window's closures.
 * @param rowId - The id of the clicked row.
 * @returns Nothing; the sentence is copied with the home folder shown as `~` when the learner presses Copy details.
 * @example await showRowDetail(options, 'attention')
 */
async function showRowDetail(
  options: LlmWikiCommandOptions,
  rowId: string,
): Promise<void> {
  const detail = options.view.findRow(rowId)?.detail
  if (detail === undefined) return
  const choice = await options.showNotice(
    'warning',
    detail,
    COPY_DETAILS_ACTION,
  )
  if (choice === COPY_DETAILS_ACTION)
    await options.editor.env.clipboard.writeText(
      withHomeFolderShown(detail, homedir()),
    )
}

/**
 * Runs the editor's command that manages workspace trust, or says where to find it when the editor lists none of the known ids.
 * @param options - The window's closures.
 * @returns Nothing.
 * @example await manageTrust(options)
 */
async function manageTrust(options: LlmWikiCommandOptions): Promise<void> {
  const available = await options.editor.commands.getCommands(true)
  const commandId = resolveManageTrustCommand(available)
  if (commandId === undefined) {
    void options.showNotice(
      'information',
      'Run "Workspaces: Manage Workspace Trust" from the Command Palette to trust this folder.',
    )
    return
  }
  await options.editor.commands.executeCommand(commandId)
}

/**
 * Registers every command of the LLM Wiki view: Refresh, the row sentence, the recovery request, the folder reveal and the wrappers of the row actions whose editor commands are not Codebook's own.
 *
 * Why: the manifest can show an inline action only for a command it contributes, so each action that runs an editor command, or one whose title differs by host (Stop watching, Cancel), is a Codebook command with the title the row needs.
 * Trigger: `activate()` calls it once per window beside the view.
 *
 * @param options - The window's closures ({@link LlmWikiCommandOptions}).
 * @returns The registrations, to dispose with the extension.
 * @example
 * context.subscriptions.push(...registerLlmWikiCommands({ editor: vscode, registerCommand, showNotice, view, cancelRun, findOutputDirectory }))
 */
export function registerLlmWikiCommands(
  options: LlmWikiCommandOptions,
): vscode.Disposable[] {
  const { register: registerCommand, editor } = options
  const cancelRun = (): void => options.cancelRun()
  return [
    registerCommand(REFRESH_LLM_WIKI_COMMAND, () => options.view.refresh()),
    registerCommand(SHOW_LLM_WIKI_ATTENTION_COMMAND, (rowId: string) =>
      showRowDetail(options, rowId),
    ),
    registerCommand(COPY_WIKI_RECOVERY_REQUEST_COMMAND, async () => {
      await editor.env.clipboard.writeText(WIKI_UPDATE_RECOVERY_REQUEST)
      void options.showNotice(
        'information',
        'Copied the recovery request. Paste it into the editor chat.',
      )
    }),
    registerCommand(REVEAL_WIKI_FOLDER_COMMAND, async () =>
      editor.commands.executeCommand(
        REVEAL_FILE_IN_OS_COMMAND,
        editor.Uri.file(await options.findOutputDirectory()),
      ),
    ),
    registerCommand(LLM_WIKI_ROW_ACTIONS['stop-watching'].command, cancelRun),
    registerCommand(LLM_WIKI_ROW_ACTIONS['cancel-run'].command, cancelRun),
    registerCommand(LLM_WIKI_ROW_ACTIONS['open-chat'].command, () =>
      editor.commands.executeCommand(OPEN_CHAT_COMMAND),
    ),
    registerCommand(LLM_WIKI_ROW_ACTIONS['change-location'].command, () =>
      editor.commands.executeCommand(
        OPEN_SETTINGS_COMMAND,
        WIKI_OUTPUT_SETTINGS_QUERY,
      ),
    ),
    registerCommand(LLM_WIKI_ROW_ACTIONS['open-folder'].command, () =>
      editor.commands.executeCommand(OPEN_FOLDER_COMMAND),
    ),
    registerCommand(LLM_WIKI_ROW_ACTIONS['manage-trust'].command, () =>
      manageTrust(options),
    ),
  ]
}
