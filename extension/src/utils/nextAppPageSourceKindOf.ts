import { findNextRouteFolder } from './findNextRouteFolder'
import { findNextSourceWithOtherExtension } from './findNextSourceWithOtherExtension'
import { hasNextAppPageSource } from './hasNextAppPageSource'

/**
 * What the source of a listed App page is: `found` with Next's default extensions, `otherExtension` when only a file with another extension has its stem (a custom `pageExtensions`), or `gone` (a stale listing).
 */
export type NextAppPageSourceKind = 'found' | 'otherExtension' | 'gone'

/**
 * Says what the source of a listed App page is, so the Pages run tells a stale App listing (no file with the page's stem) apart from a source with a custom `pageExtensions` extension, which is no stale listing.
 * Called by the router contest of {@link readNextRouteManifests} for a more specific App route and by the Pages run's conflict refusal ({@link resolveNextPagesEntry}). The key is untrusted: {@link hasNextAppPageSource} and {@link findNextSourceWithOtherExtension} each look only at a plain path, never through a link.
 * @param workspace - The opened workspace (the Next project root).
 * @param appKey - The App paths manifest key, e.g. `/about/page`.
 * @param signal - Ends the lookup with the abort reason when the run is cancelled.
 * @returns
 * - `found` when `<app folder><appKey>` exists as `.tsx`, `.ts`, `.jsx` or `.js`
 * - `otherExtension` when only another file with that stem exists, e.g. `app/about/page.mdx`
 * - `gone` when no file has that stem, the project has no App folder, or the key is not a plain path
 * @throws The abort reason when `signal` aborts during the lookup.
 * @example
 * await nextAppPageSourceKindOf('/repo', '/about/page') // => 'otherExtension' in a project whose page is app/about/page.mdx
 */
export async function nextAppPageSourceKindOf(
  workspace: string,
  appKey: string,
  signal?: AbortSignal,
): Promise<NextAppPageSourceKind> {
  if (await hasNextAppPageSource(workspace, appKey, signal)) return 'found'
  const folder = await findNextRouteFolder(workspace, 'app')
  if (!folder || !appKey.startsWith('/')) return 'gone'
  return (await findNextSourceWithOtherExtension(
    workspace,
    `${folder}${appKey}`,
    signal,
  ))
    ? 'otherExtension'
    : 'gone'
}
