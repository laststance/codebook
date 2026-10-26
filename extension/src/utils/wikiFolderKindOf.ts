import { lstat, stat } from 'node:fs/promises'

import { WIKI_FOLDER_STAT_TIMEOUT_MS } from '../constants'

import { systemErrorCode } from './systemErrorCode'

/** What stands at the Wiki output path; `unreadable` carries the system error name of the failed look. */
export type WikiFolderKind =
  | { kind: 'folder' }
  | { kind: 'file' }
  | { kind: 'missing' }
  | { kind: 'dangling-link' }
  | { kind: 'unreadable'; code: string }

/** The file-system looks and the bound {@link wikiFolderKindOf} uses; a test replaces them. */
export type WikiFolderLook = {
  /** Follows links, as `fs.promises.stat`. */
  stat: (path: string) => Promise<{ isDirectory: () => boolean }>
  /** Does not follow links, as `fs.promises.lstat`. */
  lstat: (path: string) => Promise<{ isSymbolicLink: () => boolean }>
  /** How long the look may take before the path counts as unreadable (ms). */
  timeoutMs: number
}

/**
 * Looks once at the Wiki output path and says what stands there, so Reveal Wiki Folder can tell a folder, a file, nothing, a link to nothing and a path it cannot read apart.
 *
 * Why: one `stat` answers most of it, and only `ENOENT` means nothing is there; a permission or path error (`EACCES`, `ENOTDIR`, `ENAMETOOLONG`) must not be told as "does not exist (yet)", a link to nothing must not promise that Generate LLM Wiki creates the folder (generation refuses a link), and a dead mount that never answers must not leave the command without a word.
 * Trigger: the Reveal Wiki Folder command ({@link registerLlmWikiCommands}) asks it before it reveals the folder; {@link describeUnrevealableWikiFolder} words the answer.
 *
 * @param folderPath - The absolute path to look at.
 * @param look - The file-system looks and the bound; the real ones when omitted.
 * @returns
 * - A folder (a link to a folder counts): `{ kind: 'folder' }`
 * - Any other entry that exists (a file, or a special file): `{ kind: 'file' }`
 * - Nothing at the path (`ENOENT` for the path and for the link itself): `{ kind: 'missing' }`
 * - A symbolic link whose target is missing: `{ kind: 'dangling-link' }`
 * - Any other failure of the look, or no answer within the bound (`'ETIMEDOUT'`): `{ kind: 'unreadable', code }` (`'UNKNOWN'` when the error carries no code)
 * @example
 * await wikiFolderKindOf('/repo/.codebook/wiki')         // => { kind: 'folder' }
 * await wikiFolderKindOf('/repo/missing')                // => { kind: 'missing' }
 * await wikiFolderKindOf('/repo/a-file/.codebook/wiki')  // => { kind: 'unreadable', code: 'ENOTDIR' }
 */
export async function wikiFolderKindOf(
  folderPath: string,
  look: WikiFolderLook = {
    stat,
    lstat,
    timeoutMs: WIKI_FOLDER_STAT_TIMEOUT_MS,
  },
): Promise<WikiFolderKind> {
  const lookAtPath = async (): Promise<WikiFolderKind> => {
    try {
      return (await look.stat(folderPath)).isDirectory()
        ? { kind: 'folder' }
        : { kind: 'file' }
    } catch (error) {
      const code = systemErrorCode(error)
      if (code !== 'ENOENT')
        return { kind: 'unreadable', code: code || 'UNKNOWN' }
      // Nothing at the end of the path: a link that points to nothing is not the same as no entry.
      try {
        return (await look.lstat(folderPath)).isSymbolicLink()
          ? { kind: 'dangling-link' }
          : { kind: 'missing' }
      } catch (linkError) {
        const linkCode = systemErrorCode(linkError)
        return linkCode === 'ENOENT'
          ? { kind: 'missing' }
          : { kind: 'unreadable', code: linkCode || 'UNKNOWN' }
      }
    }
  }
  let timer: NodeJS.Timeout | undefined
  const noAnswer = new Promise<WikiFolderKind>((resolve) => {
    timer = setTimeout(
      () => resolve({ kind: 'unreadable', code: 'ETIMEDOUT' }),
      look.timeoutMs,
    )
  })
  try {
    return await Promise.race([lookAtPath(), noAnswer])
  } finally {
    clearTimeout(timer)
  }
}
