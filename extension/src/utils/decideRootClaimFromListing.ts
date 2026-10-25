import {
  decideNodeTestRootClaim,
  type RootClaimDecision,
} from './decideNodeTestRootClaim'
import type { RootClaimListing } from './listVitestForRootClaim'
import { partitionListedTestFiles } from './partitionListedTestFiles'

/**
 * Decides a root claim from a classified root listing of the cited test: counts the listed entries that are the cited file by real path, then applies {@link decideNodeTestRootClaim}.
 * Called by {@link planNodeTestExecution} before the run's history begins and by {@link prepareNodeTestLaunch} when it asks the root again at launch, so both decide the same way.
 * @param listing - How the root listing ended ({@link listVitestForRootClaim}).
 * @param testFile - The cited test's real path.
 * @returns The claim's decision: root mode, package mode with its reason, or the refusal of a listing that was cancelled, timed out, left its group unconfirmed or could not run.
 * @example
 * await decideRootClaimFromListing({ outcome: 'listed', files: [{ file: '/repo/packages/a/src/a.test.ts' }] }, '/repo/packages/a/src/a.test.ts')
 * // => { mode: 'root', rootClaim: 'selected-once' }
 */
export async function decideRootClaimFromListing(
  listing: RootClaimListing,
  testFile: string,
): Promise<RootClaimDecision> {
  return decideNodeTestRootClaim(
    listing.outcome === 'listed'
      ? {
          outcome: 'listed',
          citedCount: (await partitionListedTestFiles(listing.files, testFile))
            .cited.length,
        }
      : listing,
  )
}
