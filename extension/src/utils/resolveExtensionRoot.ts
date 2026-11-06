import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'

import { StudyError } from '../errors'

import { isInsideFolder } from './isInsideFolder'

/**
 * Resolves the declared extension root to its realpath inside the repository.
 * Called by the extension source for both adapters: the unpacked extension's folder, or the WXT project folder.
 * @param repositoryRoot - The repository's canonical path.
 * @param extensionRoot - The declared `extensionRoot`, relative to the repository.
 * @returns The folder's canonical absolute path.
 * @throws `INVALID_CONFIGURATION` when the root leaves the repository by name or through a link, or does not exist.
 * @example
 * await resolveExtensionRoot('/repo', 'ext') // => '/repo/ext'
 */
export async function resolveExtensionRoot(
  repositoryRoot: string,
  extensionRoot: string,
): Promise<string> {
  const outside = new StudyError(
    'INVALID_CONFIGURATION',
    'configuration.extensionRoot must stay inside the repository.',
  )
  const isInRepository = (path: string) =>
    path === repositoryRoot || isInsideFolder(repositoryRoot, path)
  const lexical = resolve(repositoryRoot, extensionRoot)
  if (!isInRepository(lexical)) throw outside
  const real = await realpath(lexical).catch(() => undefined)
  if (real === undefined)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      `configuration.extensionRoot does not exist: ${extensionRoot}.`,
    )
  if (!isInRepository(real)) throw outside
  return real
}
