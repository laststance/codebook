import { NEXT_PAGES_SOURCE_EXTENSIONS } from '../constants'

import { findNextRouteFolder } from './findNextRouteFolder'
import { isUnlinkedRegularFile } from './isUnlinkedRegularFile'

/**
 * Says whether the App Router page an App paths manifest key names has a source with one of Next's default extensions, the `found` answer of {@link nextAppPageSourceKindOf}.
 *
 * Why it exists: a listed App page is `found`, `otherExtension` (a custom `pageExtensions`) or `gone` (a stale `.next/dev` listing), and only a page without a default-extension source is looked up further ({@link findNextSourceWithOtherExtension}), so `false` here alone never means stale. Called only by {@link nextAppPageSourceKindOf}, which the router contest of {@link readNextRouteManifests} and the Pages run's conflict refusal ({@link resolveNextPagesEntry}) ask.
 * The key is untrusted manifest data: only a key of plain segments (no empty, `.` or `..` segment, no backslash or NUL) is looked up, in the App folder Next reads ({@link findNextRouteFolder}), with Next's default extensions and without following any link ({@link isUnlinkedRegularFile}).
 * @param workspace - The opened workspace (the Next project root).
 * @param appKey - The App paths manifest key, e.g. `/page` or `/(shop)/cart/page`.
 * @param signal - Ends the lookup with the abort reason when the run is cancelled.
 * @returns `true` when `<app folder><appKey>.<ext>` exists for one of `.tsx`, `.ts`, `.jsx`, `.js`; `false` when none does, the project has no App folder, or the key is not a plain path.
 * @throws The abort reason when `signal` aborts before a candidate is looked up.
 * @example
 * await hasNextAppPageSource('/repo', '/page') // => true in a project with app/page.tsx
 */
export async function hasNextAppPageSource(
  workspace: string,
  appKey: string,
  signal?: AbortSignal,
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
  for (const extension of NEXT_PAGES_SOURCE_EXTENSIONS) {
    signal?.throwIfAborted()
    if (
      await isUnlinkedRegularFile(workspace, `${folder}${appKey}.${extension}`)
    )
      return true
  }
  return false
}
