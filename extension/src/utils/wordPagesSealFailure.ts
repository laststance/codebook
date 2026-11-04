import { StudyError } from '../errors'
import { PAGES_STOP_REFUSAL_DETAILS } from '../nextRefusals'

import { thrownMessage } from './thrownMessage'

/**
 * Runs a Next stop seal and words every raw failure of it as the `RUNTIME_FAILED` refusal that carries the Pages details.
 *
 * Why it exists: every seal of a Pages server stop runs after Codebook's readiness request ran the page's data function, so its failures report `sideEffects: "unknown"`. The App Router browser library seal runs after the entry request and words its failures the same way, with its own router. Called by {@link sealPagesServerStop}, {@link sealLibraryStop} and {@link sealAppLibraryStop}.
 * @param signal - The run's abort signal; an abort is rethrown unchanged.
 * @param seal - The seal to run.
 * @param router - The router of the stop's app; `pages` by default, `app` for the App Router browser library seal.
 * @returns What the seal returns.
 * @throws The run's abort and any {@link StudyError} unchanged; any other failure as `RUNTIME_FAILED` with {@link PAGES_STOP_REFUSAL_DETAILS} and the given `router`.
 * @example
 * await wordPagesSealFailure(signal, () => sealOnDataPath(request))
 * await wordPagesSealFailure(signal, () => sealWithin(request), 'app')
 */
export async function wordPagesSealFailure<Result>(
  signal: AbortSignal | undefined,
  seal: () => Promise<Result>,
  router: 'pages' | 'app' = 'pages',
): Promise<Result> {
  try {
    return await seal()
  } catch (error) {
    // The run's abort and a coded refusal keep what they say; any other failure came after the readiness request.
    if (signal?.aborted || error instanceof StudyError) throw error
    const message = thrownMessage(error)
    throw new StudyError('RUNTIME_FAILED', message, message, undefined, error, {
      ...PAGES_STOP_REFUSAL_DETAILS,
      router,
    })
  }
}
