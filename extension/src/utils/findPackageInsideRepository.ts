import { access, lstat, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { isFolderOrInside } from './resolveNextPackage'

/** What the bounded walk found: the real path of the nearest `<package>/package.json`, or why there is none. */
export type PackageInsideRepositoryLookup =
  | { found: true; packagePath: string }
  | { found: false; reason: PackageNotFoundReason }

/**
 * Why no package was found for an app: Yarn Plug-n-Play, nothing installed, or the nearest entry resolving outside the repository (or a link that cannot be followed) (D7).
 */
export type PackageNotFoundReason =
  'yarn-pnp' | 'not-installed' | 'outside-repository'

/**
 * Finds the nearest `node_modules/<packageName>` from an app folder up to the repository root, accepted only when its real path lies inside the repository (decision D7).
 *
 * Why it exists: Node's own resolution climbs above the repository and into global folders, so a nested app could start a program outside the checkout, a different one from the one the Example declares. pnpm links and npm or Yarn hoists inside the repository qualify; the nearest entry decides (a broken or outside link is not installed, with no fallback to an ancestor's); `NODE_PATH` is never consulted; Yarn Plug-n-Play is told apart by a `.pnp.cjs` in the app folder or the repository root.
 * Called by {@link findViteInsideRepository} and by {@link readReactScriptsPackageReadiness}.
 *
 * @param appFolder - The app's real path, inside the repository.
 * @param repositoryRoot - The opened repository's root.
 * @param packageName - The package folder name under `node_modules`, scoped (`@scope/name`) or not.
 * @returns The real `package.json` path of the nearest package, or `not-installed` / `yarn-pnp` / `outside-repository` (the nearest entry leaves the repository or its link is broken).
 * @example
 * await findPackageInsideRepository('/repo/examples/basic', '/repo', 'react-scripts') // => { found: true, packagePath: '/repo/node_modules/.pnpm/react-scripts@5.0.1/node_modules/react-scripts/package.json' }
 */
export async function findPackageInsideRepository(
  appFolder: string,
  repositoryRoot: string,
  packageName: string,
): Promise<PackageInsideRepositoryLookup> {
  const canonicalRoot = await realpath(repositoryRoot).catch(
    () => repositoryRoot,
  )
  let nearest: string | undefined
  // Walk up to the repository root and no further.
  for (
    let folder = appFolder;
    nearest === undefined;
    folder = dirname(folder)
  ) {
    const candidate = join(folder, 'node_modules', packageName)
    // lstat, not access: a broken link is still the nearest entry and ends the walk.
    if (
      await lstat(candidate).then(
        () => true,
        () => false,
      )
    )
      nearest = candidate
    else if (folder === repositoryRoot || folder === canonicalRoot) break
    else if (dirname(folder) === folder) break
  }
  if (nearest !== undefined) {
    const real = await realpath(nearest).catch(() => undefined)
    // A link that cannot be followed, or that leaves the repository, is told apart from a missing install: the learner must fix the link, not install the package.
    if (real !== undefined && isFolderOrInside(canonicalRoot, real))
      return { found: true, packagePath: join(real, 'package.json') }
    return { found: false, reason: 'outside-repository' }
  }
  for (const folder of [appFolder, repositoryRoot]) {
    const isPnp = await access(join(folder, '.pnp.cjs')).then(
      () => true,
      () => false,
    )
    if (isPnp) return { found: false, reason: 'yarn-pnp' }
  }
  return { found: false, reason: 'not-installed' }
}
