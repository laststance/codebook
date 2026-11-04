import { z } from 'zod'

import { repositoryPosixPath } from './repositoryPosixPath'
import {
  buildPackageMappers,
  invalidPackageRoot,
  readJsonInside,
  resolveDeclaredFolder,
  type ResolvedPackage,
  type ResolveNextPackageOptions,
} from './resolveNextPackage'
import { isViteAppManifest } from './viteAppManifest'

/** The Vite app a run uses: the folder record and path mappers every package-aware reader shares ({@link ResolvedPackage}). Vite itself is found from this folder by {@link resolveViteInstallation}. */
export type ResolvedVitePackage = ResolvedPackage

/**
 * Describes the root Vite app without touching the disk, as the root run has always been addressed.
 * Called by {@link ConfiguredBrowserRun} for an absent or `"."` packageRoot and by {@link resolveVitePackage}.
 * @param repositoryRoot - The opened repository's root, used as given so a root run stays byte-identical.
 * @returns The root package.
 * @example rootVitePackage('/repo').packageRootRelative // => '.'
 */
export function rootVitePackage(repositoryRoot: string): ResolvedVitePackage {
  return buildPackageMappers({
    repositoryRoot,
    packageRoot: repositoryRoot,
    packageRootRelative: '.',
    declaredPackageRoot: '.',
    isRoot: true,
  })
}

/**
 * Resolves the Vite app a run uses from its declared `packageRoot`, with the refusals and reasons the Next resolver gives plus `not-a-vite-app`.
 *
 * Why it exists: Cycle 0077 lets a Vite app live below the repository root as a Next app does since Cycle 0074. The folder rules (inside the repository lexically and by real path, a folder, readable) are {@link resolveDeclaredFolder}'s, shared with {@link resolveNextPackage}; the app rule is decision D5 ({@link isViteAppManifest}). Vite's own installation is judged later, by D7's bounded walk ({@link resolveViteInstallation}), so the start can refuse it as `PREREQUISITE_MISSING`.
 * Called by {@link ConfiguredBrowserRun} when it resolves its configuration, by the start preflight in {@link StudyService} and by the readiness discovery.
 *
 * @param repositoryRoot - The opened repository's root.
 * @param packageRoot - The declared `packageRoot`; `undefined` or `"."` for the root app.
 * @param options - An optional provider of discovered values for refusals.
 * @returns The resolved package; for an absent or `"."` value the root package, unchanged.
 * @throws `INVALID_CONFIGURATION` (details `field`, `packageRoot`, `reason`, `suggestions`, `sideEffects: "none"`); nothing was started.
 * @example
 * const vite = await resolveVitePackage('/repo', 'examples/react/basic')
 * vite.toPackageRelative('examples/react/basic/src/index.tsx') // => 'src/index.tsx'
 */
export async function resolveVitePackage(
  repositoryRoot: string,
  packageRoot: string | undefined,
  options: ResolveNextPackageOptions = {},
): Promise<ResolvedVitePackage> {
  const declared = packageRoot ?? '.'
  if (declared === '.') return rootVitePackage(repositoryRoot)
  const folders = await resolveDeclaredFolder(
    repositoryRoot,
    declared,
    options,
    'vite',
  )
  const manifest = await readJsonInside(
    folders.packageRoot,
    'package.json',
    z.unknown(),
  )
  if (!(await isViteAppManifest(manifest, folders.packageRoot)))
    throw await invalidPackageRoot(declared, 'not-a-vite-app', options, 'vite')
  return buildPackageMappers({
    repositoryRoot: folders.repositoryRoot,
    packageRoot: folders.packageRoot,
    packageRootRelative: repositoryPosixPath(
      folders.repositoryRoot,
      folders.packageRoot,
    ),
    declaredPackageRoot: declared,
    isRoot: folders.packageRoot === folders.repositoryRoot,
  })
}
