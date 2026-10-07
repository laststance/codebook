import type { BigIntStats } from 'node:fs'
import { lstat } from 'node:fs/promises'

import { systemErrorCode } from './systemErrorCode'

/**
 * Looks at a path without following a link at it, for {@link areNamesOfOneFile}; a path that holds nothing is no error there.
 * @param path - The path.
 * @returns Its status with exact numbers, or undefined when nothing is at the path.
 * @throws Every other failure of the look.
 * @example await statusAt('/home/user/.cursor/mcp.json') // => undefined for a missing file
 */
async function statusAt(path: string): Promise<BigIntStats | undefined> {
  return lstat(path, { bigint: true }).catch((error: unknown) => {
    if (systemErrorCode(error) === 'ENOENT') return undefined
    throw error
  })
}

/**
 * Says whether two paths are names of one file (hard links of it), by the device and the inode number of both, read exactly and without following a link; called by {@link dropSecondNameOfMovedFile} and by the Cursor skill's setup recovery ({@link deployCursorSkill}), which remove a second name only of the file that also stands at its own path.
 * @param firstPath - One path.
 * @param secondPath - The other path.
 * @returns `true` when both paths hold the same file; `false` for two files, and when either path holds nothing.
 * @example
 * await areNamesOfOneFile('/home/user/.cursor/mcp.json', '/private/cursor-mcp-catalog/retired-1.mcp.json') // => true after the config was linked back
 */
export async function areNamesOfOneFile(
  firstPath: string,
  secondPath: string,
): Promise<boolean> {
  const first = await statusAt(firstPath)
  const second = await statusAt(secondPath)
  if (!first || !second) return false
  return first.dev === second.dev && first.ino === second.ino
}
