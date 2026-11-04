import { VITE_LAUNCHER_MESSAGES } from '../constants'
import type { DevelopmentApp } from '../developmentServerAdapter'
import type {
  ViteLibraryModulesCommand,
  ViteLibraryModulesReport,
} from '../viteLauncherProtocol'

import { nextLauncherMessageBefore } from './nextLauncherMessageBefore'
import { parseViteLauncherReport } from './parseViteLauncherReport'
import { serializeLauncherRequests } from './serializeLauncherRequests'

/** What one walk of Vite's client module graph found for one library folder (the report without its protocol fields). */
export type ViteLibraryModules = Omit<
  ViteLibraryModulesReport,
  'type' | 'requestId'
>

/** The request identity of the last walk, so each answer is matched to its own request. */
let lastRequestId = 0

/**
 * Asks the owned Vite launcher which modules of one library folder Vite's client graph reaches from the entry modules, and waits for that answer.
 *
 * Why it exists: a browser stop in a workspace library that a nested Vite app imports is sealed against the one served module whose map names the stop's file; Vite's own graph (inside the launcher) lists the candidates with the browser's resolution, before the browser opens. Called by the Vite adapter once per page generation of a run with a library stop.
 *
 * Requests on one launcher are serialized ({@link serializeLauncherRequests}): this one is sent only after the previous request's answer arrived, so concurrent callers never take each other's answers.
 *
 * @param app - The started Vite launcher process (listening).
 * @param request - The entry module URLs of the served `index.html` and the library folder's real path.
 * @param timeoutMs - The longest the answer may take; the launcher bounds the walk itself at {@link VITE_LIBRARY_WALK_DEADLINE_MS}.
 * @param signal - Ends the wait when the run is cancelled.
 * @returns The library's served module URLs, whether an optimized dependency holds the library, and the bound that ended the walk early, if any.
 * @throws When the launcher exits, the answer times out, an answer has no known shape, or the run is cancelled.
 * @example
 * await requestViteLibraryModules(app, { entries: ['/src/main.tsx'], libraryFolder: '/repo/packages/query-core' }, 20_000, signal)
 * // => { modules: ['/@fs/repo/packages/query-core/build/modern/query.js'], optimizedLibrary: false }
 */
export async function requestViteLibraryModules(
  app: Pick<DevelopmentApp, 'send' | 'nextMessage'>,
  request: Pick<ViteLibraryModulesCommand, 'entries' | 'libraryFolder'>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ViteLibraryModules> {
  return serializeLauncherRequests(app, async () => {
    lastRequestId += 1
    const requestId = lastRequestId
    const command: ViteLibraryModulesCommand = {
      type: VITE_LAUNCHER_MESSAGES.libraryModules,
      requestId,
      entries: request.entries,
      libraryFolder: request.libraryFolder,
    }
    app.send(command)
    // Reports that belong to no pending request (a late optimizer answer, a timed-out walk's answer) are skipped until this request's answer arrives.
    // One deadline for the whole wait: skipped reports do not restart the clock.
    const deadlineAtMs = performance.now() + timeoutMs
    for (;;) {
      const report = parseViteLauncherReport(
        await nextLauncherMessageBefore(app, deadlineAtMs, signal),
      )
      if (
        report.type === VITE_LAUNCHER_MESSAGES.libraryModulesResult &&
        report.requestId === requestId
      )
        return {
          modules: report.modules,
          optimizedLibrary: report.optimizedLibrary,
          ...(report.bound === undefined ? {} : { bound: report.bound }),
        }
    }
  })
}
