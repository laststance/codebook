import { setTimeout as delay } from 'node:timers/promises'

import type { OwnedApiServer } from '../ownedApiServer'

/**
 * The failure arbiter of the app's own API server (E-6, D24): decides whether the loss of the API's session, inspector channel or transport is the API's exit.
 *
 * Why it exists: when the API ends, js-debug's session ends and the inspector socket closes in an order nobody controls, and the first string reason a run keeps would be a generic transport error. The API's own exit fact is the true cause, so the run asks it within one bound and reports it when it arrives.
 * Called by the run whenever a loss correlated with the API arrives (its session terminated, its proxy closed, a transport error) and by the exit watcher.
 * @param server - The API process, whose exit fact never rejects.
 * @param boundMs - How long to wait for the exit after the loss.
 * @returns The `SERVER_EXITED` error words of the exit fact when the API exited within the bound; `undefined` when it is still running (the loss is something else).
 * @example
 * const exit = await resolveApiLoss(api, 2_000)
 * if (exit) run.fail(exit.message)
 */
export async function resolveApiLoss(
  server: Pick<OwnedApiServer, 'whenExited'>,
  boundMs: number,
): Promise<Awaited<ReturnType<OwnedApiServer['whenExited']>> | undefined> {
  const cancelDelay = new AbortController()
  try {
    const outcome = await Promise.race([
      server.whenExited(),
      // Aborting the losing timer rejects it; that rejection is the timer ending, not a failure.
      delay(boundMs, 'running' as const, { signal: cancelDelay.signal }).catch(
        () => 'running' as const,
      ),
    ])
    return outcome === 'running' ? undefined : outcome
  } finally {
    // The losing timer must not keep the process alive.
    cancelDelay.abort()
  }
}
