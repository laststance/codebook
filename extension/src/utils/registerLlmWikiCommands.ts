import { homedir } from 'node:os'

import type * as vscode from 'vscode'

import {
  COPY_DETAILS_ACTION,
  COPY_WIKI_RECOVERY_REQUEST_COMMAND,
  LLM_WIKI_MANAGE_TRUST_FAILED_NOTICE,
  LLM_WIKI_MANAGE_TRUST_FALLBACK_NOTICE,
  llmWikiFolderLocationFailedNotice,
  LLM_WIKI_RECOVERY_REQUEST_COPIED_NOTICE,
  LLM_WIKI_ROW_ACTIONS,
  MANAGE_WORKSPACE_TRUST_COMMAND,
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

import { describeUnrevealableWikiFolder } from './describeUnrevealableWikiFolder'
import type { LlmWikiView } from './llmWikiView'
import { thrownMessage } from './thrownMessage'
import { wikiFolderKindOf } from './wikiFolderKindOf'
import { wikiOutputLabel } from './wikiOutputLabel'
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
  /** The opened project and the resolved Wiki folder. */
  findWikiLocation: () => Promise<{
    projectRoot: string
    outputDirectory: string
  }>
  /** Writes a failure to Output › Codebook, as the view's own record does. */
  recordFailure: (message: string, cause: unknown) => void
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
 * Runs the editor's Manage Workspace Trust command; says where to find it when the editor's command list lacks it, and that it could not open when the editor has the command and it rejects.
 *
 * Trigger: the Manage Workspace Trust action of the view's trust row ({@link registerLlmWikiCommands}).
 * @param options - The window's closures.
 * @returns Nothing; a rejection is recorded in Output › Codebook; the learner gets the Command Palette notice for a missing command and the could-not-open notice for any other rejection.
 * @example await manageTrust(options)
 */
async function manageTrust(options: LlmWikiCommandOptions): Promise<void> {
  try {
    await options.editor.commands.executeCommand(MANAGE_WORKSPACE_TRUST_COMMAND)
  } catch (cause) {
    options.recordFailure('Manage Workspace Trust could not run', cause)
    // Whether the editor has the command decides the notice, never the wording of its error: absent, the learner is pointed to the Command Palette; present, the command failed.
    // A list that cannot be read (a rejection or a synchronous throw) leaves the command's presence unknown: the Command Palette route always works, so the hint is shown.
    let editorCommands: readonly string[] = []
    try {
      editorCommands = await options.editor.commands.getCommands(true)
    } catch {
      // Unknown list: assume the command is absent.
    }
    void options.showNotice(
      'information',
      editorCommands.includes(MANAGE_WORKSPACE_TRUST_COMMAND)
        ? LLM_WIKI_MANAGE_TRUST_FAILED_NOTICE
        : LLM_WIKI_MANAGE_TRUST_FALLBACK_NOTICE,
    )
  }
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
 * context.subscriptions.push(...registerLlmWikiCommands({ editor: vscode, registerCommand, showNotice, view, cancelRun, findWikiLocation, recordFailure }))
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
        LLM_WIKI_RECOVERY_REQUEST_COPIED_NOTICE,
      )
    }),
    registerCommand(REVEAL_WIKI_FOLDER_COMMAND, async () => {
      let location: Awaited<ReturnType<typeof options.findWikiLocation>>
      try {
        location = await options.findWikiLocation()
      } catch (cause) {
        // A setting that names no usable folder (empty, or outside the project) would otherwise fail without a word.
        options.recordFailure(
          'Reveal Wiki Folder could not resolve the Wiki folder',
          cause,
        )
        void options.showNotice(
          'information',
          llmWikiFolderLocationFailedNotice(thrownMessage(cause)),
        )
        return
      }
      const { projectRoot, outputDirectory } = location
      // The editor's reveal shows nothing for a missing folder or one on a remote host, so the learner is told instead.
      const reason = describeUnrevealableWikiFolder({
        outputLabel: wikiOutputLabel(projectRoot, outputDirectory),
        // One look tells a folder, a file, nothing and an unreadable path apart, each with its own sentence.
        folderKind: await wikiFolderKindOf(outputDirectory),
        remoteName: editor.env.remoteName,
      })
      if (reason !== undefined) {
        void options.showNotice('information', reason)
        return
      }
      await editor.commands.executeCommand(
        REVEAL_FILE_IN_OS_COMMAND,
        editor.Uri.file(outputDirectory),
      )
    }),
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
