import { SEAL_RETRY_DELAY_MS, TRANSIENT_SEAL_ERROR_CODES } from '../constants'

import { systemErrorCode } from './systemErrorCode'

/**
 * Seals a history, and once more after a short wait when the first attempt failed with a transient file-system code.
 * Called by the server and the chrome-extension recorder at their one seal.
 * @param seal - One attempt at the writer's seal.
 * @param retryDelay - Waits before the retry; a real timer unless a test names its own.
 * @returns The sealed journal's hash, as the writer returns it.
 * @throws The first failure when it is not transient, else the retry's failure.
 * @example const hash = await sealWithTransientRetry(() => writer.seal(end))
 */
export async function sealWithTransientRetry(
  seal: () => Promise<string | undefined>,
  retryDelay?: (milliseconds: number) => Promise<void>,
): Promise<string | undefined> {
  try {
    return await seal()
  } catch (error) {
    if (!TRANSIENT_SEAL_ERROR_CODES.includes(systemErrorCode(error)))
      throw error
    const wait =
      retryDelay ??
      ((milliseconds: number): Promise<void> =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
    await wait(SEAL_RETRY_DELAY_MS)
    return seal()
  }
}
