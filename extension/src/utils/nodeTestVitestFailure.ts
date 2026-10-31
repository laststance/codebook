import { NODE_TEST_VITEST_FAILED_RECOVERY, StudyError } from '../errors'

import {
  VitestListingDeadlineError,
  VitestListingFailedError,
} from './listVitestTestFiles'

/**
 * Gives a failure that Vitest itself caused before a node-test run's first stop a test-run recovery, so the run's error does not carry the browser-click wording of the general `RUNTIME_FAILED` recovery.
 *
 * Called by {@link OwnedNodeTestRun.prepare} on what its preparation threw, and by the study environment's pre-history check on what {@link planNodeTestExecution} threw (a root claim's Vitest listing that passed its deadline). A failed listing ({@link VitestListingFailedError}) and a listing past its deadline ({@link VitestListingDeadlineError}) are worded here and keep Vitest's own text as the cause; any other failure, a {@link StudyError} included, is returned unchanged.
 * @param failure - What the preparation threw.
 * @returns A `RUNTIME_FAILED` {@link StudyError} carrying {@link NODE_TEST_VITEST_FAILED_RECOVERY} for a listing failure, otherwise `failure` itself.
 * @example
 * nodeTestVitestFailure(new VitestListingFailedError('Vitest could not list the cited test file (exit code 1): MISSING DEPENDENCY')).message
 * // => 'The node-test run ended before its first stop: Vitest could not list the cited test file.'
 */
export function nodeTestVitestFailure(failure: unknown): unknown {
  // Only the two listing failures are Vitest's own; everything else keeps its error.
  if (failure instanceof VitestListingFailedError)
    return new StudyError(
      'RUNTIME_FAILED',
      'The node-test run ended before its first stop: Vitest could not list the cited test file.',
      failure.message,
      NODE_TEST_VITEST_FAILED_RECOVERY,
    )
  if (failure instanceof VitestListingDeadlineError)
    return new StudyError(
      'RUNTIME_FAILED',
      'The node-test run ended before its first stop: Vitest did not list the cited test file in time.',
      failure.message,
      NODE_TEST_VITEST_FAILED_RECOVERY,
    )
  return failure
}
