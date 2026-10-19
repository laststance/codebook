import { link, lstat } from 'node:fs/promises'

import { dropSecondNameOfOneFile } from './dropSecondNameOfOneFile'
import { passIfMissing } from './passIfMissing'
import { systemErrorCode } from './systemErrorCode'

/** The codes with which a link that puts a moved file back does nothing, as wanted: the place is taken (`EEXIST`), or there is no moved file (`ENOENT`). */
const NOTHING_TO_PUT_BACK_CODES: ReadonlySet<string> = new Set([
  'EEXIST',
  'ENOENT',
])

/**
 * How {@link dropSecondNameOfMovedFile} ended.
 * - `dropped`: no second name is left (it was removed, or it never existed because nothing was moved)
 * - `kept`: the second name holds a file and the own path holds another one, or nothing a file could be opened at; both stay, and the caller says so
 * - `unopened`: one of the two names holds a file this user could not open at that moment ({@link dropSecondNameOfOneFile}); both stay, the caller says to free the file and to run its command again, and that run settles the names
 */
export type MovedFileUndoing = 'dropped' | 'kept' | 'unopened'

/**
 * Undoes what is left of a move of a file that turned out not to be Codebook's: the file gets its own path back when nothing is there, and the second name the move gave it is removed once the file stands at its own path too. Called by the recoveries of the Cursor skill ({@link deployCursorSkill}, {@link removeManagedCursorSkill}) and of the Cursor MCP catalog ({@link removeOwnedCursorMcpCatalog}) for a file that changed between their check and their move, at once and at the next call after a refusal or a crash.
 * Nothing is overwritten and no content is lost: the file is put back with a link, which never replaces what is there, and a name is removed only of a file that keeps its other name ({@link dropSecondNameOfOneFile}).
 * @param ownPath - The path the file was moved away from.
 * @param secondPath - The name the move gave it (in the same folder, or in Codebook's storage on the same volume).
 * @param describeRefusedLinkBack - Words the refusal for the code with which the file system refused to put the file back; the caller knows what the file is and which command the learner ran ({@link describeRefusedLinkBack}).
 * @returns What became of the second name ({@link MovedFileUndoing}).
 * @throws
 * - When the file system refuses the link back with another code (a file system without hard links, a folder that allows no new files): the caller's sentence, with the refusal as its cause; the file stays under its second name
 * - A failure without a code, and every failure of the removal: itself
 * @example
 * await dropSecondNameOfMovedFile('/home/user/.cursor/mcp.json', '/private/cursor-mcp-catalog/retired-1.mcp.json', (code) => `refused (${code})`) // => 'dropped'
 */
export async function dropSecondNameOfMovedFile(
  ownPath: string,
  secondPath: string,
  describeRefusedLinkBack: (code: string) => string,
): Promise<MovedFileUndoing> {
  // A link never replaces a file: it puts the moved file back only where its own path holds nothing.
  await link(secondPath, ownPath).catch((error: unknown) => {
    const code = systemErrorCode(error)
    if (NOTHING_TO_PUT_BACK_CODES.has(code)) return
    throw code
      ? new Error(describeRefusedLinkBack(code), { cause: error })
      : error
  })
  // The second name goes only as a name of the file that stands at its own path now.
  const drop = await dropSecondNameOfOneFile(ownPath, secondPath)
  if (drop !== 'not-one-file') return drop
  // Any entry under the second name is kept; one that holds nothing is dropped already.
  return (await lstat(secondPath).catch(passIfMissing)) ? 'kept' : 'dropped'
}
