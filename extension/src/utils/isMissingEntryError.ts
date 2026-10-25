import { systemErrorCode } from './systemErrorCode'

/**
 * Says whether a file system call failed only because the entry, or a folder on its way, does not exist, so a search treats it as absent instead of as an unreadable folder.
 * Called by node-test's Vitest config walk ({@link readVitestConfigEntries}) and Vitest walk ({@link requireOwnedVitest}) after an `lstat`.
 * @param error - What the call threw.
 * @returns `true` for `ENOENT` and `ENOTDIR`; `false` for every other failure (`EACCES` included).
 * @example
 * isMissingEntryError(Object.assign(new Error('missing'), { code: 'ENOENT' })) // => true
 * isMissingEntryError(Object.assign(new Error('denied'), { code: 'EACCES' }))  // => false
 */
export function isMissingEntryError(error: unknown): boolean {
  const code = systemErrorCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
}
