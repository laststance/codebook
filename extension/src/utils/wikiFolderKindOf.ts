import { stat } from 'node:fs/promises'

import { systemErrorCode } from './systemErrorCode'

/** What stands at the Wiki output path; `unreadable` carries the system error name of the failed look. */
export type WikiFolderKind =
  | { kind: 'folder' }
  | { kind: 'file' }
  | { kind: 'missing' }
  | { kind: 'unreadable'; code: string }

/**
 * Looks once at the Wiki output path and says what stands there, so Reveal Wiki Folder can tell a folder, a file, nothing and a path it cannot read apart.
 *
 * Why: one `stat` answers all four, and only `ENOENT` means nothing is there; a permission or path error (`EACCES`, `ENOTDIR`, `ENAMETOOLONG`) must not be told as "does not exist (yet)".
 * Trigger: the Reveal Wiki Folder command ({@link registerLlmWikiCommands}) asks it before it reveals the folder; {@link describeUnrevealableWikiFolder} words the answer.
 *
 * @param folderPath - The absolute path to look at.
 * @returns
 * - A folder (a link to a folder counts): `{ kind: 'folder' }`
 * - Any other entry that exists (a file, or a special file): `{ kind: 'file' }`
 * - Nothing at the path (`ENOENT`): `{ kind: 'missing' }`
 * - Any other failure of the look: `{ kind: 'unreadable', code }` (`'UNKNOWN'` when the error carries no code)
 * @example
 * await wikiFolderKindOf('/repo/.codebook/wiki')         // => { kind: 'folder' }
 * await wikiFolderKindOf('/repo/missing')                // => { kind: 'missing' }
 * await wikiFolderKindOf('/repo/a-file/.codebook/wiki')  // => { kind: 'unreadable', code: 'ENOTDIR' }
 */
export async function wikiFolderKindOf(
  folderPath: string,
): Promise<WikiFolderKind> {
  try {
    return (await stat(folderPath)).isDirectory()
      ? { kind: 'folder' }
      : { kind: 'file' }
  } catch (error) {
    const code = systemErrorCode(error)
    // Only a path with nothing at it is a folder that is not there yet.
    if (code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'unreadable', code: code || 'UNKNOWN' }
  }
}
