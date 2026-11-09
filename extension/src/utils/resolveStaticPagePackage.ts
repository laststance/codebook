import { repositoryPosixPath } from './repositoryPosixPath'
import {
  buildPackageMappers,
  resolveDeclaredFolder,
  type ResolvedPackage,
  type ResolveNextPackageOptions,
} from './resolveNextPackage'
import { rootVitePackage } from './resolveVitePackage'

/**
 * Resolves the folder a `static-page` run serves from its declared `packageRoot`.
 *
 * Why it exists: a plain page may live below the repository root like any other app; the folder rules are {@link resolveDeclaredFolder}'s, and unlike the other adapters there is no manifest rule here (a plain page has no `package.json` to read): whether the folder holds a servable page is judged by {@link judgeStaticPage} in the adapter's workspace check. Called by {@link ConfiguredBrowserRun} at the start of preparation.
 * @param repositoryRoot - The opened repository's root.
 * @param packageRoot - The declared `packageRoot`; `undefined` or `"."` for the root page, which is described without touching the disk.
 * @param options - An optional provider of discovered values for refusals.
 * @returns The resolved package.
 * @throws `INVALID_CONFIGURATION` for an unusable folder. Nothing was started.
 * @example
 * const page = await resolveStaticPagePackage('/repo', 'examples/page')
 * page.toPackageRelative('examples/page/index.html') // => 'index.html'
 */
export async function resolveStaticPagePackage(
  repositoryRoot: string,
  packageRoot: string | undefined,
  options: ResolveNextPackageOptions = {},
): Promise<ResolvedPackage> {
  const declared = packageRoot ?? '.'
  if (declared === '.') return rootVitePackage(repositoryRoot)
  const folders = await resolveDeclaredFolder(
    repositoryRoot,
    declared,
    options,
    'staticPage',
  )
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
