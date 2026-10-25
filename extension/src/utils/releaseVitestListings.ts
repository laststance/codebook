import type { RetryVitestListingRelease } from './listVitestTestFiles'

/**
 * Releases the Vitest listings of a run whose process groups could not be confirmed as ended, each in turn in the order they failed; each retry that succeeds leaves the list, and one that fails stays there with its turn kept.
 * Every retry is tried, so one listing that still runs keeps no other from being released. Retries are removed by identity, so a call that overlaps another never drops a retry that was not run.
 * Called by {@link StudyService.stopRecord} before a run reads stopped, by {@link OwnedNodeTestRun}'s release and by the native test bootstrap, so a listing that may still run is released by whoever owns its run.
 * @param unreleased - The retries of the run's unreleased listings, emptied as they succeed.
 * @throws The first failure among the retries; the retries that failed stay in the list, so the next call tries them again.
 * @example
 * await releaseVitestListings(record.unreleasedListings) // => resolves with the list empty once every listing's group has ended
 */
export async function releaseVitestListings(
  unreleased: RetryVitestListingRelease[],
): Promise<void> {
  let firstFailure: { error: unknown } | undefined
  for (const retryRelease of [...unreleased]) {
    try {
      await retryRelease()
      const index = unreleased.indexOf(retryRelease)
      if (index !== -1) unreleased.splice(index, 1)
    } catch (error) {
      firstFailure ??= { error }
    }
  }
  if (firstFailure) throw firstFailure.error
}
