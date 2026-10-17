import { systemErrorCode } from './systemErrorCode'

/**
 * Lets only the failure "nothing is there" pass, so that a look or a removal answers a missing path with `undefined` and every other failure with the system's error; the one place that says what absent means for a file system call.
 * Called as the rejection handler of the module's own call (`lstat(path).catch(passIfMissing)`), so a test that stands in for `node:fs/promises` of that module still sees the call: by {@link removeWithoutFollowing} and its helpers for each of their calls (an entry another window removed in the same moment is removed), by {@link dropSecondNameOfMovedFile} for the second name, by the Cursor MCP catalog ({@link refreshCursorMcpCatalog}) for Cursor's settings folder and the config's path, and by the skill setup ({@link deployCursorSkill}) for each path it looks at before it changes it.
 * @param error - What the call threw.
 * @returns `undefined` for `ENOENT`.
 * @throws The given error itself for every other failure.
 * @example
 * await lstat('/home/user/.cursor').catch(passIfMissing) // => undefined in a home without Cursor's settings folder
 * await lstat('/root/secret').catch(passIfMissing)       // throws EACCES
 */
export function passIfMissing(error: unknown): undefined {
  if (systemErrorCode(error) !== 'ENOENT') throw error
  return undefined
}
