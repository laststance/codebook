import { readFile } from 'node:fs/promises'

import { StudyError } from '../errors'

/**
 * Reads a declared file, wording a directory or unreadable file as a configuration refusal instead of a raw file system error.
 * Called by {@link resolveChromeExtensionRun} for the surface page and by the extension source for each stop file.
 * @param absolutePath - The file's absolute path.
 * @param declaredPath - The path as declared, quoted in the refusal.
 * @param field - The configuration field named in the refusal.
 * @returns The file's bytes.
 * @throws `INVALID_CONFIGURATION` "`<field> is not a readable file: <path>.`".
 * @example
 * await readFileOrRefuse('/repo/ext/popup.js', 'popup.js', 'configuration.stops[0].path') // => <Buffer …>
 */
export async function readFileOrRefuse(
  absolutePath: string,
  declaredPath: string,
  field: string,
): Promise<Buffer> {
  try {
    return await readFile(absolutePath)
  } catch {
    throw new StudyError(
      'INVALID_CONFIGURATION',
      `${field} is not a readable file: ${declaredPath}.`,
    )
  }
}
