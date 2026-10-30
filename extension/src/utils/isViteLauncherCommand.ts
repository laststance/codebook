import { VITE_LAUNCHER_MESSAGES } from '../constants'
import type { ViteLauncherCommand } from '../viteLauncherProtocol'

/**
 * Tells whether a value received over the launcher's IPC channel is one of the commands the extension sends after the facts.
 *
 * Why it exists: IPC data is untrusted until checked, so the launcher never casts it. Called by the Vite launcher module (`viteLauncher.ts`) for the reply to its facts; any other shape is treated as a refusal.
 *
 * @param message - The value received from the channel.
 * @returns `true` for `{ type: 'vite-listen' }`, `{ type: 'vite-refuse' }` and `{ type: 'vite-await-optimizer' }`, `false` for anything else.
 * @example
 * isViteLauncherCommand({ type: 'vite-listen' }) // => true
 * isViteLauncherCommand('listen') // => false
 */
export function isViteLauncherCommand(
  message: unknown,
): message is ViteLauncherCommand {
  if (typeof message !== 'object' || message === null) return false
  const type = (message as { type?: unknown }).type
  return (
    type === VITE_LAUNCHER_MESSAGES.listen ||
    type === VITE_LAUNCHER_MESSAGES.refuse ||
    type === VITE_LAUNCHER_MESSAGES.awaitOptimizer
  )
}
