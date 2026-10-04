import type * as vscode from 'vscode'

import { plainNotificationText } from './plainNotificationText'
import { thrownMessage } from './thrownMessage'

/**
 * Registers one Codebook command whose failure the editor cannot turn into a link; the only place of the extension that calls the editor's `registerCommand`.
 *
 * Why: when a command run from a keybinding, a status bar item or a menu rejects, the editor shows the rejection's message in a notification of its own and renders `[label](command:…)` in it as a link. A Codebook command's error can quote outside text (a setting, a path, a Wiki manifest), so every command rejects with that message passed through {@link plainNotificationText}; the thrown value stays reachable as the `cause`. The `no-restricted-syntax` rule in `eslint.config.mjs` refuses a direct `registerCommand` anywhere else in `src`.
 * Trigger: {@link activate} binds it to `vscode.commands` as its local `registerCommand(command, handler)` and registers every command through it.
 *
 * @param commands - The editor's `vscode.commands`. It is a parameter because the tests load one module with a fake `vscode`, which a utility's own import would not receive.
 * @param command - The command identifier, as contributed in `package.json`.
 * @param handler - What the command does; it may return a value or a promise, and may throw.
 * @returns The registration's disposable, for `context.subscriptions`.
 * @throws Never itself. The registered command rejects with a new `Error` that carries the plain message and the original failure as `cause`, also when the handler threw before its first `await`.
 *
 * @example
 * ```ts
 * context.subscriptions.push(
 *   registerPlainCommand(vscode.commands, 'codebook.openDeepWiki', async () => {
 *     throw new Error("no such file '/repo/[Open](command:x)'")
 *   }),
 * )
 * // the command rejects with "no such file '/repo/[Open] (command:x)'"
 * ```
 */
export function registerPlainCommand(
  commands: Pick<typeof vscode.commands, 'registerCommand'>,
  command: string,
  handler: Parameters<typeof vscode.commands.registerCommand>[1],
): vscode.Disposable {
  return commands.registerCommand(
    command,
    async (...commandArguments: unknown[]): Promise<unknown> => {
      try {
        return await handler(...commandArguments)
      } catch (error) {
        throw new Error(plainNotificationText(thrownMessage(error)), {
          cause: error,
        })
      }
    },
  )
}
