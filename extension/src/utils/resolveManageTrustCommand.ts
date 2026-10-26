import { MANAGE_WORKSPACE_TRUST_COMMAND_IDS } from '../constants'

/**
 * Picks the id of the editor's command that manages workspace trust from the commands the editor lists.
 *
 * Why: the command's id is not documented and may differ between VS Code and Cursor ({@link MANAGE_WORKSPACE_TRUST_COMMAND_IDS}); the first listed one is run, and none lets the caller say where to find it.
 * Trigger: the LLM Wiki view's Manage Workspace Trust action.
 *
 * @param availableCommands - The ids `vscode.commands.getCommands(true)` lists.
 * @returns The first known id the editor lists; `undefined` when it lists none.
 * @example
 * resolveManageTrustCommand(['workbench.trust.manage', 'other']) // => 'workbench.trust.manage'
 * resolveManageTrustCommand(['other'])                            // => undefined
 */
export function resolveManageTrustCommand(
  availableCommands: readonly string[],
): string | undefined {
  return MANAGE_WORKSPACE_TRUST_COMMAND_IDS.find((commandId) =>
    availableCommands.includes(commandId),
  )
}
