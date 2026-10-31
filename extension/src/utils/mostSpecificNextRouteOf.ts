import { compareNextRoutePrecedence } from './compareNextRoutePrecedence'
import { nextRequestedSegmentsOf } from './nextRequestedSegmentsOf'
import {
  nextRoutePrecedenceOf,
  type SegmentPrecedence,
} from './nextRoutePrecedenceOf'

/**
 * Picks the route Next serves for an entry path among candidate routes: the one matching route of highest segment precedence, as Next's router orders routes, so the Pages and the App router choose by the same rule.
 * Called by {@link resolveNextPagesRoute} for the Pages manifest and by {@link resolveNextClientManifest} for the App paths manifest. The entry path is parsed once ({@link nextRequestedSegmentsOf}) and its segments are matched against every candidate.
 * @param candidates - Each route in URL form (e.g. `/posts/[id]`) with the value the caller keeps for it.
 * @param entryPath - The configured entry path.
 * @returns
 * - the kept value of the one most specific matching route
 * - `undefined` when no route matches, or when two share the highest precedence (Next refuses such a pair when it builds, so the manifest cannot choose)
 * @example
 * mostSpecificNextRouteOf([['/a/[y]', 'first'], ['/[x]/b', 'second']], '/a/b') // => 'first'
 * mostSpecificNextRouteOf([['/[x]', 'first'], ['/[y]', 'second']], '/a')       // => undefined
 */
export function mostSpecificNextRouteOf<Kept>(
  candidates: Iterable<readonly [route: string, kept: Kept]>,
  entryPath: string,
): Kept | undefined {
  const requested = nextRequestedSegmentsOf(entryPath)
  let best: { kept: Kept; precedence: SegmentPrecedence[] } | undefined
  let tied = false
  for (const [route, kept] of candidates) {
    const precedence = nextRoutePrecedenceOf(route, requested)
    if (!precedence) continue
    const order = best
      ? compareNextRoutePrecedence(precedence, best.precedence)
      : -1
    // A better route replaces the best and clears an earlier tie; an equal one leaves the choice open.
    if (order < 0) {
      best = { kept, precedence }
      tied = false
    } else if (order === 0) tied = true
  }
  return best && !tied ? best.kept : undefined
}
