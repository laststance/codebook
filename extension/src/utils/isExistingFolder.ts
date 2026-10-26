import { stat } from 'node:fs/promises'

/**
 * Says whether a path is a folder on this computer now; called by the LLM Wiki view's Reveal Wiki Folder command before it asks the editor to reveal the Wiki folder.
 * @param folderPath - The absolute path to look at.
 * @returns `true` for a folder (a link to a folder counts); `false` when nothing is there, a file is there, or the path cannot be read.
 * @example
 * await isExistingFolder('/repo/.codebook/wiki') // => true
 * await isExistingFolder('/repo/missing')        // => false
 */
export async function isExistingFolder(folderPath: string): Promise<boolean> {
  try {
    return (await stat(folderPath)).isDirectory()
  } catch {
    return false
  }
}
