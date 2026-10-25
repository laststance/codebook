import type { RetryVitestListingRelease } from './listVitestTestFiles'

/**
 * Releases the Vitest listings of a run whose process groups could not be confirmed as ended, one at a time in the order they failed; each retry that succeeds leaves the list.
 * Called by {@link StudyService.stopRecord} before a run reads stopped, by {@link OwnedNodeTestRun}'s release and by the native test bootstrap, so a listing that may still run is released by whoever owns its run.
 * @param unreleased - The retries of the run's unreleased listings, emptied from the front as they succeed.
 * @throws The first retry's failure; that retry and the ones after it stay in the list, so the next call tries them again.
 * @example
 * await releaseVitestListings(record.unreleasedListings) // => resolves with the list empty once every listing's group has ended
 */
export async function releaseVitestListings(
  unreleased: RetryVitestListingRelease[],
): Promise<void> {
  while (unreleased.length) {
    await unreleased[0]!()
    unreleased.shift()
  }
}
