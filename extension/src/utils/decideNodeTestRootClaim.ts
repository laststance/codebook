/** What a root claim's listing of the cited test from the opened root ended with, as {@link listVitestForRootClaim} classifies it. */
export type RootClaimListingOutcome =
  | { outcome: 'listed'; citedCount: number }
  | {
      outcome: 'failed' | 'cancelled' | 'deadline' | 'unconfirmed'
      error: unknown
    }
/** The root claim's result as the run manifest (`rootClaim`) and journal name it; `not-applicable` when no claim was made. */
export type NodeTestRootClaim =
  | 'not-applicable'
  | 'selected-once'
  | 'not-selected'
  | 'several-projects'
  | 'listing-failed'
/** Which Vitest root the root claim chose, or the listing failure that refuses the start. */
export type RootClaimDecision =
  | { mode: 'root'; rootClaim: 'selected-once' }
  | {
      mode: 'package'
      rootClaim: 'not-selected' | 'several-projects' | 'listing-failed'
    }
  | { mode: 'refused'; refusal: unknown }

/**
 * Decides a root claim from the root listing of the cited test: a root config whose own listing selects the test exactly once keeps the run at the opened root, as it runs today; zero selections, several projects or a listing Vitest itself ended with an error leave it at the test's nearest config; a cancelled start, a passed deadline or a listing whose process group could not be confirmed as ended refuses the start, as today's listing refuses it.
 * Called by {@link planNodeTestExecution} before the run's history begins.
 * @param listing - How the root listing ended; for a finished one, how many of its entries are the cited file.
 * @returns
 * - `root` with `selected-once`: exactly one entry is the cited file.
 * - `package` with `not-selected` (none), `several-projects` (more than one) or `listing-failed` (a clean failure).
 * - `refused` with the listing's error for a cancellation, the deadline or an unconfirmed process-group end.
 * @example
 * decideNodeTestRootClaim({ outcome: 'listed', citedCount: 1 })              // => { mode: 'root', rootClaim: 'selected-once' }
 * decideNodeTestRootClaim({ outcome: 'listed', citedCount: 0 })              // => { mode: 'package', rootClaim: 'not-selected' }
 * decideNodeTestRootClaim({ outcome: 'failed', error })                      // => { mode: 'package', rootClaim: 'listing-failed' }
 * decideNodeTestRootClaim({ outcome: 'deadline', error })                    // => { mode: 'refused', refusal: error }
 */
export function decideNodeTestRootClaim(
  listing: RootClaimListingOutcome,
): RootClaimDecision {
  switch (listing.outcome) {
    case 'listed':
      if (listing.citedCount === 1)
        return { mode: 'root', rootClaim: 'selected-once' }
      return {
        mode: 'package',
        rootClaim:
          listing.citedCount === 0 ? 'not-selected' : 'several-projects',
      }
    case 'failed':
      return { mode: 'package', rootClaim: 'listing-failed' }
    case 'cancelled':
    case 'deadline':
    case 'unconfirmed':
      return { mode: 'refused', refusal: listing.error }
  }
}
