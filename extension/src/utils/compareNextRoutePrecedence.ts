import {
  SEGMENT_PRECEDENCE,
  type SegmentPrecedence,
} from './nextRoutePrecedenceOf'

/**
 * Orders two routes that match the same entry path by their segments' precedence ({@link nextRoutePrecedenceOf}), deciding at the first position where they differ, as Next's router does.
 * Called by {@link mostSpecificNextRouteOf} to pick a router's route and by {@link compareNextRouterMatches} to pick the router. A route that has run out of segments ranks as an optional catch-all there: two matching routes can differ in length only by a trailing `[[...x]]`, a pair Next refuses as equally specific.
 * @param left - Precedence of the first route's segments.
 * @param right - Precedence of the second route's segments.
 * @returns A negative number when `left` wins, a positive one when `right` wins, `0` when they are equal.
 * @example
 * compareNextRoutePrecedence([0, 1], [1, 0]) // => -1: `/a/[y]` wins over `/[x]/b`
 * compareNextRoutePrecedence([], [3])        // => 0: `/` and `/[[...slug]]`
 */
export function compareNextRoutePrecedence(
  left: readonly SegmentPrecedence[],
  right: readonly SegmentPrecedence[],
): number {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference =
      (left[index] ?? SEGMENT_PRECEDENCE.optionalCatchAll) -
      (right[index] ?? SEGMENT_PRECEDENCE.optionalCatchAll)
    if (difference) return difference
  }
  return 0
}
