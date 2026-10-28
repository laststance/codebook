import { cutTextToFit } from './cutTextToFit'

/** The longest reason a history's seal or index holds. */
const REASON_LIMIT_CHARS = 1_024

/**
 * Cuts a history's reason to {@link REASON_LIMIT_CHARS} between characters, never inside a surrogate pair, saying it was cut, so every reason fits the seal's and the index's bound (F265); called wherever a store or writer words a reason.
 * @param reason - The whole reason.
 * @returns The reason itself when it fits, else its beginning with the cut marker.
 * @example cutHistoryReason('x'.repeat(2_000)).length // => 1_024
 */
export function cutHistoryReason(reason: string): string {
  return cutTextToFit(
    reason,
    (candidate) => candidate.length <= REASON_LIMIT_CHARS,
  )
}
