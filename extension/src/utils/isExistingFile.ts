import { stat } from 'node:fs/promises'

/**
 * Says whether a path is a file (not a folder) on this computer now; called by the LLM Wiki view's Reveal Wiki Folder command when the Wiki output is not a folder, to tell a file in the folder's place from nothing at all.
 * @param filePath - The absolute path to look at.
 * @returns `true` for a file (a link to a file counts); `false` for a folder, nothing there, or a path that cannot be read.
 * @example
 * await isExistingFile('/repo/.codebook/wiki') // => true when a file stands there
 * await isExistingFile('/repo/missing')        // => false
 */
export async function isExistingFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}
