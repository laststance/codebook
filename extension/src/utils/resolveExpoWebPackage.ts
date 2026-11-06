import { expoWebNotAppRefusal } from '../expoWebRefusals'

import { manifestDeclaresExpo } from './manifestDeclaresPackage'
import { resolveDeclaredAppPackage } from './resolveDeclaredAppPackage'
import {
  type ResolvedPackage,
  type ResolveNextPackageOptions,
} from './resolveNextPackage'

/**
 * Resolves the Expo app a run uses from its declared `packageRoot`.
 *
 * Why it exists: an Expo app usually lives below the repository root (`apps/app`). The folder rules are {@link resolveDeclaredFolder}'s; the app rule is that `package.json` declares `expo`. Called by {@link ConfiguredBrowserRun} when it resolves its configuration and by the start preflight in {@link StudyService}.
 * @param repositoryRoot - The opened repository's root.
 * @param packageRoot - The declared `packageRoot`; `undefined` or `"."` for the root app.
 * @param options - An optional provider of discovered values for refusals.
 * @returns The resolved package.
 * @throws `INVALID_CONFIGURATION` for an unusable folder; `EXPO_WEB_UNSUPPORTED` (`not-an-expo-app`) for a folder whose manifest does not declare expo. Nothing was started.
 * @example
 * const app = await resolveExpoWebPackage('/repo', 'apps/app')
 * app.toPackageRelative('apps/app/src/app/index.tsx') // => 'src/app/index.tsx'
 */
export function resolveExpoWebPackage(
  repositoryRoot: string,
  packageRoot: string | undefined,
  options: ResolveNextPackageOptions = {},
): Promise<ResolvedPackage> {
  return resolveDeclaredAppPackage(
    repositoryRoot,
    packageRoot,
    options,
    'expoWeb',
    manifestDeclaresExpo,
    expoWebNotAppRefusal,
  )
}
