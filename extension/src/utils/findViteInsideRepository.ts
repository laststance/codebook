import {
  findPackageInsideRepository,
  type PackageInsideRepositoryLookup,
  type PackageNotFoundReason,
} from './findPackageInsideRepository'

/** What the bounded walk found: the real path of the nearest `vite/package.json`, or why there is none. */
export type ViteInsideRepositoryLookup = PackageInsideRepositoryLookup

/**
 * Why no usable Vite was found for an app: Yarn Plug-n-Play, nothing installed, the nearest entry resolving outside the repository (or a link that cannot be followed), or a package that is not Vite (D7).
 */
export type ViteNotFoundReason = PackageNotFoundReason | 'not-vite'

/**
 * Finds the nearest `node_modules/vite` from an app folder up to the repository root, accepted only when its real path lies inside the repository (decision D7); see {@link findPackageInsideRepository} for the walk.
 * Called by {@link resolveViteInstallation} for a nested app.
 *
 * @param appFolder - The app's real path, inside the repository.
 * @param repositoryRoot - The opened repository's root.
 * @returns The real `package.json` path of the nearest Vite, or `not-installed` / `yarn-pnp` / `outside-repository`.
 * @example
 * await findViteInsideRepository('/repo/examples/basic', '/repo') // => { found: true, packagePath: '/repo/node_modules/.pnpm/vite@8.3.5/node_modules/vite/package.json' }
 */
export function findViteInsideRepository(
  appFolder: string,
  repositoryRoot: string,
): Promise<ViteInsideRepositoryLookup> {
  return findPackageInsideRepository(appFolder, repositoryRoot, 'vite')
}
