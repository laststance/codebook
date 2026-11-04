import { StudyError } from '../errors'
import { PAGES_STOP_REFUSAL_DETAILS } from '../nextRefusals'

import { thrownMessage } from './thrownMessage'

/**
 * Runs a Pages server seal and words every raw failure of it as the `RUNTIME_FAILED` refusal that carries the Pages details.
 *
 * Why it exists: every seal of a Pages server stop runs after Codebook's readiness request ran the page's data function, so its failures report `sideEffects: "unknown"`. Called by {@link sealPagesServerStop} and {@link sealLibraryStop}.
 * @param signal - The run's abort signal; an abort is rethrown unchanged.
 * @param seal - The seal to run.
 * @returns What the seal returns.
 * @throws The run's abort and any {@link StudyError} unchanged; any other failure as `RUNTIME_FAILED` with {@link PAGES_STOP_REFUSAL_DETAILS}.
 * @example
 * await wordPagesSealFailure(signal, () => sealOnDataPath(request))
 */
export async function wordPagesSealFailure<Result>(
  signal: AbortSignal | undefined,
  seal: () => Promise<Result>,
): Promise<Result> {
  try {
    return await seal()
  } catch (error) {
    // The run's abort and a coded refusal keep what they say; any other failure came after the readiness request.
    if (signal?.aborted || error instanceof StudyError) throw error
    const message = thrownMessage(error)
    throw new StudyError('RUNTIME_FAILED', message, message, undefined, error, {
      ...PAGES_STOP_REFUSAL_DETAILS,
    })
  }
}
