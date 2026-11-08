import { nextLibraryNeedsPackageRootRefusal } from '../nextRefusals'
import { reactScriptsLibraryNeedsPackageRootRefusal } from '../reactScriptsRefusals'

/**
 * Refuses a `react-scripts-dev` or `next-dev-webpack` start that declares `library` on an app at the repository root (`packageRoot` absent or `"."`), before the configuration is parsed.
 * Why it exists: the parsed configuration of a root app with `library` fails the study schemas with a generic sentence, so the help's documented refusal (`LIBRARY_BUILD_UNSUPPORTED`, `library-needs-package-root`) would never reach the chat; the same check for `vite-dev` is {@link assertViteLibraryNeedsPackageRoot}.
 * Called by the study service for a repository-browser start, beside the Vite check; a nested `packageRoot` that resolves to the repository root through a link is refused later by the run with the same reason.
 * @param configuration - The start's configuration, as the tool received it.
 * @throws `LIBRARY_BUILD_UNSUPPORTED` with `details.reason` `library-needs-package-root` and `details.sideEffects` `none` ({@link reactScriptsLibraryNeedsPackageRootRefusal}, {@link nextLibraryNeedsPackageRootRefusal}).
 * @example
 * assertWebpackLibraryNeedsPackageRoot({ version: 3, adapter: 'next-dev-webpack', library: { packageRoot: '.' } }) // throws
 * assertWebpackLibraryNeedsPackageRoot({ version: 3, adapter: 'next-dev-webpack', packageRoot: 'examples/app', library: { packageRoot: '.' } }) // returns
 */
export function assertWebpackLibraryNeedsPackageRoot(
  configuration: unknown,
): void {
  if (typeof configuration !== 'object' || configuration === null) return
  const adapter: unknown = Reflect.get(configuration, 'adapter')
  // Only a version 3 configuration of these two adapters may declare `library`; every other shape is left to the schema.
  if (
    Reflect.get(configuration, 'version') !== 3 ||
    (adapter !== 'react-scripts-dev' && adapter !== 'next-dev-webpack') ||
    Reflect.get(configuration, 'library') === undefined
  )
    return
  const packageRoot: unknown = Reflect.get(configuration, 'packageRoot')
  if (packageRoot !== undefined && packageRoot !== '.') return
  throw adapter === 'next-dev-webpack'
    ? nextLibraryNeedsPackageRootRefusal()
    : reactScriptsLibraryNeedsPackageRootRefusal()
}
