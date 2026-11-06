import { z } from 'zod'

import type { StudyError } from '../errors'

import { repositoryPosixPath } from './repositoryPosixPath'
import {
  buildPackageMappers,
  readJsonInside,
  resolveDeclaredFolder,
  type PackageAppKind,
  type ResolvedPackage,
  type ResolveNextPackageOptions,
} from './resolveNextPackage'
import { rootVitePackage } from './resolveVitePackage'

/**
 * Resolves the app a run uses from its declared `packageRoot`, for an adapter whose app rule is a manifest check.
 *
 * Why it exists: react-scripts and Expo web apps may live below the repository root as a Next or Vite app does; the folder rules are {@link resolveDeclaredFolder}'s and only the app rule and its refusal differ. Called by {@link resolveReactScriptsPackage} and {@link resolveExpoWebPackage}.
 * @param repositoryRoot - The opened repository's root.
 * @param packageRoot - The declared `packageRoot`; `undefined` or `"."` for the root app, which is described without touching the disk.
 * @param options - An optional provider of discovered values for refusals.
 * @param appKind - Whose app the folder must hold, for the folder refusals' words.
 * @param declaresApp - The adapter's app rule over the parsed `package.json`.
 * @param notAppRefusal - Words the refusal of a folder that is no app of the adapter's kind, given its canonical repository-relative path.
 * @returns The resolved package.
 * @throws `INVALID_CONFIGURATION` for an unusable folder; the adapter's not-an-app refusal for a folder whose manifest fails `declaresApp`. Nothing was started.
 * @example await resolveDeclaredAppPackage('/repo', 'apps/app', {}, 'expoWeb', manifestDeclaresExpo, expoWebNotAppRefusal)
 */
export async function resolveDeclaredAppPackage(
  repositoryRoot: string,
  packageRoot: string | undefined,
  options: ResolveNextPackageOptions,
  appKind: PackageAppKind,
  declaresApp: (manifest: unknown) => boolean,
  notAppRefusal: (packageRootRelative: string) => StudyError,
): Promise<ResolvedPackage> {
  const declared = packageRoot ?? '.'
  if (declared === '.') return rootVitePackage(repositoryRoot)
  const folders = await resolveDeclaredFolder(
    repositoryRoot,
    declared,
    options,
    appKind,
  )
  const manifest = await readJsonInside(
    folders.packageRoot,
    'package.json',
    z.unknown(),
  )
  const packageRootRelative = repositoryPosixPath(
    folders.repositoryRoot,
    folders.packageRoot,
  )
  if (!declaresApp(manifest)) throw notAppRefusal(packageRootRelative)
  return buildPackageMappers({
    repositoryRoot: folders.repositoryRoot,
    packageRoot: folders.packageRoot,
    packageRootRelative,
    declaredPackageRoot: declared,
    isRoot: folders.packageRoot === folders.repositoryRoot,
  })
}
