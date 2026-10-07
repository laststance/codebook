import type { FileHandle } from 'node:fs/promises'

import { openWithoutFollowing } from './openWithoutFollowing'
import { systemErrorCode } from './systemErrorCode'

/** The codes of a name that holds no file this user can open: nothing (`ENOENT`), a link (`ELOOP`), and, where the opener looks at the path first, a pipe, a device or a folder (`ENOTREG`) or another file that took the name between the look and the open (`EREPLACED`); a file this user may not read (`EACCES`, `EPERM`), and one another program holds for itself (`EBUSY`, on Windows). */
const NO_FILE_TO_OPEN_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'ELOOP',
  'ENOTREG',
  'EREPLACED',
  'EACCES',
  'EPERM',
  'EBUSY',
])

/**
 * Opens one of the two names for {@link areNamesOfOneFile}, without following a link ({@link openWithoutFollowing}); a name that cannot be opened is an answer there, not an error.
 * @param path - The name.
 * @returns The open file, which the caller closes; undefined for a name that holds no file this user can open ({@link NO_FILE_TO_OPEN_CODES}).
 * @throws Every other failure of the open (too many open files, a failing disk): nothing is known of the name then.
 * @example const file = await openName('/home/user/.cursor/mcp.json') // => undefined for a missing file
 */
async function openName(path: string): Promise<FileHandle | undefined> {
  return openWithoutFollowing(path).catch((error: unknown) => {
    if (NO_FILE_TO_OPEN_CODES.has(systemErrorCode(error))) return undefined
    throw error
  })
}

/**
 * Says whether two open files are one file, by the device and the inode number of both, read exactly; called by {@link areNamesOfOneFile} while it holds both open.
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
 * Says whether two paths are names of one file (hard links of it); called by {@link dropSecondNameOfMovedFile}, by the Cursor skill's setup recovery ({@link deployCursorSkill}) and by the Cursor MCP catalog's ({@link refreshCursorMcpCatalog}), which remove a second name only of the file that also stands at its own path.
 * Both names are opened without following a link, and the device and inode numbers of the two open files are compared while both are open. A file system may give the inode number of a deleted file to the next file it creates (ext4 does so at once): two looks at the paths, one after the other, would call a new file under the second name "the same file" when the first file was deleted between them and its number went to the new one. A file that is open keeps its number, so two open files with one number are one file.
 * Both files are closed before the answer is given: the caller removes a name after it, and Windows does not always let a name of an open file go. The answer is therefore of the moment of the comparison; a name that is replaced after it is not seen.
 * @param firstPath - One path.
 * @param secondPath - The other path.
 * @returns `true` when both paths hold the same file; `false` for two files, and when either path holds nothing, a link, or a file this user cannot open ({@link openName}).
 * @throws A failure of an open that says nothing of the name (too many open files, a failing disk), and every failure of a look at an open file.
 * @example
 * await areNamesOfOneFile('/home/user/.cursor/mcp.json', '/private/cursor-mcp-catalog/retired-1.mcp.json') // => true after the config was linked back
 */
export async function areNamesOfOneFile(
  firstPath: string,
  secondPath: string,
): Promise<boolean> {
  const first = await openName(firstPath)
  if (!first) return false
  try {
    // The first file stays open while the second name is opened: its number cannot go to another file meanwhile.
    const second = await openName(secondPath)
    if (!second) return false
    try {
      return await isOneOpenFile(first, second)
    } finally {
      await second.close()
    }
  } finally {
    await first.close()
  }
}
