import { ERROR_RECOVERY, StudyError } from '../errors'
import {
  SETUP_DEADLINE_AFTER_READINESS_RECOVERY,
  UNCODED_SETUP_DEADLINE_TEXT,
} from '../nextRefusals'
import type { ConfiguredRuntimeView } from '../runtime'

/**
 * Adds what Codebook's readiness request may have changed to the failure of a setup deadline that came after the request was sent: `details.sideEffects` `unknown`, `details.readinessRequest`, `details.router` `pages` once the entry resolved as a Pages route, and a recovery that asks the learner before another start.
 *
 * Why it exists: the setup deadline fails a run by its text (`NEXT_SETUP_DEADLINE(<variant>): …`, or the uncoded {@link UNCODED_SETUP_DEADLINE_TEXT}), whose static recovery offers a retry; once the readiness request ran the entry page's data function or server components, that retry could run a write again unasked. The run resource's `readinessRequest` says the request was sent, so the service completes the deadline's error where it builds it. Called by {@link StudyService} for a configured run's preparation error and for a runtime failure its state shows.
 * @param error - The run's error as the service built it.
 * @param run - The run's view: its readiness record and the route its entry resolved to.
 * @returns
 * - For `NEXT_SETUP_DEADLINE`, or `RUNTIME_FAILED` whose cause is the uncoded setup deadline, of a run whose readiness request was sent: a copy with the details and the readiness sentence before the deadline's own recovery
 * - Otherwise `error` itself
 * @example
 * withSetupDeadlineSideEffects(new StudyError('RUNTIME_FAILED', 'Repository setup deadline exceeded'), { readinessRequest: { state: 'closed', sentAtMs: 12.5, status: 200 } }).details
 * // => { sideEffects: 'unknown', readinessRequest: { state: 'closed', sentAtMs: 12.5, status: 200 } }
 */
export function withSetupDeadlineSideEffects(
  error: StudyError,
  run:
    Pick<ConfiguredRuntimeView, 'readinessRequest' | 'nextRoute'> | undefined,
): StudyError {
  const readinessRequest = run?.readinessRequest,
    isSetupDeadline =
      error.code === 'NEXT_SETUP_DEADLINE' ||
      (error.code === 'RUNTIME_FAILED' &&
        error.causeDetail.startsWith(UNCODED_SETUP_DEADLINE_TEXT))
  // A deadline before the request was sent ran no server code of the entry, and any other failure keeps its own words.
  if (!readinessRequest || !isSetupDeadline) return error
  return new StudyError(
    error.code,
    error.message,
    error.causeDetail,
    `${SETUP_DEADLINE_AFTER_READINESS_RECOVERY} ${error.recoveryOverride ?? ERROR_RECOVERY[error.code]}`,
    undefined,
    {
      ...error.details,
      sideEffects: 'unknown',
      readinessRequest,
      // Only a resolved Pages route names its router: before the manifests answer, the router is not known.
      ...(run?.nextRoute?.router === 'pages' ? { router: 'pages' } : {}),
    },
  )
}
