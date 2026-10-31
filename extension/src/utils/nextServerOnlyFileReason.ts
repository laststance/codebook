import { NEXT_PAGES_SOURCE_EXTENSIONS } from '../constants'

import type { NextRouteFolder } from './findNextRouteFolder'

/**
 * Applies Next's file rules for Pages files that never run in the browser; called by {@link readNextServerOnlyReason} for a declared stop and by {@link resolveNextPagesEntry} for the source of the entry route (an API route is no page).
 * @param path - The stop's workspace-relative source.
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
