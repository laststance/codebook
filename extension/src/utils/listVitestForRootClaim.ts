import { VITEST_FILE_LIST_TIMEOUT_MS } from '../constants'

import {
  listVitestTestFiles,
  VitestListingDeadlineError,
  VitestListingFailedError,
  type ListVitestTestFilesRequest,
  type RetryVitestListingRelease,
  type VitestListedFile,
  type VitestListingReleaseFailure,
} from './listVitestTestFiles'

/** How a root claim's listing ended: the files Vitest reported, or why there are none, with the error a refusal carries. */
export type RootClaimListing =
  | { outcome: 'listed'; files: VitestListedFile[] }
  | {
      outcome: 'failed' | 'cancelled' | 'deadline' | 'unconfirmed' | 'error'
      error: unknown
    }

/**
 * Words the deadline that passed for a root claim's listing, before it started or while it ran and released.
 * @param filter - The cited repository-relative file the listing asked for.
 * @returns The listing's deadline error.
 * @example deadlinePassed('packages/a/src/a.test.ts').message // => "node-test's preparation deadline passed before Vitest could list packages/a/src/a.test.ts from the repository root."
 */
const deadlinePassed = (filter: string) =>
  new VitestListingDeadlineError(
    `node-test's preparation deadline passed before Vitest could list ${filter} from the repository root.`,
  )

/**
 * Classifies a root claim's listing that threw, once its release is known: a listing that may still run is unconfirmed whatever else happened, then a stop, a passed deadline, Vitest's own failure, and last a failure of Codebook's own (its folder, the spawn or a file read), which refuses like a stop.
 * Called by {@link listVitestForRootClaim} only.
 * @param error - What the listing threw.
 * @param releaseFailure - The listing's failed release, if its process group could not be confirmed as ended.
 * @param context - The start's cancellation, whether its deadline has passed by now, and the cited file.
 * @returns The listing's outcome other than `listed`.
 * @example classifyFailedListing(new VitestListingFailedError('exit code 1'), undefined, { cancellation, deadlinePassedNow: false, filter }) // => { outcome: 'failed', error }
 */
function classifyFailedListing(
  error: unknown,
  releaseFailure: VitestListingReleaseFailure | undefined,
  context: {
    cancellation: AbortSignal
    deadlinePassedNow: boolean
    filter: string
  },
): Exclude<RootClaimListing, { outcome: 'listed' }> {
  // A member of the listing's group may still run: no second Vitest starts beside it, whatever the listing's own result or a stop meanwhile.
  if (releaseFailure)
    return {
      outcome: 'unconfirmed',
      error: new Error(
        `Vitest's listing from the repository root ended, but Codebook could not confirm that its process group ${releaseFailure.processGroup} ended (${releaseFailure.reason}), so a process of that group may still run. The test was not started, and the listing's folder ${releaseFailure.directory} is kept. Start the run again.`,
        { cause: error },
      ),
    }
  if (context.cancellation.aborted) return { outcome: 'cancelled', error }
  if (error instanceof VitestListingDeadlineError)
    return { outcome: 'deadline', error }
  // A deadline that passed while the listing ended and released refuses as one that passed before it.
  if (context.deadlinePassedNow)
    return { outcome: 'deadline', error: deadlinePassed(context.filter) }
  if (error instanceof VitestListingFailedError)
    return { outcome: 'failed', error }
  return {
    outcome: 'error',
    error: new Error(
      `Vitest could not list ${context.filter} from the repository root (${String(error)}). The test was not started; start it again.`,
      { cause: error },
    ),
  }
}

/**
 * Lists the cited test from the opened root with the root's Vitest, for a root claim made before the run's history begins, and tells a clean failure Vitest itself reported apart from a cancelled start, a passed deadline, a listing whose process group could not be confirmed as ended and a listing Codebook could not run.
 * Called by the study environment's pre-history check through {@link planNodeTestExecution}; the listing runs within {@link VITEST_FILE_LIST_TIMEOUT_MS} and the start's preparation deadline, whichever ends first, and the deadline is read again once the listing ended.
 * @param request - The root's Vitest program, the opened root, the cited repository-relative file and no excludes.
 * @param run - The Node executable, the start's cancellation, its preparation deadline (epoch milliseconds on the clock `now`, `Date.now` by default), and who hears of a listing whose process group could not be confirmed as ended, before the run's history (or its journal) exists, with the retry that releases it at the run's stop.
 * @param list - The listing to run; tests replace it.
 * @returns
 * - `listed` with Vitest's entries.
 * - `failed`: Vitest ended with an error or wrote no readable list ({@link VitestListingFailedError}), and its process group ended.
 * - `unconfirmed`: the listing's process group could not be confirmed as ended, also when the start was cancelled meanwhile; its error names the group and the folder that was kept.
 * - `cancelled`: the start was cancelled.
 * - `deadline`: the deadline passed before, during or by the end of the listing.
 * - `error`: Codebook could not run the listing (its folder, the spawn or a file read failed).
 * @example
 * await listVitestForRootClaim({ program, vitestRoot: '/repo', filter: 'packages/a/src/a.test.ts', excludes: [] }, { node, cancellation, deadlineAt })
 * // => { outcome: 'listed', files: [] }
 */
export async function listVitestForRootClaim(
  request: ListVitestTestFilesRequest,
  run: {
    node: string
    cancellation: AbortSignal
    deadlineAt: number
    now?: () => number
    onReleaseFailed?: (
      failure: VitestListingReleaseFailure,
      retryRelease: RetryVitestListingRelease,
    ) => void
  },
  list: typeof listVitestTestFiles = listVitestTestFiles,
): Promise<RootClaimListing> {
  // The deadline is read on the clock it was set on: the study service's, which a test may replace.
  const now = run.now ?? Date.now
  const remainingMs = run.deadlineAt - now()
  if (remainingMs <= 0)
    return { outcome: 'deadline', error: deadlinePassed(request.filter) }
  let releaseFailure: VitestListingReleaseFailure | undefined
  try {
    const files = await list({
      ...request,
      node: run.node,
      signal: run.cancellation,
      timeoutMs: Math.min(VITEST_FILE_LIST_TIMEOUT_MS, remainingMs),
      onReleaseFailed: (failure, retryRelease) => {
        releaseFailure = failure
        run.onReleaseFailed?.(failure, retryRelease)
      },
    })
    // A listing that ended after the deadline goes no further than one that outlived it.
    if (now() >= run.deadlineAt)
      return { outcome: 'deadline', error: deadlinePassed(request.filter) }
    return { outcome: 'listed', files }
  } catch (error) {
    return classifyFailedListing(error, releaseFailure, {
      cancellation: run.cancellation,
      deadlinePassedNow: now() >= run.deadlineAt,
      filter: request.filter,
    })
  }
}
