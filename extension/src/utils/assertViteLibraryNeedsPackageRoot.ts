import { StudyError } from '../errors'

/**
 * Refuses a `vite-dev` start that declares `library` without a nested `packageRoot`: the library route redirects an Example below the repository root, so a root Vite run has nothing to redirect.
 * Called by the study service for a repository-browser start before the configuration is parsed, so the refusal carries `details.reason` and `details.field` and names the fix, where the generic schema sentence would not.
 * @param configuration - The start's configuration, as the tool received it.
 * @throws `INVALID_CONFIGURATION` with `details.field` `configuration.library`, `details.reason` `library-needs-package-root` and `details.sideEffects` `none` for a version 3 `vite-dev` configuration that declares `library` with `packageRoot` absent or `"."`.
 * @example
 * assertViteLibraryNeedsPackageRoot({ version: 3, adapter: 'vite-dev', library: { packageRoot: 'packages/widgets' } }) // throws
 * assertViteLibraryNeedsPackageRoot({ version: 3, adapter: 'vite-dev', packageRoot: 'examples/widgets-vite', library: { packageRoot: 'packages/widgets' } }) // returns
 */
export function assertViteLibraryNeedsPackageRoot(
  configuration: unknown,
): void {
  if (typeof configuration !== 'object' || configuration === null) return
  // Only a version 3 vite-dev configuration may declare `library`; every other shape is left to the schema.
  if (
    Reflect.get(configuration, 'version') !== 3 ||
    Reflect.get(configuration, 'adapter') !== 'vite-dev' ||
    Reflect.get(configuration, 'library') === undefined
  )
    return
  const packageRoot: unknown = Reflect.get(configuration, 'packageRoot')
  if (packageRoot !== undefined && packageRoot !== '.') return
  const message =
    "configuration.library needs the Example's nested configuration.packageRoot: the library route redirects an Example below the repository root. Declare the Example's folder as packageRoot (for example the folder that holds its package.json), or drop library to run the Example on its installed copy. See codebook://help/repository-browser#viteLibrary."
  throw new StudyError(
    'INVALID_CONFIGURATION',
    message,
    message,
    undefined,
    undefined,
    {
      field: 'configuration.library',
      reason: 'library-needs-package-root',
      sideEffects: 'none',
    },
  )
}
