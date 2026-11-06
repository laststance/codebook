import { realpath } from 'node:fs/promises'

import {
  resolveDeclaredFolder,
  type PackageAppKind,
} from './resolveNextPackage'

/**
 * Resolves the folders a readiness judgement reads: the real repository root and the real app folder.
 *
 * Why it exists: the react-scripts and Expo web readiness judge an app from its declared `packageRoot` with one set of folder rules, so status and a start never disagree about which folder is the app. Called by {@link readReactScriptsPackageReadiness} and {@link readExpoWebPackageReadiness}.
 * @param repositoryRoot - The opened repository's root.
 * @param packageRoot - The declared `packageRoot`; `undefined` or `"."` for the root app.
 * @param appKind - Whose app the folder must hold, for the folder refusals' words.
 * @returns The real repository root and the real app folder (the same path for the root app).
 * @throws `INVALID_CONFIGURATION` when `packageRoot` is no folder inside the repository ({@link resolveDeclaredFolder}).
 * @example await resolveReadinessFolders('/repo', 'apps/app', 'expoWeb') // => { repositoryRoot: '/repo', packageRoot: '/repo/apps/app' }
 */
export async function resolveReadinessFolders(
  repositoryRoot: string,
  packageRoot: string | undefined,
  appKind: PackageAppKind,
): Promise<{ repositoryRoot: string; packageRoot: string }> {
  const declared = packageRoot ?? '.'
  // The root app is its repository's real path; a nested app goes through the shared folder rules.
  const realRoot = await realpath(repositoryRoot).catch(() => repositoryRoot)
  return declared === '.'
    ? { repositoryRoot: realRoot, packageRoot: realRoot }
    : resolveDeclaredFolder(repositoryRoot, declared, {}, appKind)
}
