import { readdir } from 'node:fs/promises'
import { dirname, isAbsolute, relative } from 'node:path'

import { reactScriptsInstallCommandOf } from '../reactScriptsRefusals'

/**
 * Lists the file names of the nearest folder, from the app up to the repository root, that holds a known lockfile.
 *
 * Why it exists: a nested app (`apps/app`) in a pnpm or yarn workspace has its lockfile at the repository root, so reading only the app folder would name `npm install` for a repository that installs with pnpm. Called by {@link assessExpoWebWorkspace} when `expo` is not installed.
 * @param appFolder - The app's absolute folder.
 * @param repositoryRoot - The repository's absolute root; the walk never goes above it.
 * @returns The file names of the nearest folder with a lockfile, or those of the app folder when none holds one.
 * @example await readInstallLockfileNames('/repo/apps/app', '/repo') // => ['package.json', 'pnpm-lock.yaml']
 */
export async function readInstallLockfileNames(
  appFolder: string,
  repositoryRoot: string,
): Promise<string[]> {
  const withoutLockfile = reactScriptsInstallCommandOf([])
  const appNames = await readdir(appFolder).catch(() => [])
  let folder = appFolder
  let names = appNames
  // Walk up one folder at a time and stop at the repository root.
  for (;;) {
    if (reactScriptsInstallCommandOf(names) !== withoutLockfile) return names
    const fromRoot = relative(repositoryRoot, folder)
    const parent = dirname(folder)
    if (
      fromRoot === '' ||
      fromRoot.startsWith('..') ||
      isAbsolute(fromRoot) ||
      parent === folder
    )
      return appNames
    folder = parent
    names = await readdir(folder).catch(() => [])
  }
}
