import type { DevelopmentApp } from '../developmentServerAdapter'
import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import { waitTimeoutText } from '../runtimeSupport/utils/waitTimeoutText'

/**
 * Waits for the launcher's next message, but only until one overall deadline, however many earlier messages were skipped.
 *
 * Why it exists: a wait that skips unrelated reports and passes the full timeout to each `nextMessage` restarts its clock with every skipped report, so a chatty launcher could hold the serialized request chain far beyond the intended bound. Called by {@link requestViteLibraryModules} and {@link awaitViteOptimizerIdle} in their skip loops.
 * @param app - The started Vite launcher process.
 * @param deadlineAtMs - The `performance.now()` time after which no message is waited for.
 * @param signal - Ends the wait when the run is cancelled.
 * @returns The next message as the launcher sent it.
 * @throws {@link WaitTimeoutError} with the same sentence the launcher wait throws when the deadline has passed; whatever `nextMessage` throws.
 * @example
 * const deadlineAtMs = performance.now() + 20_000
 * const message = await nextLauncherMessageBefore(app, deadlineAtMs, signal)
 */
export async function nextLauncherMessageBefore(
  app: Pick<DevelopmentApp, 'nextMessage'>,
  deadlineAtMs: number,
  signal: AbortSignal,
): Promise<unknown> {
  const remainingMs = deadlineAtMs - performance.now()
  // No time is left: fail like the launcher wait does, without another read.
  if (remainingMs <= 0)
    throw new WaitTimeoutError(
      waitTimeoutText('a message of the owned launcher'),
    )
  return app.nextMessage(remainingMs, signal)
}
