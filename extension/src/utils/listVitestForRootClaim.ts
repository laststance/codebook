import { VITEST_FILE_LIST_TIMEOUT_MS } from '../constants'

import {
  listVitestTestFiles,
  VitestListingDeadlineError,
  type ListVitestTestFilesRequest,
  type VitestListedFile,
  type VitestListingReleaseFailure,
} from './listVitestTestFiles'

/** How a root claim's listing ended: the files Vitest reported, or why there are none, with the error a refusal carries. */
export type RootClaimListing =
  | { outcome: 'listed'; files: VitestListedFile[] }
  | {
      outcome: 'failed' | 'cancelled' | 'deadline' | 'unconfirmed'
      error: unknown
    }

/**
 * Lists the cited test from the opened root with the root's Vitest, for a root claim made before the run's history begins, and tells a clean failure Vitest itself reported apart from a cancelled start, a passed deadline and a listing whose process group could not be confirmed as ended.
 * Called by the study environment's pre-history check through {@link planNodeTestExecution}; the listing runs within {@link VITEST_FILE_LIST_TIMEOUT_MS} and the start's preparation deadline, whichever ends first.
 * @param request - The root's Vitest program, the opened root, the cited repository-relative file and no excludes.
 * @param run - The Node executable, the start's cancellation and its preparation deadline (epoch milliseconds).
 * @param list - The listing to run; tests replace it.
 * @returns
 * - `listed` with Vitest's entries.
 * - `failed`: Vitest ended with an error or wrote no readable list, and its process group ended.
 * - `cancelled`: the start was cancelled.
 * - `deadline`: the deadline passed before or during the listing.
 * - `unconfirmed`: the listing's process group could not be confirmed as ended; its error names the group and the folder that was kept.
 * @example
 * await listVitestForRootClaim({ program, vitestRoot: '/repo', filter: 'packages/a/src/a.test.ts', excludes: [] }, { node, cancellation, deadlineAt })
 * // => { outcome: 'listed', files: [] }
 */
export async function listVitestForRootClaim(
  request: ListVitestTestFilesRequest,
  run: { node: string; cancellation: AbortSignal; deadlineAt: number },
  list: typeof listVitestTestFiles = listVitestTestFiles,
): Promise<RootClaimListing> {
  const remainingMs = run.deadlineAt - Date.now()
  if (remainingMs <= 0)
    return {
      outcome: 'deadline',
      error: new VitestListingDeadlineError(
        `node-test's preparation deadline passed before Vitest could list ${request.filter} from the repository root.`,
      ),
    }
  let releaseFailure: VitestListingReleaseFailure | undefined
  try {
    const files = await list({
      ...request,
      node: run.node,
      signal: run.cancellation,
      timeoutMs: Math.min(VITEST_FILE_LIST_TIMEOUT_MS, remainingMs),
      onReleaseFailed: (failure) => {
        releaseFailure = failure
      },
    })
    return { outcome: 'listed', files }
  } catch (error) {
    if (run.cancellation.aborted) return { outcome: 'cancelled', error }
    // A member of the listing's group may still run: no second Vitest starts beside it, whatever the listing's own result.
    if (releaseFailure)
      return {
        outcome: 'unconfirmed',
        error: new Error(
          `Vitest's listing from the repository root ended, but Codebook could not confirm that its process group ${releaseFailure.processGroup} ended (${releaseFailure.reason}), so a process of that group may still run. The test was not started, and the listing's folder ${releaseFailure.directory} is kept. Start the run again.`,
          { cause: error },
        ),
      }
    if (error instanceof VitestListingDeadlineError)
      return { outcome: 'deadline', error }
    return { outcome: 'failed', error }
  }
}
