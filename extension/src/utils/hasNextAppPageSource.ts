import { NEXT_PAGES_SOURCE_EXTENSIONS } from '../constants'

import { findNextRouteFolder } from './findNextRouteFolder'
import { isUnlinkedRegularFile } from './isUnlinkedRegularFile'

/**
 * Says whether the App Router page an App paths manifest key names still has its source file, for the Pages run's route conflict: a conflict where one side's source is gone is a stale `.next/dev` listing.
 *
 * Why it exists: `NEXT_ROUTE_CONFLICT` says "stale" when one of the two listed pages has no source any more, so the learner knows that removing `.next/dev` (themselves, with no `next dev` running) ends it. Called by the Pages run's refusal check; the Pages side is asked through {@link findNextPagesSource}.
 * The key is untrusted manifest data: only a key of plain segments (no empty, `.` or `..` segment, no backslash or NUL) is looked up, in the App folder Next reads ({@link findNextRouteFolder}), with Next's default extensions and without following any link ({@link isUnlinkedRegularFile}).
 * @param workspace - The opened workspace (the Next project root).
 * @param appKey - The App paths manifest key, e.g. `/page` or `/(shop)/cart/page`.
 * @returns `true` when `<app folder><appKey>.<ext>` exists for one of `.tsx`, `.ts`, `.jsx`, `.js`; `false` when none does, the project has no App folder, or the key is not a plain path.
 * @example
 * await hasNextAppPageSource('/repo', '/page') // => true in a project with app/page.tsx
 */
export async function hasNextAppPageSource(
  workspace: string,
  appKey: string,
): Promise<boolean> {
  const segments = appKey.split('/').slice(1)
  if (
    !appKey.startsWith('/') ||
    /[\\\0]/.test(appKey) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  )
    return false
  const folder = await findNextRouteFolder(workspace, 'app')
  if (!folder) return false
  for (const extension of NEXT_PAGES_SOURCE_EXTENSIONS)
    if (
      await isUnlinkedRegularFile(workspace, `${folder}${appKey}.${extension}`)
    )
      return true
  return false
}
