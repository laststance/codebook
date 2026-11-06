import { reactScriptsNotAppRefusal } from '../reactScriptsRefusals'

import { manifestDeclaresReactScripts } from './reactScriptsManifest'
import { resolveDeclaredAppPackage } from './resolveDeclaredAppPackage'
import {
  type ResolvedPackage,
  type ResolveNextPackageOptions,
} from './resolveNextPackage'

/** The react-scripts app a run uses: the neutral folder record and path mappers every package-aware reader shares. */
export type ResolvedReactScriptsPackage = ResolvedPackage

/**
 * Resolves the react-scripts app a run uses from its declared `packageRoot`.
 *
 * Why it exists: a react-scripts app may live below the repository root as a Next or Vite app does. The folder rules are {@link resolveDeclaredFolder}'s; the app rule is that `package.json` declares `react-scripts`. Called by {@link ConfiguredBrowserRun} when it resolves its configuration and by the start preflight in {@link StudyService}.
 * @param repositoryRoot - The opened repository's root.
 * @param packageRoot - The declared `packageRoot`; `undefined` or `"."` for the root app, which is described without touching the disk (its package mappers are adapter-neutral).
 * @param options - An optional provider of discovered values for refusals.
 * @returns The resolved package.
 * @throws `INVALID_CONFIGURATION` for an unusable folder; `REACT_SCRIPTS_UNSUPPORTED` (`not-a-react-scripts-app`) for a folder whose manifest does not declare react-scripts. Nothing was started.
 * @example
 * const app = await resolveReactScriptsPackage('/repo', 'examples/counter')
 * app.toPackageRelative('examples/counter/src/App.js') // => 'src/App.js'
 */
export function resolveReactScriptsPackage(
  repositoryRoot: string,
  packageRoot: string | undefined,
  options: ResolveNextPackageOptions = {},
): Promise<ResolvedReactScriptsPackage> {
  return resolveDeclaredAppPackage(
    repositoryRoot,
    packageRoot,
    options,
    'reactScripts',
    manifestDeclaresReactScripts,
    reactScriptsNotAppRefusal,
  )
}
