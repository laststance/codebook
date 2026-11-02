import { isRscScriptUrl } from './isRscScriptUrl'

/** The label a pause carries in the run resource and the saved study. */
export type ServerPauseExecution = 'server-render' | 'server-action'

/**
 * Names the kind of a server pause by the webpack layer of the script it paused in: an `(rsc)` instance is a server render, every other server layer (`(action-browser)`, `(middleware)`) a server action.
 * Why it exists: the learner and the saved replay must say what ran, not which layer Codebook sealed; a server-action stop that pauses in an `(rsc)` instance reads `server-render`. Called by {@link ConfiguredBrowserRun} when it publishes a server pause.
 * @param scriptUrl - The paused script's address.
 * @returns `server-render` for `(rsc)`, otherwise `server-action`.
 * @example
 * serverExecutionOfScriptUrl('webpack-internal:///(rsc)/./app/lib/data.ts') // => 'server-render'
 * serverExecutionOfScriptUrl('webpack-internal:///(action-browser)/./app/lib/actions.ts') // => 'server-action'
 */
export function serverExecutionOfScriptUrl(
  scriptUrl: string | undefined,
): ServerPauseExecution {
  return isRscScriptUrl(scriptUrl) ? 'server-render' : 'server-action'
}
