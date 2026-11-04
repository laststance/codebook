import { access, lstat, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { isFolderOrInside } from './resolveNextPackage'

/** What the bounded walk found: the real path of the nearest `vite/package.json`, or why there is none. */
export type ViteInsideRepositoryLookup =
  | { found: true; packagePath: string }
  | { found: false; reason: 'yarn-pnp' | 'not-installed' }

/**
 * Finds the nearest `node_modules/vite` from an app folder up to the repository root, accepted only when its real path lies inside the repository (decision D7).
 *
 * Why it exists: Node's own resolution climbs above the repository and into global folders, so a nested app could start a Vite outside the checkout, a different program from the one the Example declares. pnpm links and npm or Yarn hoists inside the repository qualify; the nearest entry decides (a broken or outside link is not installed, with no fallback to an ancestor's); `NODE_PATH` is never consulted; Yarn Plug-n-Play is told apart by a `.pnp.cjs` in the app folder or the repository root.
 * Called by {@link resolveViteInstallation} for a nested app.
 *
 * @param appFolder - The app's real path, inside the repository.
 * @param repositoryRoot - The opened repository's root.
 * @returns The real `package.json` path of the nearest Vite, or `not-installed` / `yarn-pnp`.
 * @example
 * await findViteInsideRepository('/repo/examples/basic', '/repo') // => { found: true, packagePath: '/repo/node_modules/.pnpm/vite@8.3.5/node_modules/vite/package.json' }
 */
export async function findViteInsideRepository(
  appFolder: string,
  repositoryRoot: string,
): Promise<ViteInsideRepositoryLookup> {
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
    const candidate = join(folder, 'node_modules', 'vite')
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
    // A link that cannot be followed, or that leaves the repository, leaves no Vite to run.
    if (real !== undefined && isFolderOrInside(canonicalRoot, real))
      return { found: true, packagePath: join(real, 'package.json') }
    return { found: false, reason: 'not-installed' }
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
