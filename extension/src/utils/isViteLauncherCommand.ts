import { isAbsolute } from 'node:path'

import {
  VITE_LAUNCHER_MESSAGES,
  VITE_LIBRARY_WALK_ENTRY_LIMIT_COUNT,
} from '../constants'
import type { ViteLauncherCommand } from '../viteLauncherProtocol'

/**
 * Tells whether a value received over the launcher's IPC channel is one of the commands the extension sends after the facts.
 *
 * Why it exists: IPC data is untrusted until checked, so the launcher never casts it. Called by the Vite launcher module (`viteLauncher.ts`) for the reply to its facts; any other shape is treated as a refusal.
 *
 * @param message - The value received from the channel.
 * @returns `true` for `{ type: 'vite-listen' }`, `{ type: 'vite-refuse' }`, `{ type: 'vite-await-optimizer' }` and a well-formed `vite-library-modules` command (integer `requestId`, `entries` an array of at most 64 strings that start with "/", `libraryFolder` an absolute path), `false` for anything else.
 * @example
 * isViteLauncherCommand({ type: 'vite-listen' }) // => true
 * isViteLauncherCommand('listen') // => false
 */
export function isViteLauncherCommand(
  message: unknown,
): message is ViteLauncherCommand {
  if (typeof message !== 'object' || message === null) return false
  const { type } = message as { type?: unknown }
  if (type === VITE_LAUNCHER_MESSAGES.libraryModules)
    return isLibraryModulesCommand(message)
  return (
    type === VITE_LAUNCHER_MESSAGES.listen ||
    type === VITE_LAUNCHER_MESSAGES.refuse ||
    type === VITE_LAUNCHER_MESSAGES.awaitOptimizer
  )
}

/**
 * Checks every field of a `vite-library-modules` command, because the walk trusts them.
 *
 * Why it exists: the command carries data the launcher walks and compares paths with, so one malformed field must make the whole command a refusal. Called by {@link isViteLauncherCommand} for that command type only.
 *
 * @param message - A non-null object whose `type` is the library-modules command.
 * @returns `true` when `requestId` is an integer, `entries` a short array of strings that start with "/" and `libraryFolder` an absolute path.
 * @example
 * isLibraryModulesCommand({ type: 'vite-library-modules', requestId: 1, entries: ['/src/main.tsx'], libraryFolder: '/repo/lib' }) // => true
 */
function isLibraryModulesCommand(message: object): boolean {
  const { requestId, entries, libraryFolder } = message as {
    requestId?: unknown
    entries?: unknown
    libraryFolder?: unknown
  }
  return (
    Number.isInteger(requestId) &&
    Array.isArray(entries) &&
    entries.length <= VITE_LIBRARY_WALK_ENTRY_LIMIT_COUNT &&
    // Each entry is a served URL path.
    entries.every(
      (entry) => typeof entry === 'string' && entry.startsWith('/'),
    ) &&
    typeof libraryFolder === 'string' &&
    isAbsolute(libraryFolder)
  )
}
