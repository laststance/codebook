import { unlink, type FileHandle } from 'node:fs/promises'

import { openWithoutFollowing } from './openWithoutFollowing'
import { systemErrorCode } from './systemErrorCode'

/** The codes of a name that holds no file to open: nothing (`ENOENT`), a link (`ELOOP`), and, where the opener looks at the path first, a pipe, a device or a folder (`ENOTREG`) or another file that took the name between the look and the open (`EREPLACED`). */
const NO_FILE_TO_OPEN_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'ELOOP',
  'ENOTREG',
  'EREPLACED',
])

/** The codes of a name that holds a file this user cannot open at this moment: no right to read it (`EACCES`, `EPERM`), or another program holds it for itself (`EBUSY`, on Windows). Once the file opens, the same call answers for it. */
const FILE_NOT_OPENED_CODES: ReadonlySet<string> = new Set([
  'EACCES',
  'EPERM',
  'EBUSY',
])

/** The codes with which a system refuses to remove a name of a file that is open: Windows answers a name it cannot let go with `EPERM`, `EBUSY` or `EACCES`. Elsewhere the same codes mean that the folder allows no removal at all, and the second try after the closes ends with them again. */
const NAME_OF_OPEN_FILE_KEPT_CODES: ReadonlySet<string> = new Set([
  'EPERM',
  'EBUSY',
  'EACCES',
])

/**
 * What became of a second name ({@link dropSecondNameOfOneFile}).
 * - `dropped`: it was removed, as a name of the file that keeps its own path
 * - `not-one-file`: the two names are not one file (two files, or a name that holds nothing or a link); nothing was removed
 * - `unopened`: a name holds a file this user could not open at that moment, so nothing is known and nothing was removed; the caller says so, and the same call answers once the file opens
 */
export type SecondNameDrop = 'dropped' | 'not-one-file' | 'unopened'

/** What {@link openName} found at a name: the open file, no file to open, or a file that could not be opened. */
type OpenedName = FileHandle | Exclude<SecondNameDrop, 'dropped'>

/**
 * Opens one of the two names for {@link dropSecondNameOfOneFile}, without following a link ({@link openWithoutFollowing}); a name that cannot be opened is an answer there, not an error.
 * @param path - The name.
 * @returns The open file, which the caller closes; `not-one-file` for a name that holds no file to open ({@link NO_FILE_TO_OPEN_CODES}); `unopened` for a file this user cannot open at this moment ({@link FILE_NOT_OPENED_CODES}).
 * @throws Every other failure of the open (too many open files, a failing disk): nothing is known of the name then.
 * @example const file = await openName('/home/user/.cursor/mcp.json') // => 'not-one-file' for a missing file
 */
async function openName(path: string): Promise<OpenedName> {
  return openWithoutFollowing(path).catch((error: unknown) => {
    const code = systemErrorCode(error)
    if (NO_FILE_TO_OPEN_CODES.has(code)) return 'not-one-file'
    if (FILE_NOT_OPENED_CODES.has(code)) return 'unopened'
    throw error
  })
}

/**
 * Says whether two open files are one file, by the device and the inode number of both, read exactly; called by {@link dropSecondNameOfOneFile} while it holds both open.
 * @param first - One open file.
 * @param second - The other open file.
 * @returns `true` when both have the same device and inode number.
 * @example await isOneOpenFile(first, second) // => true for two hard links of one file
 */
async function isOneOpenFile(
  first: FileHandle,
  second: FileHandle,
): Promise<boolean> {
  const firstStatus = await first.stat({ bigint: true }),
    secondStatus = await second.stat({ bigint: true })
  return (
    firstStatus.dev === secondStatus.dev && firstStatus.ino === secondStatus.ino
  )
}

/**
 * Removes a name of a file that is open, for {@link dropSecondNameOfOneFile} right after it compared the two open files: with the files still open where the system lets such a name go, and after the closes where it does not.
 * Which order a system takes is decided by its answer alone, never by its name: the removal is tried with the files open, and only a refusal with a code of {@link NAME_OF_OPEN_FILE_KEPT_CODES} is answered by closing the files and removing the name then.
 * @param namePath - The name to remove.
 * @param openFiles - The files the caller holds open; they are closed here only for the second try (the caller's own close of a closed file does nothing).
 * @throws Every other failure of the removal, and the failure of the second try: itself.
 * @example await unlinkNameOfOpenFile('/home/user/.cursor/skills/codebook/.codebook-displaced-1.tmp', [second, own])
 */
async function unlinkNameOfOpenFile(
  namePath: string,
  openFiles: readonly FileHandle[],
): Promise<void> {
  const refusal: unknown = await unlink(namePath).then(
    () => undefined,
    (error: unknown) => error,
  )
  if (refusal === undefined) return
  if (!NAME_OF_OPEN_FILE_KEPT_CODES.has(systemErrorCode(refusal))) throw refusal
  // This system keeps a name of an open file: the files are closed first, and the name is removed after that.
  for (const file of openFiles) await file.close()
  await unlink(namePath)
}

/**
 * Removes a second name of the file that also stands at its own path, and only of that file; called by {@link dropSecondNameOfMovedFile}, by the Cursor skill's setup recovery ({@link deployCursorSkill}) and by the Cursor MCP catalog's ({@link refreshCursorMcpCatalog}) for a name Codebook gave a file (a displaced or a staged name).
 * Both names are opened without following a link, and the device and inode numbers of the two open files are compared while both are open. A file system may give the inode number of a deleted file to the next file it creates (ext4 does so at once): two looks at the paths, one after the other, would call a new file under the second name "the same file" when the first file was deleted between them and its number went to the new one. A file that is open keeps its number, so two open files with one number are one file.
 * The name is removed right after the comparison, with both files still open where the system allows that ({@link unlinkNameOfOpenFile}): nothing is closed in between, so a file that takes the second name while the files are closed is never removed there. No file system has a call that removes a name only while it names a given open file, so a name that is replaced in the instant between the comparison and the removal is not seen, in either order.
 * @param ownPath - The path the file keeps.
 * @param secondPath - The name to remove when it is a second name of that file.
 * @returns
 * - `dropped`: both names were one file, and the second name is removed; the file keeps its own path
 * - `not-one-file`: nothing was removed: the names hold two files, or one of them holds nothing or a link
 * - `unopened`: nothing was removed: one of the names holds a file this user could not open at that moment ({@link openName}); the second name holds a file then
 * @throws A failure of an open that says nothing of the name (too many open files, a failing disk), every failure of a look at an open file, and a failure of the removal.
 * @example
 * await dropSecondNameOfOneFile('/home/user/.cursor/mcp.json', '/private/cursor-mcp-catalog/retired-1.mcp.json') // => 'dropped' after the config was linked back
 */
export async function dropSecondNameOfOneFile(
  ownPath: string,
  secondPath: string,
): Promise<SecondNameDrop> {
  // The second name is opened first: where it holds nothing, nothing is to remove, whatever stands at the own path.
  const second = await openName(secondPath)
  if (typeof second === 'string') return second
  try {
    // The second file stays open while the own path is opened: its number cannot go to another file meanwhile.
    const own = await openName(ownPath)
    if (typeof own === 'string') return own
    try {
      if (!(await isOneOpenFile(own, second))) return 'not-one-file'
      await unlinkNameOfOpenFile(secondPath, [second, own])
      return 'dropped'
    } finally {
      await own.close()
    }
  } finally {
    await second.close()
  }
}
