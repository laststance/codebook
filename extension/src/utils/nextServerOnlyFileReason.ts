import { NEXT_PAGES_SOURCE_EXTENSIONS } from '../constants'

import type { NextRouteFolder } from './findNextRouteFolder'
import type { ResolvedNextPackage } from './resolveNextPackage'

/**
 * Applies Next's file rules for Pages files that never run in the browser; called by {@link readNextServerOnlyReason} for a declared stop and by {@link resolveNextPagesEntry} for the source of the entry route (an API route is no page).
 * @param path - The stop's package-relative source (same base as `folder`); use {@link nextServerOnlyFileReasonOfStop} for a repository-relative stop.
 * @param folder - The Pages folder.
 * @returns `document` for `<folder>/_document.<ext>`, `api-route` for an API route (`<folder>/api.<ext>` or under `<folder>/api/`), else `undefined`.
 * @example
 * nextServerOnlyFileReason('src/pages/api/posts.ts', 'src/pages') // => 'api-route'
 * nextServerOnlyFileReason('src/pages/index.tsx', 'src/pages')    // => undefined
 */
export function nextServerOnlyFileReason(
  path: string,
  folder: NextRouteFolder<'pages'>,
): 'document' | 'api-route' | undefined {
  const pageFiles = (name: string) =>
    NEXT_PAGES_SOURCE_EXTENSIONS.map(
      (extension) => `${folder}/${name}.${extension}`,
    )
  if (pageFiles('_document').includes(path)) return 'document'
  // Next serves `/api` and everything under it as API routes.
  if (pageFiles('api').includes(path) || path.startsWith(`${folder}/api/`))
    return 'api-route'
  return undefined
}

/**
 * Applies {@link nextServerOnlyFileReason} to a declared stop whose source is repository-relative, as a book cites it.
 *
 * Why it exists: Next's Pages folder lies below the package root, so a stop of a nested Next app (`examples/app/src/pages/api/x.ts`) must be mapped once to the package-relative path (`src/pages/api/x.ts`) before it is compared with the folder; comparing the repository-relative path directly never matches. Called by the configured browser run for each declared Pages stop and by {@link readNextServerOnlyReason}.
 * @param nextPackage - The run's resolved Next app.
 * @param repositoryPath - The stop's repository-relative source.
 * @param folder - The Pages folder, relative to the package root.
 * @returns The reason as {@link nextServerOnlyFileReason}, or `undefined` when the file lies outside the package (refused elsewhere) or no file rule applies.
 * @example
 * nextServerOnlyFileReasonOfStop(nextPackage, 'examples/app/src/pages/api/posts.ts', 'src/pages') // => 'api-route' for packageRoot "examples/app"
 */
export function nextServerOnlyFileReasonOfStop(
  nextPackage: ResolvedNextPackage,
  repositoryPath: string,
  folder: NextRouteFolder<'pages'>,
): 'document' | 'api-route' | undefined {
  const packagePath = nextPackage.toPackageRelative(repositoryPath)
  // A stop outside the package is refused before any process starts; no file rule applies to it.
  if (packagePath === undefined) return undefined
  return nextServerOnlyFileReason(packagePath, folder)
}
