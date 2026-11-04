import { VITE_LAUNCHER_MESSAGES } from '../constants'
import type { DevelopmentApp } from '../developmentServerAdapter'

import { parseViteLauncherReport } from './parseViteLauncherReport'
import { serializeLauncherRequests } from './serializeLauncherRequests'

/**
 * Asks the owned Vite launcher to report when Vite's dependency optimizer is idle and waits for that report.
 *
 * Why it exists: a late-discovered dependency makes Vite reload the page after an optimizer run whose length no fixed window bounds, so the run waits for the optimizer itself before it starts a quiet window. Called by the Vite adapter's `waitForServerSettled` from `waitForStablePage` in the configured browser run.
 *
 * Requests on one launcher are serialized ({@link serializeLauncherRequests}): the wait is sent only after the previous request's answer arrived, so it never takes a walk's answer.
 *
 * @param app - The started Vite launcher process.
 * @param timeoutMs - The longest the report may take; the caller passes what is left of the run's setup budget.
 * @param signal - Ends the wait when the run is cancelled.
 * @throws When the launcher exits, the wait times out or the run is cancelled.
 * @example
 * await awaitViteOptimizerIdle(app, 60_000, signal)
 */
export async function awaitViteOptimizerIdle(
  app: Pick<DevelopmentApp, 'send' | 'nextMessage'>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  await serializeLauncherRequests(app, async () => {
    app.send({ type: VITE_LAUNCHER_MESSAGES.awaitOptimizer })
    // Reports that belong to no pending request (a late walk answer) are skipped until the optimizer report arrives.
    for (;;) {
      const report = parseViteLauncherReport(
        await app.nextMessage(timeoutMs, signal),
      )
      if (report.type === VITE_LAUNCHER_MESSAGES.optimizerIdle) return
    }
  })
}
